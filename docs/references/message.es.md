# Message

Clase para gestionar mensajes de WhatsApp.

---

## Importacion

La clase se accede desde la instancia de WhatsApp:

```typescript
const wa = new WhatsApp();
wa.Message // Clase Message enlazada
```

---

## Propiedades

Propiedades disponibles en instancias de Message:

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `id` | `string` | ID unico del mensaje |
| `cid` | `string` | JID del chat |
| `mid` | `string \| null` | ID del mensaje padre (reply), `null` si no es respuesta |
| `me` | `boolean` | `true` si el mensaje es propio |
| `author` | `string` | JID del autor del mensaje |
| `type` | `MessageType` | Tipo: `text`, `image`, `video`, `audio`, `location`, `poll` |
| `mime` | `string` | Tipo MIME del contenido |
| `caption` | `string` | Texto o caption del mensaje |
| `status` | `MESSAGE_STATUS` | Estado del mensaje (enum numerico) |
| `starred` | `boolean` | `true` si el mensaje esta destacado |
| `forwarded` | `boolean` | `true` si el mensaje fue reenviado |
| `edited` | `boolean` | `true` si fue editado |
| `created_at` | `number` | Timestamp de creacion en milisegundos |
| `deleted_at` | `number \| null` | Timestamp de expiracion en ms (mensajes temporales) o `null` |

### Enum MESSAGE_STATUS

```typescript
enum MESSAGE_STATUS {
  ERROR = 0,      // Error al enviar
  PENDING = 1,    // Pendiente de envio
  SERVER_ACK = 2, // Servidor confirmo recepcion
  DELIVERED = 3,  // Entregado al destinatario
  READ = 4,       // Leido por el destinatario
  PLAYED = 5,     // Reproducido (audio/video)
}
```

### Tipo MessageType

```typescript
type MessageType = "text" | "image" | "video" | "audio" | "location" | "poll";
```

---

## Metodos estaticos

### `Message.get(cid, mid)`

Obtiene un mensaje por chat ID y message ID.

```typescript
const msg = await wa.Message.get(
  "5491112345678@s.whatsapp.net",
  "MESSAGE_ID"
);

if (msg) {
  console.log(`Tipo: ${msg.type}`);
  console.log(`Caption: ${msg.caption}`);
}
```

### `Message.list(cid, offset?, limit?)`

Lista mensajes de un chat con paginacion. Los mensajes se obtienen del indice `chat/{cid}/messages`.

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `cid` | `string` | - | ID del chat |
| `offset` | `number` | `0` | Posicion inicial |
| `limit` | `number` | `50` | Cantidad maxima |

```typescript
const messages = await wa.Message.list("5491112345678@s.whatsapp.net", 0, 50);
for (const msg of messages) {
  console.log(`${msg.type}: ${msg.caption}`);
}
```

### `Message.count(cid)`

Cuenta mensajes de un chat.

```typescript
const count = await wa.Message.count("5491112345678@s.whatsapp.net");
console.log(`Total de mensajes: ${count}`);
```

### `Message.text(cid, text, mid?)`

Envia un mensaje de texto. El parametro `mid` opcional permite responder a un mensaje especifico.

```typescript
// Enviar texto
const msg = await wa.Message.text(
  "5491112345678@s.whatsapp.net",
  "Hola mundo!"
);

// Responder a un mensaje
const reply = await wa.Message.text(
  "5491112345678@s.whatsapp.net",
  "Esta es una respuesta",
  "MESSAGE_ID_ORIGINAL"
);
```

### `Message.image(cid, buffer, caption?, mid?)`

Envia una imagen.

```typescript
import * as fs from "fs";

const buffer = fs.readFileSync("./foto.jpg");
const msg = await wa.Message.image(
  "5491112345678@s.whatsapp.net",
  buffer,
  "Mira esta foto!"
);

// Responder con imagen
const reply = await wa.Message.image(
  "5491112345678@s.whatsapp.net",
  buffer,
  "Respuesta con imagen",
  "MESSAGE_ID_ORIGINAL"
);
```

### `Message.video(cid, buffer, caption?, mid?)`

Envia un video.

```typescript
const buffer = fs.readFileSync("./video.mp4");
const msg = await wa.Message.video(
  "5491112345678@s.whatsapp.net",
  buffer,
  "Video divertido"
);
```

### `Message.audio(cid, buffer, ptt?, mid?)`

Envia un audio. Por defecto como nota de voz (PTT).

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `cid` | `string` | - | ID del chat destino |
| `buffer` | `Buffer` | - | Buffer del audio |
| `ptt` | `boolean` | `true` | `true` para nota de voz, `false` para audio normal |
| `mid` | `string` | - | ID del mensaje a responder (opcional) |

```typescript
const buffer = fs.readFileSync("./audio.ogg");

// Como nota de voz (default)
await wa.Message.audio("5491112345678@s.whatsapp.net", buffer);

// Como audio normal
await wa.Message.audio("5491112345678@s.whatsapp.net", buffer, false);
```

### `Message.location(cid, opts, mid?)`

Envia una ubicacion.

```typescript
await wa.Message.location("5491112345678@s.whatsapp.net", {
  lat: -34.6037,
  lng: -58.3816,
});
```

**Interfaz LocationOptions:**

```typescript
interface LocationOptions {
  lat: number;   // Latitud en grados
  lng: number;   // Longitud en grados
  live?: boolean; // true para ubicacion en tiempo real
}
```

### `Message.poll(cid, opts, mid?)`

Envia una encuesta.

```typescript
await wa.Message.poll("5491112345678@s.whatsapp.net", {
  content: "Cual es tu lenguaje favorito?",
  options: [
    { content: "JavaScript" },
    { content: "TypeScript" },
    { content: "Python" },
    { content: "Go" },
  ],
});
```

**Interfaz PollOptions:**

```typescript
interface PollOptions {
  content: string;  // Pregunta o titulo de la encuesta
  options: Array<{ content: string }>; // Opciones de respuesta
}
```

### `Message.edit(cid, mid, text)`

Edita un mensaje por chat ID y message ID. Delega a la instancia internamente.

```typescript
await wa.Message.edit(
  "5491112345678@s.whatsapp.net",
  "MESSAGE_ID",
  "Texto corregido"
);
```

### `Message.remove(cid, mid)`

Elimina un mensaje por chat ID y message ID. Delega a la instancia internamente.

```typescript
await wa.Message.remove("5491112345678@s.whatsapp.net", "MESSAGE_ID");
```

### `Message.react(cid, mid, emoji)`

Reacciona a un mensaje por chat ID y message ID. Delega a la instancia internamente.

```typescript
await wa.Message.react("5491112345678@s.whatsapp.net", "MESSAGE_ID", "👍");
```

### `Message.forward(cid, mid, to_cid)`

Reenvia un mensaje a otro chat por chat ID y message ID. Delega a la instancia internamente.

```typescript
await wa.Message.forward(
  "5491112345678@s.whatsapp.net",
  "MESSAGE_ID",
  "123456789@g.us"
);
```

### `Message.watch(cid, mid, handler)`

Observa cambios en un mensaje especifico (ediciones, actualizaciones).

```typescript
const unsubscribe = wa.Message.watch(
  "CHAT_ID",
  "MESSAGE_ID",
  (msg) => {
    console.log(`Mensaje actualizado: ${msg.caption}`);
  }
);

// Dejar de observar
unsubscribe();
```

---

## Metodos de instancia

### `content()`

Obtiene el contenido del mensaje como Buffer. Primero busca en cache del engine, luego usa `stream()`.

El contenido varia segun el tipo:

| Tipo | Contenido |
|------|-----------|
| `text` | Texto como Buffer UTF-8 |
| `image` | Buffer de la imagen |
| `video` | Buffer del video |
| `audio` | Buffer del audio |
| `location` | JSON `{ lat, lng }` como Buffer |
| `poll` | JSON `{ content, options }` como Buffer |

```typescript
wa.event.on("message:created", async (msg) => {
  const buffer = await msg.content();

  if (msg.type === "text") {
    const text = buffer.toString();
    console.log(`Texto: ${text}`);
  } else if (msg.type === "image") {
    require("fs").writeFileSync("imagen.jpg", buffer);
  } else if (msg.type === "location") {
    const { lat, lng } = JSON.parse(buffer.toString());
    console.log(`Ubicacion: ${lat}, ${lng}`);
  }
});
```

### `stream()`

Obtiene el contenido del mensaje como `Readable` stream. Para media (image, video, audio) descarga desde WhatsApp si hay socket conectado.

```typescript
const msg = await wa.Message.get(cid, mid);
if (msg) {
  const readable = await msg.stream();
  // Pipe a archivo, HTTP response, etc.
}
```

### `edit(text)`

Edita el mensaje (solo texto o caption, solo mensajes propios). Actualiza el indice y el raw en el engine.

```typescript
const msg = await wa.Message.get("CHAT_ID", "MESSAGE_ID");
if (msg && msg.me) {
  await msg.edit("Texto corregido");
  console.log(msg.edited); // true
}
```

### `remove()`

Elimina el mensaje para todos. Elimina del indice del chat y ejecuta cascade delete de las keys del mensaje.

```typescript
const msg = await wa.Message.get("CHAT_ID", "MESSAGE_ID");
if (msg) {
  await msg.remove();
}
```

### `forward(to_cid)`

Reenvia el mensaje a otro chat. Intenta reenvio nativo primero; si falla, usa fallback reenviando el contenido.

```typescript
const msg = await wa.Message.get("CHAT_ORIGEN", "MESSAGE_ID");
if (msg) {
  await msg.forward("CHAT_DESTINO");
}
```

### `react(emoji)`

Reacciona al mensaje. Pasar string vacio para quitar la reaccion.

```typescript
const msg = await wa.Message.get("CHAT_ID", "MESSAGE_ID");
if (msg) {
  await msg.react("thumbsup");  // Agregar reaccion
  await msg.react("");    // Quitar reaccion
}
```

### Metodos de respuesta (reply)

Cada uno de estos metodos envia una respuesta vinculada al mensaje actual (usando `this.id` como `mid`):

#### `text(content)`

```typescript
msg.text("Esta es una respuesta al mensaje");
```

#### `image(buffer, caption?)`

```typescript
msg.image(buffer, "Respuesta con imagen");
```

#### `video(buffer, caption?)`

```typescript
msg.video(buffer, "Respuesta con video");
```

#### `audio(buffer, ptt?)`

```typescript
msg.audio(buffer, true); // Nota de voz como respuesta
```

#### `location(opts)`

```typescript
msg.location({ lat: -34.6037, lng: -58.3816 });
```

#### `poll(opts)`

```typescript
msg.poll({
  content: "Respuesta con encuesta",
  options: [{ content: "Si" }, { content: "No" }],
});
```

---

## Verificar tipo de mensaje

### Usando propiedad type

```typescript
wa.event.on("message:created", async (msg) => {
  switch (msg.type) {
    case "text":
      const text = (await msg.content()).toString();
      console.log(`Texto: ${text}`);
      break;
    case "image":
      const imgBuffer = await msg.content();
      console.log(`Imagen: ${imgBuffer.length} bytes`);
      break;
    case "video":
      const vidBuffer = await msg.content();
      console.log(`Video: ${vidBuffer.length} bytes`);
      break;
    case "audio":
      const audBuffer = await msg.content();
      console.log(`Audio: ${audBuffer.length} bytes`);
      break;
    case "location":
      const { lat, lng } = JSON.parse((await msg.content()).toString());
      console.log(`Ubicacion: ${lat}, ${lng}`);
      break;
    case "poll":
      const poll = JSON.parse((await msg.content()).toString());
      console.log(`Encuesta: ${poll.content}`);
      break;
  }
});
```

---

## Ejemplos

### Guardar todos los medios

```typescript
import * as fs from "fs";
import * as path from "path";

const MEDIA_DIR = "./medios";
fs.mkdirSync(MEDIA_DIR, { recursive: true });

wa.event.on("message:created", async (msg) => {
  if (msg.me) return;

  const timestamp = Date.now();
  const buffer = await msg.content();

  if (msg.type === "image") {
    const ext = msg.mime.split("/")[1] || "jpg";
    fs.writeFileSync(path.join(MEDIA_DIR, `${timestamp}.${ext}`), buffer);
  } else if (msg.type === "video") {
    fs.writeFileSync(path.join(MEDIA_DIR, `${timestamp}.mp4`), buffer);
  } else if (msg.type === "audio") {
    fs.writeFileSync(path.join(MEDIA_DIR, `${timestamp}.ogg`), buffer);
  }
});
```

### Bot de ubicacion

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "location") return;

  const { lat, lng } = JSON.parse((await msg.content()).toString());

  await msg.text(
    `Recibi tu ubicacion:\n` +
    `Lat: ${lat}\n` +
    `Lng: ${lng}\n` +
    `Google Maps: https://maps.google.com/?q=${lat},${lng}`
  );
});
```

### Bot de encuestas

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "text") return;

  const text = (await msg.content()).toString();

  // Crear encuesta con comando
  if (text.startsWith("!encuesta ")) {
    const parts = text.slice(10).split("|").map(s => s.trim());
    const [question, ...options] = parts;

    if (options.length >= 2) {
      await wa.Message.poll(msg.cid, {
        content: question,
        options: options.map(opt => ({ content: opt })),
      });
    } else {
      await msg.text("Uso: !encuesta Pregunta | Opcion1 | Opcion2 | ...");
    }
  }
});
```

### Eco con reaccion

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "text") return;

  const text = (await msg.content()).toString();

  if (text.startsWith("!eco ")) {
    // Reaccionar al mensaje original
    await msg.react("thumbsup");

    // Enviar eco como respuesta
    await msg.text(text.slice(5));
  }
});
```

---

## Interfaz IMessage

```typescript
interface IMessage {
  index: IMessageIndex;
  raw: WAMessage;
}
```

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `index` | `IMessageIndex` | Datos del indice del mensaje |
| `raw` | `WAMessage` | Objeto WAMessage original de Baileys |

---

## Interfaz IMessageIndex

Estructura principal del indice de un mensaje. Contiene todos los metadatos sin el contenido raw completo.

```typescript
interface IMessageIndex {
  id: string;
  cid: string;
  mid: string | null;
  me: boolean;
  type: MessageType;
  author: string;
  status: MESSAGE_STATUS;
  starred: boolean;
  forwarded: boolean;
  created_at: number;
  deleted_at: number | null;
  mime: string;
  caption: string;
  edited: boolean;
}
```

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `id` | `string` | ID unico del mensaje |
| `cid` | `string` | ID del chat |
| `mid` | `string \| null` | ID del mensaje padre (reply) |
| `me` | `boolean` | Si el mensaje es propio |
| `type` | `MessageType` | Tipo de mensaje |
| `author` | `string` | JID del autor |
| `status` | `MESSAGE_STATUS` | Estado de entrega |
| `starred` | `boolean` | Si esta destacado |
| `forwarded` | `boolean` | Si fue reenviado |
| `created_at` | `number` | Timestamp de creacion (ms) |
| `deleted_at` | `number \| null` | Timestamp de expiracion (ms) o null |
| `mime` | `string` | Tipo MIME |
| `caption` | `string` | Caption del mensaje |
| `edited` | `boolean` | Si fue editado |

---

## Notas

> **Contenido de mensajes:** El metodo `content()` siempre retorna Buffer. Usa `.toString()` para texto o `JSON.parse()` para location/poll.

> **Media:** Para mensajes de media (image, video, audio), el contenido se descarga desde WhatsApp la primera vez y se almacena en cache en el engine.

> **Caption vs Content:** `caption` es el texto/descripcion del mensaje (disponible inmediatamente). `content()` es el contenido completo (puede requerir descarga).

> **Parametro mid:** Todos los metodos de envio estaticos (`text`, `image`, `video`, `audio`, `location`, `poll`) aceptan un parametro opcional `mid` para responder a un mensaje especifico. Los metodos de instancia de respuesta lo usan automaticamente.
