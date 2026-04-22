# Custom Engine

La interfaz `Engine` es el contrato de almacenamiento detrás de `@arcaelas/whatsapp`. La librería incluye `FileSystemEngine` y `RedisEngine`, pero nada te impide escribir el tuyo propio — útil para testing, debugging o integración con un datastore existente.

Esta guía recorre dos implementaciones personalizadas:

1. **`InMemoryEngine`** — un motor de nivel didáctico respaldado por un `Map`.
2. **`LoggingEngine`** — un wrapper pass-through que loggea cada llamada (excelente para debugging).

---

## La interfaz Engine

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

Seis métodos, todos basados en ruta, todos string in / string out. La librería maneja la serialización JSON por encima del motor — tu trabajo es puramente persistencia clave-valor.

Reglas que honrar:

- **`set`** debe refrescar el mtime de la clave: `list` ordena por mtime DESC.
- **`unset`** debe hacer cascada: eliminar `/chat/123` también elimina `/chat/123/message/...`.
- **`list`** devuelve solo los hijos **directos** de una ruta, paginados, mtime DESC.
- **`count`** debe funcionar sin cargar los valores (usa un contador o índice).

---

## 1. `InMemoryEngine`

Un motor volátil de un solo proceso respaldado por dos `Map`s — uno para valores, otro para timestamps. Todo se pierde cuando el proceso termina.

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

Úsalo como cualquier motor incluido:

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

!!! warning "No apto para producción"
    `InMemoryEngine` pierde cada byte cuando el proceso termina. Eso incluye tus credenciales de sesión — cada reinicio requerirá un nuevo emparejamiento QR/PIN. Usa `FileSystemEngine` para desarrollo local y `RedisEngine` para despliegues distribuidos.

!!! note "Casos de uso"
    Donde *sí* brilla: tests unitarios, scripts efímeros one-shot, explorar la API sin ensuciar el disco y pipelines de CI que mockean la persistencia.

---

## 2. `LoggingEngine` — un wrapper pass-through

Envolver otro motor para observar cada llamada es una de las herramientas de debugging más útiles que puedes construir. El patrón es mecánico: implementa `Engine`, mantén un motor interno, loggea alrededor de cada llamada, luego delega.

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

Conéctalo alrededor de cualquier otro motor — el bot no nota la diferencia:

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

Ahora cada lectura/escritura pasa por la consola:

```text
[fs] get /session/creds HIT (1842b)
[fs] set /chat/584144709840@s.whatsapp.net 73b
[fs] list /chat offset=0 limit=50 -> 12 items
[fs] count /chat/584144709840@s.whatsapp.net/message -> 47
```

!!! tip "La composición es gratis"
    El patrón wrapper compone — envuelve un `RedisEngine` para loggear tráfico Redis, envuelve un `InMemoryEngine` para un test unitario verboso, o incluso encadena wrappers (p. ej. métricas + logging). Como el contrato son solo seis métodos, los decoradores se mantienen triviales.

---

## Siguientes pasos

- [Basic bot](./basic-bot.es.md) — el bot más pequeño posible.
- [Command bot](./command-bot.es.md) — tabla de despacho para comandos textuales.
