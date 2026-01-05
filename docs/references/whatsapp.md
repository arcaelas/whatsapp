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
const wa = new WhatsApp(options?: WhatsAppOptions);
```

### Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `engine` | `Engine` | `FileEngine(".baileys/default")` | Persistence engine |
| `phone` | `string` | `undefined` | Phone number for pairing code |

### Examples

```typescript
// Default (FileEngine)
const wa = new WhatsApp();

// Custom path
import { FileEngine } from "@arcaelas/whatsapp";
const wa = new WhatsApp({
  engine: new FileEngine(".baileys/my-bot"),
});

// With phone for pairing code
const wa = new WhatsApp({
  phone: "5491112345678",
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

The Baileys socket. `null` before connecting.

### event

```typescript
wa.event: TypedEventEmitter<WhatsAppEventMap>
```

Typed event emitter for all WhatsApp events.

### Chat

```typescript
wa.Chat: typeof Chat
```

Chat class bound to this instance.

### Contact

```typescript
wa.Contact: typeof Contact
```

Contact class bound to this instance.

### Message

```typescript
wa.Message: typeof Message
```

Message class bound to this instance.

---

## Methods

### pair()

Connects to WhatsApp and calls the callback with QR or pairing code.

```typescript
await wa.pair(callback: (data: Buffer | string) => void | Promise<void>): Promise<void>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `callback` | `(data: Buffer \| string) => void` | Called with QR (Buffer) or code (string) |

**Example:**

```typescript
await wa.pair(async (data) => {
  if (Buffer.isBuffer(data)) {
    // QR as PNG image
    require("fs").writeFileSync("qr.png", data);
    console.log("Scan QR code");
  } else {
    // 8 digit pairing code
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
| `close` | `void` | Connection closed |
| `error` | `Error` | Connection error |

### Data events

| Event | Payload | Description |
|-------|---------|-------------|
| `contact:created` | `Contact` | New contact |
| `contact:updated` | `Contact` | Contact updated |
| `contact:deleted` | `Contact` | Contact deleted |
| `chat:created` | `Chat` | New chat |
| `chat:updated` | `Chat` | Chat updated |
| `chat:deleted` | `string` | Chat deleted (cid) |
| `message:created` | `Message` | New message |
| `message:updated` | `Message` | Message updated |
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
      await wa.Message.text(msg.cid, "pong!");
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
