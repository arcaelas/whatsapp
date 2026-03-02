# WhatsApp

Main class for WhatsApp connection and management.

---

## Import

```typescript
import { WhatsApp } from "@arcaelas/whatsapp";
```

---

## Constructor

```typescript
const wa = new WhatsApp(options?: IWhatsApp);
```

### Options (IWhatsApp)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `engine` | `Engine` | `FileEngine(".baileys/{phone}")` or `FileEngine(".baileys/default")` | Persistence engine |
| `phone` | `string \| number` | `undefined` | Phone number for pairing code |

When `phone` is provided, the default engine path is `.baileys/{phone}`. When `phone` is omitted, the default path is `.baileys/default`.

### Examples

```typescript
// Default (FileEngine with ".baileys/default")
const wa = new WhatsApp();

// With phone (FileEngine with ".baileys/5491112345678")
const wa = new WhatsApp({
  phone: "5491112345678",
});

// Phone as number
const wa = new WhatsApp({
  phone: 5491112345678,
});

// Custom engine
import { FileEngine } from "@arcaelas/whatsapp";
const wa = new WhatsApp({
  engine: new FileEngine(".baileys/my-bot"),
});
```

---

## Properties

### engine

```typescript
wa.engine: Engine
```

The persistence engine used.

### socket

```typescript
wa.socket: WASocket | null
```

The Baileys socket. `null` before connecting or when disconnected.

### event

```typescript
wa.event: EventEmitter<WhatsAppEventMap>
```

Node.js `EventEmitter` (from `node:events`) with typed events for all WhatsApp events.

### Chat

```typescript
wa.Chat: ReturnType<typeof chat>
```

Chat class bound to this instance. Includes both static methods (`get`, `list`, `pin`, `archive`, `mute`, `seen`, `remove`) and instance methods.

### Contact

```typescript
wa.Contact: ReturnType<typeof contact>
```

Contact class bound to this instance. Includes both static methods (`get`, `list`) and instance methods.

### Message

```typescript
wa.Message: ReturnType<typeof message>
```

Message class bound to this instance. Includes both static methods (`get`, `list`, `count`, `text`, `image`, `video`, `audio`, `location`, `poll`, `watch`) and instance methods.

---

## Methods

### pair()

Connects to WhatsApp and calls the callback with QR or pairing code.

- With `phone`: callback receives a pairing code string (called once).
- Without `phone`: callback receives a QR code as PNG Buffer (called periodically).

```typescript
await wa.pair(callback: (data: Buffer | string) => void | Promise<void>): Promise<void>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `callback` | `(data: Buffer \| string) => void` | Called with QR (Buffer) or pairing code (string) |

**Example:**

```typescript
await wa.pair(async (data) => {
  if (Buffer.isBuffer(data)) {
    // QR as PNG image
    require("fs").writeFileSync("qr.png", data);
    console.log("Scan QR code");
  } else {
    // Pairing code
    console.log("Enter code:", data);
  }
});
```

---

## Events

Events are accessed through `wa.event`:

```typescript
wa.event.on("event_name", (payload) => {
  // handle event
});
```

### Connection events

| Event | Payload | Description |
|-------|---------|-------------|
| `open` | `void` | Connection established |
| `close` | `void` | Connection closed (auto-reconnects) |
| `error` | `Error` | Connection error (e.g. logged out) |

### Data events

| Event | Payload | Description |
|-------|---------|-------------|
| `contact:created` | `Contact` | New contact |
| `contact:updated` | `Contact` | Contact updated |
| `chat:created` | `Chat` | New chat |
| `chat:updated` | `Chat` | Chat updated |
| `chat:deleted` | `string` | Chat deleted (cid) |
| `chat:pined` | `[string, number \| null]` | Chat pinned/unpinned (cid, pin timestamp or null) |
| `chat:archived` | `[string, boolean]` | Chat archived/unarchived (cid, archived) |
| `chat:muted` | `[string, number \| null]` | Chat muted/unmuted (cid, mute end timestamp or null) |
| `message:created` | `Message` | New message |
| `message:updated` | `Message` | Message updated (status, edited) |
| `message:deleted` | `[string, string]` | Message deleted (cid, mid) |
| `message:reacted` | `[string, string, string]` | Reaction (cid, mid, emoji) |

### Examples

```typescript
// Connection
wa.event.on("open", () => {
  console.log("Connected to WhatsApp");
});

wa.event.on("close", () => {
  console.log("Disconnected");
});

wa.event.on("error", (error) => {
  console.error("Error:", error.message);
});

// Messages
wa.event.on("message:created", async (msg) => {
  if (msg.me) return;
  console.log(`New message: ${msg.type}`);
});

// Chats
wa.event.on("chat:updated", (chat) => {
  console.log(`Chat updated: ${chat.name}`);
});

// Chat state changes
wa.event.on("chat:pined", (cid, pined) => {
  console.log(`Chat ${cid} ${pined ? "pinned" : "unpinned"}`);
});

wa.event.on("chat:archived", (cid, archived) => {
  console.log(`Chat ${cid} ${archived ? "archived" : "unarchived"}`);
});

wa.event.on("chat:muted", (cid, muted) => {
  console.log(`Chat ${cid} ${muted ? `muted until ${new Date(muted)}` : "unmuted"}`);
});
```

---

## Complete example

```typescript
import { WhatsApp } from "@arcaelas/whatsapp";

async function main() {
  const wa = new WhatsApp();

  // Events
  wa.event.on("open", () => console.log("Connected"));
  wa.event.on("close", () => console.log("Disconnected"));
  wa.event.on("error", (e) => console.error("Error:", e.message));

  // Messages
  wa.event.on("message:created", async (msg) => {
    if (msg.me || msg.type !== "text") return;

    const text = (await msg.content()).toString();

    if (text.toLowerCase() === "ping") {
      await msg.text("pong!");
    }
  });

  // Connect
  await wa.pair(async (data) => {
    if (Buffer.isBuffer(data)) {
      require("fs").writeFileSync("qr.png", data);
      console.log("Scan qr.png");
    } else {
      console.log("Code:", data);
    }
  });

  console.log("Bot ready!");
}

main().catch(console.error);
```
