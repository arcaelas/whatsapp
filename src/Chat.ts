/**
 * @file Chat.ts
 * @description Clase Chat para gestión de conversaciones de WhatsApp
 */

import { BufferJSON } from 'baileys';
import type { IContact } from './Contact';
import type { WhatsApp } from './WhatsApp';

/**
 * @description Datos persistidos de un chat.
 */
export interface IChat {
    /** JID del chat (ej: 123456@s.whatsapp.net o grupo@g.us) */
    id: string;
    /** Nombre del chat o contacto */
    name: string;
    /** Tipo de chat: contacto individual o grupo */
    type: 'contact' | 'group';
    /** Timestamp cuando se fijó o null si no está fijado */
    pined: number | null;
    /** true si el chat está archivado */
    archived: boolean;
    /** Timestamp cuando expira el silencio o null si no está silenciado */
    muted: number | null;
}

/**
 * @description
 * Clase base para representar una conversación de WhatsApp.
 * Usar Chat.get() para obtener instancias.
 */
export class Chat {
    readonly id: string;
    name: string;
    type: 'contact' | 'group';
    pined: number | null;
    archived: boolean;
    muted: number | null;

    constructor(data: IChat) {
        this.id = data.id;
        this.name = data.name;
        this.type = data.type;
        this.pined = data.pined;
        this.archived = data.archived;
        this.muted = data.muted;
    }
}

/**
 * @description Factory que retorna la clase Chat enlazada al contexto.
 * @param wa Instancia de WhatsApp.
 * @returns Clase _Chat que extiende Chat.
 */
export function chat(wa: WhatsApp) {
    return class _Chat extends Chat {
        /**
         * @description Obtiene un chat por su ID.
         * @param cid ID del chat (JID).
         * @returns Chat o null si no existe.
         */
        static async get(cid: string): Promise<_Chat | null> {
            const stored = await wa.engine.get(`chat/${cid}/index`);
            if (stored) return new _Chat(JSON.parse(stored, BufferJSON.reviver));

            const contact = await wa.Contact.get(cid);
            if (!contact) return null;

            const data: IChat = {
                id: cid,
                name: contact.name,
                type: cid.endsWith('@g.us') ? 'group' : 'contact',
                pined: null,
                archived: false,
                muted: null,
            };
            await wa.engine.set(`chat/${cid}/index`, JSON.stringify(data, BufferJSON.replacer));
            return new _Chat(data);
        }

        /**
         * @description Fija o desfija un chat.
         * @param cid ID del chat.
         * @param value true para fijar, false para desfijar.
         * @returns true si se actualizó correctamente.
         */
        static async pin(cid: string, value: boolean): Promise<boolean> {
            if (!wa.socket) return false;
            await wa.socket.chatModify({ pin: value }, cid);
            const chat = await _Chat.get(cid);
            if (!chat) return true;
            chat.pined = value ? Date.now() : null;
            await wa.engine.set(`chat/${cid}/index`, JSON.stringify(chat, BufferJSON.replacer));
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
            await wa.socket.chatModify({ archive: value, lastMessages: [] }, cid);
            const chat = await _Chat.get(cid);
            if (!chat) return true;
            chat.archived = value;
            await wa.engine.set(`chat/${cid}/index`, JSON.stringify(chat, BufferJSON.replacer));
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
            await wa.socket.chatModify({ mute: mute_end }, cid);
            const chat = await _Chat.get(cid);
            if (!chat) return true;
            chat.muted = mute_end;
            await wa.engine.set(`chat/${cid}/index`, JSON.stringify(chat, BufferJSON.replacer));
            return true;
        }

        /**
         * @description Marca un chat como leído.
         * @param cid ID del chat.
         * @returns true si se marcó correctamente.
         */
        static async seen(cid: string): Promise<boolean> {
            if (!wa.socket) return false;

            const index_key = (await wa.engine.list(`chat/${cid}/message/`, 0, 1)).find((k) => k.endsWith('/index'));
            if (!index_key) return false;

            const stored = await wa.engine.get(index_key);
            if (!stored) return false;

            const msg = JSON.parse(stored, BufferJSON.reviver);
            await wa.socket.readMessages([{ remoteJid: cid, id: msg.id, participant: msg.me ? undefined : cid }]);
            return true;
        }

        /**
         * @description Elimina un chat.
         * @param cid ID del chat.
         * @returns true si se eliminó correctamente.
         */
        static async remove(cid: string): Promise<boolean> {
            if (!wa.socket) return false;

            const stored = await wa.engine.get(`chat/${cid}/index`);
            if (!stored) return false;

            if ((JSON.parse(stored, BufferJSON.reviver) as IChat).type === 'group') {
                await wa.socket.groupLeave(cid);
            } else {
                await wa.socket.chatModify({ delete: true, lastMessages: [] }, cid);
            }

            await wa.engine.set(`chat/${cid}/index`, null);
            return true;
        }

        /**
         * @description Obtiene los miembros de un chat.
         * @param cid ID del chat.
         * @param offset Inicio de paginación.
         * @param limit Cantidad máxima de resultados.
         * @returns Array de contactos.
         */
        static async members(cid: string, offset: number, limit: number): Promise<InstanceType<typeof wa.Contact>[]> {
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
                    const data: IContact = {
                        id: p.id,
                        me: false,
                        name: p.id.split('@')[0],
                        phone: p.id.split('@')[0],
                        photo: null,
                    };
                    await wa.engine.set(`contact/${p.id}/index`, JSON.stringify(data, BufferJSON.replacer));
                    members.push(new wa.Contact(data));
                }
            }
            return members;
        }
    };
}
