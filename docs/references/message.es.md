# Message

`Message` es la clase raíz para cada mensaje entrante o saliente de WhatsApp. Sigue una arquitectura de clase base única: `Message` posee la API completa de instancia (getters, persistencia, reacciones, respuestas, forwarding, eliminación, ediciones), y seis subclases especializadas sobrescriben `content()` y añaden helpers específicos del payload:

- `Text` — conversación y texto extendido.
- `Image` / `Video` / `Audio` — medios con helpers `stream()` y `content()`.
- `Gps` — ubicación estática y en vivo, con getters `lat`, `lng`, `link`, `live`.
- `Poll` — encuestas con múltiples opciones, agregación de votos y `select()` para votar.

La factory `message(wa)` devuelve un objeto delegado montado como `wa.Message`, que expone tanto las subclases (para verificaciones `instanceof`) como los métodos estáticos de envío/CRUD.

---

## Importación

```typescript title="imports.ts"
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";
```

Las subclases viven en `wa.Message`:

```typescript title="subclasses.ts"
// wa.Message.Text, wa.Message.Image, wa.Message.Video,
// wa.Message.Audio, wa.Message.Gps, wa.Message.Poll
```

---

## Constructor

Las instancias son construidas por la librería (`wa.Message.get`, `wa.Message.list`, payloads de eventos, resultados de `send*`). Si debes construir una manualmente, la forma es:

```typescript title="ctor.ts"
import type { IMessage } from "@arcaelas/whatsapp";

new wa.Message.Text({ wa, doc });
// doc: IMessage — el documento persistido desde el motor.
```

Bajo el capó, cada helper de envío llama a un `build_instance(doc)` interno que elige la subclase correcta según `doc.type` (`'text' | 'image' | 'video' | 'audio' | 'location' | 'poll'`).

---

## Jerarquía de clases y detección de tipo en runtime

Usa `instanceof` contra las subclases expuestas en `wa.Message`:

```typescript title="instanceof.ts" hl_lines="2 5 9 13 16 19"
wa.on("message:created", async (msg, chat) => {
  if (msg instanceof wa.Message.Text) {
    console.log("text:", msg.caption);
  }
  if (msg instanceof wa.Message.Image) {
    const bytes = await msg.content();
    console.log("image bytes:", bytes.length, "caption:", msg.caption);
  }
  if (msg instanceof wa.Message.Video) {
    const stream = await msg.stream();
    // pipe to S3, ffmpeg, etc.
  }
  if (msg instanceof wa.Message.Audio) {
    console.log("voice note?", msg.ptt);
  }
  if (msg instanceof wa.Message.Gps) {
    console.log("at", msg.lat, msg.lng, "live?", msg.live);
  }
  if (msg instanceof wa.Message.Poll) {
    console.log("question:", msg.caption, "opts:", msg.options);
  }
});
```

La vía rápida es `msg.type`, un getter síncrono que devuelve `MessageType`:

```typescript title="switch-type.ts"
switch (msg.type) {
  case "text": /* ... */ break;
  case "image": /* ... */ break;
  case "video": /* ... */ break;
  case "audio": /* ... */ break;
  case "location": /* ... */ break;
  case "poll": /* ... */ break;
}
```

---

## Propiedades

### `Message` base

| Propiedad | Tipo | Descripción |
| --------- | ---- | ----------- |
| `id` | `string` | Id del mensaje (el `key.id` en Baileys). |
| `cid` | `string` | JID del chat al que pertenece el mensaje. |
| `type` | `MessageType` | `'text' \| 'image' \| 'video' \| 'audio' \| 'location' \| 'poll'`. |
| `from` | `string` | JID del autor (síncrono, sin hidratación del contacto). |
| `mid` | `string \| null` | Id del mensaje citado (referencia de reply). |
| `me` | `boolean` | `true` cuando el mensaje fue enviado por la cuenta autenticada. |
| `caption` | `string` | Texto / caption de medios / pregunta de encuesta. Vacío para medios puros sin caption. |
| `starred` | `boolean` | Si el mensaje está destacado. |
| `forwarded` | `boolean` | Si el mensaje fue reenviado. |
| `once` | `boolean` | `true` cuando el mensaje tiene una expiración efímera establecida. |
| `created_at` | `number` | Timestamp en milisegundos. |
| `deleted_at` | `number \| null` | Timestamp absoluto de expiración cuando es efímero. |
| `status` | `MessageStatus` | Estado de entrega (ver enum abajo). |
| `edited` | `boolean` | `true` después de que `edit()` tuvo éxito. |

### `MessageStatus`

```typescript title="MessageStatus.ts"
export enum MessageStatus {
  ERROR = 0,
  PENDING = 1,
  SERVER_ACK = 2,
  DELIVERED = 3,
  READ = 4,
  PLAYED = 5,
}
```

### Extras de subclases

`Audio`

| Propiedad | Tipo | Notas |
| --------- | ---- | ----- |
| `ptt` | `boolean` | `true` para notas de voz push-to-talk. |

`Gps`

| Propiedad | Tipo | Notas |
| --------- | ---- | ----- |
| `lat` | `number` | Latitud en grados. |
| `lng` | `number` | Longitud en grados. |
| `link` | `string` | URL de Google Maps en zoom 15. |
| `live` | `boolean` | `true` para `liveLocationMessage`. |

`Poll`

| Propiedad | Tipo | Notas |
| --------- | ---- | ----- |
| `multiple` | `boolean` | `true` cuando se pueden seleccionar múltiples opciones. |
| `options` | `{ content: string; count: number }[]` | Opciones actualizadas con conteos de votos en vivo. |

### `IMessage`

```typescript title="IMessage.ts"
import type { WAMessage } from "baileys";

export type MessageType =
  | "text" | "image" | "video" | "audio" | "location" | "poll";

export interface IMessage {
  id: string;
  cid: string;
  mid: string | null;
  me: boolean;
  type: MessageType;
  author: string;
  status: MessageStatus;
  starred: boolean;
  forwarded: boolean;
  created_at: number;
  deleted_at: number | null;
  mime: string;
  caption: string;
  edited: boolean;
  raw: WAMessage;
}
```

---

## Métodos

### `chat(): Promise<Chat>`

Devuelve el `Chat` al que pertenece este mensaje. Prefiere el snapshot persistido; recurre a una instancia mínima construida desde el CID.

```typescript title="chat.ts"
const chat = await msg.chat();
await chat.typing(true);
```

### `author(): Promise<Contact>`

Resuelve el remitente como un `Contact` vía `wa.Contact.get(msg.from)`. Recurre a una instancia mínima si el contacto aún no está en el motor.

```typescript title="author.ts"
const sender = await msg.author();
console.log(sender.name, sender.phone);
```

### `content(): Promise<Buffer>`

Devuelve el payload del mensaje como un `Buffer`. Cada subclase sobrescribe este método:

| Subclase | Retorno |
| -------- | ------- |
| `Text` | `Buffer.from(caption, 'utf-8')` — sin round-trip al motor. |
| `Image` / `Video` / `Audio` | Cuerpo binario (caché del motor → fallback a `downloadMediaMessage`). |
| `Gps` / `Poll` | Bytes persistidos raw, si los hay. |
| `Message` base | Bytes persistidos raw, o buffer vacío. |

```typescript title="content.ts"
if (msg instanceof wa.Message.Image) {
  const bytes = await msg.content();
  // await uploadToS3(bytes);
}
```

### `stream(): Promise<Readable>` *(solo Image/Video/Audio)*

Devuelve un `Readable` que puedes canalizar sin cargar todo el medio en memoria. Cascada a través de caché del motor → `downloadMediaMessage` → buffer vacío.

```typescript title="stream.ts" hl_lines="4 5"
import { createWriteStream } from "node:fs";

if (msg instanceof wa.Message.Video) {
  const src = await msg.stream();
  const dst = createWriteStream("./out.mp4");
  src.pipe(dst);
}
```

### `react(emoji: string)`

Reacciona al mensaje. Pasa un string vacío para eliminar la reacción.

```typescript title="react.ts"
await msg.react("thumbs-up");
await msg.react(""); // eliminar
```

### `forward(target: ForwardTarget)`

`ForwardTarget = string | Chat | Contact`. Acepta un CID, un `Chat` o un `Contact` (usa `contact.chat.id`). Intenta un relay nativo primero y luego recurre a reenviar el payload como un nuevo mensaje para el tipo de contenido.

```typescript title="forward.ts"
await msg.forward("5215555555555@s.whatsapp.net");

const chat = await wa.Chat.get("120363000000000000@g.us");
await msg.forward(chat!);

const contact = await wa.Contact.get("5215555555555");
await msg.forward(contact!);
```

### `edit(text: string)`

Edita el texto/caption de un mensaje del que eres autor (`msg.me === true`). Reescribe el documento del motor y cambia `edited = true`.

```typescript title="edit.ts"
if (msg.me) {
  await msg.edit("Updated content");
}
```

### `delete(all: boolean = true)`

Elimina el mensaje. `all = true` (por defecto) lo elimina para todos; `all = false` lo elimina solo del dispositivo actual.

```typescript title="delete.ts"
await msg.delete();      // eliminar para todos
await msg.delete(false); // eliminar solo para mí
```

### `star(value: boolean)`

Destaca o retira destacado del mensaje y persiste la nueva bandera.

```typescript title="star.ts"
await msg.star(true);
```

### `seen()`

Marca este mensaje individual como leído.

```typescript title="seen.ts"
await msg.seen();
```

### `watch(handler: (msg: Message) => void): () => void`

Se suscribe a eventos `message:updated` filtrados a este mensaje. Devuelve una función de desuscripción.

```typescript title="watch.ts"
const unsubscribe = msg.watch((updated) => {
  console.log("status ->", updated.status);
});

// luego:
unsubscribe();
```

### Helpers de respuesta

Cada helper de envío está reflejado en la instancia como una respuesta (rellena automáticamente `mid` con el id del mensaje actual).

| Método | Signatura |
| ------ | --------- |
| `msg.text(caption, opts?)` | `(string, SendOptions) => Promise<Message \| null>` |
| `msg.image(buf, opts?)` | `(Buffer, SendMediaOptions) => Promise<Message \| null>` |
| `msg.video(buf, opts?)` | `(Buffer, SendMediaOptions) => Promise<Message \| null>` |
| `msg.audio(buf, opts?)` | `(Buffer, SendAudioOptions) => Promise<Message \| null>` |
| `msg.location(loc, opts?)` | `(LocationOptions, SendOptions) => Promise<Message \| null>` |
| `msg.poll(poll, opts?)` | `(PollOptions, SendOptions) => Promise<Message \| null>` |

```typescript title="reply.ts"
wa.on("message:created", async (msg, chat) => {
  if (msg instanceof wa.Message.Text && msg.caption.toLowerCase() === "ping") {
    await msg.text("pong");
  }
});
```

---

## Flujo de encuestas

Las encuestas son un caso especial. `Poll.options` expone conteos de votos en vivo, y `Poll.select(index | indices)` emite un voto desde la cuenta autenticada. Usa `multiple` para saber si se puede seleccionar más de una opción.

```typescript title="poll.ts" hl_lines="8 16 17"
// Crear una encuesta
const sent = await wa.Message.poll("5215555555555@s.whatsapp.net", {
  content: "What's for lunch?",
  options: [{ content: "Pizza" }, { content: "Tacos" }, { content: "Ramen" }],
});

// Reaccionar a actualizaciones de la encuesta
wa.on("message:updated", (msg) => {
  if (msg instanceof wa.Message.Poll) {
    for (const opt of msg.options) {
      console.log(opt.content, "->", opt.count);
    }
  }
});

// Votar (single o multi)
if (sent instanceof wa.Message.Poll) {
  await sent.select(0);          // votar por "Pizza"
  await sent.select([0, 2]);     // solo funciona si `multiple === true`
}
```

!!! info "Visibilidad del voto"
    `options[].count` se agrega a partir de `pollUpdates` almacenados en el `WAMessage` subyacente. Los conteos se actualizan cuando Baileys emite `message.update` para el mensaje de encuesta; escucha `message:updated` para refrescar tu UI.

---

## Ubicación en vivo (`Gps`)

`Gps` envuelve tanto `locationMessage` (estática) como `liveLocationMessage` (en vivo). Usa `.live` para distinguirlas; los otros getters (`lat`, `lng`, `link`) son idénticos para ambas.

```typescript title="gps.ts"
wa.on("message:updated", (msg) => {
  if (msg instanceof wa.Message.Gps && msg.live) {
    console.log("live update ->", msg.lat, msg.lng, msg.link);
  }
});
```

Enviar una ubicación estática:

```typescript title="send-location.ts"
await wa.Message.location("5215555555555@s.whatsapp.net", {
  lat: 19.4326,
  lng: -99.1332,
});
```

!!! warning "Ubicación en vivo"
    La bandera `LocationOptions.live` está reservada pero aún no es consumida por la ruta de envío; el cliente solo puede enviar pins estáticos. Recibir actualizaciones en vivo está totalmente soportado a través de `message:updated`.

---

## Audio (`ptt`)

`Audio.ptt` diferencia las notas de voz (push-to-talk) de los archivos de audio regulares. Al enviar, la bandera `SendAudioOptions.ptt` controla esto (por defecto `true` — nota de voz).

```typescript title="audio.ts"
import { readFileSync } from "node:fs";

// Enviar una nota de voz (por defecto)
await wa.Message.audio(cid, readFileSync("./note.ogg"));

// Enviar como un archivo de audio regular
await wa.Message.audio(cid, readFileSync("./song.mp3"), { ptt: false });

// Detectar en entrantes
wa.on("message:created", async (msg) => {
  if (msg instanceof wa.Message.Audio) {
    console.log(msg.ptt ? "voice note" : "audio file");
  }
});
```

---

## `ForwardTarget`

```typescript title="ForwardTarget.ts"
import type { Chat, Contact } from "@arcaelas/whatsapp";

export type ForwardTarget = string | Chat | Contact;
```

Entradas aceptadas:

- `string` — un CID (teléfono, JID o LID); resuelto internamente.
- `Chat` — usa `chat.id`.
- `Contact` — usa `contact.chat.id` (el JID 1:1).

---

## Opciones de envío

```typescript title="options.ts"
export interface SendOptions {
  mid?: string; // id del mensaje citado (reply)
}

export interface SendMediaOptions extends SendOptions {
  caption?: string;
}

export interface SendAudioOptions extends SendOptions {
  ptt?: boolean; // por defecto true (nota de voz)
}

export interface LocationOptions {
  lat: number;
  lng: number;
  live?: boolean; // reservado, aún no usado en envío
}

export interface PollOptions {
  content: string;                        // pregunta
  options: Array<{ content: string }>;    // opciones
}
```

---

## Estáticos (delegado vía `wa.Message`)

### CRUD

| Delegado | Signatura |
| -------- | --------- |
| `wa.Message.get` | `(cid: string, mid: string) => Promise<Message \| null>` |
| `wa.Message.list` | `(cid: string, offset?: number, limit?: number) => Promise<Message[]>` (por defecto `0, 50`) |
| `wa.Message.count` | `(cid: string) => Promise<number>` |
| `wa.Message.edit` | `(cid, mid, text) => Promise<boolean>` |
| `wa.Message.delete` | `(cid, mid, all?) => Promise<boolean>` (por defecto `true`) |
| `wa.Message.react` | `(cid, mid, emoji) => Promise<boolean>` |
| `wa.Message.forward` | `(cid, mid, target: ForwardTarget) => Promise<boolean>` |
| `wa.Message.seen` | `(cid, mid) => Promise<boolean>` |
| `wa.Message.star` | `(cid, mid, value: boolean) => Promise<boolean>` |
| `wa.Message.watch` | `(cid, mid, handler) => () => void` |

### Envío

| Delegado | Signatura |
| -------- | --------- |
| `wa.Message.text` | `(cid, caption, opts?: SendOptions) => Promise<Message \| null>` |
| `wa.Message.image` | `(cid, buf, opts?: SendMediaOptions) => Promise<Message \| null>` |
| `wa.Message.video` | `(cid, buf, opts?: SendMediaOptions) => Promise<Message \| null>` |
| `wa.Message.audio` | `(cid, buf, opts?: SendAudioOptions) => Promise<Message \| null>` |
| `wa.Message.location` | `(cid, loc: LocationOptions, opts?: SendOptions) => Promise<Message \| null>` |
| `wa.Message.poll` | `(cid, poll: PollOptions, opts?: SendOptions) => Promise<Message \| null>` |

### Ejemplo end-to-end

```typescript title="send-delegates.ts" hl_lines="13 17 22 24 26"
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";
import { readFileSync } from "node:fs";

const wa = new WhatsApp({
  engine: new FileSystemEngine({ path: "./.whatsapp" }),
});

await wa.connect();

const cid = "5215555555555@s.whatsapp.net";

// Texto básico
const greeting = await wa.Message.text(cid, "Hello from v3!");

// Reply (mid fija el mensaje citado)
if (greeting) {
  await wa.Message.text(cid, "And a follow-up.", { mid: greeting.id });
}

// Medios
await wa.Message.image(cid, readFileSync("./banner.png"), { caption: "Banner" });
await wa.Message.audio(cid, readFileSync("./note.ogg"), { ptt: true });

// Ubicación
await wa.Message.location(cid, { lat: 19.4326, lng: -99.1332 });

// Encuesta
await wa.Message.poll(cid, {
  content: "Pick a framework",
  options: [{ content: "Next" }, { content: "Remix" }, { content: "Astro" }],
});

// CRUD sobre mensajes existentes
const history = await wa.Message.list(cid, 0, 20);
for (const m of history) {
  if (m.me && !m.edited && m instanceof wa.Message.Text) {
    await wa.Message.edit(cid, m.id, `[edited] ${m.caption}`);
  }
}
```

!!! tip "Payloads de eventos"
    Los oyentes para `message:*` reciben `(msg, chat, wa)`. `msg` ya es una instancia de la subclase correcta, de modo que puedes ejecutar `instanceof` contra `wa.Message.Text`, `wa.Message.Image` y afines directamente, sin discriminación manual.
