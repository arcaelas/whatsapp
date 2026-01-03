# Chat

Clase para gestionar conversaciones de WhatsApp (contactos y grupos).

---

## Importacion

La clase se accede desde la instancia de WhatsApp:

```typescript
const wa = new WhatsApp();
wa.Chat // Clase Chat enlazada
```

---

## Propiedades

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `id` | `string` | JID del chat |
| `name` | `string` | Nombre del chat |
| `phone` | `string \| null` | Numero de telefono (null en grupos) |
| `photo` | `string \| null` | URL de la foto de perfil (preview) |
| `type` | `'contact' \| 'group'` | Tipo de chat |

---

## Metodos estaticos

### `Chat.get(cid)`

Obtiene un chat por su ID. Si no existe pero el contacto si, crea el chat automaticamente.

```typescript
// Chat individual
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");

// Grupo
const group = await wa.Chat.get("123456789@g.us");
```

### `Chat.paginate(offset, limit)`

Obtiene chats paginados.

```typescript
const chats = await wa.Chat.paginate(0, 20);
for (const chat of chats) {
  console.log(`${chat.name} (${chat.type})`);
}
```

### `Chat.remove(cid)`

Elimina un chat. Si es grupo, sale del grupo antes de eliminar.

```typescript
await wa.Chat.remove("5491112345678@s.whatsapp.net");
```

### `Chat.members(cid, offset, limit)`

Obtiene miembros del chat. En chats individuales retorna el contacto y el usuario actual.

```typescript
const members = await wa.Chat.members("123456789@g.us", 0, 50);
for (const member of members) {
  console.log(member.name);
}
```

### `Chat.rename(cid, name)`

Renombra un chat. Para grupos intenta renombrar en servidor (si es admin), para contactos solo guarda localmente.

```typescript
await wa.Chat.rename("5491112345678@s.whatsapp.net", "Cliente VIP");
```

### `Chat.archive(cid, on)`

Archiva o desarchiva un chat.

```typescript
// Archivar
await wa.Chat.archive("5491112345678@s.whatsapp.net", true);

// Desarchivar
await wa.Chat.archive("5491112345678@s.whatsapp.net", false);
```

### `Chat.mute(cid, until?)`

Silencia o desilencia un chat.

```typescript
// Silenciar por 8 horas
const until = new Date(Date.now() + 8 * 60 * 60 * 1000);
await wa.Chat.mute("5491112345678@s.whatsapp.net", until);

// Silenciar indefinidamente (1 año)
const forever = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
await wa.Chat.mute("5491112345678@s.whatsapp.net", forever);

// Desilenciar
await wa.Chat.mute("5491112345678@s.whatsapp.net", null);
```

### `Chat.pin(cid, on)`

Fija o desfija un chat.

```typescript
// Fijar
await wa.Chat.pin("5491112345678@s.whatsapp.net", true);

// Desfijar
await wa.Chat.pin("5491112345678@s.whatsapp.net", false);
```

### `Chat.typing(cid, on)`

Muestra/oculta indicador de "escribiendo...".

```typescript
await wa.Chat.typing("5491112345678@s.whatsapp.net", true);
// ... escribir respuesta ...
await wa.Chat.typing("5491112345678@s.whatsapp.net", false);
```

### `Chat.recording(cid, on)`

Muestra/oculta indicador de "grabando audio...".

```typescript
await wa.Chat.recording("5491112345678@s.whatsapp.net", true);
// ... preparar audio ...
await wa.Chat.recording("5491112345678@s.whatsapp.net", false);
```

### `Chat.seen(cid, mid?)`

Marca un chat o mensaje como leido.

```typescript
// Marcar ultimo mensaje como leido
await wa.Chat.seen("5491112345678@s.whatsapp.net");

// Marcar mensaje especifico
await wa.Chat.seen("5491112345678@s.whatsapp.net", "MESSAGE_ID");
```

---

## Metodos de instancia

### `remove()`

Elimina este chat.

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
await chat?.remove();
```

### `members(offset, limit)`

Obtiene miembros de este chat.

```typescript
const chat = await wa.Chat.get("123456789@g.us");
const members = await chat?.members(0, 50);
```

### `rename(name)`

Renombra este chat.

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
await chat?.rename("Nuevo nombre");
```

### `archive(on)`

Archiva o desarchiva este chat.

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
await chat?.archive(true);
```

### `mute(until?)`

Silencia o desilencia este chat.

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
// Silenciar 8 horas
await chat?.mute(new Date(Date.now() + 8 * 60 * 60 * 1000));
// Desilenciar
await chat?.mute(null);
```

### `pin(on)`

Fija o desfija este chat.

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
await chat?.pin(true);
```

### `typing(on)`

Muestra/oculta indicador de "escribiendo...".

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
await chat?.typing(true);
```

### `recording(on)`

Muestra/oculta indicador de "grabando audio...".

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
await chat?.recording(true);
```

### `seen(mid?)`

Marca este chat o mensaje como leido.

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
await chat?.seen();
```

---

## Eventos

### `chat:upsert`

Emitido cuando se crea o actualiza un chat.

```typescript
wa.on("chat:upsert", (chat) => {
  console.log(`Chat actualizado: ${chat.name}`);
  console.log(`  Tipo: ${chat.type}`);
  console.log(`  Foto: ${chat.photo ?? "Sin foto"}`);
});
```

### `chat:deleted`

Emitido cuando se elimina un chat.

```typescript
wa.on("chat:deleted", (cid) => {
  console.log(`Chat eliminado: ${cid}`);
});
```

---

## Diferenciar contactos de grupos

```typescript
wa.on("chat:upsert", (chat) => {
  if (chat.type === "group") {
    console.log(`Grupo: ${chat.name}`);
  } else {
    console.log(`Chat individual: ${chat.name}`);
  }
});
```

---

## Ejemplos

### Listar todos los grupos

```typescript
const chats = await wa.Chat.paginate(0, 100);
const groups = chats.filter(c => c.type === "group");

for (const group of groups) {
  const members = await group.members(0, 1000);
  console.log(`${group.name}: ${members.length} miembros`);
}
```

### Broadcast a multiples chats

```typescript
const message = "Mensaje importante!";
const chats = await wa.Chat.paginate(0, 100);

for (const chat of chats) {
  await wa.Message.Message.text(chat.id, message);
  // Esperar entre mensajes para evitar ban
  await new Promise(r => setTimeout(r, 1000));
}
```

### Indicador de escritura antes de responder

```typescript
wa.on("message:created", async (msg) => {
  if (msg.me) return;
  if (!(msg instanceof wa.Message.Text)) return;

  const text = (await msg.content()).toString();
  if (!text.toLowerCase().includes("hola")) return;

  // Mostrar que estamos escribiendo
  await wa.Chat.typing(msg.cid, true);

  // Simular tiempo de respuesta
  await new Promise(r => setTimeout(r, 2000));

  // Enviar respuesta
  await wa.Message.Message.text(msg.cid, "Hola! Como estas?", msg.id);

  // Ocultar indicador
  await wa.Chat.typing(msg.cid, false);
});
```

### Obtener mensajes de un chat

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  // Obtener ultimos 20 mensajes
  const messages = await wa.Message.Message.paginate(chat.id, 0, 20);

  for (const msg of messages) {
    console.log(`[${msg.type}] ${msg.me ? "→" : "←"} ${msg.id}`);
  }
}
```

---

## Interfaz IChat

```typescript
interface IChat {
  id: string;
  name: string;
  phone: string | null;
  photo: string | null;
  type: "group" | "contact";
}
```
