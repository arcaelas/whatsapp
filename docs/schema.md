# Data Schemas

Reference for every document `@arcaelas/whatsapp` writes through an `Engine`.

Each document keeps the raw as WhatsApp delivers it through baileys, with baileys' field names: the
library translates nothing on write, and what it adds of its own is the timeline envelope and the
metadata documents. The snake_case names belong to the getters of the entities, which derive them
from the raw on read, so a field that baileys adds is stored without waiting for the library to map
it.

Documents are run through `serialize()` so the engine only ever sees and persists **strings**.
Binary payloads are the single exception: when the driver implements `set_buffer` they are written
raw, and otherwise they fall back to a base64 JSON document. The drivers are opaque pipes; they know
nothing about JSON, WhatsApp or buffers.

!!! warning "Documents written by 8.x"
    9.0.0 does not read the documents written by 8.x — snake_case contact and chat documents,
    messages with a `raw` field — and there is no migration: the listings skip them, like a corrupt
    document, instead of failing. The session is kept: `/session` did not change shape and the
    app-state keys 8.x stored as base64 text are recovered on read.

---

## Storage layout overview

The orchestrator writes to a small, fixed set of branches:

| Branch       | Purpose                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------- |
| `/session/`  | Authentication credentials and Signal protocol material.                                     |
| `/contact/`  | The baileys `Contact` of each contact, under its canonical JID.                              |
| `/chat/`     | The baileys `Chat` of each conversation, the timeline of each message and its media binary.  |
| `/status/`   | The timeline of each status (`Feed`) and its media binary.                                   |
| `/lid/`      | Bidirectional LID ↔ JID lookup index.                                                        |
| `/catalog/`  | The timeline of each catalog collection (`Catalog`), per business.                           |
| `/blocklist` | A single document with the JIDs the account has blocked.                                     |
| `/pinned`    | A single document with the JIDs of the pinned chats.                                         |
| `/unmapped`  | A single document with the LIDs of the cards and chats still stored without a phone.         |

Any entity path can also hold a `metadata` child with the integration's own values; see
[Metadata](#metadata-pathmetadata).

Paths use `/` as separator and **never start or end with a slash** once normalized — every driver
collapses `//` and trims both ends.

---

## Path index

| Path                                      | Purpose                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `/session/creds`                          | Baileys `AuthenticationCreds` (identity, signed prekey, registration…).      |
| `/session/<category>/<id>`                | Signal material written by baileys' key store (`pre-key`, `session`, `sender-key`, `app-state-sync-key`, …). |
| `/contact/<jid>`                          | The baileys `Contact`.                                                        |
| `/contact/<jid>/metadata`                 | Contact metadata.                                                             |
| `/contact/<jid>/photo`                    | `{ url }` of the last downloaded profile picture; its binary in `photo/content`. |
| `/contact/<jid>/bio`                      | `{ status, at }` of the last bio read: `content()` does not ask again for 24 h. |
| `/chat/<cid>`                             | The baileys `Chat`.                                                           |
| `/chat/<cid>/metadata`                    | Chat metadata.                                                                |
| `/chat/<cid>/photo`                       | `{ url }` of the last downloaded group picture; its binary in `photo/content`. |
| `/chat/<cid>/message/<mid>`               | Message timeline: the `WAMessage` and every later event.                      |
| `/chat/<cid>/message/<mid>/content`       | Media binary (raw, or `{ data: "<base64>" }`).                                |
| `/chat/<cid>/message/<mid>/metadata`      | Message metadata.                                                             |
| `/status/<id>`                            | Status timeline.                                                              |
| `/status/<id>/content`                    | Status media binary (raw, or `{ data: "<base64>" }`).                         |
| `/status/<id>/metadata`                   | Status metadata.                                                              |
| `/status/<id>/audience`                   | Array of the JIDs `Feed.create()` published the status to; the revoke goes to them. |
| `/lid/<lid>`                              | Forward map: LID → JID (serialized string).                                   |
| `/lid/<pn>`                               | Reverse map: JID → LID (serialized string).                                   |
| `/lid/<digits>_reverse`                   | Legacy fallback read by the JID resolver; written by older versions only.     |
| `/catalog/<jid>/collection/<id>`          | Timeline of the downloads of a catalog collection.                            |
| `/catalog/<jid>/collection/<id>/metadata` | Catalog metadata; the library keeps `updated_at` here.                        |
| `/catalog/<jid>/product/<pid>/metadata`   | Catalog product metadata.                                                     |
| `/blocklist`                              | Array of blocked JIDs.                                                        |
| `/pinned`                                 | Array of the pinned chat JIDs: `pinned(true)` counts them with one read.      |
| `/unmapped`                               | Array of the LIDs stored without a phone: the connection checks only these.   |

!!! note "Session keys"
    The exact set of `/session/<category>/<id>` paths depends on what baileys persists. The library
    treats every category uniformly: it serializes the value with `serialize()` and writes it under
    `/session/<category>/<id>`, a `null` value deletes it, and writes to the same path are queued in
    order. `app-state-sync-key` values are rebuilt with `proto.Message.AppStateSyncKeyData.fromObject`
    when read, which also decodes the keys that earlier versions stored as base64 text.

---

## Ordering: the `score`

`engine.set(path, value, score?)` takes an optional score, which is what `list` sorts by (DESC).

| Document                          | Score                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `/chat/<cid>`                     | `conversationTimestamp` × 1000: the last activity, epoch ms (write time while it has none). |
| `/chat/<cid>/message/<mid>`       | `messageTimestamp` × 1000 (epoch ms).                                                  |
| `/status/<id>`                    | `messageTimestamp` × 1000 (epoch ms).                                                  |
| `/catalog/<jid>/collection/<id>`  | Its position in the download: the first collection returned gets the highest score.    |
| Everything else                   | None — the driver falls back to write time.                                            |

Every event appended to a timeline rewrites the document with its original score, so a receipt or a
reaction on an old message keeps it in its place.

---

## Document shapes

All documents are JSON written by `serialize()`. Proto values keep their real values — enums and
longs as numbers, bytes as Buffers — instead of the proto's JSON mapping, so a raw read back still
compares against baileys' enums. Buffers are encoded with baileys' `BufferJSON`:

```json
{ "type": "Buffer", "data": "<base64 string>" }
```

`deserialize<T>(raw)` reconstructs the original `Buffer` instances when reading, and returns `null`
for a corrupt or truncated document instead of throwing.

---

### Timelines

Messages, statuses and catalog collections are stored as a **timeline**: an array with the raws
exactly as baileys emitted them, in arrival order, with no envelope. The first raw is the entity as
it arrived; each later raw is an event baileys emitted for it — a `messages.update`, a message that
refers to it. Nothing already recorded is rewritten: a new raw is appended at the end, and a raw
identical to the last one is its echo and is ignored. The getters search the timeline backwards for
the latest raw that defines their value, so an edit leaves the new text in force and the previous
one in the timeline.

The only exception is delivery. Receipts (`message-receipt.update`) and the `messages.update` that
carry only `status` are not appended: they replace a single delivery record `{ key, update: { status } }`
at the end of the timeline, with the highest state reached —an error rules, with its
`messageStubParameters`, until a progress arrives—. So an own message in a group of 200 does not add
600 receipt raws.

```ts
import type { LIDMapping, MessageUserReceiptUpdate, WAMessage, WAMessageUpdate } from 'baileys';

// a message or status timeline is a Raw[] in arrival order
type Raw = WAMessage | WAMessageUpdate | MessageUserReceiptUpdate | LIDMapping;
```

---

### Contact — `/contact/<jid>`

The baileys `Contact`, stored under its canonical JID: the phone JID when it is known, the LID
otherwise.

```ts
interface Contact {           // baileys Contact
    id: string;               // LID or phone JID, as baileys delivered it
    lid?: string;             // LID when known
    phoneNumber?: string;     // phone JID when known
    name?: string;            // address-book name
    notify?: string;          // push name set by the contact
    username?: string;        // username, when WhatsApp sends it
    verifiedName?: string;    // verified business name
    imgUrl?: string | null;   // profile picture URL ("changed" when it rotated)
    status?: string;          // bio / about
}
```

Example payload:

```json
{
    "id": "5491112345678@s.whatsapp.net",
    "lid": "140913951141911@lid",
    "phoneNumber": "5491112345678@s.whatsapp.net",
    "name": "Juan Perez",
    "notify": "Juanito",
    "imgUrl": "https://pps.whatsapp.net/v/t61.24694-24/...",
    "status": "Hey there! I am using WhatsApp."
}
```

Partial updates — `contacts.update`, or the push name of an incoming message when the contact has no
name yet — merge field by field over the stored document, and a field that arrives as `undefined`
never overwrites: an update that brings only the photo keeps the name. The
[`Contact`](references/contact.md) getters derive `id`, `name` and `phone` from this document;
`content()` stores the bio it reads under `/contact/<id>/bio` with the time of the query —and in
`status` when it changes—, and `photo()` keeps the picture under `/contact/<id>/photo`.

When WhatsApp reveals the phone behind a LID — through `lid-mapping.update`, or through the
`/unmapped` check that runs on every connection — the contact, the chat and the messages stored
under the LID move under the phone JID with their binaries and their metadata, and the LID copies
are deleted. The
fields the contact and the chat already had under the phone win, and each moved message gets a
`{ lid, pn }` entry.

---

### Chat — `/chat/<cid>`

The baileys `Chat` (`proto.IConversation`), stored without its `messages` array under the canonical
id — the phone JID when known, otherwise the LID or the `@g.us` — and merged field by field on every
`chats.upsert`, `chats.update`, `groups.upsert`, `groups.update` and new message. These are the
fields the library reads; every other field baileys sends is kept as it arrived:

```ts
interface Chat {                             // baileys Chat
    id: string;                              // phone JID, LID or @g.us
    name?: string | null;                    // group subject, or the contact's name
    description?: string | null;             // group description
    archived?: boolean | null;
    pinned?: number | null;                  // pin timestamp; null/absent = unpinned
    muteEndTime?: number | null;             // epoch ms; <= Date.now() means unmuted
    unreadCount?: number | null;
    conversationTimestamp?: number | null;   // epoch seconds of the last activity: orders the list
    pnJid?: string | null;                   // phone JID of the chat, when known
}
```

Example payload:

```json
{
    "id": "120363123456789@g.us",
    "name": "Dev Team",
    "description": "Standup at 9:00",
    "archived": false,
    "pinned": 1767371367857,
    "unreadCount": 5,
    "conversationTimestamp": 1767371360
}
```

`conversationTimestamp` × 1000 is the score every chat write passes to the engine, so `Chat.list`
returns chats by real activity. Each write keeps the greater value between what arrives and what is
stored, and a new message raises it to its own timestamp, so pinning, archiving, muting or marking
as read never move a chat.

The setters of [`Chat`](references/chat.md) — `archived()`, `pinned()`, `muted()`, `name()`,
`content()`, `ephemeral()` and `seen()` — write this document as soon as WhatsApp accepts the change
and emit the matching `chat:*` event; the echo arriving later finds no difference and does not
repeat it. A positive `unreadCount` in `chats.update` is an increment, as baileys
defines it, and is added to the stored one; `0` resets it and `-1` is a chat marked as unread.

---

### Message — `/chat/<cid>/message/<mid>`

A timeline. The first raw is the `WAMessage` as it arrived or as the library sent it; each later raw
is exactly what baileys emitted for it:

```ts
[
    WAMessage,          // the message (messages.upsert)
    WAMessage,          // a message that refers to it: reactionMessage, pinInChatMessage, protocolMessage
                        // (edit, revoke), pollUpdateMessage or encEventResponseMessage, encrypted
    { key, update },    // that vote or response decrypted on arrival, shaped like baileys' messages.update
    { key, update },    // messages.update: starred, edit, revoke, pollUpdates or eventResponses from baileys
    { lid, pn },        // lid-mapping.update: the chat was translated from its LID to the phone
    { key, update },    // the delivery record: { status }, the highest of the receipts and states
]
```

A message that refers to it is not appended twice when its id is already in the timeline. The
library's own sends and actions arrive by the same path: baileys echoes them, and what the library
relays by itself (a media edit, a vote, a view-once, a forward) is published on `messages.upsert` like any other
message.

Example payload, a sent text that was read; the second raw is the delivery record the receipts left:

```json
[
    {
        "key": { "remoteJid": "5491112345678@s.whatsapp.net", "fromMe": true, "id": "3EB0C767D26A1D0F8A7B" },
        "message": { "conversation": "Hi!" },
        "messageTimestamp": 1767371360,
        "status": 1
    },
    {
        "key": { "remoteJid": "5491112345678@s.whatsapp.net", "fromMe": true, "id": "3EB0C767D26A1D0F8A7B" },
        "update": { "status": 4 }
    }
]
```

The [`Message`](references/message.md) getters search the timeline backwards: the latest edit gives
`caption`, the latest pin gives `pinned` and the latest raw with `starred` gives `starred`. A revoke
sets `revoked_at` and keeps the text. A vote or an event response is stored encrypted, as baileys emits
it, and also decrypted on arrival —trying each LID and phone identity of the voter and of the
creator—, so reads do not decrypt; only the one that could not be decrypted then is retried on read,
and each voter's last vote by send time wins. `msg.status` takes the state of the delivery record: in
the example above it is `'read'`.

The `status` of the `WAMessage` and of the delivery record is the numeric proto value; a receipt
counts as `3`, or as `4` with `readTimestamp` and `5` with `playedTimestamp`. The readable string
[`Message.status`](references/message.md) exposes:

| Value | `msg.status`  | Meaning                        |
| ----- | ------------- | ------------------------------ |
| `0`   | `'error'`     | Send error                     |
| `1`   | `'pending'`   | Pending                        |
| `2`   | `'sent'`      | Server acknowledged            |
| `3`   | `'delivered'` | Delivered to recipient         |
| `4`   | `'read'`      | Read by recipient              |
| `5`   | `'played'`    | Played (audio/video)           |

The rejection and the business signature are read from the raws too. When the server rejects a
send, the ack stub arrives in `messageStubParameters` of the message or of an update, and
[`Message.reason`](references/message.md) translates it (`463` → `restricted`, `479` →
`invalid-session`); the verified business name arrives in `verifiedBizName` of the `WAMessage` and
`Message.business` exposes it.

---

### Message content — `/chat/<cid>/message/<mid>/content`

Only the binary of media messages lives here: image, video, audio, sticker and document. It is
written raw when the driver implements `set_buffer`; otherwise as a small JSON envelope:

```ts
interface ContentEnvelope {
    data: string;   // base64-encoded payload
}
```

The other types store nothing here: `content()` derives their payload from the timeline.

| `type`                                               | Stored here                  | `Message.content()` returns                                             |
| ---------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `text`                                               | Nothing                      | UTF-8 text of the latest edit.                                          |
| `location`                                           | Nothing                      | UTF-8 JSON `{ "lat": number, "lng": number }`.                          |
| `poll`                                               | Nothing                      | UTF-8 JSON `{ "content": string, "options": [{ "content": string }] }`. |
| `vcard`                                              | Nothing                      | The raw vCards, newline-joined.                                         |
| `event`                                              | Nothing                      | UTF-8 JSON of the baileys `eventMessage`.                               |
| `product`                                            | Nothing                      | UTF-8 product description.                                              |
| `image` / `video` / `audio` / `sticker` / `document` | The decrypted bytes          | The stored bytes, or a new download.                                    |

!!! info "The binary is written once"
    The binary is written on the first delivery of a message, or when the library sends it, and only
    when there are bytes to store. `Message.content()` returns it; when it is missing, it downloads it
    —asking WhatsApp to re-upload it when it expired—, stores it and returns it, and throws when it
    cannot be downloaded. `Message.stream()` delivers the stored one or the download as it arrives,
    without buffering nor storing it.

---

### Status broadcast — `/status/<id>`

A timeline like the message one. Only text, image, video and audio statuses are stored, on their
first delivery or when the account publishes them; a revoke deletes the document with its binary.

```ts
[
    WAMessage,          // the status@broadcast message
    { lid, pn },        // the author was translated from its LID to the phone
    WAMessage,          // a reactionMessage to the status
    { key, update },    // the delivery record: the receipts of whoever viewed it; seen(true) sets it to read
]
```

A status published with `Feed.create()` stores at `/status/<id>/audience` the JIDs it was published
to, and `delete()` revokes it from those same people; without that document —a status published from
the phone— the revoke goes to the address book.

`created_at`, `expires_at` (24 hours later, `FEED_TTL_MS`) and `seen()` are derived by
[`Feed`](references/feed.md) and not stored. The library does not delete a status when it expires.
Its binary lives at `/status/<id>/content` with the same envelope rules as a message.

---

### Catalog — `/catalog/<jid>/collection/<id>`

Each collection of a business catalog is the timeline of its distinct downloads, under the business
phone JID: each item is the collection exactly as baileys' `getCollections` returns it. A business
without collections has a single one with every product of `getCatalog`, the business phone as `id`,
`''` as `name` and no `status`. The collection names neither its owner nor the time of the download:
the owner comes from the path, and the library writes the time of the last download in the
collection's metadata as `updated_at`.

```ts
import type { Product } from 'baileys';

type Collection = {
    id: string;                                        // collection id; the phone in the catalog without collections
    name: string;                                      // '' in the catalog without collections
    products: Product[];                               // baileys products, in catalog order
    status?: { status: string; canAppeal: boolean };   // absent in the catalog without collections
};

// the document is a Collection[]: every distinct download, the last one is the current one
// /catalog/<jid>/collection/<id>/metadata holds { updated_at: <epoch ms of the last download>, ... }
```

Each product is the baileys node:

```ts
interface Product {                                        // baileys Product
    id: string;
    name: string;
    description: string;
    price: number;                                         // thousandths of the currency unit
    currency: string;                                      // ISO 4217
    retailerId?: string;
    url?: string;
    isHidden?: boolean;
    imageUrls: { requested: string; original: string };    // cover at 100×100, and the original cover
    reviewStatus: { whatsapp: string };                    // verdict of Meta's review
    availability: 'in stock';                              // baileys writes it literally
}
```

Example payload:

```json
[
    {
        "id": "5491112345678",
        "name": "",
        "products": [
            {
                "id": "8034215663256571",
                "imageUrls": {
                    "requested": "https://mmg.whatsapp.net/v/t45.5328-4/...",
                    "original": "https://mmg.whatsapp.net/v/t45.5328-4/..."
                },
                "reviewStatus": { "whatsapp": "APPROVED" },
                "availability": "in stock",
                "name": "Linen shirt",
                "retailerId": "SHIRT-001",
                "url": "https://shop.example.com/linen-shirt",
                "description": "100% linen, size M",
                "price": 15500,
                "currency": "USD",
                "isHidden": false
            }
        ]
    }
]
```

The timeline keeps only the downloads that changed something: a download identical to the last item
only refreshes `updated_at`, and a different one appends an item and emits `catalog:updated`. A
collection that a later answer of collections no longer returns is deleted; a download WhatsApp does
not answer deletes nothing. [`Catalog`](references/catalog.md) reads the last item and is built with
its owner, `new wa.Catalog(timeline, jid)`; each `wa.Product` is built from one of its products,
`new wa.Product([product], jid)`.

---

### Indexes — `/pinned` and `/unmapped`

Two JSON arrays that avoid walking the chats, like WhatsApp Web does with the indexes it keeps in
memory. `/pinned` holds the JIDs of the pinned chats and is kept by WhatsApp's echoes and `pinned()`.
`/unmapped` holds the LIDs of the cards and chats stored without a phone: every write of one adds it,
and every connection checks only those LIDs, merges into the phone the ones that already have a
mapping and keeps the rest. The first connection that does not find them walks `/contact` and
`/chat` once and builds them.

---

### Blocklist — `/blocklist`

A JSON array with the normalized JIDs the account has blocked:

```json
["5491187654321@s.whatsapp.net"]
```

It is rewritten on every connection with WhatsApp's list, when WhatsApp answers, and kept up to date
with the `blocklist.update` event. [`chat.blocked()`](references/chat.md) reads it without
going to the network, and asks WhatsApp only while the document does not exist.

---

### Metadata — `<path>/metadata`

Every entity has `metadata(patch?)`: values of the integration that live in the engine, in a
`metadata` child of the entity's path. Without an argument it reads; with an object it merges its
top-level keys over the stored ones, deletes the keys set to `null` or `undefined`, and returns the
result; when nothing is left, the document is deleted. WhatsApp never sees these values, and they do
not survive switching engines or emptying the engine.

| Entity                                                | Path                                        |
| ----------------------------------------------------- | ------------------------------------------- |
| `Contact`                                             | `/contact/<jid>/metadata`                   |
| `Chat`                                                | `/chat/<cid>/metadata`                      |
| `Message` and its subclasses, product cards included  | `/chat/<cid>/message/<mid>/metadata`        |
| `Feed`                                                | `/status/<id>/metadata`                     |
| `Catalog`                                             | `/catalog/<jid>/collection/<id>/metadata`   |
| `Product` of a catalog                                | `/catalog/<jid>/product/<pid>/metadata`     |

```ts
const chat = await wa.Chat.get('5491112345678');

await chat?.metadata({ crm_id: 'A-1029', stage: 'lead' }); // merges
await chat?.metadata({ stage: null });                     // deletes stage
const values = await chat?.metadata();                     // { crm_id: 'A-1029' }
```

The metadata goes wherever its entity goes: deleting a chat or a message deletes it in cascade, and a
LID absorbed into its phone carries it along. The catalog's is the one place where the library writes
a key of its own, `updated_at`, the time of the last download: the collection raw carries no time.
Deleting it makes the next read of `contact.catalog()` download again.

---

### Session credentials — `/session/creds`

The value is the **opaque** baileys `AuthenticationCreds` object serialized with `serialize()`. The
library does not introspect or document its internal fields; treat it as a black box owned by
baileys.

To rotate the session manually, `unset('/session/creds')` and let `connect()` regenerate it on the
next attempt — the orchestrator re-reads creds at the start of every retry.

---

### LID index — `/lid/<lid>`, `/lid/<pn>`

| Path                    | Value                                                                         |
| ----------------------- | ----------------------------------------------------------------------------- |
| `/lid/<lid>`            | JSON-encoded **string**: the canonical JID/PN for that LID.                   |
| `/lid/<pn>`             | JSON-encoded **string**: the LID for that PN, written together with the forward map. |
| `/lid/<digits>_reverse` | Legacy fallback, still read when the forward map is empty.                    |

The JID resolver uses this index to normalize any `@lid` identifier into a canonical
`@s.whatsapp.net` JID, and falls back to baileys' own LID mapping when the index has no entry.

---

## Engine path mapping

### `SQLiteEngine`

One table, `documents` by default:

```sql
CREATE TABLE documents (
    path   TEXT PRIMARY KEY,
    parent TEXT NOT NULL,
    score  INTEGER NOT NULL,
    value  TEXT NOT NULL DEFAULT '',
    binary BLOB
);
CREATE INDEX documents_order ON documents (parent, score DESC);
```

| Operation     | SQL                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| `get`         | `SELECT value FROM documents WHERE path = ?`                              |
| `set`         | `INSERT … ON CONFLICT(path) DO UPDATE SET value, score`                   |
| `unset`       | `DELETE … WHERE path = ? OR (path >= ? AND path < ?)` (subtree by range)   |
| `list`        | `SELECT value … WHERE parent = ? ORDER BY score DESC LIMIT ? OFFSET ?`    |
| `count`       | `SELECT COUNT(*) … WHERE parent = ?`                                      |
| `get/set_buffer` | The `binary` BLOB column of the same row.                              |

### `RedisEngine`

```
<prefix>:doc:<path>          -> string value (the serialized document)
<prefix>:doc:<path>:bin      -> raw binary (when the client supports buffers)
<prefix>:idx:<parent_path>   -> sorted set; score = the score passed to set, member = full child path
<prefix>:dir:<parent_path>   -> set; the subdirectories of the path (levels that are not documents)
```

A write to `/chat/120363@g.us/message/ABC` performs:

```
SET   wa:default:doc:chat/120363@g.us/message/ABC  "<json>"
ZADD  wa:default:idx:chat/120363@g.us/message      <score>  "chat/120363@g.us/message/ABC"
SADD  wa:default:dir:chat/120363@g.us              "chat/120363@g.us/message"
SADD  wa:default:dir:chat                          "chat/120363@g.us"
SADD  wa:default:dir:                              "chat"
```

| Operation         | Redis primitives                                                           |
| ----------------- | ---------------------------------------------------------------------------- |
| `get(path)`       | `GET <prefix>:doc:<path>`                                                  |
| `set(path,v,s)`   | `SET` + `ZADD` + `SADD` per ancestor, in one pipeline when the client exposes it |
| `unset(path)`     | Walks `ZREVRANGE idx:` + `SMEMBERS dir:` down the subtree, one level per batch, then `DEL` in batches of 500 + `ZREM`/`SREM` from the parent |
| `list(path)`      | `ZREVRANGE <prefix>:idx:<path>` + `MGET`                                   |
| `count(path)`     | `ZCARD <prefix>:idx:<path>` (O(1))                                         |
| `clear()`         | `SCAN`/`DEL` on `<prefix>:*`                                               |

Use a different prefix per account when sharing one Redis instance:

```ts
import IORedis from 'ioredis';
import { RedisEngine } from '@arcaelas/whatsapp';

const redis = new IORedis(process.env.REDIS_URL!);

const engine_a = new RedisEngine(redis, 'wa:5491112345678');
const engine_b = new RedisEngine(redis, 'wa:584121234567');
```

### `FileSystemEngine`

Each logical path maps to a directory holding the document as `index.json`:

```
<base>/chat/
├── .order                             # order of the chats
└── 120363123456789@g.us/
    ├── index.json                     # the chat document
    ├── metadata/
    │   └── index.json                 # the chat metadata
    └── message/
        ├── .order                     # order of the messages
        ├── 3EB0C767D26A1D0F8A7B/
        │   ├── index.json             # the message timeline
        │   └── content/
        │       └── content.bin        # the media binary
        └── 3EB0A1B2C3D4E5F60718/
            └── index.json
```

| Operation        | Filesystem behaviour                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `get(path)`      | Reads `<base>/<path>/index.json` from disk, asynchronously; `null` when missing.            |
| `set(path,v)`    | `mkdir -p`, atomic write (tmp + rename) and the `score` applied with `utimes`.              |
| `unset(path)`    | `rm -rf <base>/<path>`. Idempotent.                                                         |
| `list(path)`     | Sorted index from `.order` (or rebuilt with `readdir` + `stat`), then the page documents in parallel. |
| `count(path)`    | Size of the sorted index.                                                                   |
| `get/set_buffer` | `content.bin` next to the document.                                                         |
| `clear()`        | `rm -rf <base>`.                                                                            |

### `S3Engine`

Each path becomes an object under `<basedir>/`, with `@` replaced by `_at_`, plus an `.order` object
per prefix holding the scores S3 cannot store (`LastModified` is read-only). Binaries are stored as
base64 documents, since the driver implements no raw binary methods.

---

## Cascading `unset()`

`unset(path)` removes the document **and the entire subtree below it**. This is intentional and used
throughout the orchestrator for cheap bulk cleanup:

| Caller                                               | Path passed to `unset()`             | What gets removed                                                     |
| ---------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| `chat.delete()`, or a chat deleted on another device | `/chat/<cid>`                        | The chat document, its metadata, and every message with its binary and metadata. |
| `chat.clear()`                                       | `/chat/<cid>/message`                | Every message of the chat; the chat document and its metadata survive. |
| `msg.delete()` (only for me)                         | `/chat/<cid>/message/<mid>`          | The message timeline, its binary and its metadata.                    |
| Revoked status                                       | `/status/<id>`                       | The status timeline, its binary and its metadata.                     |
| Collection no longer returned by WhatsApp            | `/catalog/<jid>/collection/<id>`     | The collection timeline and its metadata.                             |
| `metadata()` left empty                              | `<path>/metadata`                    | Only the metadata document.                                           |
| LID absorbed into its phone                          | `/contact/<lid>`, `/chat/<lid>`      | The LID copies, once moved under the phone.                           |
| `disconnect()` without `destroy`                     | `/session`                           | Credentials and Signal keys; history is preserved.                    |
| Logout with `autoclean: false`                       | `/session/creds`                     | Only credentials; history is preserved.                               |

!!! warning "There is no per-leaf unset"
    `unset` always cascades. To remove just a sub-leaf, target it directly (e.g.
    `unset('/chat/<cid>/message/<mid>/content')` to drop only the binary while keeping the message
    timeline).

---

## Serialization helpers

Engines never see typed objects — only strings. The `serialize` / `deserialize` helpers handle the
JSON ↔ object boundary: `serialize` writes proto values as their real values and both preserve
`Buffer` instances through `BufferJSON`:

```ts
import { serialize, deserialize } from '@arcaelas/whatsapp';

await wa.engine.set('/app/config', serialize({ greeting: 'hi' }));

const raw = await wa.engine.get('/app/config');
const doc = deserialize<{ greeting: string }>(raw);  // → { greeting: 'hi' } | null
```

Use the same helpers from any custom code that touches the engine if you want bit-for-bit
compatibility with what the orchestrator writes.
