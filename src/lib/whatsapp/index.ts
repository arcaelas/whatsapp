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
import Chat, { chat } from '~/lib/chat';
import Contact, { Account, contact } from '~/lib/contact';
import Message, { message } from '~/lib/message';
import { Feed, TTL_MS as FEED_TTL_MS } from '~/lib/status';
import { deserialize, jid_of, serialize, type Engine } from '~/lib/store';

type FeedRaw = ConstructorParameters<typeof Feed>[1];
type ChatInstance = InstanceType<ReturnType<typeof chat>>;
type ContactInstance = InstanceType<ReturnType<typeof contact>>;
type MessageRaw = Message['_raw'];
type ChatRaw = Chat['_raw'];
type ContactRaw = Contact['_raw'];

interface Options {
    /** Motor de almacenamiento. / Storage engine. */
    engine: Engine;
    /** Teléfono de la cuenta: su presencia habilita el PIN; sin él la vinculación es por QR. / Account phone: its presence enables the PIN; without it linking is by QR. */
    phone?: number | string;
    /** Canal de vinculación cuando hay `phone`; sin `phone` se ignora. / Linking channel when `phone` is set; ignored without it. */
    method?: 'qr' | 'otp';
    /** Vaciar el engine al recibir `loggedOut`; con `false` sólo borra las credenciales. / Clear the engine on `loggedOut`; with `false` it only drops the credentials. */
    autoclean?: boolean;
    /** Reintentos tras cierres no-loggedOut: `true` infinitos, un número como máximo, o el control explícito (`interval` en segundos). / Retries after non-loggedOut closes: `true` for endless, a number as the cap, or explicit control (`interval` in seconds). */
    reconnect?: boolean | number | { max?: number; interval?: number };
    /** Descargar el historial de mensajes al vincular; contactos, credenciales, LID mappings y tctokens se sincronizan siempre. / Download the message history on link; contacts, credentials, LID mappings and tctokens always sync. */
    sync?: boolean;
}

interface EventMap {
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
    'message:created': [Message, ChatInstance, WhatsApp];
    'message:updated': [Message, ChatInstance, WhatsApp];
    'message:deleted': [Message, ChatInstance, WhatsApp];
    'message:reacted': [Message, ChatInstance, string, WhatsApp];
    'message:starred': [Message, ChatInstance, WhatsApp];
    'message:unstarred': [Message, ChatInstance, WhatsApp];
    'message:forwarded': [Message, ChatInstance, WhatsApp];
    'message:seen': [Message, ChatInstance, WhatsApp];
    'feed:created': [Feed, WhatsApp];
    'feed:updated': [Feed, WhatsApp];
    'feed:deleted': [Feed, WhatsApp];
}

export default class WhatsApp {
    #event = new EventEmitter<EventMap>();
    #options: Options;
    #close: ((silent: boolean) => Promise<void>) | null = null;

    readonly engine: Engine;
    Contact!: ReturnType<typeof contact>;
    Chat!: ReturnType<typeof chat>;
    /** Entidad `Message`, publicada al conectar. / `Message` entity, published on connect. */
    Message!: ReturnType<typeof message>;
    /** Cuenta autenticada, publicada al conectar; null mientras no hay usuario. / Authenticated account, published on connect; null while there is no user. */
    account!: () => Promise<Account | null>;

    constructor(options: Options) {
        this.engine = options.engine;
        this.#options = options;
    }

    emit<E extends keyof EventMap>(event: E, ...args: EventMap[E]): boolean {
        return this.#event.emit(event, ...(args as never));
    }

    on<E extends keyof EventMap>(event: E, handler: (...args: EventMap[E]) => void): () => void {
        this.#event.on(event, handler as never);
        return () => { this.#event.off(event, handler as never); };
    }

    once<E extends keyof EventMap>(event: E, handler: (...args: EventMap[E]) => void): () => void {
        this.#event.once(event, handler as never);
        return () => { this.#event.off(event, handler as never); };
    }

    off<E extends keyof EventMap>(event: E, handler: (...args: EventMap[E]) => void): this {
        this.#event.off(event, handler as never);
        return this;
    }

    async connect(callback: (auth: string | Buffer) => void | Promise<void>): Promise<void> {
        const { engine } = this;
        const { phone, method, autoclean = true, sync = true, reconnect = true } = this.#options;
        const digits = phone !== undefined ? String(phone).replace(/\D+/g, '') : '';
        const budget = reconnect === false ? 0 : reconnect === true ? null : typeof reconnect === 'number' ? reconnect : reconnect.max ?? null;
        const wait = typeof reconnect === 'object' ? (reconnect.interval ?? 60) * 1_000 : 60_000;
        await this.#close?.(true);
        const { version } = await fetchLatestBaileysVersion();
        let connected = false;
        let retries = 0;
        let intentional = false;
        let silent = false;
        let alive: ReturnType<typeof makeWASocket> | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let chain: Promise<void> = Promise.resolve();

        return new Promise<void>((resolve, reject) => {
            const start = async (): Promise<void> => {
                const creds: AuthenticationCreds = deserialize<AuthenticationCreds>(await engine.get('/session/creds')) ?? initAuthCreds();
                const socket = makeWASocket({
                    version,
                    auth: {
                        creds,
                        keys: {
                            get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
                                const data: { [id: string]: SignalDataTypeMap[T] } = {};
                                await Promise.all(ids.map(async (id) => {
                                    const value = deserialize<SignalDataTypeMap[T]>(await engine.get(`/session/${type}/${id}`));
                                    if (value) {
                                        data[id] = type === 'app-state-sync-key'
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
                                            ? engine.set(`/session/${category}/${id}`, serialize(value))
                                            : engine.unset(`/session/${category}/${id}`)
                                    )
                                ));
                            },
                        },
                    },
                    browser: Browsers.windows('Chrome'),
                    logger: pino({ level: 'silent' }),
                    syncFullHistory: sync,
                    shouldSyncHistoryMessage: ({ syncType }) => sync || syncType !== proto.HistorySync.HistorySyncType.FULL,
                    // Cuando el receptor no puede descifrar pide un retry; el cache interno de
                    // baileys indexa por JID pero el retry llega por LID y no lo encuentra: sin
                    // este fallback el mensaje muere en un solo check.
                    // When the receiver cannot decrypt it asks for a retry; the internal baileys
                    // cache indexes by JID but the retry arrives by LID and misses: without this
                    // fallback the message dies at a single check.
                    getMessage: async (key) => {
                        const found = key.remoteJid && key.id ? await locate(key.remoteJid, key.id) : null;
                        return found?.doc.raw.message ?? undefined;
                    },
                    markOnlineOnConnect: false,
                });

                alive = socket;
                const init = { wa: this as WhatsApp, engine, socket };
                this.Contact = contact(init);
                this.Chat = chat(init);
                this.Message = message(init);
                this.account = async () => {
                    const user = socket.user;
                    if (!user) return null;
                    const id = jidNormalizedUser(user.id);
                    const card = deserialize<ContactRaw>(await engine.get(`/contact/${id}`));
                    return new Account(init, {
                        id,
                        phone_number: id,
                        lid: user.lid ?? card?.lid ?? null,
                        name: user.name ?? card?.name ?? null,
                        notify: card?.notify ?? null,
                        verified_name: card?.verified_name ?? null,
                        img_url: (await socket.profilePictureUrl(id, 'image').catch(() => null)) ?? card?.img_url ?? null,
                        status: card?.status ?? null,
                    });
                };
                const locate = async (cid: string, mid: string): Promise<{ path: string; doc: MessageRaw } | null> => {
                    const lid = cid.endsWith('@lid') ? jidNormalizedUser(cid) : '';
                    const resolved = await jid_of(engine, cid, socket);
                    for (const candidate of new Set([resolved, cid, lid].filter(Boolean))) {
                        const path = `/chat/${candidate}/message/${mid}`;
                        const doc = deserialize<MessageRaw>(await engine.get(path));
                        if (doc) {
                            return { path, doc };
                        }
                    }
                    return null;
                };

                socket.ev.on('creds.update', () => engine.set('/session/creds', serialize(creds)));
                socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
                    if (qr && !creds.registered) {
                        await callback(
                            digits && (method ?? 'otp') === 'otp'
                                ? await socket.requestPairingCode(digits)
                                : await QRCode.toBuffer(qr, { type: 'png', margin: 2 })
                        );
                    }
                    if (connection === 'open') {
                        connected = true;
                        retries = 0;
                        this.emit('connected', this);
                        resolve();
                    } else if (connection === 'close') {
                        const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
                        const transient = code === DisconnectReason.restartRequired;
                        if (code === DisconnectReason.loggedOut) {
                            await (autoclean ? engine.clear() : engine.unset('/session/creds'));
                        }
                        if (connected && !transient && !silent) {
                            this.emit('disconnected', this);
                        }
                        if (intentional) {
                            /* cierre pedido por disconnect(): sin reintentos / close requested by disconnect(): no retries */
                        } else if (code === DisconnectReason.loggedOut) {
                            reject(new Error('Logged out'));
                        } else if (!transient && budget !== null && retries >= budget) {
                            reject(new Error(`Reconnect attempts exhausted (${budget})`));
                        } else {
                            retries += transient ? 0 : 1;
                            timer = setTimeout(() => {
                                timer = null;
                                start().catch(reject);
                            }, transient ? 0 : wait);
                        }
                    }
                });
                socket.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
                    socket.ev.emit('contacts.upsert', contacts);
                    socket.ev.emit('chats.upsert', chats);
                    socket.ev.emit('messages.upsert', { messages, type: 'append' });
                });
                socket.ev.on('contacts.upsert', (rows) => {
                    chain = chain.then(async () => {
                        for (const row of rows) {
                            if (row.id) {
                                const current = deserialize<ContactRaw>(await engine.get(`/contact/${row.id}`));
                                const doc: ContactRaw = {
                                    id: row.id,
                                    lid: row.lid ?? current?.lid ?? null,
                                    name: row.name ?? current?.name ?? null,
                                    notify: row.notify ?? current?.notify ?? null,
                                    verified_name: row.verifiedName ?? current?.verified_name ?? null,
                                    img_url: (typeof row.imgUrl === 'string' ? row.imgUrl : null) ?? current?.img_url ?? null,
                                    status: row.status ?? current?.status ?? null,
                                };
                                if (!current || JSON.stringify(current) !== JSON.stringify(doc)) {
                                    await engine.set(`/contact/${row.id}`, serialize(doc));
                                    if (doc.lid) {
                                        await engine.set(`/lid/${doc.lid}`, serialize(doc.id));
                                    }
                                    const person = new this.Contact(doc);
                                    const owner = deserialize<ChatRaw>(await engine.get(`/chat/${doc.id}`));
                                    this.emit(current ? 'contact:updated' : 'contact:created', person, new this.Chat(owner ?? { id: doc.id, name: person.name }), this);
                                }
                            }
                        }
                    }).catch(() => { });
                });
                socket.ev.on('contacts.update', (rows) => {
                    chain = chain.then(async () => {
                        for (const row of rows) {
                            const current = row.id ? deserialize<ContactRaw>(await engine.get(`/contact/${row.id}`)) : null;
                            const patch: Partial<ContactRaw> = {
                                ...(row.notify && { notify: row.notify }),
                                ...(row.name && { name: row.name }),
                                ...(row.verifiedName && { verified_name: row.verifiedName }),
                                ...(typeof row.imgUrl === 'string' && { img_url: row.imgUrl }),
                                ...(row.status && { status: row.status }),
                                ...(row.lid && { lid: row.lid }),
                            };
                            if (current && row.id && Object.keys(patch).length > 0) {
                                const doc = { ...current, ...patch };
                                await engine.set(`/contact/${row.id}`, serialize(doc));
                                if (patch.lid) {
                                    await engine.set(`/lid/${patch.lid}`, serialize(row.id));
                                }
                                const person = new this.Contact(doc);
                                const owner = deserialize<ChatRaw>(await engine.get(`/chat/${row.id}`));
                                this.emit('contact:updated', person, new this.Chat(owner ?? { id: row.id, name: person.name }), this);
                            }
                        }
                    }).catch(() => { });
                });
                socket.ev.on('lid-mapping.update', ({ lid, pn }) => {
                    chain = chain.then(async () => {
                        await engine.set(`/lid/${lid}`, serialize(pn));
                        await engine.set(`/lid/${pn}`, serialize(lid));
                    }).catch(() => { });
                });
                socket.ev.on('chats.upsert', (rows) => {
                    chain = chain.then(async () => {
                        for (const row of rows) {
                            if (row.id) {
                                const current = deserialize<ChatRaw>(await engine.get(`/chat/${row.id}`));
                                const doc: ChatRaw = current ?? {
                                    id: row.id,
                                    name: row.name ?? null,
                                    archived: row.archived ?? null,
                                    pinned: row.pinned ?? null,
                                    mute_end_time: row.muteEndTime != null ? Number(row.muteEndTime) : null,
                                    unread_count: row.unreadCount ?? null,
                                };
                                if (row.name) {
                                    doc.name = row.name;
                                }
                                const [newest] = await engine.list(`/chat/${row.id}/message`, 0, 1);
                                doc.activity = Math.max(
                                    row.conversationTimestamp != null ? Number(row.conversationTimestamp) * 1_000 : 0,
                                    doc.activity ?? 0,
                                    deserialize<MessageRaw>(newest ?? null)?.created_at ?? 0
                                ) || null;
                                await engine.set(`/chat/${row.id}`, serialize(doc), doc.activity ?? 0);
                                if (!current) {
                                    this.emit('chat:created', new this.Chat(doc), this);
                                }
                            }
                        }
                    }).catch(() => { });
                });
                socket.ev.on('chats.update', (rows) => {
                    chain = chain.then(async () => {
                        for (const row of rows) {
                            if (row.id && row.id !== 'status@broadcast') {
                                const current = deserialize<ChatRaw>(await engine.get(`/chat/${row.id}`)) ?? { id: row.id, name: row.name ?? null };
                                const patch: Partial<ChatRaw> = {};
                                const events: (keyof EventMap)[] = [];
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
                                    const doc: ChatRaw = { ...current, ...patch };
                                    await engine.set(`/chat/${row.id}`, serialize(doc), doc.activity ?? undefined);
                                    for (const event of events) {
                                        this.emit(event, new this.Chat(doc), this);
                                    }
                                }
                            }
                        }
                    }).catch(() => { });
                });
                socket.ev.on('chats.delete', (ids) => {
                    chain = chain.then(async () => {
                        for (const cid of ids) {
                            const doc = deserialize<ChatRaw>(await engine.get(`/chat/${cid}`)) ?? { id: cid };
                            await engine.unset(`/chat/${cid}`);
                            this.emit('chat:deleted', new this.Chat(doc), this);
                        }
                    }).catch(() => { });
                });
                socket.ev.on('messages.upsert', ({ messages }) => {
                    chain = chain.then(async () => {
                        for (const msg of messages) {
                            const cid = (msg.key as { remoteJidAlt?: string })?.remoteJidAlt ?? msg.key?.remoteJid;
                            const mid = msg.key?.id;
                            if (!cid || !mid) {
                                continue;
                            }
                            const kind = getContentType(msg.message ?? {});
                            if (kind === 'reactionMessage') {
                                const target = msg.message?.reactionMessage;
                                const found = target?.key?.id && target.key.remoteJid ? await locate(target.key.remoteJid, target.key.id) : null;
                                if (found && target) {
                                    const author = jidNormalizedUser((msg.key.fromMe ? socket.user?.id : msg.key.participant ?? cid) ?? cid);
                                    const emoji = target.text ?? '';
                                    found.doc.reactions = [
                                        ...(found.doc.reactions ?? []).filter((entry) => entry.author !== author),
                                        ...(emoji ? [{ author, emoji, at: Date.now() }] : []),
                                    ];
                                    await engine.set(found.path, serialize(found.doc), found.doc.created_at);
                                    const instance = new Message(init, found.doc);
                                    this.emit('message:reacted', instance, await instance.chat(), emoji, this);
                                }
                                continue;
                            }
                            if (msg.key.remoteJid === 'status@broadcast') {
                                const revoked = kind === 'protocolMessage' && msg.message?.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE
                                    ? msg.message.protocolMessage.key?.id
                                    : null;
                                if (revoked) {
                                    const gone = deserialize<FeedRaw>(await engine.get(`/status/${revoked}`));
                                    if (gone) {
                                        await engine.unset(`/status/${revoked}`);
                                        this.emit('feed:deleted', new Feed(init, gone), this);
                                    }
                                    continue;
                                }
                                const type = ({ conversation: 'text', extendedTextMessage: 'text', imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio' } as Record<string, FeedRaw['type']>)[kind ?? ''];
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
                                await engine.set(`/status/${mid}`, serialize(doc));
                                if (binary.length > 0) {
                                    await (engine.set_buffer?.(`/status/${mid}/content`, binary) ?? engine.set(`/status/${mid}/content`, serialize({ data: binary.toString('base64') })));
                                }
                                this.emit('feed:created', new Feed(init, doc), this);
                                continue;
                            }
                            if (kind === 'pollUpdateMessage') {
                                const key = msg.message?.pollUpdateMessage?.pollCreationMessageKey;
                                const vote = msg.message?.pollUpdateMessage?.vote;
                                const found = key?.id && key.remoteJid ? await locate(key.remoteJid, key.id) : null;
                                const raw_secret = found?.doc.raw.message?.messageContextInfo?.messageSecret;
                                const secret = typeof raw_secret === 'string' ? Buffer.from(raw_secret, 'base64') : raw_secret;
                                if (found && secret && vote?.encPayload && vote.encIv) {
                                    const mine = [socket.user?.lid, socket.user?.id];
                                    const theirs = (from: { remoteJid?: string | null; participant?: string | null; remoteJidAlt?: string }) => [from.remoteJid, from.participant, from.remoteJidAlt];
                                    const voters = (msg.key.fromMe ? mine : theirs(msg.key)).filter((id): id is string => Boolean(id));
                                    const creators = (found.doc.raw.key?.fromMe ? mine : theirs(found.doc.raw.key ?? {})).filter((id): id is string => Boolean(id));
                                    for (const pair of voters.flatMap((who) => creators.map((creator) => [who, creator]))) {
                                        try {
                                            updateMessageWithPollUpdate(found.doc.raw, {
                                                pollUpdateMessageKey: msg.key,
                                                vote: decryptPollVote({ encPayload: vote.encPayload, encIv: vote.encIv }, {
                                                    pollCreatorJid: jidNormalizedUser(pair[1]!),
                                                    pollMsgId: found.doc.id,
                                                    pollEncKey: secret,
                                                    voterJid: jidNormalizedUser(pair[0]!),
                                                }),
                                                senderTimestampMs: Number(msg.messageTimestamp) || Date.now(),
                                            });
                                            await engine.set(found.path, serialize(found.doc), found.doc.created_at);
                                            const instance = new Message(init, found.doc);
                                            this.emit('message:updated', instance, await instance.chat(), this);
                                            break;
                                        } catch {
                                            /* identidad equivocada / wrong identity */
                                        }
                                    }
                                }
                                continue;
                            }
                            if (kind === 'protocolMessage') {
                                const protocol = msg.message?.protocolMessage;
                                const found = protocol?.key?.id ? await locate(protocol.key.remoteJid ?? cid, protocol.key.id) : null;
                                if (found && protocol?.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT && protocol.editedMessage) {
                                    found.doc.raw.message = protocol.editedMessage;
                                    found.doc.edited = true;
                                    found.doc.caption = new Message(init, found.doc.raw).caption;
                                    await engine.set(found.path, serialize(found.doc), found.doc.created_at);
                                    const instance = new Message(init, found.doc);
                                    this.emit('message:updated', instance, await instance.chat(), this);
                                } else if (found && protocol?.type === proto.Message.ProtocolMessage.Type.REVOKE) {
                                    await engine.unset(found.path);
                                    const instance = new Message(init, found.doc);
                                    this.emit('message:deleted', instance, await instance.chat(), this);
                                }
                                continue;
                            }
                            const doc = new Message(init, msg)._raw;
                            const stored = deserialize<MessageRaw>(await engine.get(`/chat/${cid}/message/${mid}`));
                            if (stored) {
                                doc.multiple = typeof stored.multiple === 'boolean' ? stored.multiple : doc.multiple;
                                doc.reactions = stored.reactions ?? doc.reactions;
                                const advanced = doc.status > stored.status;
                                doc.status = Math.max(stored.status, doc.status);
                                if (!advanced && stored.caption === doc.caption && stored.edited === doc.edited && stored.starred === doc.starred) {
                                    continue;
                                }
                            }
                            if (!stored && !doc.me) {
                                const known = deserialize<ContactRaw>(await engine.get(`/contact/${doc.author}`));
                                if (doc.author && !(known?.name ?? known?.notify ?? known?.verified_name)) {
                                    socket.ev.emit('contacts.upsert', [{
                                        id: doc.author,
                                        lid: msg.key.remoteJid?.endsWith('@lid') ? msg.key.remoteJid : undefined,
                                        notify: msg.pushName ?? undefined,
                                        verifiedName: msg.verifiedBizName ?? undefined,
                                    }]);
                                }
                                if (!(await engine.get(`/chat/${cid}`))) {
                                    const owner: ChatRaw = { id: cid, name: cid.endsWith('@g.us') ? null : msg.pushName ?? null, activity: doc.created_at };
                                    await engine.set(`/chat/${cid}`, serialize(owner), doc.created_at);
                                    this.emit('chat:created', new this.Chat(owner), this);
                                }
                            }
                            await engine.set(`/chat/${cid}/message/${mid}`, serialize(doc), doc.created_at);
                            const owner = deserialize<ChatRaw>(await engine.get(`/chat/${cid}`));
                            if (owner && doc.created_at > (owner.activity ?? 0)) {
                                owner.activity = doc.created_at;
                                await engine.set(`/chat/${cid}`, serialize(owner), doc.created_at);
                            }
                            if (!stored) {
                                const place = msg.message?.locationMessage ?? msg.message?.liveLocationMessage;
                                const poll = msg.message?.pollCreationMessage ?? msg.message?.pollCreationMessageV2 ?? msg.message?.pollCreationMessageV3;
                                const cards = msg.message?.contactsArrayMessage?.contacts ?? (msg.message?.contactMessage ? [msg.message.contactMessage] : []);
                                const body =
                                    doc.type === 'text' ? doc.caption
                                        : doc.type === 'location' ? JSON.stringify({ lat: place?.degreesLatitude, lng: place?.degreesLongitude })
                                            : doc.type === 'poll' ? JSON.stringify({ content: poll?.name ?? '', options: poll?.options?.map((option) => ({ content: option.optionName })) ?? [] })
                                                : doc.type === 'vcard' ? cards.map((card) => card.vcard ?? '').join('\n')
                                                    : doc.type === 'event' ? JSON.stringify(msg.message?.eventMessage ?? {})
                                                        : null;
                                const binary = body !== null
                                    ? Buffer.from(body, 'utf-8')
                                    : ['image', 'video', 'audio', 'document'].includes(doc.type)
                                        ? await downloadMediaMessage(msg, 'buffer', {}).catch(() => Buffer.alloc(0)) as Buffer
                                        : Buffer.alloc(0);
                                if (binary.length > 0) {
                                    await (engine.set_buffer?.(`/chat/${cid}/message/${mid}/content`, binary) ?? engine.set(`/chat/${cid}/message/${mid}/content`, serialize({ data: binary.toString('base64') })));
                                }
                            }
                            const instance = new Message(init, doc);
                            const owner_chat = await instance.chat();
                            this.emit('message:created', instance, owner_chat, this);
                            if (doc.forwarded) {
                                this.emit('message:forwarded', instance, owner_chat, this);
                            }
                        }
                    }).catch(() => { });
                });
                socket.ev.on('messages.update', (updates) => {
                    chain = chain.then(async () => {
                        for (const { key, update } of updates) {
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
                                    const edited = patch.message.editedMessage?.message;
                                    raw.message = edited ?? { ...raw.message, ...patch.message };
                                    doc.edited = doc.edited || Boolean(edited);
                                    doc.caption = new Message(init, raw).caption;
                                    doc.raw = raw;
                                    await engine.set(path, serialize(doc), doc.created_at);
                                    const instance = new Message(init, doc);
                                    this.emit('message:updated', instance, await instance.chat(), this);
                                } else if (patch.starred !== undefined) {
                                    doc.starred = patch.starred === true;
                                    raw.starred = doc.starred;
                                    doc.raw = raw;
                                    await engine.set(path, serialize(doc), doc.created_at);
                                    const instance = new Message(init, doc);
                                    this.emit(doc.starred ? 'message:starred' : 'message:unstarred', instance, await instance.chat(), this);
                                } else if (patch.status !== undefined && (patch.status > doc.status || patch.status === proto.WebMessageInfo.Status.ERROR)) {
                                    raw.status = patch.status;
                                    doc.status = patch.status;
                                    raw.messageStubParameters = patch.messageStubParameters ?? raw.messageStubParameters;
                                    doc.raw = raw;
                                    await engine.set(path, serialize(doc), doc.created_at);
                                    const instance = new Message(init, doc);
                                    this.emit('message:updated', instance, await instance.chat(), this);
                                }
                            }
                        }
                    }).catch(() => { });
                });
                socket.ev.on('message-receipt.update', (updates) => {
                    chain = chain.then(async () => {
                        for (const { key, receipt } of updates) {
                            if (key.remoteJid === 'status@broadcast' && key.id) {
                                const doc = deserialize<FeedRaw>(await engine.get(`/status/${key.id}`));
                                if (doc && !doc.viewed) {
                                    doc.viewed = true;
                                    await engine.set(`/status/${key.id}`, serialize(doc));
                                    this.emit('feed:updated', new Feed(init, doc), this);
                                }
                                continue;
                            }
                            const played = receipt.playedTimestamp != null;
                            const found = (played || receipt.readTimestamp != null) && key.remoteJid && key.id
                                ? await locate(key.remoteJid, key.id)
                                : null;
                            if (found) {
                                const next = played ? proto.WebMessageInfo.Status.PLAYED : proto.WebMessageInfo.Status.READ;
                                if (found.doc.status < next) {
                                    found.doc.status = next;
                                    found.doc.raw.status = next;
                                    await engine.set(found.path, serialize(found.doc), found.doc.created_at);
                                }
                                const instance = new Message(init, found.doc);
                                this.emit('message:seen', instance, await instance.chat(), this);
                            }
                        }
                    }).catch(() => { });
                });
            };
            this.#close = async (quiet: boolean) => {
                intentional = true;
                silent = quiet;
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                try {
                    alive?.end(Object.assign(new Error('intentional close'), { output: { statusCode: DisconnectReason.connectionClosed } }));
                } catch {
                    /* el socket ya estaba cerrado / socket already closed */
                }
                alive = null;
            };

            start().catch(reject);
        });
    }

    /**
     * Cierra la sesión: cancela el reintento pendiente y termina el socket.
     * Closes the session: cancels the pending retry and ends the socket.
     *
     * @param options - `silent` calla el evento `disconnected`; `destroy` vacía el engine / `silent` mutes the `disconnected` event; `destroy` clears the engine
     */
    async disconnect(options: { silent?: boolean; destroy?: boolean } = {}): Promise<void> {
        await this.#close?.(options.silent === true);
        if (options.destroy) {
            await this.engine.clear();
        }
    }
}
