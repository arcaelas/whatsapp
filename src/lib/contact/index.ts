/**
 * @file contact/index.ts
 * @description Entidad Contact — ficha derivada del raw del contacto.
 * Contact entity — a card derived from the raw contact document.
 */

import { jidNormalizedUser, type WASocket } from 'baileys';
import type Chat from '~/lib/chat';
import { Feed, TTL_MS } from '~/lib/status';
import { deserialize, jid_of, serialize, type Engine } from '~/lib/store';
import type WhatsApp from '~/lib/whatsapp';

/** Sesión activa que liga la entidad. / Active session binding the entity. */
type Init = { wa: WhatsApp; engine: Engine; socket: WASocket };

/**
 * Contacto: recibe el raw de baileys y deriva todo con getters.
 * Contact: receives the baileys raw and derives everything via getters.
 */
export default class Contact {
    /**
     * @internal Documento crudo en snake_case. `id` llega en LID o PN según el addressing;
     * `phone_number` es el JID PN cuando baileys lo conoce.
     * Raw document in snake_case. `id` arrives as LID or PN depending on addressing;
     * `phone_number` is the PN JID when baileys knows it.
     */
    constructor(
        readonly _raw: {
            id: string;
            lid?: string | null;
            phone_number?: string | null;
            name?: string | null;
            notify?: string | null;
            verified_name?: string | null;
            img_url?: string | null;
            status?: string | null;
        }
    ) { }

    /** Nombre: agenda → público → verificado → teléfono. / Name: address book → public → verified → phone. */
    get name(): string {
        return this._raw.name ?? this._raw.notify ?? this._raw.verified_name ?? this.phone ?? this._raw.id.split('@')[0];
    }

    /** JID legado (`@s.whatsapp.net`), o null si no es determinable. / Legacy JID (`@s.whatsapp.net`), or null when undeterminable. */
    get jid(): string | null {
        const pn = this._raw.phone_number ?? (this._raw.id.endsWith('@s.whatsapp.net') ? this._raw.id : null);
        return pn ? jidNormalizedUser(pn) : null;
    }

    /** LID (`@lid`), o null si no es determinable. / LID (`@lid`), or null when undeterminable. */
    get lid(): string | null {
        return this._raw.lid ?? (this._raw.id.endsWith('@lid') ? this._raw.id : null);
    }

    /** Teléfono, derivado del JID PN y nunca del LID. / Phone, derived from the PN JID and never from the LID. */
    get phone(): string | null {
        return this.jid?.split('@')[0] ?? null;
    }

    /** URL de la foto de perfil, o null. / Profile picture URL, or null. */
    get photo(): string | null {
        return this._raw.img_url?.startsWith('http') ? this._raw.img_url : null;
    }
}

/**
 * Contacto ligado a la sesión viva: el socket y el engine llegan resueltos, así que sus
 * métodos no vuelven a comprobarlos.
 * Contact bound to the live session: socket and engine arrive resolved, so its methods do not
 * check them again.
 *
 * @param init - Sesión activa: cliente, motor y socket / Active session: client, engine and socket
 * @returns Clase `Contact` con acceso a la sesión / `Contact` class with session access
 */
export function contact(init: Init) {
    class _Contact extends Contact {
        /**
         * Chat 1:1 del contacto: el persistido, o una instancia mínima.
         * The contact's 1:1 chat: the persisted one, or a minimal instance.
         *
         * @returns Instancia de Chat / Chat instance
         */
        async chat(): Promise<InstanceType<typeof init.wa.Chat>> {
            const cid = this.jid ?? this.lid ?? this._raw.id;
            return new init.wa.Chat(deserialize<Chat['_raw']>(await init.engine.get(`/chat/${cid}`)) ?? { id: cid, name: this.name });
        }

        /**
         * Empieza a vigilar la presencia del contacto: a partir de aquí llegan sus `contact:presence`
         * (entró, salió, escribe, graba). WhatsApp no difunde presencia por su cuenta —hay que pedirla
         * por contacto— y deja de mandarla al reconectar, así que hay que volver a pedirla en cada
         * sesión nueva.
         * Starts watching the contact's presence: from here on its `contact:presence` events arrive
         * (came in, left, typing, recording). WhatsApp does not broadcast presence on its own —it must
         * be asked for per contact— and stops sending it on reconnect, so it has to be asked again on
         * every new session.
         *
         * @returns true si se pidió / true once requested
         */
        async watch(): Promise<boolean> {
            const jid = this.jid ?? this.lid ?? this._raw.id;
            await init.socket.presenceSubscribe(jid);
            return true;
        }

        /**
         * Contacto por teléfono, JID o LID: primero el engine y, si no está persistido, se
         * descubre por red con su foto y su bio, y se materializa.
         * Contact by phone, JID or LID: the engine first and, when not persisted, it is
         * discovered over the network with its picture and bio, and materialized.
         *
         * @param uid - Teléfono, JID o LID / Phone, JID or LID
         * @returns Contacto, o null si no existe en WhatsApp / Contact, or null when not on WhatsApp
         */
        static async get(uid: string | number): Promise<_Contact | null> {
            const jid = await jid_of(init.engine, String(uid), init.socket);
            if (!jid || jid.endsWith('@g.us')) {
                return null;
            }
            const cached = deserialize<Contact['_raw']>(await init.engine.get(`/contact/${jid}`));
            if (cached) {
                return new this(cached);
            }
            const found = (await init.socket.onWhatsApp(jid.split('@')[0]))?.[0] as { jid: string; exists: boolean; lid?: string } | undefined;
            if (!found?.exists) {
                return null;
            }
            const id = jidNormalizedUser(found.jid);
            const doc: Contact['_raw'] = {
                id,
                lid: found.lid ?? null,
                phone_number: id,
                name: null,
                notify: null,
                verified_name: null,
                img_url: await init.socket.profilePictureUrl(id, 'image').catch(() => null),
                status: await init.socket.fetchStatus(id)
                    .then((result) => (result?.[0] as { status?: { status?: string } } | undefined)?.status?.status ?? null)
                    .catch(() => null),
            };
            await init.engine.set(`/contact/${id}`, serialize(doc));
            if (found.lid) {
                await init.engine.set(`/lid/${found.lid}`, serialize(id));
            }
            return new this(doc);
        }

        /**
         * Pagina los contactos persistidos.
         * Paginates persisted contacts.
         *
         * @param offset - Desplazamiento / Offset
         * @param limit - Tamaño de página / Page size
         * @returns Página de contactos / Contact page
         */
        static async list(offset = 0, limit = 50): Promise<_Contact[]> {
            return (await init.engine.list('/contact', offset, limit))
                .map((raw) => deserialize<Contact['_raw']>(raw))
                .filter((doc): doc is Contact['_raw'] => doc !== null)
                .map((doc) => new this(doc));
        }
    }

    return _Contact;
}

/**
 * La cuenta autenticada: un contacto que además edita su propio perfil, controla su presencia
 * y publica estados con audiencia.
 * The authenticated account: a contact that also edits its own profile, controls its presence
 * and publishes statuses with an audience.
 */
export class Account extends Contact {
    /** @internal Sesión dueña de la cuenta. / Session owning the account. */
    constructor(readonly _init: Init, raw: Contact['_raw']) { super(raw); }

    /**
     * Cambia el nombre público de la cuenta en WhatsApp.
     * Changes the account's public name on WhatsApp.
     *
     * @param name - Nombre nuevo / New name
     */
    async rename(name: string): Promise<boolean> {
        await this._init.socket.updateProfileName(name);
        this._raw.name = name;
        return true;
    }

    /**
     * Actualiza la foto de perfil (Buffer o URL); `null` la elimina.
     * Updates the profile picture (Buffer or URL); `null` removes it.
     *
     * @param content - Imagen nueva, o null / New picture, or null
     * @throws ERR_PROFILE_PICTURE_LIB si falta `sharp` o `jimp` / when `sharp` or `jimp` is missing
     */
    async picture(content: Buffer | string | null): Promise<boolean> {
        const self = jidNormalizedUser(this._init.socket.user?.id ?? '');
        if (content === null) {
            await this._init.socket.removeProfilePicture(self);
        } else {
            await this._init.socket
                .updateProfilePicture(self, typeof content === 'string' ? { url: content } : content)
                .catch((error: Error) => {
                    throw /image processing library/i.test(error.message) ? new Error('ERR_PROFILE_PICTURE_LIB') : error;
                });
        }
        return true;
    }

    /**
     * Lee la bio de la cuenta, o la actualiza cuando recibe texto.
     * Reads the account bio, or updates it when given text.
     *
     * @param text - Bio nueva; sin él se lee la actual / New bio; omitted to read the current one
     */
    async content(): Promise<string>;
    async content(text: string): Promise<boolean>;
    async content(text?: string): Promise<string | boolean> {
        if (text === undefined) {
            const result = await this._init.socket.fetchStatus(jidNormalizedUser(this._init.socket.user?.id ?? '')).catch(() => null);
            return (result?.[0] as { status?: { status?: string } } | undefined)?.status?.status ?? '';
        }
        await this._init.socket.updateProfileStatus(text);
        return true;
    }

    /**
     * Publica la presencia de la cuenta: `true` online, `false` offline. El socket arranca
     * con `markOnlineOnConnect: false`, así que la presencia se controla solo por acá.
     * Publishes the account presence: `true` online, `false` offline. The socket starts with
     * `markOnlineOnConnect: false`, so presence is controlled here only.
     *
     * @param value - true online, false offline / true online, false offline
     */
    async online(value: boolean): Promise<boolean> {
        await this._init.socket.sendPresenceUpdate(value ? 'available' : 'unavailable');
        return true;
    }

    /**
     * Publica un estado en el feed. Con solo `caption` es texto; con `buffer` es imagen o
     * video (el tipo se deduce del binario) y `caption` queda de pie. La audiencia acepta
     * contactos, JIDs, LIDs o teléfonos: WhatsApp no reparte el estado fuera de ella.
     * Publishes a status to the feed. With only `caption` it is text; with `buffer` an image
     * or video (type inferred from the binary) with `caption` as its footer. The audience
     * accepts contacts, JIDs, LIDs or phones: WhatsApp delivers it to nobody outside it.
     *
     * @param input - Contenido y audiencia / Content and audience
     * @returns Publicación creada, o null si el envío no confirmó / Created post, or null when the send did not confirm
     * @throws ERR_FEED_EMPTY sin `buffer` ni `caption` / when neither is given
     * @throws ERR_FEED_MEDIA si el binario no es imagen ni video / when the binary is neither image nor video
     */
    async post(input: { caption?: string; buffer?: Buffer; audience: (string | number | Contact)[] }): Promise<Feed | null> {
        const { wa, engine, socket } = this._init;
        const head = input.buffer?.subarray(0, 12);
        const mime = !head ? null
            : head.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'image/jpeg'
                : head.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'image/png'
                    : head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP' ? 'image/webp'
                        : head.subarray(4, 8).toString() === 'ftyp' ? 'video/mp4'
                            : null;
        if (input.buffer && !mime) throw new Error('ERR_FEED_MEDIA');
        if (!input.buffer && !input.caption) throw new Error('ERR_FEED_EMPTY');
        const audience = (await Promise.all(input.audience.map((who) =>
            who instanceof Contact ? (who.jid ?? who.lid) : jid_of(this._init.engine, String(who), this._init.socket)
        ))).filter((jid): jid is string => Boolean(jid));
        const type = mime?.startsWith('video/') ? 'video' as const : mime ? 'image' as const : 'text' as const;
        const sent = await socket.sendMessage(
            'status@broadcast',
            (input.buffer ? { [type]: input.buffer, caption: input.caption } : { text: input.caption }) as never,
            { statusJidList: audience }
        );
        if (!sent?.key?.id) return null;
        const created_at = (Number(sent.messageTimestamp) || Math.floor(Date.now() / 1_000)) * 1_000;
        const doc = {
            id: sent.key.id,
            author_jid: jidNormalizedUser(socket.user?.id ?? ''),
            type,
            caption: input.caption ?? '',
            mime: mime ?? 'text/plain',
            created_at,
            expires_at: created_at + TTL_MS,
            viewed: true,
            raw: sent,
        };
        await engine.set(`/status/${doc.id}`, serialize(doc), created_at);
        if (input.buffer) {
            await (engine.set_buffer?.(`/status/${doc.id}/content`, input.buffer)
                ?? engine.set(`/status/${doc.id}/content`, serialize({ data: input.buffer.toString('base64') })));
        }
        const feed = new Feed(this._init, doc);
        wa.emit('feed:created', feed, wa);
        return feed;
    }
}
