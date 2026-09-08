/**
 * @file catalog/index.ts
 * @description Entidad Catalog — el catálogo de productos de un negocio, el propio o el de
 * cualquier contacto Business, tal como WhatsApp lo publica.
 * Catalog entity — a business's product catalog, the own one or any Business contact's, as
 * WhatsApp publishes it.
 */

import { jidNormalizedUser, type Product as ProductNode, type WASocket } from 'baileys';
import type Contact from '~/lib/contact';
import { deserialize, jid_of, serialize, type Engine } from '~/lib/store';
import type WhatsApp from '~/lib/whatsapp';

/** Sesión activa que liga la entidad. / Active session binding the entity. */
type Init = { wa: WhatsApp; engine: Engine; socket: WASocket };

/**
 * Documento propio de un producto a partir del nodo de baileys. El precio viaja en milésimas
 * —`1500000` son 1500,00— y se presenta en unidades, como lo muestra WhatsApp.
 * Own product document from the baileys node. The price travels in thousandths —`1500000` is
 * 1500.00— and is presented in units, as WhatsApp shows it.
 */
const product_of = (owner: string, node: ProductNode) => ({
    id: node.id,
    owner,
    name: node.name,
    description: node.description ?? '',
    price: node.price / 1_000,
    currency: node.currency,
    retailer_id: node.retailerId ?? null,
    url: node.url ?? null,
    hidden: node.isHidden ?? false,
    images: Object.values(node.imageUrls ?? {}).filter((url): url is string => typeof url === 'string' && url.length > 0),
    availability: node.availability ?? null,
    status: Object.values(node.reviewStatus ?? {}).find((value): value is string => typeof value === 'string') ?? null,
});

/**
 * Catálogo: recibe el documento persistido y deriva todo con getters.
 * Catalog: receives the persisted document and derives everything via getters.
 */
export default class Catalog {
    /**
     * @internal Documento crudo: el JID del negocio, sus productos en el orden del catálogo y
     * cuándo se bajaron.
     * Raw document: the business JID, its products in catalog order and when they were fetched.
     */
    constructor(
        readonly _raw: {
            id: string;
            products: ReturnType<typeof product_of>[];
            fetched_at: number;
        }
    ) { }

    /** Teléfono del negocio dueño del catálogo. / Phone of the business owning the catalog. */
    get id(): string {
        return this._raw.id.split('@')[0].split(':')[0];
    }

    /** JID del negocio. / Business JID. */
    get jid(): string {
        return this._raw.id;
    }

    /** Cantidad de productos. / Product count. */
    get size(): number {
        return this._raw.products.length;
    }

    /** Fecha de la última descarga en ISO UTC. / Last download date as ISO UTC. */
    get fetched_at(): string {
        return new Date(this._raw.fetched_at).toISOString();
    }

    /**
     * Página de productos en el orden del catálogo.
     * Page of products in catalog order.
     *
     * @param offset - Desplazamiento / Offset
     * @param limit - Tamaño de página / Page size
     */
    products(offset = 0, limit = 50): Catalog['_raw']['products'] {
        return this._raw.products.slice(offset, offset + limit);
    }

    /**
     * Producto por id o por `retailer_id`, o null.
     * Product by id or by `retailer_id`, or null.
     *
     * @param id - Identificador de WhatsApp o del comercio / WhatsApp or merchant identifier
     */
    product(id: string): Catalog['_raw']['products'][number] | null {
        return this._raw.products.find((entry) => entry.id === id || entry.retailer_id === id) ?? null;
    }
}

/**
 * Catálogo ligado a la sesión viva: baja el catálogo de WhatsApp y lo persiste bajo `/catalog`.
 * Catalog bound to the live session: downloads the catalog from WhatsApp and persists it under
 * `/catalog`.
 *
 * @param init - Sesión activa: cliente, motor y socket / Active session: client, engine and socket
 * @returns Clase `Catalog` con acceso a la sesión / `Catalog` class with session access
 */
export function catalog(init: Init) {
    const mine = () => jidNormalizedUser(init.socket.user?.id ?? '');

    /**
     * Todas las páginas del catálogo de un negocio. Un negocio sin catálogo no responde a la
     * consulta y baileys esperaría 60 s por página: se corta a 20 s y se toma como vacío.
     * Every page of a business's catalog. A business without a catalog never answers the query
     * and baileys would wait 60s per page: it is cut at 20s and taken as empty.
     */
    const download = async (jid: string) => {
        const products: Catalog['_raw']['products'] = [];
        let cursor: string | undefined;
        do {
            const request = init.socket.getCatalog({ jid, limit: 100, cursor });
            const page = await Promise.race([request, new Promise<null>((resolve) => setTimeout(resolve, 20_000))]).catch(() => null);
            void request.catch(() => null);
            products.push(...(page?.products ?? []).map((node) => product_of(jid, node)));
            cursor = page?.products.length ? page.nextPageCursor : undefined;
        } while (cursor);
        return products;
    };

    class _Catalog extends Catalog {
        /** true cuando el catálogo es el de la propia cuenta. / true when the catalog belongs to the account itself. */
        get me(): boolean {
            return this._raw.id === mine();
        }

        /**
         * Vuelve a bajar el catálogo completo y lo persiste.
         * Downloads the whole catalog again and persists it.
         */
        async sync(): Promise<this> {
            this._raw.products = await download(this._raw.id);
            this._raw.fetched_at = Date.now();
            await init.engine.set(`/catalog/${this._raw.id}`, serialize(this._raw), this._raw.fetched_at);
            return this;
        }

        /**
         * Catálogo de un negocio por teléfono, JID, LID o `Contact`; sin argumento, el propio. El
         * persistido, o se baja de WhatsApp y se materializa la primera vez.
         * A business's catalog by phone, JID, LID or `Contact`; with no argument, the own one. The
         * persisted one, or downloaded from WhatsApp and materialized the first time.
         *
         * @param uid - Negocio; omitido para el propio / Business; omitted for the own one
         * @returns Catálogo, o null si el identificador es irresoluble / Catalog, or null when the identifier cannot be resolved
         */
        static async get(uid?: string | number | Contact): Promise<_Catalog | null> {
            const jid = uid === undefined ? mine()
                : typeof uid === 'object' ? uid.jid
                    : await jid_of(init.engine, String(uid), init.socket);
            if (jid?.endsWith('@s.whatsapp.net')) {
                const cached = deserialize<Catalog['_raw']>(await init.engine.get(`/catalog/${jid}`));
                return cached ? new this(cached) : new this({ id: jid, products: [], fetched_at: 0 }).sync();
            }
            return null;
        }
    }

    return _Catalog;
}
