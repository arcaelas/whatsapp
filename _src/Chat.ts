import { Inmutables } from '@arcaelas/utils';
import type { AnyMessageContent } from 'baileys';
import type { Context } from './types';

/**
 * @description
 * Clase base para validacion con instanceof.
 * La implementacion real se genera con chat().
 */
export class Chat {
    readonly id!: string;
    readonly name!: string;
    readonly photo!: string | null;
    readonly phone!: string | null;
    readonly type!: 'group' | 'contact';
}
export type IChat = {
    [K in keyof Chat as Chat[K] extends Exclude<Inmutables | null, object> ? K : never]: Chat[K];
};

/**
 * @description Factory que retorna la clase Chat enlazada al contexto.
 * @param wa Instancia de WhatsApp.
 * @returns Clase _Chat que extiende Chat.
 */
export function chat(wa: Context) {
    /**
     * @description Metodo interno para enviar mensajes.
     * @param cid ID del chat.
     * @param content Contenido del mensaje.
     * @param mid ID del mensaje a citar (opcional).
     * @returns true si se envio correctamente.
     */
    async function _send(cid: string, content: AnyMessageContent, mid?: string): Promise<boolean> {
        if (!wa._socket) return false;
        const options = mid ? { quoted: { key: { remoteJid: cid, id: mid }, message: {} } } : undefined;
        const result = await wa._socket.sendMessage(cid, content, options as never);
        return !!result?.key?.id;
    }
    return class _Chat extends Chat {
        constructor(data: IChat) {
            super();
            Object.assign(this, data);
        }

        /**
         * @description Obtiene un chat por su ID.
         * @param cid ID del chat (remoteJid).
         * @returns Chat o null si no existe.
         */
        static async get(cid: string): Promise<_Chat | null> {
            const data = await wa._store.chat.get(cid);
            return data ? new _Chat(data) : null;
        }

        /**
         * @description Obtiene chats paginados.
         * @param offset Inicio de paginacion.
         * @param limit Cantidad maxima de resultados.
         * @returns Array de chats.
         */
        static async find(offset: number, limit: number): Promise<_Chat[]> {
            const items = await wa._store.chat.find(offset, limit);
            return items.map((data) => new _Chat(data));
        }

        /**
         * @description Marca un mensaje como leido. Si no se especifica mid, marca el ultimo mensaje.
         * @param cid ID del chat.
         * @param mid ID del mensaje (opcional). Si no se proporciona, usa el ultimo mensaje.
         * @returns true si se marco correctamente.
         */
        static async seen(cid: string, mid?: string): Promise<boolean> {
            if (!wa._socket) return false;
            if (mid) {
                const msg = await wa._store.message.get(cid, mid);
                if (!msg) return false;
                await wa._socket.readMessages([{ remoteJid: cid, id: mid, participant: msg.uid }]);
                return true;
            }
            const messages = await wa._store.message.find(cid, 0, 1);
            if (!messages.length) return false;
            return _Chat.seen(cid, messages[0].id);
        }

        /**
         * @description Obtiene los participantes de un chat.
         * @param cid ID del chat.
         * @param offset Inicio de paginacion.
         * @param limit Cantidad maxima de resultados.
         * @returns Array de contactos (incluye me en grupos).
         */
        static async members(cid: string, offset: number, limit: number) {
            if (cid.endsWith('@g.us') && wa._socket) {
                const metadata = await wa._socket.groupMetadata(cid);
                const participants = metadata.participants.slice(offset, offset + limit);
                const members: InstanceType<typeof wa.Contact>[] = [];
                for (const p of participants) {
                    const existing = await wa.Contact.get(p.id);
                    if (existing) members.push(existing);
                    else
                        members.push(
                            new wa.Contact({
                                id: p.id,
                                name: p.id.split('@')[0],
                                phone: p.id.split('@')[0],
                                photo: null,
                                custom_name: p.id.split('@')[0],
                            })
                        );
                }
                return members;
            }
            const contact = await wa.Contact.get(cid);
            const me = await wa.Contact.me();
            const result: InstanceType<typeof wa.Contact>[] = [];
            if (contact) result.push(contact);
            if (me) result.push(me);
            return result.slice(offset, offset + limit);
        }

        /**
         * @description Obtiene mensajes paginados de un chat.
         * @param cid ID del chat.
         * @param offset Inicio de paginacion.
         * @param limit Cantidad maxima de resultados.
         * @returns Array de mensajes.
         */
        static async messages(cid: string, offset: number, limit: number) {
            const items = await wa._store.message.find(cid, offset, limit);
            return items.map((data) => new wa.Message(data));
        }

        /**
         * @description Envia un mensaje de texto.
         * @param cid ID del chat.
         * @param content Texto a enviar.
         * @param mid ID del mensaje a citar (opcional).
         * @returns true si se envio correctamente.
         */
        static async text(cid: string, content: string, mid?: string): Promise<boolean> {
            return await _send(cid, { text: content }, mid);
        }

        /**
         * @description Envia una imagen.
         * @param cid ID del chat.
         * @param buffer Buffer de la imagen.
         * @param mid ID del mensaje a citar (opcional).
         * @returns true si se envio correctamente.
         */
        static async image(cid: string, buffer: Buffer, mid?: string): Promise<boolean> {
            return await _send(cid, { image: buffer }, mid);
        }

        /**
         * @description Envia un video.
         * @param cid ID del chat.
         * @param buffer Buffer del video.
         * @param mid ID del mensaje a citar (opcional).
         * @returns true si se envio correctamente.
         */
        static async video(cid: string, buffer: Buffer, mid?: string): Promise<boolean> {
            return await _send(cid, { video: buffer }, mid);
        }

        /**
         * @description Envia un audio.
         * @param cid ID del chat.
         * @param buffer Buffer del audio.
         * @param mid ID del mensaje a citar (opcional).
         * @returns true si se envio correctamente.
         */
        static async audio(cid: string, buffer: Buffer, mid?: string): Promise<boolean> {
            return await _send(cid, { audio: buffer, ptt: true }, mid);
        }

        /**
         * @description Envia una ubicacion.
         * @param cid ID del chat.
         * @param coords Coordenadas con lat, lng y caption opcional.
         * @param mid ID del mensaje a citar (opcional).
         * @returns true si se envio correctamente.
         */
        static async location(cid: string, coords: { lat: number; lng: number; caption?: string }, mid?: string): Promise<boolean> {
            return await _send(
                cid,
                {
                    location: {
                        degreesLatitude: coords.lat,
                        degreesLongitude: coords.lng,
                        name: coords.caption,
                    },
                },
                mid
            );
        }

        /**
         * @description Crea una encuesta.
         * @param cid ID del chat.
         * @param text Pregunta de la encuesta.
         * @param options Opciones de respuesta.
         * @returns true si se envio correctamente.
         */
        static async poll(cid: string, text: string, options: string[]): Promise<boolean> {
            return await _send(cid, {
                poll: {
                    name: text,
                    values: options,
                    selectableCount: 1,
                },
            });
        }

        /**
         * @description Activa o desactiva el estado "escribiendo...".
         * @param cid ID del chat.
         * @param active true para activar, false para desactivar.
         * @returns true si se actualizo correctamente.
         */
        static async typing(cid: string, active: boolean): Promise<boolean> {
            if (!wa._socket) return false;
            await wa._socket.sendPresenceUpdate(active ? 'composing' : 'available', cid);
            return true;
        }

        /**
         * @description Activa o desactiva el estado "grabando...".
         * @param cid ID del chat.
         * @param active true para activar, false para desactivar.
         * @returns true si se actualizo correctamente.
         */
        static async recording(cid: string, active: boolean): Promise<boolean> {
            if (!wa._socket) return false;
            await wa._socket.sendPresenceUpdate(active ? 'recording' : 'available', cid);
            return true;
        }

        async seen(mid?: string): Promise<boolean> {
            return _Chat.seen(this.id, mid);
        }

        async members(offset: number, limit: number) {
            return _Chat.members(this.id, offset, limit);
        }

        async messages(offset: number, limit: number) {
            return _Chat.messages(this.id, offset, limit);
        }

        async text(content: string, mid?: string): Promise<boolean> {
            return _Chat.text(this.id, content, mid);
        }

        async image(buffer: Buffer, mid?: string): Promise<boolean> {
            return _Chat.image(this.id, buffer, mid);
        }

        async video(buffer: Buffer, mid?: string): Promise<boolean> {
            return _Chat.video(this.id, buffer, mid);
        }

        async audio(buffer: Buffer, mid?: string): Promise<boolean> {
            return _Chat.audio(this.id, buffer, mid);
        }

        async location(coords: { lat: number; lng: number; caption?: string }, mid?: string): Promise<boolean> {
            return _Chat.location(this.id, coords, mid);
        }

        async poll(text: string, options: string[]): Promise<boolean> {
            return _Chat.poll(this.id, text, options);
        }

        async typing(active: boolean): Promise<boolean> {
            return _Chat.typing(this.id, active);
        }

        async recording(active: boolean): Promise<boolean> {
            return _Chat.recording(this.id, active);
        }
    };
}
