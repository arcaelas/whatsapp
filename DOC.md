# @arcaelas/whatsapp

Libreria para crear clientes de WhatsApp utilizando Baileys como proveedor WebSocket.

---

## Class WhatsApp

Clase principal para gestionar la conexion y comunicacion con WhatsApp.

##### Opciones de Configuracion

| Propiedad | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `phone` | `string` | - | Numero con prefijo de pais, ej: `5491155555555` (requerido para auth por codigo) |
| `store` | `Store` | *requerido* | Instancia de Store para persistencia |

**Modo de autenticacion:** Si `phone` esta presente -> codigo. Si no -> QR.

##### Retorno del Constructor

| Propiedad | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `Contact` | `typeof Contact` | - | Clase Contact vinculada a esta instancia |
| `Chat` | `typeof Chat` | - | Clase Chat vinculada a esta instancia |
| `Message` | `typeof Message` | - | Clase Message vinculada a esta instancia |
| `pair` | `(cb?) => Promise<void>` | - | Funcion para completar autenticacion |
| `on` | `(event, handler) => void` | - | Suscribirse a eventos |
| `off` | `(event, handler) => void` | - | Desuscribirse de eventos |

##### Funcion pair(callback?)

| Escenario | `qr` param | Retorno esperado | Comportamiento |
|-----------|------------|------------------|----------------|
| Sin `phone` (QR) | QR string | `void` | Callback se ejecuta cada vez que hay nuevo QR |
| Con `phone` (Code) | `undefined` | Codigo string | Retorna codigo para handshake |
| Sesion existente | - | - | Callback NO se ejecuta |

**Notas:**
- En modo QR, el callback puede ejecutarse multiples veces (cada ~20s cuando expira el QR).
- Si la autenticacion falla, `pair()` lanza una excepcion.

##### Eventos

| Evento | Payload | Descripcion |
|--------|---------|-------------|
| `open` | `void` | Conexion establecida |
| `close` | `void` | Conexion cerrada (usuario maneja reconexion) |
| `message` | `Message` | Mensaje recibido |
| `presence` | `Contact, status` | Cambio de presencia (`status`: online, offline, typing, recording) |
| `error` | `Error` | Error de conexion o autenticacion |

```typescript
const { Contact, Chat, Message, pair, on } = new WhatsApp({ store: new MemoryStore() })

on('open', () => console.log('Conectado'))
on('close', () => console.log('Desconectado'))
on('message', (msg) => console.log('Nuevo:', msg.id))
on('presence', (contact, status) => console.log(contact.name, status))
on('error', (err) => console.error(err))

await pair((qr) => showQR(qr))
```

---

## Abstract Class Store

Clase abstracta de almacenamiento key-value.

##### Metodos

| Metodo | Argumentos | Retorno | Descripcion |
|--------|------------|---------|-------------|
| `get` | `(key, fallback?)` | `string \| null` | Obtiene valor |
| `set` | `(key, value)` | `boolean` | Almacena valor |
| `has` | `(key)` | `boolean` | Verifica existencia |
| `unset` | `(key)` | `boolean` | Elimina clave |
| `pattern` | `(glob)` | `string[]` | Busca claves por patron |

**Patrones:** `*` wildcard, `{a,b}` seleccion multiple

```typescript
class MemoryStore extends Store {
  private data = new Map<string, string>()
  get(key: string, fallback: string | null = null) { return this.data.get(key) ?? fallback }
  set(key: string, value: string | null) { this.data.set(key, value); return true }
  has(key: string) { return this.data.has(key) }
  unset(key: string) { return this.data.delete(key) }
  pattern(glob: string) { /* implementacion */ }
}
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
| `delete` | `(uid)` | `Promise<boolean>` | Elimina contacto |
| `presence` | `(uid)` | `Promise<string>` | Obtiene estado |

##### Metodos de Instancia

| Metodo | Argumentos | Retorno | Descripcion |
|--------|------------|---------|-------------|
| `chat` | `()` | `Promise<Chat>` | Obtiene o crea el chat 1-1 |
| `delete` | `()` | `Promise<boolean>` | `Contact.delete(this.id)` |
| `rename` | `(name)` | `Promise<boolean>` | Cambia custom_name localmente |
| `save` | `(name)` | `Promise<boolean>` | Guarda en agenda del telefono |
| `presence` | `()` | `Promise<string>` | `Contact.presence(this.id)` |

```typescript
const yo = await Contact.me()
const contact = await Contact.get('5491155555555@s.whatsapp.net')
const todos = await Contact.find(0, 50)
await contact.chat()
await contact.delete()
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
| `delete` | `(cid)` | `Promise<boolean>` | Elimina chat (local y servidor) |
| `seen` | `(cid)` | `Promise<boolean>` | Marca chat como leido |
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
| `delete` | `()` | `Promise<boolean>` | `Chat.delete(this.id)` |
| `seen` | `()` | `Promise<boolean>` | `Chat.seen(this.id)` |
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
const chat = await Chat.get('5491155555555@s.whatsapp.net')
const chats = await Chat.find(0, 50)
const msgs = await chat.messages(0, 10)
const members = await chat.members(0, 50)
await chat.text('Hola!', msgs[0].id)
await chat.poll('Donde cenamos?', ['Pizza', 'Sushi', 'Tacos'])
await chat.location({ lat: -34.603, lng: -58.381 })
await chat.delete()
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
| `mime` | `string \| null` | `null` | Formato del archivo |
| `caption` | `string` | `''` | Texto en imagen/video/location |
| `me` | `boolean` | - | `true` si soy el autor |
| `status` | `'pending' \| 'sent' \| 'delivered' \| 'read'` | - | Estado del mensaje |
| `created_at` | `string` | - | Fecha en UTC (ISO string) |
| `edited` | `boolean` | `false` | `true` si fue editado |

##### Metodos Estaticos

| Metodo | Argumentos | Retorno | Descripcion |
|--------|------------|---------|-------------|
| `get` | `(mid)` | `Promise<Message \| null>` | Obtiene mensaje por MID |
| `delete` | `(mid, all?)` | `Promise<boolean>` | Elimina mensaje (`all` = para todos) |
| `forward` | `(mid, cid)` | `Promise<boolean>` | Reenvia mensaje a otro chat |
| `edit` | `(mid, content)` | `Promise<boolean>` | Edita mensaje de texto propio |
| `votes` | `(mid)` | `Promise<{name, count}[]>` | Obtiene votos de encuesta |

##### Metodos de Instancia

| Metodo | Argumentos | Retorno | Descripcion |
|--------|------------|---------|-------------|
| `content` | `(hd?)` | `Promise<string \| Buffer \| {lat, lng} \| {content, options} \| null>` | Contenido segun tipo |
| `delete` | `(all?)` | `Promise<boolean>` | `Message.delete(this.id, ...)` |
| `forward` | `(cid)` | `Promise<boolean>` | `Message.forward(this.id, ...)` |
| `edit` | `(content)` | `Promise<boolean>` | `Message.edit(this.id, ...)` |
| `votes` | `()` | `Promise<{name, count}[]>` | `Message.votes(this.id)` |

```typescript
const msg = await Message.get('ABC123')
const data = await msg.content()
const hd = await msg.content(true)
await msg.edit('Texto corregido')
await msg.forward('5491155555555@s.whatsapp.net')
await msg.votes()
await msg.delete(true)
```

---
