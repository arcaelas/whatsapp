/**
 * @file catalog.ts
 * @description Entidades Catalog y Product — cada colección del negocio con el timeline de sus
 * descargas, las colecciones exactas que devolvió baileys, y el producto tal como lo entrega.
 * Catalog and Product entities — every business collection with the timeline of its downloads,
 * the exact collections baileys returned, and the product exactly as it delivers it.
 */

import type { CatalogCollection, Product as Node } from 'baileys';
import type { Contact } from '~/lib/contact';
import sender, { internal, type Who } from '~/lib/sender';
import type { Instance, WatchEvent } from '~/lib/whatsapp';

/** Colección de `getCollections`; la que reúne todo el catálogo no trae `status`. / `getCollections` collection; the one gathering the whole catalog carries no `status`. */
type Collection = Omit<CatalogCollection, 'status'> & Partial<Pick<CatalogCollection, 'status'>>;

/**
 * Catálogo ligado a la sesión: una colección del negocio cuyo timeline guarda cada versión distinta
 * que se bajó, tal como la devolvió baileys. La colección no nombra a su dueño ni trae hora, así que
 * se construye con ellos: `new wa.Catalog(timeline, jid, updated_at)`.
 * Catalog bound to the live session: a business collection whose timeline keeps every distinct
 * downloaded version, exactly as baileys returned it. The collection names neither its owner nor a
 * time, so it is built with them: `new wa.Catalog(timeline, jid, updated_at)`.
 *
 * @param instance - Sesión activa: cliente, motor y socket / Active session: client, engine and socket
 * @returns Clase `Catalog` con acceso a la sesión / `Catalog` class with session access
 */
export default function catalog(instance: Instance) {
    const { wa } = instance;
    const Sender = sender(instance);
    const { metadata } = Sender[internal];

    return class Catalog {
        /** Versiones distintas de la colección; la última es la vigente. / Distinct versions of the collection; the last one is the current one. */
        readonly #timeline: Collection[];
        /** JID del negocio dueño. / Owning business JID. */
        readonly #jid: string;
        /** Última descarga en epoch ms, leída de la metadata. / Last download in epoch ms, read from the metadata. */
        readonly #at: number;

        /**
         * @param timeline - Descargas distintas de la colección / Distinct downloads of the collection
         * @param jid - JID del negocio dueño / Owning business JID
         * @param at - Última descarga en epoch ms / Last download in epoch ms
         */
        constructor(timeline: Collection[], jid: string, at = Date.now()) {
            this.#timeline = timeline;
            this.#jid = jid;
            this.#at = at;
        }

        /** Descarga vigente. / Current download. */
        get #last(): Collection {
            return this.#timeline.at(-1)!;
        }

        /** Identificador de la colección; el teléfono en el catálogo completo. / Collection identifier; the phone on the whole catalog. */
        get id(): string {
            return this.#last.id;
        }

        /** Nombre de la colección; vacío en el catálogo completo. / Collection name; empty on the whole catalog. */
        get name(): string {
            return this.#last.name;
        }

        /** Última descarga en ISO. / Last download as ISO. */
        get updated_at(): string {
            return new Date(this.#at).toISOString();
        }

        /** Negocio dueño del catálogo. / Business owning the catalog. */
        async contact(): Promise<Contact> {
            return (await wa.Contact.get(this.#jid)) ?? new wa.Contact({ id: this.#jid });
        }

        /** @returns Productos en el orden del catálogo / Products in catalog order */
        async products(offset = 0, limit = 50): Promise<InstanceType<Instance['wa']['Product']>[]> {
            return this.#last.products.slice(offset, offset + limit).map((node) => new wa.Product([node], this.#jid));
        }

        /** @param pid - Id o `sku` del producto en esta colección / Product id or `sku` in this collection */
        async product(pid: string): Promise<InstanceType<Instance['wa']['Product']> | null> {
            const node = this.#last.products.find((entry) => entry.id === pid || entry.retailerId === pid);
            return node ? new wa.Product([node], this.#jid) : null;
        }

        /**
         * Se suscribe a cada descarga del catálogo que trae algo distinto.
         * Subscribes to every catalog download that brings something different.
         *
         * @returns Función para desuscribirse / Function to unsubscribe
         */
        sub(handler: (event: WatchEvent<'updated', Catalog>) => void): () => void {
            return wa.on('catalog:updated', (found) => found.id === this.id && found.#jid === this.#jid && handler({ name: 'updated', payload: found }));
        }

        /** Metadatos de la integración, polimórficos como en `Contact`. / Integration metadata, polymorphic as in `Contact`. */
        metadata(): Promise<Record<string, unknown>>;
        metadata(key: string): Promise<unknown>;
        metadata(key: string, value: unknown): Promise<Record<string, unknown>>;
        metadata(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
        metadata(key?: string | Record<string, unknown>, ...value: unknown[]): Promise<unknown> {
            return metadata(`/catalog/${this.#jid}/collection/${this.id}`, key, value);
        }

        /**
         * Producto de un negocio por su id o su `sku`, en todos sus catálogos.
         * A business product by its id or its `sku`, across all its catalogs.
         *
         * @param uid - Negocio por `Contact`, teléfono, JID o LID / Business by `Contact`, phone, JID or LID
         * @param pid - Id o `sku` del producto / Product id or `sku`
         */
        static async product(uid: Who, pid: string): Promise<InstanceType<Instance['wa']['Product']> | null> {
            const owner = typeof uid === 'object' ? uid : await wa.Contact.get(uid);
            for (const found of (await owner?.catalog()) ?? []) {
                const item = await found.product(pid);
                if (item) return item;
            }
            return null;
        }
    };
}

/**
 * Producto del catálogo ligado a la sesión: el nodo de baileys se guarda íntegro y se traduce en
 * getters; como el catálogo, se construye con su dueño: `new wa.Product(timeline, jid)`.
 * `instanceof wa.Product` también reconoce la tarjeta que llega a un chat.
 * Catalog product bound to the live session: the baileys node is kept whole and translated in
 * getters; like the catalog, it is built with its owner: `new wa.Product(timeline, jid)`.
 * `instanceof wa.Product` also recognizes the card arriving in a chat.
 *
 * @param instance - Sesión activa: cliente, motor y socket / Active session: client, engine and socket
 * @returns Clase `Product` con acceso a la sesión / `Product` class with session access
 */
export function product(instance: Instance) {
    const { wa } = instance;
    const Sender = sender(instance);
    const { metadata, picture } = Sender[internal];

    return class Product {
        /** El producto tal como llegó en la descarga del catálogo. / The product as it arrived in the catalog download. */
        readonly #timeline: Node[];
        /** JID del negocio dueño. / Owning business JID. */
        readonly #jid: string;

        /**
         * @param timeline - Nodos del producto; el último es el vigente / Product nodes; the last one is the current one
         * @param jid - JID del negocio dueño / Owning business JID
         */
        constructor(timeline: Node[], jid: string) {
            this.#timeline = timeline;
            this.#jid = jid;
        }

        /** Nodo vigente. / Current node. */
        get #raw(): Node {
            return this.#timeline.at(-1)!;
        }

        /** Ruta del producto en el engine. / Product path in the engine. */
        get #path(): string {
            return `/catalog/${this.#jid}/product/${this.id}`;
        }

        /** Identificador del producto. / Product identifier. */
        get id(): string {
            return this.#raw.id;
        }

        /** Identificador del producto; en el catálogo coincide con `id`. / Product identifier; in the catalog it matches `id`. */
        get pid(): string {
            return this.#raw.id;
        }

        /** Nombre del producto. / Product name. */
        get name(): string {
            return this.#raw.name;
        }

        /** Precio en unidades: WhatsApp lo manda en milésimas. / Price in units: WhatsApp sends it in thousandths. */
        get price(): number {
            return this.#raw.price / 1_000;
        }

        /** Moneda ISO 4217. / ISO 4217 currency. */
        get currency(): string {
            return this.#raw.currency;
        }

        /** Enlace del producto, o null. / Product link, or null. */
        get link(): string | null {
            return this.#raw.url ?? null;
        }

        /** Identificador del vendedor, o null. / Seller identifier, or null. */
        get sku(): string | null {
            return this.#raw.retailerId ?? null;
        }

        /** true si está oculto al cliente. / true when hidden from the customer. */
        get hidden(): boolean {
            return this.#raw.isHidden ?? false;
        }

        /** Veredicto de la revisión de Meta, o null. / Meta review verdict, or null. */
        get status(): string | null {
            return this.#raw.reviewStatus?.whatsapp ?? null;
        }

        /** Descripción del producto. / Product description. */
        async content(): Promise<Buffer> {
            return Buffer.from(this.#raw.description ?? '', 'utf-8');
        }

        /** Portada original, guardada en el engine; Buffer vacío si no tiene. / Original cover, stored in the engine; empty Buffer when there is none. */
        async photo(): Promise<Buffer> {
            return picture(`${this.#path}/photo`, async () => this.#raw.imageUrls?.original ?? null);
        }

        /** Miniatura 100×100, guardada en el engine; Buffer vacío si no tiene. / 100×100 thumbnail, stored in the engine; empty Buffer when there is none. */
        async thumb(): Promise<Buffer> {
            return picture(`${this.#path}/thumb`, async () => this.#raw.imageUrls?.requested ?? null);
        }

        /** Catálogo del negocio que lo publica, o null si ya no está publicado. / Catalog of the business publishing it, or null when no longer published. */
        async catalog(): Promise<InstanceType<Instance['wa']['Catalog']> | null> {
            for (const found of (await (await wa.Contact.get(this.#jid))?.catalog()) ?? []) {
                if (await found.product(this.pid)) return found;
            }
            return null;
        }

        /** Metadatos de la integración, polimórficos como en `Contact`. / Integration metadata, polymorphic as in `Contact`. */
        metadata(): Promise<Record<string, unknown>>;
        metadata(key: string): Promise<unknown>;
        metadata(key: string, value: unknown): Promise<Record<string, unknown>>;
        metadata(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
        metadata(key?: string | Record<string, unknown>, ...value: unknown[]): Promise<unknown> {
            return metadata(this.#path, key, value);
        }

        /** @param value - Producto del catálogo o tarjeta de un chat / Catalog product or chat card */
        static [Symbol.hasInstance](value: unknown): boolean {
            return value instanceof wa.Message.Product || Function.prototype[Symbol.hasInstance].call(this, value);
        }
    };
}

/** El catálogo ligado a la sesión. / The session-bound catalog. */
export type Catalog = InstanceType<ReturnType<typeof catalog>>;

/** El producto del catálogo ligado a la sesión. / The session-bound catalog product. */
export type Product = InstanceType<ReturnType<typeof product>>;
