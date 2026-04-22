# Data Schemas

Reference for every document `@arcaelas/whatsapp` v3 writes through an `Engine`.

The library never stores binary blobs directly: every value is first run through
`serialize()` (which uses baileys `BufferJSON`) so the engine only ever sees and
persists **strings**. The engine drivers (`RedisEngine`, `FileSystemEngine`) are
opaque pipes; they are not aware of JSON, of WhatsApp, or of buffers.

---

## Storage layout overview

The orchestrator (`WhatsApp`) writes to a small, fixed set of paths. Everything
the library produces lives under one of these branches:

| Branch       | Purpose                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| `/session/`  | Authentication credentials and Signal protocol material.                        |
| `/contact/`  | Contact metadata (one document per contact JID).                                |
| `/chat/`     | Chat metadata + per-chat message documents (with separate content sub-docs).    |
| `/lid/`      | Bidirectional LID ↔ JID lookup index.                                           |

Paths use `/` as separator and **never start or end with a slash** once
normalized — both engines collapse `//` and trim leading/trailing `/`.

---

## Path index

Every concrete path the orchestrator may write or read.

| Path                                              | Purpose                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `/session/creds`                                  | Baileys `AuthenticationCreds` (PIN, signed prekey, identity, registration). |
| `/session/pre-key/<id>`                           | Signal pre-key entry written by baileys' key store.                       |
| `/session/session/<id>`                           | Signal session record per remote identity.                                |
| `/session/app-state-sync-key/<id>`                | App-state sync key (rebuilt via `proto.Message.AppStateSyncKeyData.create`). |
| `/session/sender-key/<id>`                        | Group sender keys.                                                        |
| `/session/sender-key-memory/<id>`                 | Sender-key memory used during fan-out.                                    |
| `/session/device-list/<jid>`                      | Cached device list for a JID.                                             |
| `/session/lid-mapping/<id>`                       | Cached LID mapping entries persisted by baileys' key store.               |
| `/contact/<jid>`                                  | Contact document (`IContactRaw`).                                         |
| `/chat/<cid>`                                     | Chat document (`IChatRaw`).                                               |
| `/chat/<cid>/message/<mid>`                       | Message document (`IMessage`) including the full baileys `WAMessage` raw. |
| `/chat/<cid>/message/<mid>/content`               | Decoded payload `{ data: "<base64>" }` (text, JSON, or media bytes).      |
| `/lid/<lid>`                                      | Forward map: LID → JID (string).                                          |
| `/lid/<lid>_reverse`                              | Reverse fallback used by `_resolve_jid()` when the LID is unmapped.       |

!!! note "Session keys"
    The exact set of `/session/<category>/<id>` paths depends on what baileys
    persists. The library treats every category uniformly: it serializes the
    value with `BufferJSON` and writes it under `/session/<category>/<id>`.

---

## Document shapes

All documents are JSON serialized with `BufferJSON`. Buffers are encoded as:

```json
{ "type": "Buffer", "data": "<base64 string>" }
```

`deserialize<T>(raw)` reconstructs the original `Buffer`/`Uint8Array` instances
when reading.

---

### `IContactRaw` — `/contact/<jid>`

```ts
interface IContactRaw {
    id: string;                  // canonical JID (e.g. 584144709840@s.whatsapp.net)
    lid: string | null;          // alternative LID identifier when known
    name: string | null;         // address-book name
    notify: string | null;       // push name set by the contact
    verified_name: string | null;// verified business name
    img_url: string | null;      // profile picture URL ("changed" if rotated)
    status: string | null;       // bio / about
}
```

Example payload:

```json
{
    "id": "584144709840@s.whatsapp.net",
    "lid": "140913951141911@lid",
    "name": "Juan Perez",
    "notify": "Juanito",
    "verified_name": null,
    "img_url": "https://pps.whatsapp.net/v/t61.24694-24/...",
    "status": "Available 24/7"
}
```

---

### `IChatRaw` — `/chat/<cid>`

The chat doc only persists fields the orchestrator explicitly tracks (see
`_handle_chats_upsert` / `_handle_chats_update`):

```ts
interface IChatRaw {
    id: string;
    name?: string | null;
    archived?: boolean | null;
    pinned?: number | null;          // pin timestamp; null/absent = unpinned
    mute_end_time?: number | null;   // ms epoch; <= Date.now() means unmuted
    unread_count?: number | null;
    read_only?: boolean | null;
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
    "unread_count": 5,
    "read_only": false
}
```

---

### `IMessage` — `/chat/<cid>/message/<mid>`

```ts
interface IMessage {
    id: string;                  // key.id
    cid: string;                 // remoteJidAlt || remoteJid
    mid: string | null;          // contextInfo.stanzaId (parent for replies)
    me: boolean;                 // key.fromMe
    type: 'text' | 'image' | 'video' | 'audio' | 'location' | 'poll';
    author: string;              // resolved JID of the sender
    status: MessageStatus;       // 0..5 (ERROR..PLAYED)
    starred: boolean;
    forwarded: boolean;          // contextInfo.isForwarded
    created_at: number;          // ms epoch (messageTimestamp * 1000)
    deleted_at: number | null;   // ms epoch when ephemeral expires
    mime: string;                // text/plain | application/json | media mimetype
    caption: string;             // text body or caption/title/option-list for media
    edited: boolean;
    raw: WAMessage;              // full baileys raw, used for forward / re-download
}
```

`MessageStatus` enum:

| Value | Constant     | Meaning                          |
| ----- | ------------ | -------------------------------- |
| `0`   | `ERROR`      | Send error                       |
| `1`   | `PENDING`    | Pending                          |
| `2`   | `SERVER_ACK` | Server acknowledged              |
| `3`   | `DELIVERED`  | Delivered to recipient           |
| `4`   | `READ`       | Read by recipient                |
| `5`   | `PLAYED`     | Played (audio/video)             |

---

### Message content — `/chat/<cid>/message/<mid>/content`

Stored as a small JSON envelope:

```ts
interface IMessageContent {
    data: string;                // base64-encoded payload
}
```

The content shape depends on `IMessage.type`:

| `type`     | Payload (after base64 decode)                                              |
| ---------- | -------------------------------------------------------------------------- |
| `text`     | UTF-8 text (the message body).                                             |
| `location` | UTF-8 JSON `{ "lat": number, "lng": number }`.                             |
| `poll`     | UTF-8 JSON `{ "content": string, "options": [{ "content": string }] }`.    |
| `image` / `video` / `audio` | Raw decrypted bytes downloaded via `downloadMediaMessage`. |

!!! info "Content is optional"
    The `content` sub-document is only written when there is something to
    store — empty buffers are skipped. `Message.content()` returns
    `Buffer.alloc(0)` when missing.

---

### Session credentials — `/session/creds`

The value is the **opaque** baileys `AuthenticationCreds` object serialized
with `BufferJSON`. The library does not introspect or document its internal
fields; consumers should treat it as a black box owned by baileys.

To rotate the session manually, `unset('/session/creds')` and let
`connect()` regenerate it on the next `start()` (the orchestrator re-reads
creds at the start of every retry).

---

### LID index — `/lid/<lid>` and `/lid/<lid>_reverse`

| Path                  | Value                                              |
| --------------------- | -------------------------------------------------- |
| `/lid/<lid>`          | JSON-encoded **string**: the canonical JID/PN.     |
| `/lid/<lid>_reverse`  | JSON-encoded **string** or **number**: PN fallback when the forward map is empty. |

Used by `WhatsApp._resolve_jid()` to normalize any `@lid` identifier into a
canonical `@s.whatsapp.net` JID.

---

## Engine path mapping

### `RedisEngine`

The Redis driver uses two keyspaces per logical path:

```
<prefix>:doc:<path>          -> string value (the serialized document)
<prefix>:idx:<parent_path>   -> sorted set; score = mtime (Date.now()), member = full child path
```

So a write to `/chat/120363@g.us/message/ABC` actually performs:

```
SET   wa:default:doc:chat/120363@g.us/message/ABC  "<json>"
ZADD  wa:default:idx:chat/120363@g.us/message      <ts>  "chat/120363@g.us/message/ABC"
```

| Operation         | Redis primitives                                                           |
| ----------------- | -------------------------------------------------------------------------- |
| `get(path)`       | `GET <prefix>:doc:<path>`                                                  |
| `set(path,v)`     | `SET <prefix>:doc:<path>` + `ZADD <prefix>:idx:<parent> Date.now() <path>` |
| `unset(path)`     | `DEL` doc + `ZREM` from parent index + cascade `SCAN/DEL` on `doc:<path>/*` and `idx:<path>(/*)` |
| `list(path)`      | `ZREVRANGE <prefix>:idx:<path>` + `MGET` on the matched docs (one round-trip pair) |
| `count(path)`     | `ZCARD <prefix>:idx:<path>` (O(1))                                         |
| `clear()`         | `SCAN/DEL` on `<prefix>:*`                                                 |

The prefix defaults to `wa:default`. Use a different prefix per account when
sharing one Redis instance across sessions:

```ts
import IORedis from 'ioredis';
import { RedisEngine } from '@arcaelas/whatsapp';

const redis = new IORedis(process.env.REDIS_URL);

const engine_a = new RedisEngine(redis, 'wa:584144709840');
const engine_b = new RedisEngine(redis, 'wa:584121234567');
```

---

### `FileSystemEngine`

The filesystem driver maps each logical path to a directory and writes the
document inside it as `index.json`:

```
<base>/<path>/index.json      -> document
```

A write to `/chat/120363@g.us/message/ABC` produces:

```
<base>/chat/120363@g.us/message/ABC/index.json
```

Sub-paths simply nest as additional directories alongside `index.json`, so a
resource and its children can coexist on disk:

```
<base>/chat/120363@g.us/
├── index.json                     # the chat document
└── message/
    ├── ABC/
    │   ├── index.json             # the message document
    │   └── content/
    │       └── index.json         # the { data: base64 } envelope
    └── DEF/
        └── index.json
```

| Operation     | Filesystem behaviour                                                     |
| ------------- | ------------------------------------------------------------------------ |
| `get(path)`   | `readFile(<base>/<path>/index.json)`; returns `null` when missing.       |
| `set(path,v)` | `mkdir -p <base>/<path>` then `writeFile(index.json)` (refreshes mtime). |
| `unset(path)` | `rm -rf <base>/<path>`. Idempotent — never throws on missing.            |
| `list(path)`  | `readdir`, `stat` each `<child>/index.json`, sort by mtime DESC, slice.  |
| `count(path)` | Counts direct children that have a valid `index.json`.                   |
| `clear()`     | `rm -rf <base>`.                                                         |

---

## Cascading `unset()`

`unset(path)` removes the document **and the entire subtree below it**. This
is intentional and used throughout the orchestrator for cheap bulk cleanup:

| Caller                                 | Path passed to `unset()`           | What gets removed                                   |
| -------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| `Chat.remove(cid)` / `chat.remove()`   | `/chat/<cid>`                      | The chat doc + every `/message/<mid>` and its `/content`. |
| `Message.delete()` / `Message.remove()`| `/chat/<cid>/message/<mid>`        | The message doc + its `/content` sub-doc.           |
| `Contact` deletion                     | `/contact/<jid>`                   | Just the contact doc (no children).                 |
| Logout with `autoclean: false`         | `/session/creds`                   | Only credentials; history is preserved.             |

!!! warning "There is no per-leaf unset"
    `unset` always cascades. To remove just a sub-leaf, target it directly
    (e.g. `unset('/chat/<cid>/message/<mid>/content')` to drop only the
    payload while keeping the message metadata).

---

## Serialization helpers

Engines never see typed objects — only strings. The `serialize`/`deserialize`
helpers handle the JSON ↔ object boundary and preserve `Buffer` instances
through `BufferJSON`:

```ts
import { serialize, deserialize } from '@arcaelas/whatsapp';

await wa.engine.set('/chat/abc', serialize({ id: 'abc', name: 'demo' }));

const raw = await wa.engine.get('/chat/abc');
const doc = deserialize<IChatRaw>(raw);  // → { id, name, ... } or null
```

Use the same helpers in any custom `Engine` callers if you want bit-for-bit
compatibility with what the orchestrator writes.
