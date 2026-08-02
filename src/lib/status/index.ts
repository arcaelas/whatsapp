/**
 * @file status/index.ts
 * @description Entidad Feed — publicación del status broadcast como subclase de Message:
 * hereda author/stream y anula lo que un status no soporta.
 * Feed entity — status broadcast post as a Message subclass: inherits author/stream and
 * voids what a status does not support.
 */

import type { WAMessage, WASocket } from 'baileys';
import Message from '~/lib/message';
import { deserialize, serialize, type Engine } from '~/lib/store';
import type WhatsApp from '~/lib/whatsapp';

/** Vida útil del status: 24 horas en ms. / Status lifetime: 24h in ms. */
export const TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * Publicación del status broadcast. El documento se adapta al shape de Message en el
 * constructor (`cid` fijo a `status@broadcast`, `author` desde `author_jid`, `deleted_at`
 * desde `expires_at`), así los getters heredados aplican tal cual.
 * Status broadcast post. The document is adapted to the Message shape in the constructor
 * (`cid` pinned to `status@broadcast`, `author` from `author_jid`, `deleted_at` from
 * `expires_at`), so inherited getters apply as-is.
 */
export class Feed extends Message {
    constructor(
        init: { wa: WhatsApp; engine: Engine; socket: WASocket },
        doc: {
            id: string;
            author_jid: string;
            type: 'text' | 'image' | 'video' | 'audio';
            caption: string;
            mime: string;
            created_at: number;
            expires_at: number;
            viewed: boolean;
            raw: WAMessage;
        }
    ) {
        super(init, {
            ...doc,
            cid: 'status@broadcast',
            mid: null,
            me: false,
            author: doc.author_jid,
            status: 1,
            starred: false,
            forwarded: false,
            deleted_at: doc.expires_at,
            edited: false,
        });
    }

    /** true si ya enviamos read receipt sobre este status. / true once a read receipt was sent. */
    get viewed(): boolean {
        return this._raw.viewed ?? false;
    }

    /** Binario del status: vive bajo `/status`, no bajo `/chat`. / Status binary: it lives under `/status`, not `/chat`. */
    override async content(): Promise<Buffer> {
        const path = `/status/${this._raw.id}/content`;
        const cached = await this._init.engine.get_buffer?.(path);
        if (cached?.length) return cached;
        const legacy = deserialize<{ data: string }>(await this._init.engine.get(path));
        return legacy?.data ? Buffer.from(legacy.data, 'base64') : Buffer.alloc(0);
    }

    /**
     * Marca el status como visto enviando read receipt y persiste `viewed`.
     * Marks the status as seen sending a read receipt and persisting `viewed`.
     */
    async view(): Promise<boolean> {
        if (!this.viewed) {
            await this._init.socket.readMessages([
                { remoteJid: 'status@broadcast', id: this._raw.id, participant: this._raw.author },
            ]);
            this._raw.viewed = true;
            await this._init.engine.set(`/status/${this._raw.id}`, serialize(this._raw));
        }
        this._init.wa.emit('feed:updated', this, this._init.wa);
        return true;
    }

    /** Un status marca visto con `view()`. / A status marks seen via `view()`. */
    override async seen(): Promise<boolean> {
        return this.view();
    }

    /* Un status no soporta el resto de operaciones de Message. / A status supports none of the remaining Message operations. */
    override async message(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
    override async react(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
    override async star(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
    override async edit(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
    override async forward(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
    override async delete(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
    override async text(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
    override async image(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
    override async video(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
    override async audio(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
    override async location(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
    override async poll(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
    override async document(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
    override async vcard(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
    override async event(): Promise<never> { throw new Error('ERR_FEED_UNSUPPORTED'); }
}
