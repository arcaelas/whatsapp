# Chat

La entidad `Chat` representa una conversación de WhatsApp, ya sea un chat 1:1 con un contacto o un
grupo. Expone metadatos de solo lectura mediante getters síncronos (nombre, tipo, estado
fijado/archivado/silenciado, no leídos) y métodos mutables que propagan los cambios a WhatsApp y a
la persistencia local vía el motor configurado.

Cada instancia está vinculada a un contexto `WhatsApp` a través de la factory interna `chat(wa)`,
que además expone los estáticos `wa.Chat.get(cid)` y `wa.Chat.list(offset, limit)`.

---

## Importación

```typescript title="imports.ts"
import { WhatsApp, Chat, FileSystemEngine } from "@arcaelas/whatsapp";
```

La clase `Chat` exportada es la clase **base**: lleva los getters y nada más. El constructor que
realmente usas es `wa.Chat`, la subclase vinculada a la sesión que agrega los métodos de abajo y los
estáticos.

!!! warning "Tipar tus propios helpers"
    Los chats que viajan en los eventos son instancias de la subclase vinculada. Anotar un parámetro
    con el `Chat` exportado esconde `members()`, `messages()`, `content()` y todos los métodos de
    acción. Deriva el tipo correcto en su lugar:

    ```typescript
    import type { WhatsApp } from '@arcaelas/whatsapp';

    type Conversation = InstanceType<WhatsApp['Chat']>;

    async function summarize(chat: Conversation) {
      const recent = await chat.messages(0, 20); // disponible
    }
    ```

---

## De dónde salen las instancias

- `wa.Chat.get(cid)` — carga por teléfono, JID, LID o id de grupo.
- `wa.Chat.list(offset, limit)` — lectura paginada de chats persistidos.
- `contact.chat()` — el chat 1:1 de un `Contact`.
- `msg.chat()` — el chat al que pertenece un mensaje.
- Payloads de eventos (`message:*`, `chat:*`, `contact:*`) — el `Chat` viaja con ellos.

```typescript title="bootstrap.ts"
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({ engine: new FileSystemEngine("./.whatsapp") });

await wa.connect((auth) => console.log(auth));

const chat = await wa.Chat.get("5215555555555");
if (chat) {
  console.log(chat.name, chat.type);
}
```

!!! info "`get` nunca escribe"
    `wa.Chat.get(cid)` resuelve el identificador y devuelve el documento persistido, o una
    **instancia mínima construida al vuelo** cuando el chat todavía no existe. La búsqueda en sí no
    persiste nada: el documento del chat aparece la primera vez que WhatsApp lo reporta
    (`chats.upsert`) o cuando llega un mensaje. Devuelve `null` solo si el identificador no se puede
    resolver.

---

## Propiedades

Todas las propiedades son getters síncronos sobre el documento interno `_raw`.

| Propiedad | Tipo | Descripción |
| --------- | ---- | ----------- |
| `id` | `string` | El **teléfono** en chats 1:1 (`5215555555555`), o el identificador crudo en grupos (`…@g.us`) y LIDs. |
| `name` | `string` | Nombre del grupo o del contacto; si falta, cae en `id`. |
| `type` | `'contact' \| 'group'` | Derivado del sufijo del identificador (`@g.us` → grupo). |
| `archived` | `boolean` | `true` si el chat está archivado. |
| `pinned` | `boolean` | `true` si el chat está fijado. |
| `count` | `number` | Mensajes sin leer. |
| `muted` | `string \| null` | **Fecha ISO UTC** hasta la que el chat está silenciado, o `null` si no lo está (o si la ventana ya venció). |

!!! warning "`id` no es un JID en chats 1:1"
    Un identificador `@s.whatsapp.net` se recorta hasta su teléfono, así que `chat.id` se lee como
    `5215555555555`. Ese valor se acepta en toda la librería (`wa.Message.text(chat.id, …)`,
    `wa.Chat.get(chat.id)`), porque los identificadores se normalizan internamente. Los grupos y los
    LIDs conservan su forma cruda. El identificador intacto siempre está en `chat._raw.id`.

!!! info "`muted` es una fecha, no un booleano"
    ```typescript
    if (chat.muted) {
      console.log("silenciado hasta", new Date(chat.muted).toLocaleString());
    }
    ```

Los getters `cid`, `content`, `read` y `readonly` ya no existen: usa `_raw.id` para el identificador
crudo, el método asíncrono [`content()`](#content) para la descripción y `count === 0` para saber si
está todo leído.

---

## Métodos

Los métodos mutables escriben primero al socket y luego persisten el nuevo snapshot en el motor.
Devuelven `false` cuando no hay socket vivo.

### `content()`

```typescript
content(): Promise<string>
```

La descripción del chat: el asunto del grupo en grupos, o la bio del contacto en un 1:1. Es
asíncrono porque ninguno de los dos vive en el documento del chat — los grupos pasan por
`groupMetadata` (con caché de 15 segundos) y los 1:1 leen el documento del contacto.

```typescript title="content.ts"
const description = await chat.content(); // '' cuando no hay
```

### `members(offset?, limit?)`

```typescript
members(offset = 0, limit = 50): Promise<Contact[]>
```

Participantes del chat como instancias de `Contact`: los integrantes en grupos; el contacto y tú en
un 1:1. Los metadatos del grupo se memorizan 15 segundos para no repetir el round-trip en cada
página.

```typescript title="members.ts"
const chat = await wa.Chat.get("120363000000000000@g.us");

if (chat?.type === "group") {
  let offset = 0;
  while (true) {
    const batch = await chat.members(offset, 50);
    if (batch.length === 0) {
      break;
    }
    for (const member of batch) {
      console.log(member.phone, member.name);
    }
    offset += batch.length;
  }
}
```

### `messages(offset?, limit?)`

```typescript
messages(offset = 0, limit = 50): Promise<Message[]>
```

Atajo de `wa.Message.list(chat._raw.id, offset, limit)`. Los mensajes llegan del más reciente al
más antiguo.

```typescript title="messages.ts"
const latest = await chat.messages(0, 20);

for (const msg of latest) {
  console.log(msg.type, msg.caption);
}
```

### `typing(value)` / `recording(value)`

Alternan los indicadores de presencia (`composing` / `recording`, o `paused` con `false`).

```typescript title="typing.ts"
await chat.typing(true);
await new Promise((r) => setTimeout(r, 1_500));
await chat.typing(false);
```

!!! tip "Cadencia natural"
    Activa `typing(true)`, envía el mensaje y luego `typing(false)` para imitar el comportamiento
    humano. Mantén la ventana corta (1–3 s) — WhatsApp limpia `composing` automáticamente a los
    pocos segundos.

### `archive(value)`

Archiva o desarchiva el chat en la cuenta.

```typescript title="archive.ts"
await chat.archive(true);
```

### `pin(value)`

Fija o desfija el chat.

```typescript title="pin.ts"
const ok = await chat.pin(true);
```

!!! warning "WhatsApp admite 3 chats fijados"
    El cuarto pin lo descarta WhatsApp en silencio, así que el límite se verifica **antes** de
    enviar: `pin(true)` devuelve `false` cuando ya hay otros tres chats fijados (o cuando el socket
    está caído) y no envía nada.

### `mute(until)`

```typescript
mute(until: string | number | Date | false): Promise<boolean>
```

Silencia el chat hasta la fecha indicada. `false` — o cualquier fecha pasada — lo des-silencia.

```typescript title="mute.ts"
await chat.mute("2026-08-01T10:00:00Z");       // string ISO
await chat.mute(Date.now() + 8 * 3_600_000);   // epoch ms
await chat.mute(new Date("2026-12-31"));       // Date
await chat.mute(false);                        // quitar el silencio
```

### `seen()`

Marca el chat completo como leído en la cuenta y deja `count` en `0`.

```typescript title="seen.ts"
await chat.seen();
```

### `clear()`

Vacía los mensajes del chat en la cuenta **y** en el motor, conservando el chat. Siempre devuelve
`true`: la limpieza local es idempotente, así que funciona incluso sin socket.

```typescript title="clear.ts"
await chat.clear();
```

### `delete()`

Elimina el chat y sus mensajes en la cuenta y en el motor. En grupos **abandona el grupo**
(`groupLeave`). Siempre devuelve `true`.

```typescript title="delete.ts"
await chat.delete();
```

!!! warning "Irreversible"
    `delete()` cae en cascada sobre el subárbol `/chat/<id>`, que incluye cada mensaje y su
    contenido almacenado. Respalda el snapshot del motor si necesitas el historial.

---

## Estáticos (vía `wa.Chat`)

| Estático | Firma | Notas |
| -------- | ----- | ----- |
| `wa.Chat.get` | `(cid: string \| number) => Promise<Chat \| null>` | Resuelve teléfono / JID / LID / id de grupo. `null` solo si no se puede resolver. |
| `wa.Chat.list` | `(offset?: number, limit?: number) => Promise<Chat[]>` | Pagina los chats persistidos, del más reciente al más antiguo. Por defecto: `0, 50`. |

No hay estáticos por acción (`wa.Chat.pin`, `wa.Chat.mute`, …): obtén el chat una vez y llama al
método en la instancia.

```typescript title="statics.ts" hl_lines="4 5 6"
const cid = "5215555555555";

const chat = await wa.Chat.get(cid);
if (chat) {
  await chat.pin(true);
  await chat.mute("2026-08-01T10:00:00Z");
  await chat.seen();
}

const chats = await wa.Chat.list(0, 100);
console.log(`Siguiendo ${chats.length} chats.`);
```

---

## Grupos

No hay una clase aparte para grupos: un grupo es un `Chat` cuyo identificador termina en `@g.us`.

```typescript title="groups.ts"
wa.on("message:created", async (msg, chat) => {
  if (chat.type === "group") {
    const author = await msg.author();
    console.log(`[${chat.name}] ${author.name}: ${msg.caption}`);
  }
});
```

| Quieres… | Usa |
| -------- | --- |
| El asunto / descripción | `await chat.content()` |
| Los participantes | `await chat.members(0, 500)` |
| Salir del grupo | `await chat.delete()` |
| Enviar al grupo | `await wa.Message.text(chat._raw.id, "…")` |
