/**
 * @file WhatsApp.ts
 * @description Clase principal que gestiona la conexión y eventos de WhatsApp
 */

import { Boom } from '@hapi/boom';
import {
    Browsers,
    BufferJSON,
    DisconnectReason,
    downloadMediaMessage,
    fetchLatestBaileysVersion,
    getContentType,
    initAuthCreds,
    makeWASocket,
    proto,
    type AuthenticationCreds,
    type SignalDataTypeMap,
    type WAMessage,
    type WASocket,
} from 'baileys';
import { EventEmitter } from 'node:events';
import pino from 'pino';
import * as QRCode from 'qrcode';
import { chat, type IChatRaw } from '~/Chat';
import { contact, type IContactRaw } from '~/Contact';
import { message, type IMessageIndex } from '~/Message';
import { FileEngine, type Engine } from '~/store';

/**
 * @description Opciones de configuración de WhatsApp.
 * WhatsApp configuration options.
 */
export interface IWhatsApp {
    /** Motor de almacenamiento personalizado / Custom storage engine */
    engine?: Engine;
    /** Número de teléfono para emparejamiento con código / Phone number for code pairing */
    phone?: string | number;
}

/**
 * @description Mapa de eventos emitidos por WhatsApp.
 * Map of events emitted by WhatsApp.
 */
interface WhatsAppEventMap {
    open: [];
    close: [];
    error: [Error];
    'message:created': [InstanceType<ReturnType<typeof message>>];
    'message:updated': [InstanceType<ReturnType<typeof message>>];
    'message:reacted': [cid: string, mid: string, emoji: string];
    'message:deleted': [cid: string, mid: string];
    'chat:created': [InstanceType<ReturnType<typeof chat>>];
    'chat:updated': [InstanceType<ReturnType<typeof chat>>];
    'chat:pined': [cid: string, pined: number | null];
    'chat:archived': [cid: string, archived: boolean];
    'chat:muted': [cid: string, muted: number | null];
    'chat:deleted': [cid: string];
    'contact:created': [InstanceType<ReturnType<typeof contact>>];
    'contact:updated': [InstanceType<ReturnType<typeof contact>>];
}

/**
 * @description
 * Clase principal para gestionar la conexión con WhatsApp.
 * Main class for managing the WhatsApp connection.
 *
 * @example
 * const { event, pair, Contact, Chat, Message } = new WhatsApp({ phone: '5491112345678' });
 * event.on('open', () => console.log('Conectado'));
 * await pair((code) => console.log('Código:', code));
 */
export class WhatsApp {
    private readonly _phone?: string;
    private _socket: WASocket | null = null;

    readonly engine: Engine;
    readonly event: EventEmitter<WhatsAppEventMap>;
    readonly Contact: ReturnType<typeof contact>;
    readonly Chat: ReturnType<typeof chat>;
    readonly Message: ReturnType<typeof message>;

    constructor(options: IWhatsApp = {}) {
        this._phone = options.phone?.toString();
        this.engine = options.engine ?? new FileEngine(this._phone ? `.baileys/${this._phone}` : '.baileys/default');
        this.event = new EventEmitter();
        this.Contact = contact(this);
        this.Chat = chat(this);
        this.Message = message(this);
    }

    /**
     * @description Retorna el socket de Baileys (null si no está conectado).
     * Returns the Baileys socket (null if disconnected).
     */
    get socket(): WASocket | null {
        return this._socket;
    }

    /**
     * @description Conecta a WhatsApp.
     * Connects to WhatsApp.
     * - Con phone: callback recibe código de 8 dígitos (una vez)
     * - Sin phone: callback recibe QR como Buffer PNG (periódicamente)
     */
    pair = async (callback: (code: string | Buffer) => void | Promise<void>): Promise<void> => {
        const { version } = await fetchLatestBaileysVersion();
        const stored = await this.engine.get('session/creds');
        const creds: AuthenticationCreds = stored ? JSON.parse(stored, BufferJSON.reviver) : initAuthCreds();

        let code_sent = false;
        const connect = async (): Promise<void> => {
            this._socket = makeWASocket({
                version,
                auth: {
                    creds,
                    keys: {
                        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
                            const data: { [id: string]: SignalDataTypeMap[T] } = {};
                            for (const id of ids) {
                                const stored = await this.engine.get(`session/${type}/${id}`);
                                if (stored) {
                                    let value = JSON.parse(stored, BufferJSON.reviver);
                                    if (type === 'app-state-sync-key') value = proto.Message.AppStateSyncKeyData.fromObject(value);
                                    data[id] = value;
                                }
                            }
                            return data;
                        },
                        set: async (data: Record<string, Record<string, unknown | null>>) => {
                            for (const category in data) {
                                for (const id in data[category]) {
                                    const value = data[category][id];
                                    await this.engine.set(`session/${category}/${id}`, value ? JSON.stringify(value, BufferJSON.replacer) : null);
                                }
                            }
                        },
                    },
                },
                browser: Browsers.windows('Chrome'),
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                syncFullHistory: false,
                markOnlineOnConnect: false,
            });

            const socket = this._socket;
            socket.ev.on('creds.update', () => this.engine.set('session/creds', JSON.stringify(creds, BufferJSON.replacer)));
            socket.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && !creds.registered) {
                    if (this._phone && !code_sent) {
                        code_sent = true;
                        await callback(await socket.requestPairingCode(this._phone));
                    } else if (!this._phone) {
                        await callback(await QRCode.toBuffer(qr, { type: 'png', margin: 2 }));
                    }
                }

                if (connection === 'open') {
                    this.event.emit('open');
                } else if (connection === 'close') {
                    this._socket = null;
                    if ((lastDisconnect?.error as Boom)?.output?.statusCode === DisconnectReason.loggedOut) {
                        this.event.emit('error', new Error('Logged out'));
                        return;
                    }
                    this.event.emit('close');
                    setTimeout(connect, 3000);
                }
            });

            // ═══════════════════════════════════════════════════════════════════
            // CONTACTS
            // ═══════════════════════════════════════════════════════════════════

            socket.ev.on('contacts.upsert', async (contacts) => {
                for (const c of contacts) {
                    if (!c.id) continue;
                    const existing = await this.engine.get(`contact/${c.id}/index`);
                    const raw: IContactRaw = {
                        id: c.id,
                        lid: (c as { lid?: string }).lid ?? null,
                        name: c.name ?? null,
                        notify: c.notify ?? null,
                        verifiedName: (c as { verifiedName?: string }).verifiedName ?? null,
                        imgUrl: (c as { imgUrl?: string }).imgUrl ?? null,
                        status: (c as { status?: string }).status ?? null,
                    };
                    await this.engine.set(`contact/${c.id}/index`, JSON.stringify(raw, BufferJSON.replacer));
                    if (raw.lid) await this.engine.set(`lid/${raw.lid}`, raw.id);
                    this.event.emit(existing ? 'contact:updated' : 'contact:created', new this.Contact(raw));
                }
            });

            socket.ev.on('contacts.update', async (contacts) => {
                for (const c of contacts) {
                    if (!c.id) continue;
                    const stored = await this.engine.get(`contact/${c.id}/index`);
                    if (!stored) continue;

                    const raw: IContactRaw = JSON.parse(stored, BufferJSON.reviver);
                    if (c.notify) raw.notify = c.notify;
                    if (c.name) raw.name = c.name;
                    if ((c as { imgUrl?: string }).imgUrl) raw.imgUrl = (c as { imgUrl?: string }).imgUrl;
                    if ((c as { status?: string }).status) raw.status = (c as { status?: string }).status;
                    if ((c as { lid?: string }).lid) raw.lid = (c as { lid?: string }).lid;

                    await this.engine.set(`contact/${c.id}/index`, JSON.stringify(raw, BufferJSON.replacer));
                    if (raw.lid) await this.engine.set(`lid/${raw.lid}`, raw.id);
                    this.event.emit('contact:updated', new this.Contact(raw));
                }
            });

            // ═══════════════════════════════════════════════════════════════════
            // CHATS
            // ═══════════════════════════════════════════════════════════════════

            socket.ev.on('chats.upsert', async (chats) => {
                for (const ch of chats) {
                    const existing = await this.engine.get(`chat/${ch.id}/index`);
                    const raw: IChatRaw = existing
                        ? JSON.parse(existing, BufferJSON.reviver)
                        : {
                            id: ch.id,
                            name: ch.name ?? null,
                            archived: ch.archived ?? null,
                            pinned: (ch as { pinned?: number }).pinned ?? null,
                            muteEndTime: (ch as { muteEndTime?: number }).muteEndTime ?? null,
                            unreadCount: ch.unreadCount ?? null,
                            readOnly: (ch as { readOnly?: boolean }).readOnly ?? null,
                        };
                    if (ch.name) raw.name = ch.name;
                    await this.engine.set(`chat/${ch.id}/index`, JSON.stringify(raw, BufferJSON.replacer));
                    this.event.emit(existing ? 'chat:updated' : 'chat:created', new this.Chat(raw));
                }
            });

            socket.ev.on('chats.update', async (chats) => {
                for (const ch of chats) {
                    if (!ch.id) continue;

                    const stored = await this.engine.get(`chat/${ch.id}/index`);
                    const raw: IChatRaw = stored ? JSON.parse(stored, BufferJSON.reviver) : { id: ch.id, name: ch.name ?? null };
                    let has_specific_event = false;

                    if (ch.name !== undefined) raw.name = ch.name ?? raw.name;
                    if ('pinned' in ch) {
                        raw.pinned = (ch as { pinned?: number | null }).pinned ?? null;
                        this.event.emit('chat:pined', ch.id, raw.pinned);
                        has_specific_event = true;
                    }
                    if (ch.archived !== undefined) {
                        raw.archived = ch.archived ?? false;
                        this.event.emit('chat:archived', ch.id, raw.archived);
                        has_specific_event = true;
                    }
                    if ('muteEndTime' in ch) {
                        raw.muteEndTime = (ch as { muteEndTime?: number | null }).muteEndTime ?? null;
                        this.event.emit('chat:muted', ch.id, raw.muteEndTime);
                        has_specific_event = true;
                    }
                    if (ch.unreadCount !== undefined) raw.unreadCount = ch.unreadCount;
                    await this.engine.set(`chat/${ch.id}/index`, JSON.stringify(raw, BufferJSON.replacer));
                    if (!has_specific_event) this.event.emit(stored ? 'chat:updated' : 'chat:created', new this.Chat(raw));
                }
            });

            socket.ev.on('chats.delete', async (ids) => {
                for (const cid of ids) {
                    await this.engine.set(`chat/${cid}`, null);
                    this.event.emit('chat:deleted', cid);
                }
            });

            // ═══════════════════════════════════════════════════════════════════
            // MESSAGES
            // ═══════════════════════════════════════════════════════════════════

            socket.ev.on('messages.upsert', async ({ messages }) => {
                for (const msg of messages) {
                    if (!msg.key.remoteJid || !msg.key.id) continue;

                    const cid = msg.key.remoteJid;
                    const mid = msg.key.id;
                    const content_type = getContentType(msg.message ?? {});

                    if (content_type === 'reactionMessage' || content_type === 'pollUpdateMessage') continue;

                    // ─── PROTOCOL MESSAGE (ediciones y eliminaciones) ───
                    if (content_type === 'protocolMessage') {
                        const protocol = msg.message?.protocolMessage;
                        if (!protocol?.key?.id) continue;

                        const target_mid = protocol.key.id;
                        const target_cid = protocol.key.remoteJid ?? cid;

                        if (protocol.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT) {
                            const edited_msg = protocol.editedMessage;
                            if (!edited_msg) continue;

                            const stored_index = await this.engine.get(`chat/${target_cid}/message/${target_mid}/index`);
                            const stored_raw = await this.engine.get(`chat/${target_cid}/message/${target_mid}/raw`);
                            if (!stored_index || !stored_raw) continue;

                            const index: IMessageIndex = JSON.parse(stored_index, BufferJSON.reviver);
                            const raw: WAMessage = JSON.parse(stored_raw, BufferJSON.reviver);

                            raw.message = edited_msg;
                            index.edited = true;
                            index.caption = this.Message._build_index(raw).caption;

                            await this.engine.set(`chat/${target_cid}/message/${target_mid}/index`, JSON.stringify(index, BufferJSON.replacer));
                            await this.engine.set(`chat/${target_cid}/message/${target_mid}/raw`, JSON.stringify(raw, BufferJSON.replacer));

                            const instance = new this.Message({ index, raw });
                            this.Message._notify(target_cid, target_mid);
                            this.event.emit('message:updated', instance);
                            continue;
                        }

                        if (protocol.type === proto.Message.ProtocolMessage.Type.REVOKE) {
                            await this.Message._remove_from_index(target_cid, target_mid);
                            await this.engine.set(`chat/${target_cid}/message/${target_mid}`, null);
                            this.event.emit('message:deleted', target_cid, target_mid);
                        }
                        continue;
                    }

                    // ─── MENSAJE NUEVO ───
                    const index = this.Message._build_index(msg);
                    await this.engine.set(`chat/${cid}/message/${mid}/index`, JSON.stringify(index, BufferJSON.replacer));
                    await this.engine.set(`chat/${cid}/message/${mid}/raw`, JSON.stringify(msg, BufferJSON.replacer));

                    let content = Buffer.alloc(0);
                    if (index.type === 'text') {
                        const raw_content = msg.message?.[content_type as keyof typeof msg.message] as Record<string, unknown> | string | undefined;
                        content = Buffer.from(typeof raw_content === 'string' ? raw_content : (raw_content?.text as string) ?? (raw_content?.caption as string) ?? '', 'utf-8');
                    } else if (index.type === 'location') {
                        const loc = msg.message?.locationMessage ?? msg.message?.liveLocationMessage;
                        content = Buffer.from(JSON.stringify({ lat: loc?.degreesLatitude, lng: loc?.degreesLongitude }), 'utf-8');
                    } else if (index.type === 'poll') {
                        const poll = msg.message?.pollCreationMessage ?? msg.message?.pollCreationMessageV2 ?? msg.message?.pollCreationMessageV3;
                        content = Buffer.from(JSON.stringify({ content: poll?.name ?? '', options: poll?.options?.map((o) => ({ content: o.optionName })) ?? [] }), 'utf-8');
                    } else if (['image', 'video', 'audio'].includes(index.type) && this._socket) {
                        try {
                            const buffer = await downloadMediaMessage(msg, 'buffer', {});
                            if (Buffer.isBuffer(buffer)) content = buffer as Buffer<ArrayBuffer>;
                        } catch { /* media download may fail */ }
                    }

                    if (content.length) await this.engine.set(`chat/${cid}/message/${mid}/content`, content.toString('base64'));
                    await this.Message._add_to_index(cid, mid, index.created_at);
                    const instance = new this.Message({ index, raw: msg });
                    if (content.length) instance.content = async () => content;
                    this.Message._notify(cid, mid);
                    this.event.emit('message:created', instance);
                }
            });

            socket.ev.on('messages.update', async (updates) => {
                for (const { key, update } of updates) {
                    if (!key.remoteJid || !key.id) continue;

                    const stored_raw = await this.engine.get(`chat/${key.remoteJid}/message/${key.id}/raw`);
                    const stored_index = await this.engine.get(`chat/${key.remoteJid}/message/${key.id}/index`);
                    if (!stored_index) continue;

                    const index: IMessageIndex = JSON.parse(stored_index, BufferJSON.reviver);
                    const raw: WAMessage = stored_raw ? JSON.parse(stored_raw, BufferJSON.reviver) : { key };

                    if ((update as { message?: { editedMessage?: { message?: proto.IMessage } } }).message?.editedMessage?.message) {
                        raw.message = (update as { message: { editedMessage: { message: proto.IMessage } } }).message.editedMessage.message;
                        index.edited = true;
                        index.caption = this.Message._build_index(raw).caption;
                        await this.engine.set(`chat/${key.remoteJid}/message/${key.id}/index`, JSON.stringify(index, BufferJSON.replacer));
                        await this.engine.set(`chat/${key.remoteJid}/message/${key.id}/raw`, JSON.stringify(raw, BufferJSON.replacer));

                        const instance = new this.Message({ index, raw });
                        this.Message._notify(key.remoteJid, key.id);
                        this.event.emit('message:updated', instance);
                        continue;
                    }

                    if ((update as { status?: number }).status !== undefined) {
                        raw.status = (update as { status: number }).status;
                        index.status = raw.status as unknown as import('~/Message').MESSAGE_STATUS;
                        await this.engine.set(`chat/${key.remoteJid}/message/${key.id}/index`, JSON.stringify(index, BufferJSON.replacer));
                        await this.engine.set(`chat/${key.remoteJid}/message/${key.id}/raw`, JSON.stringify(raw, BufferJSON.replacer));
                    }
                }
            });

            socket.ev.on('messages.reaction', async (reactions) => {
                for (const { key, reaction } of reactions) {
                    if (key.remoteJid && key.id) this.event.emit('message:reacted', key.remoteJid, key.id, reaction.text ?? '');
                }
            });
        };

        await connect();
    };
}
