# API Interna

## Ciclo de Vida

```typescript
const wa = new WhatsApp({ phone: "56962816490" })
```

**Inicializacion**: El constructor prepara configuracion, store, factories y listeners internos. No hay conexion.

```typescript
await wa.pair(code => console.log("Codigo: %s", code))
```

**Conexion**: Establece conexion con WhatsApp. Callback solo se ejecuta si necesita autenticacion. Resuelve cuando `connection: 'open'`.

```typescript
// Ya operativo: wa.on("message"), wa.Chat.text(), etc.
```

**Listo**: Puedes enviar/recibir mensajes inmediatamente.

```typescript
await wa.sync(percent => console.log("%s%", percent))
```

**Sincronizacion (opcional)**: Espera hasta `progress === 100`. Util para garantizar historial completo.

| Fase | Metodo | Efecto |
|------|--------|--------|
| 1 | `new WhatsApp()` | Configura instancia, sin conexion |
| 2 | `pair()` | Conecta, resuelve al abrir |
| 3 | (listo) | Mensajes en tiempo real |
| 4 | `sync()` | Bloquea hasta historial completo |

---

## Class WhatsApp

##### Configuracion

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `phone` | `string` | Numero para auth por codigo (opcional) |
| `engine` | `Engine` | Engine de persistencia (default: FileStore) |

##### Retorno

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `Contact` | `class` | Clase vinculada a esta conexion |
| `Chat` | `class` | Clase vinculada a esta conexion |
| `Message` | `class` | Clase vinculada a esta conexion |
| `pair` | `function` | Funcion de autenticacion |
| `sync` | `function` | Funcion de sincronizacion bloqueante |
| `on` / `off` | `function` | Suscripcion a eventos |

##### Arquitectura de Aislamiento

La clase `WhatsApp` extiende `EventEmitter<EventMap>`. Los eventos son propios, no de Baileys. Puedes suscribirte antes o despues de `pair()`.

```typescript
// whatsapp.ts
class WhatsApp extends EventEmitter<EventMap> {
  store: Store
  socket: WASocket | null = null

  constructor(options: Options) {
    super()
    this.store = new Store(options.engine ?? new FileStore()) // engine, no store

    // Factories reciben solo client (this)
    // No pasan store ni event separados, client tiene ambos
    this.Contact = contact(this)
    this.Chat = chat(this)
    this.Message = message(this)

    // Constructor se suscribe a sus propios eventos para persistir
    this.on('contact:upsert', (c) => this.store.contact.set(c))
    this.on('chat:upsert', (ch) => this.store.chat.set(ch))
    this.on('chat:deleted', (cid) => this.store.chat.delete(cid))
    this.on('message:created', async (m) => {
      this.store.message.set(m)
      const buffer = await m.content()
      if (buffer.length) this.store.content.set(m.cid, m.id, buffer)
    })
    this.on('message:status', (m) => this.store.message.set(m))
    this.on('message:updated', (m) => this.store.message.set(m))
    this.on('message:deleted', ({ cid, mid }) => this.store.message.delete(cid, mid))
  }
}
```

##### Patron Factory

Cada entidad exporta una funcion que recibe `client` (la instancia WhatsApp) y retorna la clase:

```typescript
// contact.ts
export function contact(client: WhatsApp) {
  return class Contact {
    readonly id: string
    readonly name: string
    // ...

    constructor(data: ContactData) {
      Object.assign(this, data)
    }

    // Estaticos usan closure sobre client
    static async get(uid: string) {
      const data = await client.store.contact.get(uid)
      return data ? new Contact(data) : null
    }

    // Instancia tambien usa closure
    async chat() {
      return client.Chat.get(this.id)
    }
  }
}
```

##### Responsabilidades

| Componente | Tipo | Responsabilidad | Toca Baileys |
|------------|------|-----------------|--------------|
| `WhatsApp` | class extends EventEmitter | Store, factories, listeners propios | No |
| `pair()` | metodo | Conecta, transforma eventos Baileys → propios | **Si** |
| `sync()` | metodo | Escucha evento `progress`, resuelve al 100% | No |
| `Store` | class (interno) | Envuelve Engine, expone metodos tipados | No |
| `Engine` | interface | Contrato para el usuario: solo `get` y `set` | No |
| `contact/chat/message` | function | Factory que recibe `client` y retorna clase | No |

##### Beneficios

| Aspecto | Comportamiento |
|---------|----------------|
| Multiples clientes | Cada `new WhatsApp()` genera clases con su propio store/event |
| Codigo limpio | Solo 2 lineas extra por archivo (funcion + cierre) |
| Clase completa | Estaticos + instancia funcionan con el closure |
| Sin globals | Todo vive en el contexto de la instancia |

##### Eventos Internos (EventEmitter propio)

| Evento | Payload | Descripcion |
|--------|---------|-------------|
| `open` | `void` | Conexion establecida |
| `close` | `void` | Conexion cerrada |
| `progress` | `number` | Progreso de sincronizacion (0-100) |
| `error` | `Error` | Error de conexion o autenticacion |
| | | |
| `contact:upsert` | `Contact` | Contacto nuevo o actualizado |
| | | |
| `chat:upsert` | `Chat` | Chat nuevo o actualizado |
| `chat:deleted` | `string` | ID del chat eliminado |
| | | |
| `message:created` | `Message` | Mensaje nuevo |
| `message:status` | `Message` | Cambio de estado (pending→sent→delivered→read) |
| `message:updated` | `Message` | Mensaje editado |
| `message:deleted` | `{ cid, mid }` | Mensaje eliminado |
| `message:reaction` | `Message` | Reaccion emoji al mensaje |

##### Funcion pair(callback)

**Principio fundamental:** `pair()` es el **unico** punto de contacto con Baileys. Recibe TODOS los eventos de Baileys, los transforma a instancias propias y los emite con `this.emit()`. No persiste nada directamente, el constructor se encarga via sus propios listeners.

##### Eventos Baileys (solo en pair)

| Evento Baileys | Schema | Evento Emitido |
|----------------|--------|----------------|
| `connection.update` | `{ connection, qr }` | `open` / `close` / `error` |
| `messaging-history.set` | `{ chats, contacts, messages, progress, isLatest }` | `progress`, `contact:upsert`, `chat:upsert`, `message:created` |
| `contacts.upsert` | `[Contact]` | `contact:upsert` |
| `contacts.update` | `[Partial<Contact>]` | `contact:upsert` |
| `chats.upsert` | `[Chat]` | `chat:upsert` |
| `chats.update` | `[Partial<Chat>]` | `chat:upsert` (merge con existente) |
| `chats.delete` | `[string]` | `chat:deleted` |
| `messages.upsert` | `{ messages: [WAMessage] }` | `message:created` |
| `messages.update` | `[{ key, update }]` | `message:status` o `message:updated` (segun contenido) |
| `messages.delete` | `{ keys: [MessageKey] }` | `message:deleted` |
| `messages.reaction` | `[{ key, reaction }]` | `message:reaction` |

##### Flujo Interno

```typescript
async function pair(callback?: (qr: Buffer) | (code: string) => void): Promise<void> {
  const promise = promify<void>()

  // Crear socket de Baileys
  const socket = makeWASocket({
    auth: await this.store.document.get('session/creds'),
    syncFullHistory: true,
    // ... otras opciones
  })
  this.socket = socket

  // Escuchar eventos de Baileys y emitir eventos propios
  socket.ev.on('connection.update', async ({ connection, qr }) => {
    if (connection === 'open') {
      this.emit('open')
      promise.resolve()
      return
    }

    if (connection === 'close') {
      this.socket = null
      this.emit('close')
      return
    }

    // Manejar autenticacion
    if (qr && callback) {
      if (this._phone) {
        const code = await socket.requestPairingCode(this._phone)
        callback(code)
      } else {
        const buffer = await QRCode.toBuffer(qr)
        callback(buffer)
      }
    }
  })

  // Transformar eventos Baileys → eventos propios
  socket.ev.on('messaging-history.set', ({ contacts, chats, messages, progress, isLatest }) => {
    contacts.forEach(c => this.emit('contact:upsert', new this.Contact(c)))
    chats.forEach(ch => this.emit('chat:upsert', new this.Chat(ch)))
    messages.forEach(m => this._emit_message(m, 'message:created'))
    this.emit('progress', isLatest ? 100 : (progress ?? 0))
  })

  socket.ev.on('contacts.upsert', (contacts) => {
    contacts.forEach(c => this.emit('contact:upsert', new this.Contact(c)))
  })

  socket.ev.on('contacts.update', (contacts) => {
    contacts.forEach(c => this.emit('contact:upsert', new this.Contact(c)))
  })

  socket.ev.on('chats.upsert', (chats) => {
    chats.forEach(ch => this.emit('chat:upsert', new this.Chat(ch)))
  })

  socket.ev.on('chats.update', (chats) => {
    chats.forEach(ch => this.emit('chat:upsert', new this.Chat(ch)))
  })

  socket.ev.on('chats.delete', (ids) => {
    ids.forEach(cid => this.emit('chat:deleted', cid))
  })

  socket.ev.on('messages.upsert', ({ messages }) => {
    messages.forEach(m => this._emit_message(m, 'message:created'))
  })

  socket.ev.on('messages.update', (updates) => {
    updates.forEach(({ key, update }) => {
      const event = update.edit ? 'message:updated' : 'message:status'
      this._emit_message_update(key, update, event)
    })
  })

  socket.ev.on('messages.delete', ({ keys }) => {
    keys.forEach(k => this.emit('message:deleted', { cid: k.remoteJid, mid: k.id }))
  })

  socket.ev.on('messages.reaction', (reactions) => {
    reactions.forEach(r => this._emit_message_reaction(r))
  })

  // ... otros eventos Baileys

  return promise
}

// Metodo interno: transforma WAMessage y virtualiza content()
private _emit_message(raw: WAMessage) {
  const instance = new this.Message(raw)
  const buffer = await downloadMediaMessage(raw) // o extraer texto/location/poll

  // Reemplazar content() con funcion que retorna buffer en memoria
  instance.content = async () => buffer

  this.emit('message', instance)
}
```

##### Puntos Clave

| Aspecto | Comportamiento |
|---------|----------------|
| Sin llamar `pair()` | No hay conexion, socket no existe |
| Sesion existente | `connection.update` emite `open` inmediatamente, callback no se ejecuta |
| Modo QR | Callback recibe `Buffer` cada ~20s hasta escanear |
| Modo Code | Callback recibe `string` una sola vez |
| `await callback()` | Permite al usuario guardar QR, mostrar en UI, etc. antes de continuar |
| Promesa resuelta | `pair()` termina, conexion establecida |

**Dependencia:** Requiere libreria `qrcode` para convertir string CSV a Buffer PNG.

##### Funcion sync(callback)

Bloquea hasta que la sincronizacion de WhatsApp termine. Escucha el evento `progress` y resuelve cuando llega a 100.

```typescript
async function sync(callback?: (progress: number) => void): Promise<void> {
  const promise = promify<void>()

  const handler = (percent: number) => {
    callback?.(percent)

    // Resolver cuando llega a 100
    if (percent === 100) {
      this.off('progress', handler)
      promise.resolve()
    }
  }

  this.on('progress', handler)
  return promise
}
```

##### Puntos Clave

| Aspecto | Comportamiento |
|---------|----------------|
| Sin llamar `sync()` | El evento `progress` se emite pero no hay bloqueo |
| Con callback | Recibe 0-100 en cada emision de `progress` |
| Sin callback | Solo bloquea hasta `progress === 100` |
| Persistencia | El constructor se suscribe a eventos y persiste automaticamente |

##### Virtualizacion de content()

El metodo `_emit_message()` reemplaza el `content()` de cada mensaje con una funcion que retorna el buffer directamente desde memoria:

```typescript
// En lugar de:
instance.content = async () => this.store.content.get(cid, mid) // Acceso a store

// Se hace:
const buffer = await downloadMediaMessage(raw) // Descargar una vez
instance.content = async () => buffer // Retornar desde memoria
```

**Beneficio:** Cuando el usuario llama `msg.content()`, obtiene el buffer inmediatamente sin ir al store. El store se actualiza en paralelo via el listener del constructor.

---

## Interface Engine

##### Metodos

| Metodo | Argumentos | Retorno | Descripcion |
|--------|------------|---------|-------------|
| `get` | `(key, offset?, limit?)` | `Promise<string[]>` | Obtiene documentos por clave o namespace |
| `set` | `(key, value)` | `Promise<boolean>` | Escribe string, `null` elimina |

##### Logica de get()

El Engine detecta por la estructura de la clave:
- `contact/123` → clave especifica → array con 1 item
- `contact` → namespace → array paginado con offset/limit
- `chat/abc/message` → sub-namespace → mensajes del chat paginados

---

## Class Store

##### Arquitectura de 3 Niveles

```
Contact.get(id)
    ↓
store.contact.get(id)
    ↓ new Contact(data)
store.document.get(`contact/${id}`)
    ↓ JSON.parse(..., BufferJSON.reviver)
engine.get(`contact/${id}`)
    ↓ retorna string[]
```

##### Flujo Interno

```typescript
// Nivel 1: Engine - retorna array de strings
engine.get('contact/123') → ['{"id":"123","name":"Juan",...}']
engine.get('contact', 0, 50) → ['{"id":"1",...}', '{"id":"2",...}', ...]

// Nivel 2: document - parsea cada item con BufferJSON
store.document.get('contact/123') → [{ id: '123', name: 'Juan', ... }]
store.document.get('contact', 0, 50) → [{ id: '1', ... }, { id: '2', ... }, ...]

// Nivel 3: entidad - metodos tipados
store.contact.get('123') → ContactData | null
store.contact.find(0, 50) → ContactData[]
```

##### Implementacion Interna

```typescript
class Store {
  constructor(private engine: Engine) {}

  document = {
    get: async <T>(key: string, offset?: number, limit?: number): Promise<T[]> => {
      const items = await this.engine.get(key, offset, limit)
      return items.map(raw => JSON.parse(raw, BufferJSON.reviver))
    },
    set: async (key: string, value: any) => {
      const json = value === null ? null : JSON.stringify(value, BufferJSON.replacer)
      return this.engine.set(key, json)
    }
  }

  contact = {
    get: async (id: string) => {
      const [item] = await this.document.get(`contact/${id}`)
      return item ?? null
    },
    find: async (offset: number, limit: number) => {
      return await this.document.get('contact', offset, limit)
    },
    set: async (data: ContactData) => {
      return await this.document.set(`contact/${data.id}`, data)
    }
  }

  message = {
    get: async (cid: string, mid: string) => {
      const [item] = await this.document.get(`chat/${cid}/message/${mid}`)
      return item ?? null
    },
    find: async (cid: string, offset: number, limit: number) => {
      return await this.document.get(`chat/${cid}/message`, offset, limit)
    }
  }
}
```

##### BufferJSON

Baileys provee `BufferJSON.replacer` y `BufferJSON.reviver` para serializar/deserializar Buffers en JSON.

```typescript
// Guardar (con replacer)
const json = JSON.stringify({ data: buffer }, BufferJSON.replacer)

// Leer (con reviver)
const obj = JSON.parse(json, BufferJSON.reviver) // obj.data es Buffer
```

---

## Class Contact

##### Propiedades

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `id` | `string` | JID del contacto (`@s.whatsapp.net`) |
| `name` | `string` | Nombre publico del perfil |
| `phone` | `string` | Numero extraido del JID |
| `photo` | `string \| null` | URL de foto de perfil |
| `custom_name` | `string` | Nombre en agenda local |

##### Metodos

| Metodo | Tipo | Descripcion |
|--------|------|-------------|
| `Contact.me()` | estatico | Retorna `socket.user` parseado |
| `Contact.get(uid)` | estatico | Busca en store, retorna `null` si no existe |
| `Contact.find(offset, limit)` | estatico | Pagina contactos desde store |
| `contact.chat()` | instancia | `Chat.get(this.id)` o crea nuevo |
| `contact.rename(name)` | instancia | Actualiza `custom_name` en store |

##### Eventos Baileys → Evento `contact`

| Evento Baileys | Schema | Accion |
|----------------|--------|--------|
| `contacts.upsert` | `[{ id, name, notify, imgUrl }]` | `_emit_contact()` → emite `contact` |
| `contacts.update` | `[{ id, ...parcial }]` | `_emit_contact()` → emite `contact` |

```typescript
// Transformacion en pair()
// notify → name, imgUrl → photo ('changed' → null)
this.emit('contact', new this.Contact({ id, name, phone, photo, custom_name }))
```

##### Metodos Baileys Utilizados

| Metodo Baileys | Uso en Contact |
|----------------|----------------|
| `socket.user` | `Contact.me()` obtiene contacto propio |
| `socket.profilePictureUrl(jid, 'image')` | Obtener `photo` cuando `imgUrl === 'changed'` |

```typescript
// Contact.me()
// → parse_contact(socket.user)

// Contact.get(uid)
// → store.get(`contacts/${uid}`) → new Contact(data)
```

---

## Class Chat

##### Propiedades

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `id` | `string` | ID del chat (remoteJid) |
| `name` | `string` | Nombre del grupo o contacto |
| `photo` | `string \| null` | URL de foto de perfil |
| `phone` | `string \| null` | Numero (null en grupos) |
| `type` | `'group' \| 'contact'` | Detectado por sufijo del id |

##### Metodos

| Metodo | Tipo | Descripcion |
|--------|------|-------------|
| `Chat.get(cid)` | estatico | Busca en store |
| `Chat.find(offset, limit)` | estatico | Pagina chats desde store |
| `Chat.seen(cid, mid?)` | estatico | `socket.readMessages([messageKey])`. Sin mid usa ultimo |
| `Chat.members(cid, offset, limit)` | estatico | Grupo: `groupMetadata()`, 1-1: `[contact, me]` |
| `Chat.messages(cid, offset, limit)` | estatico | Pagina mensajes desde store |
| `Chat.text(cid, content, mid?)` | estatico | `sendMessage(cid, { text })` |
| `Chat.image(cid, buffer, mid?)` | estatico | `sendMessage(cid, { image: buffer })` |
| `Chat.video(cid, buffer, mid?)` | estatico | `sendMessage(cid, { video: buffer })` |
| `Chat.audio(cid, buffer, mid?)` | estatico | `sendMessage(cid, { audio: buffer })` |
| `Chat.location(cid, {lat, lng}, mid?)` | estatico | `sendMessage(cid, { location })` |
| `Chat.poll(cid, text, options[])` | estatico | `sendMessage(cid, { poll })` |
| `Chat.typing(cid, bool)` | estatico | `sendPresenceUpdate('composing'/'available')` |
| `Chat.recording(cid, bool)` | estatico | `sendPresenceUpdate('recording'/'available')` |

##### Eventos Baileys → Evento `chat`

| Evento Baileys | Schema | Accion |
|----------------|--------|--------|
| `chats.upsert` | `Chat[]` | `_emit_chat()` → emite `chat` |
| `chats.update` | `Partial<Chat>[]` | Merge con existente → emite `chat` |
| `chats.delete` | `string[]` | Elimina del store (no emite evento) |

```typescript
// Transformacion en pair()
// Detecta type por sufijo: @g.us → 'group', @s.whatsapp.net → 'contact'
this.emit('chat', new this.Chat({ id, name, photo, phone, type }))
```

##### Metodos Baileys Utilizados

| Metodo Baileys | Uso en Chat |
|----------------|-------------|
| `socket.sendMessage(cid, content, options)` | Enviar texto, media, location, poll |
| `socket.readMessages([keys])` | `Chat.seen()` marca como leido |
| `socket.sendPresenceUpdate(type, cid)` | `Chat.typing()` y `Chat.recording()` |
| `socket.groupMetadata(cid)` | `Chat.members()` en grupos |

```typescript
// Chat.text(cid, content, mid?)
// → sendMessage(cid, { text: content }, mid ? { quoted: message } : {})

// Chat.seen(cid)
// → readMessages([{ remoteJid: cid, id: lastMsgId }])

// Chat.typing(cid, true)
// → sendPresenceUpdate('composing', cid)

// Chat.members(cid) en grupo
// → groupMetadata(cid).participants → Contact[]

// Chat.members(cid) en 1-1
// → [Contact.get(cid), Contact.me()]
```

**Nota:** El tipo de chat se detecta por el sufijo del id: `@g.us` = grupo, `@s.whatsapp.net` = contacto.

---

## Namespaces

Los namespaces son claves estructuradas que el Store usa para organizar datos. El Engine solo ve strings, pero el Store les da semantica.

##### Estructura de Claves

| Namespace | Clave | Contenido JSON |
|-----------|-------|----------------|
| session | `session/creds`, `session/signal/{type}/{id}` | Credenciales y claves de sesion Baileys |
| contact | `contact/{id}` | `{ id, name, phone, photo, custom_name }` |
| chat | `chat/{id}` | `{ id, name, photo, phone, type }` |
| message | `chat/{cid}/message/{mid}` | `{ id, cid, uid, mid, type, mime, caption, me, status, created_at, edited }` |
| content | `chat/{cid}/message/{mid}/content` | Buffer serializado (media, location, poll) |

##### Formato de IDs

| Tipo | Formato | Ejemplo |
|------|---------|---------|
| Contact | `{phone}@s.whatsapp.net` | `5491155555555@s.whatsapp.net` |
| Grupo | `{id}@g.us` | `120363123456789@g.us` |
| Message | `{random}` | `3EB0ABC123DEF456` |

##### Ejemplos de Claves

```
session
contact/5491155555555@s.whatsapp.net
chat/5491155555555@s.whatsapp.net
chat/120363123456789@g.us
chat/5491155555555@s.whatsapp.net/message/3EB0ABC123DEF456
chat/5491155555555@s.whatsapp.net/message/3EB0ABC123DEF456/content
```

---

## Implementacion por Engine

Cada Engine puede optimizar el almacenamiento segun sus capacidades.

##### Memory (Map)

```typescript
class MemoryEngine implements Engine {
  private data = new Map<string, string>()

  async get(key: string, offset = 0, limit = 50): Promise<string[]> {
    if (this.data.has(key)) return [this.data.get(key)!]
    const items: string[] = []
    for (const [k, v] of this.data) {
      if (k.startsWith(`${key}/`)) items.push(v)
    }
    return items.slice(offset, offset + limit)
  }

  async set(key: string, value: string | null): Promise<boolean> {
    if (value === null) return this.data.delete(key)
    this.data.set(key, value)
    return true
  }
}
```

**Uso:** Desarrollo, testing, sesiones efimeras.

##### Redis

```typescript
class RedisEngine implements Engine {
  constructor(private redis: Redis) {}

  async get(key: string, offset = 0, limit = 50): Promise<string[]> {
    if (await this.redis.exists(key)) {
      const value = await this.redis.get(key)
      return value ? [value] : []
    }
    const keys = await this.redis.keys(`${key}/*`)
    const slice = keys.slice(offset, offset + limit)
    return slice.length ? await this.redis.mget(...slice) : []
  }

  async set(key: string, value: string | null): Promise<boolean> {
    if (value === null) return (await this.redis.del(key)) > 0
    return (await this.redis.set(key, value)) === 'OK'
  }
}
```

**Ventajas:** TTL nativo, clustering, pub/sub para eventos.
**Sugerencia:** Usar `SCAN` en lugar de `KEYS` en produccion.

##### PostgreSQL

```typescript
class PostgresEngine implements Engine {
  constructor(private pool: Pool) {}

  async get(key: string, offset = 0, limit = 50): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT value FROM store WHERE key = $1 OR key LIKE $2 ORDER BY key LIMIT $3 OFFSET $4`,
      [key, `${key}/%`, limit, offset]
    )
    return rows.map(r => r.value)
  }

  async set(key: string, value: string | null): Promise<boolean> {
    if (value === null) {
      const { rowCount } = await this.pool.query('DELETE FROM store WHERE key = $1', [key])
      return (rowCount ?? 0) > 0
    }
    await this.pool.query(
      'INSERT INTO store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      [key, value]
    )
    return true
  }
}
```

**Schema sugerido:**
```sql
CREATE TABLE store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_store_prefix ON store (key text_pattern_ops);
```

**Ventajas:** Queries SQL, indices, transacciones.

##### SQLite

```typescript
class SQLiteEngine implements Engine {
  constructor(private db: Database) {
    db.exec('CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT)')
  }

  get(key: string, offset = 0, limit = 50): Promise<string[]> {
    const rows = this.db.prepare(
      'SELECT value FROM store WHERE key = ? OR key LIKE ? LIMIT ? OFFSET ?'
    ).all(key, `${key}/%`, limit, offset)
    return Promise.resolve(rows.map((r: any) => r.value))
  }

  set(key: string, value: string | null): Promise<boolean> {
    if (value === null) {
      return Promise.resolve(this.db.prepare('DELETE FROM store WHERE key = ?').run(key).changes > 0)
    }
    this.db.prepare('INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)').run(key, value)
    return Promise.resolve(true)
  }
}
```

**Uso:** Aplicaciones desktop, single-file storage, bots simples.

##### MongoDB

```typescript
class MongoEngine implements Engine {
  constructor(private collection: Collection) {}

  async get(key: string, offset = 0, limit = 50): Promise<string[]> {
    const docs = await this.collection
      .find({ $or: [{ _id: key }, { _id: { $regex: `^${key}/` } }] })
      .skip(offset)
      .limit(limit)
      .toArray()
    return docs.map(d => d.value)
  }

  async set(key: string, value: string | null): Promise<boolean> {
    if (value === null) {
      const { deletedCount } = await this.collection.deleteOne({ _id: key })
      return (deletedCount ?? 0) > 0
    }
    await this.collection.updateOne({ _id: key }, { $set: { value } }, { upsert: true })
    return true
  }
}
```

**Sugerencia:** Parsear el JSON y guardar como documento BSON para queries avanzadas.

---

## Consideraciones

| Aspecto | Recomendacion |
|---------|---------------|
| Listar contactos | El Store maneja paginacion internamente, Engine solo get/set |
| Buscar mensajes | Store conoce la estructura, puede iterar claves con prefijo |
| TTL/Expiracion | Responsabilidad del Engine (Redis TTL, cron jobs en SQL) |
| Backups | Engine puede implementar snapshots segun backend |
| Migraciones | Claves son strings, facil exportar/importar entre backends |
