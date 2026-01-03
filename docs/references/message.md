# Message

Clases para manejar diferentes tipos de mensajes de WhatsApp.

---

## Importacion

Las clases se acceden desde la instancia de WhatsApp:

```typescript
const wa = new WhatsApp();

wa.Message.Message   // Clase base
wa.Message.Text      // Mensajes de texto
wa.Message.Image     // Imagenes
wa.Message.Video     // Videos
wa.Message.Audio     // Audios/notas de voz
wa.Message.Location  // Ubicaciones
wa.Message.Poll      // Encuestas
wa.Message.create    // Helper para crear instancias
```

---

## Message (clase base)

Clase base de la que heredan todos los tipos de mensaje.

### Propiedades

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `id` | `string` | ID unico del mensaje |
| `cid` | `string` | JID del chat |
| `uid` | `string` | JID del autor |
| `mid` | `string \| null` | ID del mensaje citado (si aplica) |
| `type` | `string` | Tipo: `text`, `image`, `video`, `audio`, `location`, `poll`, `unknown` |
| `mime` | `string` | Tipo MIME del contenido |
| `caption` | `string` | Descripcion/caption del mensaje |
| `me` | `boolean` | `true` si el mensaje es propio |
| `status` | `string` | Estado: `pending`, `sent`, `delivered`, `read` |
| `created_at` | `string` | Fecha de creacion (ISO 8601) |
| `edited` | `boolean` | `true` si fue editado |

### Metodos estaticos

#### `Message.get(cid, mid)`

Obtiene un mensaje por chat ID y message ID.

```typescript
const msg = await wa.Message.Message.get(
  "5491112345678@s.whatsapp.net",
  "MESSAGE_ID"
);

if (msg instanceof wa.Message.Text) {
  console.log("Es un mensaje de texto");
}
```

#### `Message.remove(cid, mid)`

Elimina un mensaje.

```typescript
await wa.Message.Message.remove("CHAT_ID", "MESSAGE_ID");
```

#### `Message.seen(cid, mid)`

Marca un mensaje como leido.

```typescript
await wa.Message.Message.seen("CHAT_ID", "MESSAGE_ID");
```

#### `Message.react(cid, mid, emoji)`

Reacciona a un mensaje.

```typescript
// Agregar reaccion
await wa.Message.Message.react("CHAT_ID", "MESSAGE_ID", "❤️");

// Quitar reaccion
await wa.Message.Message.react("CHAT_ID", "MESSAGE_ID", "");
```

#### `Message.forward(cid, mid, target)`

Reenvia un mensaje a otro chat.

```typescript
await wa.Message.Message.forward("CHAT_ID", "MESSAGE_ID", "TARGET_CHAT_ID");
```

#### `Message.paginate(cid, offset?, limit?)`

Obtiene mensajes paginados de un chat.

```typescript
// Primeros 20 mensajes
const messages = await wa.Message.Message.paginate("CHAT_ID");

// Con offset y limite
const page2 = await wa.Message.Message.paginate("CHAT_ID", 20, 20);
```

### Metodos estaticos de envio

#### `Message.text(cid, content, reply_mid?)`

Envia un mensaje de texto.

```typescript
// Enviar texto
await wa.Message.Message.text("5491112345678@s.whatsapp.net", "Hola!");

// Responder a un mensaje
await wa.Message.Message.text("CHAT_ID", "Esta es una respuesta", "MESSAGE_ID");
```

#### `Message.image(cid, data, caption?, reply_mid?)`

Envia una imagen.

```typescript
import * as fs from "fs";

const buffer = fs.readFileSync("./foto.jpg");
await wa.Message.Message.image("CHAT_ID", buffer, "Mira esta foto!");
```

#### `Message.video(cid, data, caption?, reply_mid?)`

Envia un video.

```typescript
const buffer = fs.readFileSync("./video.mp4");
await wa.Message.Message.video("CHAT_ID", buffer, "Video divertido");
```

#### `Message.audio(cid, data, ptt?, reply_mid?)`

Envia un audio. Por defecto como nota de voz (PTT).

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `ptt` | `boolean` | `true` | `true` para nota de voz, `false` para audio normal |

```typescript
const buffer = fs.readFileSync("./audio.ogg");

// Como nota de voz (default)
await wa.Message.Message.audio("CHAT_ID", buffer);

// Como audio normal
await wa.Message.Message.audio("CHAT_ID", buffer, false);
```

#### `Message.location(cid, coords, reply_mid?)`

Envia una ubicacion.

```typescript
await wa.Message.Message.location("CHAT_ID", {
  lat: -34.6037,
  lng: -58.3816
});
```

#### `Message.poll(cid, opts)`

Envia una encuesta.

```typescript
await wa.Message.Message.poll("CHAT_ID", {
  content: "Cual es tu lenguaje favorito?",
  items: [
    { content: "JavaScript" },
    { content: "TypeScript" },
    { content: "Python" },
    { content: "Go" }
  ]
});
```

### Metodos de instancia

```typescript
wa.on("message:created", async (msg) => {
  // Obtener contenido
  const buffer = await msg.content();

  // Eliminar
  await msg.remove();

  // Marcar como leido
  await msg.seen();

  // Reaccionar
  await msg.react("👍");

  // Obtener reacciones
  const reactions = await msg.reacts();

  // Reenviar a otro chat
  await msg.forward("TARGET_CHAT_ID");

  // Obtener chat
  const chat = await msg.chat();

  // Obtener autor
  const author = await msg.author();
});
```

---

## Text

Mensajes de texto plano.

### Propiedades adicionales

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `type` | `'text'` | Siempre es `'text'` |

### Metodos

#### `content()`

Retorna el texto como Buffer.

```typescript
if (msg instanceof wa.Message.Text) {
  const text = (await msg.content()).toString();
  console.log(text);
}
```

#### `edit(content)` (instancia)

Edita el mensaje (solo si es propio).

```typescript
if (msg instanceof wa.Message.Text && msg.me) {
  await msg.edit("Texto corregido");
}
```

#### `Text.edit(cid, mid, content)` (estatico)

```typescript
await wa.Message.Text.edit("CHAT_ID", "MESSAGE_ID", "Nuevo texto");
```

#### `forward(target_cid)` (instancia)

Reenvia el mensaje a otro chat.

```typescript
if (msg instanceof wa.Message.Text) {
  await msg.forward("5491198765432@s.whatsapp.net");
}
```

---

## Image

Mensajes con imagen.

### Propiedades adicionales

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `type` | `'image'` | Siempre es `'image'` |
| `caption` | `string` | Descripcion de la imagen |
| `mime` | `string` | MIME type (ej: `image/jpeg`) |

### Metodos

#### `content()`

Retorna la imagen como Buffer.

```typescript
if (msg instanceof wa.Message.Image) {
  const buffer = await msg.content();
  require("fs").writeFileSync("imagen.jpg", buffer);
  console.log(`Guardada: ${buffer.length} bytes`);
}
```

#### `forward(target_cid)`

Reenvia la imagen a otro chat.

```typescript
if (msg instanceof wa.Message.Image) {
  await msg.forward("5491198765432@s.whatsapp.net");
}
```

---

## Video

Mensajes con video.

### Propiedades adicionales

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `type` | `'video'` | Siempre es `'video'` |
| `caption` | `string` | Descripcion del video |
| `mime` | `string` | MIME type (ej: `video/mp4`) |

### Metodos

#### `content()`

Retorna el video como Buffer.

```typescript
if (msg instanceof wa.Message.Video) {
  const buffer = await msg.content();
  require("fs").writeFileSync("video.mp4", buffer);
}
```

#### `forward(target_cid)`

Reenvia el video a otro chat.

```typescript
if (msg instanceof wa.Message.Video) {
  await msg.forward("5491198765432@s.whatsapp.net");
}
```

---

## Audio

Notas de voz y audios.

### Propiedades adicionales

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `type` | `'audio'` | Siempre es `'audio'` |
| `mime` | `string` | MIME type (ej: `audio/ogg; codecs=opus`) |

### Metodos

#### `content()`

Retorna el audio como Buffer.

```typescript
if (msg instanceof wa.Message.Audio) {
  const buffer = await msg.content();
  require("fs").writeFileSync("audio.ogg", buffer);
}
```

#### `forward(target_cid)`

Reenvia el audio a otro chat.

```typescript
if (msg instanceof wa.Message.Audio) {
  await msg.forward("5491198765432@s.whatsapp.net");
}
```

---

## Location

Mensajes de ubicacion (estatica o en vivo).

### Propiedades adicionales

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `type` | `'location'` | Siempre es `'location'` |

### Metodos

#### `coords()`

Obtiene las coordenadas de la ubicacion.

```typescript
if (msg instanceof wa.Message.Location) {
  const coords = await msg.coords();
  if (coords) {
    console.log(`Latitud: ${coords.lat}`);
    console.log(`Longitud: ${coords.lng}`);
  }
}
```

#### `watch(callback)`

!!! warning "Experimental"
    Este metodo depende de que Baileys emita eventos `message:updated` para ubicaciones en vivo.
    La funcionalidad puede ser limitada o no funcionar segun la version de Baileys.

Observa cambios en ubicacion en vivo.

```typescript
if (msg instanceof wa.Message.Location) {
  const unsubscribe = msg.watch((coords) => {
    console.log(`Nueva posicion: ${coords.lat}, ${coords.lng}`);
  });

  // Dejar de observar despues de 5 minutos
  setTimeout(unsubscribe, 5 * 60 * 1000);
}
```

#### `Location.watch(cid, mid, callback)` (estatico)

!!! warning "Experimental"
    Mismo aviso que el metodo de instancia. La funcionalidad depende de eventos internos de Baileys.

```typescript
const unsubscribe = wa.Message.Location.watch(
  "CHAT_ID",
  "MESSAGE_ID",
  (coords) => console.log(coords)
);
```

#### `forward(target_cid)`

Reenvia la ubicacion a otro chat.

```typescript
if (msg instanceof wa.Message.Location) {
  await msg.forward("5491198765432@s.whatsapp.net");
}
```

---

## Poll

Mensajes de encuesta.

### Propiedades adicionales

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `type` | `'poll'` | Siempre es `'poll'` |

### Interfaz PollCountData

```typescript
interface PollCountData {
  content: string;
  items: Array<{
    content: string;
    count: number;
  }>;
}
```

### Metodos

#### `count()`

Obtiene los datos y conteo de votos de la encuesta.

```typescript
if (msg instanceof wa.Message.Poll) {
  const poll = await msg.count();
  if (poll) {
    console.log(`Pregunta: ${poll.content}`);
    poll.items.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.content}: ${item.count} votos`);
    });
  }
}
```

#### `Poll.count(cid, mid)` (estatico)

```typescript
const poll = await wa.Message.Poll.count("CHAT_ID", "MESSAGE_ID");
```

---

## Verificar tipo de mensaje

### Usando instanceof

```typescript
wa.on("message:created", async (msg) => {
  if (msg instanceof wa.Message.Text) {
    // Es texto
  } else if (msg instanceof wa.Message.Image) {
    // Es imagen
  } else if (msg instanceof wa.Message.Video) {
    // Es video
  } else if (msg instanceof wa.Message.Audio) {
    // Es audio
  } else if (msg instanceof wa.Message.Location) {
    // Es ubicacion
  } else if (msg instanceof wa.Message.Poll) {
    // Es encuesta
  } else {
    // Tipo desconocido
  }
});
```

### Usando propiedad type

```typescript
wa.on("message:created", async (msg) => {
  switch (msg.type) {
    case "text":
      break;
    case "image":
      break;
    case "video":
      break;
    case "audio":
      break;
    case "location":
      break;
    case "poll":
      break;
    default:
      console.log("Tipo desconocido:", msg.type);
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

wa.on("message:created", async (msg) => {
  if (msg.me) return;

  const timestamp = Date.now();

  if (msg instanceof wa.Message.Image) {
    const buffer = await msg.content();
    const ext = msg.mime.split("/")[1] || "jpg";
    fs.writeFileSync(path.join(MEDIA_DIR, `${timestamp}.${ext}`), buffer);
  }

  if (msg instanceof wa.Message.Video) {
    const buffer = await msg.content();
    fs.writeFileSync(path.join(MEDIA_DIR, `${timestamp}.mp4`), buffer);
  }

  if (msg instanceof wa.Message.Audio) {
    const buffer = await msg.content();
    fs.writeFileSync(path.join(MEDIA_DIR, `${timestamp}.ogg`), buffer);
  }
});
```

### Bot de ubicacion

```typescript
wa.on("message:created", async (msg) => {
  if (msg.me) return;

  if (msg instanceof wa.Message.Location) {
    const coords = await msg.coords();
    if (!coords) return;

    await wa.Message.Message.text(
      msg.cid,
      `Recibi tu ubicacion:\n` +
      `Lat: ${coords.lat}\n` +
      `Lng: ${coords.lng}\n` +
      `Google Maps: https://maps.google.com/?q=${coords.lat},${coords.lng}`,
      msg.id
    );
  }
});
```

### Bot de encuestas

```typescript
wa.on("message:created", async (msg) => {
  if (msg.me) return;
  if (!(msg instanceof wa.Message.Text)) return;

  const text = (await msg.content()).toString();

  // Crear encuesta con comando
  if (text.startsWith("!encuesta ")) {
    const parts = text.slice(10).split("|").map(s => s.trim());
    const [question, ...options] = parts;

    if (options.length >= 2) {
      await wa.Message.Message.poll(msg.cid, {
        content: question,
        items: options.map(opt => ({ content: opt }))
      });
    } else {
      await wa.Message.Message.text(msg.cid, "Uso: !encuesta Pregunta | Opcion1 | Opcion2 | ...");
    }
  }

  // Mostrar resultados de encuesta existente
  if (text === "!resultados") {
    const messages = await wa.Message.Message.paginate(msg.cid, 0, 50);
    const pollMsg = messages.find(m => m instanceof wa.Message.Poll);

    if (pollMsg && pollMsg instanceof wa.Message.Poll) {
      const data = await pollMsg.count();
      if (data) {
        let result = `*${data.content}*\n\n`;
        data.items.forEach((item, i) => {
          result += `${i + 1}. ${item.content}: ${item.count} votos\n`;
        });
        await wa.Message.Message.text(msg.cid, result);
      }
    } else {
      await wa.Message.Message.text(msg.cid, "No hay encuestas recientes");
    }
  }
});
```

---

## Interfaz IMessage

```typescript
interface IMessage {
  id: string;
  cid: string;
  uid: string;
  mid: string | null;
  type: "text" | "image" | "video" | "audio" | "location" | "poll" | "unknown";
  mime: string;
  caption: string;
  me: boolean;
  status: "pending" | "sent" | "delivered" | "read";
  created_at: string;
  edited: boolean;
}
```
