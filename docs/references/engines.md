# Engines de Persistencia

Los engines determinan donde se almacenan la sesion, contactos, chats y mensajes.

---

## Importacion

```typescript
import { Engine, FileEngine } from "@arcaelas/whatsapp";
```

---

## Arquitectura

El sistema de persistencia usa un patron simple:

```
WhatsApp -> Engine (FileEngine o custom)
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

Guarda o elimina un valor.

```typescript
// Guardar
await engine.set("contact/123/index", JSON.stringify({ name: "John" }));

// Eliminar (pasar null)
await engine.set("contact/123/index", null);
```

#### `list(prefix, offset?, limit?)`

Lista keys bajo un prefijo, ordenados por mas reciente.

```typescript
// Listar contactos
const keys = await engine.list("contact/", 0, 50);
for (const key of keys) {
  const data = await engine.get(key);
  console.log(key, data);
}
```

### Estructura de keys

Los keys siguen una convencion de paths:

| Tipo | Patron | Ejemplo |
|------|--------|---------|
| Session | `session/{key}` | `session/creds` |
| Signal keys | `session/{type}/{id}` | `session/pre-key/1` |
| Contact | `contact/{jid}/index` | `contact/5491112345678@s.whatsapp.net/index` |
| Chat | `chat/{jid}/index` | `chat/5491112345678@s.whatsapp.net/index` |
| Message | `chat/{cid}/message/{mid}/index` | `chat/123@s.whatsapp.net/message/ABC123/index` |
| Content | `chat/{cid}/message/{mid}/content` | `chat/123@s.whatsapp.net/message/ABC123/content` |

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
      message/
        ABC123/
          index        # Mensaje JSON
          content      # Contenido (base64 para media)
```

!!! note "Sanitizacion de keys"
    El caracter `@` se reemplaza por `_at_` en los nombres de archivos
    para compatibilidad con sistemas de archivos.

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

### Notas

!!! tip "Backup"
    Puedes hacer backup copiando el directorio completo.

!!! warning "Permisos"
    Asegurate de tener permisos de escritura en el directorio.

---

## Crear un Engine personalizado

Puedes crear tu propio engine para usar con Redis, MongoDB, PostgreSQL, etc.

### Ejemplo: Redis Engine

```typescript
import type { Engine } from "@arcaelas/whatsapp";
import { createClient } from "redis";

export class RedisEngine implements Engine {
  private client: ReturnType<typeof createClient>;

  constructor(url: string) {
    this.client = createClient({ url });
  }

  async connect() {
    await this.client.connect();
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async set(key: string, value: string | null): Promise<void> {
    if (value === null) {
      await this.client.del(key);
    } else {
      await this.client.set(key, value);
    }
  }

  async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
    const keys = await this.client.keys(`${prefix}*`);
    return keys.slice(offset, offset + limit);
  }
}
```

### Uso

```typescript
import { WhatsApp } from "@arcaelas/whatsapp";
import { RedisEngine } from "./RedisEngine";

const engine = new RedisEngine("redis://localhost:6379");
await engine.connect();

const wa = new WhatsApp({ engine });
```

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
      await this.pool.query("DELETE FROM storage WHERE key = $1", [key]);
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
      this.store.delete(key);
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

!!! warning "Solo para testing"
    Los datos se pierden al reiniciar. Deberas escanear el QR nuevamente.

---

## Comparacion de Engines

| Caracteristica | FileEngine | Redis | PostgreSQL | Memory |
|---------------|------------|-------|------------|--------|
| Persistencia | Si | Si | Si | No |
| Escalabilidad | Baja | Alta | Alta | N/A |
| Latencia | Baja | Muy baja | Media | Muy baja |
| Multi-instancia | No | Si | Si | No |
| Ideal para | Desarrollo | Cache + Prod | Produccion | Testing |

---

## Notas

!!! info "Serializacion"
    Todos los valores se almacenan como texto. Usa `JSON.stringify()` para
    objetos y `BufferJSON` de Baileys para datos binarios.

!!! tip "BufferJSON"
    Baileys incluye `BufferJSON.replacer` y `BufferJSON.reviver` para
    serializar/deserializar Buffers como base64 en JSON.
