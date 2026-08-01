/**
 * @file whatsapp/index.ts
 * @description Cliente WhatsApp: configuración, sesión y emisor de eventos. El procesamiento
 * de lo que llega del socket vive en `./lib/handlers`, que `connect` engancha.
 * WhatsApp client: configuration, session and event emitter. Processing of whatever arrives
 * from the socket lives in `./lib/handlers`, which `connect` wires up.
 */

import {
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion,
    initAuthCreds,
    jidNormalizedUser,
    makeWASocket,
    proto,
    type AuthenticationCreds,
    type SignalDataTypeMap,
} from 'baileys';
import { EventEmitter } from 'node:events';
import pino from 'pino';
import * as QRCode from 'qrcode';
import { chat } from '~/lib/chat';
import { contact } from '~/lib/contact';
import { bind, internals } from '~/lib/internal';
import {
    Audio,
    Document,
    Event,
    Image,
    Location,
    Message,
    Poll,
    Sticker,
    Text,
    VCard,
    Video,
} from '~/lib/message';
import { Feed, TTL_MS as FEED_TTL_MS } from '~/lib/status';
import { deserialize, serialize, type Engine } from '~/lib/store';
import type { Chat } from '~/lib/chat';
import type { Contact } from '~/lib/contact';
import {
    on_chats_delete,
    on_chats_update,
    on_chats_upsert,
    on_contacts_update,
    on_contacts_upsert,
    on_lid_mapping,
    on_message_receipt,
    on_messages_update,
    on_messages_upsert,
    resolve_jid,
    write_content,
} from './lib/handlers';

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
     * Abre la sesión y engancha los eventos del socket: historial, contactos, chats, mensajes
     * y receipts se procesan y se reemiten como eventos del cliente. El callback recibe el PIN
     * (string) si se configuró `phone`, o el QR (Buffer PNG) si no. Resuelve cuando la sesión
     * sincroniza; reintenta automáticamente en cierres no-loggedOut.
     *
     * Opens the session and wires the socket events: history, contacts, chats, messages and
     * receipts are processed and re-emitted as client events. The callback receives the PIN
     * (string) when `phone` is configured, or the QR (PNG Buffer) otherwise. Resolves once the
     * session is synced; retries on non-loggedOut disconnects.
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
        // Cadena que serializa los handlers: dos eventos sobre el mismo documento ya no se
        // intercalan (lost updates por read-modify-write concurrente).
        // Chain serializing the handlers: two events over the same document no longer
        // interleave (lost updates from concurrent read-modify-write).
        let chain: Promise<void> = Promise.resolve();
        const run = (task: () => Promise<void>): void => {
            chain = chain.then(task).catch(() => { });
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
                try {
                    // Pasa un error Boom-like con statusCode=connectionClosed (428) para que
                    // `lastDisconnect.error.output.statusCode` quede explícito en el close
                    // en lugar de `undefined`.
                    await live.end(Object.assign(new Error('intentional close'), {
                        output: { statusCode: DisconnectReason.connectionClosed },
                    }));
                } catch {
                    /* socket may already be closed */
                }
                internals(this).socket = null;
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
                    syncFullHistory: this.#options.sync,
                    // Los syncs no-FULL cargan las LID mappings y los tctokens (trusted-contact
                    // tokens) que rc13 exige para enviar: apagarlos todos con `() => sync`
                    // deja la sesión sin tctoken y el server rechaza los mensajes con
                    // "error 463: account restricted or missing tctoken". Por eso se procesan
                    // siempre los no-FULL; `sync` solo decide si además se trae el historial FULL.
                    // Non-FULL syncs carry the LID mappings and tctokens rc13 requires to send;
                    // disabling them all made the server reject messages with error 463. We always
                    // process non-FULL; `sync` only gates whether FULL history is pulled too.
                    shouldSyncHistoryMessage: ({ syncType }) =>
                        this.#options.sync || syncType !== proto.HistorySync.HistorySyncType.FULL,
                    markOnlineOnConnect: false,
                });
                internals(this).socket = socket;

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

                        // `disconnect({ silent: true })` calla el evento de este cierre concreto.
                        // `disconnect({ silent: true })` mutes this specific close's event.
                        if (connected && !is_transient && !silent) {
                            this.emit('disconnected', this);
                        }

                        if (!intentional) {
                            if (status_code === DisconnectReason.loggedOut) {
                                reject(new Error('Logged out'));
                            } else {
                                const max = this.#options.reconnect.max;
                                // Transient closes (restartRequired) son parte del protocolo,
                                // no cuentan contra el límite de reintentos por fallo.
                                const exhausted = !is_transient && max !== null && retries >= max;
                                if (exhausted) {
                                    reject(new Error(`Reconnect attempts exhausted (${max})`));
                                } else {
                                    if (!is_transient) {
                                        retries++;
                                    }
                                    timer = setTimeout(() => {
                                        timer = null;
                                        start().catch(reject);
                                    }, is_transient ? 0 : this.#options.reconnect.interval_ms);
                                }
                            }
                        }
                    }
                });

                // Todo lo que llega del socket se procesa y se reemite como evento del cliente.
                // Las reacciones llegan duplicadas por `messages.reaction` Y `messages.upsert`
                // (como `reactionMessage`): se usa solo el upsert para evitar el doble disparo.
                // Everything arriving from the socket is processed and re-emitted as a client
                // event. Reactions arrive twice —through `messages.reaction` AND `messages.upsert`
                // as a `reactionMessage`— so only the upsert is used to avoid double firing.
                socket.ev.on('messaging-history.set', ({ chats, contacts, messages }) => run(async () => {
                    await on_contacts_upsert(this, contacts);
                    await on_chats_upsert(this, chats);
                    await on_messages_upsert(this, messages);
                }));
                socket.ev.on('contacts.upsert', (rows) => run(() => on_contacts_upsert(this, rows)));
                socket.ev.on('contacts.update', (rows) => run(() => on_contacts_update(this, rows)));
                socket.ev.on('lid-mapping.update', ({ lid, pn }) => run(() => on_lid_mapping(this, lid, pn)));
                socket.ev.on('chats.upsert', (rows) => run(() => on_chats_upsert(this, rows)));
                socket.ev.on('chats.update', (rows) => run(() => on_chats_update(this, rows)));
                socket.ev.on('chats.delete', (ids) => run(() => on_chats_delete(this, ids)));
                socket.ev.on('messages.upsert', ({ messages }) => run(() => on_messages_upsert(this, messages)));
                socket.ev.on('messages.update', (updates) => run(() => on_messages_update(this, updates)));
                socket.ev.on('message-receipt.update', (updates) => run(() => on_message_receipt(this, updates)));
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
