# Catalog

`Catalog` is the product catalog of a WhatsApp Business account — the own one or any Business
contact's — as WhatsApp publishes it. The document is persisted under `/catalog/<jid>` the first time
it is downloaded, so later reads cost nothing and `sync()` refreshes it on demand.

It is **read-only**: creating, editing and deleting products stays on the phone or in Meta's
Commerce Manager. WhatsApp did not answer those requests from a linked device during verification,
so the library does not offer them.

---

## Import

```typescript title="imports.ts"
import { WhatsApp, Catalog } from '@arcaelas/whatsapp';
```

The exported `Catalog` class carries the getters; the constructor you actually use is `wa.Catalog`,
the session-bound subclass with `get()`, `sync()` and `me`.

---

## Where instances come from

- `wa.Catalog.get()` — the own catalog.
- `wa.Catalog.get(uid)` — the catalog of a business by phone, JID, LID or `Contact`.
- `contact.catalog()` / `account.catalog()` — the same, from the entity.
- `product.item()` — the full card behind a received [`Product`](message.md#products) message.

```typescript title="bootstrap.ts"
const mine = await wa.Catalog.get();
const theirs = await wa.Catalog.get('5491112345678');

console.log(mine?.size, theirs?.products(0, 5));
```

`get` returns `null` when the identifier cannot be resolved or names a group. A Business without a
catalog — or a non-Business account — yields an **empty** catalog: WhatsApp never answers the
query, so the download is cut at 20 seconds per page and taken as empty.

---

## Properties

| Property     | Type     | Description                                                  |
| ------------ | -------- | ------------------------------------------------------------ |
| `id`         | `string` | Phone of the business owning the catalog.                    |
| `jid`        | `string` | Business JID (`@s.whatsapp.net`).                            |
| `size`       | `number` | Product count.                                               |
| `fetched_at` | `string` | Last download date as **ISO UTC**.                           |
| `me`         | `boolean`| `true` when the catalog belongs to the account itself.       |

---

## Methods

### `products(offset?, limit?)`

```typescript
products(offset = 0, limit = 50): Product[]
```

A page of products in catalog order, synchronous over the persisted document. Each product is:

```ts
{
    id: string;               // WhatsApp product id
    owner: string;            // the business JID
    name: string;
    description: string;
    price: number;            // in units, as WhatsApp displays it
    currency: string;         // ISO 4217
    retailer_id: string | null;
    url: string | null;
    hidden: boolean;
    images: string[];         // CDN URLs
    availability: string | null;
    status: string | null;    // review status
}
```

The type is derived from the class: `Catalog['_raw']['products'][number]`.

```typescript title="products.ts"
for (const item of catalog.products(0, 20)) {
    console.log(`${item.name} — ${item.price} ${item.currency}`, item.images[0]);
}
```

### `product(id)`

```typescript
product(id: string): Product | null
```

One product by its WhatsApp id or by its `retailer_id`, or `null`.

### `sync()`

```typescript
sync(): Promise<this>
```

Downloads the whole catalog again and persists it. Call it when the products may have changed since
`fetched_at`.

```typescript title="sync.ts"
const fresh = await (await wa.Catalog.get('5491112345678'))?.sync();
console.log(fresh?.size, fresh?.fetched_at);
```

---

## Statics (via `wa.Catalog`)

| Static           | Signature                                                          | Notes                                                                 |
| ---------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `wa.Catalog.get` | `(uid?: string \| number \| Contact) => Promise<Catalog \| null>`  | Own catalog without argument. Engine first, download and persist otherwise. |

---

## Persistence

| Path             | Value                                                             |
| ---------------- | ----------------------------------------------------------------- |
| `/catalog/<jid>` | `{ id, products, fetched_at }`; the score is `fetched_at`.        |

See [Data Schemas](../schema.md#catalog-catalogjid) for the full shape.
