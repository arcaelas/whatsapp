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
| `set(key, value)` | Sets a value. If `value` is `null`, deletes the key. |
| `list(prefix, offset, limit)` | Lists keys that start with `prefix`. |

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
    creds/index           # Credentials
    keys/index            # Encryption keys
  contact/
    5491112345678_at_s.whatsapp.net/index
  chat/
    5491112345678_at_s.whatsapp.net/
      index               # Chat metadata
      message/
        index             # Message index
        {mid}/
          index           # Message metadata
          content         # Binary content
```

---

## Custom Engine

You can implement your own engine for any storage:

### Redis example

```typescript
import type { Engine } from "@arcaelas/whatsapp";
import { createClient } from "redis";

export class RedisEngine implements Engine {
  private client: ReturnType<typeof createClient>;

  constructor(url: string) {
    this.client = createClient({ url });
  }

  async connect() {
    await this.client.connect();
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async set(key: string, value: string | null): Promise<void> {
    if (value === null) {
      await this.client.del(key);
    } else {
      await this.client.set(key, value);
    }
  }

  async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
    const keys = await this.client.keys(`${prefix}*`);
    return keys.slice(offset, offset + limit);
  }
}

// Usage
const engine = new RedisEngine("redis://localhost:6379");
await engine.connect();

const wa = new WhatsApp({ engine });
```

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
      await this.pool.query(
        "DELETE FROM whatsapp_store WHERE key = $1",
        [key]
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
       ORDER BY key
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
      this.store.delete(key);
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
session/{type}/index          # Session data
contact/{jid}/index           # Contact data
chat/{jid}/index              # Chat metadata
chat/{jid}/message/index      # Message index
chat/{jid}/message/{mid}/index    # Message metadata
chat/{jid}/message/{mid}/content  # Binary content
```

### JID normalization

JIDs contain `@` which may be problematic for some storage systems. FileEngine replaces `@` with `_at_`:

```typescript
// 5491112345678@s.whatsapp.net → 5491112345678_at_s.whatsapp.net
```

Your engine can handle JIDs as-is if your storage supports it.

### Binary content

Messages may have binary content (images, videos, audio). The `content` key stores raw binary encoded as base64 string.

### Atomicity

For production systems, consider implementing atomic operations, especially for `set()` which may be called multiple times during message processing.
