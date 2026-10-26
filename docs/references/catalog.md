# Catalog

`Catalog` is one collection of the product catalog of a WhatsApp Business account — the own one or
any business contact's — and `Product` is a product in its two forms: the item of a catalog and the
product card that arrives in a chat. Each collection is persisted as the timeline of its downloads
under `/catalog/<jid>/collection/<id>`: the first read downloads it and later reads come from the
engine.

It is **read-only**: creating, editing and deleting products stays on the phone or in Meta's
Commerce Manager. WhatsApp did not answer those requests from a linked device during verification,
so the library does not offer them.

---

## Import

```typescript title="imports.ts"
import { WhatsApp, type Catalog, type Product } from '@arcaelas/whatsapp';
```

`Catalog` and `Product` are exported as types. The classes are bound to the session and published on
connect as `wa.Catalog` and `wa.Product`. The `Product` type covers both forms: the catalog product
and the chat card.

---

## Where instances come from

- `contact.catalog()` — resolves the business's catalogs, one per collection.
- `(await wa.me())?.catalog()` — the account's own catalogs.
- `catalog.products(offset, limit)` — the products of a collection, as `wa.Product`.
- `wa.Catalog.product(uid, pid)` — one product of a business, by id or by `sku`.
- The `catalog:updated` event — a catalog that changed in a later download.
- `new wa.Catalog(timeline, jid, updated_at)` — a catalog built from a collection timeline read from
  the engine, its owner and the time of its last download, and `new wa.Product([node], jid)` a product built from one of its nodes: the
  baileys raw names no owner. The shape is in [Data Schemas](../schema.md#catalog-catalogjidcollectionid).
- A product card received in a chat arrives as a message, `wa.Message.Product`, which also answers
  to `instanceof wa.Product` (see [Product](#product)).

```typescript title="bootstrap.ts"
const business = await wa.Contact.get('5491112345678');
const catalogs = (await business?.catalog()) ?? [];

for (const catalog of catalogs) {
    const products = await catalog.products(0, 5);
    console.log(catalog.id, catalog.name, products.map((product) => product.name));
}
```

---

## Downloads and refresh

Every read of `contact.catalog()` follows the same flow:

1. With nothing stored, it downloads the collections (`getCollections`) and the full catalog
   (`getCatalog`, in pages of 100) in parallel. Each request is cut at 20 seconds, and a request that
   fails or does not answer is taken as empty.
2. A business with collections gets one `Catalog` per collection, in the order WhatsApp returns
   them, each with the products of its collection. Without collections — or when that request did
   not answer and nothing is stored but that catalog — it gets a single `Catalog` with every product
   of `getCatalog`, the business phone as `id` and `''` as `name`. Each download writes its time in
   the collection's metadata as `updated_at`.
3. With catalogs stored, it returns them from the engine. When one of them was downloaded more than
   24 hours ago, it returns them without waiting and downloads again in the background: each
   collection that changed emits `catalog:updated`, and a collection WhatsApp no longer returns is
   deleted from the engine — only when WhatsApp answered the collections request. When neither
   request answers, what is stored stays untouched and the next read tries again.

Nothing refreshes a catalog on a timer: downloads happen only when `contact.catalog()` is read.
`contact.catalog()` resolves `[]` when the contact has no known phone number, such as a contact known
only by its LID. A business without a catalog, an account that is not a business or an unanswered
query also resolve `[]` without storing anything, and the next read asks again.

!!! note "Collection limits"
    The collections are requested with baileys' defaults: up to 51 collections with up to 51
    products each. The catalog without collections has no such limit: its pages are followed until
    WhatsApp stops sending a cursor.

---

## Catalog properties

A `Catalog` reads the last download of its timeline, so its getters never go to the network.

| Property     | Type     | Description                                                                    |
| ------------ | -------- | ------------------------------------------------------------------------------ |
| `id`         | `string` | Collection identifier; the business phone in the catalog without collections.  |
| `name`       | `string` | Collection name; `''` in the catalog without collections.                      |
| `updated_at` | `string` | Last download of the collection, ISO, read from its metadata when the instance is built: the baileys raw carries no time. If the integration deletes it, the next read downloads again. |

---

## Catalog methods

### `contact()`

```typescript
contact(): Promise<Contact>
```

The business that owns the catalog: the persisted contact or the one `wa.Contact.get` discovers,
and a minimal contact with its JID when neither exists.

### `products(offset?, limit?)`

```typescript
products(offset = 0, limit = 50): Promise<Product[]>
```

A page of products of the last download, in catalog order, as [`wa.Product`](#product). It reads the
stored timeline and never goes to the network.

```typescript title="products.ts"
for (const product of await catalog.products(0, 20)) {
    console.log(`${product.name} — ${product.price} ${product.currency}`, (await product.photo()).length);
}
```

### `product(pid)`

```typescript
product(pid: string): Promise<Product | null>
```

A product of this collection by id or by `sku`, or `null`.

### `sub(handler)`

```typescript
sub(handler: (event: WatchEvent<'updated', Catalog>) => void): () => void
```

Subscribes to the downloads that bring something different for this collection of this business.
The handler receives `{ name: 'updated', payload }` with the new catalog, and the returned function
unsubscribes. It listens to `catalog:updated`, so it only fires when a later read of
`contact.catalog()` refreshes the collection.

```typescript title="sub.ts"
const off = catalog.sub(({ payload }) => {
    console.log('catalog changed', payload.name, payload.updated_at);
});

off();
```

### `metadata()`

Integration values under `/catalog/<jid>/collection/<id>/metadata`, polymorphic as
[`contact.metadata()`](contact.md#metadata). The library keeps its own key here, `updated_at`, which
`catalog.updated_at` reads. See [Data Schemas](../schema.md#metadata-pathmetadata).

---

## Statics (via `wa.Catalog`)

| Static               | Signature                                                                      | Notes                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `wa.Catalog.product` | `(uid: Contact \| string \| number, pid: string) => Promise<Product \| null>` | Searches every catalog of the business for a product by id or by `sku`; `null` when it is not published. It reads `contact.catalog()`, so the first call downloads. |

```typescript title="lookup.ts"
const product = await wa.Catalog.product('5491112345678', 'SHIRT-001');
console.log(product?.name, product?.price, product?.currency);
```

---

## Product

A product has two forms with the same getters:

- `wa.Product` — the product of a catalog, built from the node baileys downloads.
- `wa.Message.Product` — the product card that arrives in a chat. It is a
  [`Message`](message.md#products): its `id` is the message id, and it keeps every getter and method
  of a message.

`instanceof wa.Product` is `true` for both forms; `instanceof wa.Message.Product` only for the chat
card.

```typescript title="instanceof.ts"
wa.on('message:created', (msg) => {
    if (msg instanceof wa.Product) {
        console.log(msg.pid, msg.name, msg.price, msg.currency);
    }
});

const business = await wa.Contact.get('5491112345678');
const [catalog] = (await business?.catalog()) ?? [];
const [first] = (await catalog?.products(0, 1)) ?? [];
console.log(first instanceof wa.Product, first instanceof wa.Message.Product); // true false
```

| Property   | Type             | Catalog (`wa.Product`)                                  | Chat card (`wa.Message.Product`)                                             |
| ---------- | ---------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `id`       | `string`         | Product id.                                             | Message id.                                                                  |
| `pid`      | `string`         | Product id, the same as `id`.                           | Product id; `''` when the card carries none.                                 |
| `name`     | `string`         | Product name.                                           | Product name; `''` when the card carries none.                               |
| `price`    | `number`         | Price in units: WhatsApp sends it in thousandths.       | Price in units, from the card's `priceAmount1000`.                           |
| `currency` | `string`         | ISO 4217 currency.                                      | ISO 4217 currency; `''` when the card carries none.                          |
| `link`     | `string \| null` | Product link.                                           | Product link.                                                                |
| `sku`      | `string \| null` | Seller identifier (`retailerId`).                       | Seller identifier (`retailerId`).                                            |
| `hidden`   | `boolean`        | `true` when hidden from customers.                      | Always `false`: a card only travels while the product is visible.            |
| `status`   | see the columns  | `string \| null`: the verdict of Meta's review.          | The delivery status inherited from `Message`.                                |

---

## Product methods

### `catalog()`

```typescript
catalog(): Promise<Catalog | null>
```

The catalog of the business publishing the product, read through the business's
[`contact.catalog()`](#downloads-and-refresh), or `null` when the product is no longer published. The
chat card finds the business through the card's `businessOwnerJid`, or its author when the card does
not carry it.

```typescript title="product-catalog.ts"
wa.on('message:created', async (msg) => {
    if (msg instanceof wa.Message.Product) {
        const catalog = await msg.catalog();
        console.log(catalog?.name ?? 'no longer published');
    }
});
```

### `photo()` / `thumb()`

```typescript
photo(): Promise<Buffer>
thumb(): Promise<Buffer>
```

The original cover and the 100×100 thumbnail, downloaded once and stored in the engine under the
product; an empty Buffer when there is none. On the chat card, `thumb()` is the thumbnail embedded in
the card and `photo()` the cover of the product in the business catalog.

### `content()` / `metadata()`

`content()` returns the product description as UTF-8 in both forms. `metadata()` is polymorphic as
the catalog's: the catalog product stores it under
`/catalog/<jid>/product/<pid>/metadata`, and the chat card under its message,
`/chat/<cid>/message/<mid>/metadata`.

```typescript title="product.ts"
const product = await wa.Catalog.product('5491112345678', 'SHIRT-001');

if (product) {
    console.log(product.sku, product.link, (await product.thumb()).length, product.status);
    console.log((await product.content()).toString('utf-8'));
    await product.metadata('synced_at', Date.now());
}
```

---

## Persistence

| Path                                      | Value                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/catalog/<jid>/collection/<id>`          | Timeline of the collection's distinct downloads, as baileys returned them; the score is its position in the download. |
| `/catalog/<jid>/collection/<id>/metadata` | `catalog.metadata()`, with the library's `updated_at`.                                                       |
| `/catalog/<jid>/product/<pid>/metadata`   | `product.metadata()` of a catalog product.                                                                   |

`<jid>` is the business phone JID (`@s.whatsapp.net`). A download identical to the last item only
refreshes `updated_at`. See [Data Schemas](../schema.md#catalog-catalogjidcollectionid) for
the full shape.
