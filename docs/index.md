# @arcaelas/whatsapp

![Banner](assets/banner.png)

A TypeScript library for WhatsApp automation built on top of [baileys v7](https://github.com/WhiskeySockets/Baileys). It ships a class-based core, pluggable persistence engines, and a Stage 3 decorator DSL for building bots — all without external API keys.

---

## Features

- **Class-based API**: a single `WhatsApp` orchestrator with `Message`, `Chat`, and `Contact` delegates.
- **Pluggable engines**: `FileSystemEngine` for local development, `RedisEngine` for production, or implement your own `Engine`.
- **Decorator DSL**: optional `@arcaelas/whatsapp/decorators` sub-entry with `@Bot`, `@on`, `@guard`, `@command`, `@pipe`, `@every`, `@pair`.
- **Full event system**: `connected`, `disconnected`, `message:*`, `chat:*`, `contact:*` — every listener receives `(payload, chat, wa)`.
- **Identifier resolution**: transparent normalization between phone numbers, JID (`@s.whatsapp.net`), and LID (`@lid`).
- **Multi-account isolation**: each `WhatsApp` instance owns its engine namespace, so multiple sessions can coexist in the same process.

---

## Hello world

```typescript title="index.ts"
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";
import { writeFileSync } from "node:fs";

const wa = new WhatsApp({
    engine: new FileSystemEngine(__dirname + "/.session"),
    phone: 584144709840,
});

wa.on("connected", () => console.log("session ready"));
wa.on("message:created", (msg, chat) => console.log(chat.id, msg.caption));

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
