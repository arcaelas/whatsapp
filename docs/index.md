# @arcaelas/whatsapp

![Banner](assets/banner.png)

A TypeScript library for WhatsApp automation built on top of [baileys v7](https://github.com/WhiskeySockets/Baileys). It ships a class-based core, pluggable persistence engines, and a Stage 3 decorator DSL for building bots — all without external API keys.

---

## Features

- **Class-based API**: a single `WhatsApp` orchestrator with the `Contact`, `Chat` and `Message` entities bound to the session. The socket and the credentials stay private — you interact through methods and events.
- **Pluggable engines**: `SQLiteEngine` (the fastest built-in), `FileSystemEngine` for local development, `RedisEngine` and `S3Engine` for distributed deployments, or implement your own `Engine`.
- **Ten message types**: text, image, video, audio, sticker, document, location, poll, vCard and calendar event — each one a subclass with its own getters (`width`, `duration`, `waveform`, `options`, …).
- **Status broadcasts**: publish and consume statuses through the `Feed` entity and the `feed:*` events.
- **Decorator DSL**: optional `@arcaelas/whatsapp/decorators` sub-entry with `@Bot`, `@on`, `@once`, `@guard`, `@from`, `@command`, `@pipe`, `@every`, `@delay`, `@pair`.
- **Full event system**: `connected`, `disconnected`, `message:*`, `chat:*`, `contact:*`, `feed:*` — every listener receives the artifact first and the client last.
- **Identifier resolution**: transparent normalization between phone numbers, JID (`@s.whatsapp.net`) and LID (`@lid`).
- **Multi-account isolation**: each `WhatsApp` instance owns its engine namespace, so multiple sessions can coexist in the same process.

---

## Hello world

```typescript title="index.ts"
import WhatsApp, { FileSystemEngine } from "@arcaelas/whatsapp";
import { writeFileSync } from "node:fs";

const wa = new WhatsApp({
    engine: new FileSystemEngine(__dirname + "/.session"),
    phone: 5491112345678,
});

wa.on("connected", () => console.log("session ready"));

wa.on("message:created", async (msg, chat) => {
    if (!msg.me && msg.caption === "ping") {
        await msg.text("pong 🏓");
    }
});

// With `phone` the callback receives a PIN; without it, the QR as a PNG Buffer.
await wa.connect((code) => {
    if (typeof code === "string") console.log("PIN:", code);
    else writeFileSync("qr.png", code);
});
```

---

## Next steps

- [Installation](installation.md) — install the package and configure the runtime.
- [Getting Started](getting-started.md) — a guided tutorial from zero to a running bot.
- [References](references/whatsapp.md) — the full API surface of every class and option.
