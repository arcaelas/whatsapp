/**
 * @file status/index.ts
 * @description Entidad `Feed` — representa una publicación del status broadcast
 * (`status@broadcast`). Análoga a `Message` pero acotada al ciclo de vida de un
 * status (24h, no se cita, no se edita, sin starring/forward).
 * Status broadcast entry. Analogous to `Message` but scoped to the status
 * lifecycle (24h TTL, no quoting, no editing, no starring/forward).
 */

import { downloadMediaMessage, type WAMessage } from 'baileys';
import { Readable } from 'node:stream';
import { Contact } from '~/lib/contact';
import { deserialize, serialize } from '~/lib/store';
import type { WhatsApp } from '~/lib/whatsapp';

/** Tipos soportados por un status broadcast. / Status broadcast supported types. */
export type FeedType = 'text' | 'image' | 'video' | 'audio';

/**
 * Documento persistido del status.
 * Persisted status document.
 */
export interface IFeedRaw {
    id: string;
    author_jid: string;
    type: FeedType;
    caption: string;
    mime: string;
    created_at: number;
    expires_at: number;
    viewed: boolean;
    raw: WAMessage;
}

/** Vida útil del status: 24 horas en ms. / Status lifetime: 24h in ms. */
export const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Status broadcast — una publicación del feed `status@broadcast` con duración 24h.
 *
 * Status broadcast entry — a `status@broadcast` post with a 24h lifetime.
 */
export default class Feed {
    /** @internal */
    protected readonly _wa: WhatsApp;
    /** @internal */
    protected readonly _doc: IFeedRaw;
    /** @internal Cache de la promesa de `author()` para evitar engine round-trips repetidos. */
    private _author_cache: Promise<Contact> | null = null;

    constructor(options: { wa: WhatsApp; doc: IFeedRaw }) {
        this._wa = options.wa;
        this._doc = options.doc;
    }

    /** Identificador del status (mid). / Status id (mid). */
    get id(): string {
        return this._doc.id;
    }

    /** Tipo de contenido. / Content type. */
    get type(): FeedType {
        return this._doc.type;
    }

    /** true si ya enviamos read receipt sobre este status. / true once a read receipt was sent. */
    get viewed(): boolean {
        return this._doc.viewed;
    }

    /** Texto / caption del status. / Status text or caption. */
    get caption(): string {
        return this._doc.caption;
    }

    /** Epoch ms de publicación. / Publication epoch ms. */
    get created_at(): number {
        return this._doc.created_at;
    }

    /** Epoch ms de expiración (created_at + 24h). / Expiration epoch ms (created_at + 24h). */
    get expires_at(): number {
        return this._doc.expires_at;
    }

    /**
     * Resuelve el autor del status. Memoizado a nivel de instancia: la primera
     * llamada va al engine vía `wa.Contact.get`; las siguientes devuelven la misma
     * instancia sin volver a leer.
     * Resolves the status author. Instance-memoized: first call hits the engine
     * via `wa.Contact.get`; subsequent calls return the cached instance.
     */
    async author(): Promise<Contact> {
        return (this._author_cache ??= (async () => {
            const { _wa, _doc } = this;
            const fetched = await _wa.Contact.get(_doc.author_jid);
            return (
                fetched ??
                new _wa.Contact(
                    {
                        id: _doc.author_jid,
                        lid: null,
                        name: null,
                        notify: null,
                        verified_name: null,
                        img_url: null,
                        status: null,
                    },
                    new _wa.Chat({
                        id: _doc.author_jid,
                        name: _doc.author_jid.split('@')[0],
                    }),
                )
            );
        })());
    }

    /**
     * Stream progresivo del contenido. Para texto envuelve el caption; para media
     * lee del cache del engine y, si falta, descarga desde baileys.
     * Progressive content stream. For text wraps the caption; for media reads the
     * engine cache and falls back to baileys download.
     */
    async stream(): Promise<Readable> {
        const { _wa, _doc } = this;
        if (_doc.type === 'text') {
            return Readable.from(Buffer.from(_doc.caption, 'utf-8'));
        }
        const cached = deserialize<{ data: string }>(
            await _wa.engine.get(`/status/${_doc.id}/content`),
        );
        if (cached?.data) {
            return Readable.from(Buffer.from(cached.data, 'base64'));
        }
        if (_wa._socket) {
            try {
                return (await downloadMediaMessage(_doc.raw, 'stream', {})) as unknown as Readable;
            } catch {
                /* fallback empty */
            }
        }
        return Readable.from(Buffer.alloc(0));
    }

    /**
     * Acumula el stream del status en un Buffer.
     * Drains the status stream into a Buffer.
     */
    async content(): Promise<Buffer> {
        const chunks: Buffer[] = [];
        for await (const chunk of await this.stream()) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
    }

    /**
     * Marca el status como visto enviando read receipt. Persiste `viewed = true`.
     * Marks the status as seen sending a read receipt. Persists `viewed = true`.
     */
    async view(): Promise<boolean> {
        const { _wa, _doc } = this;
        let ok = false;
        if (_wa._socket) {
            if (!_doc.viewed) {
                await _wa._socket.readMessages([
                    { remoteJid: 'status@broadcast', id: _doc.id, participant: _doc.author_jid },
                ]);
                _doc.viewed = true;
                await _wa.engine.set(
                    `/status/${_doc.id}`,
                    serialize(_doc),
                );
            }
            _wa._event.emit('feed:updated', this, _wa);
            ok = true;
        }
        return ok;
    }
}
