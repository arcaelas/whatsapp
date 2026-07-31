# Custom Engine

The `Engine` interface is the storage contract behind `@arcaelas/whatsapp`. The library ships with `SQLiteEngine`, `FileSystemEngine`, `RedisEngine` and `S3Engine`, but nothing stops you from writing your own — useful for testing, debugging, or integrating with an existing datastore.

This guide walks through two custom implementations:

1. **`InMemoryEngine`** — a learning-grade engine backed by a `Map`.
2. **`LoggingEngine`** — a pass-through wrapper that logs every call (great for debugging).

---

## The Engine interface

```typescript
export interface Engine {
    get(path: string): Promise<string | null>;
    set(path: string, value: string, score?: number): Promise<void>;
    unset(path: string): Promise<boolean>;
    list(path: string, offset?: number, limit?: number): Promise<string[]>;
    count(path: string): Promise<number>;
    clear(): Promise<void>;

    // optional pair, for raw binaries
    get_buffer?(path: string): Promise<Buffer | null>;
    set_buffer?(path: string, data: Buffer, score?: number): Promise<void>;
}
```

Six required methods, all path-based, all string in / string out. The library handles JSON serialization above the engine — your job is purely key-value persistence.

Rules to honor:

- **`set`** must remember the ordering score: the explicit `score` when it arrives, the write time otherwise.
- **`unset`** must cascade: removing `/chat/123` also removes `/chat/123/message/...`.
- **`list`** returns only the **direct** children of a path, paginated, score DESC.
- **`count`** must work without loading the values.
- **`get_buffer` / `set_buffer`** are optional, but all-or-nothing: implement both or neither. When they are missing, the library stores media as a base64 JSON document instead.

---

## 1. `InMemoryEngine`

A volatile, single-process engine backed by two `Map`s — one for documents, one for binaries. Everything is lost when the process exits.

```typescript title="in-memory-engine.ts"
import type { Engine } from '@arcaelas/whatsapp';

function normalize(path: string): string {
    return path.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export class InMemoryEngine implements Engine {
    private readonly _docs = new Map<string, { value: string; score: number }>();
    private readonly _bins = new Map<string, Buffer>();

    async get(path: string): Promise<string | null> {
        return this._docs.get(normalize(path))?.value ?? null;
    }

    async set(path: string, value: string, score?: number): Promise<void> {
        this._docs.set(normalize(path), { value, score: score ?? Date.now() });
    }

    async unset(path: string): Promise<boolean> {
        const key = normalize(path);
        const prefix = `${key}/`;

        for (const stored of [...this._docs.keys()]) {
            if (stored === key || stored.startsWith(prefix)) {
                this._docs.delete(stored);
                this._bins.delete(stored);
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

    /** Direct children of a path, with their ordering score. */
    private _children(path: string): { value: string; score: number }[] {
        const key = normalize(path);
        const prefix = key === '' ? '' : `${key}/`;
        const out: { value: string; score: number }[] = [];

        for (const [stored, entry] of this._docs) {
            if (stored.startsWith(prefix)) {
                const tail = stored.slice(prefix.length);
                if (tail.length > 0 && !tail.includes('/')) {
                    out.push(entry);
                }
            }
        }
        return out;
    }
}
```

Use it like any built-in engine:

```typescript title="index.ts"
import { WhatsApp } from '@arcaelas/whatsapp';
import { InMemoryEngine } from './in-memory-engine';

const wa = new WhatsApp({
    engine: new InMemoryEngine(),
    phone: 584144709840,
});

wa.connect((auth) => {
    console.log(typeof auth === 'string' ? `pin: ${auth}` : 'scan the QR');
});
```

!!! warning "Not for production"
    `InMemoryEngine` loses every byte when the process exits. That includes your session credentials — every restart will require a fresh QR/PIN pairing. Use `SQLiteEngine` or `FileSystemEngine` for local development and `RedisEngine` for distributed deployments.

!!! note "Use cases"
    Where it *does* shine: unit tests, ephemeral one-shot scripts, exploring the API without polluting the disk, and CI pipelines that mock out persistence.

---

## 2. `LoggingEngine` — a pass-through wrapper

Wrapping another engine to observe every call is one of the most useful debugging tools you can build. The pattern is mechanical: implement `Engine`, hold an inner engine, log around each call, then delegate.

```typescript title="logging-engine.ts"
import type { Engine } from '@arcaelas/whatsapp';

export class LoggingEngine implements Engine {
    constructor(
        private readonly _inner: Engine,
        private readonly _label = 'engine',
    ) { }

    private _log(op: string, path: string, extra?: string): void {
        const tag = `[${this._label}]`;
        console.log(extra ? `${tag} ${op} ${path} ${extra}` : `${tag} ${op} ${path}`);
    }

    async get(path: string): Promise<string | null> {
        const value = await this._inner.get(path);
        this._log('get', path, value === null ? 'MISS' : `HIT (${value.length}b)`);
        return value;
    }

    async set(path: string, value: string, score?: number): Promise<void> {
        this._log('set', path, `${value.length}b score=${score ?? 'now'}`);
        await this._inner.set(path, value, score);
    }

    async unset(path: string): Promise<boolean> {
        this._log('unset', path);
        return this._inner.unset(path);
    }

    async list(path: string, offset = 0, limit = 50): Promise<string[]> {
        const values = await this._inner.list(path, offset, limit);
        this._log('list', path, `offset=${offset} limit=${limit} -> ${values.length} items`);
        return values;
    }

    async count(path: string): Promise<number> {
        const total = await this._inner.count(path);
        this._log('count', path, `-> ${total}`);
        return total;
    }

    async get_buffer(path: string): Promise<Buffer | null> {
        const data = this._inner.get_buffer
            ? await this._inner.get_buffer(path)
            : null;
        this._log('get_buffer', path, data ? `${data.length}b` : 'MISS');
        return data;
    }

    async set_buffer(path: string, data: Buffer, score?: number): Promise<void> {
        this._log('set_buffer', path, `${data.length}b`);
        if (this._inner.set_buffer) {
            await this._inner.set_buffer(path, data, score);
        } else {
            await this._inner.set(path, JSON.stringify({ data: data.toString('base64') }), score);
        }
    }

    async clear(): Promise<void> {
        this._log('clear', '*');
        await this._inner.clear();
    }
}
```

Wire it around any other engine — the bot doesn't know the difference:

```typescript title="index.ts"
import { join } from 'node:path';
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';
import { LoggingEngine } from './logging-engine';

const wa = new WhatsApp({
    engine: new LoggingEngine(
        new FileSystemEngine(join(__dirname, 'session')),
        'fs',
    ),
    phone: 584144709840,
});
```

Now every read/write goes through the console:

```text
[fs] get /session/creds HIT (1842b)
[fs] set /chat/584144709840@s.whatsapp.net 73b score=now
[fs] set /chat/584144709840@s.whatsapp.net/message/ABC 4211b score=1767371367857
[fs] set_buffer /chat/584144709840@s.whatsapp.net/message/ABC/content 51204b
[fs] list /chat offset=0 limit=50 -> 12 items
[fs] count /chat/584144709840@s.whatsapp.net/message -> 47
```

!!! danger "Binary methods are a signal, not just a passthrough"
    The library decides how to store media by checking whether `set_buffer` **exists** on the engine.
    A wrapper that declares it and forwards to an inner engine without binary support (like
    `S3Engine`) would silently drop the payload — hence the base64 fallback above.

!!! tip "Composition is free"
    The wrapper pattern composes — wrap a `RedisEngine` to log Redis traffic, wrap an `InMemoryEngine` for a chatty unit test, or even chain wrappers (e.g. metrics + logging). Because the contract is small, decorators stay trivial.

---

## Next steps

- [Basic bot](./basic-bot.md) — the smallest possible bot.
- [Command bot](./command-bot.md) — dispatch table for textual commands.
