# Media Sending

Examples of sending and receiving multimedia files.

---

## Send image

```typescript
import * as fs from "fs";

// From local file
const img = fs.readFileSync("photo.jpg");
await wa.Message.image("5491112345678@s.whatsapp.net", img, "Check out this photo!");

// From URL (download first)
const response = await fetch("https://example.com/image.jpg");
const buffer = Buffer.from(await response.arrayBuffer());
await wa.Message.image("5491112345678@s.whatsapp.net", buffer, "Image from internet");
```

---

## Send video

```typescript
import * as fs from "fs";

// From local file
const video = fs.readFileSync("video.mp4");
await wa.Message.video("5491112345678@s.whatsapp.net", video, "Interesting video");

// Note: WhatsApp compresses videos automatically
// For better quality, use short videos (<3 min) and 720p
```

---

## Send audio

```typescript
import * as fs from "fs";

// Voice note (PTT - Push to Talk) - default
const audio = fs.readFileSync("audio.ogg");
await wa.Message.audio("5491112345678@s.whatsapp.net", audio);

// Regular audio (without PTT)
await wa.Message.audio("5491112345678@s.whatsapp.net", audio, false);

// Supported formats: OGG with Opus codec (preferred), MP3, AAC
// WhatsApp automatically converts to OGG/Opus
```

---

## Send location

```typescript
// Static location
await wa.Message.location("5491112345678@s.whatsapp.net", {
  lat: -34.6037,
  lng: -58.3816
});
```

---

## Receive and save media

```typescript
import * as fs from "fs";
import * as path from "path";

const MEDIA_DIR = "./media";
fs.mkdirSync(MEDIA_DIR, { recursive: true });

wa.event.on("message:created", async (msg) => {
  if (msg.me) return;

  const timestamp = Date.now();
  const buffer = await msg.content();

  if (buffer.length === 0) return;

  // Image
  if (msg.type === "image") {
    const ext = msg.mime.split("/")[1] || "jpg";
    const filename = `${timestamp}.${ext}`;
    fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
    console.log(`Image saved: ${filename} (${buffer.length} bytes)`);
    if (msg.caption) {
      console.log(`Caption: ${msg.caption}`);
    }
  }

  // Video
  if (msg.type === "video") {
    const filename = `${timestamp}.mp4`;
    fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
    console.log(`Video saved: ${filename} (${buffer.length} bytes)`);
  }

  // Audio
  if (msg.type === "audio") {
    const filename = `${timestamp}.ogg`;
    fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
    console.log(`Audio saved: ${filename} (${buffer.length} bytes)`);
  }
});
```

---

## Forward media

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "text") return;

  const text = (await msg.content()).toString();

  // Command to forward media
  if (text.startsWith("!forward ")) {
    const target_phone = text.slice(9).trim();
    const target_jid = `${target_phone}@s.whatsapp.net`;

    // Get previous message (the one we want to forward)
    const prev_msg = await wa.Message.get(msg.cid, "PREVIOUS_MESSAGE_ID");

    if (prev_msg && ["image", "video", "audio"].includes(prev_msg.type)) {
      await prev_msg.forward(target_jid);
      await wa.Message.text(msg.cid, "Media forwarded!");
    }
  }
});
```

---

## Process images

```typescript
import sharp from "sharp"; // npm install sharp

wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "image") return;

  const buffer = await msg.content();
  if (buffer.length === 0) return;

  // Get metadata
  const metadata = await sharp(buffer).metadata();
  console.log(`Image: ${metadata.width}x${metadata.height}, ${metadata.format}`);

  // Resize
  const thumbnail = await sharp(buffer)
    .resize(100, 100, { fit: "cover" })
    .jpeg({ quality: 80 })
    .toBuffer();

  // Send thumbnail as reply
  await wa.Message.image(msg.cid, thumbnail, "Generated thumbnail");
});
```

---

## Transcribe audio

```typescript
// Example with OpenAI Whisper API
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";

const openai = new OpenAI();

wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "audio") return;

  const buffer = await msg.content();
  if (buffer.length === 0) return;

  // Save temporarily
  const temp_file = path.join("/tmp", `${Date.now()}.ogg`);
  fs.writeFileSync(temp_file, buffer);

  try {
    // Transcribe
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(temp_file),
      model: "whisper-1",
      language: "en",
    });

    await wa.Message.text(msg.cid, `Transcription:\n${transcription.text}`);
  } catch (error) {
    console.error("Error transcribing:", error);
  } finally {
    fs.unlinkSync(temp_file);
  }
});
```

---

## Limits and recommendations

| Type | Limit | Recommendation |
|------|-------|----------------|
| Image | 16 MB | < 5 MB, JPEG/PNG |
| Video | 64 MB | < 16 MB, MP4 H.264 |
| Audio | 16 MB | < 5 MB, OGG Opus |

!!! tip "Compression"
    WhatsApp automatically compresses media.
    For better quality, use optimized formats.

!!! warning "Timeout"
    Media download may take time. Consider using timeouts and retries.
