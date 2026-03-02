/**
 * @file Chat.ts
 * @description Clase Chat para gestión de conversaciones de WhatsApp
 */

import { BufferJSON } from 'baileys';
import type { WhatsApp } from '~/WhatsApp';

/**
 * @description Participante de grupo.
 * Group participant.
 */
export interface IGroupParticipant {
    /** JID del participante / Participant JID */
    id: string;
    /** Rol de admin: null, 'admin', 'superadmin' / Admin role */
    admin: string | null;
}

/**
 * @description Objeto raw del chat (protocolo).
 * Raw chat object (protocol).
 */
export interface IChatRaw {
    /** JID único del chat / Unique chat JID */
    id: string;
    /** Nombre del chat o grupo / Chat or group name */
    name?: string | null;
    /** Nombre alternativo para mostrar / Alternative display name */
    displayName?: string | null;
    /** Descripción del grupo / Group description */
    description?: string | null;
    /** Cantidad de mensajes no leídos / Unread message count */
    unreadCount?: number | null;
    /** Si el chat es de solo lectura / Whether the chat is read-only */
    readOnly?: boolean | null;
    /** Si el chat está archivado / Whether the chat is archived */
    archived?: boolean | null;
    /** Timestamp cuando se fijó el chat / Pin timestamp */
    pinned?: number | null;
    /** Timestamp cuando expira el silencio / Mute end timestamp */
    muteEndTime?: number | null;
    /** Si fue marcado manualmente como no leído / Whether manually marked as unread */
    markedAsUnread?: boolean | null;
    /** Lista de participantes del grupo / Group participant list */
    participant?: IGroupParticipant[] | null;
    /** JID del creador del grupo / Group creator JID */
    createdBy?: string | null;
    /** Timestamp de creación / Creation timestamp */
    createdAt?: number | null;
    /** Duración de mensajes temporales (segundos) / Ephemeral message duration (seconds) */
    ephemeralExpiration?: number | null;
}

/**
 * @description
 * Clase base para representar una conversación de WhatsApp.
 * Base class representing a WhatsApp conversation.
 */
export class Chat {
    constructor(readonly raw: IChatRaw) { }

    /** JID único del chat / Unique chat JID */
    get id(): string { return this.raw.id; }
    /** Tipo de chat / Chat type */
    get type(): 'contact' | 'group' { return this.raw.id.endsWith('@g.us') ? 'group' : 'contact'; }
    /** Nombre del chat / Chat name */
    get name(): string { return this.raw.name ?? this.raw.displayName ?? this.raw.id.split('@')[0]; }
    /** Descripción del chat/grupo / Chat/group description */
    get content(): string { return this.raw.description ?? ''; }
    /** Si está fijado / Whether it's pinned */
    get pined(): boolean { return this.raw.pinned !== null && this.raw.pinned !== undefined; }
    /** Si está archivado / Whether it's archived */
    get archived(): boolean { return this.raw.archived ?? false; }
    /** Timestamp cuando expira el silencio o false / Mute end timestamp or false */
    get muted(): number | false { return this.raw.muteEndTime ?? false; }
    /** Si está leído / Whether it's read */
    get readed(): boolean { return (this.raw.unreadCount === 0 || this.raw.unreadCount === null) && !this.raw.markedAsUnread; }
    /** Si es solo lectura / Whether it's read-only */
    get readonly(): boolean { return this.raw.readOnly ?? false; }
}

/**
 * @description Factory que retorna la clase Chat enlazada al contexto.
 * Factory that returns the Chat class bound to context.
 * @param wa Instancia de WhatsApp.
 */
export function chat(wa: WhatsApp) {
    async function _last_messages(cid: string): Promise<{ key: { remoteJid: string; id: string; fromMe: boolean }; messageTimestamp: number }[]> {
        const messages_index = await wa.engine.get(`chat/${cid}/messages`);
        if (!messages_index) return [];
        const first_line = messages_index.trim().split('\n')[0];
        if (!first_line) return [];
        const [timestamp, mid] = first_line.split(' ');
        const msg = await wa.Message.get(cid, mid);
        if (!msg) return [];
        return [{ key: { remoteJid: cid, id: msg.id, fromMe: msg.me }, messageTimestamp: Math.floor(Number(timestamp) / 1000) }];
    }

    const _Chat = class extends Chat {
        /**
         * @description Obtiene un chat por su ID.
         * Retrieves a chat by its ID.
         */
        static async get(cid: string) {
            const stored = await wa.engine.get(`chat/${cid}/index`);
            if (stored) return new _Chat(JSON.parse(stored, BufferJSON.reviver));

            const contact = await wa.Contact.get(cid);
            if (!contact) return null;

            const raw: IChatRaw = { id: cid, name: contact.name };
            await wa.engine.set(`chat/${cid}/index`, JSON.stringify(raw, BufferJSON.replacer));
            return new _Chat(raw);
        }

        /**
         * @description Obtiene chats paginados.
         * Retrieves paginated chats.
         */
        static async list(offset = 0, limit = 50) {
            const chats: InstanceType<typeof _Chat>[] = [];
            for (const key of await wa.engine.list('chat/', offset, limit)) {
                const stored = await wa.engine.get(key);
                if (stored) chats.push(new _Chat(JSON.parse(stored, BufferJSON.reviver)));
            }
            return chats;
        }

        /**
         * @description Fija o desfija un chat por su ID.
         * Pins or unpins a chat by its ID.
         */
        static async pin(cid: string, value: boolean): Promise<boolean> {
            const chat = await _Chat.get(cid);
            return chat ? chat.pin(value) : false;
        }

        /**
         * @description Archiva o desarchiva un chat por su ID.
         * Archives or unarchives a chat by its ID.
         */
        static async archive(cid: string, value: boolean): Promise<boolean> {
            const chat = await _Chat.get(cid);
            return chat ? chat.archive(value) : false;
        }

        /**
         * @description Silencia o quita silencio de un chat por su ID.
         * Mutes or unmutes a chat by its ID.
         */
        static async mute(cid: string, duration: number | null): Promise<boolean> {
            const chat = await _Chat.get(cid);
            return chat ? chat.mute(duration) : false;
        }

        /**
         * @description Marca un chat como leido por su ID.
         * Marks a chat as read by its ID.
         */
        static async seen(cid: string): Promise<boolean> {
            const chat = await _Chat.get(cid);
            return chat ? chat.seen() : false;
        }

        /**
         * @description Elimina un chat por su ID.
         * Removes a chat by its ID.
         */
        static async remove(cid: string): Promise<boolean> {
            const chat = await _Chat.get(cid);
            return chat ? chat.remove() : false;
        }

        /**
         * @description Actualiza los datos del chat desde WhatsApp.
         * Refreshes chat data from WhatsApp.
         */
        async refresh(): Promise<this | null> {
            if (!wa.socket) return null;
            if (this.id.endsWith('@g.us')) {
                try {
                    const meta = await wa.socket.groupMetadata(this.id);
                    this.raw.name = meta.subject;
                    this.raw.description = meta.desc ?? null;
                    this.raw.participant = meta.participants.map((p) => ({ id: p.id, admin: p.admin ?? null }));
                    this.raw.createdBy = meta.owner ?? null;
                    this.raw.createdAt = meta.creation ?? null;
                } catch { /* group metadata may fail */ }
            } else {
                const contact = await wa.Contact.get(this.id);
                if (contact) {
                    await contact.refresh();
                    this.raw.name = contact.name;
                }
            }
            await wa.engine.set(`chat/${this.id}/index`, JSON.stringify(this.raw, BufferJSON.replacer));
            return this;
        }

        /**
         * @description Elimina el chat con cascade delete.
         * Deletes the chat with cascade delete.
         */
        async remove(): Promise<boolean> {
            if (!wa.socket) return false;
            if (this.type === 'group') await wa.socket.groupLeave(this.id);
            else await wa.socket.chatModify({ delete: true, lastMessages: [] }, this.id);
            await wa.engine.set(`chat/${this.id}`, null);
            return true;
        }

        /**
         * @description Fija o desfija el chat.
         * Pins or unpins the chat.
         */
        async pin(value: boolean): Promise<boolean> {
            if (!wa.socket) return false;
            const last_messages = await _last_messages(this.id);
            await wa.socket.chatModify({ pin: value, lastMessages: last_messages }, this.id);
            this.raw.pinned = value ? Date.now() : null;
            await wa.engine.set(`chat/${this.id}/index`, JSON.stringify(this.raw, BufferJSON.replacer));
            return true;
        }

        /**
         * @description Archiva o desarchiva el chat.
         * Archives or unarchives the chat.
         */
        async archive(value: boolean): Promise<boolean> {
            if (!wa.socket) return false;
            const last_messages = await _last_messages(this.id);
            await wa.socket.chatModify({ archive: value, lastMessages: last_messages }, this.id);
            this.raw.archived = value;
            await wa.engine.set(`chat/${this.id}/index`, JSON.stringify(this.raw, BufferJSON.replacer));
            return true;
        }

        /**
         * @description Silencia o quita silencio del chat.
         * Mutes or unmutes the chat.
         * @param duration Duración en ms (0 o null para quitar silencio) / Duration in ms (0 or null to unmute).
         */
        async mute(duration: number | null): Promise<boolean> {
            if (!wa.socket) return false;
            const mute_end = duration ? Date.now() + duration : null;
            const last_messages = await _last_messages(this.id);
            await wa.socket.chatModify({ mute: mute_end, lastMessages: last_messages }, this.id);
            this.raw.muteEndTime = mute_end;
            await wa.engine.set(`chat/${this.id}/index`, JSON.stringify(this.raw, BufferJSON.replacer));
            return true;
        }

        /**
         * @description Marca el chat como leído.
         * Marks the chat as read.
         */
        async seen(): Promise<boolean> {
            if (!wa.socket) return false;
            const last_messages = await _last_messages(this.id);
            if (!last_messages.length) return false;
            const msg = last_messages[0];
            await wa.socket.readMessages([{ remoteJid: this.id, id: msg.key.id, participant: msg.key.fromMe ? undefined : msg.key.remoteJid }]);
            this.raw.unreadCount = 0;
            this.raw.markedAsUnread = false;
            await wa.engine.set(`chat/${this.id}/index`, JSON.stringify(this.raw, BufferJSON.replacer));
            return true;
        }

        /**
         * @description Obtiene los miembros del chat.
         * Gets chat members.
         */
        async members(offset = 0, limit = 50): Promise<InstanceType<typeof wa.Contact>[]> {
            if (!this.id.endsWith('@g.us') || !wa.socket) {
                const contact = await wa.Contact.get(this.id);
                return contact ? [contact] : [];
            }
            const members: InstanceType<typeof wa.Contact>[] = [];
            for (const p of (await wa.socket.groupMetadata(this.id)).participants.slice(offset, offset + limit)) {
                const existing = await wa.Contact.get(p.id);
                if (existing) {
                    members.push(existing);
                } else {
                    const raw = { id: p.id };
                    await wa.engine.set(`contact/${p.id}/index`, JSON.stringify(raw, BufferJSON.replacer));
                    members.push(new wa.Contact(raw));
                }
            }
            return members;
        }

        /**
         * @description Obtiene mensajes del chat (paginados).
         * Gets chat messages (paginated).
         */
        async messages(offset = 0, limit = 50): Promise<InstanceType<typeof wa.Message>[]> {
            return wa.Message.list(this.id, offset, limit);
        }

        /**
         * @description Obtiene el contacto asociado al chat (solo chats individuales).
         * Gets the contact associated with the chat (individual chats only).
         */
        async contact(): Promise<InstanceType<typeof wa.Contact> | null> {
            if (this.type === 'group') return null;
            return wa.Contact.get(this.id);
        }
    };

    return _Chat;
}
