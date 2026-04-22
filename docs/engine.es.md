# Engine

La capa de persistencia de `@arcaelas/whatsapp` v3.

---

## Filosofía

`Engine` es un **contrato key/value solo de strings**. No sabe nada sobre
WhatsApp, JSON o Buffers — simplemente almacena y recupera strings opacos bajo
rutas jerárquicas.

| Preocupación        | Vive en                                                   |
| ------------------- | --------------------------------------------------------- |
| Protocolo de cable  | `baileys`                                                 |
| Formas del dominio  | `IChatRaw`, `IContactRaw`, `IMessage`                     |
| Serialización       | `serialize` / `deserialize` (BufferJSON, en `~/lib/store`) |
| Persistencia        | **Implementaciones de `Engine`**                          |

Esta separación significa que una implementación de motor puede estar respaldada por cualquier cosa que
pueda `get`/`set`/`unset`/`list`/`count`/`clear` strings bajo una ruta: un árbol de
archivos, Redis, SQLite, DynamoDB, un map en memoria para pruebas, etc.

---

## Interfaz

```ts
import type { Engine } from '@arcaelas/whatsapp';

interface Engine {
    /** Lee un valor por ruta. Devuelve null si no existe. */
    get(path: string): Promise<string | null>;

    /** Escribe un valor. DEBE refrescar el mtime usado por `list`. */
    set(path: string, value: string): Promise<void>;

    /**
     * Elimina el valor Y todo descendiente bajo `path`.
     * DEBE ser idempotente — nunca lanzar cuando `path` no exista.
     */
    unset(path: string): Promise<boolean>;

    /**
     * Lista los valores de los **hijos directos** de `path`,
     * paginados y ordenados por mtime DESC.
     */
    list(path: string, offset?: number, limit?: number): Promise<string[]>;

    /** Cuenta los hijos directos de `path` sin cargar sus valores. */
    count(path: string): Promise<number>;

    /** Descarta todo en el namespace de este motor. */
    clear(): Promise<void>;
}
```

### Semántica por método

| Método   | Contrato                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| `get`    | Devuelve el string exacto escrito previamente por `set`, o `null` si la ruta nunca se escribió / fue eliminada. |
| `set`    | Sobrescribe cualquier valor anterior. Refresca el mtime de la ruta para que los siguientes `list` reordenen correctamente. |
| `unset`  | Cascada — elimina la ruta **y todas las sub-rutas**. Idempotente: devuelve `true` incluso cuando no existía nada. |
| `list`   | Devuelve los **valores** (no las claves) de los hijos directos, ordenados por mtime DESC, recortados por `offset`/`limit`. Por defecto: `offset=0`, `limit=50`. |
| `count`  | Devuelve el número de hijos directos. Debe ser O(1) donde el backend lo permita (`ZCARD` en Redis).        |
| `clear`  | Limpia todo el keyspace del motor. Usado en `loggedOut` cuando `autoclean: true`.                          |

!!! info "Información: normalización de rutas"
    Ambos drivers integrados colapsan `//` y recortan las `/` iniciales/finales antes
    de usar. Un motor personalizado debería hacer lo mismo para que `/chat/x`, `chat/x` y
    `/chat//x/` resuelvan a la misma clave.

!!! warning "Advertencia: `list` devuelve valores, no claves"
    A diferencia de muchas APIs key/value, `Engine.list` devuelve el **contenido del
    documento**. Esto le permite al orquestador hacer lecturas paginadas en un solo
    round-trip (`ZREVRANGE` + `MGET` en Redis, `readdir` + `readFile` paralelo
    en disco).

---

## Implementaciones integradas

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
<prefix>:doc:<path>           # el documento
<prefix>:idx:<parent_path>    # sorted set: score=mtime, member=ruta hija completa
```

Puntos destacados:

- `list` es un `ZREVRANGE` + un `MGET` — sin round-trip por documento.
- `count` es `ZCARD` (O(1)).
- `unset` cascada por `SCAN`/`DEL` sobre `doc:<path>/*` e `idx:<path>(/*)`.
- `clear` limpia todo lo que coincida con `<prefix>:*`.

La interfaz mínima del cliente (`RedisClient`) solo requiere los comandos que el
motor realmente usa, por lo que funciona con `ioredis`, `node-redis` (con adaptadores
delgados), o cualquier driver compatible.

---

### `FileSystemEngine`

```ts
import { FileSystemEngine, WhatsApp } from '@arcaelas/whatsapp';
import { join } from 'node:path';

const engine = new FileSystemEngine(join(process.cwd(), '.baileys'));

const wa = new WhatsApp({ engine, phone: 584144709840 });
```

Layout en disco:

```
<base>/<path>/index.json
```

Cada documento vive bajo su propio directorio para poder coexistir con sub-recursos
anidados (p. ej. un directorio de chat contiene tanto `index.json` como un
directorio `message/`).

Puntos destacados:

- `set` hace `mkdir -p` luego `writeFile`.
- `list` lee `mtimeMs` para el `index.json` de cada hijo y ordena DESC.
- `unset` es `rm -rf` sobre el directorio de la ruta. Idempotente.
- `clear` es `rm -rf` sobre todo el directorio base.

---

## Implementando un motor personalizado

A continuación hay dos plantillas listas para ajustar. Ambas respetan el contrato completo; solo `set`
necesita refrescar el mtime por ruta para que `list` ordene correctamente.

### Motor en memoria (pruebas, fixtures)

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

### Motor SQLite

Un esquema de una sola tabla es suficiente — mantén índices `(mtime DESC)` y
amigables con prefijos en la columna de path.

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

!!! tip "Consejo: casos límite que vale la pena probar"
    - `unset` sobre una ruta faltante devuelve `true` (idempotente).
    - `list` de una ruta sin hijos devuelve `[]`, nunca lanza.
    - `set` sobre una ruta existente sobrescribe e incrementa el mtime — las posiciones antiguas en `list` deberían desaparecer y el nuevo valor aparecer en la parte superior.
    - Normalización de rutas: `chat/x`, `/chat/x` y `/chat//x/` todos impactan el mismo registro.

---

## Multicuenta: un proceso, varios motores

Cada instancia `WhatsApp` posee exactamente un `Engine`. Para ejecutar varias cuentas
concurrentemente en el mismo proceso, dale a cada una su propio motor — posiblemente de
tipos diferentes:

```ts
import IORedis from 'ioredis';
import { join } from 'node:path';
import {
    FileSystemEngine,
    RedisEngine,
    WhatsApp,
} from '@arcaelas/whatsapp';

const redis = new IORedis(process.env.REDIS_URL!);

// Cuenta A — respaldada por Redis (hot, amigable con múltiples instancias)
const wa_a = new WhatsApp({
    engine: new RedisEngine(redis, 'wa:584144709840'),
    phone: 584144709840,
});

// Cuenta B — filesystem local (bot de un solo host, fácil de inspeccionar)
const wa_b = new WhatsApp({
    engine: new FileSystemEngine(join(process.cwd(), '.sessions/B')),
    phone: 584121234567,
});

await Promise.all([
    wa_a.connect((auth) => console.log('A:', auth)),
    wa_b.connect((auth) => console.log('B:', auth)),
]);
```

Dos reglas que recordar:

1. **Nunca compartas una instancia de motor entre dos clientes `WhatsApp`.** El estado
   colisionaría bajo las mismas rutas. Con Redis, dale a cada cuenta un `prefix` único.
   Con FileSystem, dale a cada cuenta un directorio base único.
2. El motor **ya debe estar conectado** cuando construyes `WhatsApp` — es
   leído por el constructor y usado inmediatamente en `connect()`.

---

## `autoclean` y `loggedOut`

Cuando baileys reporta `DisconnectReason.loggedOut`, el orquestador decide
qué hacer con el motor **antes** de emitir `disconnected`, para que los listeners
siempre observen el estado final:

| Valor de `autoclean`       | Acción en `loggedOut`                                         |
| -------------------------- | ------------------------------------------------------------- |
| `true` (por defecto)       | `await engine.clear()` — todo el namespace del motor se limpia. |
| `false`                    | `await engine.unset('/session/creds')` — solo credenciales; chats / contactos / mensajes se preservan. |

```ts
// Limpiar todo cuando el usuario hace logout desde el teléfono
const wa1 = new WhatsApp({ engine, autoclean: true });

// Mantener historial; solo forzar re-autenticación en el próximo connect
const wa2 = new WhatsApp({ engine, autoclean: false });
```

`disconnect({ destroy: true })` también llama a `engine.clear()`, independientemente de
`autoclean`, por lo que una destrucción manual siempre está a una bandera de distancia:

```ts
await wa.disconnect({ destroy: true }); // igual que engine.clear()
```

!!! note "Nota: la limpieza ocurre antes del evento"
    El orquestador espera a que termine la limpieza del motor antes de emitir `disconnected`.
    Cualquier handler adjunto vía `wa.on('disconnected', ...)` garantizado verá
    el estado post-limpieza del store.
