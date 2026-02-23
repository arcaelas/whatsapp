/**
 * @file Message.ts
 * @description Clase Message para gestión de mensajes de WhatsApp
 */

import type { WAMessage } from 'baileys';
import { BufferJSON, downloadMediaMessage, generateForwardMessageContent, generateWAMessageFromContent, getContentType, proto } from 'baileys';
import { Readable } from 'node:stream';
import type { WhatsApp } from '~/WhatsApp';

/**
 * @description Tipos de mensaje soportados.
 */
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'location' | 'poll';

/**
 * @description Estados de un mensaje.
 */
export enum MESSAGE_STATUS {
    /** Error al enviar */
    ERROR = 0,
    /** Mensaje pendiente de envío */
    PENDING = 1,
    /** Servidor recibió el mensaje */
    SERVER_ACK = 2,
    /** Mensaje entregado al destinatario */
    DELIVERED = 3,
    /** Mensaje leído por el destinatario */
    READ = 4,
    /** Mensaje reproducido (audio/video) */
    PLAYED = 5,
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
 * @description Datos del índice de mensaje (sin content ni raw completo).
 */
export interface IMessageIndex {
    /** ID único del mensaje */
    id: string;
    /** ID del chat */
    cid: string;
    /** ID del mensaje padre (reply) */
    mid: string | null;
    /** Si el mensaje es propio */
    me: boolean;
    /** Tipo de mensaje */
    type: MessageType;
    /** Autor del mensaje */
    author: string;
    /** Estado de entrega */
    status: MESSAGE_STATUS;
    /** Si está destacado */
    starred: boolean;
    /** Si fue reenviado */
    forwarded: boolean;
    /** Timestamp de creación (ms) */
    created_at: number;
    /** Timestamp de expiración (ms) o null */
    deleted_at: number | null;
    /** Tipo MIME */
    mime: string;
    /** Caption del mensaje */
    caption: string;
    /** true si fue editado */
    edited: boolean;
}

/**
 * @description Datos completos del mensaje.
 */
export interface IMessage {
    /** Índice del mensaje */
    index: IMessageIndex;
    /** WAMessage raw del protocolo */
    raw: WAMessage;
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
 * @description Construye IMessageIndex desde WAMessage.
 * @param raw WAMessage del protocolo.
 * @param edited Si el mensaje fue editado.
 * @returns IMessageIndex normalizado.
 */
export function build_message_index(raw: WAMessage, edited = false): IMessageIndex {
    const content_type = getContentType(raw.message ?? {});
    const msg_type = MESSAGE_TYPE_MAP[content_type ?? ''] ?? 'text';
    const msg_content = raw.message?.[content_type as keyof typeof raw.message] as Record<string, unknown> | string | undefined;
    const context_info = (msg_content as { contextInfo?: proto.IContextInfo } | undefined)?.contextInfo;

    // Calcular MIME
    let mime = 'text/plain';
    if (msg_type === 'location' || msg_type === 'poll') {
        mime = 'application/json';
    } else if (msg_type !== 'text' && typeof msg_content === 'object') {
        mime = (msg_content?.mimetype as string) ?? 'application/octet-stream';
    }

    // Calcular caption
    let caption = '';
    if (typeof msg_content === 'string') {
        caption = msg_content;
    } else if (msg_content) {
        caption = (msg_content.caption as string) ?? (msg_content.text as string) ?? (msg_content.name as string) ?? '';
    }

    // Calcular deleted_at
    const ephemeral_duration = raw.ephemeralDuration ?? context_info?.expiration;
    const deleted_at = raw.ephemeralStartTimestamp && ephemeral_duration ? (Number(raw.ephemeralStartTimestamp) + ephemeral_duration) * 1000 : null;

    return {
        id: raw.key.id!,
        cid: raw.key.remoteJid!,
        mid: context_info?.stanzaId ?? null,
        me: raw.key.fromMe ?? false,
        type: msg_type,
        author: raw.key.participant ?? raw.key.remoteJid!,
        status: (raw.status as unknown as MESSAGE_STATUS) ?? MESSAGE_STATUS.PENDING,
        starred: raw.starred ?? false,
        forwarded: context_info?.isForwarded ?? false,
        created_at: (Number(raw.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000,
        deleted_at,
        mime,
        caption,
        edited,
    };
}

/**
 * @description
 * Clase base para representar un mensaje de WhatsApp.
 * Expone getters sobre el índice, raw accesible para operaciones avanzadas.
 */
export class Message {
    /** Índice del mensaje */
    readonly index: IMessageIndex;
    /** WAMessage raw del protocolo */
    readonly raw: WAMessage;

    constructor(data: IMessage) {
        this.index = data.index;
        this.raw = data.raw;
    }

    /** ID único del mensaje */
    get id(): string {
        return this.index.id;
    }

    /** JID del chat al que pertenece */
    get cid(): string {
        return this.index.cid;
    }

    /** ID del mensaje padre (reply) */
    get mid(): string | null {
        return this.index.mid;
    }

    /** true si el mensaje fue enviado por el usuario autenticado */
    get me(): boolean {
        return this.index.me;
    }

    /** Autor del mensaje */
    get author(): string {
        return this.index.author;
    }

    /** true si el mensaje fue editado */
    get edited(): boolean {
        return this.index.edited;
    }

    /** Tipo de contenido del mensaje */
    get type(): MessageType {
        return this.index.type;
    }

    /** Texto o caption del mensaje */
    get caption(): string {
        return this.index.caption;
    }

    /** Tipo MIME del contenido */
    get mime(): string {
        return this.index.mime;
    }

    /** Estado del mensaje */
    get status(): MESSAGE_STATUS {
        return this.index.status;
    }

    /** true si el mensaje está destacado */
    get starred(): boolean {
        return this.index.starred;
    }

    /** true si el mensaje fue reenviado */
    get forwarded(): boolean {
        return this.index.forwarded;
    }

    /** Timestamp de creación (ms) */
    get created_at(): number {
        return this.index.created_at;
    }

    /** Timestamp de expiración (ms) o null */
    get deleted_at(): number | null {
        return this.index.deleted_at;
    }

    /**
     * @description Obtiene el contenido como Readable stream.
     * @returns Readable stream (vacío en clase base).
     */
    stream(): Promise<Readable> {
        return Promise.resolve(Readable.from(Buffer.alloc(0)));
    }

    /**
     * @description Obtiene el contenido del mensaje como Buffer.
     * @returns Buffer con el contenido (vacío en clase base).
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

    /** Función interna para envío de mensajes */
    async function _send(cid: string, content: Record<string, unknown>, binary?: Buffer): Promise<InstanceType<typeof _Message> | null> {
        if (!wa.socket) return null;
        const raw = await wa.socket.sendMessage(cid, content as never);
        if (!raw?.key?.id) return null;

        const index = build_message_index(raw);
        await wa.engine.set(`chat/${cid}/message/${raw.key.id}/index`, JSON.stringify(index, BufferJSON.replacer));
        await wa.engine.set(`chat/${cid}/message/${raw.key.id}/raw`, JSON.stringify(raw, BufferJSON.replacer));
        if (binary) await wa.engine.set(`chat/${cid}/message/${raw.key.id}/content`, binary.toString('base64'));
        await wa.Chat.add_message(cid, raw.key.id, index.created_at);
        return new _Message({ index, raw });
    }

    const _Message = class extends Message {
        /**
         * @description Obtiene un mensaje por CID y MID.
         * @param cid ID del chat.
         * @param mid ID del mensaje.
         * @returns Mensaje o null si no existe.
         */
        static async get(cid: string, mid: string): Promise<InstanceType<typeof _Message> | null> {
            const stored_index = await wa.engine.get(`chat/${cid}/message/${mid}/index`);
            if (!stored_index) return null;

            const index: IMessageIndex = JSON.parse(stored_index, BufferJSON.reviver);

            // Obtener raw si existe
            const stored_raw = await wa.engine.get(`chat/${cid}/message/${mid}/raw`);
            const raw: WAMessage = stored_raw ? JSON.parse(stored_raw, BufferJSON.reviver) : { key: { remoteJid: cid, id: mid, fromMe: index.me } };

            return new _Message({ index, raw });
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

            // Eliminar del índice del chat
            await wa.Chat.remove_message(cid, mid);

            // Eliminar archivos
            await wa.engine.set(`chat/${cid}/message/${mid}/index`, null);
            await wa.engine.set(`chat/${cid}/message/${mid}/content`, null);
            await wa.engine.set(`chat/${cid}/message/${mid}/raw`, null);
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

            // Forward nativo con raw
            if (msg.raw.message) {
                try {
                    const wa_msg = generateWAMessageFromContent(to_cid, generateForwardMessageContent(msg.raw, false), { userJid: wa.socket.user?.id ?? '' });
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
            const content_type = getContentType(msg.raw.message ?? {});
            if (content_type === 'conversation') {
                msg.raw.message = { conversation: text };
            } else if (content_type === 'extendedTextMessage') {
                msg.raw.message = { extendedTextMessage: { text } };
            }

            // Actualizar índice
            msg.index.caption = text;
            msg.index.edited = true;
            await wa.engine.set(`chat/${cid}/message/${mid}/index`, JSON.stringify(msg.index, BufferJSON.replacer));
            await wa.engine.set(`chat/${cid}/message/${mid}/raw`, JSON.stringify(msg.raw, BufferJSON.replacer));
            return true;
        }

        /**
         * @description Envía un mensaje de texto.
         * @param cid ID del chat destino.
         * @param text Contenido del mensaje.
         * @returns Mensaje enviado o null.
         */
        static async text(cid: string, text: string) {
            return _send(cid, { text });
        }

        /**
         * @description Envía una imagen.
         * @param cid ID del chat destino.
         * @param buffer Buffer de la imagen.
         * @param caption Caption opcional.
         * @returns Mensaje enviado o null.
         */
        static async image(cid: string, buffer: Buffer, caption?: string) {
            return _send(cid, { image: buffer, caption }, buffer);
        }

        /**
         * @description Envía un video.
         * @param cid ID del chat destino.
         * @param buffer Buffer del video.
         * @param caption Caption opcional.
         * @returns Mensaje enviado o null.
         */
        static async video(cid: string, buffer: Buffer, caption?: string) {
            return _send(cid, { video: buffer, caption }, buffer);
        }

        /**
         * @description Envía un audio.
         * @param cid ID del chat destino.
         * @param buffer Buffer del audio.
         * @param ptt true para nota de voz (default true).
         * @returns Mensaje enviado o null.
         */
        static async audio(cid: string, buffer: Buffer, ptt = true) {
            return _send(cid, { audio: buffer, ptt }, buffer);
        }

        /**
         * @description Envía una ubicación.
         * @param cid ID del chat destino.
         * @param opts Opciones de ubicación (lat, lng, live).
         * @returns Mensaje enviado o null.
         */
        static async location(cid: string, opts: LocationOptions) {
            return _send(cid, { location: { degreesLatitude: opts.lat, degreesLongitude: opts.lng } });
        }

        /**
         * @description Envía una encuesta.
         * @param cid ID del chat destino.
         * @param opts Opciones de encuesta (content, options).
         * @returns Mensaje enviado o null.
         */
        static async poll(cid: string, opts: PollOptions) {
            return _send(cid, { poll: { name: opts.content, values: opts.options.map((o) => o.content), selectableCount: 1 } });
        }

        /**
         * @description Observa cambios en un mensaje específico.
         * @param cid ID del chat.
         * @param mid ID del mensaje.
         * @param handler Callback con el mensaje actualizado.
         * @returns Función para dejar de observar.
         */
        static watch(cid: string, mid: string, handler: (msg: InstanceType<typeof _Message>) => void): () => void {
            const key = `${cid}:${mid}`;
            if (!_watchers.has(key)) _watchers.set(key, new Set());
            _watchers.get(key)!.add(handler);
            return () => {
                _watchers.get(key)?.delete(handler);
                if (_watchers.get(key)?.size === 0) _watchers.delete(key);
            };
        }

        /**
         * @description Notifica a los watchers de un mensaje.
         * @param cid ID del chat.
         * @param mid ID del mensaje.
         */
        static notify(cid: string, mid: string): void {
            const handlers = _watchers.get(`${cid}:${mid}`);
            handlers?.forEach((h) => _Message.get(cid, mid).then((msg) => msg && h(msg)));
        }

        /**
         * @description Obtiene el contenido como Readable stream.
         * Para media (image/video/audio) retorna stream directo de Baileys sin cargar en memoria.
         * Para text/location/poll retorna stream desde buffer pequeño.
         * @returns Readable stream con el contenido.
         */
        async stream(): Promise<Readable> {
            if (this.type === 'text') {
                return Readable.from(Buffer.from(this.caption, 'utf-8'));
            }
            if (this.type === 'location') {
                const loc = this.raw.message?.locationMessage ?? this.raw.message?.liveLocationMessage;
                return Readable.from(Buffer.from(JSON.stringify({ lat: loc?.degreesLatitude, lng: loc?.degreesLongitude }), 'utf-8'));
            }
            if (this.type === 'poll') {
                const poll = this.raw.message?.pollCreationMessage ?? this.raw.message?.pollCreationMessageV2 ?? this.raw.message?.pollCreationMessageV3;
                return Readable.from(Buffer.from(JSON.stringify({ content: poll?.name ?? '', options: poll?.options?.map((o) => ({ content: o.optionName })) ?? [] }), 'utf-8'));
            }
            if (wa.socket) {
                try {
                    return await downloadMediaMessage(this.raw, 'stream', {}) as unknown as Readable;
                } catch {
                    return Readable.from(Buffer.alloc(0));
                }
            }
            return Readable.from(Buffer.alloc(0));
        }

        /**
         * @description Obtiene el contenido del mensaje como Buffer.
         * Usa stream() internamente y cachea el resultado en el engine.
         * @returns Buffer con el contenido.
         */
        async content(): Promise<Buffer> {
            const cached = await wa.engine.get(`chat/${this.cid}/message/${this.id}/content`);
            if (cached) return Buffer.from(cached, 'base64');

            const readable = await this.stream();
            const chunks: Buffer[] = [];
            for await (const chunk of readable) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const buffer = Buffer.concat(chunks);

            if (buffer.length) await wa.engine.set(`chat/${this.cid}/message/${this.id}/content`, buffer.toString('base64'));
            return buffer;
        }
    };

    return _Message;
}
