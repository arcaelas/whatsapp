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

Contact class bound to this instance. Includes both static methods (`get`, `list`, `rename`, `refresh`) and instance methods.

### Message

```typescript
wa.Message: ReturnType<typeof message>
```

Message class bound to this instance. Includes both static methods (`get`, `list`, `count`, `text`, `image`, `video`, `audio`, `location`, `poll`, `watch`, `edit`, `remove`, `react`, `forward`) and instance methods.

### resolveJID()

```typescript
await wa.resolveJID(uid: string): Promise<string | null>
```

Resolves any user identifier (JID, phone number, or LID) to a normalized JID (`@s.whatsapp.net` or `@g.us`). Returns `null` if the LID cannot be resolved.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `uid` | `string` | JID, phone number, or LID |

**Resolution rules:**

| Input | Output |
|-------|--------|
| `123@g.us` | `123@g.us` (unchanged) |
| `123@s.whatsapp.net` | `123@s.whatsapp.net` (unchanged) |
| `123@lid` | Resolved via `lid/` or `session/lid-mapping/` keys |
| `5491112345678` | `5491112345678@s.whatsapp.net` |

**Example:**

```typescript
const jid = await wa.resolveJID("5491112345678");
// "5491112345678@s.whatsapp.net"

const jid2 = await wa.resolveJID("123456@lid");
// "584144709840@s.whatsapp.net" (or null if unresolvable)
```

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
| `chat:pinned` | `Chat` | Chat pinned/unpinned |
| `chat:archived` | `Chat` | Chat archived/unarchived |
| `chat:muted` | `Chat` | Chat muted/unmuted |
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
wa.event.on("chat:pinned", (chat) => {
  console.log(`Chat ${chat.name} ${chat.pinned ? "pinned" : "unpinned"}`);
});

wa.event.on("chat:archived", (chat) => {
  console.log(`Chat ${chat.name} ${chat.archived ? "archived" : "unarchived"}`);
});

wa.event.on("chat:muted", (chat) => {
  console.log(`Chat ${chat.name} ${chat.muted ? `muted until ${new Date(chat.muted)}` : "unmuted"}`);
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
