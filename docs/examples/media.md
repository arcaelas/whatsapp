# Envio de Media

Ejemplos de envio y recepcion de archivos multimedia.

---

## Enviar imagen

```typescript
import * as fs from "fs";

// Desde archivo local
const img = fs.readFileSync("foto.jpg");
await wa.Message.Message.image("5491112345678@s.whatsapp.net", img, "Mira esta foto!");

// Desde URL (descargar primero)
const response = await fetch("https://example.com/image.jpg");
const buffer = Buffer.from(await response.arrayBuffer());
await wa.Message.Message.image("5491112345678@s.whatsapp.net", buffer, "Imagen de internet");

// Citando otro mensaje
await wa.Message.Message.image("CHAT_ID", img, "Respuesta con imagen", "MESSAGE_ID");
```

---

## Enviar video

```typescript
import * as fs from "fs";

// Desde archivo local
const video = fs.readFileSync("video.mp4");
await wa.Message.Message.video("5491112345678@s.whatsapp.net", video, "Video interesante");

// Nota: WhatsApp comprime los videos automaticamente
// Para mejor calidad, usa videos cortos (<3 min) y 720p
```

---

## Enviar audio

```typescript
import * as fs from "fs";

// Nota de voz (PTT - Push to Talk)
const audio = fs.readFileSync("audio.ogg");
await wa.Message.Message.audio("5491112345678@s.whatsapp.net", audio);

// Formatos soportados: OGG con codec Opus (preferido), MP3, AAC
// WhatsApp convierte automaticamente a OGG/Opus
```

---

## Enviar ubicacion

```typescript
// Ubicacion estatica
await wa.Message.Message.location("5491112345678@s.whatsapp.net", {
  lat: -34.6037,
  lng: -58.3816
});
```

---

## Recibir y guardar media

```typescript
import * as fs from "fs";
import * as path from "path";

const MEDIA_DIR = "./medios";
fs.mkdirSync(MEDIA_DIR, { recursive: true });

wa.on("message:created", async (msg) => {
  if (msg.me) return;

  const timestamp = Date.now();
  const author = msg.uid.split("@")[0];

  // Imagen
  if (msg instanceof wa.Message.Image) {
    const buffer = await msg.content();
    if (buffer.length === 0) return;

    const ext = msg.mime.split("/")[1] || "jpg";
    const filename = `${timestamp}_${author}.${ext}`;
    fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);

    console.log(`Imagen guardada: ${filename} (${buffer.length} bytes)`);
    if (msg.caption) {
      console.log(`Caption: ${msg.caption}`);
    }
  }

  // Video
  if (msg instanceof wa.Message.Video) {
    const buffer = await msg.content();
    if (buffer.length === 0) return;

    const filename = `${timestamp}_${author}.mp4`;
    fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);

    console.log(`Video guardado: ${filename} (${buffer.length} bytes)`);
  }

  // Audio
  if (msg instanceof wa.Message.Audio) {
    const buffer = await msg.content();
    if (buffer.length === 0) return;

    const filename = `${timestamp}_${author}.ogg`;
    fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);

    console.log(`Audio guardado: ${filename} (${buffer.length} bytes)`);
  }
});
```

---

## Reenviar media

```typescript
wa.on("message:created", async (msg) => {
  if (msg.me) return;

  const text = (await msg.content()).toString();

  // Comando para reenviar al ultimo chat
  if (text.startsWith("!reenviar ")) {
    const targetPhone = text.slice(10).trim();
    const targetJid = `${targetPhone}@s.whatsapp.net`;

    // El mensaje anterior puede ser media
    const messages = await wa.Message.Message.paginate(msg.cid, 0, 2);
    const mediaMsg = messages.find(m =>
      m.id !== msg.id && (
        m instanceof wa.Message.Image ||
        m instanceof wa.Message.Video ||
        m instanceof wa.Message.Audio
      )
    );

    if (mediaMsg) {
      await mediaMsg.forward(targetJid);
      await wa.Message.Message.text(msg.cid, "Media reenviada!");
    }
  }
});
```

---

## Procesar imagenes

```typescript
import sharp from "sharp"; // npm install sharp

wa.on("message:created", async (msg) => {
  if (msg.me) return;
  if (!(msg instanceof wa.Message.Image)) return;

  const buffer = await msg.content();
  if (buffer.length === 0) return;

  // Obtener metadata
  const metadata = await sharp(buffer).metadata();
  console.log(`Imagen: ${metadata.width}x${metadata.height}, ${metadata.format}`);

  // Redimensionar
  const thumbnail = await sharp(buffer)
    .resize(100, 100, { fit: "cover" })
    .jpeg({ quality: 80 })
    .toBuffer();

  // Enviar thumbnail como respuesta
  await wa.Message.Message.image(msg.cid, thumbnail, "Thumbnail generado", msg.id);
});
```

---

## Transcribir audio

```typescript
// Ejemplo con Whisper API de OpenAI
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";

const openai = new OpenAI();

wa.on("message:created", async (msg) => {
  if (msg.me) return;
  if (!(msg instanceof wa.Message.Audio)) return;

  const buffer = await msg.content();
  if (buffer.length === 0) return;

  // Guardar temporalmente
  const tempFile = path.join("/tmp", `${Date.now()}.ogg`);
  fs.writeFileSync(tempFile, buffer);

  try {
    // Transcribir
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFile),
      model: "whisper-1",
      language: "es",
    });

    await wa.Message.Message.text(msg.cid, `Transcripcion:\n${transcription.text}`, msg.id);
  } catch (error) {
    console.error("Error transcribiendo:", error);
  } finally {
    fs.unlinkSync(tempFile);
  }
});
```

---

## Limites y recomendaciones

| Tipo | Limite | Recomendacion |
|------|--------|---------------|
| Imagen | 16 MB | < 5 MB, JPEG/PNG |
| Video | 64 MB | < 16 MB, MP4 H.264 |
| Audio | 16 MB | < 5 MB, OGG Opus |

!!! tip "Compresion"
    WhatsApp comprime automaticamente los medios.
    Para mejor calidad, usa formatos optimizados.

!!! warning "Timeout"
    La descarga de media puede tardar. Considera usar timeouts y reintentos.
