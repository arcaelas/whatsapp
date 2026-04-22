# Engines

`@arcaelas/whatsapp` v3 separa el cliente de WhatsApp de la capa de persistencia. Un **engine**
es un store clave-valor solo de strings que implementa el contrato `Engine`. La librería incluye dos
drivers de producción (`FileSystemEngine`, `RedisEngine`) y puedes conectar el tuyo propio.

La serialización (Buffers, BigInts, etc.) vive en una capa dedicada (`serialize` / `deserialize`)
por encima del `BufferJSON` de baileys, para que los motores nunca necesiten lidiar con JSON.

---

## Importación

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

## El contrato `Engine`

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

| Método              | Descripción                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `get(path)`         | Lee un documento. Devuelve `null` si la ruta no existe.                                            |
| `set(path, value)`  | Escribe un documento y refresca su mtime (que controla el orden de `list`).                        |
| `unset(path)`       | Elimina en cascada la ruta y cada descendiente. Idempotente — seguro llamar en rutas faltantes.    |
| `list(path, o, l)`  | Lista los valores de los **hijos directos**, ordenados por mtime DESC, paginados por `offset` / `limit`. |
| `count(path)`       | Cuenta los hijos directos sin cargar sus valores.                                                  |
| `clear()`           | Borra todo el store.                                                                               |

!!! info "Semántica de rutas"
    Las rutas son strings tipo POSIX (`/chat/<jid>/message/<id>`). Los drivers normalizan
    los slashes redundantes (`//chat///abc` → `chat/abc`). `set` siempre refresca el mtime, que es lo que hace
    baratos los listados "más recientes primero". `unset` hace cascada del subárbol completo en una sola llamada.

---

## `FileSystemEngine`

Persiste cada documento en `<base>/<path>/index.json`. El layout de directorios permite que un recurso
coexista con subrecursos anidados (un directorio de chat puede contener tanto su propio `index.json` como un
subárbol `message/`).

```typescript title="Constructor"
new FileSystemEngine(basePath: string)
```

| Parámetro  | Tipo     | Descripción                                                       |
| ---------- | -------- | ----------------------------------------------------------------- |
| `basePath` | `string` | Directorio absoluto o relativo usado como raíz del árbol de datos. |

```typescript title="Uso" hl_lines="4 6 7"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';
import { join } from 'node:path';

const engine = new FileSystemEngine(join(process.cwd(), 'data', 'wa'));

const wa = new WhatsApp({ engine });
await wa.connect((qr) => console.log('QR ready', qr.length, 'bytes'));
```

!!! tip "Cuándo elegir el driver de filesystem"
    Desarrollo local, bots de un solo proceso o despliegues embebidos. La persistencia es durable,
    inspeccionable desde el shell y requiere cero infraestructura.

---

## `RedisEngine`

Persiste documentos como strings de Redis y usa un sorted set por padre para listados ordenados.

| Keyspace                     | Tipo        | Propósito                                                |
| ---------------------------- | ----------- | -------------------------------------------------------- |
| `<prefix>:doc:<path>`        | `string`    | El cuerpo del documento serializado.                     |
| `<prefix>:idx:<parent>`      | `zset`      | Score = mtime, member = ruta hija completa.              |

`list()` está implementado como `ZREVRANGE` + `MGET` en un solo round-trip; `count()` es `ZCARD`
(O(1)); `unset()` hace cascada vía `SCAN` + `DEL` sobre `*:doc:<path>/*` y `*:idx:<path>*`.

```typescript title="Constructor"
new RedisEngine(client: RedisClient, prefix?: string)
```

| Parámetro | Tipo          | Por defecto    | Descripción                                                                 |
| --------- | ------------- | -------------- | --------------------------------------------------------------------------- |
| `client`  | `RedisClient` | —              | Un cliente compatible con ioredis. Ver la interfaz abajo para los métodos requeridos. |
| `prefix`  | `string`      | `'wa:default'` | Prefijo de claves; usa un prefijo por cuenta de WhatsApp para evitar colisiones. |

### Interfaz `RedisClient`

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

Cualquier cliente que coincida con esta superficie funciona: `ioredis` y la mayoría de reemplazos drop-in lo hacen.

```typescript title="Uso con ioredis" hl_lines="5 6 7"
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

!!! tip "Cuándo elegir Redis"
    Despliegues multi-proceso / horizontales, contenedores efímeros donde el filesystem no se
    persiste, o cualquier configuración donde ya operas Redis.

---

## Helpers de serialización

```typescript
function serialize<T>(doc: T): string;
function deserialize<T>(raw: string | null): T | null;
```

Ambos helpers son envoltorios finos sobre `JSON.stringify` / `JSON.parse` usando el `BufferJSON` de baileys
como replacer/reviver, por lo que las instancias de `Buffer` dentro de claves de Signal, referencias de medios
de mensajes y payloads de encuestas hacen round-trip sin pérdida. `deserialize(null)` devuelve `null`, lo que
hace seguro encadenarlo después de `engine.get()`.

```typescript title="Almacenamiento personalizado sobre un motor"
import { serialize, deserialize } from '@arcaelas/whatsapp';

interface BotConfig { greeting: string; quietHours: [number, number]; }

await wa.engine.set('/app/config', serialize<BotConfig>({
    greeting: 'Hello!',
    quietHours: [22, 8],
}));

const config = deserialize<BotConfig>(await wa.engine.get('/app/config'));
```

---

## Motores personalizados

Implementar la interfaz `Engine` es suficiente para conectar cualquier backend (PostgreSQL, S3, SQLite,
DynamoDB, ...). Honra los cuatro invariantes y el resto de la librería se comportará correctamente:

1. `set` actualiza el mtime que controla el orden de `list`.
2. `list` devuelve **solo hijos directos**, ordenados por mtime DESC.
3. `unset` hace cascada del subárbol.
4. `clear` borra todo lo que el motor posee.

```typescript title="Esqueleto para un motor personalizado" hl_lines="3"
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

!!! warning "Contrato solo de strings"
    Los motores no deben parsear ni transformar valores. Siempre almacena el string exacto entregado a `set`
    y devuélvelo verbatim desde `get` / `list`. La serialización es una preocupación de nivel superior.
