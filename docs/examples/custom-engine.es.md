# Custom Engine

La interfaz `Engine` es el contrato de almacenamiento detrás de `@arcaelas/whatsapp`. La librería incluye `SQLiteEngine`, `FileSystemEngine`, `RedisEngine` y `S3Engine`, pero nada te impide escribir el tuyo propio — útil para testing, debugging o integración con un datastore existente.

Esta guía recorre dos implementaciones personalizadas:

1. **`InMemoryEngine`** — un motor de nivel didáctico respaldado por un `Map`.
2. **`LoggingEngine`** — un wrapper pass-through que loggea cada llamada (excelente para debugging).

---

## La interfaz Engine

```typescript
export interface Engine {
    get(path: string): Promise<string | null>;
    set(path: string, value: string, score?: number): Promise<void>;
    unset(path: string): Promise<boolean>;
    list(path: string, offset?: number, limit?: number): Promise<string[]>;
    count(path: string): Promise<number>;
    clear(): Promise<void>;

    // par opcional, para binarios crudos
    get_buffer?(path: string): Promise<Buffer | null>;
    set_buffer?(path: string, data: Buffer, score?: number): Promise<void>;
}
```

Seis métodos obligatorios, todos basados en rutas, todos string de entrada / string de salida. La librería maneja la serialización JSON por encima del motor — tu trabajo es pura persistencia clave-valor.

Reglas a respetar:

- **`set`** debe recordar el score de orden: el `score` explícito cuando llega, y la hora de escritura si no.
- **`unset`** debe caer en cascada: eliminar `/chat/123` también elimina `/chat/123/message/...`.
- **`list`** devuelve solo los hijos **directos** de una ruta, paginados, score DESC.
- **`count`** debe funcionar sin cargar los valores.
- **`get_buffer` / `set_buffer`** son opcionales, pero todo o nada: implementa ambos o ninguno. Cuando faltan, la librería guarda el media como un documento JSON en base64.

---

## 1. `InMemoryEngine`

Un motor volátil de un solo proceso respaldado por dos `Map` — uno para documentos, otro para binarios. Todo se pierde cuando el proceso termina.

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

    /** Hijos directos de una ruta, con su score de orden. */
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

Úsalo como cualquier motor integrado:

```typescript title="index.ts"
import { WhatsApp } from '@arcaelas/whatsapp';
import { InMemoryEngine } from './in-memory-engine';

const wa = new WhatsApp({
    engine: new InMemoryEngine(),
    phone: 5491112345678,
});

wa.connect((auth) => {
    console.log(typeof auth === 'string' ? `pin: ${auth}` : 'escanea el QR');
});
```

!!! warning "No apto para producción"
    `InMemoryEngine` pierde cada byte cuando el proceso termina. Eso incluye las credenciales de sesión — cada reinicio requerirá un emparejamiento QR/PIN fresco. Usa `SQLiteEngine` o `FileSystemEngine` para desarrollo local y `RedisEngine` para despliegues distribuidos.

!!! note "Casos de uso"
    Donde sí brilla: tests unitarios, scripts efímeros de una sola corrida, explorar la API sin ensuciar el disco, y pipelines de CI que simulan la persistencia.

---

## 2. `LoggingEngine` — un wrapper pass-through

Envolver otro motor para observar cada llamada es una de las herramientas de debugging más útiles que puedes construir. El patrón es mecánico: implementa `Engine`, guarda un motor interno, loggea alrededor de cada llamada y delega.

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

Móntalo alrededor de cualquier otro motor — el bot no nota la diferencia:

```typescript title="index.ts"
import { join } from 'node:path';
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';
import { LoggingEngine } from './logging-engine';

const wa = new WhatsApp({
    engine: new LoggingEngine(
        new FileSystemEngine(join(__dirname, 'session')),
        'fs',
    ),
    phone: 5491112345678,
});
```

Ahora cada lectura/escritura pasa por la consola:

```text
[fs] get /session/creds HIT (1842b)
[fs] set /chat/5491112345678@s.whatsapp.net 73b score=now
[fs] set /chat/5491112345678@s.whatsapp.net/message/ABC 4211b score=1767371367857
[fs] set_buffer /chat/5491112345678@s.whatsapp.net/message/ABC/content 51204b
[fs] list /chat offset=0 limit=50 -> 12 items
[fs] count /chat/5491112345678@s.whatsapp.net/message -> 47
```

!!! danger "Los métodos de binario son una señal, no solo un passthrough"
    La librería decide cómo guardar el media comprobando si `set_buffer` **existe** en el motor. Un
    wrapper que lo declare y delegue en un motor interno sin soporte de binarios (como `S3Engine`)
    descartaría el contenido en silencio — de ahí el fallback a base64 de arriba.

!!! tip "La composición es gratis"
    El patrón wrapper compone — envuelve un `RedisEngine` para loggear el tráfico de Redis, envuelve un `InMemoryEngine` para un test unitario verboso, o incluso encadena wrappers (p. ej. métricas + logging). Como el contrato es pequeño, los decoradores quedan triviales.

---

## Siguientes pasos

- [Basic bot](./basic-bot.es.md) — el bot más pequeño posible.
- [Command bot](./command-bot.es.md) — tabla de despacho para comandos textuales.
