/**
 * @file whatsapp/lib/handlers.ts
 * @description Procesamiento de los eventos de baileys. Cada función traduce un evento del
 * socket a documentos del engine y a los eventos que el cliente emite; `connect` las engancha
 * y nada de esto vive como estado de la clase.
 * Baileys event processing. Each function translates a socket event into engine documents and
 * into the events the client emits; `connect` wires them and none of this lives as class state.
 */

import {
    decryptPollVote,
    downloadMediaMessage,
    getContentType,
    jidNormalizedUser,
    proto,
    updateMessageWithPollUpdate,
    type Chat as BaileysChat,
    type Contact as BaileysContact,
    type MessageUserReceiptUpdate,
    type WAMessage,
    type WAMessageUpdate,
} from 'baileys';
import type { Chat } from '~/lib/chat';
import type { Contact } from '~/lib/contact';
import { internals } from '~/lib/internal';
import { message, type Message } from '~/lib/message';
import { Feed, TTL_MS as FEED_TTL_MS } from '~/lib/status';
import { deserialize, serialize } from '~/lib/store';
import type { WhatsApp } from '~/lib/whatsapp';

/** Documento persistido de un status broadcast, tal como lo construye el cliente. / Persisted status broadcast document, as built by the client. */
type FeedRaw = ConstructorParameters<typeof Feed>[1];

/** Rechazo del servidor: estado terminal, el único que puede retroceder el avance. / Server rejection: terminal state, the only one allowed to move the state backwards. */
const ERROR = 0;
/** Estados legibles del mensaje que el receipt puede avanzar. / Readable message states a receipt can advance to. */
const READ = 4;
const PLAYED = 5;

/**
 * Persiste un binario: crudo cuando el driver lo soporta, JSON con base64 si no.
 * Persists a binary: raw when the driver supports it, base64 JSON otherwise.
 *
 * @param wa - Cliente dueño / Owner client
 * @param path - Ruta del documento / Document path
 * @param data - Binario a guardar / Binary to store
 */
export async function write_content(wa: WhatsApp, path: string, data: Buffer): Promise<void> {
    if (wa.engine.set_buffer) {
        await wa.engine.set_buffer(path, data);
    } else {
        await wa.engine.set(path, serialize({ data: data.toString('base64') }));
    }
}

/**
 * Normaliza cualquier identificador (JID, LID, número, etc.) a JID canónico.
 * Normalizes any identifier (JID, LID, number…) into a canonical JID.
 *
 * @param wa - Cliente dueño / Owner client
 * @param uid - Identificador crudo / Raw identifier
 * @returns JID canónico, o null si no es determinable / Canonical JID, or null when undeterminable
 */
export async function resolve_jid(wa: WhatsApp, uid: string): Promise<string | null> {
    let result: string | null = null;
    if (uid.endsWith('@g.us') || uid.endsWith('@s.whatsapp.net')) {
        result = uid;
    } else if (uid.endsWith('@lid')) {
        // Los receipts direccionan por dispositivo (`…:9@lid`); el índice se guarda sin él.
        // Receipts address per device (`…:9@lid`); the index is stored without it.
        const lid = jidNormalizedUser(uid);
        const direct = deserialize<string>(await wa.engine.get(`/lid/${lid}`));
        if (direct) {
            result = direct.includes('@') ? direct : `${direct}@s.whatsapp.net`;
        } else {
            const reverse = deserialize<string | number>(
                await wa.engine.get(`/lid/${lid.split('@')[0]}_reverse`)
            );
            if (reverse != null) {
                result = `${reverse}@s.whatsapp.net`;
            } else {
                // El store local puede no tener el mapping (sesión sin upsert del contacto);
                // baileys lo conoce vía su lidMapping. Sin esto, un chat referenciado por @lid
                // (p.ej. el pollCreationMessageKey de un voto entrante) no resuelve al PN donde
                // realmente está guardado, y el mensaje/poll no se encuentra.
                const pn = await (internals(wa).socket as unknown as {
                    signalRepository?: { lidMapping?: { getPNForLID(lid: string): Promise<string | null | undefined> } };
                } | null)?.signalRepository?.lidMapping?.getPNForLID(lid).catch(() => null);
                if (pn) {
                    // getPNForLID puede traer sufijo de dispositivo (`:0`); se normaliza para
                    // que el JID coincida con el que usa el store (sin device).
                    result = jidNormalizedUser(pn.includes('@') ? pn : `${pn}@s.whatsapp.net`);
                }
            }
        }
    } else {
        const cleaned = uid.replace(/\D/g, '');
        if (cleaned) {
            result = `${cleaned}@s.whatsapp.net`;
        }
    }
    return result;
}

/**
 * Ubica el documento de un mensaje partiendo del chat crudo del key. Los updates y receipts
 * llegan direccionados por LID —con o sin dispositivo— mientras el documento vive bajo el JID
 * con el que se guardó, así que se prueban ambas formas.
 * Locates a message document from the raw chat in the key. Updates and receipts arrive
 * LID-addressed —with or without device— while the document lives under the JID it was stored
 * with, so both forms are tried.
 *
 * @param wa - Cliente dueño / Owner client
 * @param cid - Chat tal como viene en el key / Chat as it comes in the key
 * @param mid - Identificador del mensaje / Message identifier
 * @returns Ruta y documento, o null si no existe / Path and document, or null when missing
 */
export async function locate(wa: WhatsApp, cid: string, mid: string): Promise<{ path: string; doc: Message['_raw'] } | null> {
    const tried = new Set<string>();
    for (const candidate of [await resolve_jid(wa, cid), cid, jidNormalizedUser(cid)]) {
        if (candidate && !tried.has(candidate)) {
            tried.add(candidate);
            const path = `/chat/${candidate}/message/${mid}`;
            const doc = deserialize<Message['_raw']>(await wa.engine.get(path));
            if (doc) {
                return { path, doc };
            }
        }
    }
    return null;
}

/**
 * Persiste un contacto y su índice LID, fusionando con lo ya guardado, y avisa del cambio.
 * Persists a contact and its LID index, merging with what is already stored, and announces it.
 *
 * @param wa - Cliente dueño / Owner client
 * @param raw - Documento del contacto a persistir / Contact document to persist
 */
export async function persist_contact(wa: WhatsApp, raw: Contact['_raw']): Promise<void> {
    const current = deserialize<Contact['_raw']>(await wa.engine.get(`/contact/${raw.id}`));
    // Los upserts del re-sync llegan con los campos vacíos: sin fusionar borran el nombre
    // que ya se conocía y el chat pasa a mostrar el número pelado.
    // Re-sync upserts arrive with empty fields: without merging they wipe the name already
    // known and the chat falls back to showing the bare number.
    const doc: Contact['_raw'] = current
        ? {
            id: raw.id,
            lid: raw.lid ?? current.lid,
            name: raw.name ?? current.name,
            notify: raw.notify ?? current.notify,
            verified_name: raw.verified_name ?? current.verified_name,
            img_url: raw.img_url ?? current.img_url,
            status: raw.status ?? current.status,
        }
        : raw;
    await wa.engine.set(`/contact/${raw.id}`, serialize(doc));
    if (doc.lid) {
        await wa.engine.set(`/lid/${doc.lid}`, serialize(doc.id));
    }
    // Una ficha que existía vacía y ahora tiene nombre es un cambio que el consumidor
    // necesita: sin avisar, quien memorice el contacto sigue mostrando el número.
    // A card that existed empty and now has a name is a change the consumer needs: without
    // notifying, whoever memoized the contact keeps showing the bare number.
    const changed = current && (['lid', 'name', 'notify', 'verified_name', 'img_url', 'status'] as const).some((key) => current[key] !== doc[key]);
    if (!current || changed) {
        const person = new wa.Contact(doc);
        const cached_chat = deserialize<Chat['_raw']>(await wa.engine.get(`/chat/${doc.id}`));
        const chat = new wa.Chat(cached_chat ?? { id: doc.id, name: person.name });
        wa.emit(current ? 'contact:updated' : 'contact:created', person, chat, wa);
    }
}

/**
 * Alta o actualización de contactos que llega del sync.
 * Contact insert or update coming from the sync.
 *
 * @param wa - Cliente dueño / Owner client
 * @param contacts - Contactos reportados por baileys / Contacts reported by baileys
 */
export async function on_contacts_upsert(wa: WhatsApp, contacts: BaileysContact[]): Promise<void> {
    for (const c of contacts) {
        if (c.id) {
            await persist_contact(wa, {
                id: c.id,
                lid: c.lid ?? null,
                name: c.name ?? null,
                notify: c.notify ?? null,
                verified_name: c.verifiedName ?? null,
                img_url: c.imgUrl ?? null,
                status: c.status ?? null,
            });
        }
    }
}

/**
 * Parche parcial sobre contactos ya conocidos.
 * Partial patch over already known contacts.
 *
 * @param wa - Cliente dueño / Owner client
 * @param contacts - Cambios reportados por baileys / Changes reported by baileys
 */
export async function on_contacts_update(wa: WhatsApp, contacts: Partial<BaileysContact>[]): Promise<void> {
    for (const c of contacts) {
        if (c.id) {
            const current = deserialize<Contact['_raw']>(await wa.engine.get(`/contact/${c.id}`));
            if (current) {
                const patch: Partial<Contact['_raw']> = {
                    ...(c.notify && { notify: c.notify }),
                    ...(c.name && { name: c.name }),
                    ...(c.verifiedName && { verified_name: c.verifiedName }),
                    ...(c.imgUrl && { img_url: c.imgUrl }),
                    ...(c.status && { status: c.status }),
                    ...(c.lid && { lid: c.lid }),
                };
                if (Object.keys(patch).length > 0) {
                    const merged = { ...current, ...patch };
                    await wa.engine.set(`/contact/${c.id}`, serialize(merged));
                    if (patch.lid) {
                        await wa.engine.set(`/lid/${patch.lid}`, serialize(c.id));
                    }
                    const person = new wa.Contact(merged);
                    const cached_chat = deserialize<Chat['_raw']>(await wa.engine.get(`/chat/${c.id}`));
                    wa.emit('contact:updated', person, new wa.Chat(cached_chat ?? { id: c.id, name: person.name }), wa);
                }
            }
        }
    }
}

/**
 * Equivalencia LID ↔ teléfono que publica baileys.
 * LID ↔ phone mapping baileys publishes.
 *
 * @param wa - Cliente dueño / Owner client
 * @param lid - Identificador LID / LID identifier
 * @param pn - Teléfono equivalente / Equivalent phone
 */
export async function on_lid_mapping(wa: WhatsApp, lid: string, pn: string): Promise<void> {
    await wa.engine.set(`/lid/${lid}`, serialize(pn));
    await wa.engine.set(`/lid/${pn}`, serialize(lid));
}

/**
 * Alta de chats del sync. El documento se escribe con su actividad como score, que es lo
 * que ordena la lista.
 * Chat insert from the sync. The document is written with its activity as score, which is
 * what orders the list.
 *
 * @param wa - Cliente dueño / Owner client
 * @param chats - Chats reportados por baileys / Chats reported by baileys
 */
export async function on_chats_upsert(wa: WhatsApp, chats: BaileysChat[]): Promise<void> {
    for (const ch of chats) {
        if (ch.id) {
            const current = deserialize<Chat['_raw']>(await wa.engine.get(`/chat/${ch.id}`));
            const raw: Chat['_raw'] = current ?? {
                id: ch.id,
                name: ch.name ?? null,
                archived: ch.archived ?? null,
                pinned: ch.pinned ?? null,
                mute_end_time: ch.muteEndTime != null ? Number(ch.muteEndTime) : null,
                unread_count: ch.unreadCount ?? null,
            };
            if (ch.name) {
                raw.name = ch.name;
            }
            // El sync trae la última actividad del chat; sin ella la lista quedaría ordenada
            // por el momento en que se escribió cada documento. El último mensaje persistido
            // es el respaldo para los documentos guardados antes de que el campo existiera.
            // The sync carries the chat's last activity; without it the list would be ordered by
            // the moment each document happened to be written. The last persisted message is the
            // fallback for documents stored before the field existed.
            const stamp = ch.conversationTimestamp != null ? Number(ch.conversationTimestamp) * 1_000 : null;
            const [newest] = await wa.engine.list(`/chat/${ch.id}/message`, 0, 1);
            const persisted = deserialize<Message['_raw']>(newest ?? null)?.created_at ?? 0;
            raw.activity = Math.max(stamp ?? 0, raw.activity ?? 0, persisted) || null;
            await wa.engine.set(`/chat/${ch.id}`, serialize(raw), raw.activity ?? 0);
            if (current === null) {
                wa.emit('chat:created', new wa.Chat(raw), wa);
            }
        }
    }
}

/**
 * Cambios de banderas del chat: nombre, fijado, archivado, silencio y no leídos.
 * Chat flag changes: name, pinned, archived, mute and unread.
 *
 * @param wa - Cliente dueño / Owner client
 * @param chats - Cambios reportados por baileys / Changes reported by baileys
 */
export async function on_chats_update(wa: WhatsApp, chats: Partial<BaileysChat>[]): Promise<void> {
    for (const ch of chats) {
        if (ch.id && ch.id !== 'status@broadcast') {
            const current = deserialize<Chat['_raw']>(await wa.engine.get(`/chat/${ch.id}`)) ?? {
                id: ch.id,
                name: ch.name ?? null,
            };
            const patch: Partial<Chat['_raw']> = {};
            const pinned_changed = 'pinned' in ch;
            const archived_changed = ch.archived !== undefined;
            const mute_changed = 'muteEndTime' in ch;

            if (ch.name) {
                patch.name = ch.name;
            }
            if (pinned_changed) {
                patch.pinned = ch.pinned ?? null;
            }
            if (archived_changed) {
                patch.archived = ch.archived ?? false;
            }
            if (mute_changed) {
                patch.mute_end_time = ch.muteEndTime != null ? Number(ch.muteEndTime) : null;
            }
            if (ch.unreadCount != null) {
                patch.unread_count = ch.unreadCount;
            }
            if (Object.keys(patch).length > 0) {
                const merged: Chat['_raw'] = { ...current, ...patch };
                // Fijar, archivar o silenciar no es actividad: el chat conserva su posición.
                // Pinning, archiving or muting is not activity: the chat keeps its position.
                await wa.engine.set(`/chat/${ch.id}`, serialize(merged), merged.activity ?? undefined);

                if (pinned_changed) {
                    wa.emit(ch.pinned != null ? 'chat:pinned' : 'chat:unpinned', new wa.Chat(merged), wa);
                }
                if (archived_changed) {
                    wa.emit(ch.archived ? 'chat:archived' : 'chat:unarchived', new wa.Chat(merged), wa);
                }
                if (mute_changed) {
                    const is_muted = patch.mute_end_time != null && patch.mute_end_time > Date.now();
                    wa.emit(is_muted ? 'chat:muted' : 'chat:unmuted', new wa.Chat(merged), wa);
                }
            }
        }
    }
}

/**
 * Borrado de chats.
 * Chat deletion.
 *
 * @param wa - Cliente dueño / Owner client
 * @param ids - Chats eliminados / Deleted chats
 */
export async function on_chats_delete(wa: WhatsApp, ids: string[]): Promise<void> {
    for (const cid of ids) {
        const raw = deserialize<Chat['_raw']>(await wa.engine.get(`/chat/${cid}`)) ?? { id: cid };
        await wa.engine.unset(`/chat/${cid}`);
        wa.emit('chat:deleted', new wa.Chat(raw), wa);
    }
}

/**
 * Acuse de lectura o reproducción sobre un mensaje propio.
 * Read or played receipt over one of our messages.
 *
 * @param wa - Cliente dueño / Owner client
 * @param updates - Receipts reportados por baileys / Receipts reported by baileys
 */
export async function on_message_receipt(wa: WhatsApp, updates: MessageUserReceiptUpdate[]): Promise<void> {
    for (const { key, receipt } of updates) {
        // Receipt sobre status@broadcast → marca el feed como visto y emite feed:updated.
        // Receipt on status@broadcast → marks feed viewed and emits feed:updated.
        if (key.remoteJid === 'status@broadcast' && key.id) {
            const feed_raw = deserialize<FeedRaw>(await wa.engine.get(`/status/${key.id}`));
            if (feed_raw && !feed_raw.viewed) {
                feed_raw.viewed = true;
                await wa.engine.set(`/status/${key.id}`, serialize(feed_raw));
                wa.emit('feed:updated', new Feed(wa, feed_raw), wa);
            }
            continue;
        }
        if (key.remoteJid && key.id && (receipt.readTimestamp != null || receipt.playedTimestamp != null)) {
            const found = await locate(wa, key.remoteJid, key.id);
            if (found) {
                const { path, doc } = found;
                const next = receipt.playedTimestamp != null ? PLAYED : READ;
                if (doc.status < next) {
                    doc.status = next;
                    doc.raw.status = next as unknown as WAMessage['status'];
                    await wa.engine.set(path, serialize(doc), doc.created_at);
                }
                const msg_instance = message(wa, doc);
                wa.emit('message:seen', msg_instance, await msg_instance.chat(), wa);
            }
        }
    }
}

/**
 * Mensajes entrantes y del historial: reacciones, status broadcasts, votos de encuesta,
 * ediciones, revocaciones y altas normales con su binario.
 * Incoming and history messages: reactions, status broadcasts, poll votes, edits, revokes and
 * regular inserts with their binary.
 *
 * @param wa - Cliente dueño / Owner client
 * @param messages - Mensajes reportados por baileys / Messages reported by baileys
 */
export async function on_messages_upsert(wa: WhatsApp, messages: WAMessage[]): Promise<void> {
    for (const msg of messages) {
        if (msg.key?.remoteJid && msg.key.id) {
            const cid = (msg.key as { remoteJidAlt?: string }).remoteJidAlt ?? msg.key.remoteJid;
            const mid = msg.key.id;
            const content_type = getContentType(msg.message ?? {});

            if (content_type === 'reactionMessage') {
                // Canal único para reacciones: se procesa aquí y se ignora `messages.reaction`.
                // Single channel for reactions: handled here; `messages.reaction` is disabled.
                const reaction = msg.message?.reactionMessage;
                if (reaction?.key?.id && reaction.key.remoteJid) {
                    const target_cid = (await resolve_jid(wa, reaction.key.remoteJid)) ?? reaction.key.remoteJid;
                    await on_messages_reaction(wa, [{
                        key: {
                            remoteJid: target_cid,
                            id: reaction.key.id,
                            participant: msg.key.fromMe ? (internals(wa).socket?.user?.id ?? null) : (msg.key.participant ?? cid),
                        },
                        reaction: { text: reaction.text ?? '' },
                    }]);
                }
                continue;
            }

            // Status broadcast — flujo dedicado. Nunca emite `message:*`.
            // Status broadcast — dedicated flow. Never emits `message:*`.
            if (msg.key.remoteJid === 'status@broadcast') {
                if (content_type === 'protocolMessage') {
                    const protocol = msg.message?.protocolMessage;
                    if (protocol?.type === proto.Message.ProtocolMessage.Type.REVOKE && protocol.key?.id) {
                        const feed_raw = deserialize<FeedRaw>(await wa.engine.get(`/status/${protocol.key.id}`));
                        if (feed_raw) {
                            await wa.engine.unset(`/status/${protocol.key.id}`);
                            wa.emit('feed:deleted', new Feed(wa, feed_raw), wa);
                        }
                    }
                    continue;
                }
                const FEED_TYPE_MAP: Record<string, FeedRaw['type']> = {
                    conversation: 'text',
                    extendedTextMessage: 'text',
                    imageMessage: 'image',
                    videoMessage: 'video',
                    audioMessage: 'audio',
                };
                const feed_type = FEED_TYPE_MAP[content_type ?? ''];
                const author = msg.key.participant ?? '';
                if (!feed_type || !author) {
                    continue;
                }
                const msg_content = msg.message?.[content_type as keyof typeof msg.message] as
                    | Record<string, unknown>
                    | string
                    | undefined;
                let caption = '';
                let mime = 'text/plain';
                if (typeof msg_content === 'string') {
                    caption = msg_content;
                } else if (msg_content && typeof msg_content === 'object') {
                    caption = (msg_content.caption as string) ?? (msg_content.text as string) ?? '';
                    if (feed_type !== 'text') {
                        mime = (msg_content.mimetype as string) ?? 'application/octet-stream';
                    }
                }
                const created_at = (Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000;
                const feed_raw: FeedRaw = {
                    id: mid,
                    author_jid: author,
                    type: feed_type,
                    caption,
                    mime,
                    created_at,
                    expires_at: created_at + FEED_TTL_MS,
                    viewed: false,
                    raw: msg,
                };
                let content_buf: Buffer = Buffer.alloc(0);
                if (feed_type === 'text') {
                    content_buf = Buffer.from(caption, 'utf-8');
                } else if (internals(wa).socket) {
                    try {
                        const buf = await downloadMediaMessage(msg, 'buffer', {});
                        if (Buffer.isBuffer(buf)) {
                            content_buf = buf as unknown as Buffer;
                        }
                    } catch {
                        /* media download may fail */
                    }
                }
                await wa.engine.set(`/status/${mid}`, serialize(feed_raw));
                if (content_buf.length > 0) {
                    await write_content(wa, `/status/${mid}/content`, content_buf);
                }
                wa.emit('feed:created', new Feed(wa, feed_raw), wa);
                continue;
            }

            if (content_type === 'pollUpdateMessage') {
                const update = msg.message?.pollUpdateMessage;
                const creation_key = update?.pollCreationMessageKey;
                if (creation_key?.id && creation_key.remoteJid && update?.vote?.encPayload && update.vote.encIv) {
                    const resolved_cid = (await resolve_jid(wa, creation_key.remoteJid)) ?? creation_key.remoteJid;
                    const target_mid = creation_key.id;
                    const poll_doc = deserialize<Message['_raw']>(
                        await wa.engine.get(`/chat/${resolved_cid}/message/${target_mid}`)
                    );
                    const secret_raw = poll_doc?.raw.message?.messageContextInfo?.messageSecret;
                    const message_secret =
                        typeof secret_raw === 'string' ? Buffer.from(secret_raw, 'base64') : secret_raw;
                    if (poll_doc && message_secret) {
                        try {
                            const poll_key = poll_doc.raw.key ?? {};
                            // La identidad propia del HMAC depende del addressing del chat
                            // (LID en @lid, PN en @s.whatsapp.net), así que para las posiciones
                            // fromMe se intenta descifrar con ambas: AES-GCM autentica, la
                            // clave equivocada lanza y se prueba la siguiente.
                            // Own HMAC identity depends on chat addressing (LID on @lid, PN on
                            // @s.whatsapp.net), so fromMe positions try both candidates:
                            // AES-GCM authenticates, a wrong key throws and the next is tried.
                            const self_id = internals(wa).socket?.user?.id ?? '';
                            const self_lid = (internals(wa).socket?.user as { lid?: string })?.lid ?? '';
                            const selves = [...new Set([self_lid, self_id].filter(Boolean))];
                            // Candidatos foráneos: todas las formas de identidad del key (LID,
                            // participant, alt, remoteJid); se prueban todas porque el addressing
                            // del stanza varía (LID vs PN) según la migración del contacto.
                            const foreign_of = (k: { remoteJid?: string | null; participant?: string | null; remoteJidAlt?: string }): string[] =>
                                [...new Set([k.remoteJid, k.participant, k.remoteJidAlt, k.remoteJid].filter((x): x is string => Boolean(x)))];
                            const voters = msg.key.fromMe ? selves : foreign_of(msg.key);
                            const creators = poll_key.fromMe ? selves : foreign_of(poll_key);
                            let decrypted: ReturnType<typeof decryptPollVote> | null = null;
                            for (const voter of voters) {
                                for (const creator of creators) {
                                    try {
                                        decrypted = decryptPollVote(
                                            { encPayload: update.vote.encPayload, encIv: update.vote.encIv },
                                            {
                                                pollCreatorJid: jidNormalizedUser(creator),
                                                pollMsgId: target_mid,
                                                pollEncKey: message_secret,
                                                voterJid: jidNormalizedUser(voter),
                                            }
                                        );
                                        break;
                                    } catch {
                                        /* identidad equivocada: probar la siguiente */
                                    }
                                }
                                if (decrypted) {
                                    break;
                                }
                            }
                            if (decrypted) {
                                updateMessageWithPollUpdate(poll_doc.raw, {
                                    pollUpdateMessageKey: msg.key,
                                    vote: decrypted,
                                    senderTimestampMs: Number(msg.messageTimestamp) || Date.now(),
                                });
                                await wa.engine.set(
                                    `/chat/${resolved_cid}/message/${target_mid}`,
                                    serialize(poll_doc),
                                    poll_doc.created_at
                                );
                                const msg_instance = message(wa, poll_doc);
                                wa.emit('message:updated', msg_instance, await msg_instance.chat(), wa);
                            }
                        } catch {
                            /* decrypt may fail */
                        }
                    }
                }
                continue;
            }

            if (content_type === 'protocolMessage') {
                const protocol = msg.message?.protocolMessage;
                if (protocol?.key?.id) {
                    const target_mid = protocol.key.id;
                    const target_cid = protocol.key.remoteJid ?? cid;
                    const doc = deserialize<Message['_raw']>(
                        await wa.engine.get(`/chat/${target_cid}/message/${target_mid}`)
                    );

                    if (protocol.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT && protocol.editedMessage && doc) {
                        doc.raw.message = protocol.editedMessage;
                        doc.edited = true;
                        doc.caption = message(wa, doc.raw).caption;
                        await wa.engine.set(`/chat/${target_cid}/message/${target_mid}`, serialize(doc), doc.created_at);
                        const msg_instance = message(wa, doc);
                        wa.emit('message:updated', msg_instance, await msg_instance.chat(), wa);
                    } else if (protocol.type === proto.Message.ProtocolMessage.Type.REVOKE) {
                        await wa.engine.unset(`/chat/${target_cid}/message/${target_mid}`);
                        if (doc) {
                            const msg_instance = message(wa, doc);
                            wa.emit('message:deleted', msg_instance, await msg_instance.chat(), wa);
                        }
                    }
                }
                continue;
            }

            const doc = message(wa, msg)._raw;

            // Cada reconexión re-entrega el historial completo: reescribir documentos
            // idénticos contamina la cronología, re-descarga la media y spamea eventos,
            // así que un doc ya persistido sin cambios visibles se salta entero.
            // Every reconnect re-delivers the full history: rewriting identical documents
            // pollutes chronology, re-downloads media and spams events, so an already
            // persisted doc without visible changes is skipped entirely.
            const existing_doc = deserialize<Message['_raw']>(await wa.engine.get(`/chat/${cid}/message/${mid}`));
            if (existing_doc) {
                if (typeof existing_doc.multiple === 'boolean') {
                    doc.multiple = existing_doc.multiple;
                }
                if (existing_doc.reactions) {
                    doc.reactions = existing_doc.reactions;
                }
                // El historial reporta el estado que tenía al sincronizarse: si acá se reescribe
                // por otro cambio (edición, destacado), el estado ya conocido se conserva.
                // History reports the state it had when synced: if the doc gets rewritten here
                // for another change (edit, star), the state already known is kept.
                if (existing_doc.status > doc.status) {
                    doc.status = existing_doc.status;
                }
                if (
                    existing_doc.status >= doc.status &&
                    existing_doc.caption === doc.caption &&
                    existing_doc.edited === doc.edited &&
                    existing_doc.starred === doc.starred
                ) {
                    continue;
                }
            }

            // Autocreación de contacto/chat desde pushName cuando baileys no emite upsert previo
            if (!existing_doc && !doc.me) {
                const push_name = msg.pushName ?? null;
                const is_group = cid.endsWith('@g.us');

                // El contacto se completa cuando no existe y también cuando existe sin ningún
                // nombre: el mensaje trae el pushName y el nombre del negocio verificado, que
                // es lo único que queda si un re-sync anterior dejó la ficha en blanco.
                // The contact is filled in when missing and also when it exists with no name at
                // all: the message carries the pushName and the verified business name, the only
                // thing left when an earlier re-sync blanked the card.
                if (doc.author) {
                    const known = deserialize<Contact['_raw']>(await wa.engine.get(`/contact/${doc.author}`));
                    if (!known || !(known.name ?? known.notify ?? known.verified_name)) {
                        await persist_contact(wa, {
                            id: doc.author,
                            lid: msg.key.remoteJid?.endsWith('@lid') ? msg.key.remoteJid : null,
                            name: null,
                            notify: push_name,
                            verified_name: msg.verifiedBizName ?? null,
                            img_url: null,
                            status: null,
                        });
                    }
                }

                if (!(await wa.engine.get(`/chat/${cid}`))) {
                    const chat_raw: Chat['_raw'] = {
                        id: cid,
                        name: is_group ? null : push_name,
                        activity: doc.created_at,
                    };
                    await wa.engine.set(`/chat/${cid}`, serialize(chat_raw), doc.created_at);
                    wa.emit('chat:created', new wa.Chat(chat_raw), wa);
                }
            }

            await wa.engine.set(`/chat/${cid}/message/${mid}`, serialize(doc), doc.created_at);

            // El mensaje más nuevo define la posición del chat en la lista; un mensaje viejo
            // que llega en un re-sync no la altera.
            // The newest message defines the chat's position in the list; an old message
            // arriving in a re-sync does not move it.
            const chat_doc = deserialize<Chat['_raw']>(await wa.engine.get(`/chat/${cid}`));
            if (chat_doc && doc.created_at > (chat_doc.activity ?? 0)) {
                chat_doc.activity = doc.created_at;
                await wa.engine.set(`/chat/${cid}`, serialize(chat_doc), doc.created_at);
            }

            // El binario solo se materializa en la primera entrega; en re-syncs ya vive en el engine.
            // The binary is only materialized on first delivery; on re-syncs it already lives in the engine.
            let content_buf: Buffer = Buffer.alloc(0);
            if (existing_doc) {
                /* ya materializado / already materialized */
            } else if (doc.type === 'text') {
                content_buf = Buffer.from(doc.caption, 'utf-8');
            } else if (doc.type === 'location') {
                const loc = msg.message?.locationMessage ?? msg.message?.liveLocationMessage;
                content_buf = Buffer.from(
                    JSON.stringify({ lat: loc?.degreesLatitude, lng: loc?.degreesLongitude }),
                    'utf-8'
                );
            } else if (doc.type === 'poll') {
                const poll =
                    msg.message?.pollCreationMessage ??
                    msg.message?.pollCreationMessageV2 ??
                    msg.message?.pollCreationMessageV3;
                content_buf = Buffer.from(
                    JSON.stringify({
                        content: poll?.name ?? '',
                        options: poll?.options?.map((o) => ({ content: o.optionName })) ?? [],
                    }),
                    'utf-8'
                );
            } else if (doc.type === 'vcard') {
                const cards = msg.message?.contactsArrayMessage?.contacts ?? (msg.message?.contactMessage ? [msg.message.contactMessage] : []);
                content_buf = Buffer.from(cards.map((c) => c.vcard ?? '').join('\n'), 'utf-8');
            } else if (doc.type === 'event') {
                content_buf = Buffer.from(JSON.stringify(msg.message?.eventMessage ?? {}), 'utf-8');
            } else if (internals(wa).socket && ['image', 'video', 'audio', 'document'].includes(doc.type)) {
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    if (Buffer.isBuffer(buffer)) {
                        content_buf = buffer as unknown as Buffer;
                    }
                } catch {
                    /* media download may fail */
                }
            }

            if (content_buf.length > 0) {
                await write_content(wa, `/chat/${cid}/message/${mid}/content`, content_buf);
            }

            const instance = message(wa, doc);
            const chat_instance = await instance.chat();
            wa.emit('message:created', instance, chat_instance, wa);
            if (doc.forwarded) {
                wa.emit('message:forwarded', instance, chat_instance, wa);
            }
        }
    }
}

/**
 * Cambios sobre mensajes ya persistidos: edición, contenido, destacado y estado de entrega.
 * Changes over already persisted messages: edit, content, star and delivery state.
 *
 * @param wa - Cliente dueño / Owner client
 * @param updates - Cambios reportados por baileys / Changes reported by baileys
 */
export async function on_messages_update(wa: WhatsApp, updates: WAMessageUpdate[]): Promise<void> {
    for (const { key, update: upd } of updates) {
        if (key.remoteJid && key.id) {
            // Updates sobre `status@broadcast` se descartan: el feed sólo se
            // muta vía reacciones (`messages.reaction`), `Feed.view()` o REVOKE.
            // Updates on `status@broadcast` are discarded: feed mutates only via
            // reactions, `Feed.view()` or REVOKE.
            if (key.remoteJid === 'status@broadcast') {
                continue;
            }
            const found = await locate(wa, key.remoteJid, key.id);
            if (found) {
                const { path, doc } = found;
                const raw: WAMessage = doc.raw ?? { key };
                const upd_any = upd as {
                    message?: proto.IMessage & { editedMessage?: { message?: proto.IMessage } };
                    status?: number;
                    starred?: boolean;
                    messageStubParameters?: (string | null)[];
                };
                const edited_message = upd_any.message?.editedMessage?.message;
                const content_update = upd_any.message;
                const status = upd_any.status;
                const starred_changed = upd_any.starred !== undefined;

                if (edited_message) {
                    raw.message = edited_message;
                    doc.raw = raw;
                    doc.edited = true;
                    doc.caption = message(wa, raw).caption;
                    await wa.engine.set(path, serialize(doc), doc.created_at);
                    const msg_instance = message(wa, doc);
                    wa.emit('message:updated', msg_instance, await msg_instance.chat(), wa);
                } else if (content_update) {
                    // Actualización de contenido (ej: live location). Mergea sobre el raw existente.
                    raw.message = { ...raw.message, ...content_update };
                    doc.raw = raw;
                    doc.caption = message(wa, raw).caption;
                    await wa.engine.set(path, serialize(doc), doc.created_at);
                    const msg_instance = message(wa, doc);
                    wa.emit('message:updated', msg_instance, await msg_instance.chat(), wa);
                } else if (starred_changed) {
                    doc.starred = upd_any.starred === true;
                    raw.starred = doc.starred;
                    doc.raw = raw;
                    await wa.engine.set(path, serialize(doc), doc.created_at);
                    const msg_instance = message(wa, doc);
                    wa.emit(doc.starred ? 'message:starred' : 'message:unstarred', msg_instance, await msg_instance.chat(), wa);
                }
                // WhatsApp reemite los acks desordenados al reconectar (un `sent` después de un
                // `delivered`), así que el estado solo avanza; el rechazo (`error`) es terminal
                // y sí puede pisar lo que hubiera.
                // WhatsApp re-emits acks out of order on reconnect (a `sent` after a `delivered`),
                // so the state only moves forward; a rejection (`error`) is terminal and may
                // override whatever was there.
                else if (status !== undefined && (status > doc.status || status === ERROR)) {
                    raw.status = status;
                    doc.status = status;
                    // El rechazo del servidor viaja como stub del update; sin persistirlo el
                    // mensaje queda en error sin decir por qué.
                    // The server rejection travels as an update stub; without persisting it the
                    // message stays in error without saying why.
                    if (upd_any.messageStubParameters) {
                        raw.messageStubParameters = upd_any.messageStubParameters;
                    }
                    doc.raw = raw;
                    await wa.engine.set(path, serialize(doc), doc.created_at);
                    const msg_instance = message(wa, doc);
                    wa.emit('message:updated', msg_instance, await msg_instance.chat(), wa);
                }
            }
        }
    }
}

/**
 * Reacción sobre un mensaje o sobre un status broadcast.
 * Reaction over a message or over a status broadcast.
 *
 * @param wa - Cliente dueño / Owner client
 * @param reactions - Reacciones normalizadas desde el upsert / Reactions normalized from the upsert
 */
export async function on_messages_reaction(
    wa: WhatsApp,
    reactions: Array<{
        key: { remoteJid?: string | null; id?: string | null; participant?: string | null };
        reaction: { text?: string | null };
    }>
): Promise<void> {
    for (const { key, reaction } of reactions) {
        if (key.remoteJid && key.id) {
            // Reacciones sobre status@broadcast → feed:updated (no message:reacted).
            // Reactions on status@broadcast → feed:updated (not message:reacted).
            if (key.remoteJid === 'status@broadcast') {
                const feed_raw = deserialize<FeedRaw>(await wa.engine.get(`/status/${key.id}`));
                if (feed_raw) {
                    wa.emit('feed:updated', new Feed(wa, feed_raw), wa);
                }
                continue;
            }
            const found = await locate(wa, key.remoteJid, key.id);
            if (found) {
                const { path, doc } = found;
                const reactor = jidNormalizedUser(key.participant ?? key.remoteJid);
                const emoji = reaction.text ?? '';
                doc.reactions = [
                    ...(doc.reactions ?? []).filter((r) => r.author !== reactor),
                    ...(emoji ? [{ author: reactor, emoji, at: Date.now() }] : []),
                ];
                await wa.engine.set(path, serialize(doc), doc.created_at);
                const msg_instance = message(wa, doc);
                wa.emit('message:reacted', msg_instance, await msg_instance.chat(), reaction.text ?? '', wa);
            }
        }
    }
}
