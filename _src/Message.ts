import { Inmutables } from '@arcaelas/utils';
import type { Context } from './types';

/**
 * @description
 * Clase base para validacion con instanceof.
 * La implementacion real se genera con message().
 */
export class Message {
    readonly id!: string;
    readonly cid!: string;
    readonly uid!: string;
    readonly mid!: string | null;
    readonly type!: 'text' | 'image' | 'video' | 'audio' | 'location' | 'poll' | 'unknown';
    readonly mime!: string;
    readonly caption!: string;
    readonly me!: boolean;
    readonly status!: 'pending' | 'sent' | 'delivered' | 'read';
    readonly created_at!: string;
    readonly edited!: boolean;
}
export type IMessage = {
    [K in keyof Message as Message[K] extends Exclude<Inmutables | null, object> ? K : never]: Message[K];
};

/**
 * @description Factory que retorna la clase Message enlazada al contexto.
 * @param wa Instancia de WhatsApp.
 * @returns Clase _Message que extiende Message.
 */
export function message(wa: Context) {
    return class _Message extends Message {
        constructor(data: IMessage) {
            super();
            Object.assign(this, data);
        }

        /**
         * @description Obtiene un mensaje por CID y MID.
         * @param cid ID del chat.
         * @param mid ID del mensaje.
         * @returns Mensaje o null si no existe.
         * @example
         * const msg = await Message.get('5491155555555@s.whatsapp.net', 'ABC123')
         */
        static async get(cid: string, mid: string): Promise<_Message | null> {
            const data = await wa._store.message.get(cid, mid);
            return data ? new _Message(data) : null;
        }

        /**
         * @description Elimina un mensaje.
         * @param cid ID del chat.
         * @param mid ID del mensaje.
         * @param all true para eliminar para todos, false solo para mi.
         * @returns true si se envio la solicitud correctamente.
         */
        static async delete(cid: string, mid: string, all?: boolean): Promise<boolean> {
            if (!wa._socket) return false;
            const msg = await _Message.get(cid, mid);
            if (!msg) return false;
            if (all && msg.me) {
                await wa._socket.sendMessage(cid, { delete: { remoteJid: cid, id: mid, fromMe: true } });
            } else {
                await wa._socket.chatModify(
                    {
                        deleteForMe: {
                            deleteMedia: true,
                            key: { remoteJid: cid, id: mid, fromMe: msg.me },
                            timestamp: Math.floor(new Date(msg.created_at).getTime() / 1000),
                        },
                    },
                    cid
                );
            }
            return true;
        }

        /**
         * @description Reenvía un mensaje a otro chat.
         * @param cid ID del chat origen.
         * @param mid ID del mensaje.
         * @param target_cid ID del chat destino.
         * @returns true si se reenvio correctamente.
         * @deprecated Usar metodo manual de envío.
         */
        static async forward(cid: string, mid: string, target_cid: string): Promise<boolean> {
            if (!wa._socket) return false;
            const msg = await _Message.get(cid, mid);
            if (!msg) return false;
            const content = await msg.content();
            if (msg.type === 'text') {
                const result = await wa._socket.sendMessage(target_cid, { text: content.toString() });
                return !!result?.key?.id;
            }
            if (msg.type === 'image') {
                const result = await wa._socket.sendMessage(target_cid, { image: content, caption: msg.caption || undefined });
                return !!result?.key?.id;
            }
            if (msg.type === 'video') {
                const result = await wa._socket.sendMessage(target_cid, { video: content, caption: msg.caption || undefined });
                return !!result?.key?.id;
            }
            if (msg.type === 'audio') {
                const result = await wa._socket.sendMessage(target_cid, { audio: content, ptt: true });
                return !!result?.key?.id;
            }
            if (msg.type === 'location') {
                const location = JSON.parse(content.toString()) as { lat: number; lng: number };
                const result = await wa._socket.sendMessage(target_cid, {
                    location: { degreesLatitude: location.lat, degreesLongitude: location.lng },
                });
                return !!result?.key?.id;
            }
            return false;
        }

        /**
         * @description Edita un mensaje de texto propio.
         * @param cid ID del chat.
         * @param mid ID del mensaje.
         * @param content Nuevo contenido.
         * @returns true si se edito correctamente.
         */
        static async edit(cid: string, mid: string, content: string): Promise<boolean> {
            if (!wa._socket) return false;
            const msg = await _Message.get(cid, mid);
            if (!msg || !msg.me || msg.type !== 'text') return false;
            await wa._socket.sendMessage(cid, {
                text: content,
                edit: { remoteJid: cid, id: mid, fromMe: true },
            } as never);
            return true;
        }

        /**
         * @description Obtiene los votos de una encuesta.
         * @param cid ID del chat.
         * @param mid ID del mensaje de encuesta.
         * @returns Array con nombre de opcion y cantidad de votos.
         */
        static async votes(cid: string, mid: string): Promise<{ name: string; count: number }[]> {
            const msg = await _Message.get(cid, mid);
            if (!msg || msg.type !== 'poll') return [];
            const content_buffer = await wa._store.content.get(cid, mid);
            if (!content_buffer) return [];
            const poll_data = JSON.parse(content_buffer.toString()) as {
                content: string;
                items: Array<{ content: string; voters: string[] }>;
            };
            return poll_data.items.map((item) => ({
                name: item.content,
                count: item.voters.length,
            }));
        }

        /**
         * @description Marca el mensaje como leido.
         * @param cid ID del chat.
         * @param mid ID del mensaje.
         * @returns true si se marco correctamente.
         */
        static async seen(cid: string, mid: string): Promise<boolean> {
            return wa.Chat.seen(cid, mid);
        }

        /**
         * @description Obtiene el contenido del mensaje.
         * @returns Buffer con el contenido (descargado al recibir el mensaje).
         * @example
         * // Texto
         * const text = (await msg.content()).toString()
         *
         * // Media
         * const buffer = await msg.content()
         *
         * // Location/Poll (JSON)
         * const data = JSON.parse((await msg.content()).toString())
         */
        async content(): Promise<Buffer> {
            const cached = await wa._store.content.get(this.cid, this.id);
            return cached ?? Buffer.alloc(0);
        }

        async delete(all?: boolean): Promise<boolean> {
            return _Message.delete(this.cid, this.id, all);
        }

        /**
         * @deprecated Usar metodo manual de envío.
         */
        async forward(target_cid: string): Promise<boolean> {
            return _Message.forward(this.cid, this.id, target_cid);
        }

        async edit(content: string): Promise<boolean> {
            return _Message.edit(this.cid, this.id, content);
        }

        async votes(): Promise<{ name: string; count: number }[]> {
            return _Message.votes(this.cid, this.id);
        }

        async seen(): Promise<boolean> {
            return _Message.seen(this.cid, this.id);
        }

        /**
         * @description Obtiene el chat donde se envio este mensaje.
         * @returns Chat o null si no existe.
         */
        async chat() {
            return wa.Chat.get(this.cid);
        }

        /**
         * @description Obtiene el contacto autor del mensaje.
         * @returns Contact o null si no existe.
         */
        async author() {
            return wa.Contact.get(this.uid);
        }
    };
}
