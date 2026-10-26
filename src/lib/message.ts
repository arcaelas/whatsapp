/**
 * @file message.ts
 * @description Entidad Message — cada mensaje es su timeline: los raws exactos que baileys emitió
 * para él, en orden de llegada, y cada getter busca su valor en reversa. Hereda los envíos de
 * `Sender`, que en un mensaje lo citan. Las subclases por tipo viven aquí.
 * Message entity — every message is its timeline: the exact raws baileys emitted for it, in arrival
 * order, and every getter looks its value up backwards. It inherits the sends of `Sender`, which on a
 * message quote it. The per-type subclasses live here.
 */

import {
    aesEncryptGCM,
    decryptEventResponse,
    decryptPollVote,
    downloadMediaMessage,
    generateForwardMessageContent,
    generateWAMessageFromContent,
    getAggregateVotesInPollMessage,
    getContentType,
    hmacSign,
    jidNormalizedUser,
    normalizeMessageContent,
    proto,
    sha256,
    toNumber,
    type LIDMapping,
    type MessageUserReceiptUpdate,
    type WAMessage,
    type WAMessageKey,
    type WAMessageUpdate,
} from 'baileys';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Chat } from '~/lib/chat';
import type { Contact } from '~/lib/contact';
import sender, { internal, route, type Route } from '~/lib/sender';
import { deserialize } from '~/lib/store';
import type { Instance, WatchEvent } from '~/lib/whatsapp';

/**
 * Lo que entra al timeline, tal como lo emite baileys: el mensaje y los que lo refieren
 * (`messages.upsert`), sus cambios (`messages.update`), sus recibos (`message-receipt.update`) y el
 * mapeo que traduce su chat (`lid-mapping.update`).
 * What enters the timeline, exactly as baileys emits it: the message and the ones referring to it
 * (`messages.upsert`), its changes (`messages.update`), its receipts (`message-receipt.update`) and
 * the mapping that translates its chat (`lid-mapping.update`).
 */
export type Raw = WAMessage | WAMessageUpdate | MessageUserReceiptUpdate | LIDMapping;

/** Lo que le pasa a un mensaje, tal como lo avisa `sub()`. / What happens to a message, as `sub()` reports it. */
export type MessageEvent = 'updated' | 'deleted' | 'reacted' | 'seen' | 'played';

/** Nodo de contenido de cualquier tipo, con los campos que se leen de él. / Content node of any type, with the fields read from it. */
type Node = { text?: string | null; caption?: string | null; name?: string | null; displayName?: string | null; mimetype?: string | null; viewOnce?: boolean | null; contextInfo?: proto.IContextInfo | null };

/**
 * Mensaje ligado a la sesión viva: se construye con `new wa.Message(timeline)` y devuelve la
 * subclase del tipo; las subclases viajan como estáticos para `instanceof`.
 * Message bound to the live session: built with `new wa.Message(timeline)`, it returns the subclass
 * of its type; the subclasses travel as statics for `instanceof`.
 *
 * @param instance - Sesión activa: cliente, motor y socket / Active session: client, engine and socket
 * @returns Clase `Message` con sus subclases / `Message` class with its subclasses
 */
export default function message(instance: Instance) {
    const { wa, engine } = instance;
    const Sender = sender(instance);
    const { read, write, resolve, awake, denied } = Sender[internal];
    let timeline_of: (msg: Message) => Raw[] = () => [];
    const own = () => jidNormalizedUser(instance.socket.user?.id ?? '');
    const pn = (...ids: (string | null | undefined)[]) => ids.find((id): id is string => Boolean(id?.endsWith('@s.whatsapp.net')));
    const base = (timeline: Raw[]) => timeline[0] as WAMessage;
    const content = (msg: Message) => normalizeMessageContent(base(timeline_of(msg)).message) ?? {};
    const is_message = (raw: Raw): raw is WAMessage => 'key' in raw && !('update' in raw) && !('receipt' in raw);
    const author = (key: WAMessageKey) => jidNormalizedUser(key.fromMe ? own() : (key.participant ? (pn(key.participant, key.participantAlt) ?? key.participant) : (pn(key.remoteJid, key.remoteJidAlt) ?? key.remoteJid)) ?? '');
    const identities = (key: WAMessageKey) => (key.fromMe ? [instance.socket.user?.lid, instance.socket.user?.id] : [key.participant, key.participantAlt, key.remoteJid, key.remoteJidAlt]).filter((id): id is string => Boolean(id)).map((id) => jidNormalizedUser(id));
    const node = (found: proto.IMessage) => found[getContentType(found) as keyof proto.IMessage] as Node | string | null | undefined;
    const last = <T>(timeline: Raw[], pick: (raw: Raw, index: number) => T | null | undefined): T | undefined => timeline.map(pick).findLast((value) => value != null) ?? undefined;
    const version = (raw: Raw, index: number): proto.IMessage | null => {
        const protocol = is_message(raw) ? (normalizeMessageContent(raw.message) ?? {}).protocolMessage : null;
        return index === 0 ? (normalizeMessageContent(base([raw]).message) ?? {})
            : protocol?.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT && protocol.editedMessage ? (normalizeMessageContent(protocol.editedMessage) ?? {})
            : 'update' in raw && raw.update.message ? (normalizeMessageContent(raw.update.message) ?? {})
            : null;
    };
    const pick = <T>(timeline: Raw[], field: (found: proto.IMessage) => T | null | undefined): T | undefined => last(timeline, (raw, index) => {
        const found = version(raw, index);
        return found ? field(found) : null;
    });
    const context = (timeline: Raw[]) => pick(timeline, (found) => (node(found) as Node | undefined)?.contextInfo);
    const secret = (timeline: Raw[]) => {
        const stored = base(timeline).message?.messageContextInfo?.messageSecret;
        return typeof stored === 'string' ? Buffer.from(stored, 'base64') : (stored ?? null);
    };
    const attempt = <T>(msg: WAMessage, origin: WAMessage, decrypt: (who: string, creator: string) => T): T | null => {
        for (const who of identities(msg.key)) {
            for (const creator of identities(origin.key)) {
                try {
                    return decrypt(who, creator);
                } catch {
                    continue;
                }
            }
        }
        return null;
    };
    /**
     * Voto de encuesta o respuesta de evento descifrado con la forma del `messages.update` que emite
     * baileys cuando lo descifra él, o null si no se pudo: se suma al llegar para no descifrar en
     * cada lectura.
     * Poll vote or event response decrypted in the shape of the `messages.update` baileys emits when
     * it decrypts it, or null when it could not: it is appended on arrival so reads do not decrypt.
     */
    const decrypt = (timeline: Raw[], raw: WAMessage): WAMessageUpdate | null => {
        const origin = base(timeline);
        const key = secret(timeline);
        const { pollUpdateMessage: vote, encEventResponseMessage: response } = normalizeMessageContent(raw.message) ?? {};
        const poll = key && vote?.vote?.encPayload && vote.vote.encIv
            ? attempt(raw, origin, (who, creator) => decryptPollVote({ encPayload: vote.vote!.encPayload!, encIv: vote.vote!.encIv! }, { pollCreatorJid: creator, pollMsgId: origin.key.id!, pollEncKey: key, voterJid: who }))
            : null;
        const event = key && response?.encPayload && response.encIv
            ? attempt(raw, origin, (who, creator) => decryptEventResponse({ encPayload: response.encPayload!, encIv: response.encIv! }, { eventCreatorJid: creator, eventMsgId: origin.key.id!, eventEncKey: key, responderJid: who }))
            : null;
        return poll ? { key: origin.key, update: { pollUpdates: [{ pollUpdateMessageKey: raw.key, vote: poll, senderTimestampMs: vote?.senderTimestampMs }] } }
            : event ? { key: origin.key, update: { eventResponses: [{ eventResponseMessageKey: raw.key, eventResponseMessage: event, timestampMs: event.timestampMs }] } }
            : null;
    };
    /** Bloque de media del contenido original. / Media block of the original content. */
    const block = (msg: Message): proto.Message.IImageMessage | null => {
        const found = content(msg);
        return found.imageMessage ?? found.videoMessage ?? found.ptvMessage ?? found.audioMessage ?? found.stickerMessage ?? found.documentMessage ?? null;
    };
    const bytes = (value: Uint8Array | string | null | undefined) => (value instanceof Uint8Array && value.length ? Buffer.from(value) : typeof value === 'string' && value ? Buffer.from(value, 'base64') : null);
    const relay = async (msg: Message, jid: string, sent: WAMessage) => {
        await instance.socket.relayMessage(jid, sent.message!, { messageId: sent.key.id! });
        instance.socket.ev.emit('messages.upsert', { messages: [sent], type: 'append' });
        timeline_of(msg).push(sent);
    };
    /**
     * Responde una encuesta o un evento: cifra la respuesta con el secreto del mensaje y la enruta con
     * la identidad LID propia cuando el chat la usa, como lo hace WhatsApp.
     * Answers a poll or an event: encrypts the answer with the message secret and routes it with the
     * own LID identity when the chat uses it, the way WhatsApp does.
     */
    const answer = async (msg: Message, key: Uint8Array, label: 'Poll Vote' | 'Event Response', encoded: Uint8Array, wrap: (creation: WAMessageKey, sealed: { encPayload: Uint8Array; encIv: Uint8Array }) => proto.IMessage): Promise<boolean> => {
        const { socket } = instance;
        const origin = base(timeline_of(msg));
        const dest = origin.key.remoteJid?.endsWith('@lid') ? origin.key.remoteJid
            : msg.cid.endsWith('@lid') ? msg.cid
            : ((await read<{ lid?: string }>(`/contact/${msg.cid}`))?.lid ?? (await socket.signalRepository?.lidMapping?.getLIDForPN(msg.cid).catch(() => null)) ?? msg.cid);
        const voter = jidNormalizedUser(dest.endsWith('@lid') && socket.user?.lid ? socket.user.lid : own());
        const creator = jidNormalizedUser(origin.key.fromMe ? voter : origin.key.remoteJid?.endsWith('@lid') ? origin.key.remoteJid : author(origin.key));
        const iv = randomBytes(12);
        const sealed = aesEncryptGCM(
            encoded,
            hmacSign(Buffer.concat([Buffer.from(msg.id), Buffer.from(creator), Buffer.from(voter), Buffer.from(label), new Uint8Array([1])]), hmacSign(key, new Uint8Array(32), 'sha256'), 'sha256'),
            iv,
            Buffer.from(`${msg.id}\x00${voter}`),
        );
        await relay(msg, dest, generateWAMessageFromContent(dest, wrap(dest === msg.cid ? origin.key : { ...origin.key, remoteJid: dest }, { encPayload: sealed, encIv: iv }), { userJid: own() }));
        return true;
    };

    class Message extends Sender {
        /** Raws exactos de baileys, en orden de llegada; el primero es el mensaje. / Exact baileys raws, in arrival order; the first one is the message. */
        readonly #timeline: Raw[];

        static {
            timeline_of = (msg) => msg.#timeline;
        }

        /**
         * Las capacidades de `Sender` más el descifrado de votos y respuestas al llegar.
         * The `Sender` capabilities plus decrypting votes and responses on arrival.
         *
         * @internal
         */
        static readonly [internal] = { ...Sender[internal], decrypt };

        /** @param timeline - Raws del mensaje; el primero es el mensaje / The message raws; the first one is the message */
        constructor(timeline: Raw[]) {
            super();
            this.#timeline = timeline;
            return new.target === Message ? new kinds[this.type](timeline) : this;
        }

        /** Un mensaje de su chat: los envíos van a él y lo citan. / A message of its chat: sends go to it and quote it. */
        [route](): Route {
            return { type: 'message', cid: this.cid, mid: this.id };
        }

        /** @param uid - JID o LID del contacto / Contact JID or LID */
        static async #card(uid: string): Promise<Contact> {
            const jid = (await resolve(uid)) ?? uid;
            return new wa.Contact((await read(`/contact/${jid}`)) ?? { id: jid });
        }

        /** Identificador del mensaje. / Message identifier. */
        get id(): string {
            return base(this.#timeline).key.id ?? '';
        }

        /** Chat al que pertenece: el teléfono cuando se conoce, el LID o el grupo si no. / Chat it belongs to: the phone when known, otherwise the LID or the group. */
        get cid(): string {
            const { key } = base(this.#timeline);
            const mapped = last(this.#timeline, (raw) => ('lid' in raw && jidNormalizedUser(raw.lid) === jidNormalizedUser(key.remoteJid ?? '') ? raw.pn : null));
            return jidNormalizedUser(pn(key.remoteJid, key.remoteJidAlt, mapped) ?? key.remoteJid ?? '');
        }

        /** Id del mensaje citado, o null. / Quoted message id, or null. */
        get mid(): string | null {
            return context(this.#timeline)?.stanzaId ?? null;
        }

        /** JID del autor. / Author JID. */
        get from(): string {
            return author(base(this.#timeline).key);
        }

        /** true si soy el autor. / true when I am the author. */
        get me(): boolean {
            return base(this.#timeline).key.fromMe ?? false;
        }

        /** Tipo del mensaje. / Message type. */
        get type(): 'text' | 'image' | 'video' | 'audio' | 'sticker' | 'document' | 'location' | 'poll' | 'vcard' | 'event' | 'product' {
            const kind = getContentType((normalizeMessageContent(base(this.#timeline).message) ?? {})) ?? '';
            return ({
                imageMessage: 'image', videoMessage: 'video', ptvMessage: 'video', audioMessage: 'audio', stickerMessage: 'sticker', documentMessage: 'document', documentWithCaptionMessage: 'document',
                locationMessage: 'location', liveLocationMessage: 'location', pollCreationMessage: 'poll', pollCreationMessageV2: 'poll', pollCreationMessageV3: 'poll',
                contactMessage: 'vcard', contactsArrayMessage: 'vcard', eventMessage: 'event', productMessage: 'product',
            } as const)[kind as 'imageMessage'] ?? 'text';
        }

        /** MIME: text/plain en texto y productos, application/json en ubicación, encuesta, tarjeta y evento, el real en media. / MIME: text/plain for text and products, application/json for location, poll, card and event, the actual one for media. */
        get mime(): string {
            return ['text', 'product'].includes(this.type) ? 'text/plain'
                : ['location', 'poll', 'vcard', 'event'].includes(this.type) ? 'application/json'
                : (pick(this.#timeline, (found) => (node(found) as Node | undefined)?.mimetype) ?? 'application/octet-stream');
        }

        /**
         * Estado de entrega: el mayor que traen los `messages.update` y los recibos, salvo que el
         * último sea un error, porque los recibos de varios dispositivos llegan en desorden.
         * Delivery state: the highest one the `messages.update` and the receipts carry, unless the
         * last one is an error, since receipts from several devices arrive out of order.
         */
        get status(): 'error' | 'pending' | 'sent' | 'delivered' | 'read' | 'played' {
            const { Status } = proto.WebMessageInfo;
            const level = (raw: Raw, index: number) => ('update' in raw ? raw.update.status
                : 'receipt' in raw ? (raw.receipt.playedTimestamp ? Status.PLAYED : raw.receipt.readTimestamp ? Status.READ : Status.DELIVERY_ACK)
                : index === 0 ? (base([raw]).status ?? Status.PENDING)
                : null);
            const current = last(this.#timeline, level) === Status.ERROR ? Status.ERROR : Math.max(...this.#timeline.map(level).filter((value): value is proto.WebMessageInfo.Status => value != null));
            return (['error', 'pending', 'sent', 'delivered', 'read', 'played'] as const)[current] ?? 'pending';
        }

        /** Motivo del rechazo cuando `status` es `error`, o null. / Rejection reason when `status` is `error`, or null. */
        get reason(): string | null {
            const code = last(this.#timeline, (raw, index) => ('update' in raw ? raw.update.messageStubParameters?.[0] : index === 0 ? base([raw]).messageStubParameters?.[0] : null));
            return this.status === 'error' && code ? (({ '463': 'restricted', '479': 'invalid-session' } as Record<string, string>)[code] ?? String(code)) : null;
        }

        /** true si la cuenta está mencionada, por su JID o por su LID. / true when the account is mentioned, by its JID or by its LID. */
        get mentioned(): boolean {
            const mine = identities({ fromMe: true });
            return (context(this.#timeline)?.mentionedJid ?? []).some((id) => mine.includes(jidNormalizedUser(id)));
        }

        /** true si una edición reemplazó el contenido original. / true when an edit replaced the original content. */
        get edited(): boolean {
            return this.#timeline.some((raw, index) => index > 0 && version(raw, index) !== null);
        }

        /** true si es de una sola vista o reproducción. / true when view-once or play-once. */
        get once(): boolean {
            const origin = base(this.#timeline);
            return Boolean(origin.key.isViewOnce ?? (node((normalizeMessageContent(origin.message) ?? {})) as Node | undefined)?.viewOnce ?? origin.message?.viewOnceMessage ?? origin.message?.viewOnceMessageV2 ?? origin.message?.viewOnceMessageV2Extension);
        }

        /** Vencimiento del mensaje temporal en ISO, o null. / Ephemeral expiration as ISO, or null. */
        get expires_at(): string | null {
            const origin = base(this.#timeline);
            const duration = origin.ephemeralDuration ?? context(this.#timeline)?.expiration;
            return duration ? new Date((toNumber(origin.ephemeralStartTimestamp ?? origin.messageTimestamp) + duration) * 1_000).toISOString() : null;
        }

        /** Momento en que se eliminó para todos, en ISO, o null; el contenido se sigue leyendo. / When it was deleted for everyone, as ISO, or null; the content can still be read. */
        get revoked_at(): string | null {
            const at = last(this.#timeline, (raw, index) => (index === 0 ? (base([raw]).messageStubType === proto.WebMessageInfo.StubType.REVOKE ? toNumber(base([raw]).revokeMessageTimestamp ?? base([raw]).messageTimestamp) : null)
                : is_message(raw) && (normalizeMessageContent(raw.message) ?? {}).protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE ? toNumber(raw.messageTimestamp)
                : null));
            return at ? new Date(at * 1_000).toISOString() : null;
        }

        /** Negocio verificado que firma el mensaje, o null. / Verified business signing the message, or null. */
        get business(): string | null {
            return base(this.#timeline).verifiedBizName ?? null;
        }

        /** Fecha de creación en ISO. / Creation date as ISO. */
        get created_at(): string {
            return new Date(toNumber(base(this.#timeline).messageTimestamp) * 1_000).toISOString();
        }

        /**
         * Sin argumento, el texto vigente: el de la última edición, o el pie del media. Con texto
         * edita el mensaje: sólo uno propio de texto, imagen o video, dentro de los 15 minutos que
         * WhatsApp permite editar.
         * With no argument, the current text: the last edit's, or the media caption. With text it
         * edits the message: only an own text, image or video, within the 15 minutes WhatsApp allows
         * editing.
         *
         * @param value - Texto nuevo / New text
         * @throws UNAUTHORIZED si es ajeno, su tipo no se edita o pasaron los 15 minutos / when not own, its type cannot be edited or the 15 minutes went by
         */
        caption(): string;
        caption(value: string): Promise<string>;
        caption(value?: string): string | Promise<string> {
            if (value === undefined) {
                return pick(this.#timeline, (found) => {
                    const entry = node(found);
                    return typeof entry === 'string' ? entry
                        : found.productMessage ? (found.productMessage.body ?? found.productMessage.product?.description)
                        : found.eventMessage ? found.eventMessage.description
                        : found.locationMessage ? found.locationMessage.comment
                        : (entry?.caption ?? entry?.text ?? entry?.name ?? entry?.displayName);
                }) ?? '';
            }
            const media = ({ image: 'imageMessage', video: 'videoMessage' } as const)[this.type as 'image'];
            if (this.me === false || (this.type !== 'text' && media === undefined) || Date.now() - Date.parse(this.created_at) > 900_000) return Promise.reject(new Error('UNAUTHORIZED'));
            const key = { remoteJid: this.cid, id: this.id, fromMe: true };
            return (media
                ? relay(this, this.cid, generateWAMessageFromContent(this.cid, {
                    protocolMessage: { key, type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT, editedMessage: { [media]: { ...pick(this.#timeline, (found) => found[media]), caption: value } }, timestampMs: Date.now() },
                }, { userJid: own() }))
                : instance.socket.sendMessage(this.cid, { text: value, edit: key }).then((sent) => sent && this.#timeline.push(sent))
            ).then(() => value);
        }

        /**
         * Sin argumento dice si llegó reenviado; con un destino lo reenvía allí.
         * With no argument it says whether it arrived forwarded; with a target it forwards it there.
         *
         * @param target - Chat, contacto o identificador destino / Target chat, contact or identifier
         */
        forward(): boolean;
        forward(target: Chat | Contact | string): Promise<Message>;
        forward(target?: Chat | Contact | string): boolean | Promise<Message> {
            if (target === undefined) return context(this.#timeline)?.isForwarded ?? false;
            return resolve(typeof target === 'string' ? target : target.id).then(async (jid) => {
                if (jid === null) throw new Error('ERR_INVALID_CHAT');
                const sent = generateWAMessageFromContent(jid, generateForwardMessageContent(base(this.#timeline), false), { userJid: own() });
                await instance.socket.relayMessage(jid, sent.message!, { messageId: sent.key.id! });
                instance.socket.ev.emit('messages.upsert', { messages: [sent], type: 'append' });
                return new Message([sent]);
            });
        }

        /**
         * Sin argumento dice si ya lo leyeron; con true lo acusa leído y pone la cuenta en línea.
         * With no argument it says whether it was read; with true it acknowledges it as read and puts
         * the account online.
         */
        seen(): boolean;
        seen(value: true): Promise<boolean>;
        seen(value?: true): boolean | Promise<boolean> {
            return value === undefined
                ? this.status === 'read' || this.status === 'played'
                : awake().then(() => instance.socket.readMessages([{ ...base(this.#timeline).key, remoteJid: this.cid }])).then(() => true);
        }

        /** Sin argumento dice si está destacado; con él lo destaca o lo quita. / With no argument it says whether it is starred; with one it stars or unstars it. */
        starred(): boolean;
        starred(value: boolean): Promise<boolean>;
        starred(value?: boolean): boolean | Promise<boolean> {
            return value === undefined
                ? (last(this.#timeline, (raw, index) => ('update' in raw ? raw.update.starred : index === 0 ? base([raw]).starred : null)) ?? false)
                : instance.socket.chatModify({ star: { messages: [{ id: this.id, fromMe: this.me }], star: value } }, this.cid).then(() => {
                    this.#timeline.push({ key: base(this.#timeline).key, update: { starred: value } });
                    return value;
                });
        }

        /**
         * Sin argumento dice si está fijado en el chat; con él lo fija por 1, 7 o 30 días, o lo suelta.
         * With no argument it says whether it is pinned in the chat; with one it pins it for 1, 7 or 30
         * days, or unpins it.
         *
         * @throws UNAUTHORIZED si el grupo no le permite fijar a la cuenta / when the group does not let the account pin
         */
        pinned(): boolean;
        pinned(value: boolean, days?: 1 | 7 | 30): Promise<boolean>;
        pinned(value?: boolean, days: 1 | 7 | 30 = 7): boolean | Promise<boolean> {
            if (value === undefined) {
                return last(this.#timeline, (raw, index) => (index === 0 ? base([raw]).pinInChat?.type : is_message(raw) ? (normalizeMessageContent(raw.message) ?? {}).pinInChatMessage?.type : 'update' in raw ? raw.update.pinInChat?.type : null)) === proto.PinInChat.Type.PIN_FOR_ALL;
            }
            return instance.socket.sendMessage(this.cid, {
                pin: { ...base(this.#timeline).key, remoteJid: this.cid },
                type: value ? proto.PinInChat.Type.PIN_FOR_ALL : proto.PinInChat.Type.UNPIN_FOR_ALL,
                time: ({ 1: 86_400, 7: 604_800, 30: 2_592_000 } as const)[days],
            }).catch(denied).then((sent) => {
                if (sent) this.#timeline.push(sent);
                return value;
            });
        }

        /**
         * Sin argumento, las reacciones vigentes agrupadas por emoji —la última de cada autor—; con un
         * emoji reacciona, y '' retira la reacción.
         * With no argument, the current reactions grouped by emoji —each author's last one—; with an
         * emoji it reacts, and '' removes the reaction.
         *
         * @throws UNAUTHORIZED si el chat no le permite reaccionar a la cuenta / when the chat does not let the account react
         */
        reactions(): { emoji: string; count: number }[];
        reactions(emoji: string): Promise<boolean>;
        reactions(emoji?: string): { emoji: string; count: number }[] | Promise<boolean> {
            if (emoji !== undefined) {
                return instance.socket.sendMessage(this.cid, { react: { text: emoji, key: { ...base(this.#timeline).key, remoteJid: this.cid } } }).catch(denied).then((sent) => Boolean(sent && this.#timeline.push(sent)));
            }
            const current = [...new Map(this.#timeline.flatMap((raw, index) => (index === 0
                ? (base([raw]).reactions ?? []).map((reaction) => [author(reaction.key ?? {}), reaction.text ?? ''] as const)
                : is_message(raw) && (normalizeMessageContent(raw.message) ?? {}).reactionMessage ? [[author(raw.key), (normalizeMessageContent(raw.message) ?? {}).reactionMessage?.text ?? ''] as const]
                : []))).values()].filter(Boolean);
            return [...new Set(current)].map((entry) => ({ emoji: entry, count: current.filter((value) => value === entry).length }));
        }

        /**
         * Elimina el mensaje: para todos con `all` si es propio —queda en su sitio marcado en
         * `revoked_at`—; si no, sólo para mí, y sale del engine.
         * Deletes the message: for everyone with `all` when own —it stays in place flagged in
         * `revoked_at`—; otherwise just for me, and it leaves the engine.
         *
         * @param all - true elimina para todos / true deletes for everyone
         */
        async delete(all = false): Promise<boolean> {
            const key = { ...base(this.#timeline).key, remoteJid: this.cid };
            if (all && this.me) return instance.socket.sendMessage(this.cid, { delete: key }).then((sent) => Boolean(sent && this.#timeline.push(sent)));
            await instance.socket.chatModify({ deleteForMe: { deleteMedia: false, key, timestamp: Date.now() } }, this.cid);
            return engine.unset(`/chat/${this.cid}/message/${this.id}`);
        }

        /** Contenido real: en un texto, el texto en UTF-8. / Actual content: for a text, the text in UTF-8. */
        async content(): Promise<Buffer> {
            return Buffer.from(this.caption(), 'utf-8');
        }

        /** Stream del contenido. / Content stream. */
        async stream(): Promise<Readable> {
            return Readable.from(await this.content());
        }

        /** Contacto autor. / Author contact. */
        async author(): Promise<Contact> {
            return Message.#card(this.from);
        }

        /** Chat al que pertenece: el guardado, o uno mínimo. / Chat it belongs to: the stored one, or a minimal one. */
        async chat(): Promise<Chat> {
            return new wa.Chat((await read(`/chat/${this.cid}`)) ?? { id: this.cid });
        }

        /** Mensaje citado, o null. / Quoted message, or null. */
        async message(): Promise<Message | null> {
            return this.mid ? Message.get(this.cid, this.mid) : null;
        }

        /** Contactos mencionados, en orden de aparición. / Mentioned contacts, in order of appearance. */
        async mentions(): Promise<Contact[]> {
            return Promise.all((context(this.#timeline)?.mentionedJid ?? []).map(Message.#card));
        }

        /**
         * Se suscribe a lo que le pasa al mensaje: cambia, se elimina, recibe una reacción —en `emoji`
         * y `contact`—, lo leen o reproducen su audio; en un grupo la lectura llega por los acuses.
         * Subscribes to what happens to the message: it changes, is deleted, gets a reaction —in
         * `emoji` and `contact`—, is read or its audio is played; in a group the read arrives through
         * the receipts.
         *
         * @param handler - Recibe cada cambio / Receives every change
         * @returns Función para desuscribirse / Function to unsubscribe
         */
        sub(handler: (event: WatchEvent<MessageEvent, Message> & { emoji?: string; contact?: Contact }) => void): () => void {
            let status = this.status;
            const advance = (msg: Message) => {
                if (msg.status !== status && (msg.status === 'read' || msg.status === 'played')) handler({ name: msg.status === 'read' ? 'seen' : 'played', payload: msg });
                status = msg.status;
            };
            const off = [
                wa.on('message:updated', (msg) => {
                    if (msg.id !== this.id) return;
                    handler({ name: 'updated', payload: msg });
                    advance(msg);
                }),
                wa.on('message:seen', (msg) => msg.id === this.id && advance(msg)),
                wa.on('message:deleted', (msg) => msg.id === this.id && handler({ name: 'deleted', payload: msg })),
                wa.on('message:reacted', (msg, _, emoji, contact) => msg.id === this.id && handler({ name: 'reacted', payload: msg, emoji, contact })),
            ];
            return () => off.forEach((unsubscribe) => unsubscribe());
        }

        /**
         * @param cid - Teléfono, JID, LID o id de grupo del chat / Chat phone, JID, LID or group id
         * @param mid - Id del mensaje / Message id
         */
        static async get(cid: string, mid: string): Promise<Message | null> {
            const jid = await resolve(cid);
            const timeline = jid ? await read<Raw[]>(`/chat/${jid}/message/${mid}`) : null;
            return timeline?.length ? new Message(timeline) : null;
        }

        /** @returns Mensajes del más reciente al más antiguo / Messages from the most recent to the oldest */
        static async list(cid: string, offset = 0, limit = 50): Promise<Message[]> {
            const jid = await resolve(cid);
            return (jid ? await engine.list(`/chat/${jid}/message`, offset, limit) : [])
                .map((raw) => deserialize<Raw[]>(raw))
                .filter((timeline): timeline is Raw[] => Array.isArray(timeline) && timeline.length > 0)
                .map((timeline) => new Message(timeline));
        }

        /** Elimina un mensaje por su chat e id; ver `delete()`. / Deletes a message by its chat and id; see `delete()`. */
        static async delete(cid: string, mid: string, all = false): Promise<boolean> {
            return (await Message.get(cid, mid))?.delete(all) ?? false;
        }
    }

    /** Mensaje de texto; `preview` expone la tarjeta del enlace. / Text message; `preview` exposes the link card. */
    class Text extends Message {
        /** Tarjeta del enlace, o null cuando el texto no la trae. / Link card, or null when the text carries none. */
        get preview(): { link: string; name: string | null; content: string | null; thumb: Buffer | null } | null {
            const ext = pick(timeline_of(this), (found) => found.extendedTextMessage);
            return ext?.matchedText && (ext.title || ext.description) ? { link: ext.matchedText, name: ext.title ?? null, content: ext.description ?? null, thumb: bytes(ext.jpegThumbnail) } : null;
        }
    }

    /** Base de los mensajes con binario: peso y descarga. / Base for binary messages: size and download. */
    class Media extends Message {
        /** Peso en bytes. / Size in bytes. */
        get size(): number {
            return toNumber(block(this)?.fileLength);
        }

        /** Ruta del binario en el engine. / Binary path in the engine. */
        get #path(): string {
            return `/chat/${this.cid}/message/${this.id}/content`;
        }

        /** Binario guardado; vacío si falta. / Stored binary; empty when missing. */
        async #stored(): Promise<Buffer> {
            return (await engine.get_buffer?.(this.#path)) ?? Buffer.from((await read<{ data: string }>(this.#path))?.data ?? '', 'base64');
        }

        /**
         * Binario del media: el guardado o, si falta, la descarga —pidiendo el reenvío si caducó—, que
         * queda guardada. Lanza si no se puede descargar.
         * Media binary: the stored one or, when missing, the download —requesting a re-upload when
         * expired—, which gets stored. Throws when it cannot be downloaded.
         */
        async content(): Promise<Buffer> {
            const stored = await this.#stored();
            if (stored.length) return stored;
            const downloaded = await downloadMediaMessage(base(timeline_of(this)), 'buffer', {}, { reuploadRequest: instance.socket.updateMediaMessage, logger: instance.socket.logger });
            await (engine.set_buffer?.(this.#path, downloaded) ?? write(this.#path, { data: downloaded.toString('base64') }));
            return downloaded;
        }

        /**
         * Stream del media: el guardado o, si falta, la descarga entregada mientras llega, sin
         * acumularla ni guardarla; `content()` es la que guarda.
         * Media stream: the stored one or, when missing, the download delivered as it arrives, without
         * buffering nor storing it; `content()` is the one that stores.
         */
        async stream(): Promise<Readable> {
            const stored = await this.#stored();
            return stored.length ? Readable.from(stored) : downloadMediaMessage(base(timeline_of(this)), 'stream', {}, { reuploadRequest: instance.socket.updateMediaMessage, logger: instance.socket.logger });
        }
    }

    /** Base de la imagen, el video y el sticker: dimensiones y miniatura. / Base for image, video and sticker: dimensions and thumbnail. */
    class Visual extends Media {
        /** Ancho en píxeles. / Width in pixels. */
        get width(): number {
            return block(this)?.width ?? 0;
        }

        /** Alto en píxeles. / Height in pixels. */
        get height(): number {
            return block(this)?.height ?? 0;
        }

        /** Miniatura JPEG embebida, o null. / Embedded JPEG thumbnail, or null. */
        get thumb(): Buffer | null {
            return bytes(block(this)?.jpegThumbnail);
        }
    }

    /** Mensaje de imagen. / Image message. */
    class Image extends Visual {}

    /** Video, GIF o videonota redonda. / Video, GIF or round video note. */
    class Video extends Visual {
        /** true si es una videonota redonda. / true when it is a round video note. */
        get ptv(): boolean {
            return Boolean(content(this).ptvMessage);
        }

        /** Duración en segundos. / Duration in seconds. */
        get duration(): number {
            const found = content(this);
            return (found.videoMessage ?? found.ptvMessage)?.seconds ?? 0;
        }
    }

    /** Nota de voz o archivo de audio. / Voice note or audio file. */
    class Audio extends Media {
        /** true si es nota de voz. / true when push-to-talk. */
        get ptt(): boolean {
            return content(this).audioMessage?.ptt === true;
        }

        /** Duración en segundos. / Duration in seconds. */
        get duration(): number {
            return content(this).audioMessage?.seconds ?? 0;
        }

        /** Forma de onda 0-100 lista para pintar. / Paint-ready 0-100 waveform. */
        get waveform(): number[] {
            return Array.from(bytes(content(this).audioMessage?.waveform) ?? []);
        }

        /**
         * Sin argumento dice si ya fue reproducido; con true lo acusa reproducido —quien lo mandó ve el
         * micrófono azul— y pone la cuenta en línea.
         * With no argument it says whether it was played; with true it acknowledges it as played —its
         * sender sees the blue mic— and puts the account online.
         */
        played(): boolean;
        played(value: true): Promise<boolean>;
        played(value?: true): boolean | Promise<boolean> {
            return value === undefined
                ? this.status === 'played'
                : awake().then(() => instance.socket.sendReceipt(this.cid, this.cid.endsWith('@g.us') ? this.from : undefined, [this.id], 'played')).then(() => true);
        }
    }

    /** Mensaje de sticker. / Sticker message. */
    class Sticker extends Visual {
        /** true si es animado. / true when animated. */
        get animated(): boolean {
            return content(this).stickerMessage?.isAnimated === true;
        }

        /** Miniatura PNG embebida, o null. / Embedded PNG thumbnail, or null. */
        get thumb(): Buffer | null {
            return bytes(content(this).stickerMessage?.pngThumbnail);
        }
    }

    /** Documento; el MIME real vive en `mime`. / Document; the actual MIME lives in `mime`. */
    class Document extends Media {
        /** Nombre del archivo. / File name. */
        get name(): string {
            return content(this).documentMessage?.fileName ?? '';
        }

        /** Páginas del PDF; 0 cuando no aplica. / PDF pages; 0 when not applicable. */
        get pages(): number {
            return content(this).documentMessage?.pageCount ?? 0;
        }

        /** Miniatura JPEG de la primera página, o null. / JPEG thumbnail of the first page, or null. */
        get thumb(): Buffer | null {
            return bytes(content(this).documentMessage?.jpegThumbnail);
        }
    }

    /** Ubicación fija o en vivo. / Static or live location. */
    class Location extends Message {
        /** Bloque de la ubicación. / Location block. */
        get #location() {
            const found = content(this);
            return found.locationMessage ?? found.liveLocationMessage;
        }

        /** Latitud en grados. / Latitude in degrees. */
        get lat(): number {
            return this.#location?.degreesLatitude ?? 0;
        }

        /** Longitud en grados. / Longitude in degrees. */
        get lng(): number {
            return this.#location?.degreesLongitude ?? 0;
        }

        /** Nombre del lugar, o null. / Place name, or null. */
        get name(): string | null {
            return content(this).locationMessage?.name || null;
        }

        /** Dirección del lugar, o null. / Place address, or null. */
        get address(): string | null {
            return content(this).locationMessage?.address || null;
        }

        /** true si es en tiempo real. / true when live. */
        get live(): boolean {
            return Boolean(content(this).liveLocationMessage);
        }

        /** URL de Google Maps con el punto marcado. / Google Maps URL with the point marked. */
        get link(): string {
            return `https://www.google.com/maps?q=${this.lat},${this.lng}`;
        }

        /** `{ lat, lng, name, address }` en JSON. / `{ lat, lng, name, address }` as JSON. */
        async content(): Promise<Buffer> {
            return Buffer.from(JSON.stringify({ lat: this.lat, lng: this.lng, name: this.name, address: this.address }), 'utf-8');
        }
    }

    /** Encuesta: opciones con conteo, votos por contacto y voto propio. / Poll: options with counts, per-contact votes and self-voting. */
    class Poll extends Message {
        /** Bloque de la encuesta. / Poll block. */
        get #poll() {
            const found = content(this);
            return found.pollCreationMessage ?? found.pollCreationMessageV2 ?? found.pollCreationMessageV3;
        }

        /**
         * Votos vigentes, el último de cada votante por su hora de envío. Cada voto llega cifrado y se
         * suma descifrado al llegar; sólo el que no se pudo descifrar entonces se reintenta al leer.
         * Current votes, each voter's last one by its send time. Every vote arrives encrypted and is
         * appended decrypted on arrival; only the one that could not be decrypted then is retried on read.
         */
        get #votes(): proto.IPollUpdate[] {
            const timeline = timeline_of(this);
            const done = new Set(timeline.flatMap((raw) => ('update' in raw ? (raw.update.pollUpdates ?? []).map((update) => update.pollUpdateMessageKey?.id) : [])));
            const updates = timeline.flatMap((raw, index): proto.IPollUpdate[] => (index === 0 ? (base(timeline).pollUpdates ?? [])
                : 'update' in raw ? (raw.update.pollUpdates ?? [])
                : is_message(raw) && done.has(raw.key.id) === false ? (decrypt(timeline, raw)?.update.pollUpdates ?? [])
                : []));
            return [...new Map(updates.sort((a, b) => toNumber(a.senderTimestampMs) - toNumber(b.senderTimestampMs)).map((update) => [author(update.pollUpdateMessageKey ?? {}), update])).values()].filter((update) => update.vote?.selectedOptions?.length);
        }

        /** Votos agregados por opción. / Votes aggregated by option. */
        get #tally() {
            return getAggregateVotesInPollMessage({ message: base(timeline_of(this)).message ?? undefined, pollUpdates: this.#votes }, own());
        }

        /** true si admite varias respuestas: WhatsApp manda 1 en las de una sola. / true when multi-select: WhatsApp sends 1 for single-choice ones. */
        get multiple(): boolean {
            return (this.#poll?.selectableOptionsCount ?? 0) !== 1;
        }

        /** Opciones con su conteo de votos. / Options with their vote counts. */
        get options(): { name: string; count: number }[] {
            const counts = new Map(this.#tally.map((entry) => [entry.name, entry.voters.length]));
            return (this.#poll?.options ?? []).map((option) => ({ name: option.optionName ?? '', count: counts.get(option.optionName ?? '') ?? 0 }));
        }

        /** Votos individuales: opción elegida y JID del votante, el del teléfono cuando se conoce. / Individual votes: chosen option and voter JID, the phone one when known. */
        async votes(): Promise<{ name: string; contact: string }[]> {
            return Promise.all(this.#tally.flatMap((entry) => entry.voters.map(async (voter) => ({ name: entry.name, contact: jidNormalizedUser((await resolve(voter)) ?? voter) }))));
        }

        /**
         * Vota con uno o varios índices, y `[]` retira el voto; lo cifra y lo enruta como WhatsApp.
         * WhatsApp no siempre propaga el voto emitido desde un dispositivo vinculado.
         * Votes with one or more indexes, and `[]` withdraws the vote; it encrypts and routes it like
         * WhatsApp. WhatsApp does not always propagate a vote cast from a linked device.
         *
         * @param index - Índice o índices de la opción / Option index or indexes
         * @returns true cuando el voto salió / true when the vote was relayed
         * @throws ERR_POLL_OPTION con un índice fuera de rango o con varios en una de opción única / with an index out of range or several on a single-choice poll
         * @throws ERR_POLL_SECRET si el mensaje no trae el secreto con que se cifra el voto / when the message lacks the secret the vote is encrypted with
         */
        async select(index: number | number[]): Promise<boolean> {
            const options = this.#poll?.options ?? [];
            const indexes = [...new Set([index].flat())];
            if (indexes.some((i) => Number.isInteger(i) === false || i < 0 || i >= options.length) || (this.multiple === false && indexes.length > 1)) throw new Error('ERR_POLL_OPTION');
            const key = secret(timeline_of(this));
            if (key === null) throw new Error('ERR_POLL_SECRET');
            const vote = proto.Message.PollVoteMessage.encode({ selectedOptions: indexes.map((i) => sha256(Buffer.from(options[i]!.optionName ?? ''))) }).finish();
            return answer(this, key, 'Poll Vote', vote, (creation, sealed) => ({ pollUpdateMessage: { pollCreationMessageKey: creation, vote: sealed, senderTimestampMs: Date.now() } }));
        }

        /** `{ content, options: [{ content }] }` en JSON. / `{ content, options: [{ content }] }` as JSON. */
        async content(): Promise<Buffer> {
            return Buffer.from(JSON.stringify({ content: this.#poll?.name ?? '', options: (this.#poll?.options ?? []).map((option) => ({ content: option.optionName ?? '' })) }), 'utf-8');
        }
    }

    /** Tarjeta(s) de contacto. / Contact card(s). */
    class VCard extends Message {
        /** Tarjetas tal como llegaron. / Cards as they arrived. */
        get #cards() {
            const found = content(this);
            return found.contactsArrayMessage?.contacts ?? (found.contactMessage ? [found.contactMessage] : []);
        }

        /**
         * Contactos de la tarjeta con el teléfono en E.164, sacado del `waid` de WhatsApp o del primer
         * TEL; un número local sin `+` queda en dígitos porque no trae su código de país.
         * Card contacts with the phone in E.164, taken from the WhatsApp `waid` or from the first TEL; a
         * local number without `+` stays as digits because it carries no country code.
         */
        get contacts(): { name: string; phone: string }[] {
            return this.#cards.map((entry) => {
                const [, params = '', written = ''] = (entry.vcard ?? '').match(/TEL([^:\n]*):([^\n]+)/) ?? [];
                const waid = params.match(/waid=(\d+)/)?.[1];
                const digits = written.replace(/\D/g, '');
                return { name: entry.displayName ?? '', phone: waid ? `+${waid}` : written.trim().startsWith('+') && digits ? `+${digits}` : digits };
            });
        }

        /** Las vCard, una por línea. / The vCards, one per line. */
        async content(): Promise<Buffer> {
            return Buffer.from(this.#cards.map((entry) => entry.vcard ?? '').join('\n'), 'utf-8');
        }
    }

    /** Evento de calendario con sus respuestas de asistencia. / Calendar event with its attendance responses. */
    class Event extends Message {
        /** Bloque del evento. / Event block. */
        get #event() {
            return content(this).eventMessage;
        }

        /**
         * Respuesta vigente de cada asistente: la que baileys o la librería ya descifraron al llegar,
         * o la que no se pudo descifrar entonces, que se reintenta al leer.
         * Current response of every attendee: the one baileys or the library already decrypted on
         * arrival, or the one that could not be decrypted then, retried on read.
         */
        get #responses() {
            const timeline = timeline_of(this);
            type Response = proto.IEventResponse & { response?: proto.Message.IEventResponseMessage | null };
            const done = new Set(timeline.flatMap((raw) => ('update' in raw ? (raw.update.eventResponses ?? []).map((entry) => entry.eventResponseMessageKey?.id) : [])));
            const entries = timeline.flatMap((raw, index): Response[] => (index === 0 ? (base(timeline).eventResponses ?? [])
                : 'update' in raw ? (raw.update.eventResponses ?? [])
                : is_message(raw) && done.has(raw.key.id) === false ? (decrypt(timeline, raw)?.update.eventResponses ?? [])
                : [])).map((entry) => [author(entry.eventResponseMessageKey ?? {}), entry.eventResponseMessage ?? entry.response] as const);
            return [...new Map(entries.filter(([, response]) => response)).entries()]
                .map(([who, response]) => ({ who, response: ({ 1: 'yes', 2: 'no', 3: 'maybe' } as const)[response?.response as 1 | 2 | 3], guests: response?.extraGuestCount ?? 0 }))
                .filter((entry) => entry.response);
        }

        /** Asistentes confirmados, acompañantes incluidos. / Confirmed attendees, companions included. */
        get going(): number {
            return this.#responses.filter((entry) => entry.response === 'yes').reduce((sum, entry) => sum + 1 + entry.guests, 0);
        }

        /** Nombre del evento. / Event name. */
        get name(): string {
            return this.#event?.name ?? '';
        }

        /** Inicio en ISO. / Start as ISO. */
        get start(): string {
            return new Date(toNumber(this.#event?.startTime) * 1_000).toISOString();
        }

        /** Fin en ISO, o null. / End as ISO, or null. */
        get end(): string | null {
            return this.#event?.endTime != null ? new Date(toNumber(this.#event.endTime) * 1_000).toISOString() : null;
        }

        /** true si fue cancelado. / true when canceled. */
        get canceled(): boolean {
            return this.#event?.isCanceled ?? false;
        }

        /** Enlace de unión, si lo hay. / Join link, if any. */
        get link(): string {
            return this.#event?.joinLink ?? '';
        }

        /** Lugar del evento, con nombre y dirección cuando los trae, o null. / Event place, with name and address when it carries them, or null. */
        get place(): { lat: number; lng: number; name: string | null; address: string | null } | null {
            const loc = this.#event?.location;
            return loc ? { lat: loc.degreesLatitude ?? 0, lng: loc.degreesLongitude ?? 0, name: loc.name || null, address: loc.address || null } : null;
        }

        /**
         * Respuestas de asistencia en orden de llegada, con el nombre resuelto y el JID del asistente,
         * el del teléfono cuando se conoce.
         * Attendance responses in arrival order, with the resolved name and the attendee JID, the phone
         * one when known.
         */
        async attendees(): Promise<{ name: string; contact: string; response: 'yes' | 'no' | 'maybe'; guests: number }[]> {
            return Promise.all(this.#responses.map(async (entry) => {
                const who = await wa.Contact.get(entry.who).catch(() => null);
                const jid = who?.id ?? jidNormalizedUser(entry.who);
                return { name: who?.name ?? jid.split('@')[0]!, contact: jid, response: entry.response!, guests: entry.guests };
            }));
        }

        /**
         * Responde la asistencia —sí, no o tal vez— con los acompañantes que el evento admita; la
         * respuesta viaja cifrada, como el voto de una encuesta.
         * Answers the attendance —yes, no or maybe— with the companions the event allows; the answer
         * travels encrypted, like a poll vote.
         *
         * @param value - Respuesta / Answer
         * @param guests - Acompañantes; sólo con `yes` o `maybe` en un evento que los admite / Companions; only with `yes` or `maybe` on an event that allows them
         * @returns true cuando la respuesta salió / true when the answer was relayed
         * @throws ERR_EVENT_OPTION con una respuesta desconocida o acompañantes que no corresponden / with an unknown answer or companions that do not apply
         * @throws ERR_EVENT_SECRET si el mensaje no trae el secreto con que se cifra la respuesta / when the message lacks the secret the answer is encrypted with
         */
        async select(value: 'yes' | 'no' | 'maybe', guests = 0): Promise<boolean> {
            const { GOING, NOT_GOING, MAYBE } = proto.Message.EventResponseMessage.EventResponseType;
            const response = ({ yes: GOING, no: NOT_GOING, maybe: MAYBE } as const)[value];
            if (response === undefined || Number.isInteger(guests) === false || guests < 0 || (guests > 0 && (value === 'no' || this.#event?.extraGuestsAllowed !== true))) throw new Error('ERR_EVENT_OPTION');
            const key = secret(timeline_of(this));
            if (key === null) throw new Error('ERR_EVENT_SECRET');
            const encoded = proto.Message.EventResponseMessage.encode({ response, timestampMs: Date.now(), extraGuestCount: guests }).finish();
            return answer(this, key, 'Event Response', encoded, (creation, sealed) => ({ encEventResponseMessage: { eventCreationMessageKey: creation, ...sealed } }));
        }

        /** El evento tal como llegó, en JSON. / The event as it arrived, as JSON. */
        async content(): Promise<Buffer> {
            return Buffer.from(JSON.stringify(this.#event ?? {}), 'utf-8');
        }
    }

    /**
     * Tarjeta de producto que llega a un chat: la misma superficie que el producto del catálogo, con
     * `pid` para el producto e `id` para el mensaje.
     * Product card arriving in a chat: the same surface as the catalog product, with `pid` for the
     * product and `id` for the message.
     */
    class Product extends Message {
        /** Ficha del producto tal como viajó. / Product card as it travelled. */
        get #product() {
            return content(this).productMessage?.product;
        }

        /** Identificador del producto. / Product identifier. */
        get pid(): string {
            return this.#product?.productId ?? '';
        }

        /** Nombre del producto. / Product name. */
        get name(): string {
            return this.#product?.title ?? '';
        }

        /** Precio en unidades. / Price in units. */
        get price(): number {
            return toNumber(this.#product?.priceAmount1000) / 1_000;
        }

        /** Moneda ISO 4217. / ISO 4217 currency. */
        get currency(): string {
            return this.#product?.currencyCode ?? '';
        }

        /** Enlace del producto, o null. / Product link, or null. */
        get link(): string | null {
            return this.#product?.url ?? null;
        }

        /** Miniatura embebida en la tarjeta; Buffer vacío si no la trae. / Thumbnail embedded in the card; empty Buffer when it carries none. */
        async thumb(): Promise<Buffer> {
            return bytes(this.#product?.productImage?.jpegThumbnail) ?? Buffer.alloc(0);
        }

        /** Portada del producto en el catálogo del negocio; Buffer vacío si ya no está publicado. / Product cover in the business catalog; empty Buffer when no longer published. */
        async photo(): Promise<Buffer> {
            return (await (await this.catalog())?.product(this.pid))?.photo() ?? Buffer.alloc(0);
        }

        /** Identificador del vendedor, o null. / Seller identifier, or null. */
        get sku(): string | null {
            return this.#product?.retailerId ?? null;
        }

        /** La tarjeta sólo viaja si el producto es visible. / The card only travels when the product is visible. */
        get hidden(): boolean {
            return false;
        }

        /** Descripción del producto. / Product description. */
        async content(): Promise<Buffer> {
            return Buffer.from(this.#product?.description ?? '', 'utf-8');
        }

        /** Catálogo del negocio que publica el producto, o null si ya no está publicado. / Catalog of the business publishing the product, or null when no longer published. */
        async catalog(): Promise<InstanceType<Instance['wa']['Catalog']> | null> {
            const owner = content(this).productMessage?.businessOwnerJid ?? this.from;
            const catalogs = (await (await wa.Contact.get(owner))?.catalog()) ?? [];
            const found = await Promise.all(catalogs.map(async (entry) => ((await entry.products(0, Number.MAX_SAFE_INTEGER)).some((item) => item.pid === this.pid) ? entry : null)));
            return found.find((entry) => entry !== null) ?? null;
        }
    }

    const kinds = { text: Text, image: Image, video: Video, audio: Audio, sticker: Sticker, document: Document, location: Location, poll: Poll, vcard: VCard, event: Event, product: Product } as const;

    return Object.assign(Message, { Text, Image, Video, Audio, Sticker, Document, Location, Poll, VCard, Event, Product });
}

type Kinds = ReturnType<typeof message>;

/** El mensaje ligado a la sesión, para tipar sin instanciar. / The session-bound message, to type without instantiating. */
export type Message = InstanceType<Kinds>;

/** Mensaje de texto. / Text message. */
export interface Text extends InstanceType<Kinds['Text']> {
    readonly type: 'text';
}

/** Mensaje de imagen. / Image message. */
export interface Image extends InstanceType<Kinds['Image']> {
    readonly type: 'image';
}

/** Mensaje de video. / Video message. */
export interface Video extends InstanceType<Kinds['Video']> {
    readonly type: 'video';
}

/** Nota de voz o archivo de audio. / Voice note or audio file. */
export interface Audio extends InstanceType<Kinds['Audio']> {
    readonly type: 'audio';
}

/** Mensaje de sticker. / Sticker message. */
export interface Sticker extends InstanceType<Kinds['Sticker']> {
    readonly type: 'sticker';
}

/** Documento. / Document. */
export interface Document extends InstanceType<Kinds['Document']> {
    readonly type: 'document';
}

/** Ubicación fija o en vivo. / Static or live location. */
export interface Location extends InstanceType<Kinds['Location']> {
    readonly type: 'location';
}

/** Encuesta. / Poll. */
export interface Poll extends InstanceType<Kinds['Poll']> {
    readonly type: 'poll';
}

/** Tarjeta(s) de contacto. / Contact card(s). */
export interface VCard extends InstanceType<Kinds['VCard']> {
    readonly type: 'vcard';
}

/** Evento de calendario. / Calendar event. */
export interface Event extends InstanceType<Kinds['Event']> {
    readonly type: 'event';
}

/** Tarjeta de producto. / Product card. */
export interface Product extends InstanceType<Kinds['Product']> {
    readonly type: 'product';
}
