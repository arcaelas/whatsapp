/**
 * @file message/index.ts
 * @description Entidad Message — clase base con getters puros y subclases por tipo
 * (Text, Image, Video, Audio, Sticker, Document, Location, Poll, VCard, Event);
 * `message(wa, raw)` evalúa el tipo y retorna la instancia correcta.
 * Message entity — pure-getter base class with per-type subclasses;
 * `message(wa, raw)` evaluates the type and returns the right instance.
 */

import {
    aesEncryptGCM,
    downloadMediaMessage,
    generateForwardMessageContent,
    generateMessageID,
    generateWAMessageFromContent,
    getAggregateVotesInPollMessage,
    getContentType,
    getKeyAuthor,
    hmacSign,
    jidNormalizedUser,
    proto,
    sha256,
    updateMessageWithPollUpdate,
    type WAMessage,
} from 'baileys';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { internals } from '~/lib/internal';
import { Chat } from '~/lib/chat';
import { Contact } from '~/lib/contact';
import { deserialize, serialize } from '~/lib/store';
import type { WhatsApp } from '~/lib/whatsapp';

/** Estados legibles indexados por el status numérico de baileys. / Readable states indexed by the baileys numeric status. */
const STATUS = ['error', 'pending', 'sent', 'delivered', 'read', 'played'] as const;

const MESSAGE_TYPE_MAP = {
    conversation: 'text',
    extendedTextMessage: 'text',
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
    stickerMessage: 'sticker',
    locationMessage: 'location',
    liveLocationMessage: 'location',
    pollCreationMessage: 'poll',
    pollCreationMessageV2: 'poll',
    pollCreationMessageV3: 'poll',
    documentMessage: 'document',
    documentWithCaptionMessage: 'document',
    contactMessage: 'vcard',
    contactsArrayMessage: 'vcard',
    eventMessage: 'event',
} as const;

/**
 * Desenvuelve los wrappers de contenido (view-once, documento con caption).
 * Unwraps content wrappers (view-once, captioned document).
 */
function unwrap(msg: NonNullable<WAMessage['message']>) {
    return (
        msg.viewOnceMessage?.message ??
        msg.viewOnceMessageV2?.message ??
        msg.viewOnceMessageV2Extension?.message ??
        msg.documentWithCaptionMessage?.message ??
        msg
    );
}

/**
 * Convierte un número o Long del proto a number plano.
 * Converts a proto number or Long into a plain number.
 */
function to_number(value: number | { toString(): string } | null | undefined): number {
    return Number(value?.toString() ?? 0);
}

/**
 * Convierte los bytes del proto (Uint8Array runtime o base64 post-engine) a Buffer.
 * Converts proto bytes (runtime Uint8Array or post-engine base64) into a Buffer.
 */
function to_buffer(value: Uint8Array | string | null | undefined): Buffer | null {
    if (value instanceof Uint8Array && value.length > 0) return Buffer.from(value);
    if (typeof value === 'string' && value.length > 0) return Buffer.from(value, 'base64');
    return null;
}

type SendExtra = { mid?: string; once?: boolean };

/**
 * Envío base: resuelve el destino, cita si hay `mid`, marca view-once, persiste el doc
 * (con su binario cuando aplica) y retorna la instancia del mensaje enviado.
 * Base send: resolves the target, quotes when `mid` is given, flags view-once, persists
 * the doc (with its binary when it applies) and returns the sent message instance.
 */
async function send(
    wa: WhatsApp,
    cid: string,
    content: Record<string, unknown>,
    binary?: Buffer,
    extra: SendExtra = {},
    doc_overrides?: Partial<Message['_raw']>,
): Promise<Message | null> {
    let result: Message | null = null;
    const jid = await internals(wa).resolve_jid(cid);
    const socket = internals(wa).socket;
    if (jid && socket) {
        const quoted = extra.mid
            ? (deserialize<Message['_raw']>(await wa.engine.get(`/chat/${jid}/message/${extra.mid}`))?.raw ?? undefined)
            : undefined;
        const raw = await socket.sendMessage(jid, {
            ...content,
            ...(extra.once && { viewOnce: true }),
            ...(quoted && { quoted }),
        } as never);
        const sent_id = raw?.key?.id;
        if (raw && sent_id) {
            const instance = message(wa, raw);
            if (doc_overrides) {
                Object.assign(instance._raw, doc_overrides);
            }
            await wa.engine.set(`/chat/${jid}/message/${sent_id}`, serialize(instance._raw), instance._raw.created_at);
            if (binary) {
                await write_content(wa, `/chat/${jid}/message/${sent_id}/content`, binary);
            }
            result = instance;
        }
    }
    return result;
}

/**
 * Binario persistido de un documento: primero el crudo del engine y, si el driver no soporta
 * binarios o el dato viene de una sesión anterior, el documento JSON con base64.
 * A document's persisted binary: the engine's raw one first and, when the driver lacks binary
 * support or the data comes from an older session, the base64 JSON document.
 *
 * @param wa - Cliente dueño / Owner client
 * @param path - Ruta del contenido / Content path
 * @returns Binario o null / Binary or null
 */
async function read_content(wa: WhatsApp, path: string): Promise<Buffer | null> {
    const raw = await wa.engine.get_buffer?.(path);
    if (raw?.length) {
        return raw;
    }
    const legacy = deserialize<{ data: string }>(await wa.engine.get(path));
    return legacy?.data ? Buffer.from(legacy.data, 'base64') : null;
}

/**
 * Persiste el binario de un documento: crudo cuando el driver lo soporta, JSON con base64
 * en caso contrario.
 * Persists a document's binary: raw when the driver supports it, base64 JSON otherwise.
 *
 * @param wa - Cliente dueño / Owner client
 * @param path - Ruta del contenido / Content path
 * @param data - Binario a guardar / Binary to store
 */
async function write_content(wa: WhatsApp, path: string, data: Buffer): Promise<void> {
    if (wa.engine.set_buffer) {
        await wa.engine.set_buffer(path, data);
    } else {
        await wa.engine.set(path, serialize({ data: data.toString('base64') }));
    }
}

/**
 * Stream del binario del mensaje: cache del engine o descarga de baileys.
 * Message binary stream: engine cache or baileys download.
 */
async function media_stream(wa: WhatsApp, doc: Message['_raw']): Promise<Readable> {
    const cached = await read_content(wa, `/chat/${doc.cid}/message/${doc.id}/content`);
    if (cached) {
        return Readable.from(cached);
    }
    const socket = internals(wa).socket;
    if (socket) {
        try {
            return (await downloadMediaMessage(doc.raw, 'stream', {})) as unknown as Readable;
        } catch {
            /* media may be expired */
        }
    }
    return Readable.from(Buffer.alloc(0));
}

/**
 * Acumula un Readable en Buffer.
 * Drains a Readable into a Buffer.
 */
async function drain(readable: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

/**
 * Clase base del mensaje: recibe el cliente y el raw, deriva el estado con getters y
 * opera contra WhatsApp con sus métodos. Los estáticos reciben el cliente como primer
 * argumento (`Message.text(wa, cid, …)`).
 * Base message class: receives the client and the raw, derives state via getters and
 * operates against WhatsApp with its methods. Statics take the client as their first
 * argument (`Message.text(wa, cid, …)`).
 */
export class Message {
    /**
     * @internal Cliente dueño y documento persistido. `status`, `created_at` y
     * `deleted_at` guardan los valores numéricos del protocolo; los getters los
     * presentan legibles. `viewed` existe únicamente en los status broadcast (Feed).
     * Owner client and persisted document. `status`, `created_at` and `deleted_at`
     * keep the protocol numeric values; getters expose them readable. `viewed` only
     * exists on status broadcasts (Feed).
     */
    constructor(
        readonly _wa: WhatsApp,
        readonly _raw: {
            id: string;
            cid: string;
            mid: string | null;
            me: boolean;
            type: 'text' | 'image' | 'video' | 'audio' | 'sticker' | 'document' | 'location' | 'poll' | 'vcard' | 'event';
            author: string;
            status: number;
            starred: boolean;
            forwarded: boolean;
            created_at: number;
            deleted_at: number | null;
            mime: string;
            caption: string;
            edited: boolean;
            multiple?: boolean;
            reactions?: { author: string; emoji: string; at: number }[];
            viewed?: boolean | null;
            raw: WAMessage;
        }
    ) { }

    /** Identificador del mensaje. / Message identifier. */
    get id(): string {
        return this._raw.id;
    }
    /** Identificador del chat del mensaje. / Message chat identifier. */
    get cid(): string {
        return this._raw.cid;
    }
    /** Identificador del mensaje citado, o null. / Quoted message identifier, or null. */
    get mid(): string | null {
        return this._raw.mid;
    }
    /** JID del autor, para acceso síncrono. / Author JID, for sync access. */
    get from(): string {
        return this._raw.author;
    }
    /** true si soy el autor. / true when I am the author. */
    get me(): boolean {
        return this._raw.me;
    }
    /** Tipo del mensaje. / Message type. */
    get type(): Message['_raw']['type'] {
        return this._raw.type;
    }
    /** MIME: text/plain en texto, text/json en poll/location/vcard/event, real en media. / MIME: text/plain for text, text/json for poll/location/vcard/event, actual for media. */
    get mime(): string {
        const { type } = this._raw;
        if (type === 'text') return 'text/plain';
        if (type === 'poll' || type === 'location' || type === 'vcard' || type === 'event') return 'text/json';
        return this._raw.mime;
    }
    /** Texto del mensaje o caption del media. / Message text or media caption. */
    get caption(): string {
        return this._raw.caption;
    }
    /** Estado legible del mensaje. / Readable message state. */
    get status(): (typeof STATUS)[number] {
        return STATUS[this._raw.status] ?? 'pending';
    }
    /** true si el mensaje fue visto. / true when the message was seen. */
    get read(): boolean {
        return this._raw.status >= 4;
    }
    /** true si está destacado. / true when starred. */
    get starred(): boolean {
        return this._raw.starred;
    }
    /** true si fue reenviado. / true when forwarded. */
    get forwarded(): boolean {
        return this._raw.forwarded;
    }
    /** true si fue editado. / true when edited. */
    get edited(): boolean {
        return this._raw.edited;
    }
    /** true si es de una sola lectura (view-once). / true when view-once. */
    get once(): boolean {
        const msg = this._raw.raw.message;
        return Boolean(msg?.viewOnceMessage ?? msg?.viewOnceMessageV2 ?? msg?.viewOnceMessageV2Extension);
    }
    /** Fecha de creación en ISO UTC. / Creation date as ISO UTC. */
    get created_at(): string {
        return new Date(this._raw.created_at).toISOString();
    }
    /** Vencimiento del mensaje temporal en ISO UTC, o null. / Ephemeral expiration as ISO UTC, or null. */
    get expires_at(): string | null {
        return this._raw.deleted_at != null ? new Date(this._raw.deleted_at).toISOString() : null;
    }

    /**
     * Contacto autor del mensaje, desde el engine (ficha mínima si no está persistido).
     * Message author contact, from the engine (minimal card when not persisted).
     *
     * @returns Contacto / Contact
     */
    async author(): Promise<InstanceType<WhatsApp['Contact']>> {
        const cached = deserialize<Contact['_raw']>(await this._wa.engine.get(`/contact/${this._raw.author}`));
        return new this._wa.Contact(cached ?? { id: this._raw.author });
    }

    /**
     * Chat al que pertenece el mensaje.
     * Chat the message belongs to.
     *
     * @returns Chat / Chat
     */
    async chat(): Promise<InstanceType<WhatsApp['Chat']>> {
        const cached = deserialize<Chat['_raw']>(await this._wa.engine.get(`/chat/${this._raw.cid}`));
        return new this._wa.Chat(cached ?? { id: this._raw.cid });
    }

    /**
     * Mensaje citado cuando hay `mid`, o null.
     * Quoted message when `mid` exists, or null.
     *
     * @returns Mensaje citado o null / Quoted message or null
     */
    async message(): Promise<Message | null> {
        return this._raw.mid ? Message.get(this._wa, this._raw.cid, this._raw.mid) : null;
    }

    /**
     * Contenido del mensaje: texto como su caption, media como binario, y
     * poll/location/vcard/event como JSON.
     * Message content: text as its caption, media as binary, and
     * poll/location/vcard/event as JSON.
     *
     * @returns Buffer del contenido / Content buffer
     */
    async content(): Promise<Buffer> {
        return (await read_content(this._wa, `/chat/${this._raw.cid}/message/${this._raw.id}/content`)) ?? Buffer.alloc(0);
    }

    /**
     * Stream del contenido; para media descarga de baileys si el cache falta.
     * Content stream; media falls back to a baileys download when the cache is missing.
     *
     * @returns Readable del contenido / Content readable
     */
    async stream(): Promise<Readable> {
        return media_stream(this._wa, this._raw);
    }

    /**
     * Reacciones del mensaje agrupadas por emoji con su conteo.
     * Message reactions grouped by emoji with their count.
     *
     * @returns Conteo por emoji / Per-emoji count
     */
    async reactions(): Promise<{ emoji: string; count: number }[]> {
        const counts = new Map<string, number>();
        for (const { emoji } of this._raw.reactions ?? []) {
            counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
        }
        return [...counts.entries()].map(([emoji, count]) => ({ emoji, count }));
    }

    /**
     * Reacciona al mensaje; el emoji vacío retira la reacción.
     * Reacts to the message; an empty emoji removes the reaction.
     *
     * @param emoji - Emoji o '' / Emoji or ''
     * @returns true si se envió / true when sent
     */
    async react(emoji: string): Promise<boolean> {
        let ok = false;
        const socket = internals(this._wa).socket;
        if (socket) {
            const { cid, id, me, author } = this._raw;
            await socket.sendMessage(cid, {
                react: {
                    text: emoji,
                    key: { remoteJid: cid, id, fromMe: me, ...(cid.endsWith('@g.us') && !me && { participant: author }) },
                },
            });
            ok = true;
        }
        return ok;
    }

    /**
     * Destaca o quita el destacado del mensaje.
     * Stars or unstars the message.
     *
     * @param value - true destaca / true stars
     * @returns true si se envió / true when sent
     */
    async star(value: boolean): Promise<boolean> {
        let ok = false;
        const socket = internals(this._wa).socket;
        if (socket) {
            const doc = this._raw;
            await socket.chatModify({ star: { messages: [{ id: doc.id, fromMe: doc.me }], star: value } }, doc.cid);
            doc.starred = value;
            await this._wa.engine.set(`/chat/${doc.cid}/message/${doc.id}`, serialize(doc), doc.created_at);
            ok = true;
        }
        return ok;
    }

    /**
     * Marca el mensaje como leído.
     * Marks the message as read.
     *
     * @returns true si se envió / true when sent
     */
    async seen(): Promise<boolean> {
        let ok = false;
        const socket = internals(this._wa).socket;
        if (socket) {
            const { cid, id, author } = this._raw;
            await socket.readMessages([
                { remoteJid: cid, id, participant: cid.endsWith('@g.us') ? author : undefined },
            ]);
            ok = true;
        }
        return ok;
    }

    /**
     * Edita el caption del mensaje propio (texto, imagen o video).
     * Edits the own message caption (text, image or video).
     *
     * @param caption - Texto nuevo / New text
     * @returns true si se editó / true when edited
     */
    async edit(caption: string): Promise<boolean> {
        const doc = this._raw;
        let ok = false;
        const socket = internals(this._wa).socket;
        if (socket && doc.me) {
            if (doc.type === 'text') {
                await socket.sendMessage(doc.cid, {
                    text: caption,
                    edit: { remoteJid: doc.cid, id: doc.id, fromMe: true },
                } as never);
                const content_type = getContentType(doc.raw.message ?? {});
                doc.raw.message =
                    content_type === 'conversation' ? { conversation: caption } : { extendedTextMessage: { text: caption } };
                ok = true;
            } else if (doc.type === 'image' || doc.type === 'video') {
                const media_key = doc.type === 'image' ? 'imageMessage' : 'videoMessage';
                const media = doc.raw.message?.[media_key];
                if (media) {
                    const edited = { [media_key]: { ...media, caption } };
                    await socket.relayMessage(
                        doc.cid,
                        {
                            protocolMessage: {
                                key: { remoteJid: doc.cid, id: doc.id, fromMe: true },
                                type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
                                editedMessage: edited,
                                timestampMs: Date.now(),
                            },
                        },
                        { messageId: generateMessageID() }
                    );
                    doc.raw.message = { ...doc.raw.message, ...edited };
                    ok = true;
                }
            }
            if (ok) {
                doc.caption = caption;
                doc.edited = true;
                await this._wa.engine.set(`/chat/${doc.cid}/message/${doc.id}`, serialize(doc), doc.created_at);
            }
        }
        return ok;
    }

    /**
     * Reenvía el mensaje a otro chat.
     * Forwards the message to another chat.
     *
     * @param target - CID, Chat o Contact destino / Target CID, Chat or Contact
     * @returns true si se reenvió / true when forwarded
     */
    async forward(target: string | Chat | Contact): Promise<boolean> {
        const doc = this._raw;
        const to_cid =
            typeof target === 'string' ? target : target instanceof Chat ? target._raw.id : (target.jid ?? target.lid ?? '');
        let ok = false;
        const socket = internals(this._wa).socket;
        if (socket && to_cid) {
            const jid = await internals(this._wa).resolve_jid(to_cid);
            if (jid && doc.raw.message) {
                try {
                    const wa_msg = generateWAMessageFromContent(jid, generateForwardMessageContent(doc.raw, false), {
                        userJid: socket.user?.id ?? '',
                    });
                    if (wa_msg.message && wa_msg.key?.id) {
                        await socket.relayMessage(jid, wa_msg.message, { messageId: wa_msg.key.id });
                        ok = true;
                    }
                } catch {
                    /* forward content may be unsupported */
                }
            }
        }
        return ok;
    }

    /**
     * Elimina el mensaje: solo en mi dispositivo por defecto, para todos con `true`.
     * Deletes the message: this device only by default, for everyone with `true`.
     *
     * @param all - true elimina para todos / true deletes for everyone
     * @returns true si se eliminó / true when deleted
     */
    async delete(all = false): Promise<boolean> {
        const doc = this._raw;
        let ok = false;
        const socket = internals(this._wa).socket;
        if (socket) {
            if (all) {
                await socket.sendMessage(doc.cid, { delete: { remoteJid: doc.cid, id: doc.id, fromMe: doc.me } });
            } else {
                await socket.chatModify(
                    {
                        deleteForMe: {
                            deleteMedia: false,
                            key: { remoteJid: doc.cid, id: doc.id, fromMe: doc.me },
                            timestamp: Date.now(),
                        },
                    },
                    doc.cid
                );
            }
            await this._wa.engine.unset(`/chat/${doc.cid}/message/${doc.id}`);
            ok = true;
        }
        return ok;
    }

    /** Responde con texto. / Replies with text. */
    async text(caption: string, extra: Omit<SendExtra, 'mid'> = {}) {
        return Message.text(this._wa, this._raw.cid, caption, { ...extra, mid: this._raw.id });
    }
    /** Responde con imagen. / Replies with an image. */
    async image(buf: Buffer, extra: Omit<SendExtra, 'mid'> & { caption?: string } = {}) {
        return Message.image(this._wa, this._raw.cid, buf, { ...extra, mid: this._raw.id });
    }
    /** Responde con video. / Replies with a video. */
    async video(buf: Buffer, extra: Omit<SendExtra, 'mid'> & { caption?: string } = {}) {
        return Message.video(this._wa, this._raw.cid, buf, { ...extra, mid: this._raw.id });
    }
    /** Responde con audio. / Replies with audio. */
    async audio(buf: Buffer, extra: Omit<SendExtra, 'mid'> & { ptt?: boolean } = {}) {
        return Message.audio(this._wa, this._raw.cid, buf, { ...extra, mid: this._raw.id });
    }
    /** Responde con ubicación. / Replies with a location. */
    async location(loc: { lat: number; lng: number }, extra: Omit<SendExtra, 'mid'> = {}) {
        return Message.location(this._wa, this._raw.cid, loc, { ...extra, mid: this._raw.id });
    }
    /** Responde con encuesta. / Replies with a poll. */
    async poll(input: { content: string; options: { content: string }[] }, extra: Omit<SendExtra, 'mid'> & { multiple?: boolean } = {}) {
        return Message.poll(this._wa, this._raw.cid, input, { ...extra, mid: this._raw.id });
    }
    /** Responde con documento. / Replies with a document. */
    async document(buf: Buffer, extra: Omit<SendExtra, 'mid'> & { file_name: string; mimetype?: string; caption?: string }) {
        return Message.document(this._wa, this._raw.cid, buf, { ...extra, mid: this._raw.id });
    }
    /** Responde con tarjeta(s) de contacto. / Replies with contact card(s). */
    async vcard(contacts: { name: string; phone: string }[], extra: Omit<SendExtra, 'mid'> = {}) {
        return Message.vcard(this._wa, this._raw.cid, contacts, { ...extra, mid: this._raw.id });
    }
    /** Responde con evento. / Replies with an event. */
    async event(
        data: { name: string; caption?: string; start: Date; end?: Date; place?: { lat: number; lng: number } },
        extra: Omit<SendExtra, 'mid'> = {}
    ) {
        return Message.event(this._wa, this._raw.cid, data, { ...extra, mid: this._raw.id });
    }

    /**
     * Obtiene un mensaje por chat y id.
     * Retrieves a message by chat and id.
     *
     * @param wa - Cliente dueño / Owner client
     * @param cid - Identificador del chat / Chat identifier
     * @param mid - Identificador del mensaje / Message identifier
     * @returns Mensaje o null / Message or null
     */
    static async get(wa: WhatsApp, cid: string, mid: string): Promise<Message | null> {
        const jid = await internals(wa).resolve_jid(cid);
        if (jid) {
            const doc = deserialize<Message['_raw']>(await wa.engine.get(`/chat/${jid}/message/${mid}`));
            if (doc) return message(wa, doc);
        }
        return null;
    }

    /**
     * Pagina los mensajes de un chat desde el más reciente.
     * Paginates chat messages from the most recent one.
     *
     * @param wa - Cliente dueño / Owner client
     * @param cid - Identificador del chat / Chat identifier
     * @param offset - Desplazamiento / Offset
     * @param limit - Tamaño de página / Page size
     * @returns Página de mensajes / Message page
     */
    static async list(wa: WhatsApp, cid: string, offset = 0, limit = 50): Promise<Message[]> {
        const jid = await internals(wa).resolve_jid(cid);
        if (jid) {
            return (await wa.engine.list(`/chat/${jid}/message`, offset, limit))
                .map((raw) => deserialize<Message['_raw']>(raw))
                .filter((doc): doc is Message['_raw'] => doc !== null)
                .map((doc) => message(wa, doc));
        }
        return [];
    }

    /** Envía texto. / Sends text. */
    static async text(wa: WhatsApp, cid: string, caption: string, extra: SendExtra = {}) {
        return send(wa, cid, { text: caption }, undefined, extra);
    }
    /** Envía imagen. / Sends an image. */
    static async image(wa: WhatsApp, cid: string, buf: Buffer, extra: SendExtra & { caption?: string } = {}) {
        return send(wa, cid, { image: buf, caption: extra.caption }, buf, extra);
    }
    /** Envía video. / Sends a video. */
    static async video(wa: WhatsApp, cid: string, buf: Buffer, extra: SendExtra & { caption?: string } = {}) {
        return send(wa, cid, { video: buf, caption: extra.caption }, buf, extra);
    }
    /** Envía audio. / Sends audio. */
    static async audio(wa: WhatsApp, cid: string, buf: Buffer, extra: SendExtra & { ptt?: boolean } = {}) {
        return send(wa, cid, { audio: buf, ptt: extra.ptt ?? true }, buf, extra);
    }
    /** Envía ubicación. / Sends a location. */
    static async location(wa: WhatsApp, cid: string, loc: { lat: number; lng: number }, extra: SendExtra = {}) {
        return send(wa, cid, { location: { degreesLatitude: loc.lat, degreesLongitude: loc.lng } }, undefined, extra);
    }
    /** Envía encuesta. / Sends a poll. */
    static async poll(
        wa: WhatsApp,
        cid: string,
        input: { content: string; options: { content: string }[] },
        extra: SendExtra & { multiple?: boolean } = {}
    ) {
        const multiple = extra.multiple ?? false;
        return send(
            wa,
            cid,
            {
                poll: {
                    name: input.content,
                    values: input.options.map((option) => option.content),
                    selectableCount: multiple ? 0 : 1,
                },
            },
            undefined,
            extra,
            { multiple },
        );
    }
    /** Envía documento. / Sends a document. */
    static async document(
        wa: WhatsApp,
        cid: string,
        buf: Buffer,
        extra: SendExtra & { file_name: string; mimetype?: string; caption?: string }
    ) {
        return send(
            wa,
            cid,
            { document: buf, fileName: extra.file_name, mimetype: extra.mimetype ?? 'application/octet-stream', caption: extra.caption },
            buf,
            extra,
        );
    }
    /** Envía tarjeta(s) de contacto. / Sends contact card(s). */
    static async vcard(wa: WhatsApp, cid: string, contacts: { name: string; phone: string }[], extra: SendExtra = {}) {
        const built = contacts.map((entry) => ({
            displayName: entry.name,
            vcard: [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${entry.name}`,
                `TEL;type=CELL;waid=${entry.phone.replace(/\D+/g, '')}:${entry.phone}`,
                'END:VCARD',
            ].join('\n'),
        }));
        return send(wa, cid, { contacts: { contacts: built } }, Buffer.from(built.map((entry) => entry.vcard).join('\n'), 'utf-8'), extra);
    }
    /** Envía evento. / Sends an event. */
    static async event(
        wa: WhatsApp,
        cid: string,
        data: { name: string; caption?: string; start: Date; end?: Date; place?: { lat: number; lng: number } },
        extra: SendExtra = {}
    ) {
        const binary = Buffer.from(
            JSON.stringify({ name: data.name, caption: data.caption, start: data.start.getTime(), end: data.end?.getTime() ?? null }),
            'utf-8'
        );
        return send(
            wa,
            cid,
            {
                event: {
                    name: data.name,
                    description: data.caption,
                    startDate: data.start,
                    endDate: data.end,
                    location: data.place ? { degreesLatitude: data.place.lat, degreesLongitude: data.place.lng } : undefined,
                },
            },
            binary,
            extra,
        );
    }

    /** Reacciona a un mensaje por id. / Reacts to a message by id. */
    static async react(wa: WhatsApp, cid: string, mid: string, emoji: string): Promise<boolean> {
        const msg = await Message.get(wa, cid, mid);
        return msg ? msg.react(emoji) : false;
    }
    /** Destaca un mensaje por id. / Stars a message by id. */
    static async star(wa: WhatsApp, cid: string, mid: string, value: boolean): Promise<boolean> {
        const msg = await Message.get(wa, cid, mid);
        return msg ? msg.star(value) : false;
    }
    /** Marca un mensaje como leído por id. / Marks a message as read by id. */
    static async seen(wa: WhatsApp, cid: string, mid: string): Promise<boolean> {
        const msg = await Message.get(wa, cid, mid);
        return msg ? msg.seen() : false;
    }
    /** Edita un mensaje por id. / Edits a message by id. */
    static async edit(wa: WhatsApp, cid: string, mid: string, caption: string): Promise<boolean> {
        const msg = await Message.get(wa, cid, mid);
        return msg ? msg.edit(caption) : false;
    }
    /** Reenvía un mensaje por id. / Forwards a message by id. */
    static async forward(wa: WhatsApp, cid: string, mid: string, target: string | Chat | Contact): Promise<boolean> {
        const msg = await Message.get(wa, cid, mid);
        return msg ? msg.forward(target) : false;
    }
    /** Elimina un mensaje por id. / Deletes a message by id. */
    static async delete(wa: WhatsApp, cid: string, mid: string, all = false): Promise<boolean> {
        const msg = await Message.get(wa, cid, mid);
        return msg ? msg.delete(all) : false;
    }
    /** Reacciones de un mensaje por id. / Reactions of a message by id. */
    static async reactions(wa: WhatsApp, cid: string, mid: string): Promise<{ emoji: string; count: number }[]> {
        const msg = await Message.get(wa, cid, mid);
        return msg ? msg.reactions() : [];
    }
}

/**
 * Mensaje de texto; `preview()` expone la tarjeta del enlace embebido.
 * Text message; `preview()` exposes the embedded link card.
 */
export class Text extends Message {
    /**
     * Preview del enlace del texto, o null cuando no trae metadata.
     * Text link preview, or null when it carries no metadata.
     *
     * @returns { link, name, content, thumb } o null / { link, name, content, thumb } or null
     */
    async preview(): Promise<{ link: string; name: string | null; content: string | null; thumb: Buffer | null } | null> {
        const ext = this._raw.raw.message?.extendedTextMessage;
        if (ext?.matchedText && (ext.title || ext.description)) {
            return {
                link: ext.matchedText,
                name: ext.title ?? null,
                content: ext.description ?? null,
                thumb: to_buffer(ext.jpegThumbnail),
            };
        }
        return null;
    }
}

/**
 * Mensaje de imagen: dimensiones, peso y miniatura.
 * Image message: dimensions, size and thumbnail.
 */
export class Image extends Message {
    /** @internal */
    private get _media() {
        return unwrap(this._raw.raw.message ?? {}).imageMessage;
    }
    /** Ancho en píxeles. / Width in pixels. */
    get width(): number {
        return this._media?.width ?? 0;
    }
    /** Alto en píxeles. / Height in pixels. */
    get height(): number {
        return this._media?.height ?? 0;
    }
    /** Peso en bytes. / Size in bytes. */
    get size(): number {
        return to_number(this._media?.fileLength);
    }
    /**
     * Miniatura JPEG embebida, o null.
     * Embedded JPEG thumbnail, or null.
     *
     * @returns Buffer de la miniatura o null / Thumbnail buffer or null
     */
    async thumb(): Promise<Buffer | null> {
        return to_buffer(this._media?.jpegThumbnail);
    }
    async content(): Promise<Buffer> {
        return drain(await this.stream());
    }
}

/**
 * Mensaje de video: dimensiones, duración, peso y miniatura.
 * Video message: dimensions, duration, size and thumbnail.
 */
export class Video extends Message {
    /** @internal */
    private get _media() {
        return unwrap(this._raw.raw.message ?? {}).videoMessage;
    }
    /** Ancho en píxeles. / Width in pixels. */
    get width(): number {
        return this._media?.width ?? 0;
    }
    /** Alto en píxeles. / Height in pixels. */
    get height(): number {
        return this._media?.height ?? 0;
    }
    /** Duración en segundos. / Duration in seconds. */
    get duration(): number {
        return this._media?.seconds ?? 0;
    }
    /** Peso en bytes. / Size in bytes. */
    get size(): number {
        return to_number(this._media?.fileLength);
    }
    /**
     * Miniatura JPEG embebida, o null.
     * Embedded JPEG thumbnail, or null.
     *
     * @returns Buffer de la miniatura o null / Thumbnail buffer or null
     */
    async thumb(): Promise<Buffer | null> {
        return to_buffer(this._media?.jpegThumbnail);
    }
    async content(): Promise<Buffer> {
        return drain(await this.stream());
    }
}

/**
 * Mensaje de audio: nota de voz o archivo, con forma de onda del protocolo.
 * Audio message: voice note or file, with the protocol waveform.
 */
export class Audio extends Message {
    /** @internal */
    private get _media() {
        return unwrap(this._raw.raw.message ?? {}).audioMessage;
    }
    /** true si es nota de voz. / true when push-to-talk. */
    get ptt(): boolean {
        return this._media?.ptt === true;
    }
    /** Duración en segundos. / Duration in seconds. */
    get duration(): number {
        return this._media?.seconds ?? 0;
    }
    /** Peso en bytes. / Size in bytes. */
    get size(): number {
        return to_number(this._media?.fileLength);
    }
    /** Forma de onda 0-100 lista para pintar. / Paint-ready 0-100 waveform. */
    get waveform(): number[] {
        const wave = this._media?.waveform;
        const bytes = wave instanceof Uint8Array ? wave : typeof wave === 'string' ? Buffer.from(wave, 'base64') : Buffer.alloc(0);
        return Array.from(bytes);
    }
    async content(): Promise<Buffer> {
        return drain(await this.stream());
    }
}

/**
 * Mensaje de sticker: dimensiones, peso y animación.
 * Sticker message: dimensions, size and animation.
 */
export class Sticker extends Message {
    /** @internal */
    private get _media() {
        return unwrap(this._raw.raw.message ?? {}).stickerMessage;
    }
    /** Ancho en píxeles. / Width in pixels. */
    get width(): number {
        return this._media?.width ?? 0;
    }
    /** Alto en píxeles. / Height in pixels. */
    get height(): number {
        return this._media?.height ?? 0;
    }
    /** true si el sticker es animado. / true when animated. */
    get animated(): boolean {
        return this._media?.isAnimated === true;
    }
    /** Peso en bytes. / Size in bytes. */
    get size(): number {
        return to_number(this._media?.fileLength);
    }
    async content(): Promise<Buffer> {
        return drain(await this.stream());
    }
}

/**
 * Mensaje de documento; el MIME real vive en `mime` de la base.
 * Document message; the actual MIME lives in the base `mime`.
 */
export class Document extends Message {
    /** Peso en bytes. / Size in bytes. */
    get size(): number {
        const media = unwrap(this._raw.raw.message ?? {}).documentMessage;
        return to_number(media?.fileLength);
    }
    async content(): Promise<Buffer> {
        return drain(await this.stream());
    }
}

/**
 * Mensaje de ubicación, fija o en vivo.
 * Location message, static or live.
 */
export class Location extends Message {
    /** @internal */
    private get _loc() {
        return this._raw.raw.message?.locationMessage ?? this._raw.raw.message?.liveLocationMessage;
    }
    /** Latitud en grados. / Latitude in degrees. */
    get lat(): number {
        return this._loc?.degreesLatitude ?? 0;
    }
    /** Longitud en grados. / Longitude in degrees. */
    get lng(): number {
        return this._loc?.degreesLongitude ?? 0;
    }
    /** true si es ubicación en tiempo real. / true when live location. */
    get live(): boolean {
        return Boolean(this._raw.raw.message?.liveLocationMessage);
    }
    /** URL de Google Maps de la coordenada. / Google Maps URL for the coordinate. */
    get link(): string {
        return `https://www.google.com/maps/@${this.lat},${this.lng},15z`;
    }
}

/**
 * Mensaje de encuesta: opciones con conteo, votos por contacto y voto propio.
 * Poll message: options with counts, per-contact votes and self-voting.
 */
export class Poll extends Message {
    /** @internal */
    private get _poll() {
        const msg = this._raw.raw.message;
        return msg?.pollCreationMessage ?? msg?.pollCreationMessageV2 ?? msg?.pollCreationMessageV3;
    }

    /** @internal Updates de voto con los bytes normalizados post-engine. / Vote updates with post-engine normalized bytes. */
    private get _updates() {
        return (this._raw.raw.pollUpdates ?? []).map((update) => ({
            ...update,
            vote: update.vote
                ? {
                    ...update.vote,
                    selectedOptions: (update.vote.selectedOptions ?? []).map((option) =>
                        typeof option === 'string' ? Buffer.from(option, 'base64') : option
                    ),
                }
                : update.vote,
        }));
    }

    /** true si admite varias respuestas. / true when multi-select. */
    get multiple(): boolean {
        if (typeof this._raw.multiple === 'boolean') {
            return this._raw.multiple;
        }
        return (this._poll?.selectableOptionsCount ?? 1) !== 1;
    }

    /** Opciones con su conteo de votos. / Options with their vote counts. */
    get options(): { name: string; count: number }[] {
        const aggregated = getAggregateVotesInPollMessage(
            { message: this._raw.raw.message ?? undefined, pollUpdates: this._updates },
            internals(this._wa).socket?.user?.id
        );
        const counts = new Map(aggregated.map((entry) => [entry.name, entry.voters.length]));
        return (this._poll?.options ?? []).map((option) => ({
            name: option.optionName ?? '',
            count: counts.get(option.optionName ?? '') ?? 0,
        }));
    }

    /**
     * Votos individuales: opción elegida y teléfono del votante.
     * Individual votes: chosen option and voter phone.
     *
     * @returns Lista de votos / Vote list
     */
    async votes(): Promise<{ name: string; contact: string }[]> {
        const aggregated = getAggregateVotesInPollMessage(
            { message: this._raw.raw.message ?? undefined, pollUpdates: this._updates },
            internals(this._wa).socket?.user?.id
        );
        const result: { name: string; contact: string }[] = [];
        for (const entry of aggregated) {
            for (const voter of entry.voters) {
                const jid = await internals(this._wa).resolve_jid(voter);
                result.push({ name: entry.name, contact: (jid ?? voter).split('@')[0].split(':')[0] });
            }
        }
        return result;
    }

    /**
     * Vota en la encuesta con uno o varios índices. Cifra el voto (HMAC+AES-GCM) y lo
     * enruta al chat @lid con la identidad LID propia. Best-effort: el voto entrante
     * descifra correcto, pero WhatsApp no propaga el voto emitido desde un dispositivo
     * vinculado (companion).
     * Votes in the poll with one or more indexes. Encrypts the vote (HMAC+AES-GCM) and
     * routes it to the @lid chat with the own LID identity. Best-effort: incoming votes
     * decrypt fine, but WhatsApp does not propagate votes emitted from a linked
     * (companion) device.
     *
     * @param index - Índice o índices de la opción / Option index or indexes
     * @returns true si el voto se emitió / true when the vote was relayed
     */
    async select(index: number | number[]): Promise<boolean> {
        const doc = this._raw;
        const opts = this._poll?.options ?? [];
        const selected_options = (Array.isArray(index) ? index : [index])
            .filter((i) => i >= 0 && i < opts.length)
            .map((i) => sha256(Buffer.from(opts[i].optionName ?? '')));
        const secret_raw = doc.raw.message?.messageContextInfo?.messageSecret;
        const poll_enc_key = typeof secret_raw === 'string' ? Buffer.from(secret_raw, 'base64') : secret_raw;
        const socket = internals(this._wa).socket;
        if (!poll_enc_key || !socket || selected_options.length === 0) {
            return false;
        }

        const poll_key = doc.raw.key ?? {};
        const self_id = socket.user?.id ?? '';
        const self_lid = (socket.user as { lid?: string })?.lid ?? '';
        let dest = doc.cid;
        if (poll_key.remoteJid?.endsWith('@lid')) {
            dest = poll_key.remoteJid;
        } else if (!doc.cid.endsWith('@lid')) {
            const contact_raw = deserialize<{ lid?: string | null }>(await this._wa.engine.get(`/contact/${doc.cid}`));
            const mapped = await (socket as unknown as {
                signalRepository?: { lidMapping?: { getLIDForPN(pn: string): Promise<string | null | undefined> } };
            }).signalRepository?.lidMapping?.getLIDForPN(doc.cid).catch(() => null);
            dest = contact_raw?.lid ?? mapped ?? doc.cid;
        }

        const self_for_send = dest.endsWith('@lid') && self_lid ? self_lid : self_id;
        const voter_jid = jidNormalizedUser(self_for_send);
        const poll_creator_jid = jidNormalizedUser(
            poll_key.fromMe
                ? self_for_send
                : poll_key.remoteJid?.endsWith('@lid')
                    ? poll_key.remoteJid
                    : getKeyAuthor(poll_key, self_id)
        );

        const sign = Buffer.concat([
            Buffer.from(doc.id),
            Buffer.from(poll_creator_jid),
            Buffer.from(voter_jid),
            Buffer.from('Poll Vote'),
            new Uint8Array([1]),
        ]);
        const enc_key = hmacSign(sign, hmacSign(poll_enc_key, new Uint8Array(32), 'sha256'), 'sha256');
        const enc_iv = randomBytes(12);
        const enc_payload = aesEncryptGCM(
            proto.Message.PollVoteMessage.encode({ selectedOptions: selected_options }).finish(),
            enc_key,
            enc_iv,
            Buffer.from(`${doc.id}\x00${voter_jid}`)
        );

        const msg_id = generateMessageID();
        await socket.relayMessage(
            dest,
            {
                pollUpdateMessage: {
                    pollCreationMessageKey: dest === doc.cid ? doc.raw.key : { ...doc.raw.key, remoteJid: dest },
                    vote: { encPayload: enc_payload, encIv: enc_iv },
                    senderTimestampMs: Date.now(),
                },
            },
            { messageId: msg_id }
        );
        updateMessageWithPollUpdate(doc.raw, {
            pollUpdateMessageKey: { remoteJid: doc.raw.key?.remoteJid ?? doc.cid, fromMe: true, id: msg_id },
            vote: { selectedOptions: selected_options },
            senderTimestampMs: Date.now(),
        });
        await this._wa.engine.set(`/chat/${doc.cid}/message/${doc.id}`, serialize(doc), doc.created_at);
        this._wa.emit('message:updated', this, await this.chat(), this._wa);
        return true;
    }
}

/**
 * Mensaje de tarjeta(s) de contacto.
 * Contact card(s) message.
 */
export class VCard extends Message {
    /** Contactos de la tarjeta. / Card contacts. */
    get contacts(): { name: string; phone: string }[] {
        const msg = this._raw.raw.message;
        const raw = msg?.contactsArrayMessage?.contacts ?? (msg?.contactMessage ? [msg.contactMessage] : []);
        return raw.map((card) => {
            const tel = (card.vcard ?? '').match(/TEL[^:]*:(.+)/);
            return { name: card.displayName ?? '', phone: tel ? tel[1].trim() : '' };
        });
    }
}

/**
 * Mensaje de evento de calendario.
 * Calendar event message.
 */
export class Event extends Message {
    /** @internal */
    private get _event() {
        return this._raw.raw.message?.eventMessage;
    }
    /** Nombre del evento. / Event name. */
    get name(): string {
        return this._event?.name ?? '';
    }
    /** Inicio en ISO UTC. / Start as ISO UTC. */
    get start(): string {
        return new Date(to_number(this._event?.startTime) * 1000).toISOString();
    }
    /** Fin en ISO UTC, o null. / End as ISO UTC, or null. */
    get end(): string | null {
        const end = this._event?.endTime;
        return end == null ? null : new Date(to_number(end) * 1000).toISOString();
    }
    /** true si fue cancelado. / true when canceled. */
    get canceled(): boolean {
        return this._event?.isCanceled ?? false;
    }
    /** Link de unión, si aplica. / Join link, if any. */
    get link(): string {
        return this._event?.joinLink ?? '';
    }
    /** Ubicación del evento, o null. / Event location, or null. */
    get place(): { lat: number; lng: number } | null {
        const loc = this._event?.location;
        return loc ? { lat: loc.degreesLatitude ?? 0, lng: loc.degreesLongitude ?? 0 } : null;
    }
}

/**
 * Factoría de Message: evalúa el tipo y retorna la instancia de la subclase correcta.
 * Acepta el documento persistido o el mensaje crudo de baileys — en ese caso el
 * documento se deriva aquí mismo (id, tipo, autor, caption, mime, fechas).
 * Message factory: evaluates the type and returns the right subclass instance. Accepts
 * the persisted document or the raw baileys message — in that case the document is
 * derived right here (id, type, author, caption, mime, dates).
 *
 * @param wa - Instancia principal / Main WhatsApp instance
 * @param raw - Documento persistido o WAMessage crudo / Persisted document or raw WAMessage
 * @returns Instancia del tipo correcto / Right-type instance
 */
export function message(wa: WhatsApp, raw: Message['_raw'] | WAMessage): Message {
    let doc: Message['_raw'];
    if ('key' in raw) {
        const key = raw.key ?? {};
        const unwrapped = unwrap(raw.message ?? {});
        const content_type = getContentType(unwrapped);
        const msg_type = MESSAGE_TYPE_MAP[content_type as keyof typeof MESSAGE_TYPE_MAP] ?? 'text';
        const msg_content = unwrapped[content_type as keyof typeof unwrapped] as
            | Record<string, unknown>
            | string
            | undefined;
        const context_info = (msg_content as { contextInfo?: proto.IContextInfo } | undefined)?.contextInfo;
        const ephemeral_duration = raw.ephemeralDuration ?? context_info?.expiration;
        const self_id = internals(wa).socket?.user?.id;
        doc = {
            id: key.id ?? '',
            cid: (key as { remoteJidAlt?: string }).remoteJidAlt ?? key.remoteJid ?? '',
            mid: context_info?.stanzaId ?? null,
            me: key.fromMe ?? false,
            type: msg_type,
            author:
                key.fromMe && self_id
                    ? jidNormalizedUser(self_id)
                    : key.participant || (key as { remoteJidAlt?: string }).remoteJidAlt || key.remoteJid || '',
            status: raw.status ?? 1,
            starred: raw.starred ?? false,
            forwarded: context_info?.isForwarded ?? false,
            created_at: (Number(raw.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000,
            deleted_at:
                raw.ephemeralStartTimestamp != null && ephemeral_duration != null
                    ? (Number(raw.ephemeralStartTimestamp) + ephemeral_duration) * 1000
                    : null,
            mime:
                typeof msg_content === 'object' && msg_type !== 'text'
                    ? ((msg_content?.mimetype as string) ?? 'application/octet-stream')
                    : 'text/plain',
            caption:
                typeof msg_content === 'string'
                    ? msg_content
                    : msg_type === 'event'
                        ? (((msg_content as Record<string, unknown> | undefined)?.description as string) ?? '')
                        : ((msg_content?.caption as string) ??
                            (msg_content?.text as string) ??
                            (msg_content?.name as string) ??
                            (msg_content?.displayName as string) ??
                            ''),
            edited: false,
            raw,
        };
    } else {
        doc = raw;
    }
    const types = {
        text: Text,
        image: Image,
        video: Video,
        audio: Audio,
        sticker: Sticker,
        document: Document,
        location: Location,
        poll: Poll,
        vcard: VCard,
        event: Event,
    } as const;
    return new (types[doc.type] ?? Message)(wa, doc);
}
