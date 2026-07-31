/**
 * @file status/index.ts
 * @description Entidad Feed — publicación del status broadcast (`status@broadcast`) como
 * subclase de Message: hereda author/chat/content/stream y anula lo que un status no soporta.
 * Feed entity — status broadcast post as a Message subclass: inherits
 * author/chat/content/stream and voids what a status does not support.
 */

import type { WAMessage } from 'baileys';
import { internals } from '~/lib/internal';
import { Message } from '~/lib/message';
import { serialize } from '~/lib/store';
import type { WhatsApp } from '~/lib/whatsapp';

/** Vida útil del status: 24 horas en ms. / Status lifetime: 24h in ms. */
export const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Publicación del status broadcast. El documento del status se adapta al shape de
 * Message en el constructor (`cid` fijo a `status@broadcast`, `author` desde
 * `author_jid`, `deleted_at` desde `expires_at`), así los getters heredados aplican
 * tal cual.
 * Status broadcast post. The status document is adapted to the Message shape in the
 * constructor (`cid` pinned to `status@broadcast`, `author` from `author_jid`,
 * `deleted_at` from `expires_at`), so inherited getters apply as-is.
 */
export class Feed extends Message {
    constructor(
        wa: WhatsApp,
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
        super(wa, {
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

    /**
     * Marca el status como visto enviando read receipt y persiste `viewed`.
     * Marks the status as seen sending a read receipt and persists `viewed`.
     *
     * @returns true si se envió / true when sent
     */
    async view(): Promise<boolean> {
        let ok = false;
        const socket = internals(this._wa).socket;
        if (socket) {
            if (!this.viewed) {
                await socket.readMessages([
                    { remoteJid: 'status@broadcast', id: this._raw.id, participant: this._raw.author },
                ]);
                this._raw.viewed = true;
                await this._wa.engine.set(`/status/${this._raw.id}`, serialize(this._raw));
            }
            this._wa.emit('feed:updated', this, this._wa);
            ok = true;
        }
        return ok;
    }

    /** Un status marca visto con `view()`. / A status marks seen via `view()`. */
    override async seen(): Promise<boolean> {
        return this.view();
    }

    /** No soportado en un status. / Unsupported on a status. */
    override async message(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
    /** No soportado en un status. / Unsupported on a status. */
    override async react(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
    /** No soportado en un status. / Unsupported on a status. */
    override async star(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
    /** No soportado en un status. / Unsupported on a status. */
    override async edit(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
    /** No soportado en un status. / Unsupported on a status. */
    override async forward(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
    /** No soportado en un status. / Unsupported on a status. */
    override async delete(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
    /** No soportado en un status. / Unsupported on a status. */
    override async text(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
    /** No soportado en un status. / Unsupported on a status. */
    override async image(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
    /** No soportado en un status. / Unsupported on a status. */
    override async video(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
    /** No soportado en un status. / Unsupported on a status. */
    override async audio(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
    /** No soportado en un status. / Unsupported on a status. */
    override async location(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
    /** No soportado en un status. / Unsupported on a status. */
    override async poll(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
    /** No soportado en un status. / Unsupported on a status. */
    override async document(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
    /** No soportado en un status. / Unsupported on a status. */
    override async vcard(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
    /** No soportado en un status. / Unsupported on a status. */
    override async event(): Promise<never> {
        throw new Error('ERR_FEED_UNSUPPORTED');
    }
}
