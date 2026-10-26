/**
 * @file contact.ts
 * @description Entidad Contact — guarda el contacto tal como lo entrega baileys y deriva la
 * nomenclatura propia en sus getters. Hereda de `Sender` los envíos a su chat 1:1 y los metadatos.
 * Contact entity — keeps the contact exactly as baileys delivers it and derives the own naming
 * in its getters. It inherits from `Sender` the sends to its 1:1 chat and the metadata.
 */

import { BufferJSON, jidNormalizedUser, type CatalogCollection, type Contact as Raw, type Product } from 'baileys';
import sender, { internal, route, type Route } from '~/lib/sender';
import { deserialize } from '~/lib/store';
import type { Instance, Presence, WatchEvent } from '~/lib/whatsapp';

/** Lo que le pasa a un contacto, tal como lo avisa `sub()`. / What happens to a contact, as `sub()` reports it. */
export type ContactEvent = 'created' | 'updated' | 'deleted' | Presence;

/**
 * Contacto ligado a la sesión viva: el documento de baileys se guarda íntegro y privado, y lo
 * propio se deriva en getters. Se construye con `new wa.Contact(raw)`.
 * Contact bound to the live session: the baileys document is kept whole and private, and our own
 * naming is derived in getters. Built with `new wa.Contact(raw)`.
 *
 * @param instance - Sesión activa: cliente, motor y socket / Active session: client, engine and socket
 * @returns Clase `Contact` con acceso a la sesión / `Contact` class with session access
 */
export default function contact(instance: Instance) {
    const { wa, engine } = instance;
    const Sender = sender(instance);
    const { read, write, resolve, picture } = Sender[internal];
    const library = (error: Error) => {
        throw /image processing library/i.test(error.message) ? new Error('ERR_PROFILE_PICTURE_LIB') : error;
    };
    const pool = new Map<string, Map<unknown, () => void>>();
    wa.on('connected', () => pool.forEach((_, jid) => void instance.socket.presenceSubscribe(jid).catch(() => null)));

    return class Contact extends Sender {
        /** Documento de baileys: `id` llega en LID o en PN según el addressing. / Baileys document: `id` arrives as LID or PN depending on addressing. */
        readonly #raw: Raw & { lastSeen?: number; presence?: Presence };

        /** @param raw - Documento de baileys / Baileys document */
        constructor(raw: Raw & { lastSeen?: number; presence?: Presence }) {
            super();
            this.#raw = raw;
        }

        /** Un contacto: los envíos van a su chat 1:1 y los metadatos a su ficha. / A contact: sends go to its 1:1 chat and metadata to its card. */
        [route](): Route {
            return { type: 'contact', cid: this.#jid ?? this.#lid ?? jidNormalizedUser(this.#raw.id) };
        }

        /** JID del teléfono, o null si el documento no lo trae. / Phone JID, or null when the document does not carry it. */
        get #jid(): string | null {
            const pn = this.#raw.phoneNumber ?? (this.#raw.id.endsWith('@s.whatsapp.net') ? this.#raw.id : null);
            return pn ? jidNormalizedUser(pn) : null;
        }

        /** LID sin sufijo de dispositivo, o null si el documento no lo trae. / LID without device suffix, or null when the document does not carry it. */
        get #lid(): string | null {
            const lid = this.#raw.lid ?? (this.#raw.id.endsWith('@lid') ? this.#raw.id : null);
            return lid ? jidNormalizedUser(lid) : null;
        }

        /** Ruta del documento: bajo el teléfono cuando se conoce. / Document path: under the phone when known. */
        get #path(): string {
            return `/contact/${this.#jid ?? this.#lid ?? jidNormalizedUser(this.#raw.id)}`;
        }

        /** JID completo: el del teléfono cuando se conoce, el LID si no; el mismo formato que `chat.id` y `msg.from`. / Full JID: the phone's when known, otherwise the LID; the same format as `chat.id` and `msg.from`. */
        get id(): string {
            return this.#jid ?? this.#lid ?? jidNormalizedUser(this.#raw.id);
        }

        /** Nombre: agenda, público, verificado o teléfono. / Name: address book, public, verified or phone. */
        get name(): string {
            return this.#raw.name ?? this.#raw.notify ?? this.#raw.verifiedName ?? this.phone ?? this.id.split('@')[0]!;
        }

        /** Teléfono del JID; null mientras el LID no se mapee. / Phone of the JID; null until the LID is mapped. */
        get phone(): string | null {
            return this.#jid?.split('@')[0] ?? null;
        }

        /** Última conexión en ISO, tal como la entregó su presencia, o null si su privacidad la oculta. / Last seen as ISO, as its presence delivered it, or null when their privacy hides it. */
        get seen(): string | null {
            return this.#raw.lastSeen ? new Date(this.#raw.lastSeen * 1_000).toISOString() : null;
        }

        /** true cuando el contacto es la propia cuenta, anunciada por JID o por LID. / true when the contact is the account itself, announced by JID or by LID. */
        get me(): boolean {
            const mine = [instance.socket.user?.id, instance.socket.user?.lid].filter((id): id is string => Boolean(id)).map((id) => jidNormalizedUser(id));
            return [this.#jid, this.#lid].some((id) => id !== null && mine.includes(id));
        }

        /**
         * Sin argumento, la biografía: la de WhatsApp —que no avisa cuando alguien la cambia— se lee a
         * lo sumo una vez cada 24 h y se guarda en el engine bajo `/contact/<id>/bio` con la hora de la
         * consulta; si cambió, emite `contact:updated`, y sin red devuelve la guardada. Con texto cambia
         * la de la cuenta misma.
         * With no argument, the bio: WhatsApp's —which gives no notice when someone changes it— is read
         * at most once every 24 h and stored in the engine under `/contact/<id>/bio` with the time of
         * the query; when it changed it emits `contact:updated`, and without network it returns the
         * stored one. With text it changes the account's own.
         *
         * @param value - Biografía nueva / New bio
         * @returns La biografía; `''` si no tiene o su privacidad la oculta / The bio; `''` when there is none or their privacy hides it
         * @throws UNAUTHORIZED al cambiar la de otro contacto / when changing another contact's
         */
        async content(value?: string): Promise<string> {
            if (value !== undefined && this.me === false) throw new Error('UNAUTHORIZED');
            if (value !== undefined) await instance.socket.updateProfileStatus(value);
            const cached = await read<{ status: string; at: number }>(`${this.#path}/bio`);
            if (value === undefined && cached && Date.now() - cached.at < 86_400_000) return cached.status;
            const status = value ?? (await instance.socket.fetchStatus(this.#jid ?? this.#lid ?? jidNormalizedUser(this.#raw.id)).then((rows) => (rows?.[0] as { status?: { status?: string | null } } | undefined)?.status?.status ?? '', () => undefined));
            if (status === undefined) return cached?.status ?? this.#raw.status ?? '';
            const [current] = await Promise.all([read<Raw>(this.#path), write(`${this.#path}/bio`, { status, at: Date.now() })]);
            const changed = status !== (current?.status ?? this.#raw.status);
            Object.assign(this.#raw, { status });
            if (current && changed) {
                await write(this.#path, { ...current, status });
                wa.emit('contact:updated', this, await this.chat(), wa);
            }
            return status;
        }

        /**
         * Sin argumento, la foto de perfil vigente: la URL se pide a WhatsApp en cada llamada y el
         * binario se guarda bajo `/contact/<id>/photo`, así sólo se descarga cuando cambia. Con un
         * Buffer cambia la de la cuenta misma, y null la quita.
         * With no argument, the current profile picture: the URL is requested from WhatsApp on every
         * call and the binary is stored under `/contact/<id>/photo`, so it is only downloaded when it
         * changes. With a Buffer it changes the account's own, and null removes it.
         *
         * @param value - Foto nueva, o null para quitarla / New picture, or null to remove it
         * @returns La foto; Buffer vacío si no tiene o su privacidad la oculta / The picture; empty Buffer when there is none or their privacy hides it
         * @throws UNAUTHORIZED al cambiar la de otro contacto / when changing another contact's
         * @throws ERR_PROFILE_PICTURE_LIB si falta `sharp` o `jimp` / when `sharp` or `jimp` is missing
         */
        async photo(value?: Buffer | null): Promise<Buffer> {
            const jid = this.#jid ?? this.#lid ?? jidNormalizedUser(this.#raw.id);
            if (value !== undefined && this.me === false) throw new Error('UNAUTHORIZED');
            if (value !== undefined) await (value === null ? instance.socket.removeProfilePicture(jid) : instance.socket.updateProfilePicture(jid, value)).catch(library);
            return picture(`${this.#path}/photo`, () => instance.socket.profilePictureUrl(jid, 'image').then((found) => found ?? null, (error: { data?: unknown }) => ([401, 404].includes(Number(error?.data)) ? null : undefined)), value !== undefined);
        }

        /**
         * En la cuenta misma cambia el nombre público de WhatsApp; en otro contacto, el nombre con que
         * la cuenta lo guarda en su agenda, igual que `name(value)` en su chat 1:1.
         * On the account itself it changes the WhatsApp public name; on another contact, the name the
         * account saves it with in its address book, like `name(value)` on its 1:1 chat.
         *
         * @param name - Nombre nuevo / New name
         */
        async rename(name: string): Promise<string> {
            await (this.me ? instance.socket.updateProfileName(name) : (await this.chat()).name(name));
            Object.assign(this.#raw, this.me ? { name, notify: name } : { name });
            return name;
        }

        /**
         * Sin argumento, la última presencia que llegó del contacto —guardada en su ficha—, o null si
         * nunca llegó; WhatsApp sólo la envía de los contactos suscritos con `sub()`. Con un valor
         * anuncia la cuenta misma en línea o desconectada; el socket arranca sin anunciarse.
         * With no argument, the last presence that arrived from the contact —stored in its card—, or
         * null when none ever did; WhatsApp only sends it for contacts subscribed with `sub()`. With a
         * value it announces the account itself online or offline; the socket starts unannounced.
         *
         * @param value - true en línea, false desconectada / true online, false offline
         * @throws UNAUTHORIZED al anunciar otro contacto / when announcing another contact
         */
        online(): Presence | null;
        online(value: boolean): Promise<boolean>;
        online(value?: boolean): Presence | null | Promise<boolean> {
            if (value === undefined) return this.#raw.presence ?? null;
            if (this.me === false) return Promise.reject(new Error('UNAUTHORIZED'));
            return instance.socket.sendPresenceUpdate(value ? 'available' : 'unavailable').then(() => {
                Object.assign(this.#raw, { presence: value ? 'online' : 'offline' });
                return value;
            });
        }

        /**
         * Catálogos del negocio: uno por colección o, sin colecciones, uno con todos sus productos.
         * Cada colección se guarda como el timeline de sus versiones distintas y la hora de la última
         * descarga va en su metadata como `updated_at`. Lo bajado hace más de 24 horas se devuelve y se
         * refresca de fondo, y cada catálogo que cambia emite `catalog:updated`. Una consulta que no
         * responde ni borra lo guardado ni guarda un catálogo vacío: sin nada guardado devuelve `[]` y
         * vuelve a preguntar en la próxima llamada; un negocio que responde sin productos queda sin
         * catálogos.
         * The business catalogs: one per collection or, without collections, one with all its
         * products. Every collection is stored as the timeline of its distinct versions and the time
         * of the last download goes in its metadata as `updated_at`. What was downloaded over 24 hours
         * ago is returned and refreshed in the background, and every catalog that changes emits
         * `catalog:updated`. An unanswered query neither erases what is stored nor stores an empty
         * catalog: without anything stored it returns `[]` and asks again on the next call; a business
         * that answers without products is left without catalogs.
         */
        async catalog(): Promise<InstanceType<Instance['wa']['Catalog']>[]> {
            type Timeline = ConstructorParameters<Instance['wa']['Catalog']>[0];
            const jid = this.#jid;
            const path = (id: string) => `/catalog/${jid}/collection/${id}`;
            const race = <T>(request: Promise<T>): Promise<T | null> => Promise.race([request, new Promise<null>((done) => setTimeout(done, 20_000))]).catch(() => null);
            const pages = async (cursor?: string): Promise<Product[] | null> => {
                const page = await race(instance.socket.getCatalog({ jid: jid!, limit: 100, cursor }));
                return page ? (page.products.length && page.nextPageCursor ? [...page.products, ...((await pages(page.nextPageCursor)) ?? [])] : page.products) : null;
            };
            const refresh = async (stored: Timeline[]): Promise<Timeline[]> => {
                const [found, products] = await Promise.all([race(instance.socket.getCollections(jid!)), pages()]);
                const whole = { id: jid!.split('@')[0]!, name: '', products: products ?? [] } satisfies Omit<CatalogCollection, 'status'>;
                const raws: Timeline[number][] = found?.collections.length ? found.collections
                    : products?.length && (found || stored.every((timeline) => timeline[0]!.id === whole.id)) ? [whole]
                        : [];
                const answered = Boolean(found && products);
                if (found && (raws.length || answered)) await Promise.all(stored.filter((timeline) => raws.every((raw) => raw.id !== timeline[0]!.id)).map((timeline) => engine.unset(path(timeline[0]!.id))));
                const written = await Promise.all(raws.map(async (raw, index) => {
                    const previous = stored.find((timeline) => timeline[0]!.id === raw.id) ?? [];
                    const same = JSON.stringify(previous.at(-1), BufferJSON.replacer) === JSON.stringify(raw, BufferJSON.replacer);
                    const timeline: Timeline = same ? previous : [...previous, raw];
                    await Promise.all([same ? null : write(path(raw.id), timeline, raws.length - index), read<Record<string, unknown>>(`${path(raw.id)}/metadata`).then((found) => write(`${path(raw.id)}/metadata`, { ...found, updated_at: Date.now() }))]);
                    if (previous.length && same === false) wa.emit('catalog:updated', new wa.Catalog(timeline, jid!, Date.now()), wa);
                    return timeline;
                }));
                return written.length || answered ? written : stored;
            };
            if (jid === null) return [];
            const stored = (await engine.list(`/catalog/${jid}/collection`, 0, 1_000))
                .map((raw) => deserialize<Timeline>(raw))
                .filter((timeline): timeline is Timeline => Array.isArray(timeline) && timeline.length > 0);
            const stamps = await Promise.all(stored.map((timeline) => read<{ updated_at?: number }>(`${path(timeline[0]!.id)}/metadata`).then((found) => Number(found?.updated_at) || 0)));
            if (stamps.some((at) => Date.now() - at > 86_400_000)) void refresh(stored).catch(() => null);
            return stored.length ? stored.map((timeline, index) => new wa.Catalog(timeline, jid, stamps[index] || Date.now())) : (await refresh(stored)).map((timeline) => new wa.Catalog(timeline, jid, Date.now()));
        }

        /**
         * Chat 1:1 del contacto: el persistido, o una instancia mínima que no se guarda.
         * The contact's 1:1 chat: the persisted one, or a minimal instance that is not stored.
         */
        async chat(): Promise<InstanceType<Instance['wa']['Chat']>> {
            const cid = this.#jid ?? this.#lid ?? this.#raw.id;
            return new wa.Chat((await read(`/chat/${cid}`)) ?? { id: cid, name: this.name });
        }

        /**
         * Se suscribe a todo lo que le pasa al contacto: se crea, cambia o se borra, y su presencia
         * —`online`, `offline`, `typing`, `recording`—; con `offline` llega también su última
         * conexión en `seen`. Cada suscripción queda en un pool por contacto: WhatsApp deja de enviar
         * la presencia al reconectar y cada `connected` la vuelve a pedir, y el mismo handler sobre el
         * mismo contacto no se registra dos veces.
         * Subscribes to everything that happens to the contact: created, updated or deleted, and its
         * presence —`online`, `offline`, `typing`, `recording`—; with `offline` its last seen arrives
         * too, in `seen`. Every subscription stays in a per-contact pool: WhatsApp stops sending
         * presence on reconnect and every `connected` requests it again, and the same handler on the
         * same contact is not registered twice.
         *
         * @param handler - Recibe cada cambio / Receives every change
         * @returns Función para desuscribirse / Function to unsubscribe
         */
        sub(handler: (event: WatchEvent<ContactEvent, Contact>) => void): () => void {
            const jid = this.#jid ?? this.#lid ?? jidNormalizedUser(this.#raw.id);
            const handlers = pool.get(jid) ?? pool.set(jid, new Map()).get(jid)!;
            const known = handlers.get(handler);
            if (known) return known;
            const ids = [this.#jid, this.#lid].filter((id): id is string => id !== null);
            const mine = (who: Contact) => [who.#jid, who.#lid].some((id) => id !== null && ids.includes(id));
            void instance.socket.presenceSubscribe(jid).catch(() => null);
            const off = [
                wa.on('contact:created', (who) => mine(who) && handler({ name: 'created', payload: who })),
                wa.on('contact:updated', (who) => mine(who) && handler({ name: 'updated', payload: who })),
                wa.on('contact:deleted', (who) => mine(who) && handler({ name: 'deleted', payload: who })),
                wa.on('contact:presence', (who, presence) => mine(who) && handler({ name: presence, payload: who })),
            ];
            const unsubscribe = () => {
                off.forEach((stop) => stop());
                handlers.delete(handler);
                if (handlers.size === 0) pool.delete(jid);
            };
            handlers.set(handler, unsubscribe);
            return unsubscribe;
        }

        /**
         * Contacto por teléfono, JID o LID: el persistido o, si no lo está, el que se descubre por
         * red, sin guardar su ficha —nace con su chat o su primer mensaje—; sólo el índice `/lid`
         * guarda el mapeo que trajo. Un fallo de red rechaza: null es sólo «no está en WhatsApp».
         * Contact by phone, JID or LID: the persisted one or, when missing, the one discovered over
         * the network, without storing its card —it is born with its chat or its first message—; only
         * the `/lid` index keeps the mapping it brought. A network failure rejects: null only means
         * «not on WhatsApp».
         *
         * @param uid - Teléfono, JID o LID / Phone, JID or LID
         * @returns Contacto, o null si no existe en WhatsApp / Contact, or null when not on WhatsApp
         */
        static async get(uid: string | number): Promise<Contact | null> {
            const jid = await resolve(String(uid));
            const phone = jid?.endsWith('@s.whatsapp.net') ? jid : null;
            const cached = jid ? await read<Raw>(`/contact/${jid}`) : null;
            const found = phone && cached === null ? ((await instance.socket.onWhatsApp(phone.split('@')[0]!))?.[0] as { jid: string; exists: boolean; lid?: string } | undefined) : undefined;
            const id = found?.exists ? jidNormalizedUser(found.jid) : null;
            const doc: Raw | null = cached ?? (id ? { id, lid: found?.lid, phoneNumber: id } : null);
            if (id && found?.lid) await Promise.all([write(`/lid/${jidNormalizedUser(found.lid)}`, id), write(`/lid/${id}`, jidNormalizedUser(found.lid))]);
            return doc ? new this(doc) : null;
        }

        /**
         * @param offset - Desplazamiento / Offset
         * @param limit - Tamaño de página / Page size
         * @returns Página de contactos persistidos / Page of persisted contacts
         */
        static async list(offset = 0, limit = 50): Promise<Contact[]> {
            return (await engine.list('/contact', offset, limit)).flatMap((raw) => {
                const doc = deserialize<Raw>(raw);
                return doc ? [new this(doc)] : [];
            });
        }
    };
}

/** El contacto ligado a la sesión, para tipar sin instanciar. / The session-bound contact, to type without instantiating. */
export type Contact = InstanceType<ReturnType<typeof contact>>;
