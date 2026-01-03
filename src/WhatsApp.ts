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
    jidNormalizedUser,
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
import { chat, type IChat } from './Chat';
import { contact, type IContact } from './Contact';
import { message, MESSAGE_TYPE_MAP, type IMessage } from './Message';
import { FileEngine, type Engine } from './store';

/**
 * @description Opciones de configuración de WhatsApp.
 */
export interface IWhatsApp {
    /** Motor de almacenamiento personalizado */
    engine?: Engine;
    /** Número de teléfono para emparejamiento con código */
    phone?: string | number;
}

/**
 * @description Mapa de eventos emitidos por WhatsApp.
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

    /** @description Retorna el socket de Baileys (null si no está conectado). */
    get socket(): WASocket | null {
        return this._socket;
    }

    /**
     * @description Conecta a WhatsApp.
     * - Con phone: callback recibe código de 8 dígitos (una vez)
     * - Sin phone: callback recibe QR como Buffer PNG (periódicamente)
     * @param callback Función que recibe el código o QR.
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
                console.log('[BAILEYS] contacts.upsert:', JSON.stringify(contacts, null, 2));
                for (const c of contacts) {
                    if (!c.id) continue;
                    const existing = await this.engine.get(`contact/${c.id}/index`);
                    const data: IContact = {
                        id: c.id,
                        me: c.id === (socket.user?.id ? jidNormalizedUser(socket.user.id) : null),
                        name: c.notify ?? c.name ?? c.id.split('@')[0],
                        phone: c.id.split('@')[0],
                        photo: null,
                    };
                    await this.engine.set(`contact/${c.id}/index`, JSON.stringify(data, BufferJSON.replacer));
                    this.event.emit(existing ? 'contact:updated' : 'contact:created', new this.Contact(data));
                }
            });

            socket.ev.on('contacts.update', async (contacts) => {
                console.log('[BAILEYS] contacts.update:', JSON.stringify(contacts, null, 2));
                for (const c of contacts) {
                    if (!c.id) continue;
                    const stored = await this.engine.get(`contact/${c.id}/index`);
                    if (!stored) continue;
                    const data: IContact = JSON.parse(stored, BufferJSON.reviver);
                    if (c.notify) data.name = c.notify;
                    if (c.name) data.name = c.name;
                    await this.engine.set(`contact/${c.id}/index`, JSON.stringify(data, BufferJSON.replacer));
                    this.event.emit('contact:updated', new this.Contact(data));
                }
            });

            // ═══════════════════════════════════════════════════════════════════
            // CHATS
            // ═══════════════════════════════════════════════════════════════════

            socket.ev.on('chats.upsert', async (chats) => {
                console.log('[BAILEYS] chats.upsert:', JSON.stringify(chats, null, 2));
                for (const ch of chats) {
                    const existing = await this.engine.get(`chat/${ch.id}/index`);
                    const data: IChat = existing
                        ? JSON.parse(existing, BufferJSON.reviver)
                        : {
                              id: ch.id,
                              name: ch.name ?? ch.id.split('@')[0],
                              type: ch.id.endsWith('@g.us') ? 'group' : 'contact',
                              pined: null,
                              archived: false,
                              muted: null,
                          };
                    if (ch.name) data.name = ch.name;
                    await this.engine.set(`chat/${ch.id}/index`, JSON.stringify(data, BufferJSON.replacer));
                    this.event.emit(existing ? 'chat:updated' : 'chat:created', new this.Chat(data));
                }
            });

            socket.ev.on('chats.update', async (chats) => {
                console.log('[BAILEYS] chats.update:', JSON.stringify(chats, null, 2));
                for (const ch of chats) {
                    if (!ch.id) continue;

                    const stored = await this.engine.get(`chat/${ch.id}/index`);
                    const data: IChat = stored
                        ? JSON.parse(stored, BufferJSON.reviver)
                        : {
                              id: ch.id,
                              name: ch.name ?? ch.id.split('@')[0],
                              type: ch.id.endsWith('@g.us') ? 'group' : 'contact',
                              pined: null,
                              archived: false,
                              muted: null,
                          };

                    if (ch.name !== undefined) data.name = ch.name ?? data.name;

                    let has_specific_event = false;

                    // Pin
                    if ('pinned' in ch) {
                        data.pined = (ch as { pinned?: number | null }).pinned ?? null;
                        this.event.emit('chat:pined', ch.id, data.pined);
                        has_specific_event = true;
                    }

                    // Archive
                    if (ch.archived !== undefined) {
                        data.archived = ch.archived ?? false;
                        this.event.emit('chat:archived', ch.id, data.archived);
                        has_specific_event = true;
                    }

                    // Mute
                    if ('muteEndTime' in ch) {
                        data.muted = (ch as { muteEndTime?: number | null }).muteEndTime ?? null;
                        this.event.emit('chat:muted', ch.id, data.muted);
                        has_specific_event = true;
                    }

                    await this.engine.set(`chat/${ch.id}/index`, JSON.stringify(data, BufferJSON.replacer));

                    if (!has_specific_event) {
                        this.event.emit(stored ? 'chat:updated' : 'chat:created', new this.Chat(data));
                    }
                }
            });

            socket.ev.on('chats.delete', async (ids) => {
                console.log('[BAILEYS] chats.delete:', JSON.stringify(ids, null, 2));
                for (const cid of ids) {
                    await this.engine.set(`chat/${cid}/index`, null);
                    this.event.emit('chat:deleted', cid);
                }
            });

            // ═══════════════════════════════════════════════════════════════════
            // MESSAGES
            // ═══════════════════════════════════════════════════════════════════

            socket.ev.on('messages.upsert', async ({ messages }) => {
                console.log('[BAILEYS] messages.upsert:', JSON.stringify(messages, null, 2));
                for (const msg of messages) {
                    if (!msg.key.remoteJid || !msg.key.id) continue;

                    const cid = msg.key.remoteJid;
                    const mid = msg.key.id;
                    const content_type = getContentType(msg.message ?? {});

                    // Ignorar reacciones y votos de encuesta (tienen sus propios eventos)
                    if (content_type === 'reactionMessage' || content_type === 'pollUpdateMessage') continue;

                    // ─────────────────────────────────────────────────────────────
                    // PROTOCOL MESSAGE (ediciones y eliminaciones)
                    // ─────────────────────────────────────────────────────────────
                    if (content_type === 'protocolMessage') {
                        const protocol = msg.message?.protocolMessage;
                        if (!protocol?.key?.id) continue;

                        const target_mid = protocol.key.id;
                        const target_cid = protocol.key.remoteJid ?? cid;

                        // MESSAGE_EDIT: Merge selectivo - reemplazar solo message
                        if (protocol.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT) {
                            const edited_msg = protocol.editedMessage;
                            if (!edited_msg) continue;

                            const stored = await this.engine.get(`chat/${target_cid}/message/${target_mid}/index`);
                            if (!stored) continue;

                            const data: IMessage = JSON.parse(stored, BufferJSON.reviver);
                            data.raw.message = edited_msg;
                            data.edited = true;

                            await this.engine.set(`chat/${target_cid}/message/${target_mid}/index`, JSON.stringify(data, BufferJSON.replacer));

                            const instance = new this.Message(data.raw, data.edited);
                            this.Message._notify(instance);
                            this.event.emit('message:updated', instance);
                            continue;
                        }

                        // REVOKE: Eliminar del engine
                        if (protocol.type === proto.Message.ProtocolMessage.Type.REVOKE) {
                            await this.engine.set(`chat/${target_cid}/message/${target_mid}/index`, null);
                            await this.engine.set(`chat/${target_cid}/message/${target_mid}/content`, null);
                            this.event.emit('message:deleted', target_cid, target_mid);
                        }
                        continue;
                    }

                    // ─────────────────────────────────────────────────────────────
                    // MENSAJE NUEVO
                    // ─────────────────────────────────────────────────────────────

                    const msg_type = MESSAGE_TYPE_MAP[content_type ?? ''] ?? 'text';

                    // Extraer content temporal del raw
                    const temp_content = await this._extract_content(msg, msg_type);

                    // Guardar en engine
                    const data: IMessage = { raw: msg, edited: false };
                    await this.engine.set(`chat/${cid}/message/${mid}/index`, JSON.stringify(data, BufferJSON.replacer));

                    // Pre-cache de media si está disponible
                    if (temp_content.length > 0) {
                        await this.engine.set(`chat/${cid}/message/${mid}/content`, temp_content.toString('base64'));
                    }

                    // Crear instancia con content temporal inyectado
                    const instance = new this.Message(msg, false);
                    if (temp_content.length > 0) {
                        instance.content = async () => temp_content;
                    }

                    this.Message._notify(instance);
                    this.event.emit('message:created', instance);
                }
            });

            socket.ev.on('messages.update', async (updates) => {
                console.log('[BAILEYS] messages.update:', JSON.stringify(updates, null, 2));
                for (const { key, update } of updates) {
                    if (!key.remoteJid || !key.id) continue;

                    const stored = await this.engine.get(`chat/${key.remoteJid}/message/${key.id}/index`);
                    if (!stored) continue;

                    const data: IMessage = JSON.parse(stored, BufferJSON.reviver);

                    // Edición via messages.update
                    if ((update as { message?: { editedMessage?: { message?: proto.IMessage } } }).message?.editedMessage?.message) {
                        data.raw.message = (update as { message: { editedMessage: { message: proto.IMessage } } }).message.editedMessage.message;
                        data.edited = true;
                        await this.engine.set(`chat/${key.remoteJid}/message/${key.id}/index`, JSON.stringify(data, BufferJSON.replacer));
                        const instance = new this.Message(data.raw, data.edited);
                        this.Message._notify(instance);
                        this.event.emit('message:updated', instance);
                        continue;
                    }

                    // Status update
                    if ((update as { status?: number }).status !== undefined) {
                        data.raw.status = (update as { status: number }).status;
                        await this.engine.set(`chat/${key.remoteJid}/message/${key.id}/index`, JSON.stringify(data, BufferJSON.replacer));
                    }
                }
            });

            socket.ev.on('messages.reaction', async (reactions) => {
                console.log('[BAILEYS] messages.reaction:', JSON.stringify(reactions, null, 2));
                for (const { key, reaction } of reactions) {
                    if (key.remoteJid && key.id) this.event.emit('message:reacted', key.remoteJid, key.id, reaction.text ?? '');
                }
            });
        };

        await connect();
    };

    /**
     * @description Extrae el contenido de un mensaje según su tipo.
     * @param msg WAMessage de Baileys.
     * @param msg_type Tipo de mensaje.
     * @returns Buffer con el contenido.
     */
    private async _extract_content(msg: WAMessage, msg_type: string): Promise<Buffer> {
        if (msg_type === 'text') {
            const content_type = getContentType(msg.message ?? {});
            const raw = msg.message?.[content_type as keyof typeof msg.message] as Record<string, unknown> | string | undefined;
            return Buffer.from(typeof raw === 'string' ? raw : (raw?.text as string) ?? (raw?.caption as string) ?? '', 'utf-8');
        }

        if (msg_type === 'location') {
            const loc = msg.message?.locationMessage ?? msg.message?.liveLocationMessage;
            return Buffer.from(JSON.stringify({ lat: loc?.degreesLatitude, lng: loc?.degreesLongitude }), 'utf-8');
        }

        if (msg_type === 'poll') {
            const poll = msg.message?.pollCreationMessage ?? msg.message?.pollCreationMessageV2 ?? msg.message?.pollCreationMessageV3;
            return Buffer.from(JSON.stringify({ content: poll?.name ?? '', options: poll?.options?.map((o) => ({ content: o.optionName })) ?? [] }), 'utf-8');
        }

        // Media: descargar de Baileys
        if (['image', 'video', 'audio'].includes(msg_type) && this._socket) {
            try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                if (Buffer.isBuffer(buffer)) return buffer;
            } catch {}
        }

        return Buffer.alloc(0);
    }
}
