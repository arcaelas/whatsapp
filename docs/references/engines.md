# Engines

`@arcaelas/whatsapp` separates the WhatsApp client from the persistence layer. An **engine** is a
string-only key-value store implementing the `Engine` contract. The library ships four production
drivers (`SQLiteEngine`, `FileSystemEngine`, `RedisEngine`, `S3Engine`) and you can plug in your
own.

Serialization (Buffers, BigInts, etc.) lives in a dedicated layer (`serialize` / `deserialize`) on
top of baileys' `BufferJSON`, so engines never need to deal with JSON.

---

## Import

```typescript title="ESM / TypeScript"
import {
    type Engine,
    FileSystemEngine,
    SQLiteEngine,
    type SQLiteDatabase,
    RedisEngine,
    type RedisClient,
    S3Engine,
    serialize,
    deserialize,
} from '@arcaelas/whatsapp';
```

---

## The `Engine` contract

```typescript
interface Engine {
    get(path: string): Promise<string | null>;
    set(path: string, value: string, score?: number): Promise<void>;
    unset(path: string): Promise<boolean>;
    list(path: string, offset?: number, limit?: number): Promise<string[]>;
    count(path: string): Promise<number>;
    clear(): Promise<void>;

    // optional
    get_buffer?(path: string): Promise<Buffer | null>;
    set_buffer?(path: string, data: Buffer, score?: number): Promise<void>;
}
```

| Method                     | Description                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `get(path)`                | Reads a document. Returns `null` if the path does not exist.                                             |
| `set(path, value, score?)` | Writes a document. `score` fixes its position in `list`; without it, write time is used.                  |
| `unset(path)`              | Cascade-deletes the path and every descendant. Idempotent — safe to call on missing paths.               |
| `list(path, o, l)`         | Lists the **direct children**' values, ordered by **score DESC**, paginated by `offset` / `limit`.        |
| `count(path)`              | Counts direct children without loading their values.                                                     |
| `clear()`                  | Wipes the entire store.                                                                                  |
| `get_buffer(path)`         | *Optional.* Reads a raw binary.                                                                          |
| `set_buffer(path, data)`   | *Optional.* Writes a raw binary, skipping JSON and base64.                                               |

!!! info "`score` is what keeps chronology intact"
    Messages are written with their `created_at` as the score. Every reconnect re-delivers history,
    and a re-sync that rewrote old documents with the current clock would push ancient messages to
    the top of `list`. Passing the score keeps the timeline stable no matter how many times a
    document is rewritten.

!!! info "Path semantics"
    Paths are POSIX-like strings (`/chat/<jid>/message/<id>`). Drivers normalize redundant
    slashes (`//chat///abc` → `chat/abc`) and trim both ends. `unset` cascades the entire subtree in
    a single call.

### Optional binaries

Media payloads are binary. When a driver implements `set_buffer` / `get_buffer`, the bytes are
stored raw; otherwise the library falls back to a JSON document holding base64 (~33% bigger and it
has to be parsed to be read). A driver without these two methods is still perfectly valid.

| Driver             | Raw binaries                                                     |
| ------------------ | ------------------------------------------------------------------ |
| `SQLiteEngine`     | Yes — a `BLOB` column.                                            |
| `FileSystemEngine` | Yes — a `content.bin` file next to the document.                  |
| `RedisEngine`      | Yes, when the client exposes `getBuffer` / `setBuffer` (ioredis does). |
| `S3Engine`         | No — falls back to the base64 document.                           |

---

## `SQLiteEngine`

A single `(path, parent, score, value, binary)` table with a `(parent, score DESC)` index. It is the
most efficient built-in driver, because it delegates to the database what the others hand-roll:
`list` is an indexed `ORDER BY score DESC LIMIT/OFFSET`, `count` is a `COUNT(*)` and the cascading
`unset` is a single range statement.

```typescript title="Constructor"
new SQLiteEngine(db: SQLiteDatabase, table = 'documents')
```

| Parameter | Type             | Description                                                                       |
| --------- | ---------------- | ----------------------------------------------------------------------------------- |
| `db`      | `SQLiteDatabase` | An **already open** database. `better-sqlite3` and the native `node:sqlite` both fit. |
| `table`   | `string`         | Table holding the documents. Default `'documents'`.                                 |

```typescript title="node:sqlite (no dependencies)" hl_lines="4"
import { DatabaseSync } from 'node:sqlite';
import { WhatsApp, SQLiteEngine } from '@arcaelas/whatsapp';

const engine = new SQLiteEngine(new DatabaseSync('.sessions/5491112345678.db'));

const wa = new WhatsApp({ engine, phone: 5491112345678 });
```

```typescript title="better-sqlite3"
import Database from 'better-sqlite3';
import { SQLiteEngine } from '@arcaelas/whatsapp';

const engine = new SQLiteEngine(new Database('.sessions/5491112345678.db'));
```

The driver injects no dependency of its own: the database arrives already open, exactly like
`RedisEngine`'s client. It only needs `exec(sql)` and `prepare(sql)` with `run` / `get` / `all`
(the `SQLiteDatabase` interface). At construction it applies `journal_mode = WAL` and
`synchronous = NORMAL` when the driver accepts them, and creates the table and index if missing.

!!! tip "Measured against the filesystem driver"
    On a real 55,146-message chat: **220 MB → 64 MB** on disk, first `list` **115 ms → 0.6 ms**,
    and two inodes in total instead of one directory per document.

---

## `FileSystemEngine`

Persists each document at `<base>/<path>/index.json`. The directory layout lets a resource
coexist with nested sub-resources (a chat directory holds its own `index.json` and a `message/`
subtree). Writes are atomic (temp file + rename) and the ordering score travels in the file mtime.

```typescript title="Constructor"
new FileSystemEngine(base: string, cached = 12)
```

| Parameter | Type     | Description                                                                        |
| --------- | -------- | ------------------------------------------------------------------------------------ |
| `base`    | `string` | Absolute or relative directory used as the root of the data tree.                    |
| `cached`  | `number` | Directories indexed in memory at the same time (LRU). Default `12`.                  |

```typescript title="Usage" hl_lines="4"
import { join } from 'node:path';
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

const engine = new FileSystemEngine(join(process.cwd(), 'data', 'wa'));

const wa = new WhatsApp({ engine });
await wa.connect((qr) => console.log('QR ready', (qr as Buffer).length, 'bytes'));
```

To keep `list` / `count` at O(limit), the driver maintains a per-directory sorted index, bounded by
LRU and backed by a `.order` file: opening a directory loads that file and only rebuilds it with
`readdir` + `stat` when the count does not match. Binaries live next to the document as
`content.bin`.

!!! warning "One writer per base directory"
    The in-memory index assumes a single writer process. Two processes writing the same base
    directory will desynchronize their `.order` files.

!!! tip "When to choose the filesystem driver"
    Local development and inspectable state: every document is a readable JSON file. For volume,
    `SQLiteEngine` is strictly better — one chat of 100k messages is 100k directories here.

---

## `RedisEngine`

Persists documents as Redis strings and uses one sorted set per parent for ordered listings.

| Keyspace                     | Type        | Purpose                                                       |
| ---------------------------- | ----------- | --------------------------------------------------------------- |
| `<prefix>:doc:<path>`        | `string`    | The serialized document body.                                  |
| `<prefix>:doc:<path>:bin`    | `string`    | The raw binary, when the client supports buffers.               |
| `<prefix>:idx:<parent>`      | `zset`      | Score = the `score` passed to `set`, member = full child path.  |

`list()` is `ZREVRANGE` + `MGET`; `count()` is `ZCARD` (O(1)); `unset()` cascades via `SCAN` + `DEL`.
Writes group document and index in a pipeline when the client exposes one, so a crash between both
operations cannot orphan a document from its index.

```typescript title="Constructor"
new RedisEngine(client: RedisClient, prefix = 'wa:default')
```

| Parameter | Type          | Description                                                                        |
| --------- | ------------- | ------------------------------------------------------------------------------------ |
| `client`  | `RedisClient` | An ioredis-compatible client. See the interface below.                               |
| `prefix`  | `string`      | Key prefix; use one prefix per WhatsApp account to avoid collisions.                 |

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

    // optional — enable extra behaviour when present
    getBuffer?(key: string): Promise<Buffer | null>;
    setBuffer?(key: string, value: Buffer): Promise<unknown>;
    pipeline?(): {
        set(key: string, value: string): unknown;
        del(keys: string | string[]): unknown;
        zadd(key: string, score: number, member: string): unknown;
        zrem(key: string, members: string | string[]): unknown;
        exec(): Promise<unknown>;
    };
}
```

Any client matching this surface works at runtime — `ioredis` and most drop-in replacements do.

!!! note "Why some members are variadic"
    `del`, `zrem`, `scan` and the buffer members are declared variadic on purpose: `ioredis`
    exposes them with callback overloads that a fixed signature would reject under
    `strictFunctionTypes`. Declaring them this way lets you pass an `ioredis` instance straight
    into the engine, with no cast.

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

## `S3Engine`

Persists each document as an object in an AWS S3 bucket, with an **optional in-memory cache** for
stable, read-heavy paths. Requires the optional peer dependency `@aws-sdk/client-s3`; you pass an
already-configured `S3Client`.

```typescript title="Constructor"
new S3Engine({
    s3: S3Client,
    bucket: string,
    basedir: string,
    cache?: false | { ttl: number; when(key: string): boolean },
    cached?: number,
})
```

| Option    | Type                          | Default | Description                                                              |
| --------- | ----------------------------- | ------- | -------------------------------------------------------------------------- |
| `s3`      | `S3Client`                    | —       | A pre-configured `@aws-sdk/client-s3` client (region, credentials, …).     |
| `bucket`  | `string`                      | —       | Target bucket name.                                                        |
| `basedir` | `string`                      | —       | Base key prefix inside the bucket; use one per WhatsApp account.           |
| `cache`   | `false \| { ttl, when }`      | `false` | Local cache configuration. `false` disables it (every read hits S3).       |
| `cached`  | `number`                      | `12`    | Prefixes indexed in memory at the same time (LRU).                         |

Since `LastModified` is read-only, S3 cannot represent the explicit score: the driver keeps a sorted
index per prefix, backed by an `.order` object, so chronological order survives re-syncs exactly as
in the other drivers. When `.order` is missing, the index is rebuilt by listing the prefix once and
ordering by `LastModified`. Keys mangle `@` into `_at_`.

### Local cache

When `cache` is provided, `when(key)` decides which paths are cached — return `true` for stable,
frequently-read documents (chats, contacts, the LID→JID map) and `false` for volatile ones (Signal
sessions, messages). Each cached entry is evicted by a `setTimeout(ttl)`; there is **no expiry check
on read** — the timer simply removes the entry. Writes are write-through (cache + S3), and `unset`
purges the cached subtree so deleted data is never served stale.

```typescript title="Usage with cache" hl_lines="8 9 10 11 12 13 14"
import { S3Client } from '@aws-sdk/client-s3';
import { WhatsApp, S3Engine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new S3Engine({
        s3: new S3Client({ region: 'us-east-1' }),
        bucket: 'my-wa-bucket',
        basedir: 'wa/5491112345678',
        cache: {
            ttl: 180_000, // 3 minutes
            when: (key) =>
                key.startsWith('/chat/') ||
                key.startsWith('/contact/') ||
                key.startsWith('/lid/'),
        },
    }),
    phone: 5491112345678,
});

await wa.connect((pin) => console.log('PIN:', pin));
```

The driver also exposes `delete_prefix(prefix)`, which removes every object under a prefix and
returns how many were deleted — handy for maintenance scripts.

!!! tip "When to choose S3"
    Serverless / stateless deployments (Lambda, Fargate) where neither the filesystem nor Redis is
    available. Keep in mind that media is stored as base64 documents here, since the driver
    implements no raw binary methods.

---

## Serialization helpers

```typescript
function serialize<T>(doc: T): string;
function deserialize<T>(raw: string | null): T | null;
```

Both helpers are thin wrappers over `JSON.stringify` / `JSON.parse` using baileys' `BufferJSON`
replacer/reviver, so `Buffer` instances inside Signal keys, message media references and poll
payloads round-trip without loss. `deserialize` returns `null` when the input is `null` **or when
the JSON is invalid**, so a document truncated by an interrupted write behaves as missing instead
of poisoning a whole page with a parse error.

```typescript title="Custom storage on top of an engine"
import { serialize, deserialize } from '@arcaelas/whatsapp';

interface BotConfig { greeting: string; quiet_hours: [number, number] }

await wa.engine.set('/app/config', serialize<BotConfig>({
    greeting: 'Hello!',
    quiet_hours: [22, 8],
}));

const config = deserialize<BotConfig>(await wa.engine.get('/app/config'));
```

---

## Custom engines

Implementing the `Engine` interface is enough to plug any backend (PostgreSQL, DynamoDB, an
in-memory map for tests, …). Honor these invariants and the rest of the library behaves correctly:

1. `set` stores the value verbatim and remembers `score` (or the write time when it is absent).
2. `list` returns **direct children only**, ordered by score DESC.
3. `unset` cascades the subtree and is idempotent.
4. `clear` wipes everything the engine owns.
5. `get_buffer` / `set_buffer` are all-or-nothing: implement both or neither.

```typescript title="Skeleton for a custom engine" hl_lines="3"
import type { Engine } from '@arcaelas/whatsapp';

export class PostgresEngine implements Engine {
    async get(path: string): Promise<string | null> {
        // SELECT value FROM docs WHERE path = $1
        return null;
    }

    async set(path: string, value: string, score?: number): Promise<void> {
        // INSERT INTO docs(path, parent, score, value) VALUES ($1, $2, $3, $4)
        // ON CONFLICT (path) DO UPDATE SET value = EXCLUDED.value, score = EXCLUDED.score
    }

    async unset(path: string): Promise<boolean> {
        // DELETE FROM docs WHERE path = $1 OR path LIKE $1 || '/%'
        return true;
    }

    async list(path: string, offset = 0, limit = 50): Promise<string[]> {
        // SELECT value FROM docs WHERE parent = $1 ORDER BY score DESC LIMIT $2 OFFSET $3
        return [];
    }

    async count(path: string): Promise<number> {
        // SELECT COUNT(*) FROM docs WHERE parent = $1
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

!!! danger "One engine per account"
    Never share an engine instance between two `WhatsApp` clients: their documents live under the
    same paths and would collide. Give each account its own base directory, prefix, bucket path or
    database file.
