/**
 * @file whatsapp/index.ts
 * @description Cliente WhatsApp: abre la sesión de baileys, publica las entidades ligadas a ella y
 * guarda cada evento tal como llega.
 * WhatsApp client: opens the baileys session, publishes the entities bound to it and stores every
 * event as it arrives.
 */

import {
    Browsers,
    DisconnectReason,
    downloadMediaMessage,
    fetchLatestBaileysVersion,
    getContentType,
    initAuthCreds,
    jidNormalizedUser,
    makeWASocket,
    normalizeMessageContent,
    proto,
    toNumber,
    type AuthenticationCreds,
    type Chat as ChatRaw,
    type Contact as ContactRaw,
    type SignalDataTypeMap,
    type WAMessage,
    type WAMessageKey,
    type WASocket,
} from 'baileys';
import { EventEmitter } from 'node:events';
import pino from 'pino';
import QRCode from 'qrcode';
import catalog, { product, type Catalog } from '~/lib/catalog';
import chat, { type Chat } from '~/lib/chat';
import contact, { type Contact } from '~/lib/contact';
import message, { type Message, type Raw } from '~/lib/message';
import feed, { type Feed } from '~/lib/feed';
import { internal } from '~/lib/sender';
import { append, deliver, delivery, deserialize, jid_of, serialize, type Engine } from '~/lib/store';

/**
 * Cola por ruta para las escrituras de sesión: baileys escribe la misma llave en paralelo y un
 * estado viejo que aterriza después del nuevo hace que WhatsApp cierre la sesión en el handshake.
 * Per-path queue for session writes: baileys writes the same key in parallel and an old state
 * landing after the new one makes WhatsApp close the session at the handshake.
 *
 * @param locks - Última escritura en vuelo por ruta / Last in-flight write per path
 * @param path - Ruta de la llave / Key path
 * @param work - Escritura a encolar / Write to enqueue
 */
const queued = (locks: Map<string, Promise<unknown>>, path: string, work: () => Promise<unknown>) => {
    const next = (locks.get(path) ?? Promise.resolve()).then(work, work);
    const settled = next.catch(() => null);
    locks.set(path, settled);
    void settled.then(() => locks.get(path) === settled && locks.delete(path));
    return next;
};

/** @param value - Nombre de la cuenta; WhatsApp lo enmascara («+58∙∙∙∙40») cuando el perfil no viajó / Account name; WhatsApp masks it («+58∙∙∙∙40») when the profile did not travel */
const readable = (value: string | null | undefined) => (value && /[^\d\s+·•∙⋅]/.test(value) ? value : null);

/** @param ids - Identificadores candidatos / Candidate identifiers */
const pn = (...ids: (string | null | undefined)[]) => ids.find((id): id is string => Boolean(id?.endsWith('@s.whatsapp.net')));

/** Lo que hace alguien al otro lado. / What someone on the other end is doing. */
export type Presence = 'online' | 'offline' | 'typing' | 'recording';

/** Sobre de cada aviso de `sub()`: qué pasó y a quién, ya resuelto. / Envelope of every `sub()` notice: what happened and to whom, already resolved. */
export interface WatchEvent<N extends string, P> {
    name: N;
    payload: P;
}

/** Sesión que liga cada entidad: el cliente, su motor y el socket vivo. / Session binding every entity: the client, its engine and the live socket. */
export type Instance = { wa: WhatsApp; engine: Engine; socket: WASocket };




interface Options {
    /** Motor de almacenamiento. / Storage engine. */
    engine: Engine;
    /** Teléfono de la cuenta: habilita el PIN; sin él la vinculación es por QR. / Account phone: enables the PIN; without it linking is by QR. */
    phone?: number | string;
    /** Canal de vinculación cuando hay `phone`. / Linking channel when `phone` is set. */
    method?: 'qr' | 'otp';
    /** Vaciar el engine al recibir `loggedOut`; con `false` sólo borra las credenciales. / Clear the engine on `loggedOut`; with `false` it only drops the credentials. */
    autoclean?: boolean;
    /** Reintentos tras un cierre: `true` infinitos, un número como tope, o `{ max, interval }` en segundos. / Retries after a close: `true` endless, a number as cap, or `{ max, interval }` in seconds. */
    reconnect?: boolean | number | { max?: number; interval?: number };
    /** Descargar el historial de mensajes al vincular; `false` por defecto. / Download the message history on link; `false` by default. */
    sync?: boolean;
    /** Nombre de la sesión en «Dispositivos vinculados»; `Chrome` por defecto. / Session name under «Linked devices»; `Chrome` by default. */
    device?: string;
    /** Nivel del log de baileys; `silent` por defecto. / Baileys log level; `silent` by default. */
    debug?: 'silent' | 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}

/** Por qué se cerró la sesión. / Why the session closed. */
export interface Farewell {
    /** Código de baileys, si vino. / Baileys status code, if any. */
    code: number | null;
    /** Nombre del motivo (`loggedOut`, `connectionReplaced`…) o `unknown`. / Reason name (`loggedOut`, `connectionReplaced`…) or `unknown`. */
    reason: string;
    /** El teléfono desvinculó la sesión: no se reintenta. / The phone unlinked the session: no retry. */
    expired: boolean;
    /** Mensaje del error subyacente, si lo hubo. / Underlying error message, if any. */
    detail: string | null;
}

interface EventMap {
    connected: [WhatsApp];
    disconnected: [WhatsApp, Farewell];
    error: [Error & { code?: string }, WhatsApp];
    'contact:created': [Contact, Chat, WhatsApp];
    'contact:updated': [Contact, Chat, WhatsApp];
    'contact:deleted': [Contact, WhatsApp];
    'contact:presence': [Contact, Presence, WhatsApp];
    'chat:created': [Chat, WhatsApp];
    'chat:deleted': [Chat, WhatsApp];
    'chat:pinned': [Chat, WhatsApp];
    'chat:unpinned': [Chat, WhatsApp];
    'chat:archived': [Chat, WhatsApp];
    'chat:unarchived': [Chat, WhatsApp];
    'chat:muted': [Chat, WhatsApp];
    'chat:unmuted': [Chat, WhatsApp];
    'chat:updated': [Chat, WhatsApp];
    'chat:joined': [Chat, Contact[], WhatsApp];
    'chat:left': [Chat, Contact[], WhatsApp];
    'chat:promoted': [Chat, Contact[], WhatsApp];
    'chat:demoted': [Chat, Contact[], WhatsApp];
    'message:created': [Message, Chat, WhatsApp];
    'message:updated': [Message, Chat, WhatsApp];
    'message:deleted': [Message, Chat, WhatsApp];
    'message:reacted': [Message, Chat, string, Contact, WhatsApp];
    'message:starred': [Message, Chat, WhatsApp];
    'message:unstarred': [Message, Chat, WhatsApp];
    'message:forwarded': [Message, Chat, WhatsApp];
    'message:seen': [Message, Chat, WhatsApp];
    'feed:created': [Feed, WhatsApp];
    'feed:updated': [Feed, WhatsApp];
    'feed:deleted': [Feed, WhatsApp];
    'catalog:updated': [Catalog, WhatsApp];
}

export default class WhatsApp {
    #event = new EventEmitter<EventMap>();
    #options: Options;
    /** Cuelga el socket sin desvincular: lo que hace falta al reconectar. / Hangs up the socket without unlinking: what reconnecting needs. */
    #close: ((silent: boolean) => Promise<void>) | null = null;
    /** Desvincula del teléfono y termina el socket. / Unlinks from the phone and ends the socket. */
    #unlink: ((silent: boolean) => Promise<void>) | null = null;

    readonly engine: Engine;
    /** Sesión que comparten las entidades; cada conexión le deja su socket. / Session shared by the entities; every connection leaves its socket there. */
    #instance: Instance;
    /** Entidades ligadas a la sesión, publicadas en la primera conexión. / Session-bound entities, published on the first connection. */
    Contact!: ReturnType<typeof contact>;
    Chat!: ReturnType<typeof chat>;
    Message!: ReturnType<typeof message>;
    Feed!: ReturnType<typeof feed>;
    Catalog!: ReturnType<typeof catalog>;
    Product!: ReturnType<typeof product>;

    /** @param options - Engine, vinculación, reconexión e historial / Engine, linking, reconnection and history */
    constructor(options: Options) {
        this.engine = options.engine;
        this.#options = options;
        this.#instance = { wa: this, engine: options.engine, socket: undefined as never };
    }

    /**
     * El contacto propio, con el nombre público de la sesión; null mientras no hay sesión.
     * The own contact, with the session's public name; null while there is no session.
     */
    async me(): Promise<Contact | null> {
        const user = this.#instance.socket?.user;
        const id = user ? jidNormalizedUser(user.id) : null;
        if (user === undefined || id === null) return null;
        const [card, alias] = await Promise.all([
            this.engine.get(`/contact/${id}`).then((raw) => deserialize<ContactRaw>(raw)),
            user.lid ? this.engine.get(`/contact/${jidNormalizedUser(user.lid)}`).then((raw) => deserialize<ContactRaw>(raw)) : null,
        ]);
        return new this.Contact({ ...alias, ...card, id, lid: user.lid ?? card?.lid ?? alias?.lid, phoneNumber: id, name: readable(user.name) ?? readable(card?.name) ?? readable(alias?.name) ?? card?.verifiedName ?? alias?.verifiedName ?? undefined });
    }

    emit<E extends keyof EventMap>(event: E, ...args: EventMap[E]): boolean {
        return this.#event.emit(event, ...(args as never));
    }

    on<E extends keyof EventMap>(event: E, handler: (...args: EventMap[E]) => void): () => void {
        this.#event.on(event, handler as never);
        return () => this.#event.off(event, handler as never);
    }

    once<E extends keyof EventMap>(event: E, handler: (...args: EventMap[E]) => void): () => void {
        this.#event.once(event, handler as never);
        return () => this.#event.off(event, handler as never);
    }

    off<E extends keyof EventMap>(event: E, handler: (...args: EventMap[E]) => void): this {
        this.#event.off(event, handler as never);
        return this;
    }

    /**
     * Abre la sesión y resuelve al quedar conectada. Mientras no está vinculada, la serie de QR que
     * vence abre otra al instante y el PIN se sigue renovando con el mismo código.
     * Opens the session and resolves once connected. While unlinked, a QR series that expires opens
     * another right away and the PIN keeps being renewed with the same code.
     *
     * @param callback - Recibe el QR como PNG o el PIN como texto / Receives the QR as a PNG or the PIN as text
     */
    async connect(callback: (auth: string | Buffer) => void | Promise<void>): Promise<void> {
        const { engine } = this;
        const { phone, method, autoclean = true, sync = false, reconnect = true, device, debug } = this.#options;
        const digits = String(phone ?? '').replace(/\D+/g, '');
        const budget = reconnect === false ? 0 : reconnect === true ? null : typeof reconnect === 'number' ? reconnect : (reconnect.max ?? null);
        const wait = (typeof reconnect === 'object' ? (reconnect.interval ?? 60) : 60) * 1_000;
        const locks = new Map<string, Promise<unknown>>();
        const state = { connected: false, retries: 0, intentional: false, silent: false, paired: false, cycles: 0 };
        let alive: ReturnType<typeof makeWASocket> | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let chain: Promise<unknown> = Promise.resolve();
        await this.#close?.(true);
        const { version } = await fetchLatestBaileysVersion();

        return new Promise<void>((resolve, reject) => {
            const start = async (): Promise<void> => {
                const stored = deserialize<AuthenticationCreds>(await engine.get('/session/creds')) ?? initAuthCreds();
                const creds: AuthenticationCreds = stored.account ? stored : { ...stored, me: undefined };
                Object.assign(state, { paired: false, cycles: 0 });
                const socket = makeWASocket({
                    version,
                    auth: {
                        creds,
                        keys: {
                            get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => Object.fromEntries(
                                (await Promise.all(ids.map(async (id) => [id, deserialize<SignalDataTypeMap[T]>(await engine.get(`/session/${type}/${id}`))] as const)))
                                    .filter(([, value]) => value !== null)
                                    .map(([id, value]) => [id, type === 'app-state-sync-key' ? proto.Message.AppStateSyncKeyData.fromObject(value as never) : value])
                            ) as { [id: string]: SignalDataTypeMap[T] },
                            set: async (data: Record<string, Record<string, unknown | null>>) => {
                                await Promise.all(Object.entries(data).flatMap(([category, entries]) => Object.entries(entries).map(([id, value]) => {
                                    const path = `/session/${category}/${id}`;
                                    return queued(locks, path, () => (value != null ? engine.set(path, serialize(value)) : engine.unset(path)));
                                })));
                            },
                        },
                    },
                    browser: Browsers.windows(device ?? 'Chrome'),
                    logger: pino({ level: debug ?? 'silent' }),
                    syncFullHistory: sync,
                    shouldSyncHistoryMessage: ({ syncType }) => sync || syncType !== proto.HistorySync.HistorySyncType.FULL,
                    getMessage: async (key) => (key.remoteJid && key.id ? ((await locate(key.remoteJid, key.id))?.timeline[0] as WAMessage | undefined)?.message : null) ?? undefined,
                    markOnlineOnConnect: false,
                });
                const init = Object.assign(this.#instance, { socket });
                alive = socket;
                this.Contact ??= contact(init);
                this.Chat ??= chat(init);
                this.Message ??= message(init);
                this.Feed ??= feed(init);
                this.Catalog ??= catalog(init);
                this.Product ??= product(init);

                const canonical = async (uid: string) => (uid.endsWith('@lid') ? await jid_of(engine, uid, socket).catch(() => null) : null) ?? uid;
                const locate = async (cid: string, mid: string) => {
                    const candidates = [...new Set([await jid_of(engine, cid, socket).catch(() => null), jidNormalizedUser(cid)])].filter((id): id is string => Boolean(id));
                    const found = (await Promise.all(candidates.map(async (id) => ({ path: `/chat/${id}/message/${mid}`, timeline: deserialize<Raw[]>(await engine.get(`/chat/${id}/message/${mid}`)) }))))
                        .find((entry) => entry.timeline?.length);
                    return found ? { path: found.path, timeline: found.timeline! } : null;
                };
                const remember = async (lid: string | null | undefined, jid: string) => {
                    if (lid && jid.endsWith('@s.whatsapp.net')) {
                        await Promise.all([
                            engine.set(`/lid/${jidNormalizedUser(lid)}`, serialize(jidNormalizedUser(jid))),
                            engine.set(`/lid/${jidNormalizedUser(jid)}`, serialize(jidNormalizedUser(lid))),
                        ]);
                    }
                };
                const patch = async <T extends { id?: string | null; conversationTimestamp?: Parameters<typeof toNumber>[0] }>(path: string, row: Partial<T>, create: boolean) => {
                    const current = deserialize<T>(await engine.get(path));
                    const doc = { ...current, ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && typeof value !== 'function')), ...(current?.id && { id: current.id }) } as T & { id: string };
                    const changed = Boolean(current || create) && serialize(current) !== serialize(doc);
                    const orphan = /^\/(contact|chat)\/[^/]+@lid$/.test(path) && pn((doc as ContactRaw).phoneNumber, (doc as ChatRaw).pnJid) === undefined;
                    if (changed) await engine.set(path, serialize(doc), toNumber(doc.conversationTimestamp) * 1_000 || undefined);
                    if (changed && orphan) await mark('/unmapped', doc.id, true);
                    return { current, doc, changed };
                };
                /**
                 * Índices del engine, como los que WhatsApp Web lleva en memoria en vez de recorrer los
                 * chats: `/pinned`, los chats fijados, y `/unmapped`, las fichas y chats guardados bajo un
                 * LID sin teléfono. Sólo se actualiza un índice que ya existe: la conexión arma el que falta.
                 * Engine indexes, like the ones WhatsApp Web keeps in memory instead of walking the chats:
                 * `/pinned`, the pinned chats, and `/unmapped`, the cards and chats stored under a LID
                 * without a phone. Only an existing index is updated: the connection builds a missing one.
                 */
                const mark = async (path: '/pinned' | '/unmapped', jid: string, value: boolean) => {
                    const list = deserialize<string[]>(await engine.get(path));
                    const next = list && (value ? [...new Set([...list, jid])] : list.filter((id) => id !== jid));
                    if (list && next && next.length !== list.length) await engine.set(path, serialize(next));
                };
                const move = async (from: string, to: string, value: string | null, score?: number) => {
                    const [binary, legacy, meta] = await Promise.all([engine.get_buffer?.(`${from}/content`), engine.get(`${from}/content`), engine.get(`${from}/metadata`)]);
                    await Promise.all([
                        value !== null && engine.set(to, value, score),
                        binary && engine.set_buffer?.(`${to}/content`, binary),
                        legacy !== null && engine.set(`${to}/content`, legacy),
                        meta !== null && engine.set(`${to}/metadata`, meta),
                    ]);
                    await engine.unset(from);
                };
                const card = async (uid: string) => {
                    const id = await canonical(uid);
                    return new this.Contact(deserialize(await engine.get(`/contact/${id}`)) ?? { id });
                };
                const room = async (cid: string) => new this.Chat(deserialize(await engine.get(`/chat/${cid}`)) ?? { id: cid });
                const people = (ids: (string | null | undefined)[]) => Promise.all(ids.filter((id): id is string => Boolean(id)).map(card));

                /**
                 * Vuelca sobre el teléfono lo guardado bajo el LID —ficha, chat y mensajes con su binario
                 * y su metadata— y borra el duplicado; lo que ya tenía el teléfono manda.
                 * Pours whatever was stored under the LID —card, chat and messages with their binary and
                 * metadata— onto the phone and drops the duplicate; what the phone already had wins.
                 */
                const absorb = async (lid: string, phone: string) => {
                    const [from, to] = [jidNormalizedUser(lid), jidNormalizedUser(phone)];
                    const [stale, target, orphan, owner] = from !== to
                        ? await Promise.all([`/contact/${from}`, `/contact/${to}`, `/chat/${from}`, `/chat/${to}`].map((path) => engine.get(path)))
                        : [null, null, null, null];
                    if (stale !== null) {
                        await move(`/contact/${from}`, `/contact/${to}`, serialize({ ...deserialize<ContactRaw>(stale), ...deserialize<ContactRaw>(target), lid: from, phoneNumber: to }));
                        this.emit('contact:deleted', new this.Contact(deserialize<ContactRaw>(stale)!), this);
                    }
                    if (orphan !== null) {
                        for (const raw of await engine.list(`/chat/${from}/message`, 0, 100_000)) {
                            const timeline = deserialize<Raw[]>(raw) ?? [];
                            const origin = timeline[0] as WAMessage | undefined;
                            if (origin?.key.id) await move(`/chat/${from}/message/${origin.key.id}`, `/chat/${to}/message/${origin.key.id}`, serialize([...timeline, { lid, pn: phone }]), toNumber(origin.messageTimestamp) * 1_000);
                        }
                        const [previous, current] = [deserialize<ChatRaw & { id: string }>(orphan)!, deserialize<ChatRaw & { id: string }>(owner)];
                        const doc = { ...previous, ...current, id: current?.id ?? previous.id, pnJid: to, conversationTimestamp: Math.max(toNumber(previous.conversationTimestamp), toNumber(current?.conversationTimestamp)) };
                        await move(`/chat/${from}`, `/chat/${to}`, serialize(doc), doc.conversationTimestamp * 1_000 || undefined);
                        await mark('/pinned', from, false);
                        if (toNumber(doc.pinned)) await mark('/pinned', to, true);
                        this.emit('chat:deleted', new this.Chat(previous), this);
                        if (current === null) this.emit('chat:created', new this.Chat(doc), this);
                    }
                };

                /** Lleva el nombre público propio a la ficha propia: baileys lo guarda en las credenciales y no emite `contacts.update` para uno mismo. / Carries the own public name to the own card: baileys keeps it in the credentials and emits no `contacts.update` for oneself. */
                const mirror = () => {
                    const name = readable(creds.me?.name);
                    if (creds.me && name) socket.ev.emit('contacts.upsert', [{ id: jidNormalizedUser(creds.me.id), lid: creds.me.lid ? jidNormalizedUser(creds.me.lid) : undefined, notify: name }]);
                };
                socket.ev.on('creds.update', (update) => {
                    if (update.me) mirror();
                    return queued(locks, '/session/creds', () => engine.set('/session/creds', serialize(creds)));
                });
                socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
                    const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
                    const pairing = creds.account === undefined;
                    const transient = code === DisconnectReason.restartRequired || (pairing && code === DisconnectReason.timedOut);
                    if (qr && pairing) {
                        state.cycles = state.paired ? state.cycles + 1 : 0;
                        const renew = state.paired ? state.cycles >= 3 : true;
                        if (digits && (method ?? 'otp') === 'otp') {
                            if (renew && state.paired && budget !== null && state.retries >= budget) this.emit('error', Object.assign(new Error('El código de vinculación expiró'), { code: 'ERR_OTP_EXPIRED' }), this);
                            else if (renew) {
                                state.retries += state.paired ? 1 : 0;
                                state.cycles = 0;
                                state.paired = true;
                                await callback(await socket.requestPairingCode(digits, creds.pairingCode ?? undefined));
                            }
                        } else await callback(await QRCode.toBuffer(qr, { type: 'png', margin: 2 }));
                    }
                    if (connection === 'open') {
                        state.connected = true;
                        state.retries = 0;
                        mirror();
                        chain = chain.then(async () => {
                            const blocked = await socket.fetchBlocklist().catch(() => null);
                            if (blocked) await engine.set('/blocklist', serialize(blocked.filter((jid): jid is string => Boolean(jid)).map((jid) => jidNormalizedUser(jid))));
                            const [unmapped, pinned] = await Promise.all(['/unmapped', '/pinned'].map(async (path) => deserialize<string[]>(await engine.get(path))));
                            const docs = unmapped && pinned ? [] : (await Promise.all(['/contact', '/chat'].map((path) => engine.list(path, 0, 100_000)))).flat()
                                .map((raw) => deserialize<{ id?: string; phoneNumber?: string; pnJid?: string; pinned?: Parameters<typeof toNumber>[0] }>(raw));
                            const lids = unmapped ?? [...new Set(docs.flatMap((doc) => (doc?.id?.endsWith('@lid') && pn(doc.phoneNumber, doc.pnJid) === undefined ? [doc.id] : [])))];
                            const mapped = new Map<string, string>();
                            for (const lid of lids) {
                                const jid = await jid_of(engine, lid, socket).catch(() => null);
                                if (jid) await absorb(lid, jid).then(() => mapped.set(lid, jid));
                            }
                            await engine.set('/unmapped', serialize(lids.filter((lid) => mapped.has(lid) === false)));
                            if (pinned === null) await engine.set('/pinned', serialize([...new Set(docs.flatMap((doc) => (doc?.id && toNumber(doc.pinned) ? [jidNormalizedUser(mapped.get(doc.id) ?? pn(doc.id, doc.pnJid) ?? doc.id)] : [])))]));
                        }).catch(() => null);
                        this.emit('connected', this);
                        resolve();
                    }
                    if (connection === 'close') {
                        const farewell: Farewell = {
                            code: code ?? null,
                            reason: Object.entries(DisconnectReason).find(([, value]) => value === code)?.[0] ?? 'unknown',
                            expired: code === DisconnectReason.loggedOut,
                            detail: lastDisconnect?.error instanceof Error ? lastDisconnect.error.message : null,
                        };
                        if (farewell.expired) {
                            await Promise.allSettled([...locks.values()]);
                            locks.clear();
                            await (autoclean ? engine.clear() : engine.unset('/session/creds'));
                        }
                        if (state.connected && transient === false && state.silent === false) this.emit('disconnected', this, farewell);
                        switch (state.intentional ? 'stop' : farewell.expired ? 'expired' : transient === false && budget !== null && state.retries >= budget ? 'exhausted' : 'retry') {
                            case 'expired':
                                reject(new Error('Logged out'));
                                break;
                            case 'exhausted':
                                reject(new Error(`Reconnect attempts exhausted (${budget})`));
                                break;
                            case 'retry':
                                state.retries += transient ? 0 : 1;
                                timer = setTimeout(() => {
                                    timer = null;
                                    start().catch(reject);
                                }, transient ? 0 : wait);
                                break;
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
                            const id = await canonical(row.id);
                            const lid = row.lid ?? (row.id.endsWith('@lid') ? row.id : undefined);
                            const { current, doc, changed } = await patch<ContactRaw>(`/contact/${id}`, { ...row, lid, phoneNumber: pn(id, row.phoneNumber) }, true);
                            if (changed) {
                                await remember(doc.lid, id);
                                this.emit(current ? 'contact:updated' : 'contact:created', new this.Contact(doc), await room(id), this);
                            }
                        }
                    }).catch(() => null);
                });
                socket.ev.on('contacts.update', (rows) => {
                    chain = chain.then(async () => {
                        for (const row of rows) {
                            const id = row.id ? await canonical(row.id) : '';
                            const lid = row.lid ?? (row.id?.endsWith('@lid') ? row.id : undefined);
                            const { doc, changed } = id ? await patch<ContactRaw>(`/contact/${id}`, { ...row, lid }, false) : { doc: null, changed: false };
                            if (doc && changed) {
                                await remember(doc.lid, id);
                                this.emit('contact:updated', new this.Contact(doc), await room(id), this);
                            }
                        }
                    }).catch(() => null);
                });
                socket.ev.on('presence.update', ({ id, presences }) => {
                    chain = chain.then(async () => {
                        for (const [participant, data] of Object.entries(presences)) {
                            const found = ({ available: 'online', unavailable: 'offline', composing: 'typing', recording: 'recording', paused: 'online' } as Record<string, Presence | undefined>)[data.lastKnownPresence];
                            const who = found ? await canonical(participant || id) : '';
                            if (found && who) await patch<ContactRaw & { lastSeen?: number; presence?: Presence }>(`/contact/${who}`, { presence: found, lastSeen: data.lastSeen ?? undefined }, false);
                            if (found && who) this.emit('contact:presence', await card(who), found, this);
                        }
                    }).catch(() => null);
                });
                socket.ev.on('blocklist.update', ({ blocklist, type }) => {
                    chain = chain.then(async () => {
                        const current = new Set(deserialize<string[]>(await engine.get('/blocklist')) ?? []);
                        blocklist.map((jid) => jidNormalizedUser(jid)).forEach((jid) => (type === 'add' ? current.add(jid) : current.delete(jid)));
                        await engine.set('/blocklist', serialize([...current]));
                    }).catch(() => null);
                });
                socket.ev.on('lid-mapping.update', ({ lid, pn: phone }) => {
                    chain = chain.then(() => remember(lid, phone).then(() => absorb(lid, phone))).catch(() => null);
                });
                socket.ev.on('groups.upsert', (rows) => {
                    chain = chain.then(async () => {
                        for (const row of rows) {
                            const { current, doc, changed } = await patch<ChatRaw>(`/chat/${row.id}`, { id: row.id, name: row.subject || undefined, description: row.desc }, true);
                            if (changed) this.emit(current ? 'chat:updated' : 'chat:created', new this.Chat(doc), this);
                        }
                    }).catch(() => null);
                });
                socket.ev.on('groups.update', (rows) => {
                    chain = chain.then(async () => {
                        for (const row of rows) {
                            const { doc, changed } = row.id ? await patch<ChatRaw>(`/chat/${row.id}`, { id: row.id, name: row.subject || undefined, description: row.desc }, true) : { doc: null, changed: false };
                            if (doc && changed) this.emit('chat:updated', new this.Chat(doc), this);
                        }
                    }).catch(() => null);
                });
                socket.ev.on('group-participants.update', ({ id, participants, action }) => {
                    chain = chain.then(async () => {
                        const event = ({ add: 'chat:joined', remove: 'chat:left', promote: 'chat:promoted', demote: 'chat:demoted' } as const)[action as 'add'];
                        if (event) this.emit(event, await room(id), await people(participants.map((participant) => participant.phoneNumber ?? participant.id)), this);
                    }).catch(() => null);
                });
                socket.ev.on('chats.upsert', (rows) => {
                    chain = chain.then(async () => {
                        for (const { messages, ...raw } of rows) {
                            const id = await canonical(pn(raw.id, raw.pnJid) ?? raw.id ?? '');
                            const [newest] = await this.Message.list(id, 0, 1);
                            const current = deserialize<ChatRaw>(await engine.get(`/chat/${id}`));
                            const at = Math.max(toNumber(raw.conversationTimestamp), toNumber(current?.conversationTimestamp), newest ? Date.parse(newest.created_at) / 1_000 : 0);
                            const { doc, changed } = await patch<ChatRaw>(`/chat/${id}`, { ...raw, pnJid: pn(id, raw.pnJid), conversationTimestamp: at || undefined }, true);
                            if ('pinned' in raw) await mark('/pinned', id, Boolean(toNumber(raw.pinned)));
                            if (changed && current === null) this.emit('chat:created', new this.Chat(doc), this);
                        }
                    }).catch(() => null);
                });
                socket.ev.on('chats.update', (rows) => {
                    chain = chain.then(async () => {
                        for (const { messages, ...row } of rows) {
                            const id = row.id && row.id !== 'status@broadcast' ? await canonical(row.id) : null;
                            const current = id ? deserialize<ChatRaw>(await engine.get(`/chat/${id}`)) : null;
                            const at = Math.max(toNumber(row.conversationTimestamp), toNumber(current?.conversationTimestamp));
                            const unread = typeof row.unreadCount === 'number' && row.unreadCount > 0 ? Math.max(current?.unreadCount ?? 0, 0) + row.unreadCount : row.unreadCount;
                            const { doc, changed } = id ? await patch<ChatRaw>(`/chat/${id}`, { ...row, pnJid: pn(id, row.pnJid), unreadCount: unread, conversationTimestamp: at || undefined }, true) : { doc: null, changed: false };
                            if (id && 'pinned' in row) await mark('/pinned', id, Boolean(toNumber(row.pinned)));
                            if (doc && changed) {
                                const muted = toNumber(doc.muteEndTime) > Date.now();
                                const events = [
                                    'pinned' in row && Boolean(toNumber(row.pinned)) !== Boolean(toNumber(current?.pinned)) && (toNumber(row.pinned) ? 'chat:pinned' : 'chat:unpinned'),
                                    row.archived != null && Boolean(row.archived) !== Boolean(current?.archived) && (row.archived ? 'chat:archived' : 'chat:unarchived'),
                                    'muteEndTime' in row && muted !== toNumber(current?.muteEndTime) > Date.now() && (muted ? 'chat:muted' : 'chat:unmuted'),
                                ].filter((event): event is 'chat:pinned' => Boolean(event));
                                events.forEach((event) => this.emit(event, new this.Chat(doc), this));
                            }
                        }
                    }).catch(() => null);
                });
                socket.ev.on('chats.delete', (ids) => {
                    chain = chain.then(async () => {
                        for (const cid of ids) {
                            const found = await room(cid);
                            await engine.unset(`/chat/${cid}`);
                            await Promise.all([mark('/pinned', await canonical(cid), false), mark('/unmapped', jidNormalizedUser(cid), false)]);
                            this.emit('chat:deleted', found, this);
                        }
                    }).catch(() => null);
                });
                socket.ev.on('messages.upsert', ({ messages }) => {
                    chain = chain.then(async () => {
                        for (const msg of messages) {
                            const content = (normalizeMessageContent(msg.message) ?? {});
                            const kind = getContentType(content);
                            const protocol = content.protocolMessage;
                            const cid = await canonical(jidNormalizedUser(pn(msg.key.remoteJid, msg.key.remoteJidAlt) ?? msg.key.remoteJid ?? ''));
                            const target: WAMessageKey | null | undefined = kind === 'reactionMessage' ? content.reactionMessage?.key
                                : kind === 'pinInChatMessage' ? content.pinInChatMessage?.key
                                : kind === 'pollUpdateMessage' ? content.pollUpdateMessage?.pollCreationMessageKey
                                : kind === 'encEventResponseMessage' ? content.encEventResponseMessage?.eventCreationMessageKey
                                : protocol?.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT || protocol?.type === proto.Message.ProtocolMessage.Type.REVOKE ? protocol.key
                                : null;
                            const eventful = kind === 'reactionMessage' || kind === 'pinInChatMessage' || kind === 'pollUpdateMessage' || kind === 'encEventResponseMessage' || kind === 'protocolMessage';
                            if (msg.key.remoteJid === 'status@broadcast' || target?.remoteJid === 'status@broadcast') await status(msg);
                            else if (eventful) await (target ? event(msg, target, cid) : null);
                            else await create(msg, cid);
                        }
                    }).catch(() => null);
                });

                /**
                 * Estado de `status@broadcast`: una reacción se suma tal cual al timeline del estado, el
                 * retiro lo borra y el resto abre su timeline con el binario del media.
                 * `status@broadcast` status: a reaction is appended as is to the status timeline, a revoke
                 * deletes it and anything else opens its timeline with the media binary.
                 *
                 * @param msg - Mensaje del estado, o reacción a uno / Status message, or a reaction to one
                 */
                const status = async (msg: WAMessage) => {
                    const content = (normalizeMessageContent(msg.message) ?? {});
                    const kind = getContentType(content);
                    const reacted = content.reactionMessage?.key?.id;
                    const revoked = content.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE ? content.protocolMessage.key?.id : null;
                    const author = msg.key.participant ? await canonical(msg.key.participant) : '';
                    const media = kind === 'imageMessage' || kind === 'videoMessage' || kind === 'audioMessage';
                    if (reacted) {
                        const post = deserialize<Raw[]>(await engine.get(`/status/${reacted}`));
                        const known = post?.some((raw) => 'messageTimestamp' in raw && raw.key.id === msg.key.id);
                        const timeline = post?.length && known === false ? await append(engine, `/status/${reacted}`, [msg], toNumber((post[0] as WAMessage).messageTimestamp) * 1_000 || undefined) : null;
                        if (timeline) this.emit('feed:updated', new this.Feed(timeline), this);
                    } else if (revoked) {
                        const gone = deserialize<Raw[]>(await engine.get(`/status/${revoked}`));
                        await engine.unset(`/status/${revoked}`);
                        if (gone?.length) this.emit('feed:deleted', new this.Feed(gone), this);
                    } else if (author && msg.key.id && (media || kind === 'conversation' || kind === 'extendedTextMessage') && (await engine.get(`/status/${msg.key.id}`)) === null) {
                        const mapped = author !== jidNormalizedUser(msg.key.participant ?? '') && author !== jidNormalizedUser(msg.key.participantAlt ?? '');
                        const timeline: Raw[] = [msg, ...(mapped ? [{ lid: msg.key.participant!, pn: author }] : [])];
                        const binary = media ? await downloadMediaMessage(msg, 'buffer', {}).catch(() => null) : null;
                        await Promise.all([
                            engine.set(`/status/${msg.key.id}`, serialize(timeline), toNumber(msg.messageTimestamp) * 1_000 || Date.now()),
                            binary?.length && (engine.set_buffer?.(`/status/${msg.key.id}/content`, binary) ?? engine.set(`/status/${msg.key.id}/content`, serialize({ data: binary.toString('base64') }))),
                        ]);
                        this.emit('feed:created', new this.Feed(timeline), this);
                    }
                };

                /**
                 * Mensaje que refiere a otro ya guardado —reacción, pin, voto, asistencia, edición o
                 * retiro—: se suma al timeline del referido tal como llegó; un voto o una asistencia se
                 * suma además descifrado, así la lectura no descifra, y si no se pudo se reintenta al leer.
                 * Message referring to an already stored one —reaction, pin, vote, attendance, edit or
                 * revoke—: it is appended to the referred one's timeline as it arrived; a vote or an
                 * attendance is also appended decrypted, so reads do not decrypt, and when it could not be
                 * it is retried on read.
                 *
                 * @param msg - Mensaje que refiere / Referring message
                 * @param key - Llave del mensaje referido / Key of the referred message
                 * @param cid - Chat canónico del mensaje que refiere / Canonical chat of the referring message
                 */
                const event = async (msg: WAMessage, key: WAMessageKey, cid: string) => {
                    const content = (normalizeMessageContent(msg.message) ?? {});
                    const found = key.id ? ((await locate(key.remoteJid ?? cid, key.id)) ?? (await locate(cid, key.id))) : null;
                    const known = found?.timeline.some((raw) => 'messageTimestamp' in raw && raw.key.id === msg.key.id);
                    const decrypted = found && known === false && (content.pollUpdateMessage || content.encEventResponseMessage) ? this.Message[internal].decrypt(found.timeline, msg) : null;
                    const timeline = found && known === false ? await append<Raw>(engine, found.path, decrypted ? [msg, decrypted] : [msg], toNumber((found.timeline[0] as WAMessage).messageTimestamp) * 1_000 || undefined) : null;
                    const instance = timeline ? new this.Message(timeline) : null;
                    const place = instance ? await instance.chat() : null;
                    const reactor = msg.key.fromMe ? jidNormalizedUser(socket.user?.id ?? '') : jidNormalizedUser(pn(msg.key.participant, msg.key.participantAlt, msg.key.remoteJid, msg.key.remoteJidAlt) ?? msg.key.participant ?? msg.key.remoteJid ?? '');
                    if (instance && place && content.reactionMessage) this.emit('message:reacted', instance, place, content.reactionMessage.text ?? '', await card(reactor), this);
                    else if (instance && place) this.emit(content.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE ? 'message:deleted' : 'message:updated', instance, place, this);
                };

                /**
                 * Mensaje nuevo: abre su timeline —con el mapeo del chat cuando la llave no trae el
                 * teléfono—, descubre al autor, actualiza la actividad del chat y guarda el binario.
                 * New message: opens its timeline —with the chat mapping when the key does not carry the
                 * phone—, discovers the author, updates the chat activity and stores the binary.
                 *
                 * @param msg - Mensaje recibido o enviado desde otro dispositivo / Message received or sent from another device
                 * @param cid - Chat canónico / Canonical chat
                 */
                const create = async (msg: WAMessage, cid: string) => {
                    const path = `/chat/${cid}/message/${msg.key.id}`;
                    const at = toNumber(msg.messageTimestamp) * 1_000 || Date.now();
                    const mapped = cid.endsWith('@s.whatsapp.net') && cid !== jidNormalizedUser(msg.key.remoteJid ?? '') && cid !== jidNormalizedUser(msg.key.remoteJidAlt ?? '');
                    const timeline: Raw[] = [msg, ...(mapped ? [{ lid: msg.key.remoteJid!, pn: cid }] : [])];
                    const instance = msg.key.id && cid && (await engine.get(path)) === null ? new this.Message(timeline) : null;
                    if (instance) {
                        const who = instance.me ? jidNormalizedUser(socket.user?.id ?? '') : instance.from.endsWith('@g.us') ? '' : await canonical(instance.from);
                        const known = who ? deserialize<ContactRaw>(await engine.get(`/contact/${who}`)) : null;
                        const current = deserialize<ChatRaw>(await engine.get(`/chat/${cid}`));
                        const binary = ['image', 'video', 'audio', 'document', 'sticker'].includes(instance.type) ? await downloadMediaMessage(msg, 'buffer', {}).catch(() => null) : null;
                        if (who && msg.pushName && (known?.name ?? known?.notify ?? known?.verifiedName) == null) {
                            socket.ev.emit('contacts.upsert', [{ id: who, lid: instance.me ? socket.user?.lid : [msg.key.participant, msg.key.participantAlt, msg.key.remoteJid, msg.key.remoteJidAlt].find((id) => id?.endsWith('@lid')) ?? undefined, notify: readable(msg.pushName) ?? undefined, verifiedName: msg.verifiedBizName ?? undefined }]);
                        }
                        await Promise.all([
                            engine.set(path, serialize(timeline), at),
                            binary?.length && (engine.set_buffer?.(`${path}/content`, binary) ?? engine.set(`${path}/content`, serialize({ data: binary.toString('base64') }))),
                        ]);
                        const { doc } = await patch<ChatRaw>(`/chat/${cid}`, {
                            id: cid,
                            pnJid: pn(cid),
                            name: current?.name ?? (cid.endsWith('@g.us') || instance.me ? undefined : (readable(msg.pushName) ?? undefined)),
                            conversationTimestamp: Math.max(at / 1_000, toNumber(current?.conversationTimestamp)),
                        }, true);
                        const place = new this.Chat(doc);
                        if (current === null) this.emit('chat:created', place, this);
                        this.emit('message:created', instance, place, this);
                        if (instance.forward()) this.emit('message:forwarded', instance, place, this);
                    }
                };

                socket.ev.on('messages.update', (updates) => {
                    chain = chain.then(async () => {
                        for (const raw of updates) {
                            const found = raw.key.remoteJid !== 'status@broadcast' && raw.key.remoteJid && raw.key.id ? await locate(raw.key.remoteJid, raw.key.id) : null;
                            const score = toNumber((found?.timeline[0] as WAMessage | undefined)?.messageTimestamp) * 1_000 || undefined;
                            const timeline = found ? await (delivery(raw) ? deliver<Raw>(engine, found.path, raw, score) : append<Raw>(engine, found.path, [raw], score)) : null;
                            const [before, after] = found && timeline ? [new this.Message(found.timeline), new this.Message(timeline)] : [];
                            const place = after ? await after.chat() : null;
                            const view = (msg: Message) => serialize([msg.status, msg.caption(), msg.pinned(), msg.edited, msg instanceof this.Message.Poll ? msg.options : null, msg instanceof this.Message.Event ? msg.going : null]);
                            if (before && after && place) {
                                if (view(before) !== view(after)) this.emit('message:updated', after, place, this);
                                if (before.starred() !== after.starred()) this.emit(after.starred() ? 'message:starred' : 'message:unstarred', after, place, this);
                            }
                        }
                    }).catch(() => null);
                });
                socket.ev.on('message-receipt.update', (updates) => {
                    chain = chain.then(async () => {
                        for (const raw of updates) {
                            const post = raw.key.remoteJid === 'status@broadcast' && raw.key.id ? deserialize<Raw[]>(await engine.get(`/status/${raw.key.id}`)) : null;
                            const found = raw.key.remoteJid !== 'status@broadcast' && raw.key.remoteJid && raw.key.id ? await locate(raw.key.remoteJid, raw.key.id) : null;
                            const [viewed, timeline] = await Promise.all([
                                post?.length ? deliver<Raw>(engine, `/status/${raw.key.id}`, raw, toNumber((post[0] as WAMessage).messageTimestamp) * 1_000 || undefined) : null,
                                found ? deliver<Raw>(engine, found.path, raw, toNumber((found.timeline[0] as WAMessage).messageTimestamp) * 1_000 || undefined) : null,
                            ]);
                            const instance = found ? new this.Message(timeline ?? found.timeline) : null;
                            if (post?.length && viewed && new this.Feed(post).seen() === false && new this.Feed(viewed).seen()) this.emit('feed:updated', new this.Feed(viewed), this);
                            if (instance && (raw.receipt.readTimestamp != null || raw.receipt.playedTimestamp != null)) this.emit('message:seen', instance, await instance.chat(), this);
                        }
                    }).catch(() => null);
                });
            };

            this.#unlink = async (quiet: boolean) => {
                Object.assign(state, { intentional: true, silent: quiet });
                if (timer) clearTimeout(timer);
                timer = null;
                await alive?.logout().catch(() => alive?.end(Object.assign(new Error('intentional close'), { output: { statusCode: DisconnectReason.connectionClosed } }))).catch(() => null);
                alive = null;
            };
            this.#close = async (quiet: boolean) => {
                Object.assign(state, { intentional: true, silent: quiet });
                if (timer) clearTimeout(timer);
                timer = null;
                await Promise.resolve(alive).then((socket) => socket?.end(Object.assign(new Error('intentional close'), { output: { statusCode: DisconnectReason.connectionClosed } }))).catch(() => null);
                alive = null;
            };

            start().catch(reject);
        });
    }

    /**
     * Desvincula el dispositivo del teléfono y termina el socket; las credenciales se borran siempre.
     * Unlinks the device from the phone and ends the socket; credentials are always dropped.
     *
     * @param options - `silent` calla el evento; `destroy` vacía el engine entero / `silent` mutes the event; `destroy` wipes the whole engine
     * @example
     * await wa.disconnect();                     // desvincula y conserva el historial
     * await wa.disconnect({ destroy: true });    // desvincula y no queda nada
     */
    async disconnect(options: { silent?: boolean; destroy?: boolean } = {}): Promise<void> {
        await this.#unlink?.(options.silent === true);
        this.#unlink = null;
        this.#close = null;
        await (options.destroy ? this.engine.clear() : this.engine.unset('/session'));
    }
}
