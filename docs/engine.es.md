# Engine

Documentación del sistema de persistencia para `@arcaelas/whatsapp`.

---

## Interfaz

Un Engine debe implementar la siguiente interfaz:

```typescript
interface Engine {
    /**
     * @description Retrieves a value by its key.
     * @param key Document path.
     * @returns JSON text or null if not found.
     */
    get(key: string): Promise<string | null>;

    /**
     * @description Saves or deletes a value.
     * If value is null, deletes the key and all sub-keys recursively (cascade delete).
     * @param key Document path.
     * @param value Text to save or null to delete recursively.
     */
    set(key: string, value: string | null): Promise<void>;

    /**
     * @description Lists keys under a prefix, ordered by most recent.
     * @param prefix Search prefix.
     * @param offset Pagination start (default: 0).
     * @param limit Maximum count (default: 50).
     * @returns Array of keys.
     */
    list(prefix: string, offset?: number, limit?: number): Promise<string[]>;
}
```

### Contratos

| Metodo | Comportamiento Esperado |
|--------|-------------------|
| `get(key)` | Retorna `string` si existe, `null` si no |
| `set(key, value)` | Si `value` es `null`, elimina la key Y todas las sub-keys recursivamente |
| `set(key, value)` | Si `value` es `string`, crea/actualiza |
| `list(prefix)` | Retorna keys que comienzan con `prefix` |
| `list(prefix)` | Orden descendente por fecha de modificación |

---

## Namespaces

El sistema utiliza 3 namespaces:

| Namespace | Descripcion | Ejemplo de Key |
|-----------|-------------|-------------|
| `session` | Credenciales y estado de conexión | `session/creds`, `session/{type}/{id}` |
| `contact` | Información de contactos | `contact/{jid}/index` |
| `chat` | Conversaciones, metadatos y mensajes | `chat/{jid}/index`, `chat/{cid}/message/{id}/index` |

Adicionalmente, existe un namespace de índice inverso:

| Key | Descripcion |
|-----|-------------|
| `lid/{lid}` | Mapea un LID a un JID para búsqueda de contactos |

---

## Estructura de Keys

### Session

Autenticación y estado de conexión.

```
session/creds                          -> Authentication credentials
session/app-state-sync-key/{id}        -> Sync keys
session/app-state-sync-version/{name}  -> State versions
session/sender-key/{jid}               -> Encryption keys per contact
session/sender-key-memory/{jid}        -> Key memory
session/pre-key/{id}                   -> Pre-keys
session/session/{jid}                  -> Encryption sessions
```

**Formato**: JSON serializado con `BufferJSON` para manejar binarios.

### Contact

Información de contactos.

```
contact/{jid}/index        -> JSON with contact data (IContactRaw)
```

**Ejemplo**:
```json
{
    "id": "584144709840@s.whatsapp.net",
    "lid": "140913951141911@lid",
    "name": "Juan Perez",
    "notify": "Juanito",
    "verifiedName": null,
    "imgUrl": "https://pps.whatsapp.net/...",
    "status": "Available 24/7"
}
```

### LID Reverse Index

```
lid/{lid}                  -> JID string (e.g. "584144709840@s.whatsapp.net")
```

### Chat

Conversaciones e índices de sus mensajes.

```
chat/{jid}/index           -> JSON with chat data (IChatRaw)
chat/{jid}/messages        -> Message index (see Relationships)
```

**Ejemplo `chat/{jid}/index`**:
```json
{
    "id": "120363123456789@g.us",
    "name": "Dev Team",
    "displayName": null,
    "description": "Group description",
    "unreadCount": 5,
    "readOnly": false,
    "archived": false,
    "pinned": 1767371367857,
    "muteEndTime": null,
    "markedAsUnread": false,
    "participant": [
        { "id": "584144709840@s.whatsapp.net", "admin": "superadmin" },
        { "id": "584121234567@s.whatsapp.net", "admin": null }
    ],
    "createdBy": "584144709840@s.whatsapp.net",
    "createdAt": 1700000000,
    "ephemeralExpiration": 604800
}
```

### Mensaje

Mensajes separados en metadatos, contenido y raw.

```
chat/{cid}/message/{id}/index    -> JSON with metadata (IMessageIndex)
chat/{cid}/message/{id}/content  -> Buffer base64 (media)
chat/{cid}/message/{id}/raw      -> Full raw JSON (WAMessage)
```

**Ejemplo `chat/{cid}/message/{id}/index`**:
```json
{
    "id": "AC07DE0D18FA8254897A26C90B2FFD98",
    "cid": "584144709840@s.whatsapp.net",
    "mid": null,
    "me": false,
    "type": "text",
    "author": "584144709840@s.whatsapp.net",
    "status": 4,
    "starred": false,
    "forwarded": false,
    "created_at": 1767366759000,
    "deleted_at": null,
    "mime": "text/plain",
    "caption": "",
    "edited": false
}
```

---

## Relaciones

### Problema

En bases de datos relacionales, la relación `Mensaje -> Chat` es simple:
```sql
SELECT * FROM messages WHERE cid = ?;
```

En key-value stores, listar mensajes requiere escanear todas las keys:
```
SCAN chat/{cid}/message/*/index
```

Esto es ineficiente para:
- Orden paginado por fecha
- Contar mensajes sin cargarlos
- Obtener los últimos N mensajes

### Solución: Índice de Mensajes

Cada chat mantiene un índice de sus mensajes:

```
chat/{cid}/messages
```

**Formato**: Texto plano con una línea por mensaje:
```
{TIMESTAMP} {MESSAGE_ID}
{TIMESTAMP} {MESSAGE_ID}
...
```

**Ejemplo**:
```
1767366759000 AC07DE0D18FA8254897A26C90B2FFD98
1767366758000 BC18EF1D29GB9365908B37D01C3GGE09
1767366757000 CC29FG2E30HC0476019C48E12D4HHF10
```

### Operaciones

Estas operaciones están disponibles a través de la API de la clase Message:

**Listar mensajes (paginado)** (`Message.list`):
```typescript
const messages = await wa.Message.list(cid, offset, limit);
```

**Contar mensajes** (`Message.count`):
```typescript
const count = await wa.Message.count(cid);
```

**Eliminar un mensaje** (método de instancia `msg.remove()`):
```typescript
const msg = await wa.Message.get(cid, mid);
if (msg) await msg.remove();
```

### Ventajas

| Aspecto | Sin Índice | Con Índice |
|--------|--------------|------------|
| Listar mensajes | SCAN + parse JSON | Split lines |
| Paginar | Cargar todos | Slice directo |
| Contar | Cargar todos | Contar líneas |
| Ordenar | Sort en memoria | Ya ordenado |
| Último mensaje | Cargar todos | Primera línea |

---

## Cascade Delete

Al eliminar una entidad, se eliminan todas sus dependencias.

### Cómo funciona

El contrato de `set(key, null)` requiere que cuando `value` es `null`, el engine elimina tanto la key misma como todas las sub-keys con ese prefix recursivamente. Así es como funciona el cascade delete.

### Eliminar Contact

```typescript
// Solo elimina el índice del contacto
await wa.engine.set("contact/{jid}/index", null);
```

### Eliminar Chat

Usa `Chat.remove(cid)` (estático) o `chat.remove()` (instancia). Esto llama a `wa.engine.set("chat/{cid}", null)` que cascade-elimina el índice del chat, el índice de mensajes y todos los datos de mensajes:

```typescript
// Estático
await wa.Chat.remove(cid);

// O via instancia
const chat = await wa.Chat.get(cid);
if (chat) await chat.remove();
```

El cascade delete del engine en `set("chat/{cid}", null)` elimina:
1. `chat/{cid}/index`
2. `chat/{cid}/messages`
3. `chat/{cid}/message/{mid}/index`, `/content`, `/raw` para cada mensaje

### Eliminar Mensaje

Usa el método de instancia `msg.remove()`:

```typescript
const msg = await wa.Message.get(cid, mid);
if (msg) await msg.remove();
```

Esto elimina el mensaje del índice y llama a `wa.engine.set("chat/{cid}/message/{mid}", null)` que cascade-elimina `/index`, `/content` y `/raw`.

---

## Implementaciones de Engine

### FileEngine

Almacena cada key como un archivo en el filesystem.

```
.baileys/{session}/
|-- session/
|   |-- creds
|   |-- app-state-sync-key/
|   |   +-- {id}
|   +-- ...
|-- lid/
|   +-- {lid}
|-- contact/
|   +-- 584144709840_at_s.whatsapp.net/
|       +-- index
+-- chat/
    +-- 584144709840_at_s.whatsapp.net/
        |-- index
        |-- messages
        +-- message/
            +-- AC07DE.../
                |-- index
                |-- content
                +-- raw
```

**Consideraciones**:
- Sanitizar `@` -> `_at_` para paths válidos
- Crear directorios recursivamente
- Ordenar por `mtime` del filesystem
- `set(key, null)` usa `rm -rf` para cascade delete

### RedisEngine

Usa Redis como backend. Incluido en la librería como export oficial.

```
wa:{session}:session/creds
wa:{session}:contact/{jid}/index
wa:{session}:chat/{jid}/index
wa:{session}:chat/{jid}/messages
wa:{session}:chat/{cid}/message/{id}/index
wa:{session}:chat/{cid}/message/{id}/raw
wa:{session}:chat/{cid}/message/{id}/content
wa:{session}:lid/{lid}
```

**Consideraciones**:
- Prefix por session para multi-tenant
- Usa SCAN (no KEYS) para listing -- non-blocking
- `set(key, null)` escanea y elimina todas las sub-keys que coincidan con `{key}/*` para cascade delete
- Sin orden nativo, depende del índice de mensajes

### PostgreSQL Engine (Ejemplo)

```typescript
class PostgresEngine implements Engine {
    constructor(private readonly _pool: Pool, private readonly _session: string) {}

    async get(key: string): Promise<string | null> {
        const { rows } = await this._pool.query(
            'SELECT value FROM kv_store WHERE session = $1 AND key = $2',
            [this._session, key]
        );
        return rows[0]?.value ?? null;
    }

    async set(key: string, value: string | null): Promise<void> {
        if (value) {
            await this._pool.query(
                `INSERT INTO kv_store (session, key, value, updated_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (session, key) DO UPDATE SET value = $3, updated_at = NOW()`,
                [this._session, key, value]
            );
        } else {
            // Cascade delete: delete exact key AND all sub-keys
            await this._pool.query(
                'DELETE FROM kv_store WHERE session = $1 AND (key = $2 OR key LIKE $3)',
                [this._session, key, key + '/%']
            );
        }
    }

    async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
        const { rows } = await this._pool.query(
            `SELECT key FROM kv_store
             WHERE session = $1 AND key LIKE $2
             ORDER BY updated_at DESC
             LIMIT $3 OFFSET $4`,
            [this._session, prefix + '%', limit, offset]
        );
        return rows.map(r => r.key);
    }
}
```

**Tabla requerida**:
```sql
CREATE TABLE kv_store (
    session VARCHAR(100) NOT NULL,
    key VARCHAR(500) NOT NULL,
    value TEXT,
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (session, key)
);

CREATE INDEX idx_kv_prefix ON kv_store (session, key varchar_pattern_ops);
CREATE INDEX idx_kv_updated ON kv_store (session, updated_at DESC);
```

---

## Resumen de Keys

| Patrón de Key | Tipo | Descripcion |
|-------------|------|-------------|
| `session/creds` | JSON | Credenciales de autenticación |
| `session/{type}/{id}` | JSON | Keys del protocolo Signal |
| `lid/{lid}` | Text | Índice inverso LID -> JID |
| `contact/{jid}/index` | JSON | Datos de contacto (IContactRaw) |
| `chat/{jid}/index` | JSON | Datos de chat (IChatRaw) |
| `chat/{jid}/messages` | TXT | Índice `{TS} {ID}\n` |
| `chat/{cid}/message/{id}/index` | JSON | Metadatos de mensaje (IMessageIndex) |
| `chat/{cid}/message/{id}/content` | Base64 | Contenido binario |
| `chat/{cid}/message/{id}/raw` | JSON | WAMessage raw completo |

---

## Optimizaciones

### Operaciones en Batch

Para operaciones en bulk, considera métodos de batch:

```typescript
interface EngineBatch extends Engine {
    set_batch(entries: Array<[key: string, value: string | null]>): Promise<void>;
}
```

### TTL (Time-To-Live)

Para mensajes efímeros:

```typescript
interface EngineTTL extends Engine {
    set_ttl(key: string, value: string, ttl_seconds: number): Promise<void>;
}
```

### Prefix Delete

Para cascade delete eficiente:

```typescript
interface EnginePrefix extends Engine {
    delete_prefix(prefix: string): Promise<number>;
}
```

**Implementación Redis**:
```typescript
async delete_prefix(prefix: string): Promise<number> {
    let count = 0;
    let cursor = '0';
    do {
        const [next, keys] = await this._client.scan(cursor, 'MATCH', `${this._prefix}:${prefix}*`);
        cursor = next;
        if (keys.length) {
            await this._client.del(...keys);
            count += keys.length;
        }
    } while (cursor !== '0');
    return count;
}
```
