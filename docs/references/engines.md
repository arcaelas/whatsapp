# Engines

Persistence engines for session, contacts, chats and messages.

---

## Engine interface

All engines must implement the `Engine` interface:

```typescript
interface Engine {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | null): Promise<void>;
  list(prefix: string, offset?: number, limit?: number): Promise<string[]>;
}
```

### Methods

| Method | Description |
|--------|-------------|
| `get(key)` | Gets the value for a key. Returns `null` if not found. |
| `set(key, value)` | Sets a value. If `value` is `null`, deletes the key **and all sub-keys recursively** (cascade delete). |
| `list(prefix, offset, limit)` | Lists keys that start with `prefix`, ordered by most recent. Default `offset=0`, `limit=50`. |

The cascade delete behavior is critical: calling `engine.set("chat/123@s.whatsapp.net", null)` will delete the chat index, all messages, and all message content under that prefix.

---

## FileEngine

File system based engine. **Default.**

### Import

```typescript
import { FileEngine } from "@arcaelas/whatsapp";
```

### Constructor

```typescript
new FileEngine(base_path?: string)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `base_path` | `string` | `".baileys/default"` | Base directory |

### Example

```typescript
import { WhatsApp, FileEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new FileEngine(".baileys/my-bot"),
});
```

### File structure

```
.baileys/my-bot/
  session/
    creds                     # Authentication credentials
    {type}/{id}               # Signal keys (e.g. session/pre-key/1)
  lid/
    {lid}                     # LID reverse index (value: JID)
  contact/
    {jid}/
      index                   # Contact metadata (IContactRaw JSON)
  chat/
    {jid}/
      index                   # Chat metadata (IChatRaw JSON)
      messages                # Message index (TIMESTAMP MID per line)
      message/
        {mid}/
          index               # Message metadata (IMessageIndex JSON)
          raw                 # WAMessage JSON
          content             # Binary content (base64 encoded)
```

**Note:** FileEngine replaces `@` with `_at_` in file paths (e.g. `5491112345678@s.whatsapp.net` becomes `5491112345678_at_s.whatsapp.net`).

---

## RedisEngine

Redis based engine. **Included in the library.**

### Import

```typescript
import { RedisEngine } from "@arcaelas/whatsapp";
```

### Constructor

```typescript
new RedisEngine(client: RedisClient, prefix?: string)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `client` | `RedisClient` | - | Redis client instance (ioredis or redis compatible) |
| `prefix` | `string` | `"wa:default"` | Key prefix for all stored data |

### RedisClient interface

The `RedisClient` interface is minimal and compatible with both `ioredis` and `redis` packages:

```typescript
interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string | string[]): Promise<unknown>;
  scan(cursor: number | string, ...args: unknown[]): Promise<[string, string[]]>;
}
```

### Example with ioredis

```typescript
import Redis from "ioredis";
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";

const client = new Redis();
const engine = new RedisEngine(client, "wa:5491112345678");

const wa = new WhatsApp({ engine });
```

### Example with redis

```typescript
import { createClient } from "redis";
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";

const client = createClient({ url: "redis://localhost:6379" });
await client.connect();

const engine = new RedisEngine(client, "wa:my-bot");
const wa = new WhatsApp({ engine });
```

### Key structure in Redis

All keys are prefixed with `{prefix}:`. Example with prefix `wa:bot`:

```
wa:bot:session/creds
wa:bot:session/{type}/{id}
wa:bot:lid/{lid}
wa:bot:contact/{jid}/index
wa:bot:chat/{jid}/index
wa:bot:chat/{jid}/messages
wa:bot:chat/{jid}/message/{mid}/index
wa:bot:chat/{jid}/message/{mid}/raw
wa:bot:chat/{jid}/message/{mid}/content
```

**Note:** RedisEngine uses `SCAN` (not `KEYS`) for listing and cascade delete to avoid blocking the Redis server in production.

---

## Custom Engine

You can implement your own engine for any storage backend. Make sure to implement cascade delete in `set()` when `value` is `null`.

### PostgreSQL example

```typescript
import type { Engine } from "@arcaelas/whatsapp";
import { Pool } from "pg";

export class PostgresEngine implements Engine {
  private pool: Pool;

  constructor(connection_string: string) {
    this.pool = new Pool({ connectionString: connection_string });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
  }

  async get(key: string): Promise<string | null> {
    const result = await this.pool.query(
      "SELECT value FROM whatsapp_store WHERE key = $1",
      [key]
    );
    return result.rows[0]?.value ?? null;
  }

  async set(key: string, value: string | null): Promise<void> {
    if (value === null) {
      // Cascade delete: remove key and all sub-keys
      await this.pool.query(
        "DELETE FROM whatsapp_store WHERE key = $1 OR key LIKE $2",
        [key, `${key}/%`]
      );
    } else {
      await this.pool.query(
        `INSERT INTO whatsapp_store (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value]
      );
    }
  }

  async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT key FROM whatsapp_store
       WHERE key LIKE $1
       ORDER BY updated_at DESC
       OFFSET $2 LIMIT $3`,
      [`${prefix}%`, offset, limit]
    );
    return result.rows.map(row => row.key);
  }
}

// Usage
const engine = new PostgresEngine(process.env.DATABASE_URL!);
await engine.init();

const wa = new WhatsApp({ engine });
```

### Memory example (for testing)

```typescript
import type { Engine } from "@arcaelas/whatsapp";

export class MemoryEngine implements Engine {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string | null): Promise<void> {
    if (value === null) {
      // Cascade delete: remove key and all sub-keys
      this.store.delete(key);
      const prefix = `${key}/`;
      for (const k of this.store.keys()) {
        if (k.startsWith(prefix)) this.store.delete(k);
      }
    } else {
      this.store.set(key, value);
    }
  }

  async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
    const keys = Array.from(this.store.keys())
      .filter(k => k.startsWith(prefix));
    return keys.slice(offset, offset + limit);
  }

  clear() {
    this.store.clear();
  }
}

// Usage
const wa = new WhatsApp({
  engine: new MemoryEngine(),
});
```

---

## Implementation considerations

### Key structure

The library uses a hierarchical key structure:

```
session/creds                         # Authentication credentials
session/{type}/{id}                   # Signal keys
lid/{lid}                             # LID reverse index (value: JID)
contact/{jid}/index                   # Contact data (IContactRaw JSON)
chat/{jid}/index                      # Chat metadata (IChatRaw JSON)
chat/{jid}/messages                   # Message index (TIMESTAMP MID per line, newest first)
chat/{jid}/message/{mid}/index        # Message metadata (IMessageIndex JSON)
chat/{jid}/message/{mid}/raw          # WAMessage JSON
chat/{jid}/message/{mid}/content      # Binary content (base64 encoded string)
```

### Message index format

The `chat/{jid}/messages` key stores a newline-separated list of `TIMESTAMP MID` pairs, with the newest messages first:

```
1709312400000 ABCD1234
1709312300000 EFGH5678
1709312200000 IJKL9012
```

### JID normalization

JIDs contain `@` which may be problematic for some storage systems. FileEngine replaces `@` with `_at_`:

```typescript
// 5491112345678@s.whatsapp.net -> 5491112345678_at_s.whatsapp.net
```

Your engine can handle JIDs as-is if your storage supports it.

### Binary content

Messages may have binary content (images, videos, audio). The `content` key stores the data encoded as a base64 string, not raw binary.

### Atomicity

For production systems, consider implementing atomic operations, especially for `set()` which may be called multiple times during message processing.
