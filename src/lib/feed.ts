/**
 * @file feed.ts
 * @description Entidad Feed — cada estado es su timeline: los raws exactos que baileys emitió para
 * él, el mensaje de `status@broadcast` y los recibos de quien lo vio. Hereda de `Sender` las
 * respuestas, que van al chat 1:1 del autor citando el estado, y los metadatos.
 * Feed entity — every status is its timeline: the exact raws baileys emitted for it, the
 * `status@broadcast` message and the receipts of whoever viewed it. It inherits from `Sender` the
 * replies, which go to the author's 1:1 chat quoting the status, and the metadata.
 */

import { downloadMediaMessage, getContentType, jidNormalizedUser, normalizeMessageContent, proto, toNumber, type LIDMapping, type MessageUserReceiptUpdate, type WAMessage, type WAMessageUpdate } from 'baileys';
import { Readable } from 'node:stream';
import type { Contact } from '~/lib/contact';
import sender, { internal, route, type Route, type Who } from '~/lib/sender';
import { delivery, deserialize } from '~/lib/store';
import type { Instance, WatchEvent } from '~/lib/whatsapp';

/** Lo que entra al timeline de un estado. / What enters a status timeline. */
export type Raw = WAMessage | WAMessageUpdate | MessageUserReceiptUpdate | LIDMapping;

/** Lo que le pasa a un estado, tal como lo avisa `sub()`. / What happens to a status, as `sub()` reports it. */
export type FeedEvent = 'updated' | 'deleted' | 'seen';

/** Vida de un estado: 24 horas en ms. / Status lifetime: 24 hours in ms. */
export const TTL_MS = 86_400_000;

/**
 * Estado ligado a la sesión viva: se construye con `new wa.Feed(timeline)`.
 * Status bound to the live session: built with `new wa.Feed(timeline)`.
 *
 * @param instance - Sesión activa: cliente, motor y socket / Active session: client, engine and socket
 * @returns Clase `Feed` con acceso a la sesión / `Feed` class with session access
 */
export default function feed(instance: Instance) {
    const { wa, engine } = instance;
    const Sender = sender(instance);
    const { read, write, resolve, awake } = Sender[internal];

    return class Feed extends Sender {
        /** Raws exactos de baileys, en orden de llegada; el primero es el estado. / Exact baileys raws, in arrival order; the first one is the status. */
        readonly #timeline: Raw[];

        /** @param timeline - Raws del estado; el primero es el mensaje / Status raws; the first one is the message */
        constructor(timeline: Raw[]) {
            super();
            this.#timeline = timeline;
        }

        /** Un estado: las respuestas van al chat del autor y lo citan. / A status: replies go to the author's chat and quote it. */
        [route](): Route {
            return { type: 'feed', cid: this.from, mid: this.id };
        }

        /** Mensaje del estado. / Status message. */
        get #raw(): WAMessage {
            return this.#timeline[0] as WAMessage;
        }

        /** Contenido del estado sin sus sobres. / Status content without its envelopes. */
        get #content() {
            return normalizeMessageContent(this.#raw.message) ?? {};
        }

        /** Identificador del estado. / Status identifier. */
        get id(): string {
            return this.#raw.key.id ?? '';
        }

        /** JID del autor: el teléfono cuando se conoce, el LID si no. / Author JID: the phone when known, otherwise the LID. */
        get from(): string {
            const { key } = this.#raw;
            const mapped = this.#timeline.findLast((raw): raw is LIDMapping => 'lid' in raw && jidNormalizedUser(raw.lid) === jidNormalizedUser(key.participant ?? ''));
            return jidNormalizedUser(key.fromMe ? (instance.socket.user?.id ?? '') : ([key.participant, key.participantAlt, mapped?.pn].find((id) => id?.endsWith('@s.whatsapp.net')) ?? key.participant ?? ''));
        }

        /** true si es un estado propio. / true when it is an own status. */
        get me(): boolean {
            return this.#raw.key.fromMe ?? false;
        }

        /** Tipo del estado. / Status type. */
        get type(): 'text' | 'image' | 'video' | 'audio' {
            return ({ imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio' } as const)[getContentType(this.#content) as 'imageMessage'] ?? 'text';
        }

        /** MIME: text/plain en texto, el real en media. / MIME: text/plain for text, the actual one for media. */
        get mime(): string {
            const content = this.#content;
            return this.type === 'text' ? 'text/plain' : ((content.imageMessage ?? content.videoMessage ?? content.audioMessage)?.mimetype ?? 'application/octet-stream');
        }

        /** Texto del estado o pie del media. / Status text or media caption. */
        get caption(): string {
            const content = this.#content;
            return content.conversation ?? content.extendedTextMessage?.text ?? content.imageMessage?.caption ?? content.videoMessage?.caption ?? '';
        }

        /** Fecha de publicación en ISO. / Publication date as ISO. */
        get created_at(): string {
            return new Date(toNumber(this.#raw.messageTimestamp) * 1_000).toISOString();
        }

        /** Vencimiento en ISO: 24 horas después de publicado. / Expiration as ISO: 24 hours after publication. */
        get expires_at(): string {
            return new Date(Date.parse(this.created_at) + TTL_MS).toISOString();
        }

        /**
         * Sin argumento dice si ya lo vi —uno propio siempre lo está—; con true manda el recibo de
         * lectura, deja el registro de entrega del timeline en leído —el envío propio no tiene eco— y
         * pone la cuenta en línea.
         * With no argument it says whether I already viewed it —an own one always is—; with true it
         * sends the read receipt, sets the timeline delivery record to read —the own send has no echo—
         * and puts the account online.
         */
        seen(): boolean;
        seen(value: true): Promise<boolean>;
        seen(value?: true): boolean | Promise<boolean> {
            const { READ } = proto.WebMessageInfo.Status;
            if (value === undefined) {
                return this.me || Boolean(this.#timeline.findLast((raw, index) => ('receipt' in raw ? (raw.receipt.readTimestamp ?? raw.receipt.playedTimestamp) : 'update' in raw ? raw.update.statusAlreadyViewed || (raw.update.status ?? 0) >= READ : index === 0 ? this.#raw.statusAlreadyViewed : null)));
            }
            if (this.seen()) return Promise.resolve(true);
            return awake().then(() => instance.socket.readMessages([this.#raw.key])).then(async () => {
                this.#timeline.splice(0, this.#timeline.length, ...this.#timeline.filter((raw) => delivery(raw) === false), { key: this.#raw.key, update: { status: READ } });
                await write(`/status/${this.id}`, this.#timeline, Date.parse(this.created_at));
                wa.emit('feed:updated', this, wa);
                return true;
            });
        }

        /**
         * Retira para todos un estado propio —a la audiencia con que lo publicó `create()` o, si salió
         * de otro dispositivo, a la agenda—; uno ajeno lo quita del engine.
         * Revokes an own status for everyone —to the audience `create()` published it with or, when it
         * came from another device, to the address book—; someone else's is removed from the engine.
         */
        async delete(): Promise<boolean> {
            if (this.me) {
                await instance.socket.sendMessage('status@broadcast', { delete: this.#raw.key }, { statusJidList: (await read<string[]>(`/status/${this.id}/audience`)) ?? (await Feed.#audience()) });
                return true;
            }
            await engine.unset(`/status/${this.id}`);
            wa.emit('feed:deleted', this, wa);
            return true;
        }

        /** Binario guardado; en texto, el texto. / Stored binary; for text, the text. */
        async #stored(): Promise<Buffer> {
            const path = `/status/${this.id}/content`;
            return this.type === 'text' ? Buffer.from(this.caption, 'utf-8') : ((await engine.get_buffer?.(path)) ?? Buffer.from((await read<{ data: string }>(path))?.data ?? '', 'base64'));
        }

        /** Contenido: en texto, el texto; en media, el binario guardado o descargado, que queda guardado. Lanza si no se puede descargar. / Content: for text, the text; for media, the stored or downloaded binary, which gets stored. Throws when it cannot be downloaded. */
        async content(): Promise<Buffer> {
            const stored = await this.#stored();
            if (stored.length) return stored;
            const downloaded = await downloadMediaMessage(this.#raw, 'buffer', {}, { reuploadRequest: instance.socket.updateMediaMessage, logger: instance.socket.logger });
            await (engine.set_buffer?.(`/status/${this.id}/content`, downloaded) ?? write(`/status/${this.id}/content`, { data: downloaded.toString('base64') }));
            return downloaded;
        }

        /** Stream del contenido: el guardado o la descarga entregada mientras llega, sin guardarla. / Content stream: the stored one or the download delivered as it arrives, without storing it. */
        async stream(): Promise<Readable> {
            const stored = await this.#stored();
            return stored.length ? Readable.from(stored) : downloadMediaMessage(this.#raw, 'stream', {}, { reuploadRequest: instance.socket.updateMediaMessage, logger: instance.socket.logger });
        }

        /** Contacto autor. / Author contact. */
        async author(): Promise<Contact> {
            const jid = (await resolve(this.from)) ?? this.from;
            return new wa.Contact((await read(`/contact/${jid}`)) ?? { id: jid });
        }

        /**
         * Se suscribe a lo que le pasa al estado: cambia, se retira o lo ven.
         * Subscribes to what happens to the status: it changes, is revoked or gets viewed.
         *
         * @param handler - Recibe cada cambio / Receives every change
         * @returns Función para desuscribirse / Function to unsubscribe
         */
        sub(handler: (event: WatchEvent<FeedEvent, Feed>) => void): () => void {
            let viewed = this.seen();
            const off = [
                wa.on('feed:updated', (found) => {
                    if (found.id !== this.id) return;
                    handler({ name: 'updated', payload: found });
                    if (viewed === false && found.seen()) handler({ name: 'seen', payload: found });
                    viewed = found.seen();
                }),
                wa.on('feed:deleted', (found) => found.id === this.id && handler({ name: 'deleted', payload: found })),
            ];
            return () => off.forEach((unsubscribe) => unsubscribe());
        }

        /** Teléfonos de la agenda —los contactos con `name`, como «Mis contactos» de WhatsApp—: la audiencia cuando no se indica otra. / Address book phones —contacts with `name`, like WhatsApp's «My contacts»—: the audience when no other is given. */
        static async #audience(): Promise<string[]> {
            return (await engine.list('/contact', 0, 100_000))
                .map((raw) => deserialize<{ id: string; name?: string; phoneNumber?: string }>(raw))
                .flatMap((doc) => (doc?.name ? [jidNormalizedUser(doc.phoneNumber ?? doc.id)] : []))
                .filter((jid) => jid.endsWith('@s.whatsapp.net') && jid !== jidNormalizedUser(instance.socket.user?.id ?? ''));
        }

        /** @param id - Id del estado / Status id */
        static async get(id: string): Promise<Feed | null> {
            const timeline = await read<Raw[]>(`/status/${id}`);
            return timeline?.length ? new Feed(timeline) : null;
        }

        /** @returns Estados vigentes, del más nuevo al más viejo / Current statuses, newest first */
        static async list(offset = 0, limit = 50): Promise<Feed[]> {
            return (await engine.list('/status', offset, limit))
                .map((raw) => deserialize<Raw[]>(raw))
                .filter((timeline): timeline is Raw[] => Array.isArray(timeline) && timeline.length > 0)
                .map((timeline) => new Feed(timeline))
                .filter((found) => Date.parse(found.expires_at) > Date.now());
        }

        /**
         * Publica un estado: texto con `caption`, o imagen, video o audio con `media`, que lleva
         * `caption` como pie. Sin `audience` se publica a la agenda; WhatsApp no lo reparte fuera de la
         * audiencia, que se guarda para retirarlo después a los mismos. El binario se reconoce por sus
         * primeros bytes —JPEG, PNG, WebP, MP4, OGG o MP3— y tiene que coincidir con `mime`.
         * Publishes a status: text with `caption`, or image, video or audio with `media`, which carries
         * `caption` as its caption. Without `audience` it goes to the address book; WhatsApp delivers it
         * to nobody outside the audience, which is stored to revoke it later from the same people. The
         * binary is recognized by its first bytes —JPEG, PNG, WebP, MP4, OGG or MP3— and must match `mime`.
         *
         * @throws ERR_FEED_EMPTY sin `caption` ni `media` / without `caption` nor `media`
         * @throws ERR_FEED_MEDIA si el binario no es imagen, video ni audio, o no coincide con `mime` / when the binary is not an image, video nor audio, or does not match `mime`
         */
        static async create(input: { caption?: string; media?: { buffer: Buffer; mime: string }; audience?: Who[] }): Promise<Feed> {
            if (!input.caption && !input.media) throw new Error('ERR_FEED_EMPTY');
            const head = input.media?.buffer.subarray(0, 12) ?? Buffer.alloc(0);
            const accepted = head.subarray(0, 3).toString('hex') === 'ffd8ff' || head.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' || (head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP') ? ['image']
                : head.subarray(4, 8).toString() === 'ftyp' ? ['video', 'audio']
                : head.subarray(0, 4).toString() === 'OggS' || head.subarray(0, 3).toString() === 'ID3' || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) ? ['audio']
                : [];
            if (input.media && accepted.includes(input.media.mime.split('/')[0]!) === false) throw new Error('ERR_FEED_MEDIA');
            const type = input.media?.mime.startsWith('video/') ? 'video' : input.media?.mime.startsWith('audio/') ? 'audio' : 'image';
            const audience = input.audience ? (await Promise.all(input.audience.map((who) => resolve(typeof who === 'object' ? who.id : String(who))))).filter((jid): jid is string => jid !== null) : await Feed.#audience();
            const sent = await instance.socket.sendMessage('status@broadcast', (input.media ? { [type]: input.media.buffer, mimetype: input.media.mime, caption: input.caption } : { text: input.caption }) as never, { statusJidList: audience });
            if (!sent?.key.id) throw new Error('ERR_SEND_FAILED');
            await Promise.all([
                write(`/status/${sent.key.id}`, [sent], toNumber(sent.messageTimestamp) * 1_000 || Date.now()),
                write(`/status/${sent.key.id}/audience`, audience),
                input.media && (engine.set_buffer?.(`/status/${sent.key.id}/content`, input.media.buffer) ?? write(`/status/${sent.key.id}/content`, { data: input.media.buffer.toString('base64') })),
            ]);
            const created = new Feed([sent]);
            wa.emit('feed:created', created, wa);
            return created;
        }
    };
}

/** El estado ligado a la sesión, para tipar sin instanciar. / The session-bound status, to type without instantiating. */
export type Feed = InstanceType<ReturnType<typeof feed>>;
