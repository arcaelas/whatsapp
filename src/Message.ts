/**
 * @file Message.ts
 * @description Clase Message para gestión de mensajes de WhatsApp
 */

import type { WAMessage } from 'baileys';
import { BufferJSON, downloadMediaMessage, generateForwardMessageContent, generateWAMessageFromContent, getContentType, proto } from 'baileys';
import type { WhatsApp } from './WhatsApp';

/**
 * @description Tipos de mensaje soportados.
 */
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'location' | 'poll';

/**
 * @description Estados de un mensaje.
 */
export enum MESSAGE_STATUS {
    /** Mensaje pendiente de envío */
    PENDING = 0,
    /** Servidor recibió el mensaje */
    SERVER_ACK = 1,
    /** Mensaje entregado al destinatario */
    DELIVERED = 2,
    /** Mensaje leído por el destinatario */
    READ = 3,
    /** Mensaje reproducido (audio/video) */
    PLAYED = 4,
}

/**
 * @description Opciones para crear encuesta.
 */
export interface PollOptions {
    /** Pregunta o título de la encuesta */
    content: string;
    /** Opciones de respuesta */
    options: Array<{ content: string }>;
}

/**
 * @description Opciones para enviar ubicación.
 */
export interface LocationOptions {
    /** Latitud en grados */
    lat: number;
    /** Longitud en grados */
    lng: number;
    /** true para ubicación en tiempo real */
    live?: boolean;
}

/**
 * @description Datos almacenados de un mensaje (WAMessage + metadata).
 */
export interface IMessage {
    /** WAMessage original de Baileys */
    raw: WAMessage;
    /** true si el mensaje fue editado */
    edited: boolean;
}

/**
 * @description Mapeo de tipos de contenido de Baileys a MessageType.
 */
export const MESSAGE_TYPE_MAP: Record<string, MessageType> = {
    conversation: 'text',
    extendedTextMessage: 'text',
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
    locationMessage: 'location',
    liveLocationMessage: 'location',
    pollCreationMessage: 'poll',
    pollCreationMessageV2: 'poll',
    pollCreationMessageV3: 'poll',
};

/**
 * @description
 * Clase base para representar un mensaje de WhatsApp.
 * Usa WAMessage de Baileys como fuente de verdad.
 */
export class Message {
    /** WAMessage original de Baileys */
    readonly _raw: WAMessage;
    /** Flag de edición (no existe en WAMessage) */
    readonly _edited: boolean;

    constructor(raw: WAMessage, edited = false) {
        this._raw = raw;
        this._edited = edited;
    }

    /** ID único del mensaje */
    get id(): string {
        return this._raw.key.id!;
    }

    /** JID del chat al que pertenece */
    get cid(): string {
        return this._raw.key.remoteJid!;
    }

    /** true si el mensaje fue enviado por el usuario autenticado */
    get me(): boolean {
        return this._raw.key.fromMe ?? false;
    }

    /** true si el mensaje fue editado */
    get edited(): boolean {
        return this._edited;
    }

    /** Tipo de contenido del mensaje */
    get type(): MessageType {
        const content_type = getContentType(this._raw.message ?? {});
        return MESSAGE_TYPE_MAP[content_type ?? ''] ?? 'text';
    }

    /** Texto o caption del mensaje */
    get caption(): string {
        const content_type = getContentType(this._raw.message ?? {});
        const raw = this._raw.message?.[content_type as keyof typeof this._raw.message] as Record<string, unknown> | string | undefined;
        if (typeof raw === 'string') return raw;
        return (raw?.caption as string) ?? (raw?.text as string) ?? (raw?.name as string) ?? '';
    }

    /**
     * @description Tipo MIME del contenido.
     * - text: text/plain
     * - location/poll: application/json
     * - image/video/audio: mimetype del raw
     */
    get mime(): string {
        const msg_type = this.type;
        if (msg_type === 'text') return 'text/plain';
        if (msg_type === 'location' || msg_type === 'poll') return 'application/json';

        const content_type = getContentType(this._raw.message ?? {});
        const raw = this._raw.message?.[content_type as keyof typeof this._raw.message] as Record<string, unknown> | undefined;
        return (raw?.mimetype as string) ?? 'application/octet-stream';
    }

    /** Estado del mensaje (pending, delivered, read, played) */
    get status(): MESSAGE_STATUS {
        return (this._raw.status as unknown as MESSAGE_STATUS) ?? MESSAGE_STATUS.PENDING;
    }

    /** true si el mensaje está destacado */
    get starred(): boolean {
        return this._raw.starred ?? false;
    }

    /** true si el mensaje fue reenviado */
    get forwarded(): boolean {
        const content_type = getContentType(this._raw.message ?? {});
        return (this._raw.message?.[content_type as keyof typeof this._raw.message] as { contextInfo?: proto.IContextInfo } | undefined)?.contextInfo?.isForwarded ?? false;
    }

    /**
     * @description Obtiene el contenido del mensaje como Buffer.
     * @returns Buffer con el contenido.
     */
    content(): Promise<Buffer> {
        return Promise.resolve(Buffer.alloc(0));
    }
}

/**
 * @description Factory que retorna la clase Message enlazada al contexto.
 * @param wa Instancia de WhatsApp.
 * @returns Clase _Message que extiende Message.
 */
export function message(wa: WhatsApp) {
    /** Subscribers para watch() */
    const _watchers = new Map<string, Set<(msg: Message) => void>>();

    return class _Message extends Message {
        /**
         * @description Obtiene un mensaje por CID y MID.
         * @param cid ID del chat.
         * @param mid ID del mensaje.
         * @returns Mensaje o null si no existe.
         */
        static async get(cid: string, mid: string): Promise<_Message | null> {
            const stored = await wa.engine.get(`chat/${cid}/message/${mid}/index`);
            if (!stored) return null;
            const { raw, edited } = JSON.parse(stored, BufferJSON.reviver) as IMessage;
            return new _Message(raw, edited);
        }

        /**
         * @description Reacciona a un mensaje.
         * @param cid ID del chat.
         * @param mid ID del mensaje.
         * @param emoji Emoji de reacción (vacío para quitar).
         * @returns true si se envió correctamente.
         */
        static async react(cid: string, mid: string, emoji: string): Promise<boolean> {
            if (!wa.socket) return false;
            const msg = await _Message.get(cid, mid);
            if (!msg) return false;
            await wa.socket.sendMessage(cid, {
                react: { text: emoji, key: { remoteJid: cid, id: mid, fromMe: msg.me } },
            });
            return true;
        }

        /**
         * @description Elimina un mensaje para todos.
         * @param cid ID del chat.
         * @param mid ID del mensaje.
         * @returns true si se eliminó correctamente.
         */
        static async remove(cid: string, mid: string): Promise<boolean> {
            if (!wa.socket) return false;
            const msg = await _Message.get(cid, mid);
            if (!msg) return false;
            await wa.socket.sendMessage(cid, { delete: { remoteJid: cid, id: mid, fromMe: msg.me } });
            await wa.engine.set(`chat/${cid}/message/${mid}/index`, null);
            await wa.engine.set(`chat/${cid}/message/${mid}/content`, null);
            return true;
        }

        /**
         * @description Reenvía un mensaje a otro chat.
         * @param cid ID del chat origen.
         * @param mid ID del mensaje.
         * @param to_cid ID del chat destino.
         * @returns true si se reenvió correctamente.
         */
        static async forward(cid: string, mid: string, to_cid: string): Promise<boolean> {
            if (!wa.socket) return false;

            const msg = await _Message.get(cid, mid);
            if (!msg) return false;

            // Forward nativo con _raw
            if (msg._raw.message) {
                try {
                    const wa_msg = generateWAMessageFromContent(to_cid, generateForwardMessageContent(msg._raw, false), { userJid: wa.socket.user?.id ?? '' });
                    await wa.socket.relayMessage(to_cid, wa_msg.message!, { messageId: wa_msg.key.id! });
                    return true;
                } catch {
                    // Fallback si falla el forward nativo
                }
            }

            // Fallback: obtener contenido y reenviar
            const content = await msg.content();
            if (!content.length) return false;

            if (msg.type === 'text') return (await _Message.text(to_cid, content.toString())) !== null;
            if (msg.type === 'image') return (await _Message.image(to_cid, content, msg.caption || undefined)) !== null;
            if (msg.type === 'video') return (await _Message.video(to_cid, content, msg.caption || undefined)) !== null;
            if (msg.type === 'audio') return (await _Message.audio(to_cid, content)) !== null;
            if (msg.type === 'location') {
                try {
                    return (await _Message.location(to_cid, JSON.parse(content.toString()) as LocationOptions)) !== null;
                } catch {
                    return false;
                }
            }
            return false;
        }

        /**
         * @description Edita un mensaje (solo texto o caption).
         * @param cid ID del chat.
         * @param mid ID del mensaje.
         * @param text Nuevo contenido.
         * @returns true si se editó correctamente.
         */
        static async edit(cid: string, mid: string, text: string): Promise<boolean> {
            if (!wa.socket) return false;
            const msg = await _Message.get(cid, mid);
            if (!msg?.me) return false;

            await wa.socket.sendMessage(cid, {
                text,
                edit: { remoteJid: cid, id: mid, fromMe: true },
            } as never);

            // Actualizar el mensaje almacenado con el nuevo contenido
            const content_type = getContentType(msg._raw.message ?? {});
            if (content_type === 'conversation') {
                msg._raw.message = { conversation: text };
            } else if (content_type === 'extendedTextMessage') {
                msg._raw.message = { extendedTextMessage: { text } };
            }

            const data: IMessage = { raw: msg._raw, edited: true };
            await wa.engine.set(`chat/${cid}/message/${mid}/index`, JSON.stringify(data, BufferJSON.replacer));
            return true;
        }

        /**
         * @description Guarda un WAMessage y retorna la instancia.
         * @internal
         */
        static async _store(raw: WAMessage): Promise<_Message> {
            const cid = raw.key.remoteJid!;
            const mid = raw.key.id!;
            const data: IMessage = { raw, edited: false };
            await wa.engine.set(`chat/${cid}/message/${mid}/index`, JSON.stringify(data, BufferJSON.replacer));
            return new _Message(raw, false);
        }

        /**
         * @description Envía un mensaje de texto.
         * @param cid ID del chat destino.
         * @param text Contenido del mensaje.
         * @returns Mensaje enviado o null.
         */
        static async text(cid: string, text: string): Promise<_Message | null> {
            if (!wa.socket) return null;
            const result = await wa.socket.sendMessage(cid, { text });
            if (!result?.key?.id) return null;
            return _Message._store(result);
        }

        /**
         * @description Envía una imagen.
         * @param cid ID del chat destino.
         * @param buffer Buffer de la imagen.
         * @param caption Caption opcional.
         * @returns Mensaje enviado o null.
         */
        static async image(cid: string, buffer: Buffer, caption?: string): Promise<_Message | null> {
            if (!wa.socket) return null;
            const result = await wa.socket.sendMessage(cid, { image: buffer, caption });
            if (!result?.key?.id) return null;
            await wa.engine.set(`chat/${cid}/message/${result.key.id}/content`, buffer.toString('base64'));
            return _Message._store(result);
        }

        /**
         * @description Envía un video.
         * @param cid ID del chat destino.
         * @param buffer Buffer del video.
         * @param caption Caption opcional.
         * @returns Mensaje enviado o null.
         */
        static async video(cid: string, buffer: Buffer, caption?: string): Promise<_Message | null> {
            if (!wa.socket) return null;
            const result = await wa.socket.sendMessage(cid, { video: buffer, caption });
            if (!result?.key?.id) return null;
            await wa.engine.set(`chat/${cid}/message/${result.key.id}/content`, buffer.toString('base64'));
            return _Message._store(result);
        }

        /**
         * @description Envía un audio.
         * @param cid ID del chat destino.
         * @param buffer Buffer del audio.
         * @param ptt true para nota de voz (default true).
         * @returns Mensaje enviado o null.
         */
        static async audio(cid: string, buffer: Buffer, ptt = true): Promise<_Message | null> {
            if (!wa.socket) return null;
            const result = await wa.socket.sendMessage(cid, { audio: buffer, ptt });
            if (!result?.key?.id) return null;
            await wa.engine.set(`chat/${cid}/message/${result.key.id}/content`, buffer.toString('base64'));
            return _Message._store(result);
        }

        /**
         * @description Envía una ubicación.
         * @param cid ID del chat destino.
         * @param opts Opciones de ubicación (lat, lng, live).
         * @returns Mensaje enviado o null.
         */
        static async location(cid: string, opts: LocationOptions): Promise<_Message | null> {
            if (!wa.socket) return null;
            const result = await wa.socket.sendMessage(cid, {
                location: { degreesLatitude: opts.lat, degreesLongitude: opts.lng },
            } as never);
            if (!result?.key?.id) return null;
            return _Message._store(result);
        }

        /**
         * @description Envía una encuesta.
         * @param cid ID del chat destino.
         * @param opts Opciones de encuesta (content, options).
         * @returns Mensaje enviado o null.
         */
        static async poll(cid: string, opts: PollOptions): Promise<_Message | null> {
            if (!wa.socket) return null;
            const result = await wa.socket.sendMessage(cid, {
                poll: {
                    name: opts.content,
                    values: opts.options.map((o) => o.content),
                    selectableCount: 1,
                },
            });
            if (!result?.key?.id) return null;
            return _Message._store(result);
        }

        /**
         * @description Observa cambios en un mensaje específico.
         * @param cid ID del chat.
         * @param mid ID del mensaje.
         * @param handler Callback con el mensaje actualizado.
         * @returns Función para dejar de observar.
         */
        static watch(cid: string, mid: string, handler: (msg: _Message) => void): () => void {
            const key = `${cid}:${mid}`;
            _watchers.get(key) ?? _watchers.set(key, new Set());
            _watchers.get(key)!.add(handler);
            return () => {
                _watchers.get(key)?.delete(handler);
                if (_watchers.get(key)?.size === 0) _watchers.delete(key);
            };
        }

        /**
         * @description Notifica a los watchers de un mensaje.
         * @internal
         */
        static _notify(msg: _Message): void {
            const handlers = _watchers.get(`${msg.cid}:${msg.id}`);
            if (handlers) for (const h of handlers) h(msg);
        }

        /**
         * @description Obtiene el contenido del mensaje como Buffer.
         * Siempre retorna Buffer, el usuario decide cómo parsear según `type` y `mime`.
         * @returns Buffer con el contenido.
         */
        async content(): Promise<Buffer> {
            const cached = await wa.engine.get(`chat/${this.cid}/message/${this.id}/content`);
            if (cached) return Buffer.from(cached, 'base64');

            let buffer: Buffer;

            if (this.type === 'text') {
                buffer = Buffer.from(this.caption, 'utf-8');
            } else if (this.type === 'location') {
                const loc = this._raw.message?.locationMessage ?? this._raw.message?.liveLocationMessage;
                buffer = Buffer.from(JSON.stringify({ lat: loc?.degreesLatitude, lng: loc?.degreesLongitude }), 'utf-8');
            } else if (this.type === 'poll') {
                const poll = this._raw.message?.pollCreationMessage ?? this._raw.message?.pollCreationMessageV2 ?? this._raw.message?.pollCreationMessageV3;
                buffer = Buffer.from(JSON.stringify({ content: poll?.name ?? '', options: poll?.options?.map((o) => ({ content: o.optionName })) ?? [] }), 'utf-8');
            } else if (wa.socket) {
                try {
                    const media = await downloadMediaMessage(this._raw, 'buffer', {});
                    buffer = Buffer.isBuffer(media) ? media : Buffer.alloc(0);
                } catch {
                    return Buffer.alloc(0);
                }
            } else {
                return Buffer.alloc(0);
            }

            if (buffer.length) await wa.engine.set(`chat/${this.cid}/message/${this.id}/content`, buffer.toString('base64'));
            return buffer;
        }
    };
}
