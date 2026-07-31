/**
 * @file whatsapp/index.ts
 * @description Orquestador principal del cliente WhatsApp v3.
 * Main orchestrator of the WhatsApp v3 client.
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
    type Chat as BaileysChat,
    type Contact as BaileysContact,
    type MessageUserReceiptUpdate,
    type SignalDataTypeMap,
    type WAMessage,
    type WAMessageUpdate,
    type WASocket,
} from 'baileys';
import { EventEmitter } from 'node:events';
import pino from 'pino';
import * as QRCode from 'qrcode';
import { chat, Chat } from '~/lib/chat';
import { contact, Contact } from '~/lib/contact';
import { bind, type Internals } from '~/lib/internal';
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

/** Rechazo del servidor: estado terminal, el único que puede retroceder el avance. / Server rejection: terminal state, the only one allowed to move the state backwards. */
const ERROR = 0;
/** Estados legibles del mensaje que el receipt puede avanzar. / Readable message states a receipt can advance to. */
const READ = 4;
const PLAYED = 5;

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
 * Opciones del cliente WhatsApp.
 * WhatsApp client options.
 */
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
interface WhatsAppEventMap {
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
    /** @internal Estado compartido con las entidades (socket, resolución de JIDs). / State shared with the entities. */
    #internals: Internals;
    #phone?: string;
    #method?: 'qr' | 'otp';
    #autoclean: boolean;
    #reconnect: { max: number | null; interval_ms: number };
    #sync: boolean;
    #intentional_close = false;
    #silent_close = false;
    #has_connected = false;
    #retry_timer: ReturnType<typeof setTimeout> | null = null;
    #retry_count = 0;
    /**
     * @internal
     * Cadena que serializa los handlers de eventos de baileys: dos eventos sobre el mismo
     * documento ya no se intercalan (lost updates por read-modify-write concurrente).
     * Chain serializing baileys event handlers: two events over the same document no longer
     * interleave (lost updates from concurrent read-modify-write).
     */
    #chain: Promise<void> = Promise.resolve();

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
        this.#phone = options.phone !== undefined ? String(options.phone).replace(/\D+/g, '') : undefined;
        this.#method = options.method;
        this.#autoclean = options.autoclean ?? true;
        this.#sync = options.sync ?? true;
        this.#reconnect =
            options.reconnect === false ? { max: 0, interval_ms: 60_000 }
                : options.reconnect === undefined || options.reconnect === true ? { max: null, interval_ms: 60_000 }
                    : typeof options.reconnect === 'number' ? { max: options.reconnect, interval_ms: 60_000 }
                        : { max: options.reconnect.max ?? null, interval_ms: (options.reconnect.interval ?? 60) * 1_000 };
        this.#internals = { socket: null, resolve_jid: (uid) => this.#resolve_jid(uid) };
        bind(this, this.#internals);
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
        const user = this.#internals.socket?.user;
        if (user) {
            const jid = jidNormalizedUser(user.id);
            return new this.Contact({ id: jid, phone_number: jid, lid: user.lid ?? null, name: user.name ?? null });
        }
        return null;
    }

    /**
     * @internal
     * Persiste un binario: crudo cuando el driver lo soporta, JSON con base64 si no.
     * Persists a binary: raw when the driver supports it, base64 JSON otherwise.
     */
    async #write_content(path: string, data: Buffer): Promise<void> {
        if (this.engine.set_buffer) {
            await this.engine.set_buffer(path, data);
        } else {
            await this.engine.set(path, serialize({ data: data.toString('base64') }));
        }
    }

    /** @internal Encola una tarea en la cadena serial de handlers. / Queues a task on the serial handler chain. */
    #enqueue(task: () => Promise<void>): void {
        this.#chain = this.#chain.then(task).catch(() => { });
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
    on<E extends keyof WhatsAppEventMap>(
        event: E,
        handler: (...args: WhatsAppEventMap[E]) => void
    ): () => void {
        this.#event.on(event, handler as never);
        return () => { this.#event.off(event, handler as never); };
    }

    /**
     * Quita un listener previamente registrado.
     * Removes a previously registered listener.
     */
    off<E extends keyof WhatsAppEventMap>(
        event: E,
        handler: (...args: WhatsAppEventMap[E]) => void
    ): this {
        this.#event.off(event, handler as never);
        return this;
    }

    /**
     * Registra un listener one-shot. Retorna función para desuscribirse antes de que dispare.
     * Registers a one-shot listener. Returns an unsubscribe function.
     */
    once<E extends keyof WhatsAppEventMap>(
        event: E,
        handler: (...args: WhatsAppEventMap[E]) => void
    ): () => void {
        this.#event.once(event, handler as never);
        return () => { this.#event.off(event, handler as never); };
    }

    /**
     * @internal
     * Normaliza cualquier identificador (JID, LID, número, etc.) a JID canónico. Las
     * entidades lo alcanzan por el canal interno, no por la instancia.
     * Normalizes any identifier (JID, LID, number…) into a canonical JID. Entities reach it
     * through the internal channel, not through the instance.
     */
    async #resolve_jid(uid: string): Promise<string | null> {
        let result: string | null = null;
        if (uid.endsWith('@g.us') || uid.endsWith('@s.whatsapp.net')) {
            result = uid;
        } else if (uid.endsWith('@lid')) {
            // Los receipts direccionan por dispositivo (`…:9@lid`); el índice se guarda sin él.
            // Receipts address per device (`…:9@lid`); the index is stored without it.
            const lid = jidNormalizedUser(uid);
            const direct = deserialize<string>(await this.engine.get(`/lid/${lid}`));
            if (direct) {
                result = direct.includes('@') ? direct : `${direct}@s.whatsapp.net`;
            } else {
                const reverse = deserialize<string | number>(
                    await this.engine.get(`/lid/${lid.split('@')[0]}_reverse`)
                );
                if (reverse != null) {
                    result = `${reverse}@s.whatsapp.net`;
                } else {
                    // El store local puede no tener el mapping (sesión sin upsert del contacto);
                    // baileys lo conoce vía su lidMapping. Sin esto, un chat referenciado por @lid
                    // (p.ej. el pollCreationMessageKey de un voto entrante) no resuelve al PN donde
                    // realmente está guardado, y el mensaje/poll no se encuentra.
                    const pn = await (this.#internals.socket as unknown as {
                        signalRepository?: { lidMapping?: { getPNForLID(lid: string): Promise<string | null | undefined> } };
                    } | null)?.signalRepository?.lidMapping?.getPNForLID(lid).catch(() => null);
                    if (pn) {
                        // getPNForLID puede traer sufijo de dispositivo (`:0`); se normaliza para
                        // que el JID coincida con el que usa el store (sin device).
                        result = jidNormalizedUser(pn.includes('@') ? pn : `${pn}@s.whatsapp.net`);
                    }
                }
            }
        } else {
            const cleaned = uid.replace(/\D/g, '');
            if (cleaned) {
                result = `${cleaned}@s.whatsapp.net`;
            }
        }
        return result;
    }

    /**
     * Inicia la conexión. El callback recibe el PIN (string) si se configuró `phone`, o el QR (Buffer PNG) si no.
     * Resuelve cuando la sesión sincroniza; reintenta automáticamente en cierres no-loggedOut.
     *
     * Starts the connection. Callback receives the PIN (string) when `phone` is configured, or the QR (PNG Buffer) otherwise.
     * Resolves once the session is synced; retries on non-loggedOut disconnects.
     */
    async connect(callback: (auth: string | Buffer) => void | Promise<void>): Promise<void> {
        if (this.#internals.socket) {
            await this.disconnect({ silent: true });
        }
        const { version } = await fetchLatestBaileysVersion();

        this.#intentional_close = false;
        this.#silent_close = false;
        this.#has_connected = false;

        return new Promise<void>((resolve, reject) => {
            const start = async (): Promise<void> => {
                // Re-lee creds en cada start() para que limpiezas del engine tomen efecto
                // en reintentos (permite al consumer forzar nueva sesión borrando /session/creds).
                const stored = await this.engine.get('/session/creds');
                const creds: AuthenticationCreds = deserialize<AuthenticationCreds>(stored) ?? initAuthCreds();

                this.#internals.socket = makeWASocket({
                    version,
                    auth: {
                        creds,
                        keys: {
                            get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
                                const data: { [id: string]: SignalDataTypeMap[T] } = {};
                                await Promise.all(ids.map(async (id) => {
                                    const value = deserialize<SignalDataTypeMap[T]>(
                                        await this.engine.get(`/session/${type}/${id}`)
                                    );
                                    if (value) {
                                        data[id] =
                                            type === 'app-state-sync-key'
                                                ? (proto.Message.AppStateSyncKeyData.create(
                                                    value as never
                                                ) as unknown as SignalDataTypeMap[T])
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
                    syncFullHistory: this.#sync,
                    // Los syncs no-FULL cargan las LID mappings y los tctokens (trusted-contact
                    // tokens) que rc13 exige para enviar: apagarlos todos con `() => this.#sync`
                    // deja la sesión sin tctoken y el server rechaza los mensajes con
                    // "error 463: account restricted or missing tctoken". Por eso se procesan
                    // siempre los no-FULL; `sync` solo decide si además se trae el historial FULL.
                    // Non-FULL syncs carry the LID mappings and tctokens rc13 requires to send;
                    // disabling them all made the server reject messages with error 463. We always
                    // process non-FULL; `sync` only gates whether FULL history is pulled too.
                    shouldSyncHistoryMessage: ({ syncType }) =>
                        this.#sync || syncType !== proto.HistorySync.HistorySyncType.FULL,
                    markOnlineOnConnect: false,
                });

                const socket = this.#internals.socket;
                socket.ev.on('creds.update', () => this.engine.set('/session/creds', serialize(creds)));

                socket.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;

                    if (qr && !creds.registered) {
                        // Baileys refresca QR periódicamente (~20s). Emitimos nuevo pair
                        // code / QR en cada refresh para que el usuario pueda renovar si
                        // el anterior expiró.
                        // El PIN necesita número: sin `phone` la vinculación es siempre QR, y
                        // con `phone` manda `method` (OTP por defecto).
                        // A PIN requires a number: without `phone` linking is always QR, and with
                        // `phone` the `method` option decides (OTP by default).
                        if (this.#phone && (this.#method ?? 'otp') === 'otp') {
                            await callback(await socket.requestPairingCode(this.#phone));
                        } else {
                            await callback(await QRCode.toBuffer(qr, { type: 'png', margin: 2 }));
                        }
                    }

                    if (connection === 'open') {
                        this.#has_connected = true;
                        this.#retry_count = 0;
                        this.emit('connected', this);
                        resolve();
                    } else if (connection === 'close') {
                        this.#internals.socket = null;
                        const status_code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
                        // `restartRequired` (515) es una reconexión exigida por el protocolo
                        // tras el sync inicial — no es un disconnect "real".
                        const is_transient = status_code === DisconnectReason.restartRequired;

                        // Limpieza del engine ANTES de emitir `disconnected` para que los
                        // listeners vean el estado final (engine vaciado o creds borradas).
                        if (status_code === DisconnectReason.loggedOut) {
                            if (this.#autoclean) {
                                await this.engine.clear();
                            } else {
                                await this.engine.unset('/session/creds');
                            }
                        }

                        // `disconnect({ silent: true })` calla el evento de este cierre concreto.
                        // `disconnect({ silent: true })` mutes this specific close's event.
                        if (this.#has_connected && !is_transient && !this.#silent_close) {
                            this.emit('disconnected', this);
                        }

                        if (!this.#intentional_close) {
                            if (status_code === DisconnectReason.loggedOut) {
                                reject(new Error('Logged out'));
                            } else {
                                const max = this.#reconnect.max;
                                // Transient closes (restartRequired) son parte del protocolo,
                                // no cuentan contra el límite de reintentos por fallo.
                                const exhausted = !is_transient && max !== null && this.#retry_count >= max;
                                if (exhausted) {
                                    reject(new Error(`Reconnect attempts exhausted (${max})`));
                                } else {
                                    if (!is_transient) {
                                        this.#retry_count++;
                                    }
                                    const delay = is_transient ? 0 : this.#reconnect.interval_ms;
                                    this.#retry_timer = setTimeout(() => {
                                        this.#retry_timer = null;
                                        start().catch(reject);
                                    }, delay);
                                }
                            }
                        }
                    }
                });

                this.#attach_business_handlers(socket);
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
        const socket = this.#internals.socket;
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
        const socket = this.#internals.socket;
        let result: Feed | null = null;
        if (socket) {
            const audience = (await Promise.all(post.contacts.map((uid) => this.#resolve_jid(String(uid))))).filter(
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
                (post.content
                    ? { [kind]: post.content, caption: post.caption }
                    : { text: post.caption }) as never,
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
                    await this.#write_content(`/status/${doc.id}/content`, post.content);
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
        this.#intentional_close = true;
        this.#silent_close = options.silent === true;

        // Cancela cualquier retry programado por un close anterior, para no resucitar
        // el socket después de una desconexión manual.
        if (this.#retry_timer) {
            clearTimeout(this.#retry_timer);
            this.#retry_timer = null;
        }

        if (this.#internals.socket) {
            try {
                // Pasa un error Boom-like con statusCode=connectionClosed (428) para que
                // `lastDisconnect.error.output.statusCode` quede explícito en el close
                // en lugar de `undefined`.
                const intentional = Object.assign(new Error('intentional close'), {
                    output: { statusCode: DisconnectReason.connectionClosed },
                });
                await this.#internals.socket.end(intentional);
            } catch {
                /* socket may already be closed */
            }
            this.#internals.socket = null;
        }

        if (options.destroy) {
            await this.engine.clear();
        }
    }

    /**
     * Conecta los handlers de eventos de baileys: contactos, chats y mensajes.
     * Wires baileys event handlers: contacts, chats and messages.
     *
     * @internal
     */
    #attach_business_handlers(socket: WASocket): void {
        socket.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
            this.#enqueue(async () => {
                await this.#handle_contacts_upsert(contacts);
                await this.#handle_chats_upsert(chats);
                await this.#handle_messages_upsert(messages);
            });
        });
        socket.ev.on('contacts.upsert', (contacts) => {
            this.#enqueue(() => this.#handle_contacts_upsert(contacts));
        });
        socket.ev.on('contacts.update', (contacts) => {
            this.#enqueue(() => this.#handle_contacts_update(contacts));
        });
        socket.ev.on('lid-mapping.update', ({ lid, pn }) => {
            this.#enqueue(() => this.#handle_lid_mapping(lid, pn));
        });
        socket.ev.on('chats.upsert', (chats) => {
            this.#enqueue(() => this.#handle_chats_upsert(chats));
        });
        socket.ev.on('chats.update', (chats) => {
            this.#enqueue(() => this.#handle_chats_update(chats));
        });
        socket.ev.on('chats.delete', (ids) => {
            this.#enqueue(() => this.#handle_chats_delete(ids));
        });
        socket.ev.on('messages.upsert', ({ messages }) => {
            this.#enqueue(() => this.#handle_messages_upsert(messages));
        });
        socket.ev.on('messages.update', (updates) => {
            this.#enqueue(() => this.#handle_messages_update(updates));
        });
        socket.ev.on('message-receipt.update', (updates) => {
            this.#enqueue(() => this.#handle_message_receipt(updates));
        });
        // Las reacciones llegan duplicadas por `messages.reaction` Y `messages.upsert`
        // (como `reactionMessage`). Se usa solo `messages.upsert` para evitar el doble disparo.
        // socket.ev.on('messages.reaction', (reactions) => {
        //     void this.#handle_messages_reaction(reactions);
        // });
    }

    /**
     * Persiste un contacto y su índice LID; emite `contact:created` solo si es nuevo.
     * Persists a contact and its LID index; emits `contact:created` only when new.
     *
     * @param raw - Documento del contacto a persistir / Contact document to persist
     * @internal
     */
    async #persist_contact(raw: Contact['_raw']): Promise<void> {
        const current = deserialize<Contact['_raw']>(await this.engine.get(`/contact/${raw.id}`));
        // Los upserts del re-sync llegan con los campos vacíos: sin fusionar borran el nombre
        // que ya se conocía y el chat pasa a mostrar el número pelado.
        // Re-sync upserts arrive with empty fields: without merging they wipe the name already
        // known and the chat falls back to showing the bare number.
        const doc: Contact['_raw'] = current
            ? {
                id: raw.id,
                lid: raw.lid ?? current.lid,
                name: raw.name ?? current.name,
                notify: raw.notify ?? current.notify,
                verified_name: raw.verified_name ?? current.verified_name,
                img_url: raw.img_url ?? current.img_url,
                status: raw.status ?? current.status,
            }
            : raw;
        await this.engine.set(`/contact/${raw.id}`, serialize(doc));
        if (doc.lid) {
            await this.engine.set(`/lid/${doc.lid}`, serialize(doc.id));
        }
        // Una ficha que existía vacía y ahora tiene nombre es un cambio que el consumidor
        // necesita: sin avisar, quien memorice el contacto sigue mostrando el número.
        // A card that existed empty and now has a name is a change the consumer needs: without
        // notifying, whoever memoized the contact keeps showing the bare number.
        const changed = current && (['lid', 'name', 'notify', 'verified_name', 'img_url', 'status'] as const).some((key) => current[key] !== doc[key]);
        if (!current || changed) {
            const person = new this.Contact(doc);
            const cached_chat = deserialize<Chat['_raw']>(await this.engine.get(`/chat/${doc.id}`));
            const chat = new this.Chat(cached_chat ?? { id: doc.id, name: person.name });
            this.emit(current ? 'contact:updated' : 'contact:created', person, chat, this);
        }
    }

    /** @internal */
    async #handle_contacts_upsert(contacts: BaileysContact[]): Promise<void> {
        for (const c of contacts) {
            if (c.id) {
                await this.#persist_contact({
                    id: c.id,
                    lid: c.lid ?? null,
                    name: c.name ?? null,
                    notify: c.notify ?? null,
                    verified_name: c.verifiedName ?? null,
                    img_url: c.imgUrl ?? null,
                    status: c.status ?? null,
                });
            }
        }
    }

    /** @internal */
    async #handle_contacts_update(contacts: Partial<BaileysContact>[]): Promise<void> {
        for (const c of contacts) {
            if (c.id) {
                const current = deserialize<Contact['_raw']>(await this.engine.get(`/contact/${c.id}`));
                if (current) {
                    const patch: Partial<Contact['_raw']> = {
                        ...(c.notify && { notify: c.notify }),
                        ...(c.name && { name: c.name }),
                        ...(c.verifiedName && { verified_name: c.verifiedName }),
                        ...(c.imgUrl && { img_url: c.imgUrl }),
                        ...(c.status && { status: c.status }),
                        ...(c.lid && { lid: c.lid }),
                    };
                    if (Object.keys(patch).length > 0) {
                        const merged = { ...current, ...patch };
                        await this.engine.set(`/contact/${c.id}`, serialize(merged));
                        if (patch.lid) {
                            await this.engine.set(`/lid/${patch.lid}`, serialize(c.id));
                        }
                        const person = new this.Contact(merged);
                        const cached_chat = deserialize<Chat['_raw']>(await this.engine.get(`/chat/${c.id}`));
                        this.emit('contact:updated', person, new this.Chat(cached_chat ?? { id: c.id, name: person.name }), this);
                    }
                }
            }
        }
    }

    /** @internal */
    async #handle_lid_mapping(lid: string, pn: string): Promise<void> {
        await this.engine.set(`/lid/${lid}`, serialize(pn));
        await this.engine.set(`/lid/${pn}`, serialize(lid));
    }

    /**
     * Actividad del chat según su último mensaje persistido. Es el respaldo para los
     * documentos que se guardaron antes de que el chat llevara su propia marca.
     * Chat activity from its last persisted message. It is the fallback for documents stored
     * before the chat carried its own stamp.
     *
     * @param cid - Identificador del chat / Chat identifier
     * @returns Epoch ms del último mensaje, o 0 si el chat no tiene ninguno / Last message epoch ms, or 0 when the chat has none
     * @internal
     */
    async #activity(cid: string): Promise<number> {
        const [raw] = await this.engine.list(`/chat/${cid}/message`, 0, 1);
        return deserialize<Message['_raw']>(raw ?? null)?.created_at ?? 0;
    }

    /** @internal */
    async #handle_chats_upsert(chats: BaileysChat[]): Promise<void> {
        for (const ch of chats) {
            if (ch.id) {
                const current = deserialize<Chat['_raw']>(await this.engine.get(`/chat/${ch.id}`));
                const raw: Chat['_raw'] = current ?? {
                    id: ch.id,
                    name: ch.name ?? null,
                    archived: ch.archived ?? null,
                    pinned: ch.pinned ?? null,
                    mute_end_time: ch.muteEndTime != null ? Number(ch.muteEndTime) : null,
                    unread_count: ch.unreadCount ?? null,
                };
                if (ch.name) {
                    raw.name = ch.name;
                }
                // El sync trae la última actividad del chat; sin ella la lista quedaría ordenada
                // por el momento en que se escribió cada documento.
                // The sync carries the chat's last activity; without it the list would be ordered
                // by the moment each document happened to be written.
                const stamp = ch.conversationTimestamp != null ? Number(ch.conversationTimestamp) * 1_000 : null;
                raw.activity = Math.max(stamp ?? 0, raw.activity ?? 0, await this.#activity(ch.id)) || null;
                await this.engine.set(`/chat/${ch.id}`, serialize(raw), raw.activity ?? 0);
                if (current === null) {
                    this.emit('chat:created', new this.Chat(raw), this);
                }
            }
        }
    }

    /** @internal */
    async #handle_chats_update(chats: Partial<BaileysChat>[]): Promise<void> {
        for (const ch of chats) {
            if (ch.id && ch.id !== 'status@broadcast') {
                const current = deserialize<Chat['_raw']>(await this.engine.get(`/chat/${ch.id}`)) ?? {
                    id: ch.id,
                    name: ch.name ?? null,
                };
                const patch: Partial<Chat['_raw']> = {};
                const pinned_changed = 'pinned' in ch;
                const archived_changed = ch.archived !== undefined;
                const mute_changed = 'muteEndTime' in ch;

                if (ch.name) {
                    patch.name = ch.name;
                }
                if (pinned_changed) {
                    patch.pinned = ch.pinned ?? null;
                }
                if (archived_changed) {
                    patch.archived = ch.archived ?? false;
                }
                if (mute_changed) {
                    patch.mute_end_time = ch.muteEndTime != null ? Number(ch.muteEndTime) : null;
                }
                if (ch.unreadCount != null) {
                    patch.unread_count = ch.unreadCount;
                }
                if (Object.keys(patch).length > 0) {
                    const merged: Chat['_raw'] = { ...current, ...patch };
                    // Fijar, archivar o silenciar no es actividad: el chat conserva su posición.
                    // Pinning, archiving or muting is not activity: the chat keeps its position.
                    await this.engine.set(`/chat/${ch.id}`, serialize(merged), merged.activity ?? undefined);

                    if (pinned_changed) {
                        this.emit(
                            ch.pinned != null ? 'chat:pinned' : 'chat:unpinned',
                            new this.Chat(merged),
                            this
                        );
                    }
                    if (archived_changed) {
                        this.emit(
                            ch.archived ? 'chat:archived' : 'chat:unarchived',
                            new this.Chat(merged),
                            this
                        );
                    }
                    if (mute_changed) {
                        const is_muted = patch.mute_end_time != null && patch.mute_end_time > Date.now();
                        this.emit(
                            is_muted ? 'chat:muted' : 'chat:unmuted',
                            new this.Chat(merged),
                            this
                        );
                    }
                }
            }
        }
    }

    /** @internal */
    async #handle_chats_delete(ids: string[]): Promise<void> {
        for (const cid of ids) {
            const raw = deserialize<Chat['_raw']>(await this.engine.get(`/chat/${cid}`)) ?? { id: cid };
            await this.engine.unset(`/chat/${cid}`);
            this.emit('chat:deleted', new this.Chat(raw), this);
        }
    }

    /** @internal */
    async #handle_message_receipt(updates: MessageUserReceiptUpdate[]): Promise<void> {
        for (const { key, receipt } of updates) {
            // Receipt sobre status@broadcast → marca el feed como visto y emite feed:updated.
            // Receipt on status@broadcast → marks feed viewed and emits feed:updated.
            if (key.remoteJid === 'status@broadcast' && key.id) {
                const feed_raw = deserialize<FeedRaw>(
                    await this.engine.get(`/status/${key.id}`),
                );
                if (feed_raw && !feed_raw.viewed) {
                    feed_raw.viewed = true;
                    await this.engine.set(`/status/${key.id}`, serialize(feed_raw));
                    this.emit('feed:updated', new Feed(this, feed_raw), this);
                }
                continue;
            }
            if (key.remoteJid && key.id && (receipt.readTimestamp != null || receipt.playedTimestamp != null)) {
                const found = await this.#locate(key.remoteJid, key.id);
                if (found) {
                    const { path, doc } = found;
                    const next = receipt.playedTimestamp != null ? PLAYED : READ;
                    if (doc.status < next) {
                        doc.status = next;
                        doc.raw.status = next as unknown as WAMessage['status'];
                        await this.engine.set(path, serialize(doc), doc.created_at);
                    }
                    const msg_instance = message(this, doc);
                    this.emit('message:seen', msg_instance, await msg_instance.chat(), this);
                }
            }
        }
    }

    /** @internal */
    async #handle_messages_upsert(messages: WAMessage[]): Promise<void> {
        for (const msg of messages) {
            if (msg.key?.remoteJid && msg.key.id) {
                const cid = (msg.key as { remoteJidAlt?: string }).remoteJidAlt ?? msg.key.remoteJid;
                const mid = msg.key.id;
                const content_type = getContentType(msg.message ?? {});

                if (content_type === 'reactionMessage') {
                    // Canal único para reacciones: se procesa aquí y se ignora `messages.reaction`.
                    // Single channel for reactions: handled here; `messages.reaction` is disabled.
                    const reaction = msg.message?.reactionMessage;
                    if (reaction?.key?.id && reaction.key.remoteJid) {
                        const target_cid = (await this.#resolve_jid(reaction.key.remoteJid)) ?? reaction.key.remoteJid;
                        await this.#handle_messages_reaction([{
                            key: {
                                remoteJid: target_cid,
                                id: reaction.key.id,
                                participant: msg.key.fromMe ? (this.#internals.socket?.user?.id ?? null) : (msg.key.participant ?? cid),
                            },
                            reaction: { text: reaction.text ?? '' },
                        }]);
                    }
                    continue;
                }

                // Status broadcast — flujo dedicado. Nunca emite `message:*`.
                // Status broadcast — dedicated flow. Never emits `message:*`.
                if (msg.key.remoteJid === 'status@broadcast') {
                    if (content_type === 'protocolMessage') {
                        const protocol = msg.message?.protocolMessage;
                        if (
                            protocol?.type === proto.Message.ProtocolMessage.Type.REVOKE &&
                            protocol.key?.id
                        ) {
                            const feed_raw = deserialize<FeedRaw>(
                                await this.engine.get(`/status/${protocol.key.id}`),
                            );
                            if (feed_raw) {
                                await this.engine.unset(`/status/${protocol.key.id}`);
                                this.emit('feed:deleted', new Feed(this, feed_raw), this);
                            }
                        }
                        continue;
                    }
                    const FEED_TYPE_MAP: Record<string, FeedRaw['type']> = {
                        conversation: 'text',
                        extendedTextMessage: 'text',
                        imageMessage: 'image',
                        videoMessage: 'video',
                        audioMessage: 'audio',
                    };
                    const feed_type = FEED_TYPE_MAP[content_type ?? ''];
                    const author = msg.key.participant ?? '';
                    if (!feed_type || !author) {
                        continue;
                    }
                    const msg_content = msg.message?.[content_type as keyof typeof msg.message] as
                        | Record<string, unknown>
                        | string
                        | undefined;
                    let caption = '';
                    let mime = 'text/plain';
                    if (typeof msg_content === 'string') {
                        caption = msg_content;
                    } else if (msg_content && typeof msg_content === 'object') {
                        caption =
                            (msg_content.caption as string) ??
                            (msg_content.text as string) ??
                            '';
                        if (feed_type !== 'text') {
                            mime = (msg_content.mimetype as string) ?? 'application/octet-stream';
                        }
                    }
                    const created_at =
                        (Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000;
                    const feed_raw: FeedRaw = {
                        id: mid,
                        author_jid: author,
                        type: feed_type,
                        caption,
                        mime,
                        created_at,
                        expires_at: created_at + FEED_TTL_MS,
                        viewed: false,
                        raw: msg,
                    };
                    let content_buf: Buffer = Buffer.alloc(0);
                    if (feed_type === 'text') {
                        content_buf = Buffer.from(caption, 'utf-8');
                    } else if (this.#internals.socket) {
                        try {
                            const buf = await downloadMediaMessage(msg, 'buffer', {});
                            if (Buffer.isBuffer(buf)) {
                                content_buf = buf as unknown as Buffer;
                            }
                        } catch {
                            /* media download may fail */
                        }
                    }
                    await this.engine.set(`/status/${mid}`, serialize(feed_raw));
                    if (content_buf.length > 0) {
                        await this.#write_content(`/status/${mid}/content`, content_buf);
                    }
                    this.emit('feed:created', new Feed(this, feed_raw), this);
                    continue;
                }

                if (content_type === 'pollUpdateMessage') {
                    const update = msg.message?.pollUpdateMessage;
                    const creation_key = update?.pollCreationMessageKey;
                    if (
                        creation_key?.id &&
                        creation_key.remoteJid &&
                        update?.vote?.encPayload &&
                        update.vote.encIv
                    ) {
                        const resolved_cid =
                            (await this.#resolve_jid(creation_key.remoteJid)) ?? creation_key.remoteJid;
                        const target_mid = creation_key.id;
                        const poll_doc = deserialize<Message['_raw']>(
                            await this.engine.get(`/chat/${resolved_cid}/message/${target_mid}`)
                        );
                        const secret_raw = poll_doc?.raw.message?.messageContextInfo?.messageSecret;
                        const message_secret =
                            typeof secret_raw === 'string' ? Buffer.from(secret_raw, 'base64') : secret_raw;
                        if (poll_doc && message_secret) {
                            try {
                                const poll_key = poll_doc.raw.key ?? {};
                                // La identidad propia del HMAC depende del addressing del chat
                                // (LID en @lid, PN en @s.whatsapp.net), así que para las posiciones
                                // fromMe se intenta descifrar con ambas: AES-GCM autentica, la
                                // clave equivocada lanza y se prueba la siguiente.
                                // Own HMAC identity depends on chat addressing (LID on @lid, PN on
                                // @s.whatsapp.net), so fromMe positions try both candidates:
                                // AES-GCM authenticates, a wrong key throws and the next is tried.
                                const self_id = this.#internals.socket?.user?.id ?? '';
                                const self_lid = (this.#internals.socket?.user as { lid?: string })?.lid ?? '';
                                const selves = [...new Set([self_lid, self_id].filter(Boolean))];
                                // Candidatos foráneos: todas las formas de identidad del key (LID,
                                // participant, alt, remoteJid); se prueban todas porque el addressing
                                // del stanza varía (LID vs PN) según la migración del contacto.
                                const foreign_of = (k: { remoteJid?: string | null; participant?: string | null; remoteJidAlt?: string }): string[] =>
                                    [...new Set([k.remoteJid, k.participant, k.remoteJidAlt, k.remoteJid].filter((x): x is string => Boolean(x)))];
                                const voters = msg.key.fromMe ? selves : foreign_of(msg.key);
                                const creators = poll_key.fromMe ? selves : foreign_of(poll_key);
                                let decrypted: ReturnType<typeof decryptPollVote> | null = null;
                                for (const voter of voters) {
                                    for (const creator of creators) {
                                        try {
                                            decrypted = decryptPollVote(
                                                { encPayload: update.vote.encPayload, encIv: update.vote.encIv },
                                                {
                                                    pollCreatorJid: jidNormalizedUser(creator),
                                                    pollMsgId: target_mid,
                                                    pollEncKey: message_secret,
                                                    voterJid: jidNormalizedUser(voter),
                                                }
                                            );
                                            break;
                                        } catch {
                                            /* identidad equivocada: probar la siguiente */
                                        }
                                    }
                                    if (decrypted) {
                                        break;
                                    }
                                }
                                if (decrypted) {
                                    updateMessageWithPollUpdate(poll_doc.raw, {
                                        pollUpdateMessageKey: msg.key,
                                        vote: decrypted,
                                        senderTimestampMs: Number(msg.messageTimestamp) || Date.now(),
                                    });
                                    await this.engine.set(
                                        `/chat/${resolved_cid}/message/${target_mid}`,
                                        serialize(poll_doc),
                                        poll_doc.created_at
                                    );
                                    const msg_instance = message(this, poll_doc);
                                    this.emit('message:updated', msg_instance, await msg_instance.chat(), this);
                                }
                            } catch {
                                /* decrypt may fail */
                            }
                        }
                    }
                    continue;
                }

                if (content_type === 'protocolMessage') {
                    const protocol = msg.message?.protocolMessage;
                    if (protocol?.key?.id) {
                        const target_mid = protocol.key.id;
                        const target_cid = protocol.key.remoteJid ?? cid;
                        const doc = deserialize<Message['_raw']>(
                            await this.engine.get(`/chat/${target_cid}/message/${target_mid}`)
                        );

                        if (
                            protocol.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT &&
                            protocol.editedMessage &&
                            doc
                        ) {
                            doc.raw.message = protocol.editedMessage;
                            doc.edited = true;
                            doc.caption = message(this, doc.raw).caption;
                            await this.engine.set(`/chat/${target_cid}/message/${target_mid}`, serialize(doc), doc.created_at);
                            const msg_instance = message(this, doc);
                            this.emit('message:updated', msg_instance, await msg_instance.chat(), this);
                        } else if (protocol.type === proto.Message.ProtocolMessage.Type.REVOKE) {
                            await this.engine.unset(`/chat/${target_cid}/message/${target_mid}`);
                            if (doc) {
                                const msg_instance = message(this, doc);
                                this.emit('message:deleted', msg_instance, await msg_instance.chat(), this);
                            }
                        }
                    }
                    continue;
                }

                const doc = message(this, msg)._raw;

                // Cada reconexión re-entrega el historial completo: reescribir documentos
                // idénticos contamina la cronología, re-descarga la media y spamea eventos,
                // así que un doc ya persistido sin cambios visibles se salta entero.
                // Every reconnect re-delivers the full history: rewriting identical documents
                // pollutes chronology, re-downloads media and spams events, so an already
                // persisted doc without visible changes is skipped entirely.
                const existing_doc = deserialize<Message['_raw']>(
                    await this.engine.get(`/chat/${cid}/message/${mid}`),
                );
                if (existing_doc) {
                    if (typeof existing_doc.multiple === 'boolean') {
                        doc.multiple = existing_doc.multiple;
                    }
                    if (existing_doc.reactions) {
                        doc.reactions = existing_doc.reactions;
                    }
                    // El historial reporta el estado que tenía al sincronizarse: si acá se reescribe
                    // por otro cambio (edición, destacado), el estado ya conocido se conserva.
                    // History reports the state it had when synced: if the doc gets rewritten here
                    // for another change (edit, star), the state already known is kept.
                    if (existing_doc.status > doc.status) {
                        doc.status = existing_doc.status;
                    }
                    if (
                        existing_doc.status >= doc.status &&
                        existing_doc.caption === doc.caption &&
                        existing_doc.edited === doc.edited &&
                        existing_doc.starred === doc.starred
                    ) {
                        continue;
                    }
                }

                // Autocreación de contacto/chat desde pushName cuando baileys no emite upsert previo
                if (!existing_doc && !doc.me) {
                    const push_name = msg.pushName ?? null;
                    const is_group = cid.endsWith('@g.us');

                    // El contacto se completa cuando no existe y también cuando existe sin ningún
                    // nombre: el mensaje trae el pushName y el nombre del negocio verificado, que
                    // es lo único que queda si un re-sync anterior dejó la ficha en blanco.
                    // The contact is filled in when missing and also when it exists with no name at
                    // all: the message carries the pushName and the verified business name, the only
                    // thing left when an earlier re-sync blanked the card.
                    if (doc.author) {
                        const known = deserialize<Contact['_raw']>(await this.engine.get(`/contact/${doc.author}`));
                        if (!known || !(known.name ?? known.notify ?? known.verified_name)) {
                            await this.#persist_contact({
                                id: doc.author,
                                lid: msg.key.remoteJid?.endsWith('@lid') ? msg.key.remoteJid : null,
                                name: null,
                                notify: push_name,
                                verified_name: msg.verifiedBizName ?? null,
                                img_url: null,
                                status: null,
                            });
                        }
                    }

                    if (!(await this.engine.get(`/chat/${cid}`))) {
                        const chat_raw: Chat['_raw'] = {
                            id: cid,
                            name: is_group ? null : push_name,
                            activity: doc.created_at,
                        };
                        await this.engine.set(`/chat/${cid}`, serialize(chat_raw), doc.created_at);
                        this.emit('chat:created', new this.Chat(chat_raw), this);
                    }
                }

                await this.engine.set(`/chat/${cid}/message/${mid}`, serialize(doc), doc.created_at);

                // El mensaje más nuevo define la posición del chat en la lista; un mensaje viejo
                // que llega en un re-sync no la altera.
                // The newest message defines the chat's position in the list; an old message
                // arriving in a re-sync does not move it.
                const chat_doc = deserialize<Chat['_raw']>(await this.engine.get(`/chat/${cid}`));
                if (chat_doc && doc.created_at > (chat_doc.activity ?? 0)) {
                    chat_doc.activity = doc.created_at;
                    await this.engine.set(`/chat/${cid}`, serialize(chat_doc), doc.created_at);
                }

                // El binario solo se materializa en la primera entrega; en re-syncs ya vive en el engine.
                // The binary is only materialized on first delivery; on re-syncs it already lives in the engine.
                let content_buf: Buffer = Buffer.alloc(0);
                if (existing_doc) {
                    /* ya materializado / already materialized */
                } else if (doc.type === 'text') {
                    content_buf = Buffer.from(doc.caption, 'utf-8');
                } else if (doc.type === 'location') {
                    const loc = msg.message?.locationMessage ?? msg.message?.liveLocationMessage;
                    content_buf = Buffer.from(
                        JSON.stringify({ lat: loc?.degreesLatitude, lng: loc?.degreesLongitude }),
                        'utf-8'
                    );
                } else if (doc.type === 'poll') {
                    const poll =
                        msg.message?.pollCreationMessage ??
                        msg.message?.pollCreationMessageV2 ??
                        msg.message?.pollCreationMessageV3;
                    content_buf = Buffer.from(
                        JSON.stringify({
                            content: poll?.name ?? '',
                            options: poll?.options?.map((o) => ({ content: o.optionName })) ?? [],
                        }),
                        'utf-8'
                    );
                } else if (doc.type === 'vcard') {
                    const cards = msg.message?.contactsArrayMessage?.contacts ?? (msg.message?.contactMessage ? [msg.message.contactMessage] : []);
                    content_buf = Buffer.from(cards.map((c) => c.vcard ?? '').join('\n'), 'utf-8');
                } else if (doc.type === 'event') {
                    content_buf = Buffer.from(JSON.stringify(msg.message?.eventMessage ?? {}), 'utf-8');
                } else if (this.#internals.socket && ['image', 'video', 'audio', 'document'].includes(doc.type)) {
                    try {
                        const buffer = await downloadMediaMessage(msg, 'buffer', {});
                        if (Buffer.isBuffer(buffer)) {
                            content_buf = buffer as unknown as Buffer;
                        }
                    } catch {
                        /* media download may fail */
                    }
                }

                if (content_buf.length > 0) {
                    await this.#write_content(`/chat/${cid}/message/${mid}/content`, content_buf);
                }

                const instance = message(this, doc);
                const chat_instance = await instance.chat();
                this.emit('message:created', instance, chat_instance, this);
                if (doc.forwarded) {
                    this.emit('message:forwarded', instance, chat_instance, this);
                }
            }
        }
    }

    /**
     * Ubica el documento de un mensaje partiendo del chat crudo del key. Los updates y
     * receipts llegan direccionados por LID —con o sin dispositivo— mientras el documento
     * vive bajo el JID con el que se guardó, así que se prueban ambas formas.
     * Locates a message document from the raw chat in the key. Updates and receipts arrive
     * LID-addressed —with or without device— while the document lives under the JID it was
     * stored with, so both forms are tried.
     *
     * @param cid - Chat tal como viene en el key / Chat as it comes in the key
     * @param mid - Identificador del mensaje / Message identifier
     * @returns Ruta y documento, o null si no existe / Path and document, or null when missing
     * @internal
     */
    async #locate(cid: string, mid: string): Promise<{ path: string; doc: Message['_raw'] } | null> {
        const tried = new Set<string>();
        for (const candidate of [await this.#resolve_jid(cid), cid, jidNormalizedUser(cid)]) {
            if (candidate && !tried.has(candidate)) {
                tried.add(candidate);
                const path = `/chat/${candidate}/message/${mid}`;
                const doc = deserialize<Message['_raw']>(await this.engine.get(path));
                if (doc) {
                    return { path, doc };
                }
            }
        }
        return null;
    }

    /** @internal */
    async #handle_messages_update(updates: WAMessageUpdate[]): Promise<void> {
        for (const { key, update: upd } of updates) {
            if (key.remoteJid && key.id) {
                // Updates sobre `status@broadcast` se descartan: el feed sólo se
                // muta vía reacciones (`messages.reaction`), `Feed.view()` o REVOKE.
                // Updates on `status@broadcast` are discarded: feed mutates only via
                // reactions, `Feed.view()` or REVOKE.
                if (key.remoteJid === 'status@broadcast') {
                    continue;
                }
                const found = await this.#locate(key.remoteJid, key.id);
                if (found) {
                    const { path, doc } = found;
                    const raw: WAMessage = doc.raw ?? { key };
                    const upd_any = upd as {
                        message?: proto.IMessage & { editedMessage?: { message?: proto.IMessage } };
                        status?: number;
                        starred?: boolean;
                        messageStubParameters?: (string | null)[];
                    };
                    const edited_message = upd_any.message?.editedMessage?.message;
                    const content_update = upd_any.message;
                    const status = upd_any.status;
                    const starred_changed = upd_any.starred !== undefined;

                    if (edited_message) {
                        raw.message = edited_message;
                        doc.raw = raw;
                        doc.edited = true;
                        doc.caption = message(this, raw).caption;
                        await this.engine.set(path, serialize(doc), doc.created_at);
                        const msg_instance = message(this, doc);
                        this.emit('message:updated', msg_instance, await msg_instance.chat(), this);
                    } else if (content_update) {
                        // Actualización de contenido (ej: live location). Mergea sobre el raw existente.
                        raw.message = { ...raw.message, ...content_update };
                        doc.raw = raw;
                        doc.caption = message(this, raw).caption;
                        await this.engine.set(path, serialize(doc), doc.created_at);
                        const msg_instance = message(this, doc);
                        this.emit('message:updated', msg_instance, await msg_instance.chat(), this);
                    } else if (starred_changed) {
                        doc.starred = upd_any.starred === true;
                        raw.starred = doc.starred;
                        doc.raw = raw;
                        await this.engine.set(path, serialize(doc), doc.created_at);
                        const msg_instance = message(this, doc);
                        this.emit(
                            doc.starred ? 'message:starred' : 'message:unstarred',
                            msg_instance,
                            await msg_instance.chat(),
                            this,
                        );
                        // WhatsApp reemite los acks desordenados al reconectar (un `sent` después
                        // de un `delivered`), así que el estado solo avanza; el rechazo (`error`)
                        // es terminal y sí puede pisar lo que hubiera.
                        // WhatsApp re-emits acks out of order on reconnect (a `sent` after a
                        // `delivered`), so the state only moves forward; a rejection (`error`) is
                        // terminal and may override whatever was there.
                    } else if (status !== undefined && (status > doc.status || status === ERROR)) {
                        raw.status = status;
                        doc.status = status;
                        // El rechazo del servidor viaja como stub del update; sin persistirlo el
                        // mensaje queda en error sin decir por qué.
                        // The server rejection travels as an update stub; without persisting it the
                        // message stays in error without saying why.
                        if (upd_any.messageStubParameters) {
                            raw.messageStubParameters = upd_any.messageStubParameters;
                        }
                        doc.raw = raw;
                        await this.engine.set(path, serialize(doc), doc.created_at);
                        const msg_instance = message(this, doc);
                        this.emit('message:updated', msg_instance, await msg_instance.chat(), this);
                    }
                }
            }
        }
    }

    /** @internal */
    async #handle_messages_reaction(
        reactions: Array<{
            key: { remoteJid?: string | null; id?: string | null; participant?: string | null };
            reaction: { text?: string | null };
        }>
    ): Promise<void> {
        for (const { key, reaction } of reactions) {
            if (key.remoteJid && key.id) {
                // Reacciones sobre status@broadcast → feed:updated (no message:reacted).
                // Reactions on status@broadcast → feed:updated (not message:reacted).
                if (key.remoteJid === 'status@broadcast') {
                    const feed_raw = deserialize<FeedRaw>(
                        await this.engine.get(`/status/${key.id}`),
                    );
                    if (feed_raw) {
                        this.emit('feed:updated', new Feed(this, feed_raw), this);
                    }
                    continue;
                }
                const found = await this.#locate(key.remoteJid, key.id);
                if (found) {
                    const { path, doc } = found;
                    const reactor = jidNormalizedUser(key.participant ?? key.remoteJid);
                    const emoji = reaction.text ?? '';
                    doc.reactions = [
                        ...(doc.reactions ?? []).filter((r) => r.author !== reactor),
                        ...(emoji ? [{ author: reactor, emoji, at: Date.now() }] : []),
                    ];
                    await this.engine.set(path, serialize(doc), doc.created_at);
                    const msg_instance = message(this, doc);
                    this.emit(
                        'message:reacted',
                        msg_instance,
                        await msg_instance.chat(),
                        reaction.text ?? '',
                        this,
                    );
                }
            }
        }
    }
}

export default WhatsApp;
