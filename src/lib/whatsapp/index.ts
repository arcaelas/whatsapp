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

/**
 * WhatsApp devuelve el nombre de la propia cuenta enmascarado —«+58∙∙∙∙∙∙∙∙40»— cuando el perfil
 * no viajó completo. Eso no es un nombre: aceptarlo tapa al verdadero, que sí está guardado en
 * la ficha del contacto propio.
 * WhatsApp returns the own account name masked —«+58∙∙∙∙∙∙∙∙40»— when the profile did not travel
 * whole. That is not a name: taking it hides the real one, which is stored on the own contact
 * card.
 */
/**
 * Cola por ruta para las escrituras de sesión. Baileys emite `creds.update` varias veces
 * seguidas y lanza `keys.set` en paralelo; sin serializar, dos escrituras sobre el mismo
 * archivo pueden resolverse en orden inverso y dejar el estado viejo encima del nuevo. Un
 * archivo íntegro pero atrasado no se nota —el `tmp+rename` del engine lo deja bien formado—,
 * y es peor que uno corrupto: WhatsApp lo rechaza en el handshake y cierra la sesión.
 * Su propia referencia (`useMultiFileAuthState`) toma un mutex por archivo por esto mismo.
 * Per-path queue for session writes. Baileys emits `creds.update` several times in a row and
 * fires `keys.set` in parallel; without serializing, two writes to the same file can settle in
 * reverse order and leave the old state on top of the new one. A whole but stale file goes
 * unnoticed —the engine's `tmp+rename` leaves it well formed— and is worse than a corrupt one:
 * WhatsApp rejects it at the handshake and closes the session. Their own reference
 * (`useMultiFileAuthState`) takes a mutex per file for this very reason.
 */
const queued = (locks: Map<string, Promise<unknown>>, path: string, work: () => Promise<unknown>) => {
    const next = (locks.get(path) ?? Promise.resolve()).then(work, work);
    locks.set(path, next.catch(() => { }));
    return next;
};

const readable = (value: string | null | undefined) => (value && !/^\+?[\d\s·•∙⋅]+$/.test(value) ? value : null);

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
    /**
     * Nombre con el que esta sesión aparece en «Dispositivos vinculados» del teléfono; por
     * defecto `Chrome`. Cuando una cuenta tiene varias sesiones es lo ÚNICO que permite
     * distinguirlas para cerrar la correcta: con el valor por defecto todas se ven iguales
     * —y iguales a un navegador real—, así que quien abra más de una debería nombrarlas.
     * Name this session shows under the phone's «Linked devices»; defaults to `Chrome`. When an
     * account holds several sessions it is the ONLY thing telling them apart to close the right
     * one: with the default they all look alike —and alike to a real browser—, so whoever opens
     * more than one should name them.
     */
    device?: string;
    /**
     * Nivel del log interno de baileys; `silent` por defecto. En silencio un cierre remoto no
     * deja rastro de por qué ocurrió: `Farewell` da el código, pero el intercambio que llevó
     * hasta él —el nodo que WhatsApp rechazó— sólo aparece subiendo esto a `debug` o `trace`.
     * Level of baileys' internal log; `silent` by default. Kept silent, a remote close leaves no
     * trace of why it happened: `Farewell` gives the code, but the exchange leading to it —the
     * node WhatsApp rejected— only shows up by raising this to `debug` or `trace`.
     */
    debug?: 'silent' | 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}

/**
 * Por qué se cerró la sesión. Sin esto un cierre remoto es indistinguible de otro: el evento
 * sólo decía «se cerró», el logger va en silencio y `autoclean` borra la evidencia antes de que
 * nadie pueda mirarla, así que no queda con qué diagnosticar por qué WhatsApp echó la línea.
 * Why the session closed. Without it one remote close is indistinguishable from another: the
 * event only said «it closed», the logger runs silent and `autoclean` wipes the evidence before
 * anyone can look at it, leaving nothing to diagnose why WhatsApp dropped the line.
 */
export interface Farewell {
    /** Código de baileys, si vino. / Baileys status code, if any. */
    code: number | null;
    /** Nombre del motivo (`loggedOut`, `connectionReplaced`, `badSession`…) o `unknown`. / Reason name or `unknown`. */
    reason: string;
    /** El teléfono desvinculó la sesión: no se reintenta y las credenciales ya no sirven. / The phone unlinked it: no retry, credentials are dead. */
    expired: boolean;
    /** Mensaje del error subyacente, si lo hubo. / Underlying error message, if any. */
    detail: string | null;
}

interface EventMap {
    connected: [WhatsApp];
    disconnected: [WhatsApp, Farewell];
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
    /**
     * Cierre completo: desvincula del teléfono y termina el socket. Es distinto de `#close`,
     * que sólo cuelga —lo que hace falta al reconectar, donde desvincular sería absurdo—.
     * Full close: unlinks from the phone and ends the socket. Distinct from `#close`, which
     * merely hangs up —what reconnecting needs, where unlinking would be absurd—.
     */
    #unlink: ((silent: boolean) => Promise<void>) | null = null;

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
        const { phone, method, autoclean = true, sync = true, reconnect = true, device, debug } = this.#options;
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

        const locks = new Map<string, Promise<unknown>>();

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
                                    Object.entries(entries).map(([id, value]) => {
                                        const path = `/session/${category}/${id}`;
                                        return queued(locks, path, () => (value != null ? engine.set(path, serialize(value)) : engine.unset(path)));
                                    })
                                ));
                            },
                        },
                    },
                    browser: Browsers.windows(device ?? 'Chrome'),
                    logger: pino({ level: debug ?? 'silent' }),
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
                    // La cuenta propia también se guarda por LID cuando el teléfono se anuncia
                    // así, y entonces la ficha del JID viene vacía: se leen las dos y gana la
                    // que tenga el dato.
                    // The own account is stored by LID too when the phone announces itself that
                    // way, and then the JID card comes back empty: both are read and whichever
                    // holds the data wins.
                    const card = deserialize<ContactRaw>(await engine.get(`/contact/${id}`));
                    const alias = user.lid ? deserialize<ContactRaw>(await engine.get(`/contact/${jidNormalizedUser(user.lid)}`)) : null;
                    return new Account(init, {
                        id,
                        phone_number: id,
                        lid: user.lid ?? card?.lid ?? alias?.lid ?? null,
                        // `verified_name` es el nombre de una cuenta de empresa y `notify` el
                        // que la propia línea difunde en sus mensajes: cualquiera de los dos es
                        // el nombre real de la cuenta cuando el perfil no viajó en el login.
                        // `verified_name` is a business account's name and `notify` the one the
                        // line itself broadcasts in its messages: either is the account's real
                        // name when the profile did not travel in the login.
                        name: readable(user.name) ?? readable(card?.name) ?? readable(alias?.name) ?? card?.verified_name ?? alias?.verified_name ?? card?.notify ?? alias?.notify ?? null,
                        notify: card?.notify ?? alias?.notify ?? null,
                        verified_name: card?.verified_name ?? alias?.verified_name ?? null,
                        img_url: (await socket.profilePictureUrl(id, 'image').catch(() => null)) ?? card?.img_url ?? alias?.img_url ?? null,
                        status: card?.status ?? alias?.status ?? null,
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
                /**
                 * Identidad con la que se guarda a alguien. El mismo contacto llega unas veces
                 * por teléfono y otras por LID, y tratar ambos como distintos le abre dos fichas
                 * y dos chats. El teléfono manda; el LID sólo se conserva cuando aún no hay
                 * forma de traducirlo.
                 * The identity someone is stored under. The same contact arrives sometimes by
                 * phone and sometimes by LID, and treating both as distinct opens two cards and
                 * two chats for them. The phone wins; the LID is only kept while there is still
                 * no way to translate it.
                 */
                const canonical = async (uid: string) => (uid.endsWith('@lid') ? await jid_of(engine, uid, socket).catch(() => null) : null) ?? uid;
                /** Índice LID↔teléfono, sólo cuando traduce de verdad. / LID↔phone index, only when it actually translates. */
                const remember = async (lid: string | null | undefined, jid: string) => {
                    if (lid && !jid.endsWith('@lid')) {
                        await engine.set(`/lid/${lid}`, serialize(jid));
                        await engine.set(`/lid/${jid}`, serialize(lid));
                    }
                };
                /**
                 * Vuelca sobre el teléfono lo que se había guardado bajo el LID —ficha, chat y
                 * mensajes— y borra el duplicado. Los campos ya presentes en el destino ganan:
                 * son los que la cuenta viene usando.
                 * Pours whatever was stored under the LID —card, chat and messages— onto the
                 * phone and drops the duplicate. Fields already present on the target win: those
                 * are the ones the account has been using.
                 */
                const absorb = async (lid: string, pn: string) => {
                    const [from, to] = [jidNormalizedUser(lid), jidNormalizedUser(pn)];
                    if (from !== to) {
                        const stale = deserialize<ContactRaw>(await engine.get(`/contact/${from}`));
                        if (stale) {
                            const target = deserialize<ContactRaw>(await engine.get(`/contact/${to}`));
                            await engine.set(`/contact/${to}`, serialize({ ...stale, ...target, id: to, lid: from }));
                            await engine.unset(`/contact/${from}`);
                        }
                        const orphan = deserialize<ChatRaw>(await engine.get(`/chat/${from}`));
                        if (orphan) {
                            const target = deserialize<ChatRaw>(await engine.get(`/chat/${to}`));
                            for (const raw of await engine.list(`/chat/${from}/message`, 0, 10_000)) {
                                const msg = deserialize<MessageRaw>(raw);
                                if (msg) {
                                    await engine.set(`/chat/${to}/message/${msg.id}`, serialize({ ...msg, cid: to }), msg.created_at);
                                    await engine.unset(`/chat/${from}/message/${msg.id}`);
                                }
                            }
                            const doc = { ...orphan, ...target, id: to, activity: Math.max(orphan.activity ?? 0, target?.activity ?? 0) || null };
                            await engine.set(`/chat/${to}`, serialize(doc), doc.activity ?? 0);
                            await engine.unset(`/chat/${from}`);
                            // Para quien escucha, el duplicado desaparece y el bueno aparece: es
                            // literalmente lo que pasó, y deja la lista sin la fila fantasma.
                            // To a listener the duplicate goes away and the good one shows up:
                            // that is literally what happened, and it leaves the list without
                            // the ghost row.
                            this.emit('chat:deleted', new this.Chat(orphan), this);
                            if (!target) {
                                this.emit('chat:created', new this.Chat(doc), this);
                            }
                        }
                    }
                };

                /**
                 * Pasa por todo lo guardado bajo un LID y lo une a su teléfono. Cubre lo que se
                 * escribió antes de que el mapeo existiera —o antes de que la librería supiera
                 * unirlo—, que es lo que deja la lista con el mismo contacto dos veces: una con
                 * su nombre y otra como un número largo sin sentido.
                 * Walks everything stored under a LID and joins it to its phone. It covers what
                 * was written before the mapping existed —or before the library knew how to join
                 * it—, which is what leaves the same contact twice in the list: once with a name
                 * and once as a long meaningless number.
                 */
                const reconcile = async () => {
                    for (const path of ['/contact', '/chat'] as const) {
                        for (const raw of await engine.list(path, 0, 10_000)) {
                            const id = deserialize<{ id?: string }>(raw)?.id;
                            if (id?.endsWith('@lid')) {
                                const jid = await jid_of(engine, id, socket).catch(() => null);
                                if (jid) {
                                    await absorb(id, jid);
                                }
                            }
                        }
                    }
                };

                socket.ev.on('creds.update', () => queued(locks, '/session/creds', () => engine.set('/session/creds', serialize(creds))));
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
                        // Los mapeos que faltaban ya viajaron en el handshake: recién ahora se
                        // puede unir lo que quedó partido en sesiones anteriores, cuando esos
                        // LID todavía eran intraducibles.
                        // The missing mappings already travelled in the handshake: only now can
                        // whatever stayed split in earlier sessions be joined, back when those
                        // LIDs were still untranslatable.
                        chain = chain.then(reconcile).catch(() => { });
                        this.emit('connected', this);
                        resolve();
                    } else if (connection === 'close') {
                        const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
                        const transient = code === DisconnectReason.restartRequired;
                        const farewell: Farewell = {
                            code: code ?? null,
                            reason: Object.entries(DisconnectReason).find(([, value]) => value === code)?.[0] ?? 'unknown',
                            expired: code === DisconnectReason.loggedOut,
                            detail: lastDisconnect?.error instanceof Error ? lastDisconnect.error.message : null,
                        };
                        if (code === DisconnectReason.loggedOut) {
                            // Las escrituras en vuelo tienen que aterrizar antes de borrar, o una
                            // de ellas resucita las credenciales justo después del clear y la
                            // siguiente conexión arranca con restos de una sesión ya muerta.
                            // In-flight writes must land before wiping, or one of them resurrects
                            // the credentials right after the clear and the next connection starts
                            // on the leftovers of an already dead session.
                            await Promise.allSettled([...locks.values()]);
                            locks.clear();
                            await (autoclean ? engine.clear() : engine.unset('/session/creds'));
                        }
                        if (connected && !transient && !silent) {
                            this.emit('disconnected', this, farewell);
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
                                const id = await canonical(row.id);
                                const current = deserialize<ContactRaw>(await engine.get(`/contact/${id}`));
                                const doc: ContactRaw = {
                                    id,
                                    lid: row.lid ?? (row.id.endsWith('@lid') ? row.id : null) ?? current?.lid ?? null,
                                    name: row.name ?? current?.name ?? null,
                                    notify: row.notify ?? current?.notify ?? null,
                                    verified_name: row.verifiedName ?? current?.verified_name ?? null,
                                    img_url: (typeof row.imgUrl === 'string' ? row.imgUrl : null) ?? current?.img_url ?? null,
                                    status: row.status ?? current?.status ?? null,
                                };
                                if (!current || JSON.stringify(current) !== JSON.stringify(doc)) {
                                    await engine.set(`/contact/${id}`, serialize(doc));
                                    await remember(doc.lid, id);
                                    const person = new this.Contact(doc);
                                    const owner = deserialize<ChatRaw>(await engine.get(`/chat/${id}`));
                                    this.emit(current ? 'contact:updated' : 'contact:created', person, new this.Chat(owner ?? { id, name: person.name }), this);
                                }
                            }
                        }
                    }).catch(() => { });
                });
                socket.ev.on('contacts.update', (rows) => {
                    chain = chain.then(async () => {
                        for (const row of rows) {
                            const id = row.id ? await canonical(row.id) : '';
                            const current = id ? deserialize<ContactRaw>(await engine.get(`/contact/${id}`)) : null;
                            const patch: Partial<ContactRaw> = {
                                ...(row.notify && { notify: row.notify }),
                                ...(row.name && { name: row.name }),
                                ...(row.verifiedName && { verified_name: row.verifiedName }),
                                ...(typeof row.imgUrl === 'string' && { img_url: row.imgUrl }),
                                ...(row.status && { status: row.status }),
                                ...((row.lid ?? (row.id?.endsWith('@lid') ? row.id : null)) && { lid: row.lid ?? row.id }),
                            };
                            if (current && Object.keys(patch).length > 0) {
                                const doc = { ...current, ...patch };
                                await engine.set(`/contact/${id}`, serialize(doc));
                                await remember(patch.lid, id);
                                const person = new this.Contact(doc);
                                const owner = deserialize<ChatRaw>(await engine.get(`/chat/${id}`));
                                this.emit('contact:updated', person, new this.Chat(owner ?? { id, name: person.name }), this);
                            }
                        }
                    }).catch(() => { });
                });
                socket.ev.on('lid-mapping.update', ({ lid, pn }) => {
                    chain = chain.then(async () => {
                        await remember(lid, pn);
                        // El mapeo recién llega: lo que se guardó bajo el LID mientras era
                        // irresoluble se une ahora a su teléfono, o el contacto queda partido
                        // en dos fichas y dos chats que nunca se vuelven a encontrar.
                        // The mapping just arrived: whatever was stored under the LID while it
                        // was unresolvable now joins its phone, or the contact stays split into
                        // two cards and two chats that never meet again.
                        await absorb(lid, pn);
                    }).catch(() => { });
                });
                socket.ev.on('chats.upsert', (rows) => {
                    chain = chain.then(async () => {
                        for (const raw of rows) {
                            if (raw.id) {
                                const row = { ...raw, id: await canonical(raw.id) };
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
                                // El aviso puede venir direccionado por LID y el documento estar bajo el JID
                                // (o al revés): se busca por el chat que nombra el protocolo y por el del sobre.
                                // The notice may be LID-addressed while the document lives under the JID (or the
                                // other way around): it is looked up by the protocol's chat and by the envelope's.
                                const found = protocol?.key?.id
                                    ? (await locate(protocol.key.remoteJid ?? cid, protocol.key.id)) ?? (await locate(cid, protocol.key.id))
                                    : null;
                                if (found && protocol?.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT && protocol.editedMessage) {
                                    found.doc.raw.message = protocol.editedMessage;
                                    found.doc.edited = true;
                                    found.doc.caption = new Message(init, found.doc.raw).caption;
                                    await engine.set(found.path, serialize(found.doc), found.doc.created_at);
                                    const instance = new Message(init, found.doc);
                                    this.emit('message:updated', instance, await instance.chat(), this);
                                } else if (found && protocol?.type === proto.Message.ProtocolMessage.Type.REVOKE) {
                                    // El mensaje retirado no se borra: se marca, y así la interfaz puede
                                    // mostrar «se eliminó este mensaje» donde estaba en vez de un hueco.
                                    // A revoked message is not removed: it gets flagged, so the interface can
                                    // show "this message was deleted" in its place instead of a gap.
                                    found.doc.revoked_at = Date.now();
                                    await engine.set(found.path, serialize(found.doc), found.doc.created_at);
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
                                doc.revoked_at = stored.revoked_at ?? doc.revoked_at;
                                const advanced = doc.status > stored.status;
                                doc.status = Math.max(stored.status, doc.status);
                                if (!advanced && stored.caption === doc.caption && stored.edited === doc.edited && stored.starred === doc.starred) {
                                    continue;
                                }
                            }
                            if (!stored && doc.me && msg.pushName && socket.user) {
                                // Un mensaje propio lleva el nombre con el que la cuenta se
                                // anuncia al mundo. Cuando el perfil no viajó en el login —una
                                // reconexión, por ejemplo— esta es la única vía para conocerlo,
                                // y sin ella la línea se ve a sí misma como un número.
                                // An own message carries the name the account announces itself
                                // with. When the profile did not travel in the login —a
                                // reconnection, say— this is the only way to learn it, and
                                // without it the line sees itself as a number.
                                const own = jidNormalizedUser(socket.user.id);
                                const known = deserialize<ContactRaw>(await engine.get(`/contact/${own}`));
                                if (!(known?.name ?? known?.notify ?? known?.verified_name)) {
                                    socket.ev.emit('contacts.upsert', [{ id: own, lid: socket.user.lid, notify: readable(msg.pushName) ?? undefined }]);
                                }
                            }
                            if (!stored && !doc.me) {
                                const known = deserialize<ContactRaw>(await engine.get(`/contact/${doc.author}`));
                                if (doc.author && !(known?.name ?? known?.notify ?? known?.verified_name)) {
                                    socket.ev.emit('contacts.upsert', [{
                                        id: doc.author,
                                        lid: msg.key.remoteJid?.endsWith('@lid') ? msg.key.remoteJid : undefined,
                                        notify: readable(msg.pushName) ?? undefined,
                                        verifiedName: msg.verifiedBizName ?? undefined,
                                    }]);
                                }
                                if (!(await engine.get(`/chat/${cid}`))) {
                                    const owner: ChatRaw = { id: cid, name: cid.endsWith('@g.us') ? null : readable(msg.pushName), activity: doc.created_at };
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
            this.#unlink = async (quiet: boolean) => {
                intentional = true;
                silent = quiet;
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                try {
                    // `logout` avisa al teléfono y termina el socket; la promesa no resuelve
                    // hasta que el teléfono acusa, que es cuando el dispositivo ya no existe.
                    // `logout` notifies the phone and ends the socket; the promise does not
                    // settle until the phone acknowledges, which is when the device is gone.
                    await alive?.logout();
                } catch {
                    // Sin red o con el socket ya muerto no hay a quién avisar: se cierra de
                    // este lado para no dejar el proceso colgado de una sesión que no existe.
                    // With no network or an already dead socket there is nobody to notify: it
                    // closes on this side so the process is not left hanging on a dead session.
                    try {
                        alive?.end(Object.assign(new Error('intentional close'), { output: { statusCode: DisconnectReason.connectionClosed } }));
                    } catch {
                        /* el socket ya estaba cerrado / socket already closed */
                    }
                }
                alive = null;
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
     * Cierra la sesión de verdad: desvincula el dispositivo del teléfono y termina el socket.
     * La promesa no resuelve hasta que todo eso ocurrió.
     *
     * Los dos flags modulan efectos secundarios, nunca si la sesión muere: `silent` sólo calla
     * el evento `disconnected` local, y `destroy` decide si el engine se vacía o conserva
     * chats, mensajes y contactos para estudiarlos después. Las credenciales se borran en los
     * dos casos: el dispositivo ya no existe, así que reconectar con ellas sólo devolvería un
     * `loggedOut`.
     *
     * Closes the session for real: unlinks the device from the phone and ends the socket. The
     * promise does not settle until all of that happened.
     *
     * Both flags modulate side effects, never whether the session dies: `silent` only mutes the
     * local `disconnected` event, and `destroy` decides whether the engine is wiped or keeps
     * chats, messages and contacts for later study. Credentials go in both cases: the device no
     * longer exists, so reconnecting with them would only return a `loggedOut`.
     *
     * @param options - `silent` calla el evento; `destroy` vacía el engine entero / `silent` mutes the event; `destroy` wipes the whole engine
     *
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
