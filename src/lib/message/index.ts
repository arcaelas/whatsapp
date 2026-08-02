/**
 * @file message/index.ts
 * @description Entidad Message — clase base con getters puros y subclases por tipo;
 * `message(init)` devuelve la clase ligada a la sesión con los envíos y lecturas.
 * Message entity — pure-getter base class with per-type subclasses; `message(init)`
 * returns the session-bound class with sends and reads.
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
    type WASocket,
} from 'baileys';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import Chat from '~/lib/chat';
import type Contact from '~/lib/contact';
import { deserialize, jid_of, serialize, type Engine } from '~/lib/store';
import type WhatsApp from '~/lib/whatsapp';

/** Estados legibles indexados por el status numérico de baileys. / Readable states indexed by the baileys numeric status. */
const STATUS = ['error', 'pending', 'sent', 'delivered', 'read', 'played'] as const;

/** Sesión activa que liga la entidad. / Active session binding the entity. */
type Init = { wa: WhatsApp; engine: Engine; socket: WASocket };

/** Opciones comunes de envío. / Common send options. */
type Extra = { mid?: string; once?: boolean };

/** Desenvuelve los wrappers de contenido (view-once, documento con caption). / Unwraps content wrappers (view-once, captioned document). */
const unwrap = (msg: NonNullable<WAMessage['message']>) =>
    msg.viewOnceMessage?.message ?? msg.viewOnceMessageV2?.message ?? msg.viewOnceMessageV2Extension?.message ?? msg.documentWithCaptionMessage?.message ?? msg;

/** Bytes del proto (Uint8Array en runtime, base64 tras el engine) como Buffer. / Proto bytes (runtime Uint8Array, post-engine base64) as a Buffer. */
const to_buffer = (value: Uint8Array | string | null | undefined): Buffer | null =>
    value instanceof Uint8Array && value.length ? Buffer.from(value) : typeof value === 'string' && value ? Buffer.from(value, 'base64') : null;

/**
 * Envío base: resuelve el destino, cita si hay `mid`, marca view-once, persiste el documento
 * con su binario y retorna la instancia del tipo correcto. La cita viaja en las opciones del
 * socket: dentro del contenido baileys la ignora.
 * Base send: resolves the target, quotes when `mid` is given, flags view-once, persists the
 * document with its binary and returns the right-type instance. The quote travels in the
 * socket options: inside the content baileys ignores it.
 */
const send = async (init: Init, cid: string, content: Record<string, unknown>, binary?: Buffer, extra: Extra = {}, overrides?: Partial<Message['_raw']>): Promise<Message | null> => {
    const jid = await jid_of(init.engine, cid, init.socket);
    if (!jid) return null;
    const quoted = extra.mid ? deserialize<Message['_raw']>(await init.engine.get(`/chat/${jid}/message/${extra.mid}`))?.raw : undefined;
    const raw = await init.socket.sendMessage(jid, { ...content, ...(extra.once && { viewOnce: true }) } as never, { ...(quoted && { quoted }) });
    if (!raw?.key?.id) return null;
    const sent = new Message(init, raw);
    Object.assign(sent._raw, overrides);
    await init.engine.set(`/chat/${jid}/message/${raw.key.id}`, serialize(sent._raw), sent._raw.created_at);
    const path = `/chat/${jid}/message/${raw.key.id}/content`;
    if (binary) await (init.engine.set_buffer?.(path, binary) ?? init.engine.set(path, serialize({ data: binary.toString('base64') })));
    return sent;
};

/** Contenido proto de una encuesta. / Poll proto content. */
const poll_of = (input: { content: string; options: { content: string }[] }, multiple: boolean) =>
    ({ poll: { name: input.content, values: input.options.map((option) => option.content), selectableCount: multiple ? 0 : 1 } });

/** Contenido y binario de las tarjetas de contacto. / Contact cards content and binary. */
const vcards_of = (contacts: { name: string; phone: string }[]) => {
    const cards = contacts.map((entry) => ({
        displayName: entry.name,
        vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${entry.name}\nTEL;type=CELL;waid=${entry.phone.replace(/\D+/g, '')}:${entry.phone}\nEND:VCARD`,
    }));
    return { content: { contacts: { contacts: cards } }, binary: Buffer.from(cards.map((entry) => entry.vcard).join('\n'), 'utf-8') };
};

/** Contenido y binario del evento. / Event content and binary. */
const event_of = (data: { name: string; caption?: string; start: Date; end?: Date; place?: { lat: number; lng: number } }) => ({
    content: {
        event: {
            name: data.name,
            description: data.caption,
            startDate: data.start,
            endDate: data.end,
            location: data.place ? { degreesLatitude: data.place.lat, degreesLongitude: data.place.lng } : undefined,
        },
    },
    binary: Buffer.from(JSON.stringify({ name: data.name, caption: data.caption, start: data.start.getTime(), end: data.end?.getTime() ?? null }), 'utf-8'),
});

/**
 * Mensaje: recibe la sesión y el documento, deriva el estado con getters y opera contra
 * WhatsApp con sus métodos. Los de respuesta citan automáticamente este mensaje.
 * Message: receives the session and the document, derives state via getters and operates
 * against WhatsApp with its methods. Reply methods quote this message automatically.
 */
export default class Message {
    /** @internal Sesión dueña de la instancia. / Session owning the instance. */
    readonly _init!: Init;
    /**
     * @internal Documento persistido. `status`, `created_at` y `deleted_at` guardan los
     * números del protocolo; los getters los presentan legibles.
     * Persisted document. `status`, `created_at` and `deleted_at` keep the protocol numbers;
     * getters expose them readable.
     */
    readonly _raw!: {
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
    };

    /**
     * Recibe la sesión y el documento persistido, o el crudo de baileys: en ese caso el
     * documento se deriva aquí y se despacha la subclase del tipo — `new Message(init, raw)`
     * de una encuesta devuelve un `Poll`.
     * Receives the session and the persisted document, or the baileys raw: in that case the
     * document is derived here and the per-type subclass is dispatched — `new Message(init,
     * raw)` of a poll returns a `Poll`.
     */
    constructor(init: Init, raw: Message['_raw'] | WAMessage) {
        let doc = raw as Message['_raw'];
        if ('key' in raw) {
            const key = raw.key ?? {};
            const unwrapped = unwrap(raw.message ?? {});
            const kind = getContentType(unwrapped);
            const type = ({
                conversation: 'text', extendedTextMessage: 'text', imageMessage: 'image', videoMessage: 'video',
                audioMessage: 'audio', stickerMessage: 'sticker', locationMessage: 'location', liveLocationMessage: 'location',
                pollCreationMessage: 'poll', pollCreationMessageV2: 'poll', pollCreationMessageV3: 'poll',
                documentMessage: 'document', documentWithCaptionMessage: 'document', contactMessage: 'vcard',
                contactsArrayMessage: 'vcard', eventMessage: 'event',
            } as Record<string, Message['_raw']['type']>)[kind ?? ''] ?? 'text';
            const content = unwrapped[kind as keyof typeof unwrapped] as Record<string, unknown> | string | undefined;
            const context = (content as { contextInfo?: proto.IContextInfo } | undefined)?.contextInfo;
            const ephemeral = raw.ephemeralDuration ?? context?.expiration;
            doc = {
                id: key.id ?? '',
                cid: (key as { remoteJidAlt?: string }).remoteJidAlt ?? key.remoteJid ?? '',
                mid: context?.stanzaId ?? null,
                me: key.fromMe ?? false,
                type,
                author: key.fromMe && init.socket.user?.id
                    ? jidNormalizedUser(init.socket.user.id)
                    : key.participant || (key as { remoteJidAlt?: string }).remoteJidAlt || key.remoteJid || '',
                status: raw.status ?? 1,
                starred: raw.starred ?? false,
                forwarded: context?.isForwarded ?? false,
                created_at: (Number(raw.messageTimestamp) || Math.floor(Date.now() / 1_000)) * 1_000,
                deleted_at: raw.ephemeralStartTimestamp != null && ephemeral != null ? (Number(raw.ephemeralStartTimestamp) + ephemeral) * 1_000 : null,
                mime: typeof content === 'object' && type !== 'text' ? ((content?.mimetype as string) ?? 'application/octet-stream') : 'text/plain',
                caption: typeof content === 'string' ? content
                    : type === 'event' ? (((content as Record<string, unknown> | undefined)?.description as string) ?? '')
                        : ((content?.caption as string) ?? (content?.text as string) ?? (content?.name as string) ?? (content?.displayName as string) ?? ''),
                edited: false,
                raw,
            };
        }
        if (new.target === Message) {
            const kinds = { text: Text, image: Image, video: Video, audio: Audio, sticker: Sticker, document: Document, location: Location, poll: Poll, vcard: VCard, event: Event } as const;
            return new kinds[doc.type](init, doc);
        }
        this._init = init;
        this._raw = doc;
    }

    /** Identificador del mensaje. / Message identifier. */
    get id(): string { return this._raw.id; }
    /** Identificador del chat. / Chat identifier. */
    get cid(): string { return this._raw.cid; }
    /** Identificador del mensaje citado, o null. / Quoted message identifier, or null. */
    get mid(): string | null { return this._raw.mid; }
    /** JID del autor. / Author JID. */
    get from(): string { return this._raw.author; }
    /** true si soy el autor. / true when I am the author. */
    get me(): boolean { return this._raw.me; }
    /** Tipo del mensaje. / Message type. */
    get type(): Message['_raw']['type'] { return this._raw.type; }
    /** Texto del mensaje o caption del media. / Message text or media caption. */
    get caption(): string { return this._raw.caption; }
    /** Estado legible del mensaje. / Readable message state. */
    get status(): (typeof STATUS)[number] { return STATUS[this._raw.status] ?? 'pending'; }
    /** true si el mensaje fue visto. / true when the message was seen. */
    get read(): boolean { return this._raw.status >= proto.WebMessageInfo.Status.READ; }
    /** true si está destacado. / true when starred. */
    get starred(): boolean { return this._raw.starred; }
    /** true si fue reenviado. / true when forwarded. */
    get forwarded(): boolean { return this._raw.forwarded; }
    /** true si fue editado. / true when edited. */
    get edited(): boolean { return this._raw.edited; }
    /** Fecha de creación en ISO UTC. / Creation date as ISO UTC. */
    get created_at(): string { return new Date(this._raw.created_at).toISOString(); }
    /** Vencimiento del mensaje temporal en ISO UTC, o null. / Ephemeral expiration as ISO UTC, or null. */
    get expires_at(): string | null { return this._raw.deleted_at != null ? new Date(this._raw.deleted_at).toISOString() : null; }
    /** MIME: text/plain en texto, text/json en poll/location/vcard/event, real en media. / MIME: text/plain for text, text/json for poll/location/vcard/event, actual for media. */
    get mime(): string {
        const { type } = this._raw;
        return type === 'text' ? 'text/plain' : ['poll', 'location', 'vcard', 'event'].includes(type) ? 'text/json' : this._raw.mime;
    }
    /** Motivo del rechazo cuando `status` es `error` (`restricted`, `invalid-session`, o el código crudo); null si no. / Rejection reason when `status` is `error` (`restricted`, `invalid-session`, or the raw code); null otherwise. */
    get reason(): string | null {
        const code = this._raw.raw.messageStubParameters?.[0];
        return this._raw.status === proto.WebMessageInfo.Status.ERROR && code
            ? ({ '463': 'restricted', '479': 'invalid-session' } as Record<string, string>)[code] ?? code
            : null;
    }
    /** Nombre del negocio verificado que firma el mensaje, o null. / Verified business name signing the message, or null. */
    get business(): string | null { return this._raw.raw.verifiedBizName ?? null; }
    /** true si es de una sola lectura (view-once). / true when view-once. */
    get once(): boolean {
        const msg = this._raw.raw.message;
        return Boolean(msg?.viewOnceMessage ?? msg?.viewOnceMessageV2 ?? msg?.viewOnceMessageV2Extension);
    }

    /** Contacto autor, desde el engine (ficha mínima si no está persistido). / Author contact, from the engine (minimal card when not persisted). */
    async author(): Promise<InstanceType<WhatsApp['Contact']>> {
        return new this._init.wa.Contact(deserialize<Contact['_raw']>(await this._init.engine.get(`/contact/${this._raw.author}`)) ?? { id: this._raw.author });
    }

    /** Chat al que pertenece el mensaje. / Chat the message belongs to. */
    async chat(): Promise<InstanceType<WhatsApp['Chat']>> {
        return new this._init.wa.Chat(deserialize<Chat['_raw']>(await this._init.engine.get(`/chat/${this._raw.cid}`)) ?? { id: this._raw.cid });
    }

    /** Mensaje citado cuando hay `mid`, o null. / Quoted message when `mid` exists, or null. */
    async message(): Promise<Message | null> {
        const doc = this._raw.mid ? deserialize<Message['_raw']>(await this._init.engine.get(`/chat/${this._raw.cid}/message/${this._raw.mid}`)) : null;
        return doc ? new Message(this._init, doc) : null;
    }

    /** Contenido persistido: texto, JSON del tipo, o binario del media. / Persisted content: text, per-type JSON, or media binary. */
    async content(): Promise<Buffer> {
        const path = `/chat/${this._raw.cid}/message/${this._raw.id}/content`;
        const cached = await this._init.engine.get_buffer?.(path);
        if (cached?.length) return cached;
        const legacy = deserialize<{ data: string }>(await this._init.engine.get(path));
        return legacy?.data ? Buffer.from(legacy.data, 'base64') : Buffer.alloc(0);
    }

    /** Stream del contenido. / Content stream. */
    async stream(): Promise<Readable> { return Readable.from(await this.content()); }

    /** Reacciones agrupadas por emoji con su conteo. / Reactions grouped by emoji with their count. */
    async reactions(): Promise<{ emoji: string; count: number }[]> {
        const counts = new Map<string, number>();
        for (const { emoji } of this._raw.reactions ?? []) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
        return [...counts.entries()].map(([emoji, count]) => ({ emoji, count }));
    }

    /**
     * Reacciona al mensaje; el emoji vacío retira la reacción.
     * Reacts to the message; an empty emoji removes it.
     *
     * @param emoji - Emoji o '' / Emoji or ''
     */
    async react(emoji: string): Promise<boolean> {
        const { cid, id, me, author } = this._raw;
        await this._init.socket.sendMessage(cid, {
            react: { text: emoji, key: { remoteJid: cid, id, fromMe: me, ...(cid.endsWith('@g.us') && !me && { participant: author }) } },
        });
        return true;
    }

    /**
     * Destaca o quita el destacado.
     * Stars or unstars the message.
     *
     * @param value - true destaca / true stars
     */
    async star(value: boolean): Promise<boolean> {
        const doc = this._raw;
        await this._init.socket.chatModify({ star: { messages: [{ id: doc.id, fromMe: doc.me }], star: value } }, doc.cid);
        doc.starred = value;
        await this._init.engine.set(`/chat/${doc.cid}/message/${doc.id}`, serialize(doc), doc.created_at);
        return true;
    }

    /** Marca el mensaje como leído. / Marks the message as read. */
    async seen(): Promise<boolean> {
        const { cid, id, author } = this._raw;
        await this._init.socket.readMessages([{ remoteJid: cid, id, participant: cid.endsWith('@g.us') ? author : undefined }]);
        return true;
    }

    /**
     * Edita el caption del mensaje propio (texto, imagen o video).
     * Edits the own message caption (text, image or video).
     *
     * @param caption - Texto nuevo / New text
     * @returns false si el mensaje no es propio o su tipo no se puede editar / false when not own or its type cannot be edited
     */
    async edit(caption: string): Promise<boolean> {
        const doc = this._raw;
        const media_key = doc.type === 'image' ? 'imageMessage' : doc.type === 'video' ? 'videoMessage' : null;
        const media = media_key ? unwrap(doc.raw.message ?? {})[media_key] : null;
        if (!doc.me || (doc.type !== 'text' && !media)) return false;
        if (doc.type === 'text') {
            await this._init.socket.sendMessage(doc.cid, { text: caption, edit: { remoteJid: doc.cid, id: doc.id, fromMe: true } } as never);
            doc.raw.message = getContentType(doc.raw.message ?? {}) === 'conversation' ? { conversation: caption } : { extendedTextMessage: { text: caption } };
        } else {
            const edited = { [media_key!]: { ...media, caption } };
            await this._init.socket.relayMessage(doc.cid, {
                protocolMessage: {
                    key: { remoteJid: doc.cid, id: doc.id, fromMe: true },
                    type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
                    editedMessage: edited,
                    timestampMs: Date.now(),
                },
            }, { messageId: generateMessageID() });
            doc.raw.message = { ...doc.raw.message, ...edited };
        }
        doc.caption = caption;
        doc.edited = true;
        await this._init.engine.set(`/chat/${doc.cid}/message/${doc.id}`, serialize(doc), doc.created_at);
        return true;
    }

    /**
     * Reenvía el mensaje a otro chat.
     * Forwards the message to another chat.
     *
     * @param target - CID, Chat o Contact destino / Target CID, Chat or Contact
     * @returns false si el destino es irresoluble o el contenido no admite reenvío / false when the target cannot be resolved or the content cannot be forwarded
     */
    async forward(target: string | Chat | Contact): Promise<boolean> {
        const cid = typeof target === 'string' ? target : target instanceof Chat ? target._raw.id : target.jid ?? target.lid ?? '';
        const jid = cid ? await jid_of(this._init.engine, cid, this._init.socket) : null;
        if (!jid || !this._raw.raw.message) return false;
        try {
            const msg = generateWAMessageFromContent(jid, generateForwardMessageContent(this._raw.raw, false), { userJid: this._init.socket.user?.id ?? '' });
            if (!msg.message || !msg.key?.id) return false;
            await this._init.socket.relayMessage(jid, msg.message, { messageId: msg.key.id });
            return true;
        } catch {
            /* contenido no reenviable / non-forwardable content */
            return false;
        }
    }

    /**
     * Elimina el mensaje: solo en mi dispositivo por defecto, para todos con `true`.
     * Deletes the message: this device only by default, for everyone with `true`.
     *
     * @param all - true elimina para todos / true deletes for everyone
     */
    async delete(all = false): Promise<boolean> {
        const doc = this._raw;
        if (all) await this._init.socket.sendMessage(doc.cid, { delete: { remoteJid: doc.cid, id: doc.id, fromMe: doc.me } });
        else await this._init.socket.chatModify({ deleteForMe: { deleteMedia: false, key: { remoteJid: doc.cid, id: doc.id, fromMe: doc.me }, timestamp: Date.now() } }, doc.cid);
        await this._init.engine.unset(`/chat/${doc.cid}/message/${doc.id}`);
        return true;
    }

    /** Responde con texto. / Replies with text. */
    async text(caption: string, extra: Omit<Extra, 'mid'> = {}) { return send(this._init, this._raw.cid, { text: caption }, undefined, { ...extra, mid: this._raw.id }); }
    /** Responde con imagen. / Replies with an image. */
    async image(buf: Buffer, extra: Omit<Extra, 'mid'> & { caption?: string } = {}) { return send(this._init, this._raw.cid, { image: buf, caption: extra.caption }, buf, { ...extra, mid: this._raw.id }); }
    /** Responde con video. / Replies with a video. */
    async video(buf: Buffer, extra: Omit<Extra, 'mid'> & { caption?: string } = {}) { return send(this._init, this._raw.cid, { video: buf, caption: extra.caption }, buf, { ...extra, mid: this._raw.id }); }
    /** Responde con audio. / Replies with audio. */
    async audio(buf: Buffer, extra: Omit<Extra, 'mid'> & { ptt?: boolean } = {}) { return send(this._init, this._raw.cid, { audio: buf, ptt: extra.ptt ?? true }, buf, { ...extra, mid: this._raw.id }); }
    /** Responde con ubicación. / Replies with a location. */
    async location(loc: { lat: number; lng: number }, extra: Omit<Extra, 'mid'> = {}) { return send(this._init, this._raw.cid, { location: { degreesLatitude: loc.lat, degreesLongitude: loc.lng } }, undefined, { ...extra, mid: this._raw.id }); }
    /** Responde con encuesta. / Replies with a poll. */
    async poll(input: { content: string; options: { content: string }[] }, extra: Omit<Extra, 'mid'> & { multiple?: boolean } = {}) {
        return send(this._init, this._raw.cid, poll_of(input, extra.multiple ?? false), undefined, { ...extra, mid: this._raw.id }, { multiple: extra.multiple ?? false });
    }
    /** Responde con documento. / Replies with a document. */
    async document(buf: Buffer, extra: Omit<Extra, 'mid'> & { file_name: string; mimetype?: string; caption?: string }) {
        return send(this._init, this._raw.cid, { document: buf, fileName: extra.file_name, mimetype: extra.mimetype ?? 'application/octet-stream', caption: extra.caption }, buf, { ...extra, mid: this._raw.id });
    }
    /** Responde con tarjeta(s) de contacto. / Replies with contact card(s). */
    async vcard(contacts: { name: string; phone: string }[], extra: Omit<Extra, 'mid'> = {}) {
        const cards = vcards_of(contacts);
        return send(this._init, this._raw.cid, cards.content, cards.binary, { ...extra, mid: this._raw.id });
    }
    /** Responde con evento. / Replies with an event. */
    async event(data: { name: string; caption?: string; start: Date; end?: Date; place?: { lat: number; lng: number } }, extra: Omit<Extra, 'mid'> = {}) {
        const built = event_of(data);
        return send(this._init, this._raw.cid, built.content, built.binary, { ...extra, mid: this._raw.id });
    }
}

/**
 * Mensaje de texto; `preview()` expone la tarjeta del enlace embebido.
 * Text message; `preview()` exposes the embedded link card.
 */
export class Text extends Message {
    /** Preview del enlace, o null cuando el texto no trae metadata. / Link preview, or null when the text carries no metadata. */
    async preview(): Promise<{ link: string; name: string | null; content: string | null; thumb: Buffer | null } | null> {
        const ext = this._raw.raw.message?.extendedTextMessage;
        return ext?.matchedText && (ext.title || ext.description)
            ? { link: ext.matchedText, name: ext.title ?? null, content: ext.description ?? null, thumb: to_buffer(ext.jpegThumbnail) }
            : null;
    }
}

/**
 * Base de los mensajes con binario: dimensiones, peso, miniatura y descarga.
 * Base for binary messages: dimensions, size, thumbnail and download.
 */
class Media extends Message {
    /** @internal Bloque de media del raw, común a los cinco tipos. / Raw media block, shared by the five types. */
    get _media() {
        const msg = unwrap(this._raw.raw.message ?? {});
        return (msg.imageMessage ?? msg.videoMessage ?? msg.audioMessage ?? msg.stickerMessage ?? msg.documentMessage ?? null) as {
            width?: number | null;
            height?: number | null;
            seconds?: number | null;
            ptt?: boolean | null;
            isAnimated?: boolean | null;
            fileName?: string | null;
            pageCount?: number | null;
            fileLength?: number | { toString(): string } | null;
            waveform?: Uint8Array | string | null;
            jpegThumbnail?: Uint8Array | string | null;
        } | null;
    }
    /** Ancho en píxeles. / Width in pixels. */
    get width(): number { return this._media?.width ?? 0; }
    /** Alto en píxeles. / Height in pixels. */
    get height(): number { return this._media?.height ?? 0; }
    /** Peso en bytes. / Size in bytes. */
    get size(): number { return Number(this._media?.fileLength?.toString() ?? 0); }
    /** Miniatura JPEG embebida, o null. / Embedded JPEG thumbnail, or null. */
    async thumb(): Promise<Buffer | null> { return to_buffer(this._media?.jpegThumbnail); }
    /** Binario del media: el persistido, o la descarga de baileys. / Media binary: the persisted one, or the baileys download. */
    async content(): Promise<Buffer> {
        const cached = await super.content();
        if (cached.length) return cached;
        const raw = await downloadMediaMessage(this._raw.raw, 'buffer', {}).catch(() => Buffer.alloc(0));
        return Buffer.isBuffer(raw) ? raw : Buffer.alloc(0);
    }
    /** Stream del media sin acumularlo cuando hay que descargar. / Media stream without buffering when a download is needed. */
    async stream(): Promise<Readable> {
        const cached = await super.content();
        return cached.length
            ? Readable.from(cached)
            : ((await downloadMediaMessage(this._raw.raw, 'stream', {}).catch(() => Readable.from(Buffer.alloc(0)))) as unknown as Readable);
    }
}

/** Mensaje de imagen. / Image message. */
export class Image extends Media { }

/** Mensaje de video. / Video message. */
export class Video extends Media {
    /** Duración en segundos. / Duration in seconds. */
    get duration(): number { return this._media?.seconds ?? 0; }
}

/** Mensaje de audio: nota de voz o archivo. / Audio message: voice note or file. */
export class Audio extends Media {
    /** true si es nota de voz. / true when push-to-talk. */
    get ptt(): boolean { return this._media?.ptt === true; }
    /** Duración en segundos. / Duration in seconds. */
    get duration(): number { return this._media?.seconds ?? 0; }
    /** Forma de onda 0-100 lista para pintar. / Paint-ready 0-100 waveform. */
    get waveform(): number[] { return Array.from(to_buffer(this._media?.waveform) ?? []); }
}

/** Mensaje de sticker. / Sticker message. */
export class Sticker extends Media {
    /** true si el sticker es animado. / true when animated. */
    get animated(): boolean { return this._media?.isAnimated === true; }
}

/** Mensaje de documento; el MIME real vive en `mime`. / Document message; the actual MIME lives in `mime`. */
export class Document extends Media {
    /** Nombre del archivo. / File name. */
    get name(): string { return this._media?.fileName ?? ''; }
    /** Número de páginas (PDF); 0 cuando no aplica. / Page count (PDF); 0 when not applicable. */
    get pages(): number { return this._media?.pageCount ?? 0; }
}

/** Mensaje de ubicación, fija o en vivo. / Location message, static or live. */
export class Location extends Message {
    /** Latitud en grados. / Latitude in degrees. */
    get lat(): number { return (this._raw.raw.message?.locationMessage ?? this._raw.raw.message?.liveLocationMessage)?.degreesLatitude ?? 0; }
    /** Longitud en grados. / Longitude in degrees. */
    get lng(): number { return (this._raw.raw.message?.locationMessage ?? this._raw.raw.message?.liveLocationMessage)?.degreesLongitude ?? 0; }
    /** true si es ubicación en tiempo real. / true when live location. */
    get live(): boolean { return Boolean(this._raw.raw.message?.liveLocationMessage); }
    /** URL de Google Maps de la coordenada. / Google Maps URL for the coordinate. */
    get link(): string { return `https://www.google.com/maps/@${this.lat},${this.lng},15z`; }
}

/**
 * Mensaje de encuesta: opciones con conteo, votos por contacto y voto propio.
 * Poll message: options with counts, per-contact votes and self-voting.
 */
export class Poll extends Message {
    /** @internal Bloque de la encuesta en el raw. / Raw poll block. */
    get _poll() {
        const msg = this._raw.raw.message;
        return msg?.pollCreationMessage ?? msg?.pollCreationMessageV2 ?? msg?.pollCreationMessageV3;
    }

    /** @internal Updates de voto con los bytes normalizados post-engine. / Vote updates with post-engine normalized bytes. */
    get _updates() {
        return (this._raw.raw.pollUpdates ?? []).map((update) => ({
            ...update,
            vote: update.vote && {
                ...update.vote,
                selectedOptions: (update.vote.selectedOptions ?? []).map((option) => (typeof option === 'string' ? Buffer.from(option, 'base64') : option)),
            },
        }));
    }

    /** true si admite varias respuestas. / true when multi-select. */
    get multiple(): boolean {
        return typeof this._raw.multiple === 'boolean' ? this._raw.multiple : (this._poll?.selectableOptionsCount ?? 1) !== 1;
    }

    /** Opciones con su conteo de votos. / Options with their vote counts. */
    get options(): { name: string; count: number }[] {
        const aggregated = getAggregateVotesInPollMessage({ message: this._raw.raw.message ?? undefined, pollUpdates: this._updates }, this._init.socket.user?.id);
        const counts = new Map(aggregated.map((entry) => [entry.name, entry.voters.length]));
        return (this._poll?.options ?? []).map((option) => ({ name: option.optionName ?? '', count: counts.get(option.optionName ?? '') ?? 0 }));
    }

    /** Votos individuales: opción elegida y teléfono del votante. / Individual votes: chosen option and voter phone. */
    async votes(): Promise<{ name: string; contact: string }[]> {
        const aggregated = getAggregateVotesInPollMessage({ message: this._raw.raw.message ?? undefined, pollUpdates: this._updates }, this._init.socket.user?.id);
        const result: { name: string; contact: string }[] = [];
        for (const entry of aggregated) {
            for (const voter of entry.voters) {
                const jid = await jid_of(this._init.engine, voter, this._init.socket);
                result.push({ name: entry.name, contact: (jid ?? voter).split('@')[0].split(':')[0] });
            }
        }
        return result;
    }

    /**
     * Vota con uno o varios índices: cifra el voto (HMAC+AES-GCM) y lo enruta al chat @lid
     * con la identidad LID propia. Best-effort: WhatsApp no propaga el voto emitido desde un
     * dispositivo vinculado.
     * Votes with one or more indexes: encrypts the vote (HMAC+AES-GCM) and routes it to the
     * @lid chat with the own LID identity. Best-effort: WhatsApp does not propagate votes
     * emitted from a linked device.
     *
     * @param index - Índice o índices de la opción / Option index or indexes
     * @returns true si el voto se emitió / true when the vote was relayed
     */
    async select(index: number | number[]): Promise<boolean> {
        const { socket, engine } = this._init;
        const doc = this._raw;
        const options = this._poll?.options ?? [];
        const selected = (Array.isArray(index) ? index : [index]).filter((i) => i >= 0 && i < options.length).map((i) => sha256(Buffer.from(options[i].optionName ?? '')));
        const secret_raw = doc.raw.message?.messageContextInfo?.messageSecret;
        const secret = typeof secret_raw === 'string' ? Buffer.from(secret_raw, 'base64') : secret_raw;
        if (!secret || selected.length === 0) return false;
        const key = doc.raw.key ?? {};
        const self = socket.user?.id ?? '';
        const dest = key.remoteJid?.endsWith('@lid') ? key.remoteJid
            : doc.cid.endsWith('@lid') ? doc.cid
                : deserialize<{ lid?: string | null }>(await engine.get(`/contact/${doc.cid}`))?.lid
                ?? await socket.signalRepository?.lidMapping?.getLIDForPN(doc.cid).catch(() => null)
                ?? doc.cid;
        const mine = dest.endsWith('@lid') && socket.user?.lid ? socket.user.lid : self;
        const voter = jidNormalizedUser(mine);
        const creator = jidNormalizedUser(key.fromMe ? mine : key.remoteJid?.endsWith('@lid') ? key.remoteJid : getKeyAuthor(key, self));
        const sign = Buffer.concat([Buffer.from(doc.id), Buffer.from(creator), Buffer.from(voter), Buffer.from('Poll Vote'), new Uint8Array([1])]);
        const enc_key = hmacSign(sign, hmacSign(secret, new Uint8Array(32), 'sha256'), 'sha256');
        const iv = randomBytes(12);
        const payload = aesEncryptGCM(proto.Message.PollVoteMessage.encode({ selectedOptions: selected }).finish(), enc_key, iv, Buffer.from(`${doc.id}\x00${voter}`));
        const mid = generateMessageID();
        await socket.relayMessage(dest, {
            pollUpdateMessage: {
                pollCreationMessageKey: dest === doc.cid ? doc.raw.key : { ...doc.raw.key, remoteJid: dest },
                vote: { encPayload: payload, encIv: iv },
                senderTimestampMs: Date.now(),
            },
        }, { messageId: mid });
        updateMessageWithPollUpdate(doc.raw, {
            pollUpdateMessageKey: { remoteJid: doc.raw.key?.remoteJid ?? doc.cid, fromMe: true, id: mid },
            vote: { selectedOptions: selected },
            senderTimestampMs: Date.now(),
        });
        await engine.set(`/chat/${doc.cid}/message/${doc.id}`, serialize(doc), doc.created_at);
        this._init.wa.emit('message:updated', this, await this.chat(), this._init.wa);
        return true;
    }
}

/** Mensaje de tarjeta(s) de contacto. / Contact card(s) message. */
export class VCard extends Message {
    /** Contactos de la tarjeta. / Card contacts. */
    get contacts(): { name: string; phone: string }[] {
        const msg = this._raw.raw.message;
        const raw = msg?.contactsArrayMessage?.contacts ?? (msg?.contactMessage ? [msg.contactMessage] : []);
        return raw.map((card) => ({ name: card.displayName ?? '', phone: (card.vcard ?? '').match(/TEL[^:]*:(.+)/)?.[1].trim() ?? '' }));
    }
}

/** Mensaje de evento de calendario. / Calendar event message. */
export class Event extends Message {
    /** @internal Bloque del evento en el raw. / Raw event block. */
    get _event() { return this._raw.raw.message?.eventMessage; }
    /** Nombre del evento. / Event name. */
    get name(): string { return this._event?.name ?? ''; }
    /** Inicio en ISO UTC. / Start as ISO UTC. */
    get start(): string { return new Date(Number(this._event?.startTime?.toString() ?? 0) * 1_000).toISOString(); }
    /** Fin en ISO UTC, o null. / End as ISO UTC, or null. */
    get end(): string | null { return this._event?.endTime == null ? null : new Date(Number(this._event.endTime.toString()) * 1_000).toISOString(); }
    /** true si fue cancelado. / true when canceled. */
    get canceled(): boolean { return this._event?.isCanceled ?? false; }
    /** Link de unión, si aplica. / Join link, if any. */
    get link(): string { return this._event?.joinLink ?? ''; }
    /** Ubicación del evento, o null. / Event location, or null. */
    get place(): { lat: number; lng: number } | null {
        const loc = this._event?.location;
        return loc ? { lat: loc.degreesLatitude ?? 0, lng: loc.degreesLongitude ?? 0 } : null;
    }
}

/**
 * Mensaje ligado a la sesión viva: la misma clase con los envíos, las lecturas, las acciones
 * por id y las subclases para `instanceof`.
 * Message bound to the live session: the same class with sends, reads, by-id actions and the
 * subclasses for `instanceof`.
 *
 * @param init - Sesión activa: cliente, motor y socket / Active session: client, engine and socket
 * @returns Clase `Message` con acceso a la sesión / `Message` class with session access
 */
export function message(init: Init) {
    return class extends Message {
        static readonly Text = Text;
        static readonly Image = Image;
        static readonly Video = Video;
        static readonly Audio = Audio;
        static readonly Sticker = Sticker;
        static readonly Document = Document;
        static readonly Location = Location;
        static readonly Poll = Poll;
        static readonly VCard = VCard;
        static readonly Event = Event;

        /**
         * Mensaje por chat e id.
         * Message by chat and id.
         *
         * @param cid - Teléfono, JID o LID del chat / Chat phone, JID or LID
         * @param mid - Identificador del mensaje / Message identifier
         */
        static async get(cid: string, mid: string): Promise<Message | null> {
            const jid = await jid_of(init.engine, cid, init.socket);
            const doc = jid ? deserialize<Message['_raw']>(await init.engine.get(`/chat/${jid}/message/${mid}`)) : null;
            return doc ? new Message(init, doc) : null;
        }

        /**
         * Pagina los mensajes del chat, del más reciente al más antiguo.
         * Paginates chat messages, from the most recent to the oldest.
         *
         * @param cid - Teléfono, JID o LID del chat / Chat phone, JID or LID
         * @param offset - Desplazamiento / Offset
         * @param limit - Tamaño de página / Page size
         */
        static async list(cid: string, offset = 0, limit = 50): Promise<Message[]> {
            const jid = await jid_of(init.engine, cid, init.socket);
            return jid
                ? (await init.engine.list(`/chat/${jid}/message`, offset, limit))
                    .map((raw) => deserialize<Message['_raw']>(raw))
                    .filter((doc): doc is Message['_raw'] => doc !== null)
                    .map((doc) => new Message(init, doc))
                : [];
        }

        /** Envía texto. / Sends text. */
        static async text(cid: string, caption: string, extra: Extra = {}) { return send(init, cid, { text: caption }, undefined, extra); }
        /** Envía imagen. / Sends an image. */
        static async image(cid: string, buf: Buffer, extra: Extra & { caption?: string } = {}) { return send(init, cid, { image: buf, caption: extra.caption }, buf, extra); }
        /** Envía video. / Sends a video. */
        static async video(cid: string, buf: Buffer, extra: Extra & { caption?: string } = {}) { return send(init, cid, { video: buf, caption: extra.caption }, buf, extra); }
        /** Envía audio. / Sends audio. */
        static async audio(cid: string, buf: Buffer, extra: Extra & { ptt?: boolean } = {}) { return send(init, cid, { audio: buf, ptt: extra.ptt ?? true }, buf, extra); }
        /** Envía ubicación. / Sends a location. */
        static async location(cid: string, loc: { lat: number; lng: number }, extra: Extra = {}) { return send(init, cid, { location: { degreesLatitude: loc.lat, degreesLongitude: loc.lng } }, undefined, extra); }
        /** Envía encuesta. / Sends a poll. */
        static async poll(cid: string, input: { content: string; options: { content: string }[] }, extra: Extra & { multiple?: boolean } = {}) {
            return send(init, cid, poll_of(input, extra.multiple ?? false), undefined, extra, { multiple: extra.multiple ?? false });
        }
        /** Envía documento. / Sends a document. */
        static async document(cid: string, buf: Buffer, extra: Extra & { file_name: string; mimetype?: string; caption?: string }) {
            return send(init, cid, { document: buf, fileName: extra.file_name, mimetype: extra.mimetype ?? 'application/octet-stream', caption: extra.caption }, buf, extra);
        }
        /** Envía tarjeta(s) de contacto. / Sends contact card(s). */
        static async vcard(cid: string, contacts: { name: string; phone: string }[], extra: Extra = {}) {
            const cards = vcards_of(contacts);
            return send(init, cid, cards.content, cards.binary, extra);
        }
        /** Envía evento. / Sends an event. */
        static async event(cid: string, data: { name: string; caption?: string; start: Date; end?: Date; place?: { lat: number; lng: number } }, extra: Extra = {}) {
            const built = event_of(data);
            return send(init, cid, built.content, built.binary, extra);
        }

        /** Reacciona a un mensaje por id. / Reacts to a message by id. */
        static async react(cid: string, mid: string, emoji: string): Promise<boolean> { return (await this.get(cid, mid))?.react(emoji) ?? false; }
        /** Destaca un mensaje por id. / Stars a message by id. */
        static async star(cid: string, mid: string, value: boolean): Promise<boolean> { return (await this.get(cid, mid))?.star(value) ?? false; }
        /** Marca un mensaje como leído por id. / Marks a message as read by id. */
        static async seen(cid: string, mid: string): Promise<boolean> { return (await this.get(cid, mid))?.seen() ?? false; }
        /** Edita un mensaje por id. / Edits a message by id. */
        static async edit(cid: string, mid: string, caption: string): Promise<boolean> { return (await this.get(cid, mid))?.edit(caption) ?? false; }
        /** Reenvía un mensaje por id. / Forwards a message by id. */
        static async forward(cid: string, mid: string, target: string | Chat | Contact): Promise<boolean> { return (await this.get(cid, mid))?.forward(target) ?? false; }
        /** Elimina un mensaje por id. / Deletes a message by id. */
        static async delete(cid: string, mid: string, all = false): Promise<boolean> { return (await this.get(cid, mid))?.delete(all) ?? false; }
        /** Reacciones de un mensaje por id. / Reactions of a message by id. */
        static async reactions(cid: string, mid: string): Promise<{ emoji: string; count: number }[]> { return (await this.get(cid, mid))?.reactions() ?? []; }
    };
}
