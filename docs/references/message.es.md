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
| `me` | `boolean` | `true` si el mensaje es propio |
| `type` | `MessageType` | Tipo: `text`, `image`, `video`, `audio`, `location`, `poll` |
| `mime` | `string` | Tipo MIME del contenido |
| `caption` | `string` | Texto o caption del mensaje |
| `status` | `MESSAGE_STATUS` | Estado del mensaje (enum numerico) |
| `starred` | `boolean` | `true` si el mensaje esta destacado |
| `forwarded` | `boolean` | `true` si el mensaje fue reenviado |
| `edited` | `boolean` | `true` si fue editado |

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

### `Message.text(cid, text)`

Envia un mensaje de texto.

```typescript
const msg = await wa.Message.text(
  "5491112345678@s.whatsapp.net",
  "Hola mundo!"
);

if (msg) {
  console.log(`Mensaje enviado: ${msg.id}`);
}
```

### `Message.image(cid, buffer, caption?)`

Envia una imagen.

```typescript
import * as fs from "fs";

const buffer = fs.readFileSync("./foto.jpg");
const msg = await wa.Message.image(
  "5491112345678@s.whatsapp.net",
  buffer,
  "Mira esta foto!"
);
```

### `Message.video(cid, buffer, caption?)`

Envia un video.

```typescript
const buffer = fs.readFileSync("./video.mp4");
const msg = await wa.Message.video(
  "5491112345678@s.whatsapp.net",
  buffer,
  "Video divertido"
);
```

### `Message.audio(cid, buffer, ptt?)`

Envia un audio. Por defecto como nota de voz (PTT).

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `cid` | `string` | - | ID del chat destino |
| `buffer` | `Buffer` | - | Buffer del audio |
| `ptt` | `boolean` | `true` | `true` para nota de voz, `false` para audio normal |

```typescript
const buffer = fs.readFileSync("./audio.ogg");

// Como nota de voz (default)
await wa.Message.audio("5491112345678@s.whatsapp.net", buffer);

// Como audio normal
await wa.Message.audio("5491112345678@s.whatsapp.net", buffer, false);
```

### `Message.location(cid, opts)`

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

### `Message.poll(cid, opts)`

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

### `Message.react(cid, mid, emoji)`

Reacciona a un mensaje.

```typescript
// Agregar reaccion
await wa.Message.react("CHAT_ID", "MESSAGE_ID", "❤️");

// Quitar reaccion (emoji vacio)
await wa.Message.react("CHAT_ID", "MESSAGE_ID", "");
```

### `Message.remove(cid, mid)`

Elimina un mensaje para todos.

```typescript
await wa.Message.remove("CHAT_ID", "MESSAGE_ID");
```

### `Message.forward(cid, mid, to_cid)`

Reenvia un mensaje a otro chat.

```typescript
await wa.Message.forward(
  "CHAT_ORIGEN",
  "MESSAGE_ID",
  "CHAT_DESTINO"
);
```

### `Message.edit(cid, mid, text)`

Edita un mensaje de texto (solo mensajes propios).

```typescript
await wa.Message.edit("CHAT_ID", "MESSAGE_ID", "Texto corregido");
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

Obtiene el contenido del mensaje como Buffer.

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

  await wa.Message.text(
    msg.cid,
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
      await wa.Message.text(
        msg.cid,
        "Uso: !encuesta Pregunta | Opcion1 | Opcion2 | ..."
      );
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
    await wa.Message.react(msg.cid, msg.id, "👍");

    // Enviar eco
    await wa.Message.text(msg.cid, text.slice(5));
  }
});
```

---

## Interfaz IMessage

```typescript
interface IMessage {
  raw: WAMessage;  // WAMessage original de Baileys
  edited: boolean; // true si el mensaje fue editado
}
```

---

## Notas

!!! info "Contenido de mensajes"
    El metodo `content()` siempre retorna Buffer. Usa `.toString()` para texto
    o `JSON.parse()` para location/poll.

!!! warning "Media"
    Para mensajes de media (image, video, audio), el contenido se descarga
    desde WhatsApp la primera vez y se almacena en cache en el engine.

!!! tip "Caption vs Content"
    - `caption` es el texto/descripcion del mensaje (disponible inmediatamente)
    - `content()` es el contenido completo (puede requerir descarga)
