import { promify } from '@arcaelas/utils';
import { Boom } from '@hapi/boom';
import {
    decryptPollVote,
    DisconnectReason,
    downloadMediaMessage,
    fetchLatestBaileysVersion,
    getContentType,
    initAuthCreds,
    jidNormalizedUser,
    makeWASocket,
    proto,
    WASocket,
    type AuthenticationCreds,
    type Chat as BaileysChat,
    type Contact as BaileysContact,
    type ConnectionState,
} from 'baileys';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as QRCode from 'qrcode';
import { chat } from './Chat';
import { contact } from './Contact';
import { IMessage, message } from './Message';
import { Engine, FileEngine } from './store';

export interface IWhatsApp {
    engine?: Engine;
    phone?: string;
    sync?: boolean;
    online?: boolean;
}

interface WhatsAppEventMap {
    open: void;
    close: void;
    error: Error;
    progress: number;
    'contact:upsert': InstanceType<ReturnType<typeof contact>>;
    'chat:upsert': InstanceType<ReturnType<typeof chat>>;
    'chat:deleted': string;
    'message:created': InstanceType<ReturnType<typeof message>>;
    'message:status': InstanceType<ReturnType<typeof message>>;
    'message:updated': InstanceType<ReturnType<typeof message>>;
    'message:deleted': { cid: string; mid: string };
    'message:reaction': InstanceType<ReturnType<typeof message>>;
}

const MESSAGE_TYPE_MAP: Record<string, IMessage['type']> = {
    conversation: 'text',
    extendedTextMessage: 'text',
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
    locationMessage: 'location',
    liveLocationMessage: 'location',
    pollCreationMessage: 'poll',
    pollCreationMessageV2: 'poll',
    pollCreationMessageV3: 'poll',
};

const STATUS_MAP: Record<number, IMessage['status']> = {
    0: 'pending',
    1: 'pending',
    2: 'sent',
    3: 'delivered',
    4: 'read',
    5: 'read',
};

export class WhatsApp extends EventEmitter<{ [K in keyof WhatsAppEventMap]: [WhatsAppEventMap[K]] }> {
    readonly options: Readonly<IWhatsApp>;
    engine: Engine;
    socket: WASocket | null = null;

    Contact: ReturnType<typeof contact>;
    Chat: ReturnType<typeof chat>;
    Message: ReturnType<typeof message>;

    constructor(options: IWhatsApp = {}) {
        super();
        this.options = Object.freeze({ ...options });
        this.engine = options.engine ?? new FileEngine(options.phone ? `.baileys/${options.phone}` : '.baileys/default');
        this.Contact = contact(this);
        this.Chat = chat(this);
        this.Message = message(this);

        this.on('contact:upsert', async (i) => {
            const e = await this.engine.contact(i.id);
            await this.engine.contact(i.id, { id: i.id, name: i.name, phone: i.phone, photo: i.photo ?? e?.photo ?? null, custom_name: e?.custom_name ?? i.custom_name });
        });
        this.on('chat:upsert', async (i) => {
            const e = await this.engine.chat(i.id);
            await this.engine.chat(i.id, { id: i.id, name: i.name, phone: i.phone, photo: i.photo ?? e?.photo ?? null, type: i.type });
        });
        this.on('chat:deleted', (cid) => this.engine.chat(cid, null));
        this.on('message:created', async (i) => {
            await this.engine.message(i.cid, i.id, { id: i.id, cid: i.cid, uid: i.uid, mid: i.mid, type: i.type, mime: i.mime, caption: i.caption, me: i.me, status: i.status, created_at: i.created_at, edited: i.edited });
            const content = await i.content();
            if (content.length) await this.engine.content(i.cid, i.id, content);
        });
        this.on('message:status', async (i) => {
            await this.engine.message(i.cid, i.id, { id: i.id, cid: i.cid, uid: i.uid, mid: i.mid, type: i.type, mime: i.mime, caption: i.caption, me: i.me, status: i.status, created_at: i.created_at, edited: i.edited });
        });
        this.on('message:updated', async (i) => {
            await this.engine.message(i.cid, i.id, { id: i.id, cid: i.cid, uid: i.uid, mid: i.mid, type: i.type, mime: i.mime, caption: i.caption, me: i.me, status: i.status, created_at: i.created_at, edited: i.edited });
            const content = await i.content();
            if (content.length) await this.engine.content(i.cid, i.id, content);
        });
        this.on('message:deleted', ({ cid, mid }) => this.engine.message(cid, mid, null));
    }

    async pair(callback?: (data: Buffer | string) => void | Promise<void>): Promise<void> {
        const promise = promify();
        const { version } = await fetchLatestBaileysVersion();
        const creds = await this.engine.session<AuthenticationCreds>('session/creds');

        this.socket = makeWASocket({
            version,
            printQRInTerminal: false,
            syncFullHistory: this.options.sync ?? false,
            markOnlineOnConnect: this.options.online ?? false,
            auth: {
                creds: creds ?? initAuthCreds(),
                keys: {
                    get: async (type, ids) => {
                        const result: Record<string, unknown> = {};
                        for (const id of ids) {
                            let value = await this.engine.session(`session/signal/${type}/${id}`);
                            if (value && type === 'app-state-sync-key') value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            result[id] = value;
                        }
                        return result as never;
                    },
                    set: async (data) => {
                        for (const type in data) {
                            for (const id in data[type]) {
                                await this.engine.session(`session/signal/${type}/${id}`, data[type][id] ?? null);
                            }
                        }
                    },
                },
            },
        });

        const socket = this.socket;
        let code_sent = false;

        socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }: Partial<ConnectionState>) => {
            if (qr && callback) {
                if (this.options.phone && !code_sent) {
                    code_sent = true;
                    await callback(await socket.requestPairingCode(this.options.phone));
                } else if (!this.options.phone) {
                    await callback(await QRCode.toBuffer(qr, { type: 'png', margin: 2 }));
                }
            }
            if (connection === 'open') {
                this.emit('open');
                promise.resolve();
            } else if (connection === 'close') {
                this.socket = null;
                const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
                if (code === DisconnectReason.loggedOut) {
                    this.emit('error', lastDisconnect?.error ?? new Error('Logged out'));
                    promise.reject(lastDisconnect?.error);
                } else {
                    this.emit('close');
                }
            }
        });

        socket.ev.on('creds.update', () => this.engine.session('session/creds', socket.authState.creds));

        socket.ev.on('messaging-history.set', async ({ chats, contacts, messages, progress, isLatest }) => {
            contacts.forEach((c) => c.id && this._emit_contact(c));
            chats.forEach((ch) => this._emit_chat(ch));
            messages.forEach((m) => this._emit_message(m));
            this.emit('progress', isLatest ? 100 : progress ?? 0);
        });

        socket.ev.on('contacts.upsert', (list) => list.forEach((c) => c.id && this._emit_contact(c)));
        socket.ev.on('contacts.update', (list) => list.forEach((c) => c.id && this._emit_contact(c)));
        socket.ev.on('chats.upsert', (list) => list.forEach((ch) => this._emit_chat(ch)));

        socket.ev.on('chats.update', async (list) => {
            for (const u of list) {
                if (!u.id) continue;
                const existing = await this.engine.chat(u.id);
                if (existing) this._emit_chat({ ...existing, name: (u as { name?: string }).name ?? existing.name });
            }
        });

        socket.ev.on('chats.delete', (ids) => ids.forEach((id) => this.emit('chat:deleted', id)));

        socket.ev.on('messages.upsert', async ({ messages }) => {
            for (const m of messages) {
                getContentType(m.message ?? {}) === 'pollUpdateMessage' ? await this._process_poll_vote(m) : this._emit_message(m);
            }
        });

        socket.ev.on('messages.update', async (list) => {
            for (const { key, update } of list) {
                if (!key.remoteJid || !key.id) continue;
                const existing = await this.engine.message(key.remoteJid, key.id);
                if (!existing) continue;
                const is_edit = !!(update as { edit?: unknown }).edit;
                const merged: IMessage = { ...existing, status: update.status != null ? STATUS_MAP[update.status] ?? existing.status : existing.status, edited: is_edit || existing.edited };
                const instance = new this.Message(merged);
                instance.content = async () => (await this.engine.content(merged.cid, merged.id)) ?? Buffer.alloc(0);
                this.emit(is_edit ? 'message:updated' : 'message:status', instance);
            }
        });

        socket.ev.on('messages.delete', async (del) => {
            if ('all' in del && del.all) {
                const msgs = await this.engine.messages(del.jid, 0, 1000);
                for (const m of msgs) this.emit('message:deleted', { cid: del.jid, mid: m.id });
            } else if ('keys' in del) {
                for (const k of del.keys) {
                    if (k.remoteJid && k.id) this.emit('message:deleted', { cid: k.remoteJid, mid: k.id });
                }
            }
        });

        socket.ev.on('messages.reaction', async (reactions) => {
            for (const { key } of reactions) {
                if (!key.remoteJid || !key.id) continue;
                const existing = await this.engine.message(key.remoteJid, key.id);
                if (!existing) continue;
                const instance = new this.Message(existing);
                instance.content = async () => (await this.engine.content(existing.cid, existing.id)) ?? Buffer.alloc(0);
                this.emit('message:reaction', instance);
            }
        });

        return promise;
    }

    async sync(callback?: (progress: number) => void): Promise<void> {
        const promise = promify();
        const handler = (p: number) => {
            callback?.(p);
            if (p >= 100) {
                this.off('progress', handler);
                promise.resolve();
            }
        };
        this.on('progress', handler);
        return promise;
    }

    private _emit_contact(c: Partial<BaileysContact>): void {
        const id = c.id!;
        const name = c.notify ?? c.name ?? id.split('@')[0];
        this.emit('contact:upsert', new this.Contact({ id, name, phone: id.split('@')[0], photo: c.imgUrl === 'changed' ? null : c.imgUrl ?? null, custom_name: name }));
    }

    private _emit_chat(ch: Partial<BaileysChat> & { id: string }): void {
        const is_group = ch.id.endsWith('@g.us');
        this.emit('chat:upsert', new this.Chat({ id: ch.id, name: ch.name ?? ch.id.split('@')[0], photo: null, phone: is_group ? null : ch.id.split('@')[0], type: is_group ? 'group' : 'contact' }));
    }

    private _emit_message(msg: proto.IWebMessageInfo): void {
        if (!msg.key.remoteJid || !msg.key.id) return;
        const cid = msg.key.remoteJid;
        const content_type = getContentType(msg.message ?? {});
        const msg_type = MESSAGE_TYPE_MAP[content_type ?? ''] ?? 'unknown';
        const raw = msg.message?.[content_type as keyof typeof msg.message] as Record<string, unknown> | undefined;

        const instance = new this.Message({
            id: msg.key.id,
            cid,
            uid: jidNormalizedUser(cid.endsWith('@g.us') ? msg.key.participant ?? cid : cid),
            mid: (raw?.contextInfo as proto.IContextInfo)?.stanzaId ?? null,
            type: msg_type,
            mime: (raw?.mimetype as string) ?? 'text/plain',
            caption: (raw?.caption as string) ?? '',
            me: msg.key.fromMe ?? false,
            status: 'sent',
            created_at: new Date((msg.messageTimestamp as number) * 1000).toISOString(),
            edited: !!msg.message?.editedMessage,
        });

        if (msg_type === 'text') {
            const text = typeof raw === 'string' ? raw : (raw?.text as string) ?? '';
            instance.content = async () => Buffer.from(text);
        } else if (msg_type === 'location') {
            instance.content = async () => Buffer.from(JSON.stringify({ lat: raw?.degreesLatitude, lng: raw?.degreesLongitude }));
        } else if (msg_type === 'poll') {
            const p = raw as { name?: string; options?: Array<{ optionName: string }>; encKey?: Uint8Array } | undefined;
            instance.content = async () => Buffer.from(JSON.stringify({ content: p?.name ?? '', items: p?.options?.map((o) => ({ content: o.optionName, voters: [] })) ?? [], sign: p?.encKey ? Buffer.from(p.encKey).toString('base64') : null }));
        } else if (['image', 'video', 'audio'].includes(msg_type)) {
            instance.content = async () => {
                if (!this.socket) return Buffer.alloc(0);
                try {
                    const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: undefined as never, reuploadRequest: this.socket.updateMediaMessage });
                    return Buffer.isBuffer(buf) ? buf : Buffer.alloc(0);
                } catch {
                    return Buffer.alloc(0);
                }
            };
        } else {
            instance.content = async () => Buffer.alloc(0);
        }

        this.emit('message:created', instance);
    }

    private async _process_poll_vote(msg: proto.IWebMessageInfo): Promise<void> {
        const content_type = getContentType(msg.message ?? {});
        const raw = msg.message?.[content_type as keyof typeof msg.message] as Record<string, unknown> | undefined;
        const update = raw as { pollCreationMessageKey?: proto.IMessageKey; vote?: proto.Message.IPollEncValue } | undefined;
        const key = update?.pollCreationMessageKey;
        if (!key?.remoteJid || !key?.id || !update?.vote) return;

        const buffer = await this.engine.content(key.remoteJid, key.id);
        if (!buffer) return;

        const poll = JSON.parse(buffer.toString()) as { content: string; items: Array<{ content: string; voters: string[] }>; sign: string | null };
        if (!poll.sign) return;

        try {
            const voter = jidNormalizedUser(msg.key.participant ?? msg.key.remoteJid!);
            const decrypted = decryptPollVote(update.vote, { pollCreatorJid: jidNormalizedUser(key.participant ?? key.remoteJid), pollMsgId: key.id, pollEncKey: Buffer.from(poll.sign, 'base64'), voterJid: voter });
            const selected = new Set((decrypted.selectedOptions ?? []).map((o) => Buffer.from(o).toString('hex')));
            for (const item of poll.items) {
                item.voters = item.voters.filter((v) => v !== voter);
                if (selected.has(createHash('sha256').update(item.content).digest('hex'))) item.voters.push(voter);
            }
            await this.engine.content(key.remoteJid, key.id, Buffer.from(JSON.stringify(poll)));
        } catch {}
    }
}
