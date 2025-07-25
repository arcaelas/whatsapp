import { merge, Noop, promify, sleep } from '@arcaelas/utils';
import { type Boom } from '@hapi/boom';
import { Mutex } from 'async-mutex';
import * as Baileys from 'baileys';
import EventEmitter from 'node:events';
import Chat from './model/chat';
import Message from './model/message';
import Store, { Engine } from './static/Store';
import useCache from './static/useCache';

interface IWhatsApp<T extends 'qr' | 'code'> {
    phone: string;
    store?: Engine;
    loginType: T;
    qr: T extends 'qr' ? Noop<[QR: string]> : never;
    code: T extends 'code' ? Noop<[code: string]> : never;
}

interface EventMap {
    error: [error: Error]
    open: []
    close: []
    qr: [qr: string]
    code: [code: string]
    'chat:created': [chat: Chat]
    'chat:updated': [chat: Chat]
    'chat:deleted': [id: string]
    'message:created': [message: Message]
    'message:updated': [message: Message]
    'message:deleted': [id: string]
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
export default class WhatsApp<T extends 'qr' | 'code'> extends EventEmitter<EventMap> {
    /**
     * @description
     * Socket for WhatsApp Web.
     */
    protected socket: Baileys.WASocket;
    /**
     * @description
     * Store for WhatsApp Web.
     */
    protected store: Store = new Map() as any;
    /**
     * @description
     * Mutex, used to prevent concurrent access to the socket.
     */
    protected readonly mutex = new Mutex();

    constructor(protected readonly options: IWhatsApp<T>) {
        super({ captureRejections: true });
        this.on('error', (error) => {
            if (this.listenerCount('error') === 1) {
                console.error(error);
            }
        });
        this.store = new Store(this.options.store ?? new Map() as any);
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

    async documents(): Promise<Record<string, any>> {
        return await this.tick(async (_, store) => {
            const documents: Record<string, any> = {}
            for await (const document of store.document.values()) {
                documents[document.key] = document.value;
            }
            return documents;
        });
    }

    async chats(): Promise<Chat[]> {
        return await this.tick(async (_, store) => {
            const chats: Chat[] = [];
            for await (const chat of store.chat.values()) {
                chats.push(new Chat(this, chat));
            }
            return chats;
        });
    }

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
        const promise = promify<Baileys.WASocket>();
        const { state, save } = await useCache(this.store);
        const { version } = await Baileys.fetchLatestBaileysVersion();
        this.socket = Baileys.makeWASocket({
            version,
            syncFullHistory: true,
            browser: Baileys.Browsers.macOS('Descktop'),
            auth: {
                creds: state.creds,
                keys: Baileys.makeCacheableSignalKeyStore(state.keys),
            },
            getMessage: async (key) => {
                const message = await this.store.message.get(key.id!);
                return message ? message.message! : undefined;
            },
        });
        this.socket.ev.process(async (event) => {
            if (event['creds.update']) {
                await save();
            }
            if (event['connection.update']) {
                const { connection, lastDisconnect } = event['connection.update'];
                if (connection === 'open') promise.resolve(this.socket);
                else if (connection === 'close' && (lastDisconnect?.error as Boom)?.output?.statusCode !== Baileys.DisconnectReason.loggedOut) {
                    promise.resolve(await this.connect());
                    return
                }
            }
            // prettier-ignore
            await Promise.allSettled(
                ([] as Baileys.Chat[])
                    .concat(event['messaging-history.set']?.chats || [], event['chats.upsert'] || [])
                    .map(async chat => {
                        await this.store.chat.set(chat);
                        this.emit('chat:created', new Chat(this, chat));
                    })
            );
            // prettier-ignore
            await Promise.allSettled(
                ([] as Baileys.ChatUpdate[])
                    .concat(event['chats.update'] || [])
                    .map(async update => {
                        const payload = await this.store.chat.get(update.id!);
                        if (payload !== null) {
                            const chat = merge(payload, update) as Baileys.Chat;
                            await this.store.chat.set(chat);
                            this.emit('chat:updated', new Chat(this, chat));
                        }
                    })
            );
            for (const key of (event['chats.delete'] ?? []) as string[]) {
                await this.store.chat.delete(key);
                this.emit('chat:deleted', key);
            }
            // prettier-ignore
            await Promise.allSettled(
                ([] as Baileys.WAMessage[])
                    .concat(event['messages.upsert']?.messages || [])
                    .map(async message => {
                        await this.store.message.set(message);
                        this.emit('message:created', new Message(this, message));
                    })
            );
            // prettier-ignore
            await Promise.allSettled(
                ([] as Baileys.WAMessageUpdate[])
                    .concat(event['messages.update'] || [])
                    .map(async message => {
                        const payload = await this.store.message.get(message.key.id!);
                        if (payload !== null) {
                            const chat = merge(payload, message) as Baileys.WAProto.WebMessageInfo;
                            await this.store.message.set(chat);
                            this.emit('message:updated', new Message(this, chat));
                        }
                    })
            );
            // TODO: Handle messages.delete
        })

        await this.socket.waitForSocketOpen();
        await sleep(3000);

        if (this.socket.authState.creds.registered) {
            promise.resolve(this.socket);
        } else if (this.options.loginType === 'code') {
            await this.options.code(
                await this.socket.requestPairingCode(this.options.phone)
            );
        } else if (this.options.loginType === 'qr') {
            const _qr = promify<string>();
            const timeout = setTimeout(() => _qr.reject('QR Timeout'), 60000);
            this.socket.ev.on('connection.update', async ({ qr }) => {
                if (qr) {
                    clearTimeout(timeout);
                    try {
                        await this.options.qr(qr);
                        _qr.resolve(qr);
                    } catch (error) {
                        _qr.reject(error);
                    }
                }
            });
            await _qr;
        }
        return promise;
    }
}