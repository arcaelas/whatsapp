/**
 * @file Chat.ts
 * @description Clase Chat para gestión de conversaciones de WhatsApp
 */

import { BufferJSON } from 'baileys';
import type { WhatsApp } from './WhatsApp';

/**
 * @description Participante de grupo.
 */
export interface IGroupParticipant {
    /** JID del participante */
    id: string;
    /** Rol de admin: null, 'admin', 'superadmin' */
    admin: string | null;
}

/**
 * @description Objeto raw del chat (protocolo).
 */
export interface IChatRaw {
    /** JID único del chat */
    id: string;
    /** Nombre del chat o grupo */
    name?: string | null;
    /** Nombre alternativo para mostrar */
    displayName?: string | null;
    /** Descripción del grupo */
    description?: string | null;
    /** Cantidad de mensajes no leídos */
    unreadCount?: number | null;
    /** Si el chat es de solo lectura */
    readOnly?: boolean | null;
    /** Si el chat está archivado */
    archived?: boolean | null;
    /** Timestamp cuando se fijó el chat */
    pinned?: number | null;
    /** Timestamp cuando expira el silencio */
    muteEndTime?: number | null;
    /** Si fue marcado manualmente como no leído */
    markedAsUnread?: boolean | null;
    /** Lista de participantes del grupo */
    participant?: IGroupParticipant[] | null;
    /** JID del creador del grupo */
    createdBy?: string | null;
    /** Timestamp de creación */
    createdAt?: number | null;
    /** Duración de mensajes temporales (segundos) */
    ephemeralExpiration?: number | null;
}

/**
 * @description Datos persistidos de un chat.
 */
export interface IChat {
    /** JID del chat (ej: 123456@s.whatsapp.net o grupo@g.us) */
    id: string;
    /** Tipo de chat: contacto individual o grupo */
    type: 'contact' | 'group';
    /** Nombre del chat o contacto */
    name: string;
    /** Descripción del chat/grupo */
    content: string;
    /** Si está fijado */
    pined: boolean;
    /** Si está archivado */
    archived: boolean;
    /** Timestamp cuando expira el silencio o false */
    muted: number | false;
    /** Si está leído */
    readed: boolean;
    /** Si es solo lectura */
    readonly: boolean;
    /** Etiquetas del chat */
    labels: string[];
    /** Objeto raw del protocolo */
    raw: IChatRaw;
}

/**
 * @description Construye IChat desde raw.
 * @param raw Objeto raw del chat.
 * @returns IChat normalizado.
 */
export function build_chat(raw: IChatRaw): IChat {
    return {
        id: raw.id,
        type: raw.id.endsWith('@g.us') ? 'group' : 'contact',
        name: raw.name ?? raw.displayName ?? raw.id.split('@')[0],
        content: raw.description ?? '',
        pined: raw.pinned !== null && raw.pinned !== undefined,
        archived: raw.archived ?? false,
        muted: raw.muteEndTime ?? false,
        readed: (raw.unreadCount === 0 || raw.unreadCount === null) && !raw.markedAsUnread,
        readonly: raw.readOnly ?? false,
        labels: [],
        raw,
    };
}

/**
 * @description
 * Clase base para representar una conversación de WhatsApp.
 * Usar Chat.get() para obtener instancias.
 */
export class Chat {
    readonly raw: IChatRaw;

    constructor(data: IChat) {
        this.raw = data.raw;
    }

    /** JID único del chat */
    get id(): string {
        return this.raw.id;
    }

    /** Tipo de chat */
    get type(): 'contact' | 'group' {
        return this.raw.id.endsWith('@g.us') ? 'group' : 'contact';
    }

    /** Nombre del chat */
    get name(): string {
        return this.raw.name ?? this.raw.displayName ?? this.raw.id.split('@')[0];
    }

    /** Descripción del chat/grupo */
    get content(): string {
        return this.raw.description ?? '';
    }

    /** Si está fijado */
    get pined(): boolean {
        return this.raw.pinned !== null && this.raw.pinned !== undefined;
    }

    /** Si está archivado */
    get archived(): boolean {
        return this.raw.archived ?? false;
    }

    /** Timestamp cuando expira el silencio o false */
    get muted(): number | false {
        return this.raw.muteEndTime ?? false;
    }

    /** Si está leído */
    get readed(): boolean {
        return (this.raw.unreadCount === 0 || this.raw.unreadCount === null) && !this.raw.markedAsUnread;
    }

    /** Si es solo lectura */
    get readonly(): boolean {
        return this.raw.readOnly ?? false;
    }
}

/**
 * @description Factory que retorna la clase Chat enlazada al contexto.
 * @param wa Instancia de WhatsApp.
 * @returns Clase _Chat que extiende Chat.
 */
export function chat(wa: WhatsApp) {
    /** Obtiene el último mensaje raw del chat para chatModify */
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
         * @param cid ID del chat (JID).
         * @returns Chat o null si no existe.
         */
        static async get(cid: string) {
            const stored = await wa.engine.get(`chat/${cid}/index`);
            if (stored) return new _Chat(JSON.parse(stored, BufferJSON.reviver));

            const contact = await wa.Contact.get(cid);
            if (!contact) return null;

            const raw: IChatRaw = { id: cid, name: contact.name };
            const data = build_chat(raw);
            await wa.engine.set(`chat/${cid}/index`, JSON.stringify(data, BufferJSON.replacer));
            return new _Chat(data);
        }

        /**
         * @description Actualiza los datos del chat desde WhatsApp.
         * @param cid ID del chat.
         * @returns Chat actualizado o null.
         */
        static async refresh(cid: string) {
            if (!wa.socket) return null;

            const stored = await wa.engine.get(`chat/${cid}/index`);
            const data: IChat = stored ? JSON.parse(stored, BufferJSON.reviver) : build_chat({ id: cid });

            // Para grupos, obtener metadata actualizada
            if (cid.endsWith('@g.us')) {
                try {
                    const meta = await wa.socket.groupMetadata(cid);
                    data.raw.name = meta.subject;
                    data.raw.description = meta.desc ?? null;
                    data.raw.participant = meta.participants.map((p) => ({ id: p.id, admin: p.admin ?? null }));
                    data.raw.createdBy = meta.owner ?? null;
                    data.raw.createdAt = meta.creation ?? null;
                    data.name = meta.subject;
                    data.content = meta.desc ?? '';
                } catch {}
            } else {
                // Para contactos individuales, actualizar desde Contact
                const contact = await wa.Contact.refresh(cid);
                if (contact) {
                    data.raw.name = contact.name;
                    data.name = contact.name;
                }
            }

            await wa.engine.set(`chat/${cid}/index`, JSON.stringify(data, BufferJSON.replacer));
            return new _Chat(data);
        }

        /**
         * @description Obtiene chats paginados.
         * @param offset Inicio de paginación.
         * @param limit Cantidad máxima de resultados.
         * @returns Array de chats.
         */
        static async paginate(offset = 0, limit = 50) {
            const chats: InstanceType<typeof _Chat>[] = [];
            for (const key of await wa.engine.list('chat/', offset, limit, '/index')) {
                const stored = await wa.engine.get(key);
                if (stored) chats.push(new _Chat(JSON.parse(stored, BufferJSON.reviver)));
            }
            return chats;
        }

        /**
         * @description Fija o desfija un chat.
         * @param cid ID del chat.
         * @param value true para fijar, false para desfijar.
         * @returns true si se actualizó correctamente.
         */
        static async pin(cid: string, value: boolean): Promise<boolean> {
            if (!wa.socket) return false;
            const last_messages = await _last_messages(cid);
            await wa.socket.chatModify({ pin: value, lastMessages: last_messages }, cid);

            const stored = await wa.engine.get(`chat/${cid}/index`);
            if (!stored) return true;

            const data: IChat = JSON.parse(stored, BufferJSON.reviver);
            data.raw.pinned = value ? Date.now() : null;
            data.pined = value;
            await wa.engine.set(`chat/${cid}/index`, JSON.stringify(data, BufferJSON.replacer));
            return true;
        }

        /**
         * @description Archiva o desarchiva un chat.
         * @param cid ID del chat.
         * @param value true para archivar, false para desarchivar.
         * @returns true si se actualizó correctamente.
         */
        static async archive(cid: string, value: boolean): Promise<boolean> {
            if (!wa.socket) return false;
            const last_messages = await _last_messages(cid);
            await wa.socket.chatModify({ archive: value, lastMessages: last_messages }, cid);

            const stored = await wa.engine.get(`chat/${cid}/index`);
            if (!stored) return true;

            const data: IChat = JSON.parse(stored, BufferJSON.reviver);
            data.raw.archived = value;
            data.archived = value;
            await wa.engine.set(`chat/${cid}/index`, JSON.stringify(data, BufferJSON.replacer));
            return true;
        }

        /**
         * @description Silencia o quita silencio de un chat.
         * @param cid ID del chat.
         * @param duration Duración en milisegundos (0 o null para quitar silencio).
         * @returns true si se actualizó correctamente.
         */
        static async mute(cid: string, duration: number | null): Promise<boolean> {
            if (!wa.socket) return false;
            const mute_end = duration ? Date.now() + duration : null;
            const last_messages = await _last_messages(cid);
            await wa.socket.chatModify({ mute: mute_end, lastMessages: last_messages }, cid);

            const stored = await wa.engine.get(`chat/${cid}/index`);
            if (!stored) return true;

            const data: IChat = JSON.parse(stored, BufferJSON.reviver);
            data.raw.muteEndTime = mute_end;
            data.muted = mute_end ?? false;
            await wa.engine.set(`chat/${cid}/index`, JSON.stringify(data, BufferJSON.replacer));
            return true;
        }

        /**
         * @description Marca un chat como leído.
         * @param cid ID del chat.
         * @returns true si se marcó correctamente.
         */
        static async seen(cid: string): Promise<boolean> {
            if (!wa.socket) return false;

            const last_messages = await _last_messages(cid);
            if (!last_messages.length) return false;

            const msg = last_messages[0];
            await wa.socket.readMessages([{ remoteJid: cid, id: msg.key.id, participant: msg.key.fromMe ? undefined : msg.key.remoteJid }]);

            // Actualizar estado del chat
            const stored = await wa.engine.get(`chat/${cid}/index`);
            if (stored) {
                const data: IChat = JSON.parse(stored, BufferJSON.reviver);
                data.raw.unreadCount = 0;
                data.raw.markedAsUnread = false;
                data.readed = true;
                await wa.engine.set(`chat/${cid}/index`, JSON.stringify(data, BufferJSON.replacer));
            }
            return true;
        }

        /**
         * @description Limpia todos los datos del chat del storage (cascade delete).
         * @param cid ID del chat.
         */
        static async cascade_delete(cid: string): Promise<void> {
            await wa.engine.delete_prefix(`chat/${cid}/`);
        }

        /**
         * @description Elimina un chat con cascade delete.
         * @param cid ID del chat.
         * @returns true si se eliminó correctamente.
         */
        static async remove(cid: string): Promise<boolean> {
            if (!wa.socket) return false;

            const stored = await wa.engine.get(`chat/${cid}/index`);
            if (!stored) return false;

            const data: IChat = JSON.parse(stored, BufferJSON.reviver);
            if (data.type === 'group') {
                await wa.socket.groupLeave(cid);
            } else {
                await wa.socket.chatModify({ delete: true, lastMessages: [] }, cid);
            }

            await _Chat.cascade_delete(cid);
            return true;
        }

        /**
         * @description Agrega un mensaje al índice del chat.
         * @param cid ID del chat.
         * @param mid ID del mensaje.
         * @param timestamp Timestamp de creación.
         */
        static async add_message(cid: string, mid: string, timestamp: number): Promise<void> {
            const key = `chat/${cid}/messages`;
            const line = `${timestamp} ${mid}`;
            const current = await wa.engine.get(key);
            await wa.engine.set(key, current ? `${line}\n${current}` : line);
        }

        /**
         * @description Elimina un mensaje del índice del chat.
         * @param cid ID del chat.
         * @param mid ID del mensaje.
         */
        static async remove_message(cid: string, mid: string): Promise<void> {
            const key = `chat/${cid}/messages`;
            const content = await wa.engine.get(key);
            if (!content) return;

            const filtered = content
                .trim()
                .split('\n')
                .filter((line) => !line.endsWith(` ${mid}`))
                .join('\n');

            await wa.engine.set(key, filtered || null);
        }

        /**
         * @description Lista IDs de mensajes del chat (paginado).
         * @param cid ID del chat.
         * @param offset Inicio de paginación.
         * @param limit Cantidad máxima.
         * @returns Array de IDs de mensajes.
         */
        static async list_messages(cid: string, offset = 0, limit = 50): Promise<string[]> {
            const content = await wa.engine.get(`chat/${cid}/messages`);
            if (!content) return [];

            return content
                .trim()
                .split('\n')
                .slice(offset, offset + limit)
                .map((line) => line.split(' ')[1])
                .filter(Boolean);
        }

        /**
         * @description Cuenta mensajes del chat.
         * @param cid ID del chat.
         * @returns Cantidad de mensajes.
         */
        static async count_messages(cid: string): Promise<number> {
            const content = await wa.engine.get(`chat/${cid}/messages`);
            if (!content) return 0;
            return content.trim().split('\n').filter(Boolean).length;
        }

        /**
         * @description Obtiene los miembros de un chat.
         * @param cid ID del chat.
         * @param offset Inicio de paginación.
         * @param limit Cantidad máxima de resultados.
         * @returns Array de contactos.
         */
        static async members(cid: string, offset = 0, limit = 50): Promise<InstanceType<typeof wa.Contact>[]> {
            if (!cid.endsWith('@g.us') || !wa.socket) {
                const contact = await wa.Contact.get(cid);
                return contact ? [contact] : [];
            }

            const members: InstanceType<typeof wa.Contact>[] = [];
            for (const p of (await wa.socket.groupMetadata(cid)).participants.slice(offset, offset + limit)) {
                const existing = await wa.Contact.get(p.id);
                if (existing) {
                    members.push(existing);
                } else {
                    const raw: IContactRaw = { id: p.id };
                    const data = build_contact(raw);
                    await wa.engine.set(`contact/${p.id}/index`, JSON.stringify(data, BufferJSON.replacer));
                    members.push(new wa.Contact(data));
                }
            }
            return members;
        }

        /**
         * @description Obtiene mensajes del chat (paginados).
         * @param offset Inicio de paginación.
         * @param limit Cantidad máxima de resultados.
         * @returns Array de mensajes.
         */
        async messages(offset = 0, limit = 50): Promise<InstanceType<typeof wa.Message>[]> {
            const ids = await _Chat.list_messages(this.id, offset, limit);
            const messages: InstanceType<typeof wa.Message>[] = [];
            for (const mid of ids) {
                const msg = await wa.Message.get(this.id, mid);
                if (msg) messages.push(msg);
            }
            return messages;
        }

        /**
         * @description Actualiza los datos del chat desde WhatsApp.
         * @returns this con datos actualizados, o null si falla.
         */
        async refresh(): Promise<this | null> {
            const updated = await _Chat.refresh(this.id);
            if (!updated) return null;
            Object.assign(this.raw, updated.raw);
            return this;
        }
    };

    return _Chat;
}

// Import para la factory
import { build_contact, type IContactRaw } from './Contact';
