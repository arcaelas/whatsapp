/**
 * @file chat/index.ts
 * @description Entidad Chat — conversaciones individuales y grupales.
 * Chat entity — individual and group conversations.
 */

import type { Message } from '~/lib/message';
import { deserialize, serialize } from '~/lib/store';
import type { WhatsApp } from '~/lib/whatsapp';

/**
 * Duración usada cuando `chat.mute(true)` silencia "siempre".
 * Duration used when `chat.mute(true)` means "mute forever".
 */
const MUTE_FOREVER_MS = 365 * 100 * 24 * 3_600 * 1_000;

/**
 * Participante de grupo.
 * Group participant.
 */
export interface GroupParticipant {
  id: string;
  admin: string | null;
}

/**
 * Shape persistido del chat (snake_case).
 * Persisted chat shape (snake_case).
 */
export interface IChatRaw {
  id: string;
  name?: string | null;
  display_name?: string | null;
  description?: string | null;
  unread_count?: number | null;
  read_only?: boolean | null;
  archived?: boolean | null;
  pinned?: number | null;
  mute_end_time?: number | null;
  marked_as_unread?: boolean | null;
  participants?: GroupParticipant[] | null;
  created_by?: string | null;
  created_at?: number | null;
  ephemeral_expiration?: number | null;
}

/**
 * Clase base del chat (forma pública, solo lectura).
 * Base Chat class (public shape, read-only).
 */
export class Chat {
  /** @internal Shape persistido. Uso interno. / Internal persisted shape. */
  readonly _raw: IChatRaw;

  constructor(raw: IChatRaw) {
    this._raw = raw;
  }

  /** JID del chat. / Chat JID. */
  get id(): string {
    return this._raw.id;
  }
  /** CID (alias). / CID (alias). */
  get cid(): string {
    return this._raw.id;
  }
  /** Tipo: contact o group. / Type: contact or group. */
  get type(): 'contact' | 'group' {
    return this._raw.id.endsWith('@g.us') ? 'group' : 'contact';
  }
  /** Nombre del chat. / Chat name. */
  get name(): string {
    return this._raw.name ?? this._raw.display_name ?? this._raw.id.split('@')[0];
  }
  /** Descripción del grupo. / Group description. */
  get content(): string {
    return this._raw.description ?? '';
  }
  /** Si está fijado. / Whether it's pinned. */
  get pinned(): boolean {
    return this._raw.pinned != null;
  }
  /** Si está archivado. / Whether it's archived. */
  get archived(): boolean {
    return this._raw.archived ?? false;
  }
  /** true si el chat está silenciado y el silencio aún no expira. / true if chat is muted and the mute has not expired. */
  get muted(): boolean {
    const end = this._raw.mute_end_time;
    return end != null && end > Date.now();
  }
  /** Si está leído. / Whether it's read. */
  get read(): boolean {
    return !this._raw.unread_count && !this._raw.marked_as_unread;
  }
  /** Si es solo lectura. / Whether it's read-only. */
  get readonly(): boolean {
    return this._raw.read_only ?? false;
  }
}

/**
 * Factoría de Chat ligada al contexto WhatsApp.
 * Context-bound Chat factory.
 *
 * @param wa - Instancia principal / Main WhatsApp instance
 */
export function chat(wa: WhatsApp) {
  /**
   * Obtiene la key del último mensaje para operaciones de chatModify que la requieren.
   * Fetches the last message key required by chatModify operations.
   */
  async function last_messages(
    cid: string
  ): Promise<
    Array<{ key: { remoteJid: string; id: string; fromMe: boolean }; messageTimestamp: number }>
  > {
    const [raw] = await wa.engine.list(`/chat/${cid}/message`, 0, 1);
    const parsed = deserialize<{ id: string; me: boolean; created_at: number }>(raw ?? null);
    return parsed
      ? [
        {
          key: { remoteJid: cid, id: parsed.id, fromMe: parsed.me },
          messageTimestamp: Math.floor(parsed.created_at / 1000),
        },
      ]
      : [];
  }

  return class _Chat extends Chat {
    /**
     * Obtiene un chat por CID. Si no está persistido, lo crea a partir del contacto.
     * Retrieves a chat by CID. If not persisted, creates it from the contact.
     */
    static async get(cid: string): Promise<_Chat | null> {
      let result: _Chat | null = null;
      const jid = await wa._resolve_jid(cid);
      if (jid) {
        const cached = deserialize<IChatRaw>(await wa.engine.get(`/chat/${jid}`));
        if (cached) {
          result = new _Chat(cached);
        } else {
          const c = await wa.Contact.get(jid);
          if (c) {
            const raw: IChatRaw = { id: jid, name: c.name };
            await wa.engine.set(`/chat/${jid}`, serialize(raw));
            result = new _Chat(raw);
          }
        }
      }
      return result;
    }

    /** Pagina los chats persistidos por mtime DESC. / Paginates persisted chats by mtime DESC. */
    static async list(offset = 0, limit = 50): Promise<_Chat[]> {
      const chats: _Chat[] = [];
      for (const raw of await wa.engine.list('/chat', offset, limit)) {
        const parsed = deserialize<IChatRaw>(raw);
        if (parsed) {
          chats.push(new _Chat(parsed));
        }
      }
      return chats;
    }

    /** Fija/desfija un chat por CID. / Pins or unpins a chat by CID. */
    static async pin(cid: string, value: boolean): Promise<boolean> {
      const c = await _Chat.get(cid);
      return c ? c.pin(value) : false;
    }

    /** Archiva/desarchiva un chat por CID. / Archives or unarchives a chat by CID. */
    static async archive(cid: string, value: boolean): Promise<boolean> {
      const c = await _Chat.get(cid);
      return c ? c.archive(value) : false;
    }

    /** Silencia/des-silencia un chat por CID. / Mutes or unmutes a chat by CID. */
    static async mute(cid: string, value: boolean): Promise<boolean> {
      const c = await _Chat.get(cid);
      return c ? c.mute(value) : false;
    }

    /** Marca todos los mensajes del chat como leídos. / Marks all chat messages as read. */
    static async seen(cid: string): Promise<boolean> {
      const c = await _Chat.get(cid);
      return c ? c.seen() : false;
    }

    /** Vacía mensajes del chat (local). / Clears the chat's messages (local only). */
    static async clear(cid: string): Promise<boolean> {
      const c = await _Chat.get(cid);
      return c ? c.clear() : false;
    }

    /** Elimina el chat y sus mensajes. / Deletes the chat and its messages. */
    static async delete(cid: string): Promise<boolean> {
      const c = await _Chat.get(cid);
      return c ? c.delete() : false;
    }

    /** Re-hidrata metadata del chat desde el socket. / Re-hydrates chat metadata from the socket. */
    async refresh(): Promise<this | null> {
      let ok = false;
      if (wa._socket) {
        if (this.type === 'group') {
          try {
            const meta = await wa._socket.groupMetadata(this.id);
            this._raw.name = meta.subject;
            this._raw.description = meta.desc ?? null;
            this._raw.participants = meta.participants.map((p) => ({
              id: p.id,
              admin: p.admin ?? null,
            }));
            this._raw.created_by = meta.owner ?? null;
            this._raw.created_at = meta.creation ?? null;
          } catch {
            /* group metadata may fail */
          }
        } else {
          const c = await wa.Contact.get(this.id);
          if (c) {
            await c.refresh();
            this._raw.name = c.name;
          }
        }
        await wa.engine.set(`/chat/${this.id}`, serialize(this._raw));
        ok = true;
      }
      return ok ? this : null;
    }

    /** Fija/desfija el chat. / Pins or unpins the chat. */
    async pin(value: boolean): Promise<boolean> {
      let ok = false;
      if (wa._socket) {
        await wa._socket.chatModify(
          { pin: value, lastMessages: await last_messages(this.id) },
          this.id
        );
        this._raw.pinned = value ? Date.now() : null;
        await wa.engine.set(`/chat/${this.id}`, serialize(this._raw));
        ok = true;
      }
      return ok;
    }

    /** Archiva/desarchiva el chat. / Archives or unarchives the chat. */
    async archive(value: boolean): Promise<boolean> {
      let ok = false;
      if (wa._socket) {
        await wa._socket.chatModify(
          { archive: value, lastMessages: await last_messages(this.id) },
          this.id
        );
        this._raw.archived = value;
        await wa.engine.set(`/chat/${this.id}`, serialize(this._raw));
        ok = true;
      }
      return ok;
    }

    /** Silencia/des-silencia el chat. / Mutes or unmutes the chat. */
    async mute(value: boolean): Promise<boolean> {
      let ok = false;
      if (wa._socket) {
        const mute_end = value === true ? Date.now() + MUTE_FOREVER_MS : null;
        await wa._socket.chatModify(
          { mute: mute_end, lastMessages: await last_messages(this.id) },
          this.id
        );
        this._raw.mute_end_time = mute_end;
        await wa.engine.set(`/chat/${this.id}`, serialize(this._raw));
        ok = true;
      }
      return ok;
    }

    /** Marca todos los mensajes del chat como leídos. / Marks all chat messages as read. */
    async seen(): Promise<boolean> {
      let ok = false;
      if (wa._socket) {
        const last = await last_messages(this.id);
        if (last.length > 0) {
          const msg = last[0];
          await wa._socket.readMessages([
            {
              remoteJid: this.id,
              id: msg.key.id,
              participant: msg.key.fromMe ? undefined : msg.key.remoteJid,
            },
          ]);
          this._raw.unread_count = 0;
          this._raw.marked_as_unread = false;
          await wa.engine.set(`/chat/${this.id}`, serialize(this._raw));
          ok = true;
        }
      }
      return ok;
    }

    /** Toggle "Escribiendo...". / Toggles the "typing..." indicator. */
    async typing(on: boolean): Promise<boolean> {
      let ok = false;
      if (wa._socket) {
        await wa._socket.sendPresenceUpdate(on ? 'composing' : 'paused', this.id);
        ok = true;
      }
      return ok;
    }

    /** Toggle "Grabando audio...". / Toggles the "recording audio..." indicator. */
    async recording(on: boolean): Promise<boolean> {
      let ok = false;
      if (wa._socket) {
        await wa._socket.sendPresenceUpdate(on ? 'recording' : 'paused', this.id);
        ok = true;
      }
      return ok;
    }

    /** Vacía mensajes del chat (engine local). / Clears chat messages (local engine). */
    async clear(): Promise<boolean> {
      await wa.engine.unset(`/chat/${this.id}/message`);
      return true;
    }

    /** Elimina el chat y sus mensajes (remoto + local). / Deletes the chat and its messages (remote + local). */
    async delete(): Promise<boolean> {
      if (wa._socket) {
        if (this.type === 'group') {
          try {
            await wa._socket.groupLeave(this.id);
          } catch {
            /* may fail */
          }
        } else {
          try {
            await wa._socket.chatModify({ delete: true, lastMessages: [] }, this.id);
          } catch {
            /* may fail */
          }
        }
      }
      await this.clear();
      await wa.engine.unset(`/chat/${this.id}`);
      return true;
    }

    /** Participantes del chat paginados (incluyéndome en grupos). / Chat participants paginated (self included in groups). */
    async members(offset = 0, limit = 50): Promise<InstanceType<typeof wa.Contact>[]> {
      const result: InstanceType<typeof wa.Contact>[] = [];
      if (this.type !== 'group') {
        if (offset === 0 && limit > 0) {
          const c = await wa.Contact.get(this.id);
          if (c) {
            result.push(c);
          }
        }
      } else if (wa._socket) {
        try {
          const meta = await wa._socket.groupMetadata(this.id);
          const slice = meta.participants.slice(offset, offset + limit);
          for (const p of slice) {
            const existing = await wa.Contact.get(p.id);
            if (existing) {
              result.push(existing);
            }
          }
        } catch {
          /* may fail */
        }
      }
      return result;
    }

    /** Mensajes del chat paginados por mtime DESC. / Chat messages paginated by mtime DESC. */
    async messages(offset = 0, limit = 50): Promise<Message[]> {
      return wa.Message.list(this.id, offset, limit);
    }
  };
}
