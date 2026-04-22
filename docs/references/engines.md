# Engines

`@arcaelas/whatsapp` v3 separates the WhatsApp client from the persistence layer. An **engine**
is a string-only key-value store implementing the `Engine` contract. The library ships two
production drivers (`FileSystemEngine`, `RedisEngine`) and you can plug in your own.

Serialization (Buffers, BigInts, etc.) lives in a dedicated layer (`serialize` / `deserialize`)
on top of baileys' `BufferJSON`, so engines never need to deal with JSON.

---

## Import

```typescript title="ESM / TypeScript"
import {
    type Engine,
    FileSystemEngine,
    RedisEngine,
    type RedisClient,
    serialize,
    deserialize,
} from '@arcaelas/whatsapp';
```

---

## The `Engine` contract

```typescript
interface Engine {
    get(path: string): Promise<string | null>;
    set(path: string, value: string): Promise<void>;
    unset(path: string): Promise<boolean>;
    list(path: string, offset?: number, limit?: number): Promise<string[]>;
    count(path: string): Promise<number>;
    clear(): Promise<void>;
}
```

| Method              | Description                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `get(path)`         | Reads a document. Returns `null` if the path does not exist.                                       |
| `set(path, value)`  | Writes a document and refreshes its mtime (which drives `list` ordering).                          |
| `unset(path)`       | Cascade-deletes the path and every descendant. Idempotent — safe to call on missing paths.         |
| `list(path, o, l)`  | Lists the **direct children**' values, ordered by mtime DESC, paginated by `offset` / `limit`.    |
| `count(path)`       | Counts direct children without loading their values.                                               |
| `clear()`           | Wipes the entire store.                                                                            |

!!! info "Path semantics"
    Paths are POSIX-like strings (`/chat/<jid>/message/<id>`). Drivers normalize redundant
    slashes (`//chat///abc` → `chat/abc`). `set` always refreshes the mtime, which is what makes
    "most recent first" listings cheap. `unset` cascades the entire subtree in a single call.

---

## `FileSystemEngine`

Persists each document at `<base>/<path>/index.json`. The directory layout lets a resource
coexist with nested sub-resources (a chat directory can hold both its own `index.json` and a
`message/` subtree).

```typescript title="Constructor"
new FileSystemEngine(basePath: string)
```

| Parameter  | Type     | Description                                                       |
| ---------- | -------- | ----------------------------------------------------------------- |
| `basePath` | `string` | Absolute or relative directory used as the root of the data tree. |

```typescript title="Usage" hl_lines="4 6 7"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';
import { join } from 'node:path';

const engine = new FileSystemEngine(join(process.cwd(), 'data', 'wa'));

const wa = new WhatsApp({ engine });
await wa.connect((qr) => console.log('QR ready', qr.length, 'bytes'));
```

!!! tip "When to choose the filesystem driver"
    Local development, single-process bots, or embedded deployments. Persistence is durable,
    inspectable from the shell, and requires zero infrastructure.

---

## `RedisEngine`

Persists documents as Redis strings and uses one sorted set per parent for ordered listings.

| Keyspace                     | Type        | Purpose                                                  |
| ---------------------------- | ----------- | -------------------------------------------------------- |
| `<prefix>:doc:<path>`        | `string`    | The serialized document body.                            |
| `<prefix>:idx:<parent>`      | `zset`      | Score = mtime, member = full child path.                 |

`list()` is implemented as `ZREVRANGE` + `MGET` in a single round-trip; `count()` is `ZCARD`
(O(1)); `unset()` cascades via `SCAN` + `DEL` over `*:doc:<path>/*` and `*:idx:<path>*`.

```typescript title="Constructor"
new RedisEngine(client: RedisClient, prefix?: string)
```

| Parameter | Type          | Default        | Description                                                                 |
| --------- | ------------- | -------------- | --------------------------------------------------------------------------- |
| `client`  | `RedisClient` | —              | An ioredis-compatible client. See the interface below for required methods. |
| `prefix`  | `string`      | `'wa:default'` | Key prefix; use one prefix per WhatsApp account to avoid collisions.        |

### `RedisClient` interface

```typescript
interface RedisClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
    del(keys: string | string[]): Promise<unknown>;
    mget(keys: string[]): Promise<(string | null)[]>;
    scan(cursor: number | string, ...args: unknown[]): Promise<[string, string[]]>;
    zadd(key: string, score: number, member: string): Promise<unknown>;
    zrem(key: string, members: string | string[]): Promise<unknown>;
    zrevrange(key: string, start: number, stop: number): Promise<string[]>;
    zcard(key: string): Promise<number>;
}
```

Any client matching this surface works — `ioredis` and most drop-in replacements do.

```typescript title="Usage with ioredis" hl_lines="5 6 7"
import IORedis from 'ioredis';
import { WhatsApp, RedisEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new RedisEngine(
        new IORedis({ host: '127.0.0.1', port: 6379 }),
        'wa:5491112345678',
    ),
    phone: 5491112345678,
});

await wa.connect((pin) => console.log('PIN:', pin));
```

!!! tip "When to choose Redis"
    Multi-process / horizontal deployments, ephemeral containers where the filesystem is not
    persisted, or any setup where you already operate Redis.

---

## Serialization helpers

```typescript
function serialize<T>(doc: T): string;
function deserialize<T>(raw: string | null): T | null;
```

Both helpers are thin wrappers over `JSON.stringify` / `JSON.parse` using baileys' `BufferJSON`
replacer/reviver, so `Buffer` instances inside Signal keys, message media references, and
poll payloads round-trip without loss. `deserialize(null)` returns `null`, which makes it safe
to chain after `engine.get()`.

```typescript title="Custom storage on top of an engine"
import { serialize, deserialize } from '@arcaelas/whatsapp';

interface BotConfig { greeting: string; quietHours: [number, number]; }

await wa.engine.set('/app/config', serialize<BotConfig>({
    greeting: 'Hello!',
    quietHours: [22, 8],
}));

const config = deserialize<BotConfig>(await wa.engine.get('/app/config'));
```

---

## Custom engines

Implementing the `Engine` interface is enough to plug any backend (PostgreSQL, S3, SQLite,
DynamoDB, …). Honor the four invariants and the rest of the library will behave correctly:

1. `set` updates the mtime that drives `list` ordering.
2. `list` returns **direct children only**, ordered by mtime DESC.
3. `unset` cascades the subtree.
4. `clear` wipes everything the engine owns.

```typescript title="Skeleton for a custom engine" hl_lines="3"
import type { Engine } from '@arcaelas/whatsapp';

export class SqliteEngine implements Engine {
    async get(path: string): Promise<string | null> {
        // SELECT value FROM docs WHERE path = ?
        return null;
    }

    async set(path: string, value: string): Promise<void> {
        // INSERT OR REPLACE INTO docs(path, value, mtime) VALUES(?, ?, ?)
    }

    async unset(path: string): Promise<boolean> {
        // DELETE FROM docs WHERE path = ? OR path LIKE ? || '/%'
        return true;
    }

    async list(path: string, offset = 0, limit = 50): Promise<string[]> {
        // SELECT value FROM docs
        // WHERE parent = ? ORDER BY mtime DESC LIMIT ? OFFSET ?
        return [];
    }

    async count(path: string): Promise<number> {
        // SELECT COUNT(*) FROM docs WHERE parent = ?
        return 0;
    }

    async clear(): Promise<void> {
        // DELETE FROM docs
    }
}
```

!!! warning "String-only contract"
    Engines must not parse or transform values. Always store the exact string handed to `set`
    and return it verbatim from `get` / `list`. Serialization is a higher-level concern.
