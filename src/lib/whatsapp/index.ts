/**
 * @file whatsapp/index.ts
 * @description Cliente WhatsApp: sesión, emisor de eventos y procesamiento del socket.
 * WhatsApp client: session, event emitter and socket processing.
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
import { bind, resolve_jid, session } from '~/lib/internal';
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

type FeedRaw = ConstructorParameters<typeof Feed>[1];
type MessageRaw = Message['_raw'];
type ChatRaw = Chat['_raw'];
type ContactRaw = Contact['_raw'];
type Tail<P extends unknown[]> = P extends [unknown, unknown, ...infer R] ? R : never;

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
    'contact:created': [InstanceType<ReturnType<typeof contact>>, InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'contact:updated': [InstanceType<ReturnType<typeof contact>>, InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'chat:created': [InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'chat:deleted': [InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'chat:pinned': [InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'chat:unpinned': [InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'chat:archived': [InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'chat:unarchived': [InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'chat:muted': [InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'chat:unmuted': [InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'message:created': [Message, InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'message:updated': [Message, InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'message:deleted': [Message, InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'message:reacted': [Message, InstanceType<ReturnType<typeof chat>>, string, WhatsApp];
    'message:starred': [Message, InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'message:unstarred': [Message, InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'message:forwarded': [Message, InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'message:seen': [Message, InstanceType<ReturnType<typeof chat>>, WhatsApp];
    'feed:created': [Feed, WhatsApp];
    'feed:updated': [Feed, WhatsApp];
    'feed:deleted': [Feed, WhatsApp];
}

/**
 * Cliente principal de WhatsApp. No conecta al instanciar.
 * Main WhatsApp client. Does not connect on instantiation.
 *
 * @example
 * const wa = new WhatsApp({ engine: new FileSystemEngine(__dirname), phone: 5491112345678 });
 * wa.on('message:created', (msg) => console.log(msg.caption));
 * await wa.connect((code) => console.log(code));
 */
export default class WhatsApp {
    #event = new EventEmitter<EventMap>();
    #options: Omit<Options, 'phone' | 'autoclean' | 'sync' | 'reconnect'> & { phone?: string; autoclean: boolean; sync: boolean; reconnect: { max: number | null; interval_ms: number } };
    #close: ((silent: boolean) => Promise<void>) | null = null;

    /** Motor de almacenamiento de la sesión. / Session storage engine. */
    readonly engine: Engine;
    /** Entidad `Contact` ligada a este cliente. / `Contact` entity bound to this client. */
    readonly Contact: ReturnType<typeof contact>;
    /** Entidad `Chat` ligada a este cliente. / `Chat` entity bound to this client. */
    readonly Chat: ReturnType<typeof chat>;
    /** Entidad `Message` ligada a este cliente, con las subclases para `instanceof`. / `Message` entity bound to this client, with the subclasses for `instanceof`. */
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

    constructor(options: Options) {
        this.engine = options.engine;
        this.#options = {
            ...options,
            phone: options.phone !== undefined ? String(options.phone).replace(/\D+/g, '') : undefined,
            autoclean: options.autoclean ?? true,
            sync: options.sync ?? true,
            reconnect:
                options.reconnect === false ? { max: 0, interval_ms: 60_000 }
                    : options.reconnect === undefined || options.reconnect === true ? { max: null, interval_ms: 60_000 }
                        : typeof options.reconnect === 'number' ? { max: options.reconnect, interval_ms: 60_000 }
                            : { max: options.reconnect.max ?? null, interval_ms: (options.reconnect.interval ?? 60) * 1_000 },
        };
        bind(this, null);
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

    /** Contacto de la cuenta autenticada, o null sin sesión abierta. / Authenticated account's contact, or null without an open session. */
    get contact(): InstanceType<ReturnType<typeof contact>> | null {
        const user = session(this)?.user;
        if (user) {
            const jid = jidNormalizedUser(user.id);
            return new this.Contact({ id: jid, phone_number: jid, lid: user.lid ?? null, name: user.name ?? null });
        }
        return null;
    }

    /**
     * Emite un evento del cliente.
     * Emits a client event.
     *
     * @param event - Nombre del evento / Event name
     * @param args - Argumentos del evento / Event arguments
     * @returns true si había listeners / true when listeners were present
     */
    emit<E extends keyof EventMap>(event: E, ...args: EventMap[E]): boolean {
        return this.#event.emit(event, ...(args as never));
    }

    /**
     * Registra un listener.
     * Registers a listener.
     *
     * @param event - Nombre del evento / Event name
     * @param handler - Listener a registrar / Listener to register
     * @returns Función para desuscribirse / Unsubscribe function
     */
    on<E extends keyof EventMap>(event: E, handler: (...args: EventMap[E]) => void): () => void {
        this.#event.on(event, handler as never);
        return () => { this.#event.off(event, handler as never); };
    }

    /**
     * Registra un listener que dispara una sola vez.
     * Registers a listener that fires once.
     *
     * @param event - Nombre del evento / Event name
     * @param handler - Listener a registrar / Listener to register
     * @returns Función para desuscribirse antes de que dispare / Unsubscribe function, before it fires
     */
    once<E extends keyof EventMap>(event: E, handler: (...args: EventMap[E]) => void): () => void {
        this.#event.once(event, handler as never);
        return () => { this.#event.off(event, handler as never); };
    }

    /**
     * Quita un listener registrado.
     * Removes a registered listener.
     *
     * @param event - Nombre del evento / Event name
     * @param handler - Listener a quitar / Listener to remove
     */
    off<E extends keyof EventMap>(event: E, handler: (...args: EventMap[E]) => void): this {
        this.#event.off(event, handler as never);
        return this;
    }

    /**
     * Abre la sesión, guarda en el engine lo que llega del socket y lo reemite como eventos
     * del cliente. Resuelve al sincronizar y reintenta en cierres no-loggedOut.
     * Opens the session, stores whatever arrives from the socket in the engine and re-emits it
     * as client events. Resolves once synced and retries on non-loggedOut closes.
     *
     * @param callback - Recibe el PIN si hay `phone`, o el QR en PNG, en cada refresco / Receives the PIN when `phone` is set, or the PNG QR, on every refresh
     * @throws Logged out cuando la sesión se cierra desde el teléfono / when the session is closed from the phone
     */
    async connect(callback: (auth: string | Buffer) => void | Promise<void>): Promise<void> {
        await this.#close?.(true);
        const { version } = await fetchLatestBaileysVersion();

        let intentional = false;
        let silent = false;
        let connected = false;
        let retries = 0;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let chain: Promise<void> = Promise.resolve();
        const run = (task: () => Promise<void>): void => {
            chain = chain.then(task).catch(() => { });
        };

        const load = async <T>(path: string): Promise<T | null> => deserialize<T>(await this.engine.get(path));
        const save = (path: string, value: unknown, score?: number): Promise<void> => this.engine.set(path, serialize(value), score);
        const keep = (path: string, data: Buffer): Promise<void> =>
            this.engine.set_buffer?.(path, data) ?? this.engine.set(path, serialize({ data: data.toString('base64') }));
        const fire = async (event: 'message:created' | 'message:updated' | 'message:deleted' | 'message:starred' | 'message:unstarred' | 'message:forwarded' | 'message:seen', doc: MessageRaw): Promise<void> => {
            const instance = message(this, doc);
            this.emit(event, instance, await instance.chat(), this);
        };
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
        const keep_contact = async (raw: ContactRaw): Promise<void> => {
            const current = await load<ContactRaw>(`/contact/${raw.id}`);
            const doc: ContactRaw = current
                ? { ...current, ...Object.fromEntries(Object.entries(raw).filter(([, value]) => value != null)) }
                : raw;
            await save(`/contact/${raw.id}`, doc);
            if (doc.lid) {
                await save(`/lid/${doc.lid}`, doc.id);
            }
            if (!current || JSON.stringify(current) !== JSON.stringify(doc)) {
                const person = new this.Contact(doc);
                const owner = await load<ChatRaw>(`/chat/${doc.id}`);
                this.emit(current ? 'contact:updated' : 'contact:created', person, new this.Chat(owner ?? { id: doc.id, name: person.name }), this);
            }
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
                    const current = await load<ChatRaw>(`/chat/${row.id}`);
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
                    const [newest] = await this.engine.list(`/chat/${row.id}/message`, 0, 1);
                    doc.activity = Math.max(
                        row.conversationTimestamp != null ? Number(row.conversationTimestamp) * 1_000 : 0,
                        doc.activity ?? 0,
                        deserialize<MessageRaw>(newest ?? null)?.created_at ?? 0
                    ) || null;
                    await save(`/chat/${row.id}`, doc, doc.activity ?? 0);
                    if (!current) {
                        this.emit('chat:created', new this.Chat(doc), this);
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

                if (kind === 'reactionMessage') {
                    const target = msg.message?.reactionMessage;
                    const found = target?.key?.id && target.key.remoteJid ? await locate(target.key.remoteJid, target.key.id) : null;
                    if (found && target) {
                        const author = jidNormalizedUser((msg.key.fromMe ? session(this)?.user?.id : msg.key.participant ?? cid) ?? cid);
                        const emoji = target.text ?? '';
                        found.doc.reactions = [
                            ...(found.doc.reactions ?? []).filter((entry) => entry.author !== author),
                            ...(emoji ? [{ author, emoji, at: Date.now() }] : []),
                        ];
                        await save(found.path, found.doc, found.doc.created_at);
                        const instance = message(this, found.doc);
                        this.emit('message:reacted', instance, await instance.chat(), emoji, this);
                    }
                    continue;
                }

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
                    await save(`/status/${mid}`, doc);
                    if (binary.length > 0) {
                        await keep(`/status/${mid}/content`, binary);
                    }
                    this.emit('feed:created', new Feed(this, doc), this);
                    continue;
                }

                if (kind === 'pollUpdateMessage') {
                    const key = msg.message?.pollUpdateMessage?.pollCreationMessageKey;
                    const vote = msg.message?.pollUpdateMessage?.vote;
                    const found = key?.id && key.remoteJid ? await locate(key.remoteJid, key.id) : null;
                    const raw_secret = found?.doc.raw.message?.messageContextInfo?.messageSecret;
                    const secret = typeof raw_secret === 'string' ? Buffer.from(raw_secret, 'base64') : raw_secret;
                    if (found && secret && vote?.encPayload && vote.encIv) {
                        const user = session(this)?.user;
                        const mine = [...new Set([(user as { lid?: string })?.lid, user?.id].filter((id): id is string => Boolean(id)))];
                        const theirs = (source: { remoteJid?: string | null; participant?: string | null; remoteJidAlt?: string }): string[] =>
                            [...new Set([source.remoteJid, source.participant, source.remoteJidAlt].filter((id): id is string => Boolean(id)))];
                        const voters = msg.key.fromMe ? mine : theirs(msg.key);
                        const creators = found.doc.raw.key?.fromMe ? mine : theirs(found.doc.raw.key ?? {});
                        for (const voter of voters.flatMap((who) => creators.map((creator) => ({ who, creator })))) {
                            try {
                                updateMessageWithPollUpdate(found.doc.raw, {
                                    pollUpdateMessageKey: msg.key,
                                    vote: decryptPollVote({ encPayload: vote.encPayload, encIv: vote.encIv }, {
                                        pollCreatorJid: jidNormalizedUser(voter.creator),
                                        pollMsgId: found.doc.id,
                                        pollEncKey: secret,
                                        voterJid: jidNormalizedUser(voter.who),
                                    }),
                                    senderTimestampMs: Number(msg.messageTimestamp) || Date.now(),
                                });
                                await save(found.path, found.doc, found.doc.created_at);
                                await fire('message:updated', found.doc);
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
                    doc.multiple = typeof stored.multiple === 'boolean' ? stored.multiple : doc.multiple;
                    doc.reactions = stored.reactions ?? doc.reactions;
                    const advanced = doc.status > stored.status;
                    doc.status = Math.max(stored.status, doc.status);
                    if (!advanced && stored.caption === doc.caption && stored.edited === doc.edited && stored.starred === doc.starred) {
                        continue;
                    }
                }

                if (!stored && !doc.me) {
                    const known = await load<ContactRaw>(`/contact/${doc.author}`);
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
                        const owner: ChatRaw = { id: cid, name: cid.endsWith('@g.us') ? null : msg.pushName ?? null, activity: doc.created_at };
                        await save(`/chat/${cid}`, owner, doc.created_at);
                        this.emit('chat:created', new this.Chat(owner), this);
                    }
                }

                await save(`/chat/${cid}/message/${mid}`, doc, doc.created_at);

                const owner = await load<ChatRaw>(`/chat/${cid}`);
                if (owner && doc.created_at > (owner.activity ?? 0)) {
                    owner.activity = doc.created_at;
                    await save(`/chat/${cid}`, owner, doc.created_at);
                }

                if (!stored) {
                    const location = msg.message?.locationMessage ?? msg.message?.liveLocationMessage;
                    const poll = msg.message?.pollCreationMessage ?? msg.message?.pollCreationMessageV2 ?? msg.message?.pollCreationMessageV3;
                    const cards = msg.message?.contactsArrayMessage?.contacts ?? (msg.message?.contactMessage ? [msg.message.contactMessage] : []);
                    const body =
                        doc.type === 'text' ? doc.caption
                            : doc.type === 'location' ? JSON.stringify({ lat: location?.degreesLatitude, lng: location?.degreesLongitude })
                                : doc.type === 'poll' ? JSON.stringify({ content: poll?.name ?? '', options: poll?.options?.map((option) => ({ content: option.optionName })) ?? [] })
                                    : doc.type === 'vcard' ? cards.map((card) => card.vcard ?? '').join('\n')
                                        : doc.type === 'event' ? JSON.stringify(msg.message?.eventMessage ?? {})
                                            : null;
                    const binary = body !== null
                        ? Buffer.from(body, 'utf-8')
                        : session(this) && ['image', 'video', 'audio', 'document'].includes(doc.type)
                            ? await downloadMediaMessage(msg, 'buffer', {}).catch(() => Buffer.alloc(0)) as Buffer
                            : Buffer.alloc(0);
                    if (binary.length > 0) {
                        await keep(`/chat/${cid}/message/${mid}/content`, binary);
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
                    shouldSyncHistoryMessage: ({ syncType }) => this.#options.sync || syncType !== proto.HistorySync.HistorySyncType.FULL,
                    markOnlineOnConnect: false,
                });
                bind(this, socket);

                socket.ev.on('creds.update', () => this.engine.set('/session/creds', serialize(creds)));

                socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
                    if (qr && !creds.registered) {
                        await callback(
                            this.#options.phone && (this.#options.method ?? 'otp') === 'otp'
                                ? await socket.requestPairingCode(String(this.#options.phone))
                                : await QRCode.toBuffer(qr, { type: 'png', margin: 2 })
                        );
                    }

                    if (connection === 'open') {
                        connected = true;
                        retries = 0;
                        this.emit('connected', this);
                        resolve();
                    } else if (connection === 'close') {
                        bind(this, null);
                        const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
                        const transient = code === DisconnectReason.restartRequired;

                        if (code === DisconnectReason.loggedOut) {
                            await (this.#options.autoclean ? this.engine.clear() : this.engine.unset('/session/creds'));
                        }
                        if (connected && !transient && !silent) {
                            this.emit('disconnected', this);
                        }
                        if (!intentional) {
                            const max = this.#options.reconnect.max;
                            if (code === DisconnectReason.loggedOut) {
                                reject(new Error('Logged out'));
                            } else if (!transient && max !== null && retries >= max) {
                                reject(new Error(`Reconnect attempts exhausted (${max})`));
                            } else {
                                retries += transient ? 0 : 1;
                                timer = setTimeout(() => {
                                    timer = null;
                                    start().catch(reject);
                                }, transient ? 0 : this.#options.reconnect.interval_ms);
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
                        const current = row.id ? await load<ContactRaw>(`/contact/${row.id}`) : null;
                        if (current && row.id) {
                            const patch: Partial<ContactRaw> = {
                                ...(row.notify && { notify: row.notify }),
                                ...(row.name && { name: row.name }),
                                ...(row.verifiedName && { verified_name: row.verifiedName }),
                                ...(typeof row.imgUrl === 'string' && { img_url: row.imgUrl }),
                                ...(row.status && { status: row.status }),
                                ...(row.lid && { lid: row.lid }),
                            };
                            if (Object.keys(patch).length > 0) {
                                const doc = { ...current, ...patch };
                                await save(`/contact/${row.id}`, doc);
                                if (patch.lid) {
                                    await save(`/lid/${patch.lid}`, row.id);
                                }
                                const person = new this.Contact(doc);
                                const owner = await load<ChatRaw>(`/chat/${row.id}`);
                                this.emit('contact:updated', person, new this.Chat(owner ?? { id: row.id, name: person.name }), this);
                            }
                        }
                    }
                }));

                socket.ev.on('chats.update', (rows) => run(async () => {
                    for (const row of rows) {
                        if (row.id && row.id !== 'status@broadcast') {
                            const current = (await load<ChatRaw>(`/chat/${row.id}`)) ?? { id: row.id, name: row.name ?? null };
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
                                await save(`/chat/${row.id}`, doc, doc.activity ?? undefined);
                                for (const event of events) {
                                    this.emit(event, new this.Chat(doc), this);
                                }
                            }
                        }
                    }
                }));

                socket.ev.on('chats.delete', (ids) => run(async () => {
                    for (const cid of ids) {
                        const doc = (await load<ChatRaw>(`/chat/${cid}`)) ?? { id: cid };
                        await this.engine.unset(`/chat/${cid}`);
                        this.emit('chat:deleted', new this.Chat(doc), this);
                    }
                }));

                socket.ev.on('messages.update', (updates) => run(async () => {
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
                            } else if (patch.status !== undefined && (patch.status > doc.status || patch.status === proto.WebMessageInfo.Status.ERROR)) {
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
                        const played = receipt.playedTimestamp != null;
                        const found = (played || receipt.readTimestamp != null) && key.remoteJid && key.id
                            ? await locate(key.remoteJid, key.id)
                            : null;
                        if (found) {
                            const next = played ? proto.WebMessageInfo.Status.PLAYED : proto.WebMessageInfo.Status.READ;
                            if (found.doc.status < next) {
                                found.doc.status = next;
                                found.doc.raw.status = next;
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
                const live = session(this);
                if (live) {
                    await live.end(Object.assign(new Error('intentional close'), {
                        output: { statusCode: DisconnectReason.connectionClosed },
                    })).catch(() => { });
                    bind(this, null);
                }
            };

            start().catch(reject);
        });
    }

    /**
     * Actualiza el perfil de la cuenta: sólo se envía lo que llega en el parche.
     * Updates the account profile: only the given fields are sent.
     *
     * @param patch - Nombre público, bio y/o foto; `photo: null` la elimina / Public name, bio and/or picture; `photo: null` removes it
     * @returns true si había sesión para enviarlo / true when there was a session to send it
     * @throws ERR_PROFILE_PICTURE_LIB si falta `sharp` o `jimp` / when `sharp` or `jimp` is missing
     */
    async profile(patch: { name?: string; content?: string; photo?: string | Buffer | null }): Promise<boolean> {
        const socket = session(this);
        if (!socket) {
            return false;
        }
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
            await socket
                .updateProfilePicture(self, typeof patch.photo === 'string' ? { url: patch.photo } : patch.photo)
                .catch((error: Error) => {
                    throw /image processing library/i.test(error.message) ? new Error('ERR_PROFILE_PICTURE_LIB') : error;
                });
        }
        return true;
    }

    /**
     * Publica un estado: con sólo `caption` es texto, con `content` es imagen o video.
     * Publishes a status: with only `caption` it is text, with `content` an image or video.
     *
     * @param post - Contenido, pie y audiencia; WhatsApp no reparte el estado fuera de ella / Content, caption and audience; WhatsApp delivers it to nobody outside it
     * @returns Publicación creada, o null sin sesión / Created post, or null without a session
     * @throws ERR_FEED_EMPTY sin `content` ni `caption` / when neither is given
     * @throws ERR_FEED_MEDIA si el binario no es imagen ni video / when the binary is neither image nor video
     */
    async feed(post: { content?: Buffer; caption?: string; contacts: (string | number)[] }): Promise<Feed | null> {
        const socket = session(this);
        if (!socket) {
            return null;
        }
        const head = post.content?.subarray(0, 12);
        const mime = !head ? null
            : head.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'image/jpeg'
                : head.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'image/png'
                    : head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP' ? 'image/webp'
                        : head.subarray(4, 8).toString() === 'ftyp' ? 'video/mp4'
                            : null;
        if (post.content && !mime) {
            throw new Error('ERR_FEED_MEDIA');
        }
        if (!post.content && !post.caption) {
            throw new Error('ERR_FEED_EMPTY');
        }
        const type = mime?.startsWith('video/') ? 'video' : mime ? 'image' : 'text';
        const audience = (await Promise.all(post.contacts.map((uid) => resolve_jid(this, String(uid))))).filter((jid): jid is string => jid !== null);
        const sent = await socket.sendMessage(
            'status@broadcast',
            (post.content ? { [type]: post.content, caption: post.caption } : { text: post.caption }) as never,
            { statusJidList: audience }
        );
        if (!sent?.key?.id) {
            return null;
        }
        const created_at = (Number(sent.messageTimestamp) || Math.floor(Date.now() / 1_000)) * 1_000;
        const doc: FeedRaw = {
            id: sent.key.id,
            author_jid: jidNormalizedUser(socket.user?.id ?? ''),
            type,
            caption: post.caption ?? '',
            mime: mime ?? 'text/plain',
            created_at,
            expires_at: created_at + FEED_TTL_MS,
            viewed: true,
            raw: sent,
        };
        await this.engine.set(`/status/${doc.id}`, serialize(doc), created_at);
        if (post.content) {
            await (this.engine.set_buffer?.(`/status/${doc.id}/content`, post.content)
                ?? this.engine.set(`/status/${doc.id}/content`, serialize({ data: post.content.toString('base64') })));
        }
        const result = new Feed(this, doc);
        this.emit('feed:created', result, this);
        return result;
    }

    /**
     * Cierra la conexión.
     * Closes the connection.
     *
     * @param options - `silent` calla el evento del cierre; `destroy` vacía el engine / `silent` mutes the close event; `destroy` clears the engine
     */
    async disconnect(options: { silent?: boolean; destroy?: boolean } = {}): Promise<void> {
        await this.#close?.(options.silent === true);
        if (options.destroy) {
            await this.engine.clear();
        }
    }
}
