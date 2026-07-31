/**
 * @file chat/index.ts
 * @description Entidad Chat — conversaciones individuales y grupales.
 * Chat entity — individual and group conversations.
 */

import { internals } from '~/lib/internal';
import type { Contact } from '~/lib/contact';
import { Message } from '~/lib/message';
import { deserialize, serialize } from '~/lib/store';
import type { WhatsApp } from '~/lib/whatsapp';

/**
 * Clase base del chat: recibe el raw y deriva todo con getters.
 * Base Chat class: receives the raw and derives everything via getters.
 */
export class Chat {
  /**
   * @internal Documento crudo del chat. `id` es el identificador del engine (JID, LID o
   * `@g.us`); `pinned` y `mute_end_time` son epoch ms.
   * Raw chat document. `id` is the engine identifier (JID, LID or `@g.us`); `pinned` and
   * `mute_end_time` are epoch ms.
   */
  constructor(
    readonly _raw: {
      id: string;
      name?: string | null;
      archived?: boolean | null;
      pinned?: number | null;
      mute_end_time?: number | null;
      unread_count?: number | null;
      /** Epoch ms del último mensaje: ordena la lista y sobrevive a las escrituras de flags. / Last message epoch ms: orders the list and survives flag writes. */
      activity?: number | null;
    }
  ) { }

  /** Teléfono del contacto, o el identificador crudo en grupos y LIDs. / Contact phone, or the raw identifier for groups and LIDs. */
  get id(): string {
    return this._raw.id.endsWith('@s.whatsapp.net') ? this._raw.id.split('@')[0].split(':')[0] : this._raw.id;
  }

  /** Nombre del grupo o del contacto. / Group or contact name. */
  get name(): string {
    return this._raw.name ?? this.id;
  }

  /** Tipo de conversación. / Conversation type. */
  get type(): 'group' | 'contact' {
    return this._raw.id.endsWith('@g.us') ? 'group' : 'contact';
  }

  /** true si el chat está archivado. / true when the chat is archived. */
  get archived(): boolean {
    return this._raw.archived ?? false;
  }

  /** true si el chat está fijado. / true when the chat is pinned. */
  get pinned(): boolean {
    return this._raw.pinned != null;
  }

  /** Mensajes sin leer del chat. / Chat's unread messages. */
  get count(): number {
    return this._raw.unread_count ?? 0;
  }

  /** Fecha ISO UTC hasta la que el chat está silenciado, o null. / ISO UTC date until the chat stays muted, or null. */
  get muted(): string | null {
    const end = this._raw.mute_end_time;
    return end != null && end > Date.now() ? new Date(end).toISOString() : null;
  }
}

/** Máximo de chats fijados que acepta WhatsApp; el cuarto se descarta en silencio. / Max pinned chats WhatsApp accepts; the fourth is silently dropped. */
const MAX_PINNED = 3;

/**
 * Factoría de Chat ligada al contexto WhatsApp.
 * Context-bound Chat factory.
 *
 * @param wa - Instancia principal / Main WhatsApp instance
 */
export function chat(wa: WhatsApp) {
  /**
   * Último mensaje del chat en el formato que exige `chatModify`.
   * The chat's last message in the shape `chatModify` requires.
   */
  /**
   * Actividad del chat según su último mensaje: mantiene la posición en la lista cuando se
   * reescribe el documento por fijar, archivar, silenciar o marcar leído.
   * Chat activity from its last message: keeps its position in the list when the document is
   * rewritten by pinning, archiving, muting or marking as read.
   */
  async function activity_of(cid: string): Promise<number> {
    const [raw] = await wa.engine.list(`/chat/${cid}/message`, 0, 1);
    return deserialize<{ created_at: number }>(raw ?? null)?.created_at ?? 0;
  }

  async function last_messages(cid: string) {
    const [raw] = await wa.engine.list(`/chat/${cid}/message`, 0, 1);
    const parsed = deserialize<{ id: string; me: boolean; created_at: number }>(raw ?? null);
    return parsed
      ? [{ key: { remoteJid: cid, id: parsed.id, fromMe: parsed.me }, messageTimestamp: Math.floor(parsed.created_at / 1000) }]
      : [];
  }

  /**
   * Cuenta los chats fijados distintos del indicado, cortando al llegar al máximo.
   * Counts pinned chats other than the given one, stopping once the max is reached.
   */
  async function count_pinned(exclude: string): Promise<number> {
    let total = 0;
    for (let offset = 0; total < MAX_PINNED; offset += 200) {
      const page = await wa.engine.list('/chat', offset, 200);
      if (page.length === 0) {
        break;
      }
      for (const raw of page) {
        const parsed = deserialize<Chat['_raw']>(raw);
        if (parsed && parsed.id !== exclude && parsed.pinned != null) {
          total++;
        }
      }
    }
    return total;
  }

  /**
   * Participantes del grupo memoizados 15s, para no repetir `groupMetadata` en cada página.
   * Group participants memoized for 15s, avoiding a `groupMetadata` round-trip per page.
   */
  const groups_cache = new Map<string, Promise<{ participants: { id: string }[]; desc?: string | null }>>();
  function group_meta(jid: string): Promise<{ participants: { id: string }[]; desc?: string | null }> {
    if (!groups_cache.has(jid)) {
      const socket = internals(wa).socket;
      groups_cache.set(
        jid,
        socket ? socket.groupMetadata(jid).catch(() => ({ participants: [] })) : Promise.resolve({ participants: [] })
      );
      setTimeout(() => groups_cache.delete(jid), 15_000);
    }
    return groups_cache.get(jid)!;
  }

  /**
   * Contacto desde el engine, o ficha mínima local cuando no está persistido (sin red).
   * Contact from the engine, or a minimal local card when not persisted (no network).
   */
  async function load_contact(id: string): Promise<InstanceType<typeof wa.Contact>> {
    const cached = deserialize<Contact['_raw']>(await wa.engine.get(`/contact/${id}`));
    return new wa.Contact(cached ?? { id });
  }

  return class _Chat extends Chat {
    /**
     * Participantes del chat: los integrantes en grupos, el contacto y yo en 1:1.
     * Chat participants: members for groups, the contact and myself for 1:1.
     *
     * @param offset - Desplazamiento / Offset
     * @param limit - Tamaño de página / Page size
     * @returns Página de contactos / Contact page
     */
    async members(offset = 0, limit = 50): Promise<InstanceType<typeof wa.Contact>[]> {
      const ids =
        this.type === 'group'
          ? (await group_meta(this._raw.id)).participants.map((participant) => participant.id)
          : [this._raw.id, internals(wa).socket?.user?.id].filter((id): id is string => Boolean(id));
      return Promise.all(ids.slice(offset, offset + limit).map(load_contact));
    }

    /**
     * Descripción del chat: el asunto del grupo o, en un 1:1, la bio del contacto.
     * Es asíncrono porque ninguno de los dos vive en el documento del chat.
     * Chat description: the group's subject or, on a 1:1, the contact's bio. It is async
     * because neither of them lives in the chat document.
     *
     * @returns Descripción, o cadena vacía si no hay / Description, or an empty string when absent
     */
    async content(): Promise<string> {
      if (this.type === 'group') {
        return (await group_meta(this._raw.id)).desc ?? '';
      }
      return deserialize<Contact['_raw']>(await wa.engine.get(`/contact/${this._raw.id}`))?.status ?? '';
    }

    /**
     * Mensajes del chat paginados desde el más reciente.
     * Chat messages paginated from the most recent one.
     *
     * @param offset - Desplazamiento / Offset
     * @param limit - Tamaño de página / Page size
     * @returns Página de mensajes / Message page
     */
    async messages(offset = 0, limit = 50): Promise<Message[]> {
      return Message.list(wa, this._raw.id, offset, limit);
    }

    /**
     * Activa o desactiva el indicador «escribiendo…».
     * Toggles the "typing…" indicator.
     *
     * @param value - true activa, false vuelve a pausa / true enables, false returns to paused
     * @returns true si el socket estaba disponible / true when the socket was available
     */
    async typing(value: boolean): Promise<boolean> {
      let ok = false;
      const socket = internals(wa).socket;
      if (socket) {
        await socket.sendPresenceUpdate(value ? 'composing' : 'paused', this._raw.id);
        ok = true;
      }
      return ok;
    }

    /**
     * Activa o desactiva el indicador «grabando audio…».
     * Toggles the "recording audio…" indicator.
     *
     * @param value - true activa, false vuelve a pausa / true enables, false returns to paused
     * @returns true si el socket estaba disponible / true when the socket was available
     */
    async recording(value: boolean): Promise<boolean> {
      let ok = false;
      const socket = internals(wa).socket;
      if (socket) {
        await socket.sendPresenceUpdate(value ? 'recording' : 'paused', this._raw.id);
        ok = true;
      }
      return ok;
    }

    /**
     * Archiva o desarchiva el chat en la cuenta de WhatsApp.
     * Archives or unarchives the chat on the WhatsApp account.
     *
     * @param value - true archiva, false desarchiva / true archives, false unarchives
     * @returns true si la acción se envió / true when the action was sent
     */
    async archive(value: boolean): Promise<boolean> {
      let ok = false;
      const socket = internals(wa).socket;
      if (socket) {
        await socket.chatModify({ archive: value, lastMessages: await last_messages(this._raw.id) }, this._raw.id);
        this._raw.archived = value;
        await wa.engine.set(`/chat/${this._raw.id}`, serialize(this._raw), this._raw.activity ?? (await activity_of(this._raw.id)));
        ok = true;
      }
      return ok;
    }

    /**
     * Fija o desfija el chat en la cuenta de WhatsApp. WhatsApp acepta hasta 3 chats
     * fijados y descarta el cuarto sin avisar, así que el límite se verifica antes.
     * Pins or unpins the chat on the WhatsApp account. WhatsApp accepts up to 3 pinned
     * chats and silently drops the fourth, so the limit is checked beforehand.
     *
     * @param value - true fija, false desfija / true pins, false unpins
     * @returns false si el socket está caído o ya hay 3 chats fijados / false when the socket is down or 3 chats are already pinned
     */
    async pin(value: boolean): Promise<boolean> {
      let ok = false;
      const socket = internals(wa).socket;
      if (socket) {
        const allowed = value ? (await count_pinned(this._raw.id)) < MAX_PINNED : true;
        if (allowed) {
          await socket.chatModify({ pin: value }, this._raw.id);
          this._raw.pinned = value ? Date.now() : null;
          await wa.engine.set(`/chat/${this._raw.id}`, serialize(this._raw), this._raw.activity ?? (await activity_of(this._raw.id)));
          ok = true;
        }
      }
      return ok;
    }

    /**
     * Silencia el chat hasta la fecha indicada. `false` o una fecha pasada lo des-silencian.
     * Mutes the chat until the given date. `false` or a past date unmutes it.
     *
     * @param until - Fecha límite (ISO, epoch ms o Date) o false / Deadline (ISO, epoch ms or Date) or false
     * @returns true si la acción se envió / true when the action was sent
     */
    async mute(until: string | number | Date | false): Promise<boolean> {
      let ok = false;
      const socket = internals(wa).socket;
      if (socket) {
        const end = until === false ? 0 : new Date(until).getTime();
        const muted = end > Date.now();
        await socket.chatModify({ mute: muted ? end : null }, this._raw.id);
        this._raw.mute_end_time = muted ? end : null;
        await wa.engine.set(`/chat/${this._raw.id}`, serialize(this._raw), this._raw.activity ?? (await activity_of(this._raw.id)));
        ok = true;
      }
      return ok;
    }

    /**
     * Marca el chat completo como leído en la cuenta de WhatsApp.
     * Marks the whole chat as read on the WhatsApp account.
     *
     * @returns true si la acción se envió / true when the action was sent
     */
    async seen(): Promise<boolean> {
      let ok = false;
      const socket = internals(wa).socket;
      if (socket) {
        await socket.chatModify({ markRead: true, lastMessages: await last_messages(this._raw.id) }, this._raw.id);
        this._raw.unread_count = 0;
        await wa.engine.set(`/chat/${this._raw.id}`, serialize(this._raw), this._raw.activity ?? (await activity_of(this._raw.id)));
        ok = true;
      }
      return ok;
    }

    /**
     * Vacía los mensajes del chat en la cuenta de WhatsApp y en el engine, conservando el chat.
     * Clears the chat messages on the WhatsApp account and in the engine, keeping the chat.
     *
     * @returns true siempre; la limpieza local es idempotente / always true; local cleanup is idempotent
     */
    async clear(): Promise<boolean> {
      const socket = internals(wa).socket;
      if (socket) {
        await socket
          .chatModify({ clear: true, lastMessages: await last_messages(this._raw.id) }, this._raw.id)
          .catch(() => null);
      }
      await wa.engine.unset(`/chat/${this._raw.id}/message`);
      return true;
    }

    /**
     * Elimina el chat y sus mensajes en la cuenta de WhatsApp y en el engine; en grupos
     * abandona el grupo.
     * Deletes the chat and its messages on the WhatsApp account and in the engine; for
     * groups it leaves the group.
     *
     * @returns true siempre; la limpieza local es idempotente / always true; local cleanup is idempotent
     */
    async delete(): Promise<boolean> {
      const socket = internals(wa).socket;
      if (socket) {
        if (this.type === 'group') {
          await socket.groupLeave(this._raw.id).catch(() => null);
        } else {
          await socket
            .chatModify({ delete: true, lastMessages: await last_messages(this._raw.id) }, this._raw.id)
            .catch(() => null);
        }
      }
      await wa.engine.unset(`/chat/${this._raw.id}`);
      return true;
    }

    /**
     * Carga un chat por teléfono, JID, LID o id de grupo: el persistido en el engine o,
     * si todavía no existe, una instancia mínima lista para usar (no se persiste).
     * Loads a chat by phone, JID, LID or group id: the engine-persisted one or, when it
     * does not exist yet, a minimal ready-to-use instance (not persisted).
     *
     * @param cid - Teléfono, JID, LID o id de grupo / Phone, JID, LID or group id
     * @returns Chat o null si el identificador es irresoluble / Chat or null when the identifier cannot be resolved
     */
    static async get(cid: string | number): Promise<_Chat | null> {
      const digits = String(cid).replace(/\D+/g, '');
      const jid = String(cid).includes('@')
        ? await internals(wa).resolve_jid(String(cid))
        : digits
          ? `${digits}@s.whatsapp.net`
          : null;
      if (jid) {
        const cached = deserialize<Chat['_raw']>(await wa.engine.get(`/chat/${jid}`));
        return new _Chat(cached ?? { id: jid });
      }
      return null;
    }

    /**
     * Pagina los chats persistidos, del más reciente al más antiguo.
     * Paginates persisted chats, from the most recent to the oldest.
     *
     * @param offset - Desplazamiento / Offset
     * @param limit - Tamaño de página / Page size
     * @returns Página de chats / Chat page
     */
    static async list(offset = 0, limit = 50): Promise<_Chat[]> {
      return (await wa.engine.list('/chat', offset, limit))
        .map((raw) => deserialize<Chat['_raw']>(raw))
        .filter((parsed): parsed is Chat['_raw'] => parsed !== null)
        .map((parsed) => new _Chat(parsed));
    }
  };
}
