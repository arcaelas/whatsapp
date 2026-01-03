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
| `pined` | `number \| null` | Timestamp cuando se fijo o `null` |
| `archived` | `boolean` | `true` si el chat esta archivado |
| `muted` | `number \| null` | Timestamp cuando expira el silencio o `null` |

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

### `Chat.pin(cid, value)`

Fija o desfija un chat.

```typescript
// Fijar
await wa.Chat.pin("5491112345678@s.whatsapp.net", true);

// Desfijar
await wa.Chat.pin("5491112345678@s.whatsapp.net", false);
```

### `Chat.archive(cid, value)`

Archiva o desarchiva un chat.

```typescript
// Archivar
await wa.Chat.archive("5491112345678@s.whatsapp.net", true);

// Desarchivar
await wa.Chat.archive("5491112345678@s.whatsapp.net", false);
```

### `Chat.mute(cid, duration)`

Silencia o desilencia un chat.

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

// Silenciar por 1 semana
await wa.Chat.mute(
  "5491112345678@s.whatsapp.net",
  7 * 24 * 60 * 60 * 1000
);

// Desilenciar
await wa.Chat.mute("5491112345678@s.whatsapp.net", null);
```

### `Chat.seen(cid)`

Marca el ultimo mensaje del chat como leido.

```typescript
await wa.Chat.seen("5491112345678@s.whatsapp.net");
```

### `Chat.remove(cid)`

Elimina un chat. Si es grupo, sale del grupo antes de eliminar.

```typescript
await wa.Chat.remove("5491112345678@s.whatsapp.net");
```

### `Chat.members(cid, offset, limit)`

Obtiene los miembros del chat.

- En chats individuales: retorna el contacto
- En grupos: retorna los participantes del grupo

```typescript
// Miembros de un grupo
const members = await wa.Chat.members("123456789@g.us", 0, 50);
for (const member of members) {
  console.log(`${member.name} (${member.phone})`);
}

// Miembro de chat individual (retorna el contacto)
const contacts = await wa.Chat.members("5491112345678@s.whatsapp.net", 0, 1);
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
const group_id = "123456789@g.us";
const members = await wa.Chat.members(group_id, 0, 1000);

console.log(`Grupo tiene ${members.length} miembros:`);
for (const member of members) {
  console.log(`  - ${member.name}`);
}
```

### Silenciar grupos nuevos automaticamente

```typescript
wa.event.on("chat:created", async (chat) => {
  if (chat.type === "group") {
    // Silenciar por 1 año (efectivamente indefinido)
    await wa.Chat.mute(chat.id, 365 * 24 * 60 * 60 * 1000);
    console.log(`Grupo ${chat.name} silenciado automaticamente`);
  }
});
```

### Archivar chats inactivos

```typescript
// Archivar chats que no estan fijados ni silenciados
async function archive_inactive(wa: WhatsApp) {
  const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
  if (chat && !chat.pined && !chat.archived) {
    await wa.Chat.archive(chat.id, true);
  }
}
```

### Enviar mensaje a todos los miembros de un grupo

```typescript
async function broadcast_to_members(wa: WhatsApp, group_id: string, text: string) {
  const members = await wa.Chat.members(group_id, 0, 1000);

  for (const member of members) {
    // Enviar mensaje individual a cada miembro
    await wa.Message.text(member.id, text);
    // Esperar entre mensajes para evitar ban
    await new Promise(r => setTimeout(r, 2000));
  }
}
```

---

## Interfaz IChat

```typescript
interface IChat {
  id: string;
  name: string;
  type: "contact" | "group";
  pined: number | null;
  archived: boolean;
  muted: number | null;
}
```

---

## Notas

!!! info "JID de chats"
    - Chats individuales: `{numero}@s.whatsapp.net` (ej: `5491112345678@s.whatsapp.net`)
    - Grupos: `{id}@g.us` (ej: `123456789@g.us`)
    - Linked IDs (LID): `{id}@lid` (formato interno de WhatsApp)

!!! warning "Salir de grupos"
    Al llamar `Chat.remove()` en un grupo, primero se sale del grupo
    y luego se elimina el chat local.

!!! tip "Pined timestamp"
    El campo `pined` contiene el timestamp de cuando se fijo el chat.
    Util para ordenar chats fijados por orden de fijacion.
