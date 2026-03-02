# Chat

Clase para gestionar conversaciones de WhatsApp (contactos individuales y grupos).

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
| `id` | `string` | JID del chat (ej: `123@s.whatsapp.net` o `123@g.us`) |
| `name` | `string` | Nombre del chat o grupo |
| `type` | `'contact' \| 'group'` | Tipo de chat |
| `content` | `string` | Descripcion del chat/grupo (string vacio si no tiene) |
| `pined` | `boolean` | `true` si el chat esta fijado |
| `archived` | `boolean` | `true` si el chat esta archivado |
| `muted` | `number \| false` | Timestamp de expiracion del silencio o `false` |
| `readed` | `boolean` | `true` si el chat esta leido |
| `readonly` | `boolean` | `true` si el chat es solo lectura |

---

## Metodos estaticos

### `Chat.get(cid)`

Obtiene un chat por su ID. Si no existe pero el contacto si, crea el chat automaticamente.

```typescript
// Chat individual
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");

// Grupo
const group = await wa.Chat.get("123456789@g.us");

if (chat) {
  console.log(`Chat: ${chat.name} (${chat.type})`);
}
```

### `Chat.list(offset?, limit?)`

Obtiene chats paginados.

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `offset` | `number` | `0` | Posicion inicial |
| `limit` | `number` | `50` | Cantidad maxima de resultados |

```typescript
const chats = await wa.Chat.list(0, 100);
for (const chat of chats) {
  console.log(`${chat.name} (${chat.type})`);
}
```

### `Chat.pin(cid, value)`

Fija o desfija un chat por su ID. Delega a la instancia internamente.

```typescript
// Fijar
await wa.Chat.pin("5491112345678@s.whatsapp.net", true);

// Desfijar
await wa.Chat.pin("5491112345678@s.whatsapp.net", false);
```

### `Chat.archive(cid, value)`

Archiva o desarchiva un chat por su ID. Delega a la instancia internamente.

```typescript
// Archivar
await wa.Chat.archive("5491112345678@s.whatsapp.net", true);

// Desarchivar
await wa.Chat.archive("5491112345678@s.whatsapp.net", false);
```

### `Chat.mute(cid, duration)`

Silencia o desilencia un chat por su ID. Delega a la instancia internamente.

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `cid` | `string` | ID del chat |
| `duration` | `number \| null` | Duracion en milisegundos o `null` para desilenciar |

```typescript
// Silenciar por 8 horas
await wa.Chat.mute(
  "5491112345678@s.whatsapp.net",
  8 * 60 * 60 * 1000
);

// Desilenciar
await wa.Chat.mute("5491112345678@s.whatsapp.net", null);
```

### `Chat.seen(cid)`

Marca el ultimo mensaje del chat como leido. Delega a la instancia internamente.

```typescript
await wa.Chat.seen("5491112345678@s.whatsapp.net");
```

### `Chat.remove(cid)`

Elimina un chat por su ID. Si es grupo, sale del grupo antes de eliminar. Delega a la instancia internamente.

```typescript
await wa.Chat.remove("5491112345678@s.whatsapp.net");
```

---

## Metodos de instancia

### `refresh()`

Actualiza los datos del chat desde WhatsApp. En grupos, obtiene metadata (nombre, descripcion, participantes, creador). En chats individuales, actualiza el contacto asociado. Persiste los cambios en el engine.

Retorna `this` si se actualizo correctamente, o `null` si no hay socket conectado.

```typescript
const chat = await wa.Chat.get("123456789@g.us");
if (chat) {
  await chat.refresh();
  console.log(`Nombre actualizado: ${chat.name}`);
  console.log(`Descripcion: ${chat.content}`);
}
```

### `remove()`

Elimina el chat. Si es grupo, sale del grupo primero. Ejecuta cascade delete en el engine (elimina `chat/{cid}` y todas las sub-keys).

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  await chat.remove();
}
```

### `pin(value)`

Fija o desfija el chat.

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  await chat.pin(true);  // Fijar
  await chat.pin(false); // Desfijar
}
```

### `archive(value)`

Archiva o desarchiva el chat.

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  await chat.archive(true);  // Archivar
  await chat.archive(false); // Desarchivar
}
```

### `mute(duration)`

Silencia o desilencia el chat.

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `duration` | `number \| null` | Duracion en ms o `null` para desilenciar |

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  await chat.mute(8 * 60 * 60 * 1000); // Silenciar 8 horas
  await chat.mute(null);                // Desilenciar
}
```

### `seen()`

Marca el chat como leido. Usa el ultimo mensaje del indice para notificar a WhatsApp.

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  await chat.seen();
}
```

### `members(offset?, limit?)`

Obtiene los miembros del chat.

- En chats individuales: retorna el contacto asociado
- En grupos: retorna los participantes del grupo

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `offset` | `number` | `0` | Posicion inicial |
| `limit` | `number` | `50` | Cantidad maxima |

```typescript
const chat = await wa.Chat.get("123456789@g.us");
if (chat) {
  const members = await chat.members(0, 50);
  for (const member of members) {
    console.log(`${member.name} (${member.phone})`);
  }
}
```

### `messages(offset?, limit?)`

Obtiene los mensajes del chat con paginacion. Delega a `Message.list(cid, offset, limit)`.

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `offset` | `number` | `0` | Posicion inicial |
| `limit` | `number` | `50` | Cantidad maxima de mensajes |

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  const messages = await chat.messages(0, 100);
  for (const msg of messages) {
    console.log(`${msg.type}: ${msg.caption}`);
  }
}
```

### `contact()`

Obtiene el contacto asociado al chat (solo chats individuales). Para grupos retorna `null`.

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  const contact = await chat.contact();
  if (contact) {
    console.log(`Contacto: ${contact.name}`);
  }
}
```

---

## Eventos de Chat

Los eventos se escuchan a traves de `wa.event`:

### `chat:created`

Emitido cuando se crea un nuevo chat.

```typescript
wa.event.on("chat:created", (chat) => {
  console.log(`Nuevo chat: ${chat.name} (${chat.type})`);
});
```

### `chat:updated`

Emitido cuando se actualiza un chat existente.

```typescript
wa.event.on("chat:updated", (chat) => {
  console.log(`Chat actualizado: ${chat.name}`);
});
```

### `chat:pined`

Emitido cuando se fija o desfija un chat.

```typescript
wa.event.on("chat:pined", (cid, pined) => {
  if (pined) {
    console.log(`Chat ${cid} fijado`);
  } else {
    console.log(`Chat ${cid} desfijado`);
  }
});
```

### `chat:archived`

Emitido cuando se archiva o desarchiva un chat.

```typescript
wa.event.on("chat:archived", (cid, archived) => {
  console.log(`Chat ${cid}: ${archived ? "archivado" : "desarchivado"}`);
});
```

### `chat:muted`

Emitido cuando se silencia o desilencia un chat.

```typescript
wa.event.on("chat:muted", (cid, muted) => {
  if (muted) {
    console.log(`Chat ${cid} silenciado hasta ${new Date(muted)}`);
  } else {
    console.log(`Chat ${cid} desilenciado`);
  }
});
```

### `chat:deleted`

Emitido cuando se elimina un chat.

```typescript
wa.event.on("chat:deleted", (cid) => {
  console.log(`Chat eliminado: ${cid}`);
});
```

---

## Diferenciar contactos de grupos

```typescript
wa.event.on("chat:created", (chat) => {
  if (chat.type === "group") {
    console.log(`Grupo: ${chat.name}`);
  } else {
    console.log(`Chat individual: ${chat.name}`);
  }
});

// O verificar por JID
function is_group(cid: string): boolean {
  return cid.endsWith("@g.us");
}
```

---

## Ejemplos

### Listar miembros de un grupo

```typescript
const group = await wa.Chat.get("123456789@g.us");
if (group) {
  const members = await group.members(0, 1000);
  console.log(`Grupo tiene ${members.length} miembros:`);
  for (const member of members) {
    console.log(`  - ${member.name}`);
  }
}
```

### Silenciar grupos nuevos automaticamente

```typescript
wa.event.on("chat:created", async (chat) => {
  if (chat.type === "group") {
    await chat.mute(365 * 24 * 60 * 60 * 1000);
    console.log(`Grupo ${chat.name} silenciado automaticamente`);
  }
});
```

### Archivar chats inactivos

```typescript
async function archive_inactive(wa: WhatsApp) {
  const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
  if (chat && !chat.pined && !chat.archived) {
    await chat.archive(true);
  }
}
```

### Enviar mensaje a todos los miembros de un grupo

```typescript
async function broadcast_to_members(wa: WhatsApp, group_id: string, text: string) {
  const group = await wa.Chat.get(group_id);
  if (!group) return;

  const members = await group.members(0, 1000);
  for (const member of members) {
    await wa.Message.text(member.id, text);
    // Esperar entre mensajes para evitar ban
    await new Promise(r => setTimeout(r, 2000));
  }
}
```

---

## Interfaz IChatRaw

Objeto raw del chat almacenado en el engine (protocolo).

```typescript
interface IChatRaw {
  id: string;
  name?: string | null;
  displayName?: string | null;
  description?: string | null;
  unreadCount?: number | null;
  readOnly?: boolean | null;
  archived?: boolean | null;
  pinned?: number | null;
  muteEndTime?: number | null;
  markedAsUnread?: boolean | null;
  participant?: IGroupParticipant[] | null;
  createdBy?: string | null;
  createdAt?: number | null;
  ephemeralExpiration?: number | null;
}

interface IGroupParticipant {
  id: string;
  admin: string | null;
}
```

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `id` | `string` | JID unico del chat |
| `name` | `string \| null` | Nombre del chat o grupo |
| `displayName` | `string \| null` | Nombre alternativo para mostrar |
| `description` | `string \| null` | Descripcion del grupo |
| `unreadCount` | `number \| null` | Cantidad de mensajes no leidos |
| `readOnly` | `boolean \| null` | Si el chat es solo lectura |
| `archived` | `boolean \| null` | Si el chat esta archivado |
| `pinned` | `number \| null` | Timestamp de cuando se fijo el chat |
| `muteEndTime` | `number \| null` | Timestamp de expiracion del silencio |
| `markedAsUnread` | `boolean \| null` | Si fue marcado manualmente como no leido |
| `participant` | `IGroupParticipant[] \| null` | Participantes del grupo |
| `createdBy` | `string \| null` | JID del creador del grupo |
| `createdAt` | `number \| null` | Timestamp de creacion |
| `ephemeralExpiration` | `number \| null` | Duracion de mensajes temporales (segundos) |

---

## Notas

> **JID de chats:**
> - Chats individuales: `{numero}@s.whatsapp.net` (ej: `5491112345678@s.whatsapp.net`)
> - Grupos: `{id}@g.us` (ej: `123456789@g.us`)
> - Linked IDs (LID): `{id}@lid` (formato interno de WhatsApp)

> **Salir de grupos:** Al llamar `remove()` en un grupo, primero se sale del grupo y luego se elimina el chat local con cascade delete.

> **Propiedad pined:** El getter `pined` retorna `boolean` (`true` si `raw.pinned` existe). El timestamp real de fijacion esta en `raw.pinned`. No confundir el getter booleano con el campo numerico del raw.
