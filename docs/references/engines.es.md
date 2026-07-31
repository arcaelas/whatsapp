# Engines

`@arcaelas/whatsapp` separa el cliente de WhatsApp de la capa de persistencia. Un **engine** es un
store clave-valor solo de strings que implementa el contrato `Engine`. La librería incluye cuatro
drivers de producción (`SQLiteEngine`, `FileSystemEngine`, `RedisEngine`, `S3Engine`) y puedes
conectar el tuyo propio.

La serialización (Buffers, BigInts, etc.) vive en una capa dedicada (`serialize` / `deserialize`)
por encima del `BufferJSON` de baileys, para que los motores nunca necesiten lidiar con JSON.

---

## Importación

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

## El contrato `Engine`

```typescript
interface Engine {
    get(path: string): Promise<string | null>;
    set(path: string, value: string, score?: number): Promise<void>;
    unset(path: string): Promise<boolean>;
    list(path: string, offset?: number, limit?: number): Promise<string[]>;
    count(path: string): Promise<number>;
    clear(): Promise<void>;

    // opcionales
    get_buffer?(path: string): Promise<Buffer | null>;
    set_buffer?(path: string, data: Buffer, score?: number): Promise<void>;
}
```

| Método                     | Descripción                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `get(path)`                | Lee un documento. Devuelve `null` si la ruta no existe.                                                  |
| `set(path, value, score?)` | Escribe un documento. `score` fija su posición en `list`; sin él se usa la hora de escritura.             |
| `unset(path)`              | Elimina en cascada la ruta y todos sus descendientes. Idempotente — seguro sobre rutas inexistentes.     |
| `list(path, o, l)`         | Lista los valores de los **hijos directos**, ordenados por **score DESC**, paginados por `offset` / `limit`. |
| `count(path)`              | Cuenta los hijos directos sin cargar sus valores.                                                        |
| `clear()`                  | Vacía todo el almacén.                                                                                   |
| `get_buffer(path)`         | *Opcional.* Lee un binario crudo.                                                                        |
| `set_buffer(path, data)`   | *Opcional.* Escribe un binario crudo, sin pasar por JSON ni base64.                                       |

!!! info "`score` es lo que mantiene intacta la cronología"
    Los mensajes se escriben con su `created_at` como score. Cada reconexión reentrega el historial,
    y un re-sync que reescribiera documentos viejos con el reloj actual empujaría mensajes antiguos
    al tope de `list`. Pasar el score mantiene la línea de tiempo estable sin importar cuántas veces
    se reescriba un documento.

!!! info "Semántica de rutas"
    Las rutas son strings tipo POSIX (`/chat/<jid>/message/<id>`). Los drivers normalizan las barras
    redundantes (`//chat///abc` → `chat/abc`) y recortan los extremos. `unset` elimina el subárbol
    completo en una sola llamada.

### Binarios opcionales

El contenido de media es binario. Cuando un driver implementa `set_buffer` / `get_buffer`, los bytes
se guardan crudos; si no, la librería cae en un documento JSON con base64 (~33% más pesado y hay que
parsearlo para leerlo). Un driver sin esos dos métodos sigue siendo perfectamente válido.

| Driver             | Binarios crudos                                                    |
| ------------------ | -------------------------------------------------------------------- |
| `SQLiteEngine`     | Sí — una columna `BLOB`.                                            |
| `FileSystemEngine` | Sí — un archivo `content.bin` junto al documento.                   |
| `RedisEngine`      | Sí, cuando el cliente expone `getBuffer` / `setBuffer` (ioredis lo hace). |
| `S3Engine`         | No — cae en el documento con base64.                                |

---

## `SQLiteEngine`

Una sola tabla `(path, parent, score, value, binary)` con un índice `(parent, score DESC)`. Es el
driver integrado más eficiente, porque delega en la base lo que los demás resuelven a mano: `list`
es un `ORDER BY score DESC LIMIT/OFFSET` sobre el índice, `count` es un `COUNT(*)` y el `unset` en
cascada es una única sentencia por rango.

```typescript title="Constructor"
new SQLiteEngine(db: SQLiteDatabase, table = 'documents')
```

| Parámetro | Tipo             | Descripción                                                                          |
| --------- | ---------------- | -------------------------------------------------------------------------------------- |
| `db`      | `SQLiteDatabase` | Una base **ya abierta**. Sirven `better-sqlite3` y el `node:sqlite` nativo.             |
| `table`   | `string`         | Tabla donde viven los documentos. Por defecto `'documents'`.                            |

```typescript title="node:sqlite (sin dependencias)" hl_lines="4"
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

El driver no agrega ninguna dependencia propia: la base llega ya abierta, igual que el cliente de
`RedisEngine`. Solo necesita `exec(sql)` y `prepare(sql)` con `run` / `get` / `all` (la interfaz
`SQLiteDatabase`). Al construirse aplica `journal_mode = WAL` y `synchronous = NORMAL` cuando el
driver los acepta, y crea la tabla y el índice si faltan.

!!! tip "Medido contra el driver de sistema de archivos"
    Sobre un chat real de 55.146 mensajes: **220 MB → 64 MB** en disco, primer `list`
    **115 ms → 0,6 ms**, y dos archivos en total en lugar de un directorio por documento.

---

## `FileSystemEngine`

Persiste cada documento en `<base>/<path>/index.json`. La disposición en directorios permite que un
recurso conviva con sus subrecursos anidados (el directorio de un chat contiene su propio
`index.json` y un subárbol `message/`). Las escrituras son atómicas (archivo temporal + rename) y el
score de orden viaja en el mtime del archivo.

```typescript title="Constructor"
new FileSystemEngine(base: string, cached = 12)
```

| Parámetro | Tipo     | Descripción                                                                          |
| --------- | -------- | -------------------------------------------------------------------------------------- |
| `base`    | `string` | Directorio absoluto o relativo usado como raíz del árbol de datos.                     |
| `cached`  | `number` | Directorios indexados en memoria simultáneamente (LRU). Por defecto `12`.              |

```typescript title="Uso" hl_lines="4"
import { join } from 'node:path';
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

const engine = new FileSystemEngine(join(process.cwd(), 'data', 'wa'));

const wa = new WhatsApp({ engine });
await wa.connect((qr) => console.log('QR listo', (qr as Buffer).length, 'bytes'));
```

Para que `list` / `count` cuesten O(limit), el driver mantiene un índice ordenado por directorio,
acotado por LRU y respaldado en un archivo `.order`: al abrir un directorio carga ese archivo y solo
lo reconstruye con `readdir` + `stat` cuando el conteo no coincide. Los binarios viven junto al
documento como `content.bin`.

!!! warning "Un solo escritor por directorio base"
    El índice en memoria asume un único proceso escritor. Dos procesos escribiendo el mismo
    directorio base desincronizarán sus archivos `.order`.

!!! tip "Cuándo elegir el driver de sistema de archivos"
    Desarrollo local y estado inspeccionable: cada documento es un JSON legible. Para volumen,
    `SQLiteEngine` es estrictamente mejor — un chat de 100k mensajes son 100k directorios aquí.

---

## `RedisEngine`

Persiste los documentos como strings de Redis y usa un sorted set por padre para los listados
ordenados.

| Keyspace                     | Tipo        | Propósito                                                      |
| ---------------------------- | ----------- | ---------------------------------------------------------------- |
| `<prefix>:doc:<path>`        | `string`    | El cuerpo del documento serializado.                            |
| `<prefix>:doc:<path>:bin`    | `string`    | El binario crudo, cuando el cliente soporta buffers.            |
| `<prefix>:idx:<parent>`      | `zset`      | Score = el `score` pasado a `set`, member = ruta completa del hijo. |

`list()` es `ZREVRANGE` + `MGET`; `count()` es `ZCARD` (O(1)); `unset()` cae en cascada con `SCAN` +
`DEL`. Las escrituras agrupan documento e índice en un pipeline cuando el cliente lo expone, de modo
que una caída entre ambas operaciones no puede dejar un documento huérfano de su índice.

```typescript title="Constructor"
new RedisEngine(client: RedisClient, prefix = 'wa:default')
```

| Parámetro | Tipo          | Descripción                                                                          |
| --------- | ------------- | -------------------------------------------------------------------------------------- |
| `client`  | `RedisClient` | Un cliente compatible con ioredis. Ver la interfaz de abajo.                            |
| `prefix`  | `string`      | Prefijo de claves; usa uno por cuenta de WhatsApp para evitar colisiones.               |

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

    // opcionales — habilitan comportamiento extra cuando están
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

Cualquier cliente que cumpla esta superficie funciona en runtime — `ioredis` y la mayoría de sus
reemplazos lo hacen.

!!! note "Por qué algunos miembros son variádicos"
    `del`, `zrem`, `scan` y los de buffer se declaran variádicos a propósito: `ioredis` los expone
    con sobrecargas de callback que una firma fija rechazaría bajo `strictFunctionTypes`.
    Declararlos así permite pasar una instancia de `ioredis` directo al motor, sin ningún cast.

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
    Despliegues multiproceso u horizontales, contenedores efímeros donde el sistema de archivos no
    persiste, o cualquier montaje donde ya operas Redis.

---

## `S3Engine`

Persiste cada documento como un objeto en un bucket de AWS S3, con una **caché en memoria opcional**
para rutas estables de lectura intensiva. Requiere la peer dependency opcional
`@aws-sdk/client-s3`; le pasas un `S3Client` ya configurado.

```typescript title="Constructor"
new S3Engine({
    s3: S3Client,
    bucket: string,
    basedir: string,
    cache?: false | { ttl: number; when(key: string): boolean },
    cached?: number,
})
```

| Opción    | Tipo                          | Por defecto | Descripción                                                          |
| --------- | ----------------------------- | ----------- | ---------------------------------------------------------------------- |
| `s3`      | `S3Client`                    | —           | Un cliente `@aws-sdk/client-s3` ya configurado (región, credenciales…). |
| `bucket`  | `string`                      | —           | Nombre del bucket destino.                                             |
| `basedir` | `string`                      | —           | Prefijo base de las claves dentro del bucket; usa uno por cuenta.      |
| `cache`   | `false \| { ttl, when }`      | `false`     | Configuración de la caché local. `false` la desactiva (todo va a S3).  |
| `cached`  | `number`                      | `12`        | Prefijos indexados en memoria simultáneamente (LRU).                   |

Como `LastModified` es de solo lectura, S3 no puede representar el score explícito: el driver
mantiene un índice ordenado por prefijo, respaldado en un objeto `.order`, de modo que el orden
cronológico sobrevive a los re-syncs igual que en los demás drivers. Si falta `.order`, el índice se
reconstruye listando el prefijo una sola vez y ordenando por `LastModified`. Las claves transforman
`@` en `_at_`.

### Caché local

Cuando se pasa `cache`, `when(key)` decide qué rutas se cachean — devuelve `true` para documentos
estables y muy leídos (chats, contactos, el mapa LID→JID) y `false` para los volátiles (sesiones de
Signal, mensajes). Cada entrada cacheada se desaloja con un `setTimeout(ttl)`; **no hay chequeo de
expiración en la lectura** — el timer simplemente elimina la entrada. Las escrituras son
write-through (caché + S3), y `unset` purga el subárbol cacheado para que un dato eliminado nunca se
sirva obsoleto.

```typescript title="Uso con caché" hl_lines="8 9 10 11 12 13 14"
import { S3Client } from '@aws-sdk/client-s3';
import { WhatsApp, S3Engine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new S3Engine({
        s3: new S3Client({ region: 'us-east-1' }),
        bucket: 'my-wa-bucket',
        basedir: 'wa/5491112345678',
        cache: {
            ttl: 180_000, // 3 minutos
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

El driver expone además `delete_prefix(prefix)`, que elimina todos los objetos bajo un prefijo y
devuelve cuántos borró — práctico para scripts de mantenimiento.

!!! tip "Cuándo elegir S3"
    Despliegues serverless / sin estado (Lambda, Fargate) donde no hay ni sistema de archivos ni
    Redis. Ten en cuenta que aquí el media se guarda como documentos en base64, porque el driver no
    implementa métodos de binario crudo.

---

## Helpers de serialización

```typescript
function serialize<T>(doc: T): string;
function deserialize<T>(raw: string | null): T | null;
```

Ambos helpers son envoltorios finos sobre `JSON.stringify` / `JSON.parse` usando el replacer/reviver
`BufferJSON` de baileys, de modo que las instancias de `Buffer` dentro de las claves de Signal, las
referencias de media y los payloads de encuestas viajan de ida y vuelta sin pérdida. `deserialize`
devuelve `null` cuando la entrada es `null` **o cuando el JSON es inválido**, así un documento
truncado por una escritura interrumpida se comporta como inexistente en lugar de envenenar una
página entera con un error de parseo.

```typescript title="Almacenamiento propio sobre un motor"
import { serialize, deserialize } from '@arcaelas/whatsapp';

interface BotConfig { greeting: string; quiet_hours: [number, number] }

await wa.engine.set('/app/config', serialize<BotConfig>({
    greeting: '¡Hola!',
    quiet_hours: [22, 8],
}));

const config = deserialize<BotConfig>(await wa.engine.get('/app/config'));
```

---

## Motores personalizados

Implementar la interfaz `Engine` alcanza para conectar cualquier backend (PostgreSQL, DynamoDB, un
mapa en memoria para pruebas…). Respeta estas invariantes y el resto de la librería se comporta
correctamente:

1. `set` guarda el valor tal cual y recuerda el `score` (o la hora de escritura si no llega).
2. `list` devuelve **solo los hijos directos**, ordenados por score DESC.
3. `unset` cae en cascada sobre el subárbol y es idempotente.
4. `clear` vacía todo lo que el motor posee.
5. `get_buffer` / `set_buffer` son todo o nada: implementa ambos o ninguno.

```typescript title="Esqueleto de un motor personalizado" hl_lines="3"
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

!!! warning "Contrato solo de strings"
    Los motores no deben parsear ni transformar valores. Guarda siempre el string exacto que recibe
    `set` y devuélvelo tal cual en `get` / `list`. La serialización es asunto de la capa superior.

!!! danger "Un motor por cuenta"
    Nunca compartas una instancia de motor entre dos clientes `WhatsApp`: sus documentos viven bajo
    las mismas rutas y colisionarían. Dale a cada cuenta su propio directorio base, prefijo, ruta de
    bucket o archivo de base de datos.
