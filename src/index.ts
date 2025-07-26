import { merge, Noop, promify } from '@arcaelas/utils';
import { type Boom } from '@hapi/boom';
import { Mutex } from 'async-mutex';
import * as Baileys from 'baileys';
import EventEmitter from 'node:events';
import Chat from './model/chat';
import Message from './model/message';
import Store, { Engine } from './static/Store';
import useCache from './static/useCache';

/**
 * @description Estructura de configuración para iniciar sesión con WhatsApp.
 */
interface IWhatsApp {
    phone: string;
    store: Engine;
    onCode(code: string): void | Promise<void>;
    browser?: Baileys.WABrowserDescription | undefined;
}

/**
 * @description
 * Event map for WhatsApp.
 */
interface EventMap {
    error: [error: Error];
    open: [];
    close: [];
    qr: [qr: string];
    code: [code: string];
    'chat:created': [chat: Chat];
    'chat:updated': [chat: Chat];
    'chat:deleted': [id: string];
    'message:created': [message: Message];
    'message:updated': [message: Message];
    'message:deleted': [id: string];
    process: [event: Partial<Baileys.BaileysEventMap>, socket: Baileys.WASocket, store: Store];
}

/**
 * @description
 * Client for WhatsApp Web.
 * @example
 * const client = new WhatsApp({
 *  phone: '1234567890',
 *  loginType: 'qr',
 *  qr: (code) => console.log(code),
 * });
 */
class WhatsApp extends EventEmitter<EventMap> {
    /**
     * @description
     * Store for WhatsApp Web.
     */
    protected store: Store;
    /**
     * @description
     * Socket for WhatsApp Web.
     */
    protected socket: Baileys.WASocket;
    /**
     * @description
     * Mutex, used to prevent concurrent access to the socket.
     */
    protected readonly mutex = new Mutex();

    constructor(protected readonly options: IWhatsApp) {
        super({ captureRejections: true });
        this.store = new Store(this.options.store);
        this.connect();
    }

    /**
     * @description
     * Execute a function with the socket and store, means that the function will be executed only when the socket is ready.
     * @param func Function to execute.
     * @returns Result of the function.
     */
    async tick<T extends Noop<[socket: Baileys.WASocket, store: Store], any>>(func: T): Promise<Awaited<ReturnType<T>>> {
        return this.mutex.acquire().then(() => func(this.socket, this.store));
    }

    /**
     * @description
     * Process events from the socket.
     * @param func Function to execute.
     * @returns Handler to remove the event listener.
     */
    process(func: Noop<[event: Partial<Baileys.BaileysEventMap>, socket: Baileys.WASocket, store: Store]>) {
        return this.on('process', (event) => {
            func(event, this.socket, this.store);
        });
    }

    /**
     * @description
     * Returns all documents in the store.
     * @returns Promise that resolves to an object containing all documents.
     */
    async documents(): Promise<Record<string, any>> {
        return await this.tick(async (_, store) => {
            const documents: Record<string, any> = {};
            for await (const document of store.document.values()) {
                documents[document.key] = document.value;
            }
            return documents;
        });
    }

    /**
     * @description
     * Returns all chats in the store.
     * @returns Promise that resolves to an array of chats.
     */
    async chats(): Promise<Chat[]> {
        return await this.tick(async (_, store) => {
            const chats: Chat[] = [];
            for await (const chat of store.chat.values()) {
                chats.push(new Chat(this, chat));
            }
            return chats;
        });
    }

    /**
     * @description
     * Returns all messages in the store.
     * @returns Promise that resolves to an array of messages.
     */
    async messages(): Promise<Message[]> {
        return await this.tick(async (_, store) => {
            const messages: Message[] = [];
            for await (const message of store.message.values()) {
                messages.push(new Message(this, message));
            }
            return messages;
        });
    }

    /**
     * @description
     * Connect to WhatsApp Web.
     * @returns Promise that resolves to the socket.
     */
    protected async connect() {
        const promise = promify();
        try {
            const { state, save } = await useCache(this.store);
            const { version } = await Baileys.fetchLatestBaileysVersion();
            const socket = Baileys.makeWASocket({
                version,
                syncFullHistory: true,
                browser: Baileys.Browsers.macOS('Desktop'),
                auth: {
                    creds: state.creds,
                    keys: Baileys.makeCacheableSignalKeyStore(state.keys),
                },
                getMessage: async (key) => {
                    const message = await this.store.message.get(key.id!);
                    return message ? message.message! : undefined;
                },
            });
            socket.ev.process((ev) => {
                this.emit('process', ev, socket, this.store);
            });
            socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
                if (connection === 'open') promise.resolve(socket);
                else if (connection === 'close' && (lastDisconnect?.error as Boom)?.output?.statusCode !== Baileys.DisconnectReason.loggedOut) {
                    promise.resolve(await this.connect());
                } else if (connection === 'connecting' || !!qr) {
                    // prettier-ignore
                    this.options.onCode(
                        await socket.requestPairingCode(this.options.phone)
                    );
                }
            });
            socket.ev.process(async (event) => {
                if (event['creds.update']) {
                    await save();
                }
                // prettier-ignore
                await Promise.allSettled(
                    [...event['messaging-history.set']?.chats || [], ...event['chats.upsert'] || []]
                    .map(async chat => {
                        await this.store.chat.set(chat);
                        this.emit('chat:created', new Chat(this, chat));
                    })
                );
                // prettier-ignore
                await Promise.allSettled(
                    [...event['messaging-history.set']?.messages || [], ...event['messages.upsert']?.messages || []]
                    .map(async message=> {
                        await this.store.message.set(message);
                        this.emit('message:created', new Message(this, message));
                    })
                )
                // prettier-ignore
                await Promise.allSettled(
                    (event['chats.update'] || [])
                        .map(async update => {
                            const payload = await this.store.chat.get(update.id!);
                            if (payload) {
                                const chat = merge(payload, update) as Baileys.Chat;
                                await this.store.chat.set(chat);
                                this.emit('chat:updated', new Chat(this, chat));
                            }
                        })
                );
                // prettier-ignore
                await Promise.allSettled(
                    (event['messages.update'] || [])
                        .map(async update => {
                            const payload = await this.store.message.get(update.key.id!);
                            if (payload) {
                                const message = merge(payload, update) as Baileys.WAProto.WebMessageInfo;
                                await this.store.message.set(message);
                                this.emit('message:updated', new Message(this, message));
                            }
                        })
                );
                for (const { id } of event['messages.delete']?.['keys'] || []) {
                    await this.store.message.unset(id);
                }
                for (const key of event['chats.delete'] || []) {
                    await this.store.chat.unset(key);
                }
            });
        } catch (error) {
            promise.reject(error);
        }
        // prettier-ignore
        return promise
            .then((socket) => (this.socket = socket));
    }
}

export default WhatsApp;
export * from './static/Store';
export { default as Store } from './static/Store';
export { default as useCache } from './static/useCache';

export * from './model/chat';
export { default as Chat } from './model/chat';

export * from './model/message';
export { default as Message } from './model/message';
