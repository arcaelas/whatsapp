# @arcaelas/whatsapp

Libreria para crear clientes de WhatsApp utilizando Baileys como proveedor WebSocket.

---

## Flujo de Uso

El ciclo de vida de una conexion WhatsApp sigue 4 pasos bien definidos:

### 1. Inicializacion

```typescript
const wa = new WhatsApp({ phone: "56962816490" })
```

El constructor prepara toda la configuracion interna: el store, los factories de entidades (Contact, Chat, Message) y se suscribe a sus propios eventos (`this.on(...)`) para persistir automaticamente. **En este punto no hay conexion a WhatsApp ni contacto con Baileys.**

### 2. Conexion

```typescript
await wa.pair(code => console.log("Ingresa el codigo: %s", code))
```

El metodo `pair()` establece la conexion con WhatsApp. Si es primera vez, ejecuta el callback con el codigo de emparejamiento que el usuario debe ingresar en su telefono. Si ya existe una sesion valida, el callback nunca se ejecuta. **La promesa se resuelve cuando la conexion esta establecida.**

### 3. Listo para usar

```typescript
console.log("Conectado!")
// Ya puedes usar wa.on("message"), wa.Chat.text(), etc.
```

Una vez que `pair()` resuelve, la instancia esta operativa. Puedes enviar mensajes, recibir eventos, y acceder a datos. Los mensajes entrantes comienzan a llegar inmediatamente.

### 4. Sincronizacion (opcional)

```typescript
await wa.sync(percent => console.log("Sincronizacion al %s%", percent))
```

Internamente, WhatsApp **siempre** sincroniza el historial y emite eventos `progress`. El metodo `sync()` simplemente espera hasta que esa sincronizacion termine (100%). Es util si necesitas garantizar que todos los contactos, chats y mensajes historicos esten disponibles antes de continuar.

### Resumen

| Metodo | Proposito | Obligatorio |
|--------|-----------|-------------|
| `new WhatsApp()` | Configurar la instancia | Si |
| `pair()` | Conectar a WhatsApp | Si |
| `sync()` | Esperar historial completo | No |

La separacion entre `pair()` y `sync()` permite que puedas empezar a recibir mensajes en tiempo real inmediatamente despues de conectar, sin esperar a que se descargue todo el historial.

---

## Eventos

La clase `WhatsApp` extiende `EventEmitter<EventMap>`, por lo que los eventos se manejan directamente en la instancia. Puedes suscribirte **antes o despues** de `pair()`, es indiferente porque usa un EventEmitter propio, no el socket de Baileys.

### Eventos disponibles

| Evento | Payload | Descripcion |
|--------|---------|-------------|
| `open` | `void` | Conexion establecida. Usado internamente por `pair()` |
| `close` | `void` | Desconexion. Util para metricas o reintentos |
| `progress` | `number` | Progreso de sincronizacion (0-100). Usado internamente por `sync()` |
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
| `message:deleted` | `{ cid: string, mid: string }` | Mensaje eliminado |
| `message:reaction` | `Message` | Reaccion emoji al mensaje |

### Uso de eventos

```typescript
const wa = new WhatsApp({ phone: "56962816490" })

// Mensajes nuevos
wa.on("message:created", async (message) => {
  const buffer = await message.content() // Siempre retorna Buffer

  if (message.mime === "text/plain") {
    const text = buffer.toString("utf-8")
    console.log("Texto:", text)
  } else if (message.mime === "application/json") {
    const data = JSON.parse(buffer.toString())
    console.log("JSON:", data) // location: {lat, lng}, poll: {content, items}
  } else {
    console.log("Media:", buffer.length, "bytes") // image/*, video/*, audio/*
  }
})

// Cambios de estado del mensaje
wa.on("message:status", (message) => {
  console.log(`Mensaje ${message.id}: ${message.status}`) // pending, sent, delivered, read
})

// Mensaje editado
wa.on("message:updated", async (message) => {
  const text = (await message.content()).toString()
  console.log("Editado:", text)
})

// Mensaje eliminado
wa.on("message:deleted", ({ cid, mid }) => {
  console.log(`Eliminado: ${mid} en chat ${cid}`)
})

// Reaccion a mensaje
wa.on("message:reaction", (message) => {
  console.log("Reaccion en mensaje:", message.id)
})

// Contactos y chats
wa.on("contact:upsert", (contact) => console.log("Contacto:", contact.name))
wa.on("chat:upsert", (chat) => console.log("Chat:", chat.name))
wa.on("chat:deleted", (cid) => console.log("Chat eliminado:", cid))

// Progreso de sincronizacion
wa.on("progress", (percent) => {
  console.log("Sincronizacion:", percent + "%")
})

// Conexion y desconexion
wa.on("open", () => console.log("Conectado"))
wa.on("close", () => console.log("Desconectado"))

await wa.pair()
```

### Arquitectura interna

```
BAILEYS (socket.ev.on)
        │
        ▼
    pair()  ← Unico punto de contacto con Baileys
        │     Recibe eventos Baileys
        │     Transforma → new Contact/Chat/Message(data)
        │     Reemplaza content() con buffer en memoria
        │     Emite → this.emit("event:type", instance)
        ▼
  EventEmitter (this)
        │
        ├── Constructor (listener interno)
        │     this.on("message:created", m => store.message.set(...))
        │     this.on("contact:upsert", c => store.contact.set(...))
        │     this.on("chat:upsert", ch => store.chat.set(...))
        │
        └── Usuario (listener externo)
              wa.on("message:created", m => console.log(m))
```

**Flujo de datos:**
1. `pair()` recibe eventos de Baileys (`messages.upsert`, `contacts.upsert`, etc.)
2. `pair()` transforma los datos a instancias propias (Contact, Chat, Message)
3. `pair()` emite con `this.emit()` el evento correspondiente (`:created`, `:upsert`, etc.)
4. El constructor (listener interno) persiste automaticamente en el store
5. El usuario (listener externo) procesa segun su logica

**Ventajas:**
- `pair()` es el unico metodo que interactua con Baileys
- El resto de la libreria usa instancias propias, eventos propios
- El store se actualiza automaticamente via eventos internos
- El usuario tiene acceso a los mismos eventos sin conocer Baileys

**Virtualizacion de content():**
El metodo `content()` de cada mensaje se reemplaza en runtime con una funcion que retorna el buffer directamente desde memoria. Esto evita ir al store cuando el contenido ya fue descargado por `pair()`.

---

## Class WhatsApp

Clase principal para gestionar la conexion y comunicacion con WhatsApp.

##### Opciones de Configuracion

| Propiedad | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `phone` | `string` | - | Numero con prefijo de pais, ej: `5491155555555` (requerido para auth por codigo) |
| `engine` | `Engine` | `FileStore` | Engine de persistencia para credenciales. Por defecto usa FileStore en `.baileys/{phone}/` |

**Modo de autenticacion:** Si `phone` esta presente -> codigo. Si no -> QR.

##### Retorno del Constructor

| Propiedad | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `Contact` | `typeof Contact` | - | Clase Contact vinculada a esta instancia |
| `Chat` | `typeof Chat` | - | Clase Chat vinculada a esta instancia |
| `Message` | `typeof Message` | - | Clase Message vinculada a esta instancia |
| `pair` | `(cb?) => Promise<void>` | - | Funcion para completar autenticacion |
| `sync` | `(cb?) => Promise<void>` | - | Funcion para esperar sincronizacion completa |
| `on` | `(event, handler) => void` | - | Suscribirse a eventos |
| `off` | `(event, handler) => void` | - | Desuscribirse de eventos |

##### Funcion pair(callback)

| Escenario | Callback param | Ejecucion | Comportamiento |
|-----------|----------------|-----------|----------------|
| Sin `phone` (QR) | `Buffer` | Multiples veces | Imagen QR lista para mostrar, se renueva cada ~20s |
| Con `phone` (Code) | `string` | Una vez | Codigo de 8 caracteres para ingresar en WhatsApp |
| Sesion existente | - | No se ejecuta | Resuelve inmediatamente sin llamar callback |

**Notas:**
- En modo QR, el Buffer es una imagen PNG del codigo QR.
- En modo Code, el usuario debe ingresar el codigo en WhatsApp > Dispositivos vinculados > Vincular con numero.
- Si la autenticacion falla, `pair()` lanza una excepcion.

##### Funcion sync(callback)

Bloquea hasta que WhatsApp termine de sincronizar contactos, chats y mensajes.

| Escenario | Callback param | Ejecucion | Comportamiento |
|-----------|----------------|-----------|----------------|
| Sincronizando | `number` (0-100) | Multiples veces | Progreso de sincronizacion |
| Sincronizacion completa | `100` | Una vez final | Resuelve la promesa |

**Notas:**
- Llamar despues de `pair()` para esperar sincronizacion completa.
- El callback es opcional - sin callback solo bloquea hasta completar.

##### Eventos

Ver seccion [Eventos](#eventos) para detalles completos.

```typescript
// Modo QR
const wa = new WhatsApp()

wa.on('open', () => console.log('Conectado'))
wa.on('contact:upsert', (c) => console.log('Contacto:', c.name))
wa.on('chat:upsert', (ch) => console.log('Chat:', ch.name))
wa.on('message:created', (msg) => console.log('Mensaje:', msg.id))

await wa.pair((qr: Buffer) => {
  fs.writeFileSync('qr.png', qr)
})

await wa.sync((progress) => {
  console.log(`Sincronizando: ${progress}%`)
})
console.log('Sincronizacion completa')

// Modo Code
const wa = new WhatsApp({ phone: '5491155555555' })

await wa.pair((code: string) => {
  console.log('Ingresa en WhatsApp:', code)
})

await wa.sync() // Esperar sin callback
```

---

## Interface Engine

Contrato minimo que cualquier proveedor de persistencia debe implementar.

##### Metodos

| Metodo | Argumentos | Retorno | Descripcion |
|--------|------------|---------|-------------|
| `get` | `(key, offset?, limit?)` | `Promise<string[]>` | Obtiene documentos por clave o namespace |
| `set` | `(key, value)` | `Promise<boolean>` | Guarda string, `null` elimina |

##### Comportamiento de get()

| Llamada | Resultado |
|---------|-----------|
| `get('contact/123')` | Array con 1 item (o vacio) |
| `get('contact/123', 0, 100)` | Igual - offset/limit no afectan clave exacta |
| `get('contact', 0, 50)` | Array con contactos paginados |
| `get('chat/abc/message', 0, 20)` | Array con mensajes del chat |

La firma es uniforme. El Engine detecta internamente si es clave exacta o namespace y aplica offset/limit solo cuando corresponde.

##### Ejemplo

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

---

## Class Store

Clase interna que envuelve el Engine y expone metodos tipados para cada entidad.

##### Namespaces

Cada namespace almacena strings JSON con las propiedades de la entidad correspondiente.

| Namespace | Ruta | Propiedades JSON |
|-----------|------|------------------|
| `session` | `session/creds`, `session/signal/{type}/{id}` | Credenciales y claves de sesion Baileys |
| `contact` | `contact/:id` | `{ id, name, phone, photo, custom_name }` |
| `chat` | `chat/:id` | `{ id, name, photo, phone, type }` |
| `message` | `chat/:cid/message/:mid` | `{ id, cid, uid, mid, type, mime, caption, me, status, created_at, edited }` |
| `content` | `chat/:cid/message/:mid/content` | `Buffer` serializado con BufferJSON |

##### Metodos document

| Metodo | Argumentos | Retorno | Descripcion |
|--------|------------|---------|-------------|
| `document.get` | `(pathname, offset?, limit?)` | `Promise<T[]>` | Obtiene documentos parseados con BufferJSON |
| `document.set` | `(pathname, value)` | `Promise<boolean>` | Guarda documento serializado con BufferJSON |

##### Metodos de Entidades

| Metodo | Argumentos | Retorno | Descripcion |
|--------|------------|---------|-------------|
| `contact.get` | `(id)` | `Promise<IContact \| null>` | Obtiene contacto parseado |
| `contact.find` | `(offset, limit)` | `Promise<IContact[]>` | Pagina contactos parseados |
| `contact.set` | `(data)` | `Promise<boolean>` | Guarda contacto |
| `chat.get` | `(id)` | `Promise<IChat \| null>` | Obtiene chat parseado |
| `chat.find` | `(offset, limit)` | `Promise<IChat[]>` | Pagina chats parseados |
| `chat.set` | `(data)` | `Promise<boolean>` | Guarda chat |
| `message.get` | `(cid, mid)` | `Promise<IMessage \| null>` | Obtiene mensaje parseado |
| `message.find` | `(cid, offset, limit)` | `Promise<IMessage[]>` | Pagina mensajes parseados |
| `message.set` | `(data)` | `Promise<boolean>` | Guarda mensaje |
| `content.get` | `(cid, mid)` | `Promise<Buffer \| null>` | Obtiene contenido multimedia |
| `content.set` | `(cid, mid, buffer)` | `Promise<boolean>` | Guarda contenido multimedia |

```typescript
// document: parsea JSON con BufferJSON, retorna objetos
await store.document.get('contact/123')       // object[]
await store.document.set('contact/123', obj)  // boolean

// entidades: retornan datos crudos (IContact, IChat, IMessage)
await store.contact.get('123')           // IContact | null
await store.contact.find(0, 50)          // IContact[]
await store.chat.get('cid')              // IChat | null
await store.chat.find(0, 50)             // IChat[]
await store.message.get('cid', 'mid')    // IMessage | null
await store.message.find('cid', 0, 20)   // IMessage[]
await store.content.get('cid', 'mid')    // Buffer | null
```

---

## Class Contact

Representa un contacto de WhatsApp.

##### Propiedades

| Propiedad | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `id` | `string` | - | JID del contacto (`@s.whatsapp.net`) |
| `name` | `string` | - | Nombre publico del usuario |
| `phone` | `string` | - | Numero con prefijo de pais (sin +) |
| `photo` | `string \| null` | `null` | URL de foto de perfil |
| `custom_name` | `string` | `name` | Nombre en agenda local |

##### Metodos Estaticos

| Metodo | Argumentos | Retorno | Descripcion |
|--------|------------|---------|-------------|
| `me` | `()` | `Promise<Contact>` | Obtiene el contacto propio |
| `get` | `(uid)` | `Promise<Contact \| null>` | Obtiene contacto por UID |
| `find` | `(offset, limit)` | `Promise<Contact[]>` | Obtiene contactos paginados |

##### Metodos de Instancia

| Metodo | Argumentos | Retorno | Descripcion |
|--------|------------|---------|-------------|
| `chat` | `()` | `Promise<Chat>` | Obtiene o crea el chat 1-1 |
| `rename` | `(name)` | `Promise<boolean>` | Cambia custom_name localmente |

```typescript
const yo = await wa.Contact.me()
const contact = await wa.Contact.get('5491155555555@s.whatsapp.net')
const todos = await wa.Contact.find(0, 50)
const chat = await contact.chat()
await contact.rename('Mi amigo')
```

---

## Class Chat

Representa un chat de WhatsApp (grupo o contacto directo).

##### Propiedades

| Propiedad | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `id` | `string` | - | ID del chat (remoteJid) |
| `name` | `string` | - | Nombre del grupo o contacto |
| `photo` | `string \| null` | `null` | URL de foto de perfil |
| `phone` | `string \| null` | `null` | Numero (null en grupos) |
| `type` | `'group' \| 'contact'` | - | Tipo de chat |

##### Metodos Estaticos

| Metodo | Argumentos | Retorno | Descripcion |
|--------|------------|---------|-------------|
| `get` | `(cid)` | `Promise<Chat \| null>` | Obtiene chat por CID |
| `find` | `(offset, limit)` | `Promise<Chat[]>` | Obtiene chats paginados |
| `seen` | `(cid, mid?)` | `Promise<boolean>` | Marca mensaje como leido. Sin mid usa el ultimo |
| `members` | `(cid, offset, limit)` | `Promise<Contact[]>` | Participantes (incluye `me`) |
| `messages` | `(cid, offset, limit)` | `Promise<Message[]>` | Obtiene mensajes paginados |
| `text` | `(cid, content, mid?)` | `Promise<boolean>` | Envia texto |
| `image` | `(cid, buffer, mid?)` | `Promise<boolean>` | Envia imagen |
| `video` | `(cid, buffer, mid?)` | `Promise<boolean>` | Envia video |
| `audio` | `(cid, buffer, mid?)` | `Promise<boolean>` | Envia audio |
| `location` | `(cid, {lat, lng, caption?})` | `Promise<boolean>` | Envia ubicacion |
| `poll` | `(cid, text, options[])` | `Promise<boolean>` | Crea encuesta |
| `typing` | `(cid, bool)` | `Promise<boolean>` | Activa/desactiva "escribiendo..." |
| `recording` | `(cid, bool)` | `Promise<boolean>` | Activa/desactiva "grabando..." |

##### Metodos de Instancia

| Metodo | Argumentos | Retorno | Descripcion |
|--------|------------|---------|-------------|
| `seen` | `(mid?)` | `Promise<boolean>` | `Chat.seen(this.id, mid)` |
| `members` | `(offset, limit)` | `Promise<Contact[]>` | `Chat.members(this.id, ...)` |
| `messages` | `(offset, limit)` | `Promise<Message[]>` | `Chat.messages(this.id, ...)` |
| `text` | `(content, mid?)` | `Promise<boolean>` | `Chat.text(this.id, ...)` |
| `image` | `(buffer, mid?)` | `Promise<boolean>` | `Chat.image(this.id, ...)` |
| `video` | `(buffer, mid?)` | `Promise<boolean>` | `Chat.video(this.id, ...)` |
| `audio` | `(buffer, mid?)` | `Promise<boolean>` | `Chat.audio(this.id, ...)` |
| `location` | `({lat, lng, caption?})` | `Promise<boolean>` | `Chat.location(this.id, ...)` |
| `poll` | `(text, options[])` | `Promise<boolean>` | `Chat.poll(this.id, ...)` |
| `typing` | `(bool)` | `Promise<boolean>` | `Chat.typing(this.id, ...)` |
| `recording` | `(bool)` | `Promise<boolean>` | `Chat.recording(this.id, ...)` |

```typescript
const chat = await wa.Chat.get('5491155555555@s.whatsapp.net')
const chats = await wa.Chat.find(0, 50)
const msgs = await chat.messages(0, 10)
const members = await chat.members(0, 50)
await chat.text('Hola!', msgs[0].id)
await chat.poll('Donde cenamos?', ['Pizza', 'Sushi', 'Tacos'])
await chat.location({ lat: -34.603, lng: -58.381 })
await chat.seen() // Marca ultimo mensaje como leido
```

---

## Class Message

Representa un mensaje de WhatsApp.

##### Propiedades

| Propiedad | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `id` | `string` | - | ID unico del mensaje |
| `cid` | `string` | - | ID del chat |
| `uid` | `string` | - | ID del usuario que envio |
| `mid` | `string \| null` | `null` | ID del mensaje citado |
| `type` | `'text' \| 'image' \| 'video' \| 'audio' \| 'location' \| 'poll' \| 'unknown'` | - | Tipo de contenido |
| `mime` | `string` | `'text/plain'` | Formato: `text/plain`, `image/*`, `video/*`, `audio/*`, `application/json` |
| `caption` | `string` | `''` | Texto en imagen/video/location |
| `me` | `boolean` | - | `true` si soy el autor |
| `status` | `'pending' \| 'sent' \| 'delivered' \| 'read'` | - | Estado del mensaje |
| `created_at` | `string` | - | Fecha en UTC (ISO string) |
| `edited` | `boolean` | `false` | `true` si fue editado |

##### Metodos Estaticos

| Metodo | Argumentos | Retorno | Descripcion |
|--------|------------|---------|-------------|
| `get` | `(cid, mid)` | `Promise<Message \| null>` | Obtiene mensaje por CID y MID |
| `delete` | `(cid, mid, all?)` | `Promise<boolean>` | Elimina mensaje (`all` = para todos) |
| ~~`forward`~~ | ~~`(cid, mid, target_cid)`~~ | ~~`Promise<boolean>`~~ | ~~Deprecated: usar envio manual~~ |
| `edit` | `(cid, mid, content)` | `Promise<boolean>` | Edita mensaje de texto propio |
| `votes` | `(cid, mid)` | `Promise<{name, count}[]>` | Obtiene votos de encuesta |
| `seen` | `(cid, mid)` | `Promise<boolean>` | Marca mensaje como leido |

##### Metodos de Instancia

| Metodo | Argumentos | Retorno | Descripcion |
|--------|------------|---------|-------------|
| `content` | `()` | `Promise<Buffer>` | Contenido segun tipo y mime |
| `chat` | `()` | `Promise<Chat \| null>` | Obtiene el chat donde se envio |
| `author` | `()` | `Promise<Contact \| null>` | Obtiene el contacto autor |
| `delete` | `(all?)` | `Promise<boolean>` | `Message.delete(this.cid, this.id, ...)` |
| `edit` | `(content)` | `Promise<boolean>` | `Message.edit(this.cid, this.id, ...)` |
| `votes` | `()` | `Promise<{name, count}[]>` | `Message.votes(this.cid, this.id)` |
| `seen` | `()` | `Promise<boolean>` | `Message.seen(this.cid, this.id)` |

```typescript
const msg = await wa.Message.get('5491155555555@s.whatsapp.net', 'ABC123')

// Texto: mime = 'text/plain'
const text = (await msg.content()).toString()

// Media: mime = 'image/jpeg', 'video/mp4', 'audio/ogg', etc.
const media = await msg.content()

// Location/Poll: mime = 'application/json'
const location = JSON.parse((await msg.content()).toString()) // {lat, lng}
const poll = JSON.parse((await msg.content()).toString()) // {content, items[]}

// Navegacion
const chat = await msg.chat()
const author = await msg.author()

await msg.edit('Texto corregido')
await msg.delete(true)
await msg.seen()
```

---
