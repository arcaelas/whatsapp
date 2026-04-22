# Custom Engine

The `Engine` interface is the storage contract behind `@arcaelas/whatsapp`. The library ships with `FileSystemEngine` and `RedisEngine`, but nothing stops you from writing your own — useful for testing, debugging, or integrating with an existing datastore.

This guide walks through two custom implementations:

1. **`InMemoryEngine`** — a learning-grade engine backed by a `Map`.
2. **`LoggingEngine`** — a pass-through wrapper that logs every call (great for debugging).

---

## The Engine interface

```typescript
export interface Engine {
    get(path: string): Promise<string | null>;
    set(path: string, value: string): Promise<void>;
    unset(path: string): Promise<boolean>;
    list(path: string, offset?: number, limit?: number): Promise<string[]>;
    count(path: string): Promise<number>;
    clear(): Promise<void>;
}
```

Six methods, all path-based, all string in / string out. The library handles JSON serialization above the engine — your job is purely key-value persistence.

Rules to honor:

- **`set`** must refresh the modification time of the key — `list` orders by mtime DESC.
- **`unset`** must cascade: removing `/chat/123` also removes `/chat/123/message/...`.
- **`list`** returns only the **direct** children of a path, paginated, mtime DESC.
- **`count`** must work without loading the values (use a counter or index).

---

## 1. `InMemoryEngine`

A volatile, single-process engine backed by two `Map`s — one for values, one for timestamps. Everything is lost when the process exits.

```typescript title="in-memory-engine.ts"
import type { Engine } from '@arcaelas/whatsapp';

function normalize(path: string): string {
    return path.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export class InMemoryEngine implements Engine {
    private readonly _values = new Map<string, string>();
    private readonly _mtimes = new Map<string, number>();

    async get(path: string): Promise<string | null> {
        return this._values.get(normalize(path)) ?? null;
    }

    async set(path: string, value: string): Promise<void> {
        const key = normalize(path);
        this._values.set(key, value);
        this._mtimes.set(key, Date.now());
    }

    async unset(path: string): Promise<boolean> {
        const key = normalize(path);
        const prefix = `${key}/`;

        this._values.delete(key);
        this._mtimes.delete(key);

        for (const k of [...this._values.keys()]) {
            if (k.startsWith(prefix)) {
                this._values.delete(k);
                this._mtimes.delete(k);
            }
        }
        return true;
    }

    async list(path: string, offset = 0, limit = 50): Promise<string[]> {
        const key = normalize(path);
        const prefix = key === '' ? '' : `${key}/`;

        const children: { full: string; mtime: number }[] = [];
        const seen = new Set<string>();

        for (const k of this._values.keys()) {
            if (!k.startsWith(prefix) || k === key) {
                continue;
            }
            const tail = k.slice(prefix.length);
            const slash = tail.indexOf('/');
            const direct = slash === -1 ? k : `${prefix}${tail.slice(0, slash)}`;

            if (seen.has(direct) || !this._values.has(direct)) {
                continue;
            }
            seen.add(direct);
            children.push({ full: direct, mtime: this._mtimes.get(direct) ?? 0 });
        }

        children.sort((a, b) => b.mtime - a.mtime);
        return children
            .slice(offset, offset + limit)
            .map((c) => this._values.get(c.full) ?? '');
    }

    async count(path: string): Promise<number> {
        const key = normalize(path);
        const prefix = key === '' ? '' : `${key}/`;
        const seen = new Set<string>();

        for (const k of this._values.keys()) {
            if (!k.startsWith(prefix) || k === key) {
                continue;
            }
            const tail = k.slice(prefix.length);
            const slash = tail.indexOf('/');
            const direct = slash === -1 ? k : `${prefix}${tail.slice(0, slash)}`;
            if (this._values.has(direct)) {
                seen.add(direct);
            }
        }
        return seen.size;
    }

    async clear(): Promise<void> {
        this._values.clear();
        this._mtimes.clear();
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
    `InMemoryEngine` loses every byte when the process exits. That includes your session credentials — every restart will require a fresh QR/PIN pairing. Use `FileSystemEngine` for local development and `RedisEngine` for distributed deployments.

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

    async set(path: string, value: string): Promise<void> {
        this._log('set', path, `${value.length}b`);
        await this._inner.set(path, value);
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
[fs] set /chat/584144709840@s.whatsapp.net 73b
[fs] list /chat offset=0 limit=50 -> 12 items
[fs] count /chat/584144709840@s.whatsapp.net/message -> 47
```

!!! tip "Composition is free"
    The wrapper pattern composes — wrap a `RedisEngine` to log Redis traffic, wrap an `InMemoryEngine` for a chatty unit test, or even chain wrappers (e.g. metrics + logging). Because the contract is just six methods, decorators stay trivial.

---

## Next steps

- [Basic bot](./basic-bot.md) — the smallest possible bot.
- [Command bot](./command-bot.md) — dispatch table for textual commands.
