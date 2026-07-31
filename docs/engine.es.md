# Engine

La capa de persistencia de `@arcaelas/whatsapp`.

---

## Filosofía

`Engine` es un **contrato key/value solo de strings**. No sabe nada sobre WhatsApp, JSON o Buffers —
simplemente almacena y recupera strings opacos bajo rutas jerárquicas, en el orden que se le indica.

| Preocupación        | Vive en                                                    |
| ------------------- | ---------------------------------------------------------- |
| Protocolo de red    | `baileys`                                                  |
| Formas del dominio  | `Contact`, `Chat`, `Message`, `Feed`                       |
| Serialización       | `serialize` / `deserialize` (BufferJSON)                   |
| Persistencia        | **Implementaciones de `Engine`**                           |

Esta separación implica que un motor puede estar respaldado por cualquier cosa capaz de
`get`/`set`/`unset`/`list`/`count`/`clear` strings bajo una ruta: un archivo SQLite, un árbol de
directorios, Redis, S3, DynamoDB, un mapa en memoria para pruebas…

---

## Interfaz

```ts
interface Engine {
    /** Lee un valor por ruta. Devuelve null si no existe. */
    get(path: string): Promise<string | null>;

    /**
     * Escribe un valor. `score` gobierna el orden de `list` (epoch ms del documento);
     * sin él se usa la hora de escritura.
     */
    set(path: string, value: string, score?: number): Promise<void>;

    /**
     * Elimina el valor Y todos los descendientes bajo `path`.
     * DEBE ser idempotente — nunca lanzar cuando `path` no existe.
     */
    unset(path: string): Promise<boolean>;

    /**
     * Lista los valores de los **hijos directos** de `path`,
     * paginados y ordenados por score DESC.
     */
    list(path: string, offset?: number, limit?: number): Promise<string[]>;

    /** Cuenta los hijos directos de `path` sin cargar sus valores. */
    count(path: string): Promise<number>;

    /** Elimina todo lo que hay en el namespace de este motor. */
    clear(): Promise<void>;

    /** Opcional: lee un binario crudo. */
    get_buffer?(path: string): Promise<Buffer | null>;

    /** Opcional: escribe un binario crudo, sin pasar por JSON ni base64. */
    set_buffer?(path: string, data: Buffer, score?: number): Promise<void>;
}
```

### Semántica por método

| Método       | Contrato                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `get`        | Devuelve el string exacto escrito antes por `set`, o `null` si la ruta nunca se escribió / se eliminó.                      |
| `set`        | Sobrescribe cualquier valor previo y registra el score de orden (el `score` explícito, o la hora de escritura si no llega). |
| `unset`      | Cae en cascada — elimina la ruta **y todas sus subrutas**. Idempotente: devuelve `true` aunque no existiera nada.           |
| `list`       | Devuelve los **valores** (no las claves) de los hijos directos, ordenados por score DESC, recortados por `offset`/`limit`. Por defecto: `0, 50`. |
| `count`      | Devuelve la cantidad de hijos directos. Debería ser O(1) donde el backend lo permita (`ZCARD` en Redis, `COUNT(*)` en SQLite). |
| `clear`      | Vacía todo el keyspace del motor. Se usa en `loggedOut` con `autoclean: true`, y en `disconnect({ destroy: true })`.        |
| `*_buffer`   | Par opcional. Implementa **ambos o ninguno**: la librería consulta `set_buffer` para decidir cómo guardar el media.         |

!!! info "Por qué existe `score`"
    Los mensajes se escriben con su `created_at`. Cada reconexión reentrega el historial; si un
    documento viejo reescrito tomara el reloj actual como posición, los mensajes antiguos saltarían
    al tope de `list`. El score mantiene la línea de tiempo estable sin importar cuántas veces se
    reescriba un documento.

!!! info "Normalización de rutas"
    Todos los drivers integrados colapsan `//` y recortan las barras de los extremos antes de usar la
    ruta. Un motor propio debería hacer lo mismo para que `/chat/x`, `chat/x` y `/chat//x/` resuelvan
    a la misma clave.

!!! warning "`list` devuelve valores, no claves"
    A diferencia de muchas APIs key/value, `Engine.list` devuelve el **contenido de los documentos**.
    Eso le permite al orquestador hacer lecturas paginadas en un solo round-trip (`ZREVRANGE` +
    `MGET` en Redis, un único `SELECT` indexado en SQLite).

---

## Implementaciones integradas

| Driver             | Mejor para                                          | Binarios crudos |
| ------------------ | --------------------------------------------------- | --------------- |
| `SQLiteEngine`     | Cualquier cosa con volumen; la opción por defecto.  | Sí (BLOB)       |
| `FileSystemEngine` | Desarrollo local, estado inspeccionable.            | Sí (archivo)    |
| `RedisEngine`      | Multiproceso / contenedores efímeros.               | Sí (depende del cliente) |
| `S3Engine`         | Despliegues serverless, sin estado.                 | No (base64)     |

Constructores, keyspaces y opciones están documentados en
[References / Engines](references/engines.es.md).

```ts
import { DatabaseSync } from 'node:sqlite';
import { SQLiteEngine, WhatsApp } from '@arcaelas/whatsapp';

const engine = new SQLiteEngine(new DatabaseSync('.sessions/5491112345678.db'));
const wa = new WhatsApp({ engine, phone: 5491112345678 });
```

---

## Implementar un motor propio

El esqueleto de abajo respeta el contrato completo, incluido el score. Alcanza para pruebas y
fixtures, y es la forma que sigue cualquier backend real.

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

    /** Hijos directos de una ruta, con su score. */
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

Úsalo como cualquier motor integrado:

```ts title="index.ts"
import { WhatsApp } from '@arcaelas/whatsapp';
import { MemoryEngine } from './memory-engine';

const wa = new WhatsApp({ engine: new MemoryEngine(), phone: 5491112345678 });
```

!!! warning "Volátil significa volátil"
    Un motor en memoria pierde las credenciales de sesión al salir, así que cada reinicio exige un
    emparejamiento nuevo por QR/PIN. Brilla en pruebas unitarias, scripts de una sola corrida y
    pipelines de CI — no en producción.

!!! tip "Casos límite que vale la pena probar"
    - `unset` sobre una ruta inexistente devuelve `true` (idempotente).
    - `list` de una ruta sin hijos devuelve `[]`, nunca lanza.
    - `set` con un `score` explícito ubica el documento por ese score, no por la hora de escritura.
    - `set` sobre una ruta existente sobrescribe el valor y actualiza su score.
    - Normalización de rutas: `chat/x`, `/chat/x` y `/chat//x/` dan en el mismo registro.
    - `unset('/chat/x')` también elimina `/chat/x/message/y` y su contenido.

### Envolver un motor

Como el contrato es pequeño, un wrapper pasa-a-través es una forma barata de agregar logging,
métricas o cifrado. Ver [Examples / Custom Engine](examples/custom-engine.es.md) para un
`LoggingEngine` completo.

---

## Multicuenta: un proceso, varios motores

Cada instancia de `WhatsApp` posee exactamente un `Engine`. Para correr varias cuentas
concurrentemente en el mismo proceso, dale a cada una su propio motor — incluso de tipos distintos:

```ts
import IORedis from 'ioredis';
import { DatabaseSync } from 'node:sqlite';
import { RedisEngine, SQLiteEngine, WhatsApp } from '@arcaelas/whatsapp';

const redis = new IORedis(process.env.REDIS_URL!);

// Cuenta A — respaldada por Redis (caliente, apta para múltiples instancias)
const wa_a = new WhatsApp({
    engine: new RedisEngine(redis, 'wa:5491112345678'),
    phone: 5491112345678,
});

// Cuenta B — archivo SQLite local
const wa_b = new WhatsApp({
    engine: new SQLiteEngine(new DatabaseSync('.sessions/584121234567.db')),
    phone: 584121234567,
});

await Promise.all([
    wa_a.connect((auth) => console.log('A:', auth)),
    wa_b.connect((auth) => console.log('B:', auth)),
]);
```

Dos reglas para recordar:

1. **Nunca compartas una instancia de motor entre dos clientes `WhatsApp`.** El estado colisionaría
   bajo las mismas rutas. Con Redis, dale a cada cuenta un `prefix` único; con el sistema de
   archivos, un directorio base único; con SQLite, un archivo único (o al menos una tabla única).
2. El motor **ya debe estar armado** cuando construyes `WhatsApp` — lo lee el constructor y lo usa
   inmediatamente en `connect()`.

---

## `autoclean` y `loggedOut`

Cuando baileys reporta `DisconnectReason.loggedOut`, el orquestador decide qué hacer con el motor
**antes** de emitir `disconnected`, para que los listeners siempre observen el estado final:

| Valor de `autoclean` | Acción ante `loggedOut`                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `true` (por defecto) | `await engine.clear()` — se vacía todo el namespace del motor.                                        |
| `false`              | `await engine.unset('/session/creds')` — solo credenciales; chats / contactos / mensajes se conservan. |

```ts
// Borrar todo cuando el usuario cierra sesión desde el teléfono
const wa1 = new WhatsApp({ engine, autoclean: true });

// Conservar el historial; solo forzar reautenticación en el próximo connect
const wa2 = new WhatsApp({ engine, autoclean: false });
```

`disconnect({ destroy: true })` también llama a `engine.clear()`, sin importar `autoclean`, así que
la limpieza manual está siempre a una bandera de distancia:

```ts
await wa.disconnect({ destroy: true }); // equivalente a engine.clear()
```

!!! note "La limpieza ocurre antes del evento"
    El orquestador espera la limpieza del motor antes de emitir `disconnected`. Cualquier handler
    enganchado con `wa.on('disconnected', …)` tiene garantizado ver el estado del almacén posterior a
    la limpieza.
