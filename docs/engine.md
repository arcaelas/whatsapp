# Engine

Documentación del sistema de persistencia para `@arcaelas/whatsapp`.

---

## Interface

Un Engine debe implementar la siguiente interface:

```typescript
interface Engine {
    /**
     * @description Obtiene un valor por su key.
     * @param key Ruta del documento.
     * @returns Texto JSON o null si no existe.
     */
    get(key: string): Promise<string | null>;

    /**
     * @description Guarda o elimina un valor.
     * @param key Ruta del documento.
     * @param value Texto a guardar o null para eliminar.
     */
    set(key: string, value: string | null): Promise<void>;

    /**
     * @description Lista keys bajo un prefijo, ordenados por más reciente.
     * @param prefix Prefijo de búsqueda.
     * @param offset Inicio de paginación (default: 0).
     * @param limit Cantidad máxima (default: 50).
     * @returns Array de keys.
     */
    list(prefix: string, offset?: number, limit?: number): Promise<string[]>;
}
```

### Contratos

| Método | Comportamiento Esperado |
|--------|------------------------|
| `get(key)` | Retorna `string` si existe, `null` si no existe |
| `set(key, value)` | Si `value` es `null`, elimina la key |
| `set(key, value)` | Si `value` es `string`, crea/actualiza |
| `list(prefix)` | Retorna keys que comienzan con `prefix` |
| `list(prefix)` | Orden descendente por fecha de modificación |

---

## Namespaces

El sistema usa 4 namespaces principales:

| Namespace | Descripción | Ejemplo Key |
|-----------|-------------|-------------|
| `session` | Credenciales y estado de conexión | `session/creds` |
| `contact` | Información de contactos | `contact/{jid}/index` |
| `chat` | Conversaciones y metadata | `chat/{jid}/index` |
| `message` | Mensajes dentro de chats | `chat/{cid}/message/{id}/index` |

---

## Estructura de Keys

### Session

Estado de autenticación y conexión.

```
session/creds              → Credenciales de autenticación
session/app-state-sync-key-{id}  → Keys de sincronización
session/app-state-sync-version-{name}  → Versiones de estado
session/sender-key-{jid}   → Keys de cifrado por contacto
session/sender-key-memory-{jid}  → Memoria de keys
session/pre-key-{id}       → Pre-keys
session/session-{jid}      → Sesiones de cifrado
```

**Formato**: JSON serializado con `BufferJSON` para manejar binarios.

### Contact

Información de contactos.

```
contact/{jid}/index        → JSON con datos del contacto
```

**Ejemplo**:
```json
{
    "id": "584144709840@s.whatsapp.net",
    "name": "Juan Pérez",
    "photo": "https://pps.whatsapp.net/...",
    "phone": "584144709840",
    "content": "Disponible 24/7",
    "raw": { /* objeto raw completo */ }
}
```

### Chat

Conversaciones y sus índices de mensajes.

```
chat/{jid}/index           → JSON con datos del chat
chat/{jid}/messages        → Índice de mensajes (ver Relaciones)
```

**Ejemplo `chat/{jid}/index`**:
```json
{
    "id": "120363123456789@g.us",
    "type": "group",
    "name": "Equipo Dev",
    "content": "Descripción del grupo",
    "pined": true,
    "archived": false,
    "muted": false,
    "readed": true,
    "readonly": false,
    "labels": ["trabajo"],
    "raw": { /* objeto raw completo */ }
}
```

### Message

Mensajes separados en metadata, contenido y raw.

```
chat/{cid}/message/{id}/index    → JSON con metadata
chat/{cid}/message/{id}/content  → Buffer base64 (media)
chat/{cid}/message/{id}/raw      → JSON raw completo
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
    "caption": ""
}
```

---

## Relaciones

### Problema

En bases de datos relacionales, la relación `Message → Chat` es simple:
```sql
SELECT * FROM messages WHERE cid = ?;
```

En key-value stores, listar mensajes requiere escanear todas las keys:
```
SCAN chat/{cid}/message/*/index
```

Esto es ineficiente para:
- Paginación ordenada por fecha
- Contar mensajes sin cargarlos
- Obtener últimos N mensajes

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

Estas operaciones están implementadas como métodos estáticos de la clase `Chat`:

**Agregar mensaje** (`Chat.add_message`):
```typescript
await wa.Chat.add_message(cid, mid, timestamp);
```

**Listar mensajes (paginado)** (`Chat.list_messages`):
```typescript
const ids = await wa.Chat.list_messages(cid, offset, limit);
```

**Eliminar mensaje del índice** (`Chat.remove_message`):
```typescript
await wa.Chat.remove_message(cid, mid);
```

**Contar mensajes** (`Chat.count_messages`):
```typescript
const count = await wa.Chat.count_messages(cid);
```

### Ventajas

| Aspecto | Sin Índice | Con Índice |
|---------|-----------|------------|
| Listar mensajes | SCAN + parse JSON | Split líneas |
| Paginar | Cargar todos | Slice directo |
| Contar | Cargar todos | Count líneas |
| Ordenar | Sort en memoria | Ya ordenado |
| Último mensaje | Cargar todos | Primera línea |

---

## Cascade Delete

Al eliminar una entidad, eliminar todas sus dependencias.

### Eliminar Contacto

```typescript
// Solo elimina el índice del contacto
await wa.engine.set(`contact/${jid}/index`, null);
```

### Eliminar Chat

Usa el método `Chat.cascade_delete()` que elimina el chat y todos sus mensajes:

```typescript
await wa.Chat.cascade_delete(cid);
```

Internamente ejecuta:
1. Lee `chat/{cid}/messages` para obtener IDs
2. Elimina `chat/{cid}/message/{mid}/index`, `/content`, `/raw` para cada mensaje
3. Elimina `chat/{cid}/messages`
4. Elimina `chat/{cid}/index`

### Eliminar Mensaje

Usa el método `Message.remove()` que elimina del índice y storage:

```typescript
await wa.Message.remove(cid, mid);
```

---

## Implementación de Engines

### FileEngine

Almacena cada key como archivo en el filesystem.

```
.baileys/{session}/
├── session/
│   └── creds
├── contact/
│   └── 584144709840_at_s.whatsapp.net/
│       └── index
└── chat/
    └── 584144709840_at_s.whatsapp.net/
        ├── index
        ├── messages
        └── message/
            └── AC07DE.../
                ├── index
                ├── content
                └── raw
```

**Consideraciones**:
- Sanitizar `@` → `_at_` para paths válidos
- Crear directorios recursivamente
- Ordenar por `mtime` del filesystem

### RedisEngine

Usa Redis como backend.

```
wa:{session}:session/creds
wa:{session}:contact/{jid}/index
wa:{session}:chat/{jid}/index
wa:{session}:chat/{jid}/messages
wa:{session}:chat/{cid}/message/{id}/index
```

**Consideraciones**:
- Prefijo por sesión para multi-tenant
- SCAN para listar keys
- No hay orden nativo, depende del índice de mensajes

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
            await this._pool.query(
                'DELETE FROM kv_store WHERE session = $1 AND key = $2',
                [this._session, key]
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

| Key Pattern | Tipo | Descripción |
|-------------|------|-------------|
| `session/*` | JSON | Credenciales y estado |
| `contact/{jid}/index` | JSON | Datos del contacto |
| `chat/{jid}/index` | JSON | Datos del chat |
| `chat/{jid}/messages` | TXT | Índice `{TS} {ID}\n` |
| `chat/{cid}/message/{id}/index` | JSON | Metadata del mensaje |
| `chat/{cid}/message/{id}/content` | Base64 | Contenido binario |
| `chat/{cid}/message/{id}/raw` | JSON | Objeto raw completo |

---

## Optimizaciones

### Batch Operations

Para operaciones masivas, considerar métodos batch:

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
