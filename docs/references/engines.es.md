# Engines de Persistencia

Los engines determinan donde se almacenan la sesion, contactos, chats y mensajes.

---

## Importacion

```typescript
import { Engine, FileEngine, RedisEngine } from "@arcaelas/whatsapp";
import type { RedisClient } from "@arcaelas/whatsapp";
```

---

## Arquitectura

El sistema de persistencia usa un patron simple:

```
WhatsApp -> Engine (FileEngine, RedisEngine o custom)
```

Los engines implementan una interfaz generica de `get/set/list` para almacenamiento key-value de texto (JSON stringified).

---

## Interface Engine

Define el contrato que deben implementar todos los engines.

```typescript
interface Engine {
  get(key: string): Promise<string | null>;
  set(key: string, value: string | null): Promise<void>;
  list(prefix: string, offset?: number, limit?: number): Promise<string[]>;
}
```

### Metodos

#### `get(key)`

Obtiene un valor por su key.

```typescript
const data = await engine.get("contact/5491112345678@s.whatsapp.net/index");
if (data) {
  const contact = JSON.parse(data);
  console.log(contact.name);
}
```

#### `set(key, value)`

Guarda o elimina un valor. Si `value` es `null`, elimina la key y todas las sub-keys recursivamente (cascade delete).

```typescript
// Guardar
await engine.set("contact/123/index", JSON.stringify({ name: "John" }));

// Eliminar con cascade (elimina la key y todo lo que este bajo ese prefijo)
await engine.set("chat/123@s.whatsapp.net", null);
// Esto elimina: chat/123@s.whatsapp.net/index, chat/123@s.whatsapp.net/messages,
// chat/123@s.whatsapp.net/message/*/index, etc.
```

> **Cascade delete:** Cuando se pasa `null` como valor, el engine debe eliminar no solo la key exacta sino tambien todas las sub-keys. Por ejemplo, `set("chat/123", null)` elimina `chat/123`, `chat/123/index`, `chat/123/messages`, `chat/123/message/ABC/index`, etc. Tanto FileEngine (via `rm -rf`) como RedisEngine (via SCAN + DEL) implementan este comportamiento.

#### `list(prefix, offset?, limit?)`

Lista keys bajo un prefijo.

```typescript
// Listar contactos
const keys = await engine.list("contact/", 0, 50);
for (const key of keys) {
  const data = await engine.get(key);
  console.log(key, data);
}
```

> **Orden:** FileEngine ordena por fecha de modificacion (mas reciente primero). RedisEngine usa SCAN que no garantiza orden. Las implementaciones custom deben documentar su comportamiento de orden.

### Estructura de keys

Los keys siguen una convencion de paths:

| Tipo | Patron | Ejemplo |
|------|--------|---------|
| Session | `session/{key}` | `session/creds` |
| Signal keys | `session/{type}/{id}` | `session/pre-key/1` |
| Contact | `contact/{jid}/index` | `contact/5491112345678@s.whatsapp.net/index` |
| LID mapping | `lid/{lid}` | `lid/some-lid@lid` |
| Chat | `chat/{cid}/index` | `chat/5491112345678@s.whatsapp.net/index` |
| Chat messages index | `chat/{cid}/messages` | `chat/123@s.whatsapp.net/messages` |
| Message index | `chat/{cid}/message/{mid}/index` | `chat/123@s.whatsapp.net/message/ABC123/index` |
| Message raw | `chat/{cid}/message/{mid}/raw` | `chat/123@s.whatsapp.net/message/ABC123/raw` |
| Message content | `chat/{cid}/message/{mid}/content` | `chat/123@s.whatsapp.net/message/ABC123/content` |

La key `chat/{cid}/messages` es un archivo de texto con lineas en formato `{timestamp} {mid}`, ordenadas de mas reciente a mas antiguo. Se usa como indice para listar y paginar mensajes.

La key `lid/{lid}` almacena el JID real de un contacto, permitiendo resolver Linked IDs a JIDs estandar.

---

## FileEngine

Engine de persistencia en sistema de archivos local. Es el engine por defecto.

### Constructor

```typescript
new FileEngine(basePath?: string)
```

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `basePath` | `string` | `.baileys/default` | Directorio base |

### Estructura de archivos

```
{basePath}/
  session/
    creds              # Credenciales JSON
    pre-key/
      1                # Claves de cifrado
    ...
  contact/
    5491112345678_at_s.whatsapp.net/
      index            # Contacto JSON
  chat/
    5491112345678_at_s.whatsapp.net/
      index            # Chat JSON
      messages         # Indice de mensajes (texto plano)
      message/
        ABC123/
          index        # Mensaje index JSON
          raw          # WAMessage JSON
          content      # Contenido (base64 para media)
```

> **Sanitizacion de keys:** El caracter `@` se reemplaza por `_at_` en los nombres de archivos para compatibilidad con sistemas de archivos.

### Comportamiento

- `get(key)` lee el archivo como texto UTF-8
- `set(key, value)` crea directorios intermedios automaticamente y escribe el archivo
- `set(key, null)` ejecuta `rm -rf` sobre la key (archivo y directorio, recursivo)
- `list(prefix)` lista archivos recursivamente, ordena por fecha de modificacion (mas reciente primero)

### Ejemplo

```typescript
import { WhatsApp, FileEngine } from "@arcaelas/whatsapp";

// Ruta por defecto (.baileys/default)
const wa1 = new WhatsApp();

// Ruta personalizada
const wa2 = new WhatsApp({
  engine: new FileEngine(".baileys/mi-bot"),
});

// Multiples instancias con diferentes sesiones
const wa_prod = new WhatsApp({
  engine: new FileEngine(".baileys/produccion"),
});

const wa_dev = new WhatsApp({
  engine: new FileEngine(".baileys/desarrollo"),
});
```

> **Backup:** Puedes hacer backup copiando el directorio completo.

> **Permisos:** Asegurate de tener permisos de escritura en el directorio.

---

## RedisEngine

Engine de persistencia con Redis. Recibe una conexion existente compatible con ioredis o redis.

### Constructor

```typescript
new RedisEngine(client: RedisClient, prefix?: string)
```

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `client` | `RedisClient` | - | Cliente Redis existente |
| `prefix` | `string` | `"wa:default"` | Prefijo para todas las keys |

### Interfaz RedisClient

Interface minima que el cliente Redis debe implementar. Compatible con ioredis y redis:

```typescript
interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string | string[]): Promise<unknown>;
  scan(cursor: number | string, ...args: unknown[]): Promise<[string, string[]]>;
}
```

### Comportamiento

- `get(key)` obtiene `{prefix}:{key}` del Redis
- `set(key, value)` establece `{prefix}:{key}` en Redis
- `set(key, null)` elimina la key exacta y usa SCAN + DEL para eliminar todas las sub-keys con patron `{prefix}:{key}/*` (cascade delete)
- `list(prefix)` usa SCAN para encontrar keys con patron `{prefix}:{prefix}*`. No garantiza orden (limitacion de Redis SCAN)

### Ejemplo con ioredis

```typescript
import Redis from "ioredis";
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";

const client = new Redis();
const engine = new RedisEngine(client, "wa:5491112345678");

const wa = new WhatsApp({ engine, phone: "5491112345678" });
```

### Ejemplo con redis

```typescript
import { createClient } from "redis";
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";

const client = createClient();
await client.connect();

const engine = new RedisEngine(client, "wa:mi-bot");
const wa = new WhatsApp({ engine });
```

> **Orden:** A diferencia de FileEngine, `list()` en RedisEngine no ordena los resultados por fecha. Redis SCAN no garantiza orden. Si necesitas orden, considera manejar la logica en tu aplicacion.

---

## Crear un Engine personalizado

Puedes crear tu propio engine para usar con MongoDB, PostgreSQL, etc.

### Ejemplo: PostgreSQL Engine

```typescript
import type { Engine } from "@arcaelas/whatsapp";
import { Pool } from "pg";

export class PostgresEngine implements Engine {
  private pool: Pool;

  constructor(connection_string: string) {
    this.pool = new Pool({ connectionString: connection_string });
  }

  async get(key: string): Promise<string | null> {
    const result = await this.pool.query(
      "SELECT data FROM storage WHERE key = $1",
      [key]
    );
    return result.rows[0]?.data ?? null;
  }

  async set(key: string, value: string | null): Promise<void> {
    if (value === null) {
      // Cascade delete: eliminar key exacta y sub-keys
      await this.pool.query(
        "DELETE FROM storage WHERE key = $1 OR key LIKE $2",
        [key, `${key}/%`]
      );
    } else {
      await this.pool.query(
        `INSERT INTO storage (key, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET data = $2, updated_at = NOW()`,
        [key, value]
      );
    }
  }

  async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT key FROM storage
       WHERE key LIKE $1
       ORDER BY updated_at DESC
       OFFSET $2 LIMIT $3`,
      [`${prefix}%`, offset, limit]
    );
    return result.rows.map(r => r.key);
  }
}
```

### Schema SQL

```sql
CREATE TABLE storage (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_storage_prefix ON storage (key text_pattern_ops);
CREATE INDEX idx_storage_updated ON storage (updated_at DESC);
```

---

## Ejemplo: Memory Engine (para testing)

```typescript
import type { Engine } from "@arcaelas/whatsapp";

export class MemoryEngine implements Engine {
  private store = new Map<string, { data: string; time: number }>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key)?.data ?? null;
  }

  async set(key: string, value: string | null): Promise<void> {
    if (value === null) {
      // Cascade delete
      this.store.delete(key);
      for (const k of this.store.keys()) {
        if (k.startsWith(`${key}/`)) this.store.delete(k);
      }
    } else {
      this.store.set(key, { data: value, time: Date.now() });
    }
  }

  async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
    const keys = [...this.store.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .sort((a, b) => b[1].time - a[1].time)
      .map(([k]) => k);
    return keys.slice(offset, offset + limit);
  }
}
```

> **Solo para testing:** Los datos se pierden al reiniciar. Deberas escanear el QR nuevamente.

---

## Comparacion de Engines

| Caracteristica | FileEngine | RedisEngine | PostgreSQL | Memory |
|---------------|------------|-------------|------------|--------|
| Persistencia | Si | Si | Si | No |
| Escalabilidad | Baja | Alta | Alta | N/A |
| Latencia | Baja | Muy baja | Media | Muy baja |
| Multi-instancia | No | Si | Si | No |
| Orden en list() | Por mtime | Sin garantia | Por updated_at | Por tiempo |
| Ideal para | Desarrollo | Cache + Prod | Produccion | Testing |

---

## Notas

> **Serializacion:** Todos los valores se almacenan como texto. Usa `JSON.stringify()` para objetos y `BufferJSON` de Baileys para datos binarios.

> **BufferJSON:** Baileys incluye `BufferJSON.replacer` y `BufferJSON.reviver` para serializar/deserializar Buffers como base64 en JSON.

> **Cascade delete critico:** Las implementaciones custom DEBEN soportar cascade delete en `set(key, null)`. Si solo eliminan la key exacta, la eliminacion de chats y mensajes dejara datos huerfanos en el engine.
