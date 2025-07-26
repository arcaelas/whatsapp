import { merge, Noop, promify, sleep } from '@arcaelas/utils';
import { Mutex, type MutexInterface } from 'async-mutex';
import * as Baileys from 'baileys';
import NodeCache from 'node-cache';
import EventEmitter from 'node:events';
import P from 'pino';
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
    protected socket: Baileys.WASocket | null = null;
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
    async tick<T extends Noop<[release: MutexInterface.Releaser, socket: Baileys.WASocket, store: Store], any>>(func: T): Promise<Awaited<ReturnType<T>>> {
        return this.mutex.acquire(5).then((release) => func(release, this.socket!, this.store));
    }

    /**
     * @description
     * Process events from the socket.
     * @param func Function to execute.
     * @returns Handler to remove the event listener.
     */
    process(func: Noop<[event: Partial<Baileys.BaileysEventMap>, socket: Baileys.WASocket, store: Store]>) {
        return this.on('process', (event) => {
            func(event, this.socket!, this.store);
        });
    }

    /**
     * @description
     * Returns all documents in the store.
     * @returns Promise that resolves to an object containing all documents.
     */
    async documents(): Promise<Record<string, any>> {
        const documents: Record<string, any> = {};
        for await (const document of this.store.document.values()) {
            documents[document.key] = document.value;
        }
        return documents;
    }

    /**
     * @description
     * Returns all chats in the store.
     * @returns Promise that resolves to an array of chats.
     */
    async chats(): Promise<Chat[]> {
        const chats: Chat[] = [];
        for await (const chat of this.store.chat.values()) {
            chats.push(new Chat(this, chat));
        }
        return chats;
    }

    /**
     * @description
     * Returns all messages in the store.
     * @returns Promise that resolves to an array of messages.
     */
    async messages(): Promise<Message[]> {
        const messages: Message[] = [];
        for await (const message of this.store.message.values()) {
            messages.push(new Message(this, message));
        }
        return messages;
    }

    /**
     * @description
     * Connect to WhatsApp Web.
     * @returns Promise that resolves to the socket.
     */
    protected async connect() {
        const promise = promify();
        try {
            const logger = P({ level: 'fatal' });
            const { state, save } = await useCache(this.store);
            const socket = Baileys.makeWASocket({
                logger: logger,
                maxMsgRetryCount: 4,
                syncFullHistory: false,
                printQRInTerminal: false,
                connectTimeoutMs: 20_000,
                retryRequestDelayMs: 350,
                markOnlineOnConnect: false,
                keepAliveIntervalMs: 30_000,
                version: [2, 3000, 1023223821],
                generateHighQualityLinkPreview: true,
                msgRetryCounterCache: new NodeCache(),
                browser: ['Windows', 'Chrome', 'Chrome 114.0.5735.198'],
                auth: {
                    creds: state.creds,
                    keys: Baileys.makeCacheableSignalKeyStore(state.keys, logger),
                },
                getMessage: async (key) => {
                    const message = await this.store.message.get(key.id!);
                    return message ? message.message! : undefined;
                },
            });
            socket.ev.process(async (event) => {
                this.emit('process', event, socket, this.store);
                if (event['creds.update']) {
                    await save();
                }
                if (event['connection.update']) {
                    const { connection, lastDisconnect } = event['connection.update'];
                    const statusCode = lastDisconnect?.error?.['output']?.statusCode;
                    if (connection === 'open') {
                        promise.resolve(socket);
                    } else if (connection === 'close') {
                        if (statusCode === Baileys.DisconnectReason.loggedOut) {
                            promise.resolve(await this.connect());
                        } else if (statusCode === Baileys.DisconnectReason.restartRequired) {
                            promise.resolve(await this.connect());
                        } else {
                            promise.reject(lastDisconnect);
                        }
                    }
                }
            });
            socket.ev.on('messaging-history.set', ({ contacts = [], chats = [], messages = [] }) => {
                // prettier-ignore
                Promise.allSettled(
                    contacts.map(async c=>{
                        await this.store.contact.set(c);
                    })
                );
                // prettier-ignore
                Promise.allSettled(
                    chats.map(async c=>{
                        await this.store.chat.set(c);
                        this.emit('chat:created', new Chat(this, c));
                    })
                );
                // prettier-ignore
                Promise.allSettled(
                    messages.map(async m=>{
                        await this.store.message.set(m);
                        const message = new Message(this, m);
                        if(['text', 'image', 'audio', 'video', 'location'].includes(message.type)){
                            this.emit('message:created', message);
                        }
                    })
                );
            });
            socket.ev.on('chats.upsert', (chats) => {
                // prettier-ignore
                Promise.allSettled(
                    chats.map(async c=>{
                        await this.store.chat.set(c);
                        this.emit('chat:created', new Chat(this, c));
                    })
                )
            });
            socket.ev.on('chats.update', (chats) => {
                // prettier-ignore
                Promise.allSettled(
                    chats.map(async c=>{
                        const mem = await this.store.chat.get(c.id!)
                        const payload = merge({}, mem, c);
                        await this.store.chat.set(payload);
                        this.emit('chat:updated', new Chat(this, payload));
                    })
                )
            });
            socket.ev.on('chats.delete', (ids) => {
                // prettier-ignore
                Promise.allSettled(
                    ids.map(async id=>{
                        await this.store.chat.unset(id);
                        this.emit('chat:deleted', id);
                    })
                )
            });
            socket.ev.on('messages.upsert', ({ type, messages }) => {
                if (type === 'notify') {
                    // prettier-ignore
                    Promise.allSettled(
                        messages.map(async m=>{
                            await this.store.message.set(m);
                            const message = new Message(this, m);
                            if(['text', 'image', 'audio', 'video', 'location'].includes(message.type)){
                                this.emit('message:created', message);
                            }
                        })
                    )
                }
            });
            socket.ev.on('messages.update', (messages) => {
                // prettier-ignore
                Promise.allSettled(
                    messages.map(async m=>{
                        const mem = await this.store.message.get(m.key.id!);
                        const payload = merge({}, mem, m);
                        await this.store.message.set(payload);
                        this.emit('message:updated', new Message(this, payload));
                    })
                )
            });
            socket.ev.on('messages.delete', (e) => {
                if (e['keys']) {
                    // prettier-ignore
                    Promise.allSettled(
                        e['keys'].map(async k=>{
                            await this.store.message.unset(k.id!);
                            this.emit('message:deleted', k.id!);
                        })
                    )
                }
            });
            if (!socket.authState.creds.registered) {
                await sleep(2000);
                await this.store.document.unset('creds.json');
                const code = await socket.requestPairingCode(this.options.phone);
                await this.options.onCode(code);
            }
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
