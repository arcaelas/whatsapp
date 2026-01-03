# Envio de Media

Ejemplos de envio y recepcion de archivos multimedia.

---

## Enviar imagen

```typescript
import * as fs from "fs";

// Desde archivo local
const img = fs.readFileSync("foto.jpg");
await wa.Message.image("5491112345678@s.whatsapp.net", img, "Mira esta foto!");

// Desde URL (descargar primero)
const response = await fetch("https://example.com/image.jpg");
const buffer = Buffer.from(await response.arrayBuffer());
await wa.Message.image("5491112345678@s.whatsapp.net", buffer, "Imagen de internet");
```

---

## Enviar video

```typescript
import * as fs from "fs";

// Desde archivo local
const video = fs.readFileSync("video.mp4");
await wa.Message.video("5491112345678@s.whatsapp.net", video, "Video interesante");

// Nota: WhatsApp comprime los videos automaticamente
// Para mejor calidad, usa videos cortos (<3 min) y 720p
```

---

## Enviar audio

```typescript
import * as fs from "fs";

// Nota de voz (PTT - Push to Talk) - default
const audio = fs.readFileSync("audio.ogg");
await wa.Message.audio("5491112345678@s.whatsapp.net", audio);

// Audio normal (sin PTT)
await wa.Message.audio("5491112345678@s.whatsapp.net", audio, false);

// Formatos soportados: OGG con codec Opus (preferido), MP3, AAC
// WhatsApp convierte automaticamente a OGG/Opus
```

---

## Enviar ubicacion

```typescript
// Ubicacion estatica
await wa.Message.location("5491112345678@s.whatsapp.net", {
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

wa.event.on("message:created", async (msg) => {
  if (msg.me) return;

  const timestamp = Date.now();
  const buffer = await msg.content();

  if (buffer.length === 0) return;

  // Imagen
  if (msg.type === "image") {
    const ext = msg.mime.split("/")[1] || "jpg";
    const filename = `${timestamp}.${ext}`;
    fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
    console.log(`Imagen guardada: ${filename} (${buffer.length} bytes)`);
    if (msg.caption) {
      console.log(`Caption: ${msg.caption}`);
    }
  }

  // Video
  if (msg.type === "video") {
    const filename = `${timestamp}.mp4`;
    fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
    console.log(`Video guardado: ${filename} (${buffer.length} bytes)`);
  }

  // Audio
  if (msg.type === "audio") {
    const filename = `${timestamp}.ogg`;
    fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
    console.log(`Audio guardado: ${filename} (${buffer.length} bytes)`);
  }
});
```

---

## Reenviar media

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "text") return;

  const text = (await msg.content()).toString();

  // Comando para reenviar al ultimo mensaje
  if (text.startsWith("!reenviar ")) {
    const target_phone = text.slice(10).trim();
    const target_jid = `${target_phone}@s.whatsapp.net`;

    // Obtener mensaje anterior (el que queremos reenviar)
    const prev_msg = await wa.Message.get(msg.cid, "PREVIOUS_MESSAGE_ID");

    if (prev_msg && ["image", "video", "audio"].includes(prev_msg.type)) {
      await wa.Message.forward(msg.cid, prev_msg.id, target_jid);
      await wa.Message.text(msg.cid, "Media reenviada!");
    }
  }
});
```

---

## Procesar imagenes

```typescript
import sharp from "sharp"; // npm install sharp

wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "image") return;

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
  await wa.Message.image(msg.cid, thumbnail, "Thumbnail generado");
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

wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "audio") return;

  const buffer = await msg.content();
  if (buffer.length === 0) return;

  // Guardar temporalmente
  const temp_file = path.join("/tmp", `${Date.now()}.ogg`);
  fs.writeFileSync(temp_file, buffer);

  try {
    // Transcribir
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(temp_file),
      model: "whisper-1",
      language: "es",
    });

    await wa.Message.text(msg.cid, `Transcripcion:\n${transcription.text}`);
  } catch (error) {
    console.error("Error transcribiendo:", error);
  } finally {
    fs.unlinkSync(temp_file);
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
