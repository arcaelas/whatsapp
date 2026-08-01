/**
 * @file whatsapp/index.ts
 * @description Cliente WhatsApp: configuración, sesión y emisor de eventos. `connect` abre el
 * socket, procesa lo que llega y lo reemite como eventos del cliente.
 * WhatsApp client: configuration, session and event emitter. `connect` opens the socket,
 * processes whatever arrives and re-emits it as client events.
 */

import {
    Browsers,
    decryptPollVote,
    DisconnectReason,
    downloadMediaMessage,
    fetchLatestBaileysVersion,
    getContentType,
    initAuthCreds,
    jidNormalizedUser,
    makeWASocket,
    proto,
    updateMessageWithPollUpdate,
    type AuthenticationCreds,
    type SignalDataTypeMap,
    type WAMessage,
} from 'baileys';
import { EventEmitter } from 'node:events';
import pino from 'pino';
import * as QRCode from 'qrcode';
import { chat, Chat } from '~/lib/chat';
import { contact, Contact } from '~/lib/contact';
import { bind, internals } from '~/lib/internal';
import {
    Audio,
    Document,
    Event,
    Image,
    Location,
    message,
    Message,
    Poll,
    Sticker,
    Text,
    VCard,
    Video,
} from '~/lib/message';
import { Feed, TTL_MS as FEED_TTL_MS } from '~/lib/status';
import { deserialize, serialize, type Engine } from '~/lib/store';

/** Documento persistido de un status broadcast, tal como lo construye el cliente. / Persisted status broadcast document, as built by the client. */
type FeedRaw = ConstructorParameters<typeof Feed>[1];
/** Documento persistido de un mensaje. / Persisted message document. */
type MessageRaw = Message['_raw'];

/** Rechazo del servidor: estado terminal, el único que puede retroceder el avance. / Server rejection: terminal state, the only one allowed to move the state backwards. */
const ERROR = 0;
/** Estados que un receipt puede alcanzar. / States a receipt can reach. */
const READ = 4;
const PLAYED = 5;
/** Tipos cuyo contenido hay que descargar en vez de derivarlo del propio mensaje. / Types whose content must be downloaded instead of derived from the message itself. */
const DOWNLOADABLE = ['image', 'video', 'audio', 'document'];
/** Tipos de status broadcast, indexados por el contenido que trae el mensaje. / Status broadcast types, indexed by the content the message carries. */
const FEED_TYPES: Record<string, FeedRaw['type']> = {
    conversation: 'text',
    extendedTextMessage: 'text',
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
};

/**
 * Cuerpo textual que se persiste junto al mensaje. Los tipos ausentes traen binario y se
 * descargan; `sticker` no aparece porque su binario también viaja aparte.
 * Textual body persisted next to the message. Missing types carry a binary and get downloaded;
 * `sticker` is absent because its binary also travels separately.
 */
const BODIES: Partial<Record<MessageRaw['type'], (msg: WAMessage, doc: MessageRaw) => string>> = {
    text: (_msg, doc) => doc.caption,
    location: (msg) => {
        const loc = msg.message?.locationMessage ?? msg.message?.liveLocationMessage;
        return JSON.stringify({ lat: loc?.degreesLatitude, lng: loc?.degreesLongitude });
    },
    poll: (msg) => {
        const poll = msg.message?.pollCreationMessage ?? msg.message?.pollCreationMessageV2 ?? msg.message?.pollCreationMessageV3;
        return JSON.stringify({ content: poll?.name ?? '', options: poll?.options?.map((o) => ({ content: o.optionName })) ?? [] });
    },
    vcard: (msg) => {
        const cards = msg.message?.contactsArrayMessage?.contacts ?? (msg.message?.contactMessage ? [msg.message.contactMessage] : []);
        return cards.map((c) => c.vcard ?? '').join('\n');
    },
    event: (msg) => JSON.stringify(msg.message?.eventMessage ?? {}),
};

/**
 * Deduce el MIME de un binario por su firma, acotado a lo que WhatsApp acepta en un estado.
 * Infers a binary's MIME from its signature, limited to what WhatsApp accepts in a status.
 *
 * @param data - Binario a inspeccionar / Binary to inspect
 * @returns MIME reconocido, o null / Recognized MIME, or null
 */
function sniff_media(data: Buffer): string | null {
    if (data.subarray(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
    if (data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
    if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
    if (data.subarray(4, 8).toString() === 'ftyp') return 'video/mp4';
    return null;
}

/**
 * Normaliza cualquier identificador (JID, LID, número) a JID canónico. Vive fuera de la clase
 * porque el constructor la publica en el canal interno para que las entidades la usen.
 * Normalizes any identifier (JID, LID, phone) into a canonical JID. It lives outside the class
 * because the constructor publishes it on the internal channel for the entities to use.
 *
 * @param wa - Cliente dueño / Owner client
 * @param uid - Identificador crudo / Raw identifier
 * @returns JID canónico, o null si no es determinable / Canonical JID, or null when undeterminable
 */
async function resolve_jid(wa: WhatsApp, uid: string): Promise<string | null> {
    if (uid.endsWith('@g.us') || uid.endsWith('@s.whatsapp.net')) {
        return uid;
    }
    if (!uid.endsWith('@lid')) {
        const digits = uid.replace(/\D/g, '');
        return digits ? `${digits}@s.whatsapp.net` : null;
    }
    // Los receipts direccionan por dispositivo (`…:9@lid`) y el índice se guarda sin él. El
    // mapping puede faltar en el store (sesión sin upsert del contacto) y en ese caso lo sabe
    // baileys: sin esa última vía, un chat referenciado por @lid no resuelve al PN donde está
    // guardado y su mensaje no se encuentra.
    // Receipts address per device (`…:9@lid`) and the index is stored without it. The mapping
    // may be missing from the store (session with no contact upsert) and baileys knows it then:
    // without that last resort, a chat referenced by @lid does not resolve to the PN it is
    // stored under and its message is never found.
    const lid = jidNormalizedUser(uid);
    const direct = deserialize<string>(await wa.engine.get(`/lid/${lid}`));
    if (direct) {
        return direct.includes('@') ? direct : `${direct}@s.whatsapp.net`;
    }
    const reverse = deserialize<string | number>(await wa.engine.get(`/lid/${lid.split('@')[0]}_reverse`));
    if (reverse != null) {
        return `${reverse}@s.whatsapp.net`;
    }
    const pn = await (internals(wa).socket as unknown as {
        signalRepository?: { lidMapping?: { getPNForLID(lid: string): Promise<string | null | undefined> } };
    } | null)?.signalRepository?.lidMapping?.getPNForLID(lid).catch(() => null);
    // getPNForLID puede traer sufijo de dispositivo (`:0`); el store lo guarda sin él.
    return pn ? jidNormalizedUser(pn.includes('@') ? pn : `${pn}@s.whatsapp.net`) : null;
}

/**
 * Persiste un binario: crudo cuando el driver lo soporta, JSON con base64 si no.
 * Persists a binary: raw when the driver supports it, base64 JSON otherwise.
 *
 * @param wa - Cliente dueño / Owner client
 * @param path - Ruta del documento / Document path
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
 * Descifra un voto de encuesta probando las identidades posibles del votante y del creador:
 * el addressing del chat varía entre LID y PN, y AES-GCM autentica, así que la combinación
 * equivocada lanza y se prueba la siguiente.
 * Decrypts a poll vote trying the possible voter and creator identities: chat addressing varies
 * between LID and PN, and AES-GCM authenticates, so a wrong combination throws and the next one
 * is tried.
 *
 * @param wa - Cliente dueño / Owner client
 * @param msg - Mensaje de voto / Vote message
 * @param poll - Documento de la encuesta votada / Voted poll document
 * @returns Voto descifrado, o null si ninguna identidad sirvió / Decrypted vote, or null when no identity worked
 */
function decrypt_vote(wa: WhatsApp, msg: WAMessage, poll: MessageRaw): ReturnType<typeof decryptPollVote> | null {
    const vote = msg.message?.pollUpdateMessage?.vote;
    const secret_raw = poll.raw.message?.messageContextInfo?.messageSecret;
    const secret = typeof secret_raw === 'string' ? Buffer.from(secret_raw, 'base64') : secret_raw;
    if (!vote?.encPayload || !vote.encIv || !secret) {
        return null;
    }
    const user = internals(wa).socket?.user;
    const selves = [...new Set([(user as { lid?: string })?.lid, user?.id].filter((id): id is string => Boolean(id)))];
    const others = (key: { remoteJid?: string | null; participant?: string | null; remoteJidAlt?: string }): string[] =>
        [...new Set([key.remoteJid, key.participant, key.remoteJidAlt].filter((id): id is string => Boolean(id)))];
    const voters = msg.key.fromMe ? selves : others(msg.key);
    const creators = poll.raw.key?.fromMe ? selves : others(poll.raw.key ?? {});
    for (const voter of voters) {
        for (const creator of creators) {
            try {
                return decryptPollVote(
                    { encPayload: vote.encPayload, encIv: vote.encIv },
                    { pollCreatorJid: jidNormalizedUser(creator), pollMsgId: poll.id, pollEncKey: secret, voterJid: jidNormalizedUser(voter) }
                );
            } catch {
                /* identidad equivocada: probar la siguiente / wrong identity: try the next one */
            }
        }
    }
    return null;
}

/**
 * Configuración de reconexión automática tras cierres no-loggedOut.
 * - `true` (default): reintenta indefinidamente con 60s de intervalo.
 * - `false`: no reconecta.
 * - `number`: máximo N reintentos con 60s de intervalo.
 * - `{ max, interval }`: control explícito (interval en segundos).
 *
 * Automatic reconnection config for non-loggedOut closes.
 */
export type ReconnectOption = boolean | number | { max?: number; interval?: number };

export interface IWhatsApp {
    /** Motor de almacenamiento. / Storage engine. */
    engine: Engine;
    /**
     * Teléfono de la cuenta. Su presencia habilita el emparejamiento por PIN; sin él la
     * vinculación es siempre por QR.
     * Account phone. Its presence enables PIN pairing; without it linking is always by QR.
     */
    phone?: number | string;
    /**
     * Elige el canal de vinculación **cuando hay `phone`**: `otp` (default) o `qr`. Sin
     * `phone` la opción se ignora, porque el PIN no puede pedirse sin número.
     * Picks the linking channel **when `phone` is set**: `otp` (default) or `qr`. Without
     * `phone` it is ignored, since a PIN cannot be requested without a number.
     */
    method?: 'qr' | 'otp';
    /**
     * Si al recibir `loggedOut` debe limpiar todo el engine (default: `true`).
     * Si es `false`, solo elimina `/session/creds` y preserva historial.
     *
     * Whether to clear the entire engine on `loggedOut` (default: `true`).
     */
    autoclean?: boolean;
    /** Reconexión automática tras cierres no-loggedOut. Default: `true`. / Auto-reconnect on non-loggedOut closes. */
    reconnect?: ReconnectOption;
    /**
     * Descarga del historial de mensajes al vincular (default: `true`). Sólo afecta los
     * mensajes: contactos, credenciales, LID mappings y tctokens se sincronizan siempre
     * (rc13 los exige para enviar). `false` omite únicamente el historial de mensajes.
     *
     * Message-history download on link (default: `true`). Messages only: contacts,
     * credentials, LID mappings and tctokens always sync (rc13 requires them to send).
     */
    sync?: boolean;
}

/**
 * Opciones de desconexión.
 * Disconnect options.
 */
export interface DisconnectOptions {
    /** No emitir el evento `disconnected` de este cierre. / Suppress this close's `disconnected` event. */
    silent?: boolean;
    /** Vaciar el engine tras cerrar. / Clear the engine after closing. */
    destroy?: boolean;
}

/** Argumentos de un estático de envío sin el cliente ni el cid. / Send-static arguments without client and cid. */
type Tail<P extends unknown[]> = P extends [unknown, unknown, ...infer R] ? R : never;

type MessageInstance = Message;
type ChatInstance = InstanceType<ReturnType<typeof chat>>;
type ContactInstance = InstanceType<ReturnType<typeof contact>>;

/**
 * Mapa de eventos emitidos por el cliente. Cada listener recibe el artefacto principal seguido
 * de la instancia del cliente como último argumento.
 * Map of events emitted by the client. Each listener receives the primary payload followed by
 * the client instance as the last argument.
 */
export interface WhatsAppEventMap {
    connected: [WhatsApp];
    disconnected: [WhatsApp];
    'contact:created': [ContactInstance, ChatInstance, WhatsApp];
    'contact:updated': [ContactInstance, ChatInstance, WhatsApp];
    'chat:created': [ChatInstance, WhatsApp];
    'chat:deleted': [ChatInstance, WhatsApp];
    'chat:pinned': [ChatInstance, WhatsApp];
    'chat:unpinned': [ChatInstance, WhatsApp];
    'chat:archived': [ChatInstance, WhatsApp];
    'chat:unarchived': [ChatInstance, WhatsApp];
    'chat:muted': [ChatInstance, WhatsApp];
    'chat:unmuted': [ChatInstance, WhatsApp];
    'message:created': [MessageInstance, ChatInstance, WhatsApp];
    'message:updated': [MessageInstance, ChatInstance, WhatsApp];
    'message:deleted': [MessageInstance, ChatInstance, WhatsApp];
    'message:reacted': [MessageInstance, ChatInstance, string, WhatsApp];
    'message:starred': [MessageInstance, ChatInstance, WhatsApp];
    'message:unstarred': [MessageInstance, ChatInstance, WhatsApp];
    'message:forwarded': [MessageInstance, ChatInstance, WhatsApp];
    'message:seen': [MessageInstance, ChatInstance, WhatsApp];
    'feed:created': [Feed, WhatsApp];
    'feed:updated': [Feed, WhatsApp];
    'feed:deleted': [Feed, WhatsApp];
}

/** Eventos de mensaje que llevan la misma terna `[mensaje, chat, cliente]`. / Message events carrying the same `[message, chat, client]` triple. */
type MessageEvent = 'message:created' | 'message:updated' | 'message:deleted' | 'message:starred' | 'message:unstarred' | 'message:forwarded' | 'message:seen';

/**
 * Cliente principal de WhatsApp. No inicia la conexión al instanciar.
 * Main WhatsApp client. Does not connect on instantiation.
 *
 * @example
 * const wa = new WhatsApp({ engine: new FileSystemEngine(__dirname), phone: 5491112345678 });
 * wa.on('message:created', (msg) => console.log(msg.caption));
 * await wa.connect((code) => console.log(code));
 */
export class WhatsApp {
    /** @internal Emisor de los eventos del cliente. / Client event emitter. */
    #event = new EventEmitter<WhatsAppEventMap>();
    /** @internal Opciones ya normalizadas. / Options already normalized. */
    #options: {
        phone?: string;
        method?: 'qr' | 'otp';
        autoclean: boolean;
        sync: boolean;
        reconnect: { max: number | null; interval_ms: number };
    };
    /**
     * @internal
     * Cierre de la sesión viva, publicado por `connect`: cancela el reintento pendiente y
     * termina el socket. Null mientras no se ha conectado nunca.
     * Live session teardown, published by `connect`: cancels the pending retry and ends the
     * socket. Null while it has never connected.
     */
    #close: ((silent: boolean) => Promise<void>) | null = null;

    /** Motor de almacenamiento de la sesión. / Session storage engine. */
    readonly engine: Engine;
    /** Entidad `Contact` ligada a este cliente. / `Contact` entity bound to this client. */
    readonly Contact: ReturnType<typeof contact>;
    /** Entidad `Chat` ligada a este cliente. / `Chat` entity bound to this client. */
    readonly Chat: ReturnType<typeof chat>;
    /**
     * Entidad `Message` ligada a este cliente: los mismos estáticos de `Message` sin repetir
     * la instancia, más las subclases para `instanceof`.
     * `Message` entity bound to this client: the same `Message` statics without repeating the
     * instance, plus the subclasses for `instanceof`.
     */
    readonly Message: {
        get: (cid: string, mid: string) => ReturnType<typeof Message.get>;
        list: (cid: string, offset?: number, limit?: number) => ReturnType<typeof Message.list>;
        text: (cid: string, ...rest: Tail<Parameters<typeof Message.text>>) => ReturnType<typeof Message.text>;
        image: (cid: string, ...rest: Tail<Parameters<typeof Message.image>>) => ReturnType<typeof Message.image>;
        video: (cid: string, ...rest: Tail<Parameters<typeof Message.video>>) => ReturnType<typeof Message.video>;
        audio: (cid: string, ...rest: Tail<Parameters<typeof Message.audio>>) => ReturnType<typeof Message.audio>;
        location: (cid: string, ...rest: Tail<Parameters<typeof Message.location>>) => ReturnType<typeof Message.location>;
        poll: (cid: string, ...rest: Tail<Parameters<typeof Message.poll>>) => ReturnType<typeof Message.poll>;
        document: (cid: string, ...rest: Tail<Parameters<typeof Message.document>>) => ReturnType<typeof Message.document>;
        vcard: (cid: string, ...rest: Tail<Parameters<typeof Message.vcard>>) => ReturnType<typeof Message.vcard>;
        event: (cid: string, ...rest: Tail<Parameters<typeof Message.event>>) => ReturnType<typeof Message.event>;
        react: (cid: string, mid: string, emoji: string) => Promise<boolean>;
        star: (cid: string, mid: string, value: boolean) => Promise<boolean>;
        seen: (cid: string, mid: string) => Promise<boolean>;
        edit: (cid: string, mid: string, caption: string) => Promise<boolean>;
        forward: (cid: string, mid: string, target: string | Chat | Contact) => Promise<boolean>;
        delete: (cid: string, mid: string, all?: boolean) => Promise<boolean>;
        reactions: (cid: string, mid: string) => Promise<{ emoji: string; count: number }[]>;
        Text: typeof Text;
        Image: typeof Image;
        Video: typeof Video;
        Audio: typeof Audio;
        Sticker: typeof Sticker;
        Document: typeof Document;
        Location: typeof Location;
        Poll: typeof Poll;
        VCard: typeof VCard;
        Event: typeof Event;
    };

    constructor(options: IWhatsApp) {
        this.engine = options.engine;
        this.#options = {
            phone: options.phone !== undefined ? String(options.phone).replace(/\D+/g, '') : undefined,
            method: options.method,
            autoclean: options.autoclean ?? true,
            sync: options.sync ?? true,
            reconnect:
                options.reconnect === false ? { max: 0, interval_ms: 60_000 }
                    : options.reconnect === undefined || options.reconnect === true ? { max: null, interval_ms: 60_000 }
                        : typeof options.reconnect === 'number' ? { max: options.reconnect, interval_ms: 60_000 }
                            : { max: options.reconnect.max ?? null, interval_ms: (options.reconnect.interval ?? 60) * 1_000 },
        };
        // El socket y la resolución de JIDs viajan por el canal interno: las entidades los
        // alcanzan sin que aparezcan en la superficie pública del cliente.
        // The socket and JID resolution travel through the internal channel: entities reach
        // them without surfacing on the client's public API.
        bind(this, { socket: null, resolve_jid: (uid) => resolve_jid(this, uid) });
        this.Contact = contact(this);
        this.Chat = chat(this);
        this.Message = {
            get: (cid, mid) => Message.get(this, cid, mid),
            list: (cid, offset, limit) => Message.list(this, cid, offset, limit),
            text: (cid, ...rest) => Message.text(this, cid, ...rest),
            image: (cid, ...rest) => Message.image(this, cid, ...rest),
            video: (cid, ...rest) => Message.video(this, cid, ...rest),
            audio: (cid, ...rest) => Message.audio(this, cid, ...rest),
            location: (cid, ...rest) => Message.location(this, cid, ...rest),
            poll: (cid, ...rest) => Message.poll(this, cid, ...rest),
            document: (cid, ...rest) => Message.document(this, cid, ...rest),
            vcard: (cid, ...rest) => Message.vcard(this, cid, ...rest),
            event: (cid, ...rest) => Message.event(this, cid, ...rest),
            react: (cid, mid, emoji) => Message.react(this, cid, mid, emoji),
            star: (cid, mid, value) => Message.star(this, cid, mid, value),
            seen: (cid, mid) => Message.seen(this, cid, mid),
            edit: (cid, mid, caption) => Message.edit(this, cid, mid, caption),
            forward: (cid, mid, target) => Message.forward(this, cid, mid, target),
            delete: (cid, mid, all) => Message.delete(this, cid, mid, all),
            reactions: (cid, mid) => Message.reactions(this, cid, mid),
            Text, Image, Video, Audio, Sticker, Document, Location, Poll, VCard, Event,
        };
    }

    /**
     * Contacto de la cuenta autenticada, o null mientras no hay sesión abierta.
     * Authenticated account's contact, or null while there is no open session.
     */
    get contact(): InstanceType<ReturnType<typeof contact>> | null {
        const user = internals(this).socket?.user;
        if (user) {
            const jid = jidNormalizedUser(user.id);
            return new this.Contact({ id: jid, phone_number: jid, lid: user.lid ?? null, name: user.name ?? null });
        }
        return null;
    }

    /**
     * Emite un evento del cliente. Lo usan las entidades de la librería para propagar los
     * cambios que provocan; el consumidor puede emitir los suyos para pruebas.
     * Emits a client event. Library entities use it to propagate the changes they cause;
     * consumers may emit their own for testing.
     *
     * @param event - Nombre del evento / Event name
     * @param args - Argumentos del evento / Event arguments
     * @returns true si había listeners / true when listeners were present
     */
    emit<E extends keyof WhatsAppEventMap>(event: E, ...args: WhatsAppEventMap[E]): boolean {
        return this.#event.emit(event, ...(args as never));
    }

    /**
     * Registra un listener de evento. Retorna función para desuscribirse.
     * Registers an event listener. Returns an unsubscribe function.
     */
    on<E extends keyof WhatsAppEventMap>(event: E, handler: (...args: WhatsAppEventMap[E]) => void): () => void {
        this.#event.on(event, handler as never);
        return () => { this.#event.off(event, handler as never); };
    }

    /**
     * Quita un listener previamente registrado.
     * Removes a previously registered listener.
     */
    off<E extends keyof WhatsAppEventMap>(event: E, handler: (...args: WhatsAppEventMap[E]) => void): this {
        this.#event.off(event, handler as never);
        return this;
    }

    /**
     * Registra un listener one-shot. Retorna función para desuscribirse antes de que dispare.
     * Registers a one-shot listener. Returns an unsubscribe function.
     */
    once<E extends keyof WhatsAppEventMap>(event: E, handler: (...args: WhatsAppEventMap[E]) => void): () => void {
        this.#event.once(event, handler as never);
        return () => { this.#event.off(event, handler as never); };
    }

    /**
     * Abre la sesión y procesa lo que llega del socket: historial, contactos, chats, mensajes,
     * estados y receipts se guardan en el engine y se reemiten como eventos del cliente. El
     * callback recibe el PIN (string) si se configuró `phone`, o el QR (Buffer PNG) si no.
     * Resuelve cuando la sesión sincroniza; reintenta en cierres no-loggedOut.
     *
     * Opens the session and processes whatever arrives from the socket: history, contacts,
     * chats, messages, statuses and receipts are stored in the engine and re-emitted as client
     * events. The callback receives the PIN (string) when `phone` is configured, or the QR (PNG
     * Buffer) otherwise. Resolves once the session syncs; retries on non-loggedOut closes.
     *
     * @param callback - Recibe el PIN o el QR en cada refresco / Receives the PIN or QR on every refresh
     */
    async connect(callback: (auth: string | Buffer) => void | Promise<void>): Promise<void> {
        await this.#close?.(true);
        const { version } = await fetchLatestBaileysVersion();

        // Estado de esta conexión: vive en el closure, no en la instancia.
        // This connection's state: it lives in the closure, not on the instance.
        let intentional = false;
        let silent = false;
        let connected = false;
        let retries = 0;
        let timer: ReturnType<typeof setTimeout> | null = null;
        // Cadena que serializa el procesamiento: dos eventos sobre el mismo documento ya no se
        // intercalan (lost updates por read-modify-write concurrente).
        // Chain serializing the processing: two events over the same document no longer
        // interleave (lost updates from concurrent read-modify-write).
        let chain: Promise<void> = Promise.resolve();
        const run = (task: () => Promise<void>): void => {
            chain = chain.then(task).catch(() => { });
        };

        const load = async <T>(path: string): Promise<T | null> => deserialize<T>(await this.engine.get(path));
        const save = (path: string, value: unknown, score?: number): Promise<void> => this.engine.set(path, serialize(value), score);
        const fire = async (event: MessageEvent, doc: MessageRaw): Promise<void> => {
            const msg = message(this, doc);
            this.emit(event, msg, await msg.chat(), this);
        };
        /**
         * Ubica el documento de un mensaje: los updates y receipts llegan direccionados por LID
         * —con o sin dispositivo— mientras el documento vive bajo el JID con el que se guardó.
         * Locates a message document: updates and receipts arrive LID-addressed —with or without
         * device— while the document lives under the JID it was stored with.
         */
        const locate = async (cid: string, mid: string): Promise<{ path: string; doc: MessageRaw } | null> => {
            const tried = new Set<string>();
            for (const candidate of [await resolve_jid(this, cid), cid, jidNormalizedUser(cid)]) {
                if (candidate && !tried.has(candidate)) {
                    tried.add(candidate);
                    const path = `/chat/${candidate}/message/${mid}`;
                    const doc = await load<MessageRaw>(path);
                    if (doc) {
                        return { path, doc };
                    }
                }
            }
            return null;
        };
        /**
         * Persiste un contacto fusionando con lo guardado: los upserts del re-sync llegan con
         * los campos vacíos y sin fusionar borrarían el nombre ya conocido.
         * Persists a contact merging with what is stored: re-sync upserts arrive with empty
         * fields and without merging would wipe the name already known.
         */
        const keep_contact = async (raw: Contact['_raw']): Promise<void> => {
            const current = await load<Contact['_raw']>(`/contact/${raw.id}`);
            const doc: Contact['_raw'] = current ? { ...current, ...Object.fromEntries(Object.entries(raw).filter(([, value]) => value != null)) } : raw;
            await save(`/contact/${raw.id}`, doc);
            if (doc.lid) {
                await save(`/lid/${doc.lid}`, doc.id);
            }
            // Una ficha que existía vacía y ahora tiene nombre es un cambio que el consumidor
            // necesita: sin avisar, quien memorice el contacto sigue mostrando el número.
            // A card that existed empty and now has a name is a change the consumer needs:
            // without notifying, whoever memoized it keeps showing the bare number.
            if (!current || JSON.stringify(current) !== JSON.stringify(doc)) {
                const person = new this.Contact(doc);
                const cached = await load<Chat['_raw']>(`/chat/${doc.id}`);
                this.emit(current ? 'contact:updated' : 'contact:created', person, new this.Chat(cached ?? { id: doc.id, name: person.name }), this);
            }
        };
        /**
         * Guarda un chat con su actividad como score, que es lo que ordena la lista. Un chat sin
         * marca propia la hereda de su último mensaje persistido.
         * Stores a chat with its activity as score, which is what orders the list. A chat with no
         * stamp of its own inherits it from its last persisted message.
         */
        const keep_chat = async (raw: Chat['_raw'], stamp?: number | null): Promise<void> => {
            const [newest] = await this.engine.list(`/chat/${raw.id}/message`, 0, 1);
            const persisted = deserialize<MessageRaw>(newest ?? null)?.created_at ?? 0;
            raw.activity = Math.max(stamp ?? 0, raw.activity ?? 0, persisted) || null;
            await save(`/chat/${raw.id}`, raw, raw.activity ?? 0);
        };

        const contacts_upsert = async (rows: { id?: string | null; lid?: string | null; name?: string | null; notify?: string | null; verifiedName?: string | null; imgUrl?: string | null; status?: string | null }[]): Promise<void> => {
            for (const row of rows) {
                if (row.id) {
                    await keep_contact({
                        id: row.id,
                        lid: row.lid ?? null,
                        name: row.name ?? null,
                        notify: row.notify ?? null,
                        verified_name: row.verifiedName ?? null,
                        img_url: row.imgUrl ?? null,
                        status: row.status ?? null,
                    });
                }
            }
        };

        const chats_upsert = async (rows: { id?: string | null; name?: string | null; archived?: boolean | null; pinned?: number | null; muteEndTime?: number | Long | null; unreadCount?: number | null; conversationTimestamp?: number | Long | null }[]): Promise<void> => {
            for (const row of rows) {
                if (row.id) {
                    const current = await load<Chat['_raw']>(`/chat/${row.id}`);
                    const raw: Chat['_raw'] = current ?? {
                        id: row.id,
                        name: row.name ?? null,
                        archived: row.archived ?? null,
                        pinned: row.pinned ?? null,
                        mute_end_time: row.muteEndTime != null ? Number(row.muteEndTime) : null,
                        unread_count: row.unreadCount ?? null,
                    };
                    if (row.name) {
                        raw.name = row.name;
                    }
                    await keep_chat(raw, row.conversationTimestamp != null ? Number(row.conversationTimestamp) * 1_000 : null);
                    if (!current) {
                        this.emit('chat:created', new this.Chat(raw), this);
                    }
                }
            }
        };

        const messages_upsert = async (rows: WAMessage[]): Promise<void> => {
            for (const msg of rows) {
                const cid = (msg.key as { remoteJidAlt?: string })?.remoteJidAlt ?? msg.key?.remoteJid;
                const mid = msg.key?.id;
                if (!cid || !mid) {
                    continue;
                }
                const kind = getContentType(msg.message ?? {});

                // Las reacciones llegan por `messages.reaction` Y acá como `reactionMessage`:
                // este es el único canal que se procesa, para no dispararlas dos veces.
                // Reactions arrive through `messages.reaction` AND here as a `reactionMessage`:
                // this is the only channel processed, so they do not fire twice.
                if (kind === 'reactionMessage') {
                    const target = msg.message?.reactionMessage;
                    const found = target?.key?.id && target.key.remoteJid ? await locate(target.key.remoteJid, target.key.id) : null;
                    if (found && target) {
                        const author = jidNormalizedUser(
                            (msg.key.fromMe ? internals(this).socket?.user?.id : msg.key.participant ?? cid) ?? cid
                        );
                        const emoji = target.text ?? '';
                        found.doc.reactions = [
                            ...(found.doc.reactions ?? []).filter((r) => r.author !== author),
                            ...(emoji ? [{ author, emoji, at: Date.now() }] : []),
                        ];
                        await save(found.path, found.doc, found.doc.created_at);
                        const instance = message(this, found.doc);
                        this.emit('message:reacted', instance, await instance.chat(), emoji, this);
                    }
                    continue;
                }

                // Status broadcast: documento propio bajo `/status`, nunca emite `message:*`.
                // Status broadcast: its own document under `/status`, never emits `message:*`.
                if (msg.key.remoteJid === 'status@broadcast') {
                    const revoked = kind === 'protocolMessage' && msg.message?.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE
                        ? msg.message.protocolMessage.key?.id
                        : null;
                    if (revoked) {
                        const gone = await load<FeedRaw>(`/status/${revoked}`);
                        if (gone) {
                            await this.engine.unset(`/status/${revoked}`);
                            this.emit('feed:deleted', new Feed(this, gone), this);
                        }
                        continue;
                    }
                    const type = FEED_TYPES[kind ?? ''];
                    const author = msg.key.participant ?? '';
                    if (!type || !author) {
                        continue;
                    }
                    const body = msg.message?.[kind as keyof typeof msg.message] as Record<string, unknown> | string | undefined;
                    const caption = typeof body === 'string' ? body : ((body?.caption as string) ?? (body?.text as string) ?? '');
                    const created_at = (Number(msg.messageTimestamp) || Math.floor(Date.now() / 1_000)) * 1_000;
                    const doc: FeedRaw = {
                        id: mid,
                        author_jid: author,
                        type,
                        caption,
                        mime: type === 'text' ? 'text/plain' : ((typeof body === 'object' && (body?.mimetype as string)) || 'application/octet-stream'),
                        created_at,
                        expires_at: created_at + FEED_TTL_MS,
                        viewed: false,
                        raw: msg,
                    };
                    const binary = type === 'text'
                        ? Buffer.from(caption, 'utf-8')
                        : await downloadMediaMessage(msg, 'buffer', {}).catch(() => Buffer.alloc(0)) as Buffer;
                    await save(`/status/${mid}`, doc);
                    if (binary.length > 0) {
                        await write_content(this, `/status/${mid}/content`, binary);
                    }
                    this.emit('feed:created', new Feed(this, doc), this);
                    continue;
                }

                // Voto de encuesta: se descifra contra la encuesta votada y la actualiza.
                // Poll vote: decrypted against the voted poll and applied to it.
                if (kind === 'pollUpdateMessage') {
                    const key = msg.message?.pollUpdateMessage?.pollCreationMessageKey;
                    const found = key?.id && key.remoteJid ? await locate(key.remoteJid, key.id) : null;
                    const vote = found ? decrypt_vote(this, msg, found.doc) : null;
                    if (found && vote) {
                        updateMessageWithPollUpdate(found.doc.raw, {
                            pollUpdateMessageKey: msg.key,
                            vote,
                            senderTimestampMs: Number(msg.messageTimestamp) || Date.now(),
                        });
                        await save(found.path, found.doc, found.doc.created_at);
                        await fire('message:updated', found.doc);
                    }
                    continue;
                }

                // Edición y revocación viajan como protocolo sobre un mensaje ya persistido.
                // Edits and revokes travel as a protocol message over an already persisted one.
                if (kind === 'protocolMessage') {
                    const protocol = msg.message?.protocolMessage;
                    const found = protocol?.key?.id ? await locate(protocol.key.remoteJid ?? cid, protocol.key.id) : null;
                    if (found && protocol?.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT && protocol.editedMessage) {
                        found.doc.raw.message = protocol.editedMessage;
                        found.doc.edited = true;
                        found.doc.caption = message(this, found.doc.raw).caption;
                        await save(found.path, found.doc, found.doc.created_at);
                        await fire('message:updated', found.doc);
                    } else if (found && protocol?.type === proto.Message.ProtocolMessage.Type.REVOKE) {
                        await this.engine.unset(found.path);
                        await fire('message:deleted', found.doc);
                    }
                    continue;
                }

                const doc = message(this, msg)._raw;
                const stored = await load<MessageRaw>(`/chat/${cid}/message/${mid}`);
                if (stored) {
                    // Cada reconexión re-entrega el historial: reescribir un documento idéntico
                    // contamina la cronología, re-descarga la media y spamea eventos. El estado
                    // conocido gana, porque el historial reporta el que tenía al sincronizarse.
                    // Every reconnect re-delivers the history: rewriting an identical document
                    // pollutes chronology, re-downloads media and spams events. The known state
                    // wins, since history reports the one it had when synced.
                    doc.multiple = typeof stored.multiple === 'boolean' ? stored.multiple : doc.multiple;
                    doc.reactions = stored.reactions ?? doc.reactions;
                    const advanced = doc.status > stored.status;
                    doc.status = Math.max(stored.status, doc.status);
                    if (!advanced && stored.caption === doc.caption && stored.edited === doc.edited && stored.starred === doc.starred) {
                        continue;
                    }
                }

                // Un mensaje entrante puede ser lo primero que se sepa del contacto y del chat:
                // el pushName y el nombre del negocio verificado viajan con él.
                // An incoming message may be the first thing known about the contact and the
                // chat: the pushName and the verified business name travel with it.
                if (!stored && !doc.me) {
                    const known = await load<Contact['_raw']>(`/contact/${doc.author}`);
                    if (doc.author && !(known?.name ?? known?.notify ?? known?.verified_name)) {
                        await keep_contact({
                            id: doc.author,
                            lid: msg.key.remoteJid?.endsWith('@lid') ? msg.key.remoteJid : null,
                            name: null,
                            notify: msg.pushName ?? null,
                            verified_name: msg.verifiedBizName ?? null,
                            img_url: null,
                            status: null,
                        });
                    }
                    if (!(await this.engine.get(`/chat/${cid}`))) {
                        const fresh: Chat['_raw'] = { id: cid, name: cid.endsWith('@g.us') ? null : msg.pushName ?? null, activity: doc.created_at };
                        await save(`/chat/${cid}`, fresh, doc.created_at);
                        this.emit('chat:created', new this.Chat(fresh), this);
                    }
                }

                await save(`/chat/${cid}/message/${mid}`, doc, doc.created_at);

                // El mensaje más nuevo define la posición del chat; uno viejo del re-sync no.
                // The newest message defines the chat's position; an old one from the re-sync does not.
                const owner = await load<Chat['_raw']>(`/chat/${cid}`);
                if (owner && doc.created_at > (owner.activity ?? 0)) {
                    owner.activity = doc.created_at;
                    await save(`/chat/${cid}`, owner, doc.created_at);
                }

                // El binario se materializa en la primera entrega; en re-syncs ya está guardado.
                // The binary is materialized on first delivery; on re-syncs it is already stored.
                if (!stored) {
                    const body = BODIES[doc.type]?.(msg, doc);
                    const binary = body !== undefined
                        ? Buffer.from(body, 'utf-8')
                        : internals(this).socket && DOWNLOADABLE.includes(doc.type)
                            ? await downloadMediaMessage(msg, 'buffer', {}).catch(() => Buffer.alloc(0)) as Buffer
                            : Buffer.alloc(0);
                    if (binary.length > 0) {
                        await write_content(this, `/chat/${cid}/message/${mid}/content`, binary);
                    }
                }

                await fire('message:created', doc);
                if (doc.forwarded) {
                    await fire('message:forwarded', doc);
                }
            }
        };

        return new Promise<void>((resolve, reject) => {
            const start = async (): Promise<void> => {
                // Re-lee creds en cada start() para que limpiezas del engine tomen efecto
                // en reintentos (permite al consumer forzar nueva sesión borrando /session/creds).
                const stored = await this.engine.get('/session/creds');
                const creds: AuthenticationCreds = deserialize<AuthenticationCreds>(stored) ?? initAuthCreds();

                const socket = makeWASocket({
                    version,
                    auth: {
                        creds,
                        keys: {
                            get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
                                const data: { [id: string]: SignalDataTypeMap[T] } = {};
                                await Promise.all(ids.map(async (id) => {
                                    const value = deserialize<SignalDataTypeMap[T]>(await this.engine.get(`/session/${type}/${id}`));
                                    if (value) {
                                        data[id] =
                                            type === 'app-state-sync-key'
                                                ? (proto.Message.AppStateSyncKeyData.create(value as never) as unknown as SignalDataTypeMap[T])
                                                : value;
                                    }
                                }));
                                return data;
                            },
                            set: async (data: Record<string, Record<string, unknown | null>>) => {
                                await Promise.all(Object.entries(data).flatMap(([category, entries]) =>
                                    Object.entries(entries).map(([id, value]) =>
                                        value != null
                                            ? this.engine.set(`/session/${category}/${id}`, serialize(value))
                                            : this.engine.unset(`/session/${category}/${id}`)
                                    )
                                ));
                            },
                        },
                    },
                    browser: Browsers.windows('Chrome'),
                    logger: pino({ level: 'silent' }),
                    syncFullHistory: this.#options.sync,
                    // Los syncs no-FULL cargan las LID mappings y los tctokens (trusted-contact
                    // tokens) que rc13 exige para enviar: apagarlos todos deja la sesión sin
                    // tctoken y el server rechaza los mensajes con "error 463: account restricted
                    // or missing tctoken". Por eso se procesan siempre los no-FULL; `sync` solo
                    // decide si además se trae el historial FULL.
                    // Non-FULL syncs carry the LID mappings and tctokens rc13 requires to send;
                    // disabling them all left the session with no tctoken and the server rejected
                    // messages with error 463. We always process non-FULL; `sync` only gates
                    // whether FULL history is pulled too.
                    shouldSyncHistoryMessage: ({ syncType }) =>
                        this.#options.sync || syncType !== proto.HistorySync.HistorySyncType.FULL,
                    markOnlineOnConnect: false,
                });
                internals(this).socket = socket;

                socket.ev.on('creds.update', () => this.engine.set('/session/creds', serialize(creds)));

                socket.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;

                    if (qr && !creds.registered) {
                        // Baileys refresca el QR cada ~20s y en cada refresco se emite un código
                        // nuevo, para que el usuario pueda renovar el que expiró. El PIN necesita
                        // número: sin `phone` la vinculación es siempre QR.
                        // Baileys refreshes the QR every ~20s and a new code is emitted on each
                        // refresh, so the user can renew an expired one. A PIN requires a number:
                        // without `phone` linking is always QR.
                        if (this.#options.phone && (this.#options.method ?? 'otp') === 'otp') {
                            await callback(await socket.requestPairingCode(this.#options.phone));
                        } else {
                            await callback(await QRCode.toBuffer(qr, { type: 'png', margin: 2 }));
                        }
                    }

                    if (connection === 'open') {
                        connected = true;
                        retries = 0;
                        this.emit('connected', this);
                        resolve();
                    } else if (connection === 'close') {
                        internals(this).socket = null;
                        const status_code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
                        // `restartRequired` (515) es una reconexión exigida por el protocolo
                        // tras el sync inicial — no es un disconnect "real".
                        const is_transient = status_code === DisconnectReason.restartRequired;

                        // Limpieza del engine ANTES de emitir `disconnected` para que los
                        // listeners vean el estado final (engine vaciado o creds borradas).
                        if (status_code === DisconnectReason.loggedOut) {
                            if (this.#options.autoclean) {
                                await this.engine.clear();
                            } else {
                                await this.engine.unset('/session/creds');
                            }
                        }

                        if (connected && !is_transient && !silent) {
                            this.emit('disconnected', this);
                        }

                        if (!intentional) {
                            if (status_code === DisconnectReason.loggedOut) {
                                reject(new Error('Logged out'));
                            } else {
                                const max = this.#options.reconnect.max;
                                // Los cierres transitorios son parte del protocolo: no cuentan
                                // contra el límite de reintentos por fallo.
                                // Transient closes are part of the protocol: they do not count
                                // against the failure retry budget.
                                if (!is_transient && max !== null && retries >= max) {
                                    reject(new Error(`Reconnect attempts exhausted (${max})`));
                                } else {
                                    retries += is_transient ? 0 : 1;
                                    timer = setTimeout(() => {
                                        timer = null;
                                        start().catch(reject);
                                    }, is_transient ? 0 : this.#options.reconnect.interval_ms);
                                }
                            }
                        }
                    }
                });

                socket.ev.on('messaging-history.set', ({ chats, contacts, messages }) => run(async () => {
                    await contacts_upsert(contacts);
                    await chats_upsert(chats);
                    await messages_upsert(messages);
                }));
                socket.ev.on('contacts.upsert', (rows) => run(() => contacts_upsert(rows)));
                socket.ev.on('chats.upsert', (rows) => run(() => chats_upsert(rows)));
                socket.ev.on('messages.upsert', ({ messages }) => run(() => messages_upsert(messages)));

                socket.ev.on('lid-mapping.update', ({ lid, pn }) => run(async () => {
                    await save(`/lid/${lid}`, pn);
                    await save(`/lid/${pn}`, lid);
                }));

                socket.ev.on('contacts.update', (rows) => run(async () => {
                    for (const row of rows) {
                        const current = row.id ? await load<Contact['_raw']>(`/contact/${row.id}`) : null;
                        if (current && row.id) {
                            const patch: Partial<Contact['_raw']> = {
                                ...(row.notify && { notify: row.notify }),
                                ...(row.name && { name: row.name }),
                                ...(row.verifiedName && { verified_name: row.verifiedName }),
                                ...(row.imgUrl && typeof row.imgUrl === 'string' && { img_url: row.imgUrl }),
                                ...(row.status && { status: row.status }),
                                ...(row.lid && { lid: row.lid }),
                            };
                            if (Object.keys(patch).length > 0) {
                                const merged = { ...current, ...patch };
                                await save(`/contact/${row.id}`, merged);
                                if (patch.lid) {
                                    await save(`/lid/${patch.lid}`, row.id);
                                }
                                const person = new this.Contact(merged);
                                const cached = await load<Chat['_raw']>(`/chat/${row.id}`);
                                this.emit('contact:updated', person, new this.Chat(cached ?? { id: row.id, name: person.name }), this);
                            }
                        }
                    }
                }));

                socket.ev.on('chats.update', (rows) => run(async () => {
                    for (const row of rows) {
                        if (row.id && row.id !== 'status@broadcast') {
                            const current = (await load<Chat['_raw']>(`/chat/${row.id}`)) ?? { id: row.id, name: row.name ?? null };
                            const patch: Partial<Chat['_raw']> = {};
                            const events: (keyof WhatsAppEventMap)[] = [];
                            if (row.name) {
                                patch.name = row.name;
                            }
                            if (row.unreadCount != null) {
                                patch.unread_count = row.unreadCount;
                            }
                            if ('pinned' in row) {
                                patch.pinned = row.pinned ?? null;
                                events.push(row.pinned != null ? 'chat:pinned' : 'chat:unpinned');
                            }
                            if (row.archived !== undefined) {
                                patch.archived = row.archived ?? false;
                                events.push(row.archived ? 'chat:archived' : 'chat:unarchived');
                            }
                            if ('muteEndTime' in row) {
                                patch.mute_end_time = row.muteEndTime != null ? Number(row.muteEndTime) : null;
                                events.push(patch.mute_end_time != null && patch.mute_end_time > Date.now() ? 'chat:muted' : 'chat:unmuted');
                            }
                            if (Object.keys(patch).length > 0) {
                                const merged: Chat['_raw'] = { ...current, ...patch };
                                // Fijar, archivar o silenciar no es actividad: el chat conserva su posición.
                                // Pinning, archiving or muting is not activity: the chat keeps its position.
                                await save(`/chat/${row.id}`, merged, merged.activity ?? undefined);
                                for (const event of events) {
                                    this.emit(event, new this.Chat(merged), this);
                                }
                            }
                        }
                    }
                }));

                socket.ev.on('chats.delete', (ids) => run(async () => {
                    for (const cid of ids) {
                        const raw = (await load<Chat['_raw']>(`/chat/${cid}`)) ?? { id: cid };
                        await this.engine.unset(`/chat/${cid}`);
                        this.emit('chat:deleted', new this.Chat(raw), this);
                    }
                }));

                socket.ev.on('messages.update', (updates) => run(async () => {
                    for (const { key, update } of updates) {
                        // Los updates sobre `status@broadcast` se descartan: el feed sólo muta
                        // por reacción, `Feed.view()` o revocación.
                        // Updates over `status@broadcast` are dropped: the feed only mutates
                        // through reactions, `Feed.view()` or a revoke.
                        const found = key.remoteJid && key.id && key.remoteJid !== 'status@broadcast'
                            ? await locate(key.remoteJid, key.id)
                            : null;
                        if (found) {
                            const { path, doc } = found;
                            const patch = update as {
                                message?: proto.IMessage & { editedMessage?: { message?: proto.IMessage } };
                                status?: number;
                                starred?: boolean;
                                messageStubParameters?: (string | null)[];
                            };
                            const raw: WAMessage = doc.raw ?? { key };
                            if (patch.message) {
                                // Edición o actualización de contenido (ej. ubicación en vivo).
                                // An edit or a content update (e.g. live location).
                                const edited = patch.message.editedMessage?.message;
                                raw.message = edited ?? { ...raw.message, ...patch.message };
                                doc.edited = doc.edited || Boolean(edited);
                                doc.caption = message(this, raw).caption;
                                doc.raw = raw;
                                await save(path, doc, doc.created_at);
                                await fire('message:updated', doc);
                            } else if (patch.starred !== undefined) {
                                doc.starred = patch.starred === true;
                                raw.starred = doc.starred;
                                doc.raw = raw;
                                await save(path, doc, doc.created_at);
                                await fire(doc.starred ? 'message:starred' : 'message:unstarred', doc);
                            } else if (patch.status !== undefined && (patch.status > doc.status || patch.status === ERROR)) {
                                // WhatsApp reemite los acks desordenados al reconectar (un `sent`
                                // después de un `delivered`): el estado solo avanza. El rechazo es
                                // terminal y viaja con el motivo en el stub del update.
                                // WhatsApp re-emits acks out of order on reconnect (a `sent` after
                                // a `delivered`): the state only moves forward. A rejection is
                                // terminal and carries its reason in the update stub.
                                raw.status = patch.status;
                                doc.status = patch.status;
                                raw.messageStubParameters = patch.messageStubParameters ?? raw.messageStubParameters;
                                doc.raw = raw;
                                await save(path, doc, doc.created_at);
                                await fire('message:updated', doc);
                            }
                        }
                    }
                }));

                socket.ev.on('message-receipt.update', (updates) => run(async () => {
                    for (const { key, receipt } of updates) {
                        if (key.remoteJid === 'status@broadcast' && key.id) {
                            const doc = await load<FeedRaw>(`/status/${key.id}`);
                            if (doc && !doc.viewed) {
                                doc.viewed = true;
                                await save(`/status/${key.id}`, doc);
                                this.emit('feed:updated', new Feed(this, doc), this);
                            }
                            continue;
                        }
                        const seen = receipt.readTimestamp != null || receipt.playedTimestamp != null;
                        const found = seen && key.remoteJid && key.id ? await locate(key.remoteJid, key.id) : null;
                        if (found) {
                            const next = receipt.playedTimestamp != null ? PLAYED : READ;
                            if (found.doc.status < next) {
                                found.doc.status = next;
                                found.doc.raw.status = next as unknown as WAMessage['status'];
                                await save(found.path, found.doc, found.doc.created_at);
                            }
                            await fire('message:seen', found.doc);
                        }
                    }
                }));
            };

            this.#close = async (quiet: boolean) => {
                intentional = true;
                silent = quiet;
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                const live = internals(this).socket;
                if (live) {
                    // Un error Boom-like con statusCode=connectionClosed (428) deja explícito
                    // el motivo del cierre en `lastDisconnect`, en vez de `undefined`.
                    // A Boom-like error with statusCode=connectionClosed (428) makes the close
                    // reason explicit in `lastDisconnect`, instead of `undefined`.
                    await live.end(Object.assign(new Error('intentional close'), {
                        output: { statusCode: DisconnectReason.connectionClosed },
                    })).catch(() => { });
                    internals(this).socket = null;
                }
            };

            start().catch(reject);
        });
    }

    /**
     * Actualiza el perfil de la cuenta en WhatsApp: nombre público, bio y/o foto. Sólo se
     * envía lo que llega en el parche; `photo: null` elimina la foto actual.
     * Updates the account profile on WhatsApp: public name, bio and/or picture. Only the
     * given fields are sent; `photo: null` removes the current picture.
     *
     * @param patch - Campos a actualizar / Fields to update
     * @returns true si todo lo pedido se envió / true when everything requested was sent
     * @throws ERR_PROFILE_PICTURE_LIB si falta `sharp` o `jimp` para procesar la foto / when `sharp` or `jimp` is missing to process the picture
     */
    async profile(patch: { name?: string; content?: string; photo?: string | Buffer | null }): Promise<boolean> {
        const socket = internals(this).socket;
        let ok = false;
        if (socket) {
            const self = jidNormalizedUser(socket.user?.id ?? '');
            if (patch.name !== undefined) {
                await socket.updateProfileName(patch.name);
            }
            if (patch.content !== undefined) {
                await socket.updateProfileStatus(patch.content);
            }
            if (patch.photo === null) {
                await socket.removeProfilePicture(self);
            } else if (patch.photo !== undefined) {
                // baileys redimensiona la foto con `sharp` o `jimp`; ninguna es dependencia
                // nuestra, así que su ausencia se traduce a un error accionable.
                // baileys resizes the picture with `sharp` or `jimp`; neither is a dependency
                // of ours, so their absence is translated into an actionable error.
                await socket
                    .updateProfilePicture(self, typeof patch.photo === 'string' ? { url: patch.photo } : patch.photo)
                    .catch((error: Error) => {
                        if (/image processing library/i.test(error.message)) {
                            throw new Error('ERR_PROFILE_PICTURE_LIB');
                        }
                        throw error;
                    });
            }
            ok = true;
        }
        return ok;
    }

    /**
     * Publica un estado (status broadcast). Con sólo `caption` publica texto; con `content`
     * publica imagen o video (el tipo se deduce del binario) usando `caption` como pie.
     * `contacts` es la audiencia: WhatsApp no reparte el estado a quien no esté en la lista.
     * Publishes a status broadcast. With only `caption` it posts text; with `content` it
     * posts an image or video (type inferred from the binary) using `caption` as its footer.
     * `contacts` is the audience: WhatsApp does not deliver the status to anyone outside it.
     *
     * @param post - Contenido, pie y audiencia / Content, caption and audience
     * @returns Publicación creada, o null si no hay sesión / Created post, or null without a session
     * @throws ERR_FEED_EMPTY sin `content` ni `caption` / when neither `content` nor `caption` is given
     * @throws ERR_FEED_MEDIA si el binario no es imagen ni video / when the binary is neither image nor video
     */
    async feed(post: { content?: Buffer; caption?: string; contacts: (string | number)[] }): Promise<Feed | null> {
        const socket = internals(this).socket;
        let result: Feed | null = null;
        if (socket) {
            const audience = (await Promise.all(post.contacts.map((uid) => resolve_jid(this, String(uid))))).filter(
                (jid): jid is string => jid !== null
            );
            const mime = post.content ? sniff_media(post.content) : null;
            if (post.content && !mime) {
                throw new Error('ERR_FEED_MEDIA');
            }
            if (!post.content && !post.caption) {
                throw new Error('ERR_FEED_EMPTY');
            }
            const kind = mime?.startsWith('video/') ? 'video' : mime ? 'image' : 'text';
            const sent = await socket.sendMessage(
                'status@broadcast',
                (post.content ? { [kind]: post.content, caption: post.caption } : { text: post.caption }) as never,
                { statusJidList: audience }
            );
            if (sent?.key?.id) {
                const created_at = (Number(sent.messageTimestamp) || Math.floor(Date.now() / 1_000)) * 1_000;
                const doc = {
                    id: sent.key.id,
                    author_jid: jidNormalizedUser(socket.user?.id ?? ''),
                    type: kind as 'text' | 'image' | 'video',
                    caption: post.caption ?? '',
                    mime: mime ?? 'text/plain',
                    created_at,
                    expires_at: created_at + FEED_TTL_MS,
                    viewed: true,
                    raw: sent,
                };
                await this.engine.set(`/status/${doc.id}`, serialize(doc), created_at);
                if (post.content) {
                    await write_content(this, `/status/${doc.id}/content`, post.content);
                }
                result = new Feed(this, doc);
                this.emit('feed:created', result, this);
            }
        }
        return result;
    }

    /**
     * Cierra la conexión. Con `destroy: true` vacía el engine completo.
     * Closes the connection. With `destroy: true` clears the engine entirely.
     */
    async disconnect(options: DisconnectOptions = {}): Promise<void> {
        await this.#close?.(options.silent === true);
        if (options.destroy) {
            await this.engine.clear();
        }
    }
}

export default WhatsApp;
