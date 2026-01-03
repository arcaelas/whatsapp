# @arcaelas/whatsapp

![Banner](assets/banner.png)

> **TypeScript library for WhatsApp automation**
> Based on Baileys | Full typing | Flexible persistence engine | Easy to use

---

## Features

- **Simplified connection** - QR or pairing code in a single call
- **Typed events** - Full TypeScript with autocomplete
- **Flexible persistence** - FileEngine by default, or implement your own Engine
- **Intuitive classes** - Chat, Contact, Message with static methods
- **Multiple message types** - text, image, video, audio, location, poll
- **Group management** - List members, archive, mute, pin
- **Poll support** - Create polls with multiple options

---

## Quick Start

```typescript
import { WhatsApp } from "@arcaelas/whatsapp";

// Create instance
const wa = new WhatsApp({
  phone: "5491112345678", // Optional: for pairing code
});

// Listen to events
wa.event.on("open", () => console.log("Connected!"));
wa.event.on("close", () => console.log("Disconnected"));
wa.event.on("error", (err) => console.error("Error:", err.message));

// Connect
await wa.pair(async (data) => {
  if (Buffer.isBuffer(data)) {
    // QR code as PNG image
    require("fs").writeFileSync("qr.png", data);
    console.log("Scan the QR in qr.png");
  } else {
    // Pairing code (8 digits)
    console.log("Code:", data);
  }
});

// Listen to messages
wa.event.on("message:created", async (msg) => {
  if (msg.me) return; // Ignore own messages

  // Check type
  if (msg.type === "text") {
    const text = (await msg.content()).toString();
    console.log(`Message: ${text}`);

    // Reply
    if (text.toLowerCase() === "hello") {
      await wa.Message.text(msg.cid, "Hello! How are you?");
    }
  }
});
```

---

## Message Types

The library supports multiple message types:

| Type | `msg.type` | Description |
|------|------------|-------------|
| Text | `"text"` | Plain text message |
| Image | `"image"` | Image with optional caption |
| Video | `"video"` | Video with optional caption |
| Audio | `"audio"` | Voice note or audio |
| Location | `"location"` | Geographic coordinates |
| Poll | `"poll"` | Poll with options |

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me) return;

  if (msg.type === "image") {
    const buffer = await msg.content();
    console.log(`Image received: ${buffer.length} bytes`);
    if (msg.caption) {
      console.log(`Caption: ${msg.caption}`);
    }
  }

  if (msg.type === "poll") {
    const buffer = await msg.content();
    const poll = JSON.parse(buffer.toString());
    console.log(`Poll: ${poll.content}`);
    poll.options.forEach((opt: { content: string }, i: number) => {
      console.log(`  ${i + 1}. ${opt.content}`);
    });
  }
});
```

---

## Persistence Engine

By default `FileEngine` is used. You can implement your own engine:

=== "FileEngine (default)"
    ```typescript
    import { WhatsApp, FileEngine } from "@arcaelas/whatsapp";

    const wa = new WhatsApp({
      engine: new FileEngine(".baileys/my-bot"),
    });
    ```

=== "Custom engine"
    ```typescript
    import { WhatsApp } from "@arcaelas/whatsapp";
    import type { Engine } from "@arcaelas/whatsapp";

    // Implement the Engine interface
    class RedisEngine implements Engine {
      async get(key: string): Promise<string | null> { /* ... */ }
      async set(key: string, value: string | null): Promise<void> { /* ... */ }
      async list(prefix: string, offset?: number, limit?: number): Promise<string[]> { /* ... */ }
    }

    const wa = new WhatsApp({
      engine: new RedisEngine(),
    });
    ```

---

## Next Step

<div class="grid cards" markdown>

-   :material-download:{ .lg .middle } **Installation**

    ---

    Detailed instructions for installing the library

    [:octicons-arrow-right-24: View guide](installation.md)

-   :material-rocket-launch:{ .lg .middle } **Getting Started**

    ---

    Step by step tutorial to create your first bot

    [:octicons-arrow-right-24: Start](getting-started.md)

-   :material-api:{ .lg .middle } **API References**

    ---

    Complete documentation of all classes

    [:octicons-arrow-right-24: View API](references/whatsapp.md)

-   :material-code-tags:{ .lg .middle } **Examples**

    ---

    Practical ready-to-use examples

    [:octicons-arrow-right-24: View examples](examples/basic-bot.md)

</div>

---

**Developed by [Arcaelas Insiders](https://github.com/arcaelas)**
