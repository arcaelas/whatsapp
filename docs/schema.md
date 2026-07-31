# Data Schemas

Reference for every document `@arcaelas/whatsapp` writes through an `Engine`.

Documents are run through `serialize()` (which uses baileys' `BufferJSON`) so the engine only ever
sees and persists **strings**. Binary payloads are the single exception: when the driver implements
`set_buffer` they are written raw, and otherwise they fall back to a base64 JSON document. The
drivers are opaque pipes; they know nothing about JSON, WhatsApp or buffers.

---

## Storage layout overview

The orchestrator writes to a small, fixed set of branches:

| Branch       | Purpose                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| `/session/`  | Authentication credentials and Signal protocol material.                        |
| `/contact/`  | Contact metadata (one document per contact id).                                 |
| `/chat/`     | Chat metadata + per-chat message documents (with their content sub-documents).  |
| `/status/`   | Status broadcasts (`Feed`) and their content.                                   |
| `/lid/`      | Bidirectional LID ↔ JID lookup index.                                           |

Paths use `/` as separator and **never start or end with a slash** once normalized — every driver
collapses `//` and trims both ends.

---

## Path index

| Path                                    | Purpose                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `/session/creds`                        | Baileys `AuthenticationCreds` (identity, signed prekey, registration…).      |
| `/session/<category>/<id>`              | Signal material written by baileys' key store (`pre-key`, `session`, `sender-key`, `app-state-sync-key`, …). |
| `/contact/<id>`                         | Contact document.                                                            |
| `/chat/<cid>`                           | Chat document.                                                               |
| `/chat/<cid>/message/<mid>`             | Message document, including the full baileys `WAMessage` raw.                |
| `/chat/<cid>/message/<mid>/content`     | Message payload (raw binary, or `{ data: "<base64>" }`).                     |
| `/status/<id>`                          | Status broadcast document.                                                   |
| `/status/<id>/content`                  | Status payload (raw binary, or `{ data: "<base64>" }`).                      |
| `/lid/<lid>`                            | Forward map: LID → JID (serialized string).                                  |
| `/lid/<pn>`                             | Reverse map: JID → LID (serialized string).                                  |
| `/lid/<digits>_reverse`                 | Legacy fallback read by the JID resolver; written by older versions only.    |

!!! note "Session keys"
    The exact set of `/session/<category>/<id>` paths depends on what baileys persists. The library
    treats every category uniformly: it serializes the value with `BufferJSON` and writes it under
    `/session/<category>/<id>`.

---

## Ordering: the `score`

`engine.set(path, value, score?)` takes an optional score, which is what `list` sorts by (DESC).

| Document                          | Score                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `/chat/<cid>/message/<mid>`       | The message `created_at` (epoch ms).                            |
| `/status/<id>` (published by you) | The publication timestamp.                                      |
| Everything else                   | None — the driver falls back to write time.                     |

That is why re-syncing history does not reorder your chats: rewriting an old message keeps its
original position.

---

## Document shapes

All documents are JSON serialized with `BufferJSON`. Buffers are encoded as:

```json
{ "type": "Buffer", "data": "<base64 string>" }
```

`deserialize<T>(raw)` reconstructs the original `Buffer` / `Uint8Array` instances when reading, and
returns `null` for a corrupt or truncated document instead of throwing.

---

### Contact — `/contact/<id>`

```ts
interface ContactRaw {
    id: string;                   // LID or PN identifier, depending on addressing
    lid?: string | null;          // LID when known
    phone_number?: string | null; // PN JID when baileys knows it
    name?: string | null;         // address-book name
    notify?: string | null;       // push name set by the contact
    verified_name?: string | null;// verified business name
    img_url?: string | null;      // profile picture URL ("changed" when rotated)
    status?: string | null;       // bio / about
}
```

Example payload:

```json
{
    "id": "5491112345678@s.whatsapp.net",
    "lid": "140913951141911@lid",
    "phone_number": "5491112345678@s.whatsapp.net",
    "name": "Juan Perez",
    "notify": "Juanito",
    "verified_name": null,
    "img_url": "https://pps.whatsapp.net/v/t61.24694-24/...",
    "status": "Available 24/7"
}
```

The [`Contact`](references/contact.md) getters derive `name`, `phone`, `jid`, `lid` and `photo` from
this document.

---

### Chat — `/chat/<cid>`

The chat document only persists the fields the orchestrator tracks:

```ts
interface ChatRaw {
    id: string;
    name?: string | null;
    archived?: boolean | null;
    pinned?: number | null;          // pin timestamp; null/absent = unpinned
    mute_end_time?: number | null;   // epoch ms; <= Date.now() means unmuted
    unread_count?: number | null;
}
```

Example payload:

```json
{
    "id": "120363123456789@g.us",
    "name": "Dev Team",
    "archived": false,
    "pinned": 1767371367857,
    "mute_end_time": null,
    "unread_count": 5
}
```

---

### Message — `/chat/<cid>/message/<mid>`

```ts
import type { WAMessage } from 'baileys';

interface MessageRaw {
    id: string;                  // key.id
    cid: string;                 // remoteJidAlt || remoteJid
    mid: string | null;          // contextInfo.stanzaId (quoted message)
    me: boolean;                 // key.fromMe
    type: 'text' | 'image' | 'video' | 'audio' | 'sticker'
        | 'document' | 'location' | 'poll' | 'vcard' | 'event';
    author: string;              // resolved JID of the sender
    status: number;              // 0..5, see the table below
    starred: boolean;
    forwarded: boolean;          // contextInfo.isForwarded
    created_at: number;          // epoch ms (messageTimestamp * 1000)
    deleted_at: number | null;   // epoch ms when an ephemeral message expires
    mime: string;                // media mimetype, or text/plain
    caption: string;             // text body, caption, poll question or event description
    edited: boolean;
    multiple?: boolean;          // polls: multi-select, preserved across re-syncs
    reactions?: { author: string; emoji: string; at: number }[];
    raw: WAMessage;              // full baileys raw, used for forward / re-download
}
```

Numeric `status` values, and the readable string [`Message.status`](references/message.md) exposes:

| Value | `msg.status`  | Meaning                        |
| ----- | ------------- | ------------------------------ |
| `0`   | `'error'`     | Send error                     |
| `1`   | `'pending'`   | Pending                        |
| `2`   | `'sent'`      | Server acknowledged            |
| `3`   | `'delivered'` | Delivered to recipient         |
| `4`   | `'read'`      | Read by recipient              |
| `5`   | `'played'`    | Played (audio/video)           |

The document keeps no dedicated fields for the rejection or the business signature: both are
read from the baileys `raw`. When the server rejects a send, the ack stub is persisted in
`raw.messageStubParameters` and [`Message.reason`](references/message.md) translates it
(`463` → `restricted`, `479` → `invalid-session`); the verified business name arrives in
`raw.verifiedBizName` and `Message.business` exposes it.


---

### Message content — `/chat/<cid>/message/<mid>/content`

Written raw when the driver implements `set_buffer`; otherwise as a small JSON envelope:

```ts
interface ContentEnvelope {
    data: string;   // base64-encoded payload
}
```

The payload depends on `type`:

| `type`                                               | Payload                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `text`                                               | UTF-8 text (the message body).                                     |
| `location`                                           | UTF-8 JSON `{ "lat": number, "lng": number }`.                     |
| `poll`                                               | UTF-8 JSON `{ "content": string, "options": [{ "content": string }] }`. |
| `vcard`                                              | The raw vCards, newline-joined.                                    |
| `event`                                              | UTF-8 JSON of the baileys `eventMessage`.                          |
| `image` / `video` / `audio` / `sticker` / `document` | Decrypted bytes downloaded via `downloadMediaMessage`.             |

!!! info "Content is optional and written once"
    The sub-document is only written when there is something to store — empty buffers are skipped —
    and only on the **first** delivery of a message: re-syncs skip it because the payload already
    lives in the engine. `Message.content()` returns `Buffer.alloc(0)` when nothing is stored and the
    media can no longer be downloaded.

---

### Status broadcast — `/status/<id>`

```ts
import type { WAMessage } from 'baileys';

interface FeedRaw {
    id: string;
    author_jid: string;
    type: 'text' | 'image' | 'video' | 'audio';
    caption: string;
    mime: string;
    created_at: number;   // epoch ms
    expires_at: number;   // created_at + 24h (FEED_TTL_MS)
    viewed: boolean;      // true once a read receipt was sent
    raw: WAMessage;
}
```

Its content lives at `/status/<id>/content` with the same envelope rules as a message. See
[Feed](references/feed.md).

---

### Session credentials — `/session/creds`

The value is the **opaque** baileys `AuthenticationCreds` object serialized with `BufferJSON`. The
library does not introspect or document its internal fields; treat it as a black box owned by
baileys.

To rotate the session manually, `unset('/session/creds')` and let `connect()` regenerate it on the
next attempt — the orchestrator re-reads creds at the start of every retry.

---

### LID index — `/lid/<lid>`, `/lid/<pn>`

| Path                    | Value                                                                       |
| ----------------------- | ----------------------------------------------------------------------------- |
| `/lid/<lid>`            | JSON-encoded **string**: the canonical JID/PN for that LID.                  |
| `/lid/<pn>`             | JSON-encoded **string**: the LID for that PN (written by `lid-mapping.update`). |
| `/lid/<digits>_reverse` | Legacy fallback, still read when the forward map is empty.                   |

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
```

A write to `/chat/120363@g.us/message/ABC` performs:

```
SET   wa:default:doc:chat/120363@g.us/message/ABC  "<json>"
ZADD  wa:default:idx:chat/120363@g.us/message      <score>  "chat/120363@g.us/message/ABC"
```

| Operation         | Redis primitives                                                           |
| ----------------- | ---------------------------------------------------------------------------- |
| `get(path)`       | `GET <prefix>:doc:<path>`                                                  |
| `set(path,v,s)`   | `SET` + `ZADD` in one pipeline when the client exposes it                  |
| `unset(path)`     | `DEL` doc + `ZREM` from parent index + cascade `SCAN`/`DEL`                |
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
<base>/chat/120363@g.us/
├── index.json                     # the chat document
├── .order                         # sorted index of the children
└── message/
    ├── .order
    ├── ABC/
    │   ├── index.json             # the message document
    │   └── content/
    │       └── content.bin        # the raw payload
    └── DEF/
        └── index.json
```

| Operation     | Filesystem behaviour                                                        |
| ------------- | ----------------------------------------------------------------------------- |
| `get(path)`   | `readFile(<base>/<path>/index.json)`; `null` when missing.                   |
| `set(path,v)` | `mkdir -p`, atomic write (tmp + rename); `score` is applied with `utimes`.   |
| `unset(path)` | `rm -rf <base>/<path>`. Idempotent.                                          |
| `list(path)`  | Sorted index from `.order` (or rebuilt with `readdir` + `stat`), then read.  |
| `count(path)` | Size of the sorted index.                                                    |
| `clear()`     | `rm -rf <base>`.                                                             |

### `S3Engine`

Each path becomes an object under `<basedir>/`, with `@` replaced by `_at_`, plus an `.order` object
per prefix holding the scores S3 cannot store (`LastModified` is read-only). Binaries are stored as
base64 documents, since the driver implements no raw binary methods.

---

## Cascading `unset()`

`unset(path)` removes the document **and the entire subtree below it**. This is intentional and used
throughout the orchestrator for cheap bulk cleanup:

| Caller                          | Path passed to `unset()`             | What gets removed                                        |
| ------------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| `chat.delete()`                 | `/chat/<cid>`                        | The chat doc + every message and its content.             |
| `chat.clear()`                  | `/chat/<cid>/message`                | Every message of the chat; the chat document survives.    |
| `msg.delete()`                  | `/chat/<cid>/message/<mid>`          | The message doc + its content sub-document.               |
| Revoked status                  | `/status/<id>`                       | The status doc + its content.                             |
| Logout with `autoclean: false`  | `/session/creds`                     | Only credentials; history is preserved.                   |

!!! warning "There is no per-leaf unset"
    `unset` always cascades. To remove just a sub-leaf, target it directly (e.g.
    `unset('/chat/<cid>/message/<mid>/content')` to drop only the payload while keeping the message
    metadata).

---

## Serialization helpers

Engines never see typed objects — only strings. The `serialize` / `deserialize` helpers handle the
JSON ↔ object boundary and preserve `Buffer` instances through `BufferJSON`:

```ts
import { serialize, deserialize } from '@arcaelas/whatsapp';

await wa.engine.set('/app/config', serialize({ greeting: 'hi' }));

const raw = await wa.engine.get('/app/config');
const doc = deserialize<{ greeting: string }>(raw);  // → { greeting: 'hi' } | null
```

Use the same helpers from any custom code that touches the engine if you want bit-for-bit
compatibility with what the orchestrator writes.
