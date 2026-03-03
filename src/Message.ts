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
 * Supported message types.
 */
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'location' | 'poll';

/**
 * @description Estados de un mensaje.
 * Message delivery statuses.
 */
export enum MESSAGE_STATUS {
    /** Error al enviar / Send error */
    ERROR = 0,
    /** Mensaje pendiente de envío / Pending send */
    PENDING = 1,
    /** Servidor recibió el mensaje / Server acknowledged */
    SERVER_ACK = 2,
    /** Mensaje entregado al destinatario / Delivered */
    DELIVERED = 3,
    /** Mensaje leído por el destinatario / Read */
    READ = 4,
    /** Mensaje reproducido (audio/video) / Played */
    PLAYED = 5,
}

/**
 * @description Opciones para crear encuesta.
 * Poll creation options.
 */
export interface PollOptions {
    /** Pregunta o título de la encuesta / Poll question or title */
    content: string;
    /** Opciones de respuesta / Answer options */
    options: Array<{ content: string }>;
}

/**
 * @description Opciones para enviar ubicación.
 * Location send options.
 */
export interface LocationOptions {
    /** Latitud en grados / Latitude in degrees */
    lat: number;
    /** Longitud en grados / Longitude in degrees */
    lng: number;
    /** true para ubicación en tiempo real / true for live location */
    live?: boolean;
}

/**
 * @description Datos del índice de mensaje (sin content ni raw completo).
 * Message index data (without content or full raw).
 */
export interface IMessageIndex {
    /** ID único del mensaje / Unique message ID */
    id: string;
    /** ID del chat / Chat ID */
    cid: string;
    /** ID del mensaje padre (reply) / Parent message ID (reply) */
    mid: string | null;
    /** Si el mensaje es propio / Whether the message is own */
    me: boolean;
    /** Tipo de mensaje / Message type */
    type: MessageType;
    /** Autor del mensaje / Message author */
    author: string;
    /** Estado de entrega / Delivery status */
    status: MESSAGE_STATUS;
    /** Si está destacado / Whether it's starred */
    starred: boolean;
    /** Si fue reenviado / Whether it was forwarded */
    forwarded: boolean;
    /** Timestamp de creación (ms) / Creation timestamp (ms) */
    created_at: number;
    /** Timestamp de expiración (ms) o null / Expiration timestamp (ms) or null */
    deleted_at: number | null;
    /** Tipo MIME / MIME type */
    mime: string;
    /** Caption del mensaje / Message caption */
    caption: string;
    /** true si fue editado / true if edited */
    edited: boolean;
}

/**
 * @description Datos completos del mensaje.
 * Full message data.
 */
export interface IMessage {
    /** Índice del mensaje / Message index */
    index: IMessageIndex;
    /** WAMessage raw del protocolo / Protocol raw WAMessage */
    raw: WAMessage;
}

/**
 * @description Mapeo de tipos de contenido de Baileys a MessageType.
 * Baileys content type to MessageType mapping.
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
 * Builds IMessageIndex from WAMessage.
 */
function build_message_index(raw: WAMessage, edited = false): IMessageIndex {
    const key = raw.key ?? {};
    const content_type = getContentType(raw.message ?? {});
    const msg_type = MESSAGE_TYPE_MAP[content_type ?? ''] ?? 'text';
    const msg_content = raw.message?.[content_type as keyof typeof raw.message] as Record<string, unknown> | string | undefined;
    const context_info = (msg_content as { contextInfo?: proto.IContextInfo } | undefined)?.contextInfo;
    const ephemeral_duration = raw.ephemeralDuration ?? context_info?.expiration;
    const deleted_at = raw.ephemeralStartTimestamp && ephemeral_duration ? (Number(raw.ephemeralStartTimestamp) + ephemeral_duration) * 1000 : null;

    let mime = 'text/plain';
    if (msg_type === 'location' || msg_type === 'poll') mime = 'application/json';
    else if (msg_type !== 'text' && typeof msg_content === 'object') mime = (msg_content?.mimetype as string) ?? 'application/octet-stream';

    let caption = '';
    if (typeof msg_content === 'string') caption = msg_content;
    else if (msg_content) caption = (msg_content.caption as string) ?? (msg_content.text as string) ?? (msg_content.name as string) ?? '';

    return {
        id: key.id ?? '',
        cid: key.remoteJid ?? '',
        mid: context_info?.stanzaId ?? null,
        me: key.fromMe ?? false,
        type: msg_type,
        author: key.participant ?? key.remoteJid ?? '',
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
 * Base class representing a WhatsApp message.
 */
export class Message {
    /** Índice del mensaje / Message index */
    readonly index: IMessageIndex;
    /** WAMessage raw del protocolo / Protocol raw WAMessage */
    readonly raw: WAMessage;

    constructor(data: IMessage) {
        this.index = data.index;
        this.raw = data.raw;
    }

    /** ID único del mensaje / Unique message ID */
    get id(): string { return this.index.id; }
    /** JID del chat al que pertenece / Chat JID */
    get cid(): string { return this.index.cid; }
    /** ID del mensaje padre (reply) / Parent message ID (reply) */
    get mid(): string | null { return this.index.mid; }
    /** true si el mensaje fue enviado por el usuario autenticado / true if sent by authenticated user */
    get me(): boolean { return this.index.me; }
    /** Autor del mensaje / Message author */
    get author(): string { return this.index.author; }
    /** true si el mensaje fue editado / true if edited */
    get edited(): boolean { return this.index.edited; }
    /** Tipo de contenido del mensaje / Message content type */
    get type(): MessageType { return this.index.type; }
    /** Texto o caption del mensaje / Message text or caption */
    get caption(): string { return this.index.caption; }
    /** Tipo MIME del contenido / Content MIME type */
    get mime(): string { return this.index.mime; }
    /** Estado del mensaje / Message status */
    get status(): MESSAGE_STATUS { return this.index.status; }
    /** true si el mensaje está destacado / true if starred */
    get starred(): boolean { return this.index.starred; }
    /** true si el mensaje fue reenviado / true if forwarded */
    get forwarded(): boolean { return this.index.forwarded; }
    /** Timestamp de creación (ms) / Creation timestamp (ms) */
    get created_at(): number { return this.index.created_at; }
    /** Timestamp de expiración (ms) o null / Expiration timestamp (ms) or null */
    get deleted_at(): number | null { return this.index.deleted_at; }

    /**
     * @description Obtiene el contenido como Readable stream.
     * Gets content as Readable stream.
     */
    stream(): Promise<Readable> {
        return Promise.resolve(Readable.from(Buffer.alloc(0)));
    }

    /**
     * @description Obtiene el contenido del mensaje como Buffer.
     * Gets message content as Buffer.
     */
    content(): Promise<Buffer> {
        return Promise.resolve(Buffer.alloc(0));
    }
}

/**
 * @description Factory que retorna la clase Message enlazada al contexto.
 * Factory that returns the Message class bound to context.
 * @param wa Instancia de WhatsApp.
 */
export function message(wa: WhatsApp) {
    const _watchers = new Map<string, Set<(msg: any) => void>>();

    /**
     * @description Agrega un mensaje al índice del chat (interno).
     * Adds a message to the chat index (internal).
     */
    async function _add_to_index(cid: string, mid: string, timestamp: number): Promise<void> {
        const key = `chat/${cid}/messages`;
        const line = `${timestamp} ${mid}`;
        const current = await wa.engine.get(key);
        await wa.engine.set(key, current ? `${line}\n${current}` : line);
    }

    /**
     * @description Elimina un mensaje del índice del chat (interno).
     * Removes a message from the chat index (internal).
     */
    async function _remove_from_index(cid: string, mid: string): Promise<void> {
        const key = `chat/${cid}/messages`;
        const content = await wa.engine.get(key);
        if (!content) return;
        const filtered = content.trim().split('\n').filter((line) => !line.endsWith(` ${mid}`)).join('\n');
        await wa.engine.set(key, filtered || null);
    }

    /**
     * @description Notifica a los watchers de un mensaje (interno).
     * Notifies message watchers (internal).
     */
    function _notify(cid: string, mid: string): void {
        const handlers = _watchers.get(`${cid}:${mid}`);
        handlers?.forEach((h) => _Message.get(cid, mid).then((msg) => msg && h(msg)));
    }

    async function _send(cid: string, content: Record<string, unknown>, binary?: Buffer, reply_to?: string): Promise<InstanceType<typeof _Message> | null> {
        const jid = await wa.resolveJID(cid);
        if (!jid || !wa.socket) return null;
        let quoted: WAMessage | undefined;
        if (reply_to) {
            const ref = await _Message.get(jid, reply_to);
            if (ref) quoted = ref.raw;
        }
        const raw = await wa.socket.sendMessage(jid, { ...content, ...(quoted && { quoted }) } as never);
        const sent_id = raw?.key?.id;
        if (!raw || !sent_id) return null;

        const index = build_message_index(raw);
        await wa.engine.set(`chat/${jid}/message/${sent_id}/index`, JSON.stringify(index, BufferJSON.replacer));
        await wa.engine.set(`chat/${jid}/message/${sent_id}/raw`, JSON.stringify(raw, BufferJSON.replacer));
        if (binary) await wa.engine.set(`chat/${jid}/message/${sent_id}/content`, binary.toString('base64'));
        await _add_to_index(jid, sent_id, index.created_at);
        return new _Message({ index, raw });
    }

    const _Message = class extends Message {
        /**
         * @description Obtiene un mensaje por CID y MID.
         * Retrieves a message by CID and MID.
         */
        static async get(cid: string, mid: string): Promise<InstanceType<typeof _Message> | null> {
            const jid = await wa.resolveJID(cid);
            if (!jid) return null;
            const stored_index = await wa.engine.get(`chat/${jid}/message/${mid}/index`);
            if (!stored_index) return null;
            const index: IMessageIndex = JSON.parse(stored_index, BufferJSON.reviver);
            const stored_raw = await wa.engine.get(`chat/${jid}/message/${mid}/raw`);
            const raw: WAMessage = stored_raw ? JSON.parse(stored_raw, BufferJSON.reviver) : { key: { remoteJid: jid, id: mid, fromMe: index.me } };
            return new _Message({ index, raw });
        }

        /**
         * @description Lista mensajes de un chat (paginado).
         * Lists messages from a chat (paginated).
         */
        static async list(cid: string, offset = 0, limit = 50): Promise<InstanceType<typeof _Message>[]> {
            const jid = await wa.resolveJID(cid);
            if (!jid) return [];
            const content = await wa.engine.get(`chat/${jid}/messages`);
            if (!content) return [];
            const ids = content.trim().split('\n').slice(offset, offset + limit).map((line) => line.split(' ')[1]).filter(Boolean);
            const messages: InstanceType<typeof _Message>[] = [];
            for (const mid of ids) {
                const msg = await _Message.get(jid, mid);
                if (msg) messages.push(msg);
            }
            return messages;
        }

        /**
         * @description Cuenta mensajes de un chat.
         * Counts messages in a chat.
         */
        static async count(cid: string): Promise<number> {
            const jid = await wa.resolveJID(cid);
            if (!jid) return 0;
            const content = await wa.engine.get(`chat/${jid}/messages`);
            if (!content) return 0;
            return content.trim().split('\n').filter(Boolean).length;
        }

        /**
         * @description Envía un mensaje de texto.
         * Sends a text message.
         */
        static async text(cid: string, text: string, mid?: string) {
            return _send(cid, { text }, undefined, mid);
        }

        /**
         * @description Envía una imagen.
         * Sends an image.
         */
        static async image(cid: string, buffer: Buffer, caption?: string, mid?: string) {
            return _send(cid, { image: buffer, caption }, buffer, mid);
        }

        /**
         * @description Envía un video.
         * Sends a video.
         */
        static async video(cid: string, buffer: Buffer, caption?: string, mid?: string) {
            return _send(cid, { video: buffer, caption }, buffer, mid);
        }

        /**
         * @description Envía un audio.
         * Sends an audio.
         * @param ptt true para nota de voz (default true) / true for voice note (default true).
         */
        static async audio(cid: string, buffer: Buffer, ptt = true, mid?: string) {
            return _send(cid, { audio: buffer, ptt }, buffer, mid);
        }

        /**
         * @description Envía una ubicación.
         * Sends a location.
         */
        static async location(cid: string, opts: LocationOptions, mid?: string) {
            return _send(cid, { location: { degreesLatitude: opts.lat, degreesLongitude: opts.lng } }, undefined, mid);
        }

        /**
         * @description Envía una encuesta.
         * Sends a poll.
         */
        static async poll(cid: string, opts: PollOptions, mid?: string) {
            return _send(cid, { poll: { name: opts.content, values: opts.options.map((o) => o.content), selectableCount: 1 } }, undefined, mid);
        }

        /**
         * @description Observa cambios en un mensaje específico.
         * Watches changes on a specific message.
         * @returns Función para dejar de observar / Unsubscribe function.
         */
        static watch(cid: string, mid: string, handler: (msg: InstanceType<typeof _Message>) => void): () => void {
            const key = `${cid}:${mid}`;
            if (!_watchers.has(key)) _watchers.set(key, new Set());
            _watchers.get(key)?.add(handler);
            return () => {
                _watchers.get(key)?.delete(handler);
                if (_watchers.get(key)?.size === 0) _watchers.delete(key);
            };
        }

        /**
         * @description Edita el mensaje (solo texto o caption, solo mensajes propios).
         * Edits the message (text or caption only, own messages only).
         */
        async edit(text: string): Promise<boolean> {
            if (!wa.socket || !this.me) return false;

            await wa.socket.sendMessage(this.cid, {
                text,
                edit: { remoteJid: this.cid, id: this.id, fromMe: true },
            } as never);

            const content_type = getContentType(this.raw.message ?? {});
            if (content_type === 'conversation') {
                this.raw.message = { conversation: text };
            } else if (content_type === 'extendedTextMessage') {
                this.raw.message = { extendedTextMessage: { text } };
            }

            this.index.caption = text;
            this.index.edited = true;
            await wa.engine.set(`chat/${this.cid}/message/${this.id}/index`, JSON.stringify(this.index, BufferJSON.replacer));
            await wa.engine.set(`chat/${this.cid}/message/${this.id}/raw`, JSON.stringify(this.raw, BufferJSON.replacer));
            return true;
        }

        /**
         * @description Elimina el mensaje para todos.
         * Deletes the message for everyone.
         */
        async remove(): Promise<boolean> {
            if (!wa.socket) return false;
            await wa.socket.sendMessage(this.cid, { delete: { remoteJid: this.cid, id: this.id, fromMe: this.me } });
            await _remove_from_index(this.cid, this.id);
            await wa.engine.set(`chat/${this.cid}/message/${this.id}`, null);
            return true;
        }

        /**
         * @description Reenvía el mensaje a otro chat.
         * Forwards the message to another chat.
         */
        async forward(to_cid: string): Promise<boolean> {
            if (!wa.socket) return false;

            if (this.raw.message) {
                try {
                    const wa_msg = generateWAMessageFromContent(to_cid, generateForwardMessageContent(this.raw, false), { userJid: wa.socket.user?.id ?? '' });
                    if (!wa_msg.message || !wa_msg.key?.id) return false;
                    await wa.socket.relayMessage(to_cid, wa_msg.message, { messageId: wa_msg.key.id });
                    return true;
                } catch { /* fallback below */ }
            }

            const buf = await this.content();
            if (!buf.length) return false;

            if (this.type === 'text') return (await _Message.text(to_cid, buf.toString())) !== null;
            if (this.type === 'image') return (await _Message.image(to_cid, buf, this.caption || undefined)) !== null;
            if (this.type === 'video') return (await _Message.video(to_cid, buf, this.caption || undefined)) !== null;
            if (this.type === 'audio') return (await _Message.audio(to_cid, buf)) !== null;
            if (this.type === 'location') {
                try {
                    return (await _Message.location(to_cid, JSON.parse(buf.toString()) as LocationOptions)) !== null;
                } catch { return false; }
            }
            return false;
        }

        /**
         * @description Reacciona al mensaje.
         * Reacts to the message.
         * @param emoji Emoji de reacción (vacío para quitar) / Reaction emoji (empty to remove).
         */
        async react(emoji: string): Promise<boolean> {
            if (!wa.socket) return false;
            await wa.socket.sendMessage(this.cid, {
                react: { text: emoji, key: { remoteJid: this.cid, id: this.id, fromMe: this.me } },
            });
            return true;
        }

        /**
         * @description Responde con un mensaje de texto.
         * Replies with a text message.
         */
        async text(content: string) {
            return _Message.text(this.cid, content, this.id);
        }

        /**
         * @description Responde con una imagen.
         * Replies with an image.
         */
        async image(buffer: Buffer, caption?: string) {
            return _Message.image(this.cid, buffer, caption, this.id);
        }

        /**
         * @description Responde con un video.
         * Replies with a video.
         */
        async video(buffer: Buffer, caption?: string) {
            return _Message.video(this.cid, buffer, caption, this.id);
        }

        /**
         * @description Responde con un audio.
         * Replies with an audio.
         */
        async audio(buffer: Buffer, ptt = true) {
            return _Message.audio(this.cid, buffer, ptt, this.id);
        }

        /**
         * @description Responde con una ubicacion.
         * Replies with a location.
         */
        async location(opts: LocationOptions) {
            return _Message.location(this.cid, opts, this.id);
        }

        /**
         * @description Responde con una encuesta.
         * Replies with a poll.
         */
        async poll(opts: PollOptions) {
            return _Message.poll(this.cid, opts, this.id);
        }

        /**
         * @description Obtiene el contenido como Readable stream.
         * Gets content as Readable stream.
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
         * Gets message content as Buffer.
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

    return Object.assign(_Message, { _add_to_index, _remove_from_index, _notify, _build_index: build_message_index });
}
