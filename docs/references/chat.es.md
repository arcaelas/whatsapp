# Chat

La entidad `Chat` representa una conversación de WhatsApp, ya sea un chat 1:1 con un contacto o un grupo. Expone metadatos de solo lectura (nombre, descripción, estado fijado/archivado/silenciado) y métodos mutables que propagan los cambios a los servidores de WhatsApp y a la persistencia local vía el motor configurado.

Cada instancia está vinculada a un contexto `WhatsApp` a través de la factory `chat(wa)`, que también expone delegados estáticos como `wa.Chat.get(cid)`, `wa.Chat.list(offset, limit)` y atajos por acción (`pin`, `archive`, `mute`, `seen`, `clear`, `delete`).

---

## Importación

```typescript title="imports.ts"
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";
// o
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";
```

La clase `Chat` en sí no se exporta como un nombre de nivel superior. Accede al constructor vinculado a través de `wa.Chat` (devuelto por la factory `chat(wa)` cableada internamente por el constructor de `WhatsApp`).

---

## Constructor

Las instancias de `Chat` no están pensadas para construirse manualmente. Se producen mediante:

- `wa.Chat.get(cid)` — carga o inicializa por CID.
- `wa.Chat.list(offset, limit)` — lectura paginada de chats persistidos.
- `contact.chat` — propiedad eager en una instancia de `Contact` (chats 1:1).
- Payloads de eventos (`message:created`, `message:updated`, etc.) — el segundo argumento es siempre el `Chat` al que pertenece el mensaje.

```typescript title="bootstrap.ts"
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new RedisEngine({ url: "redis://127.0.0.1:6379" }),
});

await wa.connect();

const chat = await wa.Chat.get("5215555555555@s.whatsapp.net");
if (chat) {
  console.log(chat.name, chat.type);
}
```

!!! info "Auto-bootstrap"
    `wa.Chat.get(cid)` resuelve el CID (teléfono, JID o LID). Si no existe un registro en el motor pero el contacto es alcanzable, se crea y persiste un documento `IChatRaw` mínimo antes de devolver la instancia.

---

## Propiedades

Todas las propiedades son getters síncronos sobre el documento interno `_raw: IChatRaw`.

| Propiedad | Tipo | Descripción |
| --------- | ---- | ----------- |
| `id` | `string` | JID del chat (p. ej. `5215555555555@s.whatsapp.net` o `120363...@g.us`). |
| `cid` | `string` | Alias de `id`. Usa el que se lea mejor en tu código. |
| `type` | `"contact" \| "group"` | Derivado del sufijo del JID (`@g.us` → grupo). |
| `name` | `string` | Nombre local → display name → fallback del teléfono. |
| `content` | `string` | Descripción del grupo (string vacío para chats 1:1). |
| `pinned` | `boolean` | `true` cuando la bandera de pin está activada. |
| `archived` | `boolean` | `true` si el chat está archivado. |
| `muted` | `boolean` | `true` cuando el chat está silenciado y la ventana de silencio no ha expirado. |
| `read` | `boolean` | `true` cuando `unread_count === 0` y el chat no está marcado como no leído. |
| `readonly` | `boolean` | `true` para canales de broadcast/anuncios únicamente. |

### `IChatRaw`

Forma persistida que respalda cada instancia de `Chat`.

```typescript title="IChatRaw.ts"
export interface IChatRaw {
  id: string;
  name?: string | null;
  display_name?: string | null;
  description?: string | null;
  unread_count?: number | null;
  read_only?: boolean | null;
  archived?: boolean | null;
  pinned?: number | null;
  mute_end_time?: number | null;
  marked_as_unread?: boolean | null;
  participants?: GroupParticipant[] | null;
  created_by?: string | null;
  created_at?: number | null;
  ephemeral_expiration?: number | null;
}

export interface GroupParticipant {
  id: string;
  admin: string | null; // "admin" | "superadmin" | null
}
```

---

## Métodos

Los métodos de instancia que mutan estado siempre escriben primero al socket y luego persisten el nuevo snapshot al motor.

### `refresh()`

Re-hidrata los metadatos del chat desde el socket en vivo. Para grupos, obtiene los metadatos completos del grupo (subject, descripción, participantes, dueño). Para 1:1, refresca el perfil del contacto asociado y sincroniza el display name.

```typescript title="refresh.ts"
const chat = await wa.Chat.get(cid);
await chat?.refresh();
```

Devuelve `this` en caso de éxito, `null` si no hay socket activo.

### `pin(value: boolean)`

Fija o desfija el chat. Propaga a WhatsApp vía `chatModify` y requiere una referencia al último mensaje del chat.

```typescript title="pin.ts"
await chat.pin(true);  // fijar
await chat.pin(false); // desfijar
```

### `archive(value: boolean)`

Archiva o desarchiva el chat.

```typescript title="archive.ts"
await chat.archive(true);
```

### `mute(value: boolean)`

Silencia el chat. `true` silencia para siempre (internamente establecido a ~100 años). `false` restaura las notificaciones.

```typescript title="mute.ts"
await chat.mute(true);  // silenciar para siempre
await chat.mute(false); // reactivar notificaciones
```

### `seen()`

Marca cada mensaje del chat como leído. Lee el último mensaje persistido para construir la clave de ack.

```typescript title="seen.ts"
await chat.seen();
```

### `typing(on: boolean)` / `recording(on: boolean)`

Alternan los indicadores de presencia. Envían una llamada `sendPresenceUpdate` con `composing`/`recording` o `paused`.

```typescript title="typing.ts"
await chat.typing(true);
await new Promise((r) => setTimeout(r, 1_500));
await chat.typing(false);
```

!!! tip "Cadencia natural"
    Activa `typing(true)`, envía el mensaje, y luego `typing(false)` para imitar el comportamiento humano. Mantén la ventana corta (1-3 s); WhatsApp limpia `composing` automáticamente después de unos segundos.

### `clear()`

Limpia todos los mensajes persistidos del chat en el motor local. No toca el chat remoto.

```typescript title="clear.ts"
await chat.clear();
```

### `delete()`

Elimina el chat local y remotamente. Para grupos, abandona el grupo (`groupLeave`). Para 1:1, dispara `chatModify { delete: true }`. Elimina el documento del chat y todos los mensajes del motor.

```typescript title="delete.ts"
await chat.delete();
```

!!! warning "Irreversible"
    `delete()` hace cascada en el prefijo local `/chat/{cid}/message`. Haz un respaldo del snapshot de tu motor si necesitas el historial.

### `members(offset?: number, limit?: number)`

Devuelve los participantes del chat como instancias de `Contact`. Para chats 1:1, produce la otra parte (solo cuando `offset === 0`). Para grupos, pagina a través de `groupMetadata().participants`, hidratando cada participante vía `wa.Contact.get`.

```typescript title="members.ts"
const chat = await wa.Chat.get("120363000000000000@g.us");
if (chat?.type === "group") {
  let offset = 0;
  while (true) {
    const batch = await chat.members(offset, 50);
    if (batch.length === 0) break;
    for (const member of batch) {
      console.log(member.phone, member.name);
    }
    offset += batch.length;
  }
}
```

### `messages(offset?: number, limit?: number)`

Atajo para `wa.Message.list(this.id, offset, limit)`. Devuelve mensajes ordenados por mtime del motor DESC.

```typescript title="messages.ts"
const latest = await chat.messages(0, 20);
for (const msg of latest) {
  console.log(msg.type, msg.caption);
}
```

### `contact()` *(solo 1:1)*

Para chats 1:1, la forma más rápida de obtener la contraparte es a través de `wa.Contact.get(chat.id)`. Para el inverso (contacto → chat), usa la propiedad eager `contact.chat`.

```typescript title="contact-from-chat.ts"
const chat = await wa.Chat.get("5215555555555@s.whatsapp.net");
if (chat?.type === "contact") {
  const contact = await wa.Contact.get(chat.id);
  console.log(contact?.name);
}
```

---

## Estáticos (delegado vía `wa.Chat`)

Cada método mutable tiene un delegado estático vinculado a la instancia de `WhatsApp`. Resuelven el CID internamente y retornan `false`/`null` cuando no hay chat coincidente.

| Delegado | Signatura | Notas |
| -------- | --------- | ----- |
| `wa.Chat.get` | `(cid: string) => Promise<Chat \| null>` | Resuelve teléfono/JID/LID e inicializa desde contacto cuando falta. |
| `wa.Chat.list` | `(offset?: number, limit?: number) => Promise<Chat[]>` | Pagina chats persistidos por mtime DESC. Por defecto: `0, 50`. |
| `wa.Chat.pin` | `(cid: string, value: boolean) => Promise<boolean>` | |
| `wa.Chat.archive` | `(cid: string, value: boolean) => Promise<boolean>` | |
| `wa.Chat.mute` | `(cid: string, value: boolean) => Promise<boolean>` | |
| `wa.Chat.seen` | `(cid: string) => Promise<boolean>` | |
| `wa.Chat.clear` | `(cid: string) => Promise<boolean>` | Solo local. |
| `wa.Chat.delete` | `(cid: string) => Promise<boolean>` | Remoto + local. |

```typescript title="delegates.ts" hl_lines="12 13 14"
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new FileSystemEngine({ path: "./.whatsapp" }),
});

await wa.connect();

const cid = "5215555555555@s.whatsapp.net";

// Delegados de una línea — no necesitas hidratar la instancia de Chat primero
await wa.Chat.pin(cid, true);
await wa.Chat.mute(cid, true);
await wa.Chat.seen(cid);

// Listado paginado
const chats = await wa.Chat.list(0, 100);
console.log(`Tracking ${chats.length} chats.`);
```

!!! tip "Cuándo usar estáticos vs instancias"
    Usa delegados estáticos cuando ya tienes una cadena `cid` de un payload de evento o una referencia almacenada: ahorran un round-trip. Instancia un `Chat` cuando necesites metadatos (`name`, `type`, `members()`) o vayas a ejecutar varias operaciones sobre el mismo chat.
