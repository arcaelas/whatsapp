/**
 * @file contact/index.ts
 * @description Entidad Contact — una ficha mínima derivada del raw del contacto.
 * Contact entity — a minimal card derived from the raw contact document.
 */

import { jidNormalizedUser } from 'baileys';
import { internals } from '~/lib/internal';
import type { Chat } from '~/lib/chat';
import { deserialize, serialize } from '~/lib/store';
import type { WhatsApp } from '~/lib/whatsapp';

/**
 * Clase base del contacto: recibe el raw de baileys y deriva todo con getters.
 * Base Contact class: receives the baileys raw and derives everything via getters.
 */
export class Contact {
  /**
   * @internal Documento crudo del contacto en snake_case. `id` llega en formato LID o PN
   * según el addressing; `phone_number` es el JID PN cuando baileys lo conoce.
   * Raw contact document in snake_case. `id` arrives in LID or PN format depending on
   * addressing; `phone_number` is the PN JID when baileys knows it.
   */
  constructor(
    readonly _raw: {
      id: string;
      lid?: string | null;
      phone_number?: string | null;
      name?: string | null;
      notify?: string | null;
      verified_name?: string | null;
      img_url?: string | null;
      status?: string | null;
    }
  ) { }

  /** Nombre: agenda → público → verificado → teléfono. / Name: address book → public → verified → phone. */
  get name(): string {
    const { name, notify, verified_name } = this._raw;
    return name ?? notify ?? verified_name ?? this.phone ?? this._raw.id.split('@')[0];
  }

  /**
   * JID legado (`@s.whatsapp.net`): el reportado por baileys o generado desde el id
   * cuando ya viene en formato PN; null si no es determinable.
   * Legacy JID (`@s.whatsapp.net`): the one baileys reports or generated from the id
   * when it is already PN-formatted; null when not determinable.
   */
  get jid(): string | null {
    if (this._raw.phone_number) return jidNormalizedUser(this._raw.phone_number);
    if (this._raw.id.endsWith('@s.whatsapp.net')) return jidNormalizedUser(this._raw.id);
    return null;
  }

  /** LID (`@lid`) cuando es definible; null si no. / LID (`@lid`) when definable; null otherwise. */
  get lid(): string | null {
    if (this._raw.lid) return this._raw.lid;
    if (this._raw.id.endsWith('@lid')) return this._raw.id;
    return null;
  }

  /**
   * Teléfono del contacto, derivado únicamente del JID PN (nunca del LID);
   * null cuando no hay JID determinable.
   * Contact phone, derived from the PN JID only (never from the LID);
   * null when no JID is determinable.
   */
  get phone(): string | null {
    return this.jid?.split('@')[0] ?? null;
  }

  /** URL de la foto de perfil, o null. / Profile picture URL, or null. */
  get photo(): string | null {
    const url = this._raw.img_url;
    return url?.startsWith('http') ? url : null;
  }
}

/**
 * Factoría de Contact ligada al contexto WhatsApp.
 * Context-bound Contact factory.
 *
 * @param wa - Instancia principal / Main WhatsApp instance
 */
export function contact(wa: WhatsApp) {
  return class _Contact extends Contact {
    /**
     * Chat 1:1 del contacto: el persistido en el engine, o una instancia mínima.
     * The contact's 1:1 chat: the engine-persisted one, or a minimal instance.
     *
     * @returns Instancia de Chat / Chat instance
     */
    async chat(): Promise<InstanceType<typeof wa.Chat>> {
      const cid = this.jid ?? this.lid ?? this._raw.id;
      const cached = deserialize<Chat['_raw']>(await wa.engine.get(`/chat/${cid}`));
      return new wa.Chat(cached ?? { id: cid, name: this.name });
    }

    /**
     * Carga un contacto por teléfono, JID o LID: primero el engine; si no está
     * persistido lo descubre por red (`onWhatsApp` + foto + bio) y lo materializa.
     * Loads a contact by phone, JID or LID: engine first; when not persisted it
     * discovers it over the network (`onWhatsApp` + photo + bio) and materializes it.
     *
     * @param uid - Teléfono, JID o LID / Phone, JID or LID
     * @returns Contacto o null si no existe en WhatsApp / Contact or null when not on WhatsApp
     */
    static async get(uid: string | number): Promise<_Contact | null> {
      const digits = String(uid).replace(/\D+/g, '');
      const jid = String(uid).includes('@')
        ? await internals(wa).resolve_jid(String(uid))
        : digits
          ? `${digits}@s.whatsapp.net`
          : null;
      if (jid && !jid.endsWith('@g.us')) {
        const cached = deserialize<Contact['_raw']>(await wa.engine.get(`/contact/${jid}`));
        if (cached) return new _Contact(cached);
        const socket = internals(wa).socket;
        if (socket) {
          const found = (await socket.onWhatsApp(jid.split('@')[0]))?.[0] as
            | { jid: string; exists: boolean; lid?: string }
            | undefined;
          if (found?.exists) {
            const id = jidNormalizedUser(found.jid);
            const img_url = await socket.profilePictureUrl(id, 'image').catch(() => null);
            const status = await socket
              .fetchStatus(id)
              .then((result) => (result?.[0] as { status?: { status?: string } } | undefined)?.status?.status ?? null)
              .catch(() => null);
            const raw: Contact['_raw'] = {
              id,
              lid: found.lid ?? null,
              phone_number: id,
              name: null,
              notify: null,
              verified_name: null,
              img_url: img_url ?? null,
              status,
            };
            await wa.engine.set(`/contact/${id}`, serialize(raw));
            if (found.lid) {
              await wa.engine.set(`/lid/${found.lid}`, serialize(id));
            }
            return new _Contact(raw);
          }
        }
      }
      return null;
    }

    /**
     * Pagina los contactos persistidos.
     * Paginates persisted contacts.
     *
     * @param offset - Desplazamiento / Offset
     * @param limit - Tamaño de página / Page size
     * @returns Página de contactos / Contact page
     */
    static async list(offset = 0, limit = 50): Promise<_Contact[]> {
      return (await wa.engine.list('/contact', offset, limit))
        .map((raw) => deserialize<Contact['_raw']>(raw))
        .filter((parsed): parsed is Contact['_raw'] => parsed !== null)
        .map((parsed) => new _Contact(parsed));
    }
  };
}
