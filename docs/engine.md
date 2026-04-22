# Engine

The persistence layer of `@arcaelas/whatsapp` v3.

---

## Philosophy

`Engine` is a **string-only key/value contract**. It knows nothing about
WhatsApp, JSON, or Buffers — it just stores and retrieves opaque strings under
hierarchical paths.

| Concern             | Lives in                                                  |
| ------------------- | --------------------------------------------------------- |
| Wire protocol       | `baileys`                                                 |
| Domain shapes       | `IChatRaw`, `IContactRaw`, `IMessage`                     |
| Serialization       | `serialize` / `deserialize` (BufferJSON, in `~/lib/store`) |
| Persistence         | **`Engine` implementations**                              |

This separation means an engine implementation can be backed by anything that
can `get`/`set`/`unset`/`list`/`count`/`clear` strings under a path: a file
tree, Redis, SQLite, DynamoDB, an in-memory map for tests, etc.

---

## Interface

```ts
import type { Engine } from '@arcaelas/whatsapp';

interface Engine {
    /** Read a value by path. Returns null if missing. */
    get(path: string): Promise<string | null>;

    /** Write a value. MUST refresh the mtime used by `list`. */
    set(path: string, value: string): Promise<void>;

    /**
     * Delete the value AND every descendant under `path`.
     * MUST be idempotent — never throw when `path` does not exist.
     */
    unset(path: string): Promise<boolean>;

    /**
     * List values of the **direct children** of `path`,
     * paginated and ordered by mtime DESC.
     */
    list(path: string, offset?: number, limit?: number): Promise<string[]>;

    /** Count direct children of `path` without loading their values. */
    count(path: string): Promise<number>;

    /** Drop everything in this engine's namespace. */
    clear(): Promise<void>;
}
```

### Per-method semantics

| Method   | Contract                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| `get`    | Returns the exact string previously written by `set`, or `null` if the path was never written / was unset.  |
| `set`    | Overwrites any prior value. Refreshes the path's mtime so subsequent `list` calls reorder correctly.        |
| `unset`  | Cascades — removes the path **and all sub-paths**. Idempotent: returns `true` even when nothing existed.    |
| `list`   | Returns the **values** (not the keys) of direct children, sorted by mtime DESC, sliced by `offset`/`limit`. Defaults: `offset=0`, `limit=50`. |
| `count`  | Returns the number of direct children. Should be O(1) where the backend allows (`ZCARD` in Redis).          |
| `clear`  | Wipes the engine's full keyspace. Used on `loggedOut` when `autoclean: true`.                               |

!!! info "Path normalization"
    Both built-in drivers collapse `//` and trim leading/trailing `/` before
    use. A custom engine should do the same so that `/chat/x`, `chat/x`, and
    `/chat//x/` all resolve to the same key.

!!! warning "`list` returns values, not keys"
    Unlike many key/value APIs, `Engine.list` returns the **document
    contents**. This lets the orchestrator do paginated reads in a single
    round-trip (`ZREVRANGE` + `MGET` on Redis, `readdir` + parallel `readFile`
    on disk).

---

## Built-in implementations

### `RedisEngine`

```ts
import IORedis from 'ioredis';
import { RedisEngine, WhatsApp } from '@arcaelas/whatsapp';

const redis = new IORedis(process.env.REDIS_URL!);
const engine = new RedisEngine(redis, 'wa:584144709840');

const wa = new WhatsApp({ engine, phone: 584144709840 });
```

Keyspaces:

```
<prefix>:doc:<path>           # the document
<prefix>:idx:<parent_path>    # sorted set: score=mtime, member=full child path
```

Highlights:

- `list` is one `ZREVRANGE` + one `MGET` — no per-document round-trip.
- `count` is `ZCARD` (O(1)).
- `unset` cascades by `SCAN`/`DEL` over `doc:<path>/*` and `idx:<path>(/*)`.
- `clear` wipes everything matching `<prefix>:*`.

The minimal client interface (`RedisClient`) only requires the commands the
engine actually uses, so it works with `ioredis`, `node-redis` (with thin
adapters), or any compatible driver.

---

### `FileSystemEngine`

```ts
import { FileSystemEngine, WhatsApp } from '@arcaelas/whatsapp';
import { join } from 'node:path';

const engine = new FileSystemEngine(join(process.cwd(), '.baileys'));

const wa = new WhatsApp({ engine, phone: 584144709840 });
```

Layout on disk:

```
<base>/<path>/index.json
```

Each document lives under its own directory so it can coexist with nested
sub-resources (e.g. a chat directory contains both `index.json` and a
`message/` directory).

Highlights:

- `set` does `mkdir -p` then `writeFile`.
- `list` reads `mtimeMs` for each child's `index.json` and sorts DESC.
- `unset` is `rm -rf` on the path's directory. Idempotent.
- `clear` is `rm -rf` on the whole base directory.

---

## Implementing a custom engine

Two ready-to-tweak stubs follow. Both honour the full contract; only `set`
needs to refresh the per-path mtime so `list` orders correctly.

### In-memory engine (tests, fixtures)

```ts
import type { Engine } from '@arcaelas/whatsapp';

function normalize(path: string): string {
    return path.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export class MemoryEngine implements Engine {
    private readonly _docs = new Map<string, { value: string; mtime: number }>();

    async get(path: string): Promise<string | null> {
        return this._docs.get(normalize(path))?.value ?? null;
    }

    async set(path: string, value: string): Promise<void> {
        this._docs.set(normalize(path), { value, mtime: Date.now() });
    }

    async unset(path: string): Promise<boolean> {
        const root = normalize(path);
        const prefix = `${root}/`;
        for (const key of this._docs.keys()) {
            if (key === root || key.startsWith(prefix)) {
                this._docs.delete(key);
            }
        }
        return true;
    }

    async list(path: string, offset = 0, limit = 50): Promise<string[]> {
        const root = normalize(path);
        const prefix = root === '' ? '' : `${root}/`;
        const direct: Array<{ value: string; mtime: number }> = [];
        for (const [key, entry] of this._docs) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length);
            if (rest.length === 0 || rest.includes('/')) continue;
            direct.push(entry);
        }
        direct.sort((a, b) => b.mtime - a.mtime);
        return direct.slice(offset, offset + limit).map((e) => e.value);
    }

    async count(path: string): Promise<number> {
        const root = normalize(path);
        const prefix = root === '' ? '' : `${root}/`;
        let total = 0;
        for (const key of this._docs.keys()) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length);
            if (rest.length > 0 && !rest.includes('/')) total++;
        }
        return total;
    }

    async clear(): Promise<void> {
        this._docs.clear();
    }
}
```

### SQLite engine

A single-table schema is enough — keep `(mtime DESC)` and prefix-friendly
indexes on the path column.

```ts
import Database from 'better-sqlite3';
import type { Engine } from '@arcaelas/whatsapp';

function normalize(path: string): string {
    return path.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export class SqliteEngine implements Engine {
    private readonly _db: Database.Database;

    constructor(file: string) {
        this._db = new Database(file);
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS docs (
                path  TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                mtime INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_docs_mtime ON docs (mtime DESC);
            CREATE INDEX IF NOT EXISTS idx_docs_prefix ON docs (path COLLATE BINARY);
        `);
    }

    async get(path: string): Promise<string | null> {
        const row = this._db
            .prepare('SELECT value FROM docs WHERE path = ?')
            .get(normalize(path)) as { value: string } | undefined;
        return row?.value ?? null;
    }

    async set(path: string, value: string): Promise<void> {
        this._db
            .prepare(
                `INSERT INTO docs (path, value, mtime) VALUES (?, ?, ?)
                 ON CONFLICT(path) DO UPDATE SET value = excluded.value, mtime = excluded.mtime`
            )
            .run(normalize(path), value, Date.now());
    }

    async unset(path: string): Promise<boolean> {
        const root = normalize(path);
        this._db
            .prepare('DELETE FROM docs WHERE path = ? OR path LIKE ?')
            .run(root, `${root}/%`);
        return true;
    }

    async list(path: string, offset = 0, limit = 50): Promise<string[]> {
        const root = normalize(path);
        const prefix = root === '' ? '' : `${root}/`;
        const rows = this._db
            .prepare(
                `SELECT value, path FROM docs
                 WHERE path LIKE ?
                 ORDER BY mtime DESC`
            )
            .all(`${prefix}%`) as { value: string; path: string }[];
        const direct = rows.filter((r) => {
            const rest = r.path.slice(prefix.length);
            return rest.length > 0 && !rest.includes('/');
        });
        return direct.slice(offset, offset + limit).map((r) => r.value);
    }

    async count(path: string): Promise<number> {
        const root = normalize(path);
        const prefix = root === '' ? '' : `${root}/`;
        const rows = this._db
            .prepare('SELECT path FROM docs WHERE path LIKE ?')
            .all(`${prefix}%`) as { path: string }[];
        let total = 0;
        for (const r of rows) {
            const rest = r.path.slice(prefix.length);
            if (rest.length > 0 && !rest.includes('/')) total++;
        }
        return total;
    }

    async clear(): Promise<void> {
        this._db.prepare('DELETE FROM docs').run();
    }
}
```

!!! tip "Edge cases worth testing"
    - `unset` on a missing path returns `true` (idempotent).
    - `list` of a path with no children returns `[]`, never throws.
    - `set` of an existing path overwrites and bumps the mtime — old positions in `list` should disappear and the new value should appear at the top.
    - Path normalization: `chat/x`, `/chat/x`, and `/chat//x/` all hit the same record.

---

## Multi-account: one process, several engines

Each `WhatsApp` instance owns exactly one `Engine`. To run several accounts
concurrently in the same process, give each its own engine — possibly of
different types:

```ts
import IORedis from 'ioredis';
import { join } from 'node:path';
import {
    FileSystemEngine,
    RedisEngine,
    WhatsApp,
} from '@arcaelas/whatsapp';

const redis = new IORedis(process.env.REDIS_URL!);

// Account A — Redis-backed (hot, multi-instance friendly)
const wa_a = new WhatsApp({
    engine: new RedisEngine(redis, 'wa:584144709840'),
    phone: 584144709840,
});

// Account B — local filesystem (single-host bot, easy to inspect)
const wa_b = new WhatsApp({
    engine: new FileSystemEngine(join(process.cwd(), '.sessions/B')),
    phone: 584121234567,
});

await Promise.all([
    wa_a.connect((auth) => console.log('A:', auth)),
    wa_b.connect((auth) => console.log('B:', auth)),
]);
```

Two rules to remember:

1. **Never share an engine instance between two `WhatsApp` clients.** State
   would collide under the same paths. With Redis, give each account a unique
   `prefix`. With FileSystem, give each account a unique base directory.
2. The engine **must already be wired** when you construct `WhatsApp` — it is
   read by the constructor and used immediately on `connect()`.

---

## `autoclean` and `loggedOut`

When baileys reports `DisconnectReason.loggedOut`, the orchestrator decides
what to do with the engine **before** emitting `disconnected`, so listeners
always observe the final state:

| `autoclean` value          | Action on `loggedOut`                                         |
| -------------------------- | ------------------------------------------------------------- |
| `true` (default)           | `await engine.clear()` — the entire engine namespace is wiped. |
| `false`                    | `await engine.unset('/session/creds')` — credentials only; chats / contacts / messages are preserved. |

```ts
// Wipe everything when the user logs out from the phone
const wa1 = new WhatsApp({ engine, autoclean: true });

// Keep history; only force re-authentication on next connect
const wa2 = new WhatsApp({ engine, autoclean: false });
```

`disconnect({ destroy: true })` also calls `engine.clear()`, regardless of
`autoclean`, so a manual nuke is always one flag away:

```ts
await wa.disconnect({ destroy: true }); // same as engine.clear()
```

!!! note "Cleanup happens before the event"
    The orchestrator awaits the engine cleanup before emitting `disconnected`.
    Any handler attached via `wa.on('disconnected', ...)` is guaranteed to see
    the post-cleanup state of the store.
