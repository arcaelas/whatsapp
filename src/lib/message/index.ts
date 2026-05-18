/**
 * @file message/index.ts
 * @description Entidad Message — una sola clase base que recibe `{wa, doc}` en el constructor.
 * Subclases especializadas (Text, Image, Video, Audio, Gps, Poll) override `content()` según su tipo.
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
import { Chat, chat, type IChatRaw } from '~/lib/chat';
import { Contact, contact } from '~/lib/contact';
import { deserialize, serialize } from '~/lib/store';
import type { WhatsApp } from '~/lib/whatsapp';

/** Destino aceptado por `forward`: CID (string), Chat o Contact. */
export type ForwardTarget = string | Chat | Contact;

type ChatInstance = InstanceType<ReturnType<typeof chat>>;
type ContactInstance = InstanceType<ReturnType<typeof contact>>;

/** Tipos de mensaje internos (no expuestos como getter público). */
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'location' | 'poll';

export enum MessageStatus {
    ERROR = 0,
    PENDING = 1,
    SERVER_ACK = 2,
    DELIVERED = 3,
    READ = 4,
    PLAYED = 5,
}

export interface SendOptions {
    mid?: string;
}
export interface SendMediaOptions extends SendOptions {
    caption?: string;
}
export interface SendAudioOptions extends SendOptions {
    ptt?: boolean;
}
export interface SendPollOptions extends SendOptions {
    /** true para selección múltiple; default false (single). / true for multi-select; default false (single). */
    multiple?: boolean;
}
export interface LocationOptions {
    lat: number;
    lng: number;
    live?: boolean;
}
export interface PollOptions {
    content: string;
    options: Array<{ content: string }>;
}

/**
 * Documento persistido del mensaje.
 */
export interface IMessage {
    id: string;
    cid: string;
    mid: string | null;
    me: boolean;
    type: MessageType;
    author: string;
    status: MessageStatus;
    starred: boolean;
    forwarded: boolean;
    created_at: number;
    deleted_at: number | null;
    mime: string;
    caption: string;
    edited: boolean;
    /**
     * Solo para polls: discriminador explícito de selección múltiple seteado al enviar.
     * Cuando está definido, `Poll.multiple` lo prefiere sobre el conteo del proto
     * (WhatsApp normaliza `selectableOptionsCount` en el echo de polls auto-emitidos
     * y pierde el discriminador, por eso necesitamos persistirlo nosotros).
     * Poll-only: explicit multi-select flag set at send time. When defined, `Poll.multiple`
     * prefers it over the proto count (WhatsApp normalizes `selectableOptionsCount` on
     * own-poll echo, losing the discriminator).
     */
    multiple?: boolean;
    raw: WAMessage;
}

const MESSAGE_TYPE_MAP: Record<string, MessageType> = {
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
 * Construye el documento IMessage desde el raw de baileys.
 */
export function build_message_doc(raw: WAMessage, self_id?: string, edited = false): IMessage {
    const key = raw.key ?? {};
    const msg = raw.message ?? {};
    const unwrapped =
        msg.viewOnceMessage?.message ??
        msg.viewOnceMessageV2?.message ??
        msg.viewOnceMessageV2Extension?.message ??
        msg;
    const content_type = getContentType(unwrapped);
    const msg_type = MESSAGE_TYPE_MAP[content_type ?? ''] ?? 'text';
    const msg_content = unwrapped[content_type as keyof typeof unwrapped] as
        | Record<string, unknown>
        | string
        | undefined;
    const context_info = (msg_content as { contextInfo?: proto.IContextInfo } | undefined)
        ?.contextInfo;
    const ephemeral_duration = raw.ephemeralDuration ?? context_info?.expiration;
    const deleted_at =
        raw.ephemeralStartTimestamp != null && ephemeral_duration != null
            ? (Number(raw.ephemeralStartTimestamp) + ephemeral_duration) * 1000
            : null;

    let mime = 'text/plain';
    if (msg_type === 'location' || msg_type === 'poll') {
        mime = 'application/json';
    } else if (msg_type !== 'text' && typeof msg_content === 'object') {
        mime = (msg_content?.mimetype as string) ?? 'application/octet-stream';
    }

    let caption = '';
    if (typeof msg_content === 'string') {
        caption = msg_content;
    } else if (msg_content) {
        caption =
            (msg_content.caption as string) ??
            (msg_content.text as string) ??
            (msg_content.name as string) ??
            '';
    }

    const author =
        key.fromMe && self_id
            ? jidNormalizedUser(self_id)
            : key.participant || (key as { remoteJidAlt?: string }).remoteJidAlt || key.remoteJid || '';

    return {
        id: key.id ?? '',
        cid: (key as { remoteJidAlt?: string }).remoteJidAlt ?? key.remoteJid ?? '',
        mid: context_info?.stanzaId ?? null,
        me: key.fromMe ?? false,
        type: msg_type,
        author,
        status: (raw.status as unknown as MessageStatus) ?? MessageStatus.PENDING,
        starred: raw.starred ?? false,
        forwarded: context_info?.isForwarded ?? false,
        created_at: (Number(raw.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000,
        deleted_at,
        mime,
        caption,
        edited,
        raw,
    };
}

/**
 * Clase base del mensaje. Una sola clase — toda la API de instancia vive aquí.
 * Base message class. Single class — all instance API lives here.
 */
export class Message {
    /** @internal */
    protected readonly _wa: WhatsApp;
    /** @internal */
    protected readonly _doc: IMessage;
    /** @internal Cache de la promesa de `author()` para evitar engine round-trips repetidos. */
    private _author_cache: Promise<ContactInstance> | null = null;
    /** @internal Cache de la promesa de `chat()` para evitar engine round-trips repetidos. */
    private _chat_cache: Promise<ChatInstance> | null = null;

    constructor(options: { wa: WhatsApp; doc: IMessage }) {
        this._wa = options.wa;
        this._doc = options.doc;
    }

    get id(): string {
        return this._doc.id;
    }
    get cid(): string {
        return this._doc.cid;
    }
    get type(): MessageType {
        return this._doc.type;
    }
    /** JID del autor del mensaje. Para acceso síncrono sin hidratar el Contact. */
    get from(): string {
        return this._doc.author;
    }
    /** MIME type del contenido. `text/plain` para texto, `application/json` para location/poll, mimetype real para media. */
    get mime(): string {
        return this._doc.mime;
    }
    get mid(): string | null {
        return this._doc.mid;
    }
    get me(): boolean {
        return this._doc.me;
    }
    get caption(): string {
        return this._doc.caption;
    }
    get starred(): boolean {
        return this._doc.starred;
    }
    get forwarded(): boolean {
        return this._doc.forwarded;
    }
    get once(): boolean {
        return this._doc.deleted_at !== null;
    }
    get created_at(): number {
        return this._doc.created_at;
    }
    get deleted_at(): number | null {
        return this._doc.deleted_at;
    }
    get status(): MessageStatus {
        return this._doc.status;
    }
    get edited(): boolean {
        return this._doc.edited;
    }

    /**
     * Contacto del autor (resuelve vía `wa.Contact.get`; fallback a instancia mínima).
     * Memoizado por instancia: la primera llamada va al engine; las siguientes
     * reutilizan la misma promesa sin nuevos round-trips.
     * Author contact (resolves via `wa.Contact.get`; falls back to a minimal instance).
     * Instance-memoized: first call hits the engine; subsequent calls reuse the
     * same promise without further round-trips.
     */
    async author(): Promise<ContactInstance> {
        return (this._author_cache ??= (async () => {
            const { _wa, _doc } = this;
            const fetched = _doc.author ? await _wa.Contact.get(_doc.author) : null;
            return (
                fetched ??
                new _wa.Contact(
                    {
                        id: _doc.author,
                        lid: null,
                        name: null,
                        notify: null,
                        verified_name: null,
                        img_url: null,
                        status: null,
                    },
                    new _wa.Chat({ id: _doc.author, name: _doc.author.split('@')[0] })
                )
            );
        })());
    }

    /**
     * Chat al que pertenece el mensaje. Memoizado por instancia: la primera llamada
     * va al engine; las siguientes reutilizan la misma promesa.
     * Chat the message belongs to. Instance-memoized: first call hits the engine;
     * subsequent calls reuse the same promise.
     */
    async chat(): Promise<ChatInstance> {
        return (this._chat_cache ??= (async () => {
            const cached = deserialize<IChatRaw>(await this._wa.engine.get(`/chat/${this._doc.cid}`));
            return new this._wa.Chat(cached ?? { id: this._doc.cid, name: this._doc.cid.split('@')[0] });
        })());
    }

    /** Contenido sin parsear, directo del engine. Las subclases override según su tipo. */
    async content(): Promise<Buffer> {
        const cached = deserialize<{ data: string }>(
            await this._wa.engine.get(`/chat/${this._doc.cid}/message/${this._doc.id}/content`)
        );
        return cached?.data ? Buffer.from(cached.data, 'base64') : Buffer.alloc(0);
    }

    /**
     * Devuelve un `Readable` con los bytes del mensaje. Para media (image/video/audio)
     * lee desde el cache del engine o, si falta, descarga desde baileys. Para text/location/poll
     * retorna el mismo binario que `content()` envuelto en un Readable.
     * Returns a `Readable` of the message bytes. For media (image/video/audio) it reads
     * from the engine cache or, if missing, downloads from baileys. For text/location/poll
     * it wraps the `content()` buffer in a Readable.
     */
    async stream(): Promise<Readable> {
        return _media_stream(this);
    }

    /** Reacciona al mensaje (emoji vacío para retirar). */
    async react(emoji: string): Promise<boolean> {
        const { _wa, _doc } = this;
        let ok = false;
        if (_wa._socket) {
            await _wa._socket.sendMessage(_doc.cid, {
                react: { text: emoji, key: { remoteJid: _doc.cid, id: _doc.id, fromMe: _doc.me } },
            });
            ok = true;
        }
        return ok;
    }

    /** Reenvía el mensaje a un destino (CID, Chat o Contact). */
    async forward(target: ForwardTarget): Promise<boolean> {
        const { _wa, _doc } = this;
        const to_cid =
            typeof target === 'string' ? target : target instanceof Chat ? target.id : target.chat.id;
        let ok = false;
        if (_wa._socket) {
            const jid = await _wa._resolve_jid(to_cid);
            if (jid) {
                if (_doc.raw.message) {
                    try {
                        const wa_msg = generateWAMessageFromContent(
                            jid,
                            generateForwardMessageContent(_doc.raw, false),
                            { userJid: _wa._socket.user?.id ?? '' }
                        );
                        if (wa_msg.message && wa_msg.key?.id) {
                            await _wa._socket.relayMessage(jid, wa_msg.message, { messageId: wa_msg.key.id });
                            ok = true;
                        }
                    } catch {
                        /* fallback below */
                    }
                }
                if (!ok) {
                    const buf = await this.content();
                    if (buf.length > 0) {
                        if (_doc.type === 'text') {
                            ok = (await _wa.Message.text(jid, buf.toString())) !== null;
                        } else if (_doc.type === 'image') {
                            ok =
                                (await _wa.Message.image(jid, buf, { caption: _doc.caption || undefined })) !==
                                null;
                        } else if (_doc.type === 'video') {
                            ok =
                                (await _wa.Message.video(jid, buf, { caption: _doc.caption || undefined })) !==
                                null;
                        } else if (_doc.type === 'audio') {
                            ok = (await _wa.Message.audio(jid, buf)) !== null;
                        } else if (_doc.type === 'location') {
                            try {
                                ok =
                                    (await _wa.Message.location(
                                        jid,
                                        JSON.parse(buf.toString()) as LocationOptions
                                    )) !== null;
                            } catch {
                                /* invalid payload */
                            }
                        }
                    }
                }
            }
        }
        return ok;
    }

    /** Marca el mensaje como leído. */
    async seen(): Promise<boolean> {
        const { _wa, _doc } = this;
        let ok = false;
        if (_wa._socket) {
            await _wa._socket.readMessages([
                { remoteJid: _doc.cid, id: _doc.id, participant: _doc.me ? undefined : _doc.author },
            ]);
            ok = true;
        }
        return ok;
    }

    /** Destaca/retira destacado del mensaje. */
    async star(value: boolean): Promise<boolean> {
        const { _wa: wa, _doc: doc } = this;
        let ok = false;
        if (wa._socket) {
            await wa._socket.chatModify(
                {
                    star: { messages: [{ id: doc.id, fromMe: doc.me }], star: value },
                },
                doc.cid
            );
            doc.starred = value;
            await wa.engine.set(`/chat/${doc.cid}/message/${doc.id}`, serialize(doc));
            ok = true;
        }
        return ok;
    }

    /** Elimina el mensaje. `all=true` (default) borra para todos; `all=false` borra sólo en mi dispositivo. */
    async delete(all: boolean = true): Promise<boolean> {
        const { _wa: wa, _doc: doc } = this;
        let ok = false;
        if (wa._socket) {
            if (all) {
                await wa._socket.sendMessage(doc.cid, {
                    delete: { remoteJid: doc.cid, id: doc.id, fromMe: doc.me },
                });
            } else {
                await wa._socket.chatModify(
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
            await wa.engine.unset(`/chat/${doc.cid}/message/${doc.id}`);
            ok = true;
        }
        return ok;
    }

    /** Edita el texto/caption del mensaje (solo propios editables). */
    async edit(text: string): Promise<boolean> {
        const { _wa: wa, _doc: doc } = this;
        let ok = false;
        if (wa._socket && doc.me) {
            await wa._socket.sendMessage(doc.cid, {
                text,
                edit: { remoteJid: doc.cid, id: doc.id, fromMe: true },
            } as never);
            const content_type = getContentType(doc.raw.message ?? {});
            if (content_type === 'conversation') {
                doc.raw.message = { conversation: text };
            } else if (content_type === 'extendedTextMessage') {
                doc.raw.message = { extendedTextMessage: { text } };
            }
            doc.caption = text;
            doc.edited = true;
            await wa.engine.set(`/chat/${doc.cid}/message/${doc.id}`, serialize(doc));
            ok = true;
        }
        return ok;
    }

    /** Observa cambios sobre este mensaje. Retorna unsubscribe. / Watches this message. Returns unsubscribe. */
    watch(handler: (msg: Message) => void): () => void {
        const cid = this.cid;
        const id = this.id;
        return this._wa.on('message:updated', (updated) => {
            if (updated.cid === cid && updated.id === id) {
                handler(updated);
            }
        });
    }

    /** Responde con texto. */
    async text(caption: string, opts: SendOptions = {}) {
        return this._wa.Message.text(this.cid, caption, { ...opts, mid: this.id });
    }

    /** Responde con imagen. */
    async image(buf: Buffer, opts: SendMediaOptions = {}) {
        return this._wa.Message.image(this.cid, buf, { ...opts, mid: this.id });
    }

    /** Responde con video. */
    async video(buf: Buffer, opts: SendMediaOptions = {}) {
        return this._wa.Message.video(this.cid, buf, { ...opts, mid: this.id });
    }

    /** Responde con audio. */
    async audio(buf: Buffer, opts: SendAudioOptions = {}) {
        return this._wa.Message.audio(this.cid, buf, { ...opts, mid: this.id });
    }

    /** Responde con ubicación. */
    async location(loc: LocationOptions, opts: SendOptions = {}) {
        return this._wa.Message.location(this.cid, loc, { ...opts, mid: this.id });
    }

    /** Responde con encuesta. */
    async poll(poll: PollOptions, opts: SendPollOptions = {}) {
        return this._wa.Message.poll(this.cid, poll, { ...opts, mid: this.id });
    }
}

/**
 * Mensaje de texto. Override `content()` para retornar el caption como Buffer sin pasar por engine.
 * Text message. Overrides `content()` returning caption as Buffer directly.
 */
export class Text extends Message {
    async content(): Promise<Buffer> {
        return Buffer.from(this.caption, 'utf-8');
    }
}

/** @internal Helper compartido por media classes: stream del binario (cache → download). */
async function _media_stream(msg: Message): Promise<Readable> {
    const wa = (msg as unknown as { _wa: WhatsApp })._wa;
    const doc = (msg as unknown as { _doc: IMessage })._doc;
    const cached = deserialize<{ data: string }>(
        await wa.engine.get(`/chat/${doc.cid}/message/${doc.id}/content`)
    );
    if (cached?.data) {
        return Readable.from(Buffer.from(cached.data, 'base64'));
    }
    if (wa._socket) {
        try {
            return (await downloadMediaMessage(doc.raw, 'stream', {})) as unknown as Readable;
        } catch {
            /* fallback empty */
        }
    }
    return Readable.from(Buffer.alloc(0));
}

/** @internal Acumula un Readable en Buffer. */
async function _drain(readable: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

/**
 * Mensaje de imagen. Hereda `stream()` de la clase base; `content()` drena el stream.
 * Image message. Inherits `stream()` from the base class; `content()` drains the stream.
 */
export class Image extends Message {
    async content(): Promise<Buffer> {
        return _drain(await this.stream());
    }
}

/**
 * Mensaje de video. Hereda `stream()` de la clase base; `content()` drena el stream.
 * Video message. Inherits `stream()` from the base class; `content()` drains the stream.
 */
export class Video extends Message {
    async content(): Promise<Buffer> {
        return _drain(await this.stream());
    }
}

/**
 * Mensaje de audio. Hereda `stream()` de la clase base; `content()` drena el stream.
 * `ptt` indica si es nota de voz (push-to-talk).
 * Audio message. Inherits `stream()` from the base class; `content()` drains the stream.
 * `ptt` flags voice notes.
 */
export class Audio extends Message {
    /** true si es nota de voz (push-to-talk). / true if push-to-talk voice note. */
    get ptt(): boolean {
        return this._doc.raw.message?.audioMessage?.ptt === true;
    }
    async content(): Promise<Buffer> {
        return _drain(await this.stream());
    }
}

/**
 * Mensaje de ubicación. Agrega getters sync `lat`, `lng`, `link` derivados del raw.
 * Location message. Adds sync getters `lat`, `lng`, `link` derived from raw.
 */
export class Gps extends Message {
    private get _loc() {
        return this._doc.raw.message?.locationMessage ?? this._doc.raw.message?.liveLocationMessage;
    }

    /** Latitud en grados. / Latitude in degrees. */
    get lat(): number {
        return this._loc?.degreesLatitude ?? 0;
    }
    /** Longitud en grados. / Longitude in degrees. */
    get lng(): number {
        return this._loc?.degreesLongitude ?? 0;
    }
    /** URL de Google Maps apuntando a la coordenada. / Google Maps URL for the coordinate. */
    get link(): string {
        return `https://www.google.com/maps/@${this.lat},${this.lng},15z`;
    }
    /** true si es ubicación en tiempo real. / true when live location. */
    get live(): boolean {
        return Boolean(this._doc.raw.message?.liveLocationMessage);
    }
}

/**
 * Mensaje de encuesta. `caption` es la pregunta (heredada); agrega `options[]` con conteo y `multiple`.
 * Poll message. `caption` is the question (inherited); adds `options[]` with counts and `multiple`.
 */
export class Poll extends Message {
    private get _poll() {
        const m = this._doc.raw.message;
        return m?.pollCreationMessage ?? m?.pollCreationMessageV2 ?? m?.pollCreationMessageV3;
    }

    /**
     * true si admite múltiples respuestas. Lee primero el flag explícito persistido
     * al enviar (caso propio, donde WhatsApp pierde el discriminador en el echo);
     * fallback al `selectableOptionsCount` del proto (polls foráneos o de UI móvil).
     * true if the poll accepts multiple answers. Prefers the persisted send-time
     * flag (own polls, since WhatsApp drops the discriminator on echo); falls back
     * to the proto `selectableOptionsCount` (foreign or mobile-UI polls).
     */
    get multiple(): boolean {
        if (typeof this._doc.multiple === 'boolean') {
            return this._doc.multiple;
        }
        return (this._poll?.selectableOptionsCount ?? 1) !== 1;
    }

    /** Opciones con conteo de votos actualizado. / Options with up-to-date vote counts. */
    get options(): { content: string; count: number }[] {
        const opts = this._poll?.options ?? [];
        const raw_updates = this._doc.raw.pollUpdates ?? [];
        // Normaliza selectedOptions de base64-string a Buffer (BufferJSON no reconstruye el tipo aquí)
        const updates = raw_updates.map((u) => ({
            ...u,
            vote: u.vote
                ? {
                    ...u.vote,
                    selectedOptions: (u.vote.selectedOptions ?? []).map((s) =>
                        typeof s === 'string' ? Buffer.from(s, 'base64') : s
                    ),
                }
                : u.vote,
        }));
        const aggregated = getAggregateVotesInPollMessage(
            { message: this._doc.raw.message ?? undefined, pollUpdates: updates },
            this._wa._socket?.user?.id
        );
        const counts = new Map(aggregated.map((a) => [a.name, a.voters.length]));
        return opts.map((o) => ({
            content: o.optionName ?? '',
            count: counts.get(o.optionName ?? '') ?? 0,
        }));
    }

    /**
     * Vota en la encuesta. Acepta un índice o lista de índices (para `multiple`).
     * Votes in the poll. Accepts a single index or list (for `multiple`).
     */
    async select(index: number | number[]): Promise<boolean> {
        const { _wa, _doc } = this;
        const indices = Array.isArray(index) ? index : [index];
        const opts = this._poll?.options ?? [];
        const selected_options = indices
            .filter((i) => i >= 0 && i < opts.length)
            .map((i) => sha256(Buffer.from(opts[i].optionName ?? '')));

        // messageSecret puede llegar como Buffer (raw runtime) o string base64 (post-deserialize
        // del engine). Normaliza a Buffer antes de derivar el HMAC.
        // messageSecret may arrive as Buffer (runtime raw) or base64 string (post engine
        // deserialize). Normalize to Buffer before deriving the HMAC.
        const secret_raw = _doc.raw.message?.messageContextInfo?.messageSecret;
        const poll_enc_key =
            typeof secret_raw === 'string' ? Buffer.from(secret_raw, 'base64') : secret_raw;
        if (!poll_enc_key || !_wa._socket || selected_options.length === 0) {
            return false;
        }

        // WhatsApp moderno usa la identidad LID para HMAC de poll votes (ver patch
        // devmsh/whatsapp-bridge: "EncryptPollVote uses getOwnID() (Phone JID) but
        // SendMessage uses LID identity. This causes silent decryption failure on
        // poll votes"). Siempre que tengamos LID, lo usamos normalizado (sin device).
        // Modern WhatsApp expects LID identity for poll vote HMAC. Use normalized
        // LID whenever available; fall back to phone JID only if no LID is known.
        const poll_key = _doc.raw.key ?? {};
        const self_id = _wa._socket.user?.id ?? '';
        const self_lid = (_wa._socket.user as { lid?: string })?.lid ?? '';
        const voter_jid = jidNormalizedUser(self_lid || self_id);
        let poll_creator_raw: string;
        if (poll_key.fromMe) {
            poll_creator_raw = self_lid || self_id;
        } else if (poll_key.remoteJid?.endsWith('@lid')) {
            poll_creator_raw = poll_key.remoteJid;
        } else {
            poll_creator_raw = getKeyAuthor(poll_key, self_id);
        }
        const poll_creator_jid = jidNormalizedUser(poll_creator_raw);
        const poll_msg_id = this.id;

        // Derivar clave y encriptar el voto (mismo algoritmo que baileys.decryptPollVote)
        const sign = Buffer.concat([
            Buffer.from(poll_msg_id),
            Buffer.from(poll_creator_jid),
            Buffer.from(voter_jid),
            Buffer.from('Poll Vote'),
            new Uint8Array([1]),
        ]);
        const key0 = hmacSign(poll_enc_key, new Uint8Array(32), 'sha256');
        const enc_key = hmacSign(sign, key0, 'sha256');
        const payload = proto.Message.PollVoteMessage.encode({
            selectedOptions: selected_options,
        }).finish();
        const aad = Buffer.from(`${poll_msg_id}\x00${voter_jid}`);
        const enc_iv = randomBytes(12);
        const enc_payload = aesEncryptGCM(payload, enc_key, enc_iv, aad);

        const msg_id = generateMessageID();
        await _wa._socket.relayMessage(
            _doc.cid,
            {
                pollUpdateMessage: {
                    pollCreationMessageKey: _doc.raw.key,
                    vote: { encPayload: enc_payload, encIv: enc_iv },
                    senderTimestampMs: Date.now(),
                },
            },
            { messageId: msg_id }
        );
        // baileys.relayMessage no echa upsert local al companion que envió el voto.
        // Mergemos el voto propio en el doc para que `options[].count` y el evento
        // `message:updated` reflejen el cambio sin esperar (nunca) un echo del servidor.
        // baileys.relayMessage doesn't emit a local upsert on the originating companion.
        // We merge the own vote into the doc so `options[].count` and the `message:updated`
        // event reflect the change without waiting for a server echo that never comes.
        const own_update_key = {
            remoteJid: _doc.raw.key?.remoteJid ?? _doc.cid,
            fromMe: true,
            id: msg_id,
        };
        updateMessageWithPollUpdate(_doc.raw, {
            pollUpdateMessageKey: own_update_key,
            vote: { selectedOptions: selected_options },
            senderTimestampMs: Date.now(),
        });
        await _wa.engine.set(
            `/chat/${_doc.cid}/message/${_doc.id}`,
            serialize(_doc),
        );
        _wa._event.emit('message:updated', this, await this.chat(), _wa);
        return true;
    }
}

/**
 * Factoría que enlaza los statics a `wa` y expone las subclases.
 * Factory binding statics to `wa` and exposing subclasses.
 */
export function message(wa: WhatsApp) {
    async function build_instance(doc: IMessage): Promise<Message> {
        const opts = { wa, doc };
        if (doc.type === 'text') {
            return new Text(opts);
        }
        if (doc.type === 'image') {
            return new Image(opts);
        }
        if (doc.type === 'video') {
            return new Video(opts);
        }
        if (doc.type === 'audio') {
            return new Audio(opts);
        }
        if (doc.type === 'location') {
            return new Gps(opts);
        }
        if (doc.type === 'poll') {
            return new Poll(opts);
        }
        return new Message(opts);
    }

    async function send(
        cid: string,
        content: Record<string, unknown>,
        binary?: Buffer,
        reply_to?: string,
        doc_overrides?: Partial<IMessage>,
    ): Promise<Message | null> {
        let result: Message | null = null;
        const jid = await wa._resolve_jid(cid);
        if (jid && wa._socket) {
            let quoted: WAMessage | undefined;
            if (reply_to) {
                const ref_doc = deserialize<IMessage>(
                    await wa.engine.get(`/chat/${jid}/message/${reply_to}`)
                );
                if (ref_doc) {
                    quoted = ref_doc.raw;
                }
            }
            const raw = await wa._socket.sendMessage(jid, {
                ...content,
                ...(quoted ? { quoted } : {}),
            } as never);
            const sent_id = raw?.key?.id;
            if (raw && sent_id) {
                const doc = build_message_doc(raw, wa._socket?.user?.id);
                if (doc_overrides) {
                    Object.assign(doc, doc_overrides);
                }
                await wa.engine.set(`/chat/${jid}/message/${sent_id}`, serialize(doc));
                if (binary) {
                    await wa.engine.set(
                        `/chat/${jid}/message/${sent_id}/content`,
                        serialize({ data: binary.toString('base64') })
                    );
                }
                result = await build_instance(doc);
            }
        }
        return result;
    }

    const api = {
        // Clases expuestas para instanceof
        Text,
        Image,
        Video,
        Audio,
        Gps,
        Poll,

        // Helpers internos (usados por orquestador WhatsApp)
        build_message_doc,
        build_instance,

        /** Obtiene un mensaje por CID/MID. */
        async get(cid: string, mid: string): Promise<Message | null> {
            const jid = await wa._resolve_jid(cid);
            if (!jid) {
                return null;
            }
            const doc = deserialize<IMessage>(await wa.engine.get(`/chat/${jid}/message/${mid}`));
            return doc ? build_instance(doc) : null;
        },

        /** Pagina mensajes de un chat. */
        async list(cid: string, offset = 0, limit = 50): Promise<Message[]> {
            const jid = await wa._resolve_jid(cid);
            const result: Message[] = [];
            if (jid) {
                for (const raw of await wa.engine.list(`/chat/${jid}/message`, offset, limit)) {
                    const doc = deserialize<IMessage>(raw);
                    if (doc) {
                        result.push(await build_instance(doc));
                    }
                }
            }
            return result;
        },

        /** Cuenta mensajes de un chat. */
        async count(cid: string): Promise<number> {
            const jid = await wa._resolve_jid(cid);
            return jid ? wa.engine.count(`/chat/${jid}/message`) : 0;
        },

        async text(cid: string, caption: string, opts: SendOptions = {}) {
            return send(cid, { text: caption }, undefined, opts.mid);
        },

        async image(cid: string, buf: Buffer, opts: SendMediaOptions = {}) {
            return send(cid, { image: buf, caption: opts.caption }, buf, opts.mid);
        },

        async video(cid: string, buf: Buffer, opts: SendMediaOptions = {}) {
            return send(cid, { video: buf, caption: opts.caption }, buf, opts.mid);
        },

        async audio(cid: string, buf: Buffer, opts: SendAudioOptions = {}) {
            return send(cid, { audio: buf, ptt: opts.ptt ?? true }, buf, opts.mid);
        },

        async location(cid: string, loc: LocationOptions, opts: SendOptions = {}) {
            return send(
                cid,
                { location: { degreesLatitude: loc.lat, degreesLongitude: loc.lng } },
                undefined,
                opts.mid
            );
        },

        async poll(cid: string, p: PollOptions, opts: SendPollOptions = {}) {
            const multiple = opts.multiple ?? false;
            return send(
                cid,
                {
                    poll: {
                        name: p.content,
                        values: p.options.map((o) => o.content),
                        selectableCount: multiple ? 0 : 1,
                    },
                },
                undefined,
                opts.mid,
                { multiple },
            );
        },

        async edit(cid: string, mid: string, text: string): Promise<boolean> {
            const m = await api.get(cid, mid);
            return m ? m.edit(text) : false;
        },

        async delete(cid: string, mid: string, all = true): Promise<boolean> {
            const m = await api.get(cid, mid);
            return m ? m.delete(all) : false;
        },

        async react(cid: string, mid: string, emoji: string): Promise<boolean> {
            const m = await api.get(cid, mid);
            return m ? m.react(emoji) : false;
        },

        async forward(cid: string, mid: string, target: ForwardTarget): Promise<boolean> {
            const m = await api.get(cid, mid);
            return m ? m.forward(target) : false;
        },

        async seen(cid: string, mid: string): Promise<boolean> {
            const m = await api.get(cid, mid);
            return m ? m.seen() : false;
        },

        async star(cid: string, mid: string, value: boolean): Promise<boolean> {
            const m = await api.get(cid, mid);
            return m ? m.star(value) : false;
        },

        watch(cid: string, mid: string, handler: (msg: Message) => void): () => void {
            return wa.on('message:updated', (updated) => {
                if (updated.cid === cid && updated.id === mid) {
                    handler(updated);
                }
            });
        },
    };

    return api;
}
