/**
 * @file contact/index.ts
 * @description Entidad Contact — lectura/escritura documental sobre `wa.engine`.
 * Contact entity — documental read/write over `wa.engine`.
 */

import { jidNormalizedUser } from 'baileys';
import { Chat, type IChatRaw } from '~/lib/chat';
import { deserialize, serialize } from '~/lib/store';
import type { WhatsApp } from '~/lib/whatsapp';

/**
 * Shape persistido del contacto.
 * Persisted contact shape.
 */
export interface IContactRaw {
  id: string;
  lid?: string | null;
  name?: string | null;
  notify?: string | null;
  verified_name?: string | null;
  img_url?: string | null;
  status?: string | null;
}

/**
 * Clase base del contacto (forma pública, solo lectura).
 * Base Contact class (public shape, read-only).
 */
export class Contact {
  /** @internal Shape persistido. Uso interno (convención underscore). / Internal persisted shape. */
  readonly _raw: IContactRaw;
  /** Chat 1:1 asociado (hidratado). / Associated 1:1 chat (hydrated). */
  readonly chat: Chat;

  constructor(raw: IContactRaw, chat: Chat) {
    this._raw = raw;
    this.chat = chat;
  }

  /** JID único. / Unique JID. */
  get id(): string {
    return this._raw.id;
  }
  /** JID (alias). / JID (alias). */
  get jid(): string {
    return this._raw.id;
  }
  /** LID si está disponible. / LID when available. */
  get lid(): string | null {
    return this._raw.lid ?? null;
  }
  /** Nombre: local → push → teléfono. / Name: local → push → phone. */
  get name(): string {
    return this._raw.name ?? this._raw.notify ?? this._raw.id.split('@')[0];
  }
  /** Número sin formato. / Raw phone number. */
  get phone(): string {
    return this._raw.id.split('@')[0];
  }
  /** URL de foto de perfil. / Profile picture URL. */
  get photo(): string | null {
    return this._raw.img_url ?? null;
  }
  /** Bio del contacto. / Contact bio. */
  get content(): string {
    return this._raw.status ?? '';
  }
}

/**
 * Factoría de Contact ligada al contexto WhatsApp.
 * Context-bound Contact factory.
 *
 * @param wa - Instancia principal / Main WhatsApp instance
 */
export function contact(wa: WhatsApp) {
  /**
   * Descubre el JID canónico y el LID (cuando aplica) de un número consultando al socket.
   * Discovers the canonical JID and LID (when applicable) of a phone number via the socket.
   */
  async function discover_by_phone(
    phone: string
  ): Promise<{ jid: string; lid: string | null } | null> {
    let result: { jid: string; lid: string | null } | null = null;
    if (wa._socket && phone.length > 0) {
      const found = (await wa._socket.onWhatsApp(phone))?.[0] as
        | { jid: string; exists: boolean; lid?: string }
        | undefined;
      if (found?.exists) {
        result = { jid: jidNormalizedUser(found.jid), lid: found.lid ?? null };
      }
    }
    return result;
  }

  /**
   * Obtiene foto y bio del contacto desde el socket.
   * Fetches profile picture and bio from the socket.
   */
  async function fetch_profile_data(
    id: string
  ): Promise<{ img_url: string | null; status: string | null }> {
    let img_url: string | null = null;
    let status: string | null = null;
    if (wa._socket) {
      try {
        img_url = (await wa._socket.profilePictureUrl(id, 'image')) ?? null;
      } catch {
        /* may not exist */
      }
      try {
        const result = await wa._socket.fetchStatus(id);
        const data = result?.[0] as { status?: { status?: string } } | undefined;
        status = data?.status?.status ?? null;
      } catch {
        /* may fail */
      }
    }
    return { img_url, status };
  }

  /**
   * Carga la instancia Chat 1:1 del contacto. Si no existe en engine, fabrica una mínima.
   * Loads the 1:1 Chat instance for a contact. Falls back to a minimal instance if missing.
   */
  async function load_chat_for(
    jid: string,
    fallback_name: string
  ): Promise<InstanceType<typeof wa.Chat>> {
    const cached = deserialize<IChatRaw>(await wa.engine.get(`/chat/${jid}`));
    return new wa.Chat(cached ?? { id: jid, name: fallback_name });
  }

  return class _Contact extends Contact {
    /** Chat 1:1 asociado como subclase enriquecida. / Associated 1:1 chat as enriched subclass. */
    declare readonly chat: InstanceType<typeof wa.Chat>;

    constructor(raw: IContactRaw, chat: InstanceType<typeof wa.Chat>) {
      super(raw, chat);
    }

    /** true si la instancia representa la cuenta autenticada. / true if this instance is the authenticated account. */
    get me(): boolean {
      const self_id = wa._socket?.user?.id;
      return Boolean(self_id) && jidNormalizedUser(self_id!) === this.id;
    }

    /**
     * Obtiene un contacto. Dispatch inteligente:
     * - Si `uid` contiene `@` → se interpreta como JID (`@s.whatsapp.net` / `@g.us`) o LID (`@lid`) y se resuelve con el mapping.
     * - Si no contiene `@` → se limpian los dígitos y se consulta `socket.onWhatsApp(phone)` para obtener el JID canónico.
     *
     * Retrieves a contact. Smart dispatch:
     * - If `uid` contains `@` → treated as JID or LID, resolved via mapping.
     * - If `uid` lacks `@` → digits are extracted and `socket.onWhatsApp(phone)` resolves the canonical JID.
     */
    static async get(uid: string): Promise<_Contact | null> {
      let result: _Contact | null = null;
      let jid: string | null = null;
      let lid: string | null = null;

      if (uid.includes('@')) {
        jid = await wa._resolve_jid(uid);
      } else {
        const discovered = await discover_by_phone(uid.replace(/\D+/g, ''));
        if (discovered) {
          jid = discovered.jid;
          lid = discovered.lid;
        }
      }

      if (jid && !jid.endsWith('@g.us')) {
        const cached = deserialize<IContactRaw>(await wa.engine.get(`/contact/${jid}`));
        if (cached) {
          const fallback_name = cached.name ?? cached.notify ?? jid.split('@')[0];
          result = new _Contact(cached, await load_chat_for(jid, fallback_name));
        } else if (wa._socket) {
          const needs_check = !lid && !uid.endsWith('@lid');
          const discovered = needs_check
            ? await discover_by_phone(jid.split('@')[0])
            : { jid, lid };
          if (discovered) {
            const { img_url, status } = await fetch_profile_data(discovered.jid);
            const raw: IContactRaw = {
              id: discovered.jid,
              lid: discovered.lid,
              name: null,
              notify: null,
              verified_name: null,
              img_url,
              status,
            };
            await wa.engine.set(`/contact/${discovered.jid}`, serialize(raw));
            if (discovered.lid) {
              await wa.engine.set(`/lid/${discovered.lid}`, serialize(discovered.jid));
            }
            result = new _Contact(
              raw,
              await load_chat_for(discovered.jid, discovered.jid.split('@')[0])
            );
          }
        }
      }
      return result;
    }

    /**
     * Pagina los contactos persistidos por mtime DESC, pre-cargando el chat de cada uno.
     * Paginates persisted contacts by mtime DESC, pre-loading the chat of each one.
     */
    static async list(offset = 0, limit = 50): Promise<_Contact[]> {
      const contacts: _Contact[] = [];
      for (const raw of await wa.engine.list('/contact', offset, limit)) {
        const parsed = deserialize<IContactRaw>(raw);
        if (parsed) {
          const fallback_name = parsed.name ?? parsed.notify ?? parsed.id.split('@')[0];
          contacts.push(new _Contact(parsed, await load_chat_for(parsed.id, fallback_name)));
        }
      }
      return contacts;
    }

    /**
     * Renombra localmente un contacto por id.
     * Renames a contact locally by id.
     */
    static async rename(uid: string, name: string): Promise<boolean> {
      const c = await _Contact.get(uid);
      return c ? c.rename(name) : false;
    }

    /**
     * Re-hidrata los datos del contacto por id desde el socket.
     * Re-hydrates contact data from the socket by id.
     */
    static async refresh(uid: string): Promise<_Contact | null> {
      const c = await _Contact.get(uid);
      return c ? c.refresh() : null;
    }

    /**
     * Renombra el contacto localmente (solo agenda del dispositivo).
     * Renames the contact locally (device address book only).
     */
    async rename(name: string): Promise<boolean> {
      this._raw.name = name;
      await wa.engine.set(`/contact/${this.id}`, serialize(this._raw));
      return true;
    }

    /**
     * Re-hidrata foto y bio desde el socket.
     * Re-hydrates profile picture and bio from the socket.
     */
    async refresh(): Promise<this | null> {
      let ok = false;
      if (wa._socket) {
        const { img_url, status } = await fetch_profile_data(this.id);
        this._raw.img_url = img_url;
        this._raw.status = status;
        await wa.engine.set(`/contact/${this.id}`, serialize(this._raw));
        ok = true;
      }
      return ok ? this : null;
    }
  };
}
