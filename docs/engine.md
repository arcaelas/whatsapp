# Engine

Persistence system documentation for `@arcaelas/whatsapp`.

---

## Interface

An Engine must implement the following interface:

```typescript
interface Engine {
    /**
     * @description Retrieves a value by its key.
     * @param key Document path.
     * @returns JSON text or null if not found.
     */
    get(key: string): Promise<string | null>;

    /**
     * @description Saves or deletes a value.
     * If value is null, deletes the key and all sub-keys recursively (cascade delete).
     * @param key Document path.
     * @param value Text to save or null to delete recursively.
     */
    set(key: string, value: string | null): Promise<void>;

    /**
     * @description Lists keys under a prefix, ordered by most recent.
     * @param prefix Search prefix.
     * @param offset Pagination start (default: 0).
     * @param limit Maximum count (default: 50).
     * @returns Array of keys.
     */
    list(prefix: string, offset?: number, limit?: number): Promise<string[]>;
}
```

### Contracts

| Method | Expected Behavior |
|--------|-------------------|
| `get(key)` | Returns `string` if exists, `null` if not |
| `set(key, value)` | If `value` is `null`, deletes the key AND all sub-keys recursively |
| `set(key, value)` | If `value` is `string`, creates/updates |
| `list(prefix)` | Returns keys starting with `prefix` |
| `list(prefix)` | Descending order by modification date |

---

## Namespaces

The system uses 3 namespaces:

| Namespace | Description | Example Key |
|-----------|-------------|-------------|
| `session` | Credentials and connection state | `session/creds`, `session/{type}/{id}` |
| `contact` | Contact information | `contact/{jid}/index` |
| `chat` | Conversations, metadata, and messages | `chat/{jid}/index`, `chat/{cid}/message/{id}/index` |

Additionally, there is a reverse index namespace:

| Key | Description |
|-----|-------------|
| `lid/{lid}` | Maps a LID to a JID for contact lookup |

---

## Key Structure

### Session

Authentication and connection state.

```
session/creds                          -> Authentication credentials
session/app-state-sync-key/{id}        -> Sync keys
session/app-state-sync-version/{name}  -> State versions
session/sender-key/{jid}               -> Encryption keys per contact
session/sender-key-memory/{jid}        -> Key memory
session/pre-key/{id}                   -> Pre-keys
session/session/{jid}                  -> Encryption sessions
```

**Format**: JSON serialized with `BufferJSON` to handle binaries.

### Contact

Contact information.

```
contact/{jid}/index        -> JSON with contact data (IContactRaw)
```

**Example**:
```json
{
    "id": "584144709840@s.whatsapp.net",
    "lid": "140913951141911@lid",
    "name": "Juan Perez",
    "notify": "Juanito",
    "verifiedName": null,
    "imgUrl": "https://pps.whatsapp.net/...",
    "status": "Available 24/7"
}
```

### LID Reverse Index

```
lid/{lid}                  -> JID string (e.g. "584144709840@s.whatsapp.net")
```

### Chat

Conversations and their message indexes.

```
chat/{jid}/index           -> JSON with chat data (IChatRaw)
chat/{jid}/messages        -> Message index (see Relationships)
```

**Example `chat/{jid}/index`**:
```json
{
    "id": "120363123456789@g.us",
    "name": "Dev Team",
    "displayName": null,
    "description": "Group description",
    "unreadCount": 5,
    "readOnly": false,
    "archived": false,
    "pinned": 1767371367857,
    "muteEndTime": null,
    "markedAsUnread": false,
    "participant": [
        { "id": "584144709840@s.whatsapp.net", "admin": "superadmin" },
        { "id": "584121234567@s.whatsapp.net", "admin": null }
    ],
    "createdBy": "584144709840@s.whatsapp.net",
    "createdAt": 1700000000,
    "ephemeralExpiration": 604800
}
```

### Message

Messages separated into metadata, content, and raw.

```
chat/{cid}/message/{id}/index    -> JSON with metadata (IMessageIndex)
chat/{cid}/message/{id}/content  -> Buffer base64 (media)
chat/{cid}/message/{id}/raw      -> Full raw JSON (WAMessage)
```

**Example `chat/{cid}/message/{id}/index`**:
```json
{
    "id": "AC07DE0D18FA8254897A26C90B2FFD98",
    "cid": "584144709840@s.whatsapp.net",
    "mid": null,
    "me": false,
    "type": "text",
    "author": "584144709840@s.whatsapp.net",
    "status": 4,
    "starred": false,
    "forwarded": false,
    "created_at": 1767366759000,
    "deleted_at": null,
    "mime": "text/plain",
    "caption": "",
    "edited": false
}
```

---

## Relationships

### Problem

In relational databases, the `Message -> Chat` relationship is simple:
```sql
SELECT * FROM messages WHERE cid = ?;
```

In key-value stores, listing messages requires scanning all keys:
```
SCAN chat/{cid}/message/*/index
```

This is inefficient for:
- Paginated ordering by date
- Counting messages without loading them
- Getting the latest N messages

### Solution: Message Index

Each chat maintains an index of its messages:

```
chat/{cid}/messages
```

**Format**: Plain text with one line per message:
```
{TIMESTAMP} {MESSAGE_ID}
{TIMESTAMP} {MESSAGE_ID}
...
```

**Example**:
```
1767366759000 AC07DE0D18FA8254897A26C90B2FFD98
1767366758000 BC18EF1D29GB9365908B37D01C3GGE09
1767366757000 CC29FG2E30HC0476019C48E12D4HHF10
```

### Operations

These operations are available through the Message class API:

**List messages (paginated)** (`Message.list`):
```typescript
const messages = await wa.Message.list(cid, offset, limit);
```

**Count messages** (`Message.count`):
```typescript
const count = await wa.Message.count(cid);
```

**Delete a message** (instance method `msg.remove()`):
```typescript
const msg = await wa.Message.get(cid, mid);
if (msg) await msg.remove();
```

### Advantages

| Aspect | Without Index | With Index |
|--------|--------------|------------|
| List messages | SCAN + parse JSON | Split lines |
| Paginate | Load all | Direct slice |
| Count | Load all | Count lines |
| Sort | In-memory sort | Already sorted |
| Last message | Load all | First line |

---

## Cascade Delete

When deleting an entity, all its dependencies are deleted.

### How it works

The `set(key, null)` contract requires that when `value` is `null`, the engine deletes both the key itself AND all sub-keys with that prefix recursively. This is how cascade delete works.

### Delete Contact

```typescript
// Only deletes the contact index
await wa.engine.set("contact/{jid}/index", null);
```

### Delete Chat

Use `Chat.remove(cid)` (static) or `chat.remove()` (instance). This calls `wa.engine.set("chat/{cid}", null)` which cascade-deletes the chat index, message index, and all message data:

```typescript
// Static
await wa.Chat.remove(cid);

// Or via instance
const chat = await wa.Chat.get(cid);
if (chat) await chat.remove();
```

The engine's cascade delete on `set("chat/{cid}", null)` removes:
1. `chat/{cid}/index`
2. `chat/{cid}/messages`
3. `chat/{cid}/message/{mid}/index`, `/content`, `/raw` for each message

### Delete Message

Use the instance method `msg.remove()`:

```typescript
const msg = await wa.Message.get(cid, mid);
if (msg) await msg.remove();
```

This removes the message from the index and calls `wa.engine.set("chat/{cid}/message/{mid}", null)` which cascade-deletes `/index`, `/content`, and `/raw`.

---

## Engine Implementations

### FileEngine

Stores each key as a file in the filesystem.

```
.baileys/{session}/
|-- session/
|   |-- creds
|   |-- app-state-sync-key/
|   |   +-- {id}
|   +-- ...
|-- lid/
|   +-- {lid}
|-- contact/
|   +-- 584144709840_at_s.whatsapp.net/
|       +-- index
+-- chat/
    +-- 584144709840_at_s.whatsapp.net/
        |-- index
        |-- messages
        +-- message/
            +-- AC07DE.../
                |-- index
                |-- content
                +-- raw
```

**Considerations**:
- Sanitize `@` -> `_at_` for valid paths
- Create directories recursively
- Sort by `mtime` from filesystem
- `set(key, null)` uses `rm -rf` for cascade delete

### RedisEngine

Uses Redis as backend. Included in the library as an official export.

```
wa:{session}:session/creds
wa:{session}:contact/{jid}/index
wa:{session}:chat/{jid}/index
wa:{session}:chat/{jid}/messages
wa:{session}:chat/{cid}/message/{id}/index
wa:{session}:chat/{cid}/message/{id}/raw
wa:{session}:chat/{cid}/message/{id}/content
wa:{session}:lid/{lid}
```

**Considerations**:
- Prefix per session for multi-tenant
- Uses SCAN (not KEYS) for listing -- non-blocking
- `set(key, null)` scans and deletes all sub-keys matching `{key}/*` for cascade delete
- No native order, depends on message index

### PostgreSQL Engine (Example)

```typescript
class PostgresEngine implements Engine {
    constructor(private readonly _pool: Pool, private readonly _session: string) {}

    async get(key: string): Promise<string | null> {
        const { rows } = await this._pool.query(
            'SELECT value FROM kv_store WHERE session = $1 AND key = $2',
            [this._session, key]
        );
        return rows[0]?.value ?? null;
    }

    async set(key: string, value: string | null): Promise<void> {
        if (value) {
            await this._pool.query(
                `INSERT INTO kv_store (session, key, value, updated_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (session, key) DO UPDATE SET value = $3, updated_at = NOW()`,
                [this._session, key, value]
            );
        } else {
            // Cascade delete: delete exact key AND all sub-keys
            await this._pool.query(
                'DELETE FROM kv_store WHERE session = $1 AND (key = $2 OR key LIKE $3)',
                [this._session, key, key + '/%']
            );
        }
    }

    async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
        const { rows } = await this._pool.query(
            `SELECT key FROM kv_store
             WHERE session = $1 AND key LIKE $2
             ORDER BY updated_at DESC
             LIMIT $3 OFFSET $4`,
            [this._session, prefix + '%', limit, offset]
        );
        return rows.map(r => r.key);
    }
}
```

**Required table**:
```sql
CREATE TABLE kv_store (
    session VARCHAR(100) NOT NULL,
    key VARCHAR(500) NOT NULL,
    value TEXT,
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (session, key)
);

CREATE INDEX idx_kv_prefix ON kv_store (session, key varchar_pattern_ops);
CREATE INDEX idx_kv_updated ON kv_store (session, updated_at DESC);
```

---

## Key Summary

| Key Pattern | Type | Description |
|-------------|------|-------------|
| `session/creds` | JSON | Authentication credentials |
| `session/{type}/{id}` | JSON | Signal protocol keys |
| `lid/{lid}` | Text | Reverse index LID -> JID |
| `contact/{jid}/index` | JSON | Contact data (IContactRaw) |
| `chat/{jid}/index` | JSON | Chat data (IChatRaw) |
| `chat/{jid}/messages` | TXT | Index `{TS} {ID}\n` |
| `chat/{cid}/message/{id}/index` | JSON | Message metadata (IMessageIndex) |
| `chat/{cid}/message/{id}/content` | Base64 | Binary content |
| `chat/{cid}/message/{id}/raw` | JSON | Full raw WAMessage |

---

## Optimizations

### Batch Operations

For bulk operations, consider batch methods:

```typescript
interface EngineBatch extends Engine {
    set_batch(entries: Array<[key: string, value: string | null]>): Promise<void>;
}
```

### TTL (Time-To-Live)

For ephemeral messages:

```typescript
interface EngineTTL extends Engine {
    set_ttl(key: string, value: string, ttl_seconds: number): Promise<void>;
}
```

### Prefix Delete

For efficient cascade delete:

```typescript
interface EnginePrefix extends Engine {
    delete_prefix(prefix: string): Promise<number>;
}
```

**Redis implementation**:
```typescript
async delete_prefix(prefix: string): Promise<number> {
    let count = 0;
    let cursor = '0';
    do {
        const [next, keys] = await this._client.scan(cursor, 'MATCH', `${this._prefix}:${prefix}*`);
        cursor = next;
        if (keys.length) {
            await this._client.del(...keys);
            count += keys.length;
        }
    } while (cursor !== '0');
    return count;
}
```
