# Engine

The persistence layer of `@arcaelas/whatsapp`.

---

## Philosophy

`Engine` is a **string-only key/value contract**. It knows nothing about WhatsApp, JSON or Buffers —
it just stores and retrieves opaque strings under hierarchical paths, in the order it is told to.

| Concern             | Lives in                                                   |
| ------------------- | ---------------------------------------------------------- |
| Wire protocol       | `baileys`                                                  |
| Domain shapes       | `Contact`, `Chat`, `Message`, `Feed`                       |
| Serialization       | `serialize` / `deserialize` (BufferJSON)                   |
| Persistence         | **`Engine` implementations**                               |

This separation means an engine can be backed by anything that can `get`/`set`/`unset`/`list`/
`count`/`clear` strings under a path: a SQLite file, a directory tree, Redis, S3, DynamoDB, an
in-memory map for tests, …

---

## Interface

```ts
interface Engine {
    /** Read a value by path. Returns null if missing. */
    get(path: string): Promise<string | null>;

    /**
     * Write a value. `score` drives `list` ordering (epoch ms of the document);
     * without it, write time is used.
     */
    set(path: string, value: string, score?: number): Promise<void>;

    /**
     * Delete the value AND every descendant under `path`.
     * MUST be idempotent — never throw when `path` does not exist.
     */
    unset(path: string): Promise<boolean>;

    /**
     * List values of the **direct children** of `path`,
     * paginated and ordered by score DESC.
     */
    list(path: string, offset?: number, limit?: number): Promise<string[]>;

    /** Count direct children of `path` without loading their values. */
    count(path: string): Promise<number>;

    /** Drop everything in this engine's namespace. */
    clear(): Promise<void>;

    /** Optional: read a raw binary. */
    get_buffer?(path: string): Promise<Buffer | null>;

    /** Optional: write a raw binary, skipping JSON and base64. */
    set_buffer?(path: string, data: Buffer, score?: number): Promise<void>;
}
```

### Per-method semantics

| Method       | Contract                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `get`        | Returns the exact string previously written by `set`, or `null` if the path was never written / was unset.                  |
| `set`        | Overwrites any prior value and records the ordering score (the explicit `score`, or the write time when it is absent).      |
| `unset`      | Cascades — removes the path **and all sub-paths**. Idempotent: returns `true` even when nothing existed.                    |
| `list`       | Returns the **values** (not the keys) of direct children, sorted by score DESC, sliced by `offset`/`limit`. Defaults: `0, 50`. |
| `count`      | Returns the number of direct children. Should be O(1) where the backend allows (`ZCARD` in Redis, `COUNT(*)` in SQLite).    |
| `clear`      | Wipes the engine's full keyspace. Used on `loggedOut` when `autoclean: true`, and by `disconnect({ destroy: true })`.       |
| `*_buffer`   | Optional pair. Implement **both or neither**: the library probes `set_buffer` to decide how to store media.                 |

!!! info "Why `score` exists"
    Messages are written with their `created_at`. Every reconnect re-delivers history; if a rewritten
    old document took the current clock as its position, ancient messages would jump to the top of
    `list`. The score keeps the timeline stable no matter how many times a document is rewritten.

!!! info "Path normalization"
    Every built-in driver collapses `//` and trims leading/trailing `/` before use. A custom engine
    should do the same so `/chat/x`, `chat/x` and `/chat//x/` all resolve to the same key.

!!! warning "`list` returns values, not keys"
    Unlike many key/value APIs, `Engine.list` returns the **document contents**. This lets the
    orchestrator do paginated reads in a single round-trip (`ZREVRANGE` + `MGET` on Redis, one
    indexed `SELECT` on SQLite).

---

## Built-in implementations

| Driver             | Best for                                          | Raw binaries |
| ------------------ | ------------------------------------------------- | ------------ |
| `SQLiteEngine`     | Anything with volume; the default choice.         | Yes (BLOB)   |
| `FileSystemEngine` | Local development, inspectable state.             | Yes (file)   |
| `RedisEngine`      | Multi-process / ephemeral containers.             | Yes (client-dependent) |
| `S3Engine`         | Serverless, stateless deployments.                | No (base64)  |

Constructors, keyspaces and options are documented in
[References / Engines](references/engines.md).

```ts
import { DatabaseSync } from 'node:sqlite';
import { SQLiteEngine, WhatsApp } from '@arcaelas/whatsapp';

const engine = new SQLiteEngine(new DatabaseSync('.sessions/5491112345678.db'));
const wa = new WhatsApp({ engine, phone: 5491112345678 });
```

---

## Implementing a custom engine

The stub below honours the whole contract, including the score. It is enough for tests and fixtures,
and it is the shape any real backend follows.

```ts title="memory-engine.ts"
import type { Engine } from '@arcaelas/whatsapp';

function normalize(path: string): string {
    return path.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export class MemoryEngine implements Engine {
    private readonly _docs = new Map<string, { value: string; score: number }>();
    private readonly _bins = new Map<string, Buffer>();

    async get(path: string): Promise<string | null> {
        return this._docs.get(normalize(path))?.value ?? null;
    }

    async set(path: string, value: string, score?: number): Promise<void> {
        this._docs.set(normalize(path), { value, score: score ?? Date.now() });
    }

    async unset(path: string): Promise<boolean> {
        const root = normalize(path);
        const prefix = `${root}/`;
        for (const key of [...this._docs.keys()]) {
            if (key === root || key.startsWith(prefix)) {
                this._docs.delete(key);
                this._bins.delete(key);
            }
        }
        return true;
    }

    async list(path: string, offset = 0, limit = 50): Promise<string[]> {
        return this._children(path)
            .sort((a, b) => b.score - a.score)
            .slice(offset, offset + limit)
            .map((entry) => entry.value);
    }

    async count(path: string): Promise<number> {
        return this._children(path).length;
    }

    async get_buffer(path: string): Promise<Buffer | null> {
        return this._bins.get(normalize(path)) ?? null;
    }

    async set_buffer(path: string, data: Buffer, score?: number): Promise<void> {
        const key = normalize(path);
        this._bins.set(key, data);
        if (!this._docs.has(key)) {
            this._docs.set(key, { value: '', score: score ?? Date.now() });
        }
    }

    async clear(): Promise<void> {
        this._docs.clear();
        this._bins.clear();
    }

    /** Direct children of a path, with their score. */
    private _children(path: string): { value: string; score: number }[] {
        const root = normalize(path);
        const prefix = root === '' ? '' : `${root}/`;
        const out: { value: string; score: number }[] = [];
        for (const [key, entry] of this._docs) {
            if (key.startsWith(prefix)) {
                const rest = key.slice(prefix.length);
                if (rest.length > 0 && !rest.includes('/')) {
                    out.push(entry);
                }
            }
        }
        return out;
    }
}
```

Use it like any built-in engine:

```ts title="index.ts"
import { WhatsApp } from '@arcaelas/whatsapp';
import { MemoryEngine } from './memory-engine';

const wa = new WhatsApp({ engine: new MemoryEngine(), phone: 5491112345678 });
```

!!! warning "Volatile means volatile"
    A memory engine loses the session credentials on exit, so every restart requires a fresh
    QR/PIN pairing. It shines in unit tests, one-shot scripts and CI pipelines — not in production.

!!! tip "Edge cases worth testing"
    - `unset` on a missing path returns `true` (idempotent).
    - `list` of a path with no children returns `[]`, never throws.
    - `set` with an explicit `score` places the document by that score, not by write time.
    - `set` of an existing path overwrites the value and updates its score.
    - Path normalization: `chat/x`, `/chat/x` and `/chat//x/` hit the same record.
    - `unset('/chat/x')` also drops `/chat/x/message/y` and its content.

### Wrapping an engine

Because the contract is small, a pass-through wrapper is a cheap way to add logging, metrics or
encryption. See [Examples / Custom Engine](examples/custom-engine.md) for a complete
`LoggingEngine`.

---

## Multi-account: one process, several engines

Each `WhatsApp` instance owns exactly one `Engine`. To run several accounts concurrently in the same
process, give each its own engine — possibly of different types:

```ts
import IORedis from 'ioredis';
import { DatabaseSync } from 'node:sqlite';
import { RedisEngine, SQLiteEngine, WhatsApp } from '@arcaelas/whatsapp';

const redis = new IORedis(process.env.REDIS_URL!);

// Account A — Redis-backed (hot, multi-instance friendly)
const wa_a = new WhatsApp({
    engine: new RedisEngine(redis, 'wa:5491112345678'),
    phone: 5491112345678,
});

// Account B — local SQLite file
const wa_b = new WhatsApp({
    engine: new SQLiteEngine(new DatabaseSync('.sessions/584121234567.db')),
    phone: 584121234567,
});

await Promise.all([
    wa_a.connect((auth) => console.log('A:', auth)),
    wa_b.connect((auth) => console.log('B:', auth)),
]);
```

Two rules to remember:

1. **Never share an engine instance between two `WhatsApp` clients.** State would collide under the
   same paths. With Redis, give each account a unique `prefix`; with the filesystem, a unique base
   directory; with SQLite, a unique file (or at least a unique table).
2. The engine **must already be wired** when you construct `WhatsApp` — it is read by the constructor
   and used immediately on `connect()`.

---

## `autoclean` and `loggedOut`

When baileys reports `DisconnectReason.loggedOut`, the orchestrator decides what to do with the
engine **before** emitting `disconnected`, so listeners always observe the final state:

| `autoclean` value | Action on `loggedOut`                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `true` (default)  | `await engine.clear()` — the entire engine namespace is wiped.                                        |
| `false`           | `await engine.unset('/session/creds')` — credentials only; chats / contacts / messages are preserved. |

```ts
// Wipe everything when the user logs out from the phone
const wa1 = new WhatsApp({ engine, autoclean: true });

// Keep history; only force re-authentication on next connect
const wa2 = new WhatsApp({ engine, autoclean: false });
```

`disconnect({ destroy: true })` also calls `engine.clear()`, regardless of `autoclean`, so a manual
nuke is always one flag away:

```ts
await wa.disconnect({ destroy: true }); // same as engine.clear()
```

!!! note "Cleanup happens before the event"
    The orchestrator awaits the engine cleanup before emitting `disconnected`. Any handler attached
    via `wa.on('disconnected', …)` is guaranteed to see the post-cleanup state of the store.
