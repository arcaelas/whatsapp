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
import { chat, type IChatRaw } from '~/lib/chat';
import { contact, type IContactRaw } from '~/lib/contact';
import { message, Message, MessageStatus, type IMessage } from '~/lib/message';
import { deserialize, serialize, type Engine } from '~/lib/store';

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
    /** Teléfono para emparejamiento por PIN. Si falta, se usa QR. / Phone for PIN pairing; QR otherwise. */
    phone?: number | string;
    /**
     * Si al recibir `loggedOut` debe limpiar todo el engine (default: `true`).
     * Si es `false`, solo elimina `/session/creds` y preserva historial.
     *
     * Whether to clear the entire engine on `loggedOut` (default: `true`).
     */
    autoclean?: boolean;
    /** Reconexión automática tras cierres no-loggedOut. Default: `true`. / Auto-reconnect on non-loggedOut closes. */
    reconnect?: ReconnectOption;
    /** Sincroniza historial completo desde el móvil (default: `false`). / Sync full history from phone. */
    sync?: boolean;
}

/**
 * Opciones de desconexión.
 * Disconnect options.
 */
export interface DisconnectOptions {
    /** No emitir evento de cierre. / Suppress close emission. */
    silent?: boolean;
    /** Vaciar el engine tras cerrar. / Clear the engine after closing. */
    destroy?: boolean;
}

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
    'contact:deleted': [ContactInstance, ChatInstance, WhatsApp];
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
}

/**
 * Cliente principal de WhatsApp. No inicia la conexión al instanciar.
 * Main WhatsApp client. Does not connect on instantiation.
 *
 * @example
 * const wa = new WhatsApp({ engine: new FileSystemEngine(__dirname), phone: 584144709840 });
 * wa.on('message:created', (msg) => console.log(msg.caption));
 * await wa.connect((code) => console.log(code));
 */
export class WhatsApp {
    private readonly _phone?: string;
    private readonly _event: EventEmitter<WhatsAppEventMap>;
    private readonly _autoclean: boolean;
    private readonly _reconnect: { max: number | null; interval_ms: number };
    private readonly _sync: boolean;
    /** @internal */
    _socket: WASocket | null = null;
    private _intentional_close = false;
    private _has_connected = false;
    private _retry_timer: ReturnType<typeof setTimeout> | null = null;
    private _retry_count = 0;

    readonly engine: Engine;
    readonly Contact: ReturnType<typeof contact>;
    readonly Chat: ReturnType<typeof chat>;
    readonly Message: ReturnType<typeof message>;

    constructor(options: IWhatsApp) {
        this.engine = options.engine;
        this._phone =
            options.phone !== undefined ? String(options.phone).replace(/\D+/g, '') : undefined;
        this._autoclean = options.autoclean ?? true;
        this._sync = options.sync ?? false;
        this._reconnect = this._parse_reconnect(options.reconnect);
        this._event = new EventEmitter();
        this.Contact = contact(this);
        this.Chat = chat(this);
        this.Message = message(this);
    }

    /** @internal */
    private _parse_reconnect(option: ReconnectOption | undefined): { max: number | null; interval_ms: number } {
        if (option === false) {
            return { max: 0, interval_ms: 60_000 };
        }
        if (option === undefined || option === true) {
            return { max: null, interval_ms: 60_000 };
        }
        if (typeof option === 'number') {
            return { max: option, interval_ms: 60_000 };
        }
        return {
            max: option.max ?? null,
            interval_ms: (option.interval ?? 60) * 1000,
        };
    }

    /**
     * Registra un listener de evento. Retorna función para desuscribirse.
     * Registers an event listener. Returns an unsubscribe function.
     */
    on<E extends keyof WhatsAppEventMap>(
        event: E,
        handler: (...args: WhatsAppEventMap[E]) => void
    ): () => void {
        this._event.on(event, handler as never);
        return () => { this._event.off(event, handler as never); };
    }

    /**
     * Quita un listener previamente registrado.
     * Removes a previously registered listener.
     */
    off<E extends keyof WhatsAppEventMap>(
        event: E,
        handler: (...args: WhatsAppEventMap[E]) => void
    ): this {
        this._event.off(event, handler as never);
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
        this._event.once(event, handler as never);
        return () => { this._event.off(event, handler as never); };
    }

    /**
     * @internal
     * Normaliza cualquier identificador (JID, LID, número, etc.) a JID canónico.
     * Uso interno de la librería — no forma parte de la API pública.
     */
    async _resolve_jid(uid: string): Promise<string | null> {
        let result: string | null = null;
        if (uid.endsWith('@g.us') || uid.endsWith('@s.whatsapp.net')) {
            result = uid;
        } else if (uid.endsWith('@lid')) {
            const direct = deserialize<string>(await this.engine.get(`/lid/${uid}`));
            if (direct) {
                result = direct.includes('@') ? direct : `${direct}@s.whatsapp.net`;
            } else {
                const reverse = deserialize<string | number>(
                    await this.engine.get(`/lid/${uid.split('@')[0]}_reverse`)
                );
                if (reverse != null) {
                    result = `${reverse}@s.whatsapp.net`;
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
        const { version } = await fetchLatestBaileysVersion();

        this._intentional_close = false;
        this._has_connected = false;

        return new Promise<void>((resolve, reject) => {
            const start = async (): Promise<void> => {
                // Re-lee creds en cada start() para que limpiezas del engine tomen efecto
                // en reintentos (permite al consumer forzar nueva sesión borrando /session/creds).
                const stored = await this.engine.get('/session/creds');
                const creds: AuthenticationCreds = deserialize<AuthenticationCreds>(stored) ?? initAuthCreds();

                this._socket = makeWASocket({
                    version,
                    auth: {
                        creds,
                        keys: {
                            get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
                                const data: { [id: string]: SignalDataTypeMap[T] } = {};
                                for (const id of ids) {
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
                                }
                                return data;
                            },
                            set: async (data: Record<string, Record<string, unknown | null>>) => {
                                for (const category in data) {
                                    for (const id in data[category]) {
                                        const value = data[category][id];
                                        if (value != null) {
                                            await this.engine.set(`/session/${category}/${id}`, serialize(value));
                                        } else {
                                            await this.engine.unset(`/session/${category}/${id}`);
                                        }
                                    }
                                }
                            },
                        },
                    },
                    browser: Browsers.windows('Chrome'),
                    printQRInTerminal: false,
                    logger: pino({ level: 'silent' }),
                    syncFullHistory: this._sync,
                    markOnlineOnConnect: false,
                });

                const socket = this._socket;
                socket.ev.on('creds.update', () => this.engine.set('/session/creds', serialize(creds)));

                socket.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;

                    if (qr && !creds.registered) {
                        // Baileys refresca QR periódicamente (~20s). Emitimos nuevo pair
                        // code / QR en cada refresh para que el usuario pueda renovar si
                        // el anterior expiró.
                        if (this._phone) {
                            await callback(await socket.requestPairingCode(this._phone));
                        } else {
                            await callback(await QRCode.toBuffer(qr, { type: 'png', margin: 2 }));
                        }
                    }

                    if (connection === 'open') {
                        this._has_connected = true;
                        this._retry_count = 0;
                        this._event.emit('connected', this);
                        resolve();
                    } else if (connection === 'close') {
                        this._socket = null;
                        const status_code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
                        // `restartRequired` (515) es una reconexión exigida por el protocolo
                        // tras el sync inicial — no es un disconnect "real".
                        const is_transient = status_code === DisconnectReason.restartRequired;

                        // Limpieza del engine ANTES de emitir `disconnected` para que los
                        // listeners vean el estado final (engine vaciado o creds borradas).
                        if (status_code === DisconnectReason.loggedOut) {
                            if (this._autoclean) {
                                await this.engine.clear();
                            } else {
                                await this.engine.unset('/session/creds');
                            }
                        }

                        if (this._has_connected && !is_transient) {
                            this._event.emit('disconnected', this);
                        }

                        if (!this._intentional_close) {
                            if (status_code === DisconnectReason.loggedOut) {
                                reject(new Error('Logged out'));
                            } else {
                                const max = this._reconnect.max;
                                // Transient closes (restartRequired) son parte del protocolo,
                                // no cuentan contra el límite de reintentos por fallo.
                                const exhausted = !is_transient && max !== null && this._retry_count >= max;
                                if (exhausted) {
                                    reject(new Error(`Reconnect attempts exhausted (${max})`));
                                } else {
                                    if (!is_transient) {
                                        this._retry_count++;
                                    }
                                    const delay = is_transient ? 0 : this._reconnect.interval_ms;
                                    this._retry_timer = setTimeout(() => {
                                        this._retry_timer = null;
                                        start().catch(reject);
                                    }, delay);
                                }
                            }
                        }
                    }
                });

                this._attach_business_handlers(socket);
            };

            start().catch(reject);
        });
    }

    /**
     * Cierra la conexión. Con `destroy: true` vacía el engine completo.
     * Closes the connection. With `destroy: true` clears the engine entirely.
     */
    async disconnect(options: DisconnectOptions = {}): Promise<void> {
        this._intentional_close = true;

        // Cancela cualquier retry programado por un close anterior, para no resucitar
        // el socket después de una desconexión manual.
        if (this._retry_timer) {
            clearTimeout(this._retry_timer);
            this._retry_timer = null;
        }

        if (this._socket) {
            try {
                // Pasa un error Boom-like con statusCode=connectionClosed (428) para que
                // `lastDisconnect.error.output.statusCode` quede explícito en el close
                // en lugar de `undefined`.
                const intentional = Object.assign(new Error('intentional close'), {
                    output: { statusCode: DisconnectReason.connectionClosed },
                });
                this._socket.end(intentional);
            } catch {
                /* socket may already be closed */
            }
            this._socket = null;
        }

        if (options.destroy) {
            await this.engine.clear();
        }

        void options.silent;
    }

    /**
     * Conecta los handlers de eventos de baileys: contactos, chats y mensajes.
     * Wires baileys event handlers: contacts, chats and messages.
     *
     * @internal
     */
    private _attach_business_handlers(socket: WASocket): void {
        socket.ev.on('messaging-history.set', async ({ chats, contacts, messages }) => {
            await this._handle_contacts_upsert(contacts);
            await this._handle_chats_upsert(chats);
            await this._handle_messages_upsert(messages);
        });
        socket.ev.on('contacts.upsert', (contacts) => {
            void this._handle_contacts_upsert(contacts);
        });
        socket.ev.on('contacts.update', (contacts) => {
            void this._handle_contacts_update(contacts);
        });
        (socket.ev as unknown as { on: (ev: string, cb: (ids: string[]) => void) => void }).on(
            'contacts.delete',
            (ids) => { void this._handle_contacts_delete(ids); },
        );
        socket.ev.on('lid-mapping.update', ({ lid, pn }) => {
            void this._handle_lid_mapping(lid, pn);
        });
        socket.ev.on('chats.upsert', (chats) => {
            void this._handle_chats_upsert(chats);
        });
        socket.ev.on('chats.update', (chats) => {
            void this._handle_chats_update(chats);
        });
        socket.ev.on('chats.delete', (ids) => {
            void this._handle_chats_delete(ids);
        });
        socket.ev.on('messages.upsert', ({ messages }) => {
            void this._handle_messages_upsert(messages);
        });
        socket.ev.on('messages.update', (updates) => {
            void this._handle_messages_update(updates);
        });
        socket.ev.on('message-receipt.update', (updates) => {
            void this._handle_message_receipt(updates);
        });
        socket.ev.on('messages.reaction', (reactions) => {
            void this._handle_messages_reaction(reactions);
        });
    }

    /** @internal */
    private async _handle_contacts_upsert(contacts: BaileysContact[]): Promise<void> {
        for (const c of contacts) {
            if (c.id) {
                const existing = await this.engine.get(`/contact/${c.id}`);
                const raw: IContactRaw = {
                    id: c.id,
                    lid: c.lid ?? null,
                    name: c.name ?? null,
                    notify: c.notify ?? null,
                    verified_name: c.verifiedName ?? null,
                    img_url: c.imgUrl ?? null,
                    status: c.status ?? null,
                };
                await this.engine.set(`/contact/${c.id}`, serialize(raw));
                if (raw.lid) {
                    await this.engine.set(`/lid/${raw.lid}`, serialize(raw.id));
                }
                if (existing === null) {
                    const cached_chat = deserialize<IChatRaw>(await this.engine.get(`/chat/${raw.id}`));
                    const chat_instance = new this.Chat(
                        cached_chat ?? { id: raw.id, name: raw.name ?? raw.notify ?? raw.id.split('@')[0] }
                    );
                    this._event.emit('contact:created', new this.Contact(raw, chat_instance), chat_instance, this);
                }
            }
        }
    }

    /** @internal */
    private async _handle_contacts_update(contacts: Partial<BaileysContact>[]): Promise<void> {
        for (const c of contacts) {
            if (c.id) {
                const current = deserialize<IContactRaw>(await this.engine.get(`/contact/${c.id}`));
                if (current) {
                    const patch: Partial<IContactRaw> = {};
                    if (c.notify) {
                        patch.notify = c.notify;
                    }
                    if (c.name) {
                        patch.name = c.name;
                    }
                    if (c.imgUrl) {
                        patch.img_url = c.imgUrl;
                    }
                    if (c.status) {
                        patch.status = c.status;
                    }
                    if (c.lid) {
                        patch.lid = c.lid;
                    }
                    if (Object.keys(patch).length > 0) {
                        const merged = { ...current, ...patch };
                        await this.engine.set(`/contact/${c.id}`, serialize(merged));
                        if (patch.lid) {
                            await this.engine.set(`/lid/${patch.lid}`, serialize(c.id));
                        }
                        const cached_chat = deserialize<IChatRaw>(await this.engine.get(`/chat/${c.id}`));
                        const chat_instance = new this.Chat(cached_chat ?? { id: c.id, name: merged.name ?? merged.notify ?? c.id.split('@')[0] });
                        this._event.emit('contact:updated', new this.Contact(merged, chat_instance), chat_instance, this);
                    }
                }
            }
        }
    }

    /** @internal */
    private async _handle_lid_mapping(lid: string, pn: string): Promise<void> {
        await this.engine.set(`/lid/${lid}`, serialize(pn));
        await this.engine.set(`/lid/${pn}`, serialize(lid));
    }

    /** @internal */
    private async _handle_chats_upsert(chats: BaileysChat[]): Promise<void> {
        for (const ch of chats) {
            if (ch.id) {
                const current = deserialize<IChatRaw>(await this.engine.get(`/chat/${ch.id}`));
                const raw: IChatRaw = current ?? {
                    id: ch.id,
                    name: ch.name ?? null,
                    archived: ch.archived ?? null,
                    pinned: ch.pinned ?? null,
                    mute_end_time: ch.muteEndTime != null ? Number(ch.muteEndTime) : null,
                    unread_count: ch.unreadCount ?? null,
                    read_only: ch.readOnly ?? null,
                };
                if (ch.name) {
                    raw.name = ch.name;
                }
                await this.engine.set(`/chat/${ch.id}`, serialize(raw));
                if (current === null) {
                    this._event.emit('chat:created', new this.Chat(raw), this);
                }
            }
        }
    }

    /** @internal */
    private async _handle_chats_update(chats: Partial<BaileysChat>[]): Promise<void> {
        for (const ch of chats) {
            if (ch.id) {
                const current = deserialize<IChatRaw>(await this.engine.get(`/chat/${ch.id}`)) ?? {
                    id: ch.id,
                    name: ch.name ?? null,
                };
                const patch: Partial<IChatRaw> = {};
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
                    const merged: IChatRaw = { ...current, ...patch };
                    await this.engine.set(`/chat/${ch.id}`, serialize(merged));

                    if (pinned_changed) {
                        this._event.emit(
                            ch.pinned != null ? 'chat:pinned' : 'chat:unpinned',
                            new this.Chat(merged),
                            this
                        );
                    }
                    if (archived_changed) {
                        this._event.emit(
                            ch.archived ? 'chat:archived' : 'chat:unarchived',
                            new this.Chat(merged),
                            this
                        );
                    }
                    if (mute_changed) {
                        const is_muted = patch.mute_end_time != null && patch.mute_end_time > Date.now();
                        this._event.emit(
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
    private async _handle_chats_delete(ids: string[]): Promise<void> {
        for (const cid of ids) {
            const raw = deserialize<IChatRaw>(await this.engine.get(`/chat/${cid}`)) ?? { id: cid };
            await this.engine.unset(`/chat/${cid}`);
            this._event.emit('chat:deleted', new this.Chat(raw), this);
        }
    }

    /** @internal */
    private async _handle_contacts_delete(ids: string[]): Promise<void> {
        for (const id of ids) {
            const raw = deserialize<IContactRaw>(await this.engine.get(`/contact/${id}`));
            await this.engine.unset(`/contact/${id}`);
            if (raw) {
                const cached_chat = deserialize<IChatRaw>(await this.engine.get(`/chat/${id}`));
                const chat_instance = new this.Chat(cached_chat ?? { id, name: raw.name ?? raw.notify ?? id.split('@')[0] });
                this._event.emit('contact:deleted', new this.Contact(raw, chat_instance), chat_instance, this);
            }
        }
    }

    /** @internal */
    private async _handle_message_receipt(updates: MessageUserReceiptUpdate[]): Promise<void> {
        for (const { key, receipt } of updates) {
            if (key.remoteJid && key.id && (receipt.readTimestamp != null || receipt.playedTimestamp != null)) {
                const doc = deserialize<IMessage>(await this.engine.get(`/chat/${key.remoteJid}/message/${key.id}`));
                if (doc) {
                    const msg_instance = await this.Message.build_instance(doc);
                    this._event.emit('message:seen', msg_instance, await msg_instance.chat(), this);
                }
            }
        }
    }

    /** @internal */
    private async _handle_messages_upsert(messages: WAMessage[]): Promise<void> {
        for (const msg of messages) {
            if (msg.key?.remoteJid && msg.key.id) {
                const cid = (msg.key as { remoteJidAlt?: string }).remoteJidAlt ?? msg.key.remoteJid;
                const mid = msg.key.id;
                const content_type = getContentType(msg.message ?? {});

                if (content_type === 'reactionMessage') {
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
                            (await this._resolve_jid(creation_key.remoteJid)) ?? creation_key.remoteJid;
                        const target_mid = creation_key.id;
                        const poll_doc = deserialize<IMessage>(
                            await this.engine.get(`/chat/${resolved_cid}/message/${target_mid}`)
                        );
                        const secret_raw = poll_doc?.raw.message?.messageContextInfo?.messageSecret;
                        const message_secret =
                            typeof secret_raw === 'string' ? Buffer.from(secret_raw, 'base64') : secret_raw;
                        if (poll_doc && message_secret) {
                            try {
                                const poll_key = poll_doc.raw.key ?? {};
                                // Modo LID: si la conversación usa addressing LID, usar LIDs en el HMAC
                                const use_lid =
                                    (msg.key as { addressingMode?: string }).addressingMode === 'lid' ||
                                    msg.key.remoteJid?.endsWith('@lid') === true;
                                const self_id = this._socket?.user?.id ?? '';
                                const self_lid = (this._socket?.user as { lid?: string })?.lid ?? '';
                                const voter_jid = use_lid
                                    ? (msg.key.remoteJid ?? '')
                                    : msg.key.participant ||
                                    (msg.key as { remoteJidAlt?: string }).remoteJidAlt ||
                                    msg.key.remoteJid ||
                                    '';
                                const poll_creator_jid = poll_key.fromMe
                                    ? use_lid
                                        ? self_lid
                                        : self_id
                                    : use_lid
                                        ? (poll_key.remoteJid ?? '')
                                        : poll_key.participant ||
                                        (poll_key as { remoteJidAlt?: string }).remoteJidAlt ||
                                        poll_key.remoteJid ||
                                        '';
                                const decrypted = decryptPollVote(
                                    { encPayload: update.vote.encPayload, encIv: update.vote.encIv },
                                    {
                                        pollCreatorJid: poll_creator_jid,
                                        pollMsgId: target_mid,
                                        pollEncKey: message_secret,
                                        voterJid: voter_jid,
                                    }
                                );
                                updateMessageWithPollUpdate(poll_doc.raw, {
                                    pollUpdateMessageKey: msg.key,
                                    vote: decrypted,
                                    senderTimestampMs: Number(msg.messageTimestamp) || Date.now(),
                                });
                                await this.engine.set(
                                    `/chat/${resolved_cid}/message/${target_mid}`,
                                    serialize(poll_doc)
                                );
                                const msg_instance = await this.Message.build_instance(poll_doc);
                                this._event.emit('message:updated', msg_instance, await msg_instance.chat(), this);
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
                        const doc = deserialize<IMessage>(
                            await this.engine.get(`/chat/${target_cid}/message/${target_mid}`)
                        );

                        if (
                            protocol.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT &&
                            protocol.editedMessage &&
                            doc
                        ) {
                            doc.raw.message = protocol.editedMessage;
                            doc.edited = true;
                            doc.caption = this.Message.build_message_doc(
                                doc.raw,
                                this._socket?.user?.id,
                                true
                            ).caption;
                            await this.engine.set(`/chat/${target_cid}/message/${target_mid}`, serialize(doc));
                            const msg_instance = await this.Message.build_instance(doc);
                            this._event.emit('message:updated', msg_instance, await msg_instance.chat(), this);
                        } else if (protocol.type === proto.Message.ProtocolMessage.Type.REVOKE) {
                            await this.engine.unset(`/chat/${target_cid}/message/${target_mid}`);
                            if (doc) {
                                const msg_instance = await this.Message.build_instance(doc);
                                this._event.emit('message:deleted', msg_instance, await msg_instance.chat(), this);
                            }
                        }
                    }
                    continue;
                }

                const doc = this.Message.build_message_doc(msg, this._socket?.user?.id);

                // Autocreación de contacto/chat desde pushName cuando baileys no emite upsert previo
                if (!doc.me) {
                    const push_name = msg.pushName ?? null;
                    const is_group = cid.endsWith('@g.us');

                    if (doc.author && !(await this.engine.get(`/contact/${doc.author}`))) {
                        const lid_key = msg.key.remoteJid?.endsWith('@lid') ? msg.key.remoteJid : null;
                        const contact_raw: IContactRaw = {
                            id: doc.author,
                            lid: lid_key,
                            name: null,
                            notify: is_group ? null : push_name,
                            verified_name: msg.verifiedBizName ?? null,
                            img_url: null,
                            status: null,
                        };
                        await this.engine.set(`/contact/${doc.author}`, serialize(contact_raw));
                        if (lid_key) {
                            await this.engine.set(`/lid/${lid_key}`, serialize(doc.author));
                        }
                        const cached_chat = deserialize<IChatRaw>(await this.engine.get(`/chat/${doc.author}`));
                        const author_chat = new this.Chat(
                            cached_chat ?? { id: doc.author, name: push_name ?? doc.author.split('@')[0] },
                        );
                        this._event.emit(
                            'contact:created',
                            new this.Contact(contact_raw, author_chat),
                            author_chat,
                            this,
                        );
                    }

                    if (!(await this.engine.get(`/chat/${cid}`))) {
                        const chat_raw: IChatRaw = {
                            id: cid,
                            name: is_group ? null : push_name,
                        };
                        await this.engine.set(`/chat/${cid}`, serialize(chat_raw));
                        this._event.emit('chat:created', new this.Chat(chat_raw), this);
                    }
                }

                await this.engine.set(`/chat/${cid}/message/${mid}`, serialize(doc));

                let content_buf: Buffer = Buffer.alloc(0);
                if (doc.type === 'text') {
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
                } else if (this._socket && ['image', 'video', 'audio'].includes(doc.type)) {
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
                    await this.engine.set(
                        `/chat/${cid}/message/${mid}/content`,
                        serialize({ data: content_buf.toString('base64') })
                    );
                }

                const instance = await this.Message.build_instance(doc);
                const chat_instance = await instance.chat();
                this._event.emit('message:created', instance, chat_instance, this);
                if (doc.forwarded) {
                    this._event.emit('message:forwarded', instance, chat_instance, this);
                }
            }
        }
    }

    /** @internal */
    private async _handle_messages_update(updates: WAMessageUpdate[]): Promise<void> {
        for (const { key, update: upd } of updates) {
            if (key.remoteJid && key.id) {
                const doc = deserialize<IMessage>(
                    await this.engine.get(`/chat/${key.remoteJid}/message/${key.id}`)
                );
                if (doc) {
                    const raw: WAMessage = doc.raw ?? { key };
                    const upd_any = upd as {
                        message?: proto.IMessage & { editedMessage?: { message?: proto.IMessage } };
                        status?: number;
                        starred?: boolean;
                    };
                    const edited_message = upd_any.message?.editedMessage?.message;
                    const content_update = upd_any.message;
                    const status = upd_any.status;
                    const starred_changed = upd_any.starred !== undefined;

                    if (edited_message) {
                        raw.message = edited_message;
                        doc.raw = raw;
                        doc.edited = true;
                        doc.caption = this.Message.build_message_doc(raw, this._socket?.user?.id, true).caption;
                        await this.engine.set(`/chat/${key.remoteJid}/message/${key.id}`, serialize(doc));
                        const msg_instance = await this.Message.build_instance(doc);
                        this._event.emit('message:updated', msg_instance, await msg_instance.chat(), this);
                    } else if (content_update) {
                        // Actualización de contenido (ej: live location). Mergea sobre el raw existente.
                        raw.message = { ...raw.message, ...content_update };
                        doc.raw = raw;
                        doc.caption = this.Message.build_message_doc(
                            raw,
                            this._socket?.user?.id,
                            doc.edited
                        ).caption;
                        await this.engine.set(`/chat/${key.remoteJid}/message/${key.id}`, serialize(doc));
                        const msg_instance = await this.Message.build_instance(doc);
                        this._event.emit('message:updated', msg_instance, await msg_instance.chat(), this);
                    } else if (starred_changed) {
                        doc.starred = upd_any.starred === true;
                        raw.starred = doc.starred;
                        doc.raw = raw;
                        await this.engine.set(`/chat/${key.remoteJid}/message/${key.id}`, serialize(doc));
                        const msg_instance = await this.Message.build_instance(doc);
                        this._event.emit(
                            doc.starred ? 'message:starred' : 'message:unstarred',
                            msg_instance,
                            await msg_instance.chat(),
                            this,
                        );
                    } else if (status !== undefined) {
                        raw.status = status;
                        doc.status = status as unknown as MessageStatus;
                        doc.raw = raw;
                        await this.engine.set(`/chat/${key.remoteJid}/message/${key.id}`, serialize(doc));
                        const msg_instance = await this.Message.build_instance(doc);
                        this._event.emit('message:updated', msg_instance, await msg_instance.chat(), this);
                    }
                }
            }
        }
    }

    /** @internal */
    private async _handle_messages_reaction(
        reactions: Array<{
            key: { remoteJid?: string | null; id?: string | null };
            reaction: { text?: string | null };
        }>
    ): Promise<void> {
        for (const { key, reaction } of reactions) {
            if (key.remoteJid && key.id) {
                const doc = deserialize<IMessage>(
                    await this.engine.get(`/chat/${key.remoteJid}/message/${key.id}`)
                );
                if (doc) {
                    const msg_instance = await this.Message.build_instance(doc);
                    this._event.emit(
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
