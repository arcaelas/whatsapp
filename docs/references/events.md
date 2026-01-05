# Events

Complete list of events emitted by WhatsApp.

---

## Event handling

Events are accessed through `wa.event`:

```typescript
import { WhatsApp } from "@arcaelas/whatsapp";

const wa = new WhatsApp();

// Subscribe to event
wa.event.on("message:created", async (msg) => {
  console.log("New message:", msg.id);
});

// Subscribe once
wa.event.once("open", () => {
  console.log("First connection!");
});

// Remove listener
const handler = (msg: Message) => console.log(msg);
wa.event.on("message:created", handler);
wa.event.off("message:created", handler);
```

---

## Connection events

### open

Emitted when connection is established.

```typescript
wa.event.on("open", () => {
  console.log("Connected to WhatsApp");
});
```

**Payload:** `void`

### close

Emitted when connection is closed.

```typescript
wa.event.on("close", () => {
  console.log("Disconnected from WhatsApp");
});
```

**Payload:** `void`

### error

Emitted on connection error.

```typescript
wa.event.on("error", (error) => {
  console.error("Connection error:", error.message);
});
```

**Payload:** `Error`

---

## Contact events

### contact:created

Emitted when a new contact is added.

```typescript
wa.event.on("contact:created", (contact) => {
  console.log(`New contact: ${contact.name}`);
  console.log(`Phone: ${contact.phone}`);
});
```

**Payload:** `Contact`

### contact:updated

Emitted when a contact is updated.

```typescript
wa.event.on("contact:updated", (contact) => {
  console.log(`Contact updated: ${contact.name}`);
});
```

**Payload:** `Contact`

### contact:deleted

Emitted when a contact is deleted.

```typescript
wa.event.on("contact:deleted", (contact) => {
  console.log(`Contact deleted: ${contact.id}`);
});
```

**Payload:** `Contact`

---

## Chat events

### chat:created

Emitted when a new chat is created.

```typescript
wa.event.on("chat:created", (chat) => {
  console.log(`New chat: ${chat.name}`);
  console.log(`Type: ${chat.type}`);

  if (chat.type === "group") {
    console.log("New group!");
  }
});
```

**Payload:** `Chat`

### chat:updated

Emitted when a chat is updated.

```typescript
wa.event.on("chat:updated", (chat) => {
  console.log(`Chat updated: ${chat.name}`);

  if (chat.archived) {
    console.log("Chat was archived");
  }

  if (chat.muted > 0) {
    console.log(`Muted until: ${new Date(chat.muted)}`);
  }
});
```

**Payload:** `Chat`

### chat:deleted

Emitted when a chat is deleted.

```typescript
wa.event.on("chat:deleted", (cid) => {
  console.log(`Chat deleted: ${cid}`);
});
```

**Payload:** `string` (chat ID)

---

## Message events

### message:created

Emitted when a new message is received or sent.

```typescript
wa.event.on("message:created", async (msg) => {
  // Ignore own messages
  if (msg.me) return;

  console.log(`New message: ${msg.type}`);
  console.log(`From: ${msg.cid}`);
  console.log(`ID: ${msg.id}`);

  if (msg.type === "text") {
    const text = (await msg.content()).toString();
    console.log(`Text: ${text}`);
  }
});
```

**Payload:** `Message`

### message:updated

Emitted when a message is updated (status change, edited, etc.).

```typescript
wa.event.on("message:updated", (msg) => {
  console.log(`Message updated: ${msg.id}`);
  console.log(`New status: ${msg.status}`);

  if (msg.edited) {
    console.log("Message was edited");
  }
});
```

**Payload:** `Message`

### message:deleted

Emitted when a message is deleted.

```typescript
wa.event.on("message:deleted", (cid, mid) => {
  console.log(`Message deleted: ${mid}`);
  console.log(`From chat: ${cid}`);
});
```

**Payload:** `[cid: string, mid: string]`

### message:reacted

Emitted when a message receives a reaction.

```typescript
wa.event.on("message:reacted", (cid, mid, emoji) => {
  console.log(`Reaction ${emoji} on message ${mid} in chat ${cid}`);
});
```

**Payload:** `[cid: string, mid: string, emoji: string]`

---

## WhatsAppEventMap interface

```typescript
interface WhatsAppEventMap {
  open: [];
  close: [];
  error: [error: Error];
  "contact:created": [contact: Contact];
  "contact:updated": [contact: Contact];
  "contact:deleted": [contact: Contact];
  "chat:created": [chat: Chat];
  "chat:updated": [chat: Chat];
  "chat:deleted": [cid: string];
  "message:created": [message: Message];
  "message:updated": [message: Message];
  "message:deleted": [cid: string, mid: string];
  "message:reacted": [cid: string, mid: string, emoji: string];
}
```

---

## Complete example

```typescript
import { WhatsApp } from "@arcaelas/whatsapp";

async function main() {
  const wa = new WhatsApp();

  // Connection events
  wa.event.on("open", () => {
    console.log("[CONNECTED]");
  });

  wa.event.on("close", () => {
    console.log("[DISCONNECTED]");
  });

  wa.event.on("error", (error) => {
    console.error("[ERROR]", error.message);
  });

  // Contact events
  wa.event.on("contact:created", (contact) => {
    console.log(`[CONTACT+] ${contact.name}`);
  });

  wa.event.on("contact:updated", (contact) => {
    console.log(`[CONTACT~] ${contact.name}`);
  });

  // Chat events
  wa.event.on("chat:created", async (chat) => {
    console.log(`[CHAT+] ${chat.name} (${chat.type})`);

    if (chat.type === "group") {
      const members = await wa.Chat.members(chat.id, 0, 100);
      console.log(`  Members: ${members.length}`);
    }
  });

  wa.event.on("chat:updated", (chat) => {
    const flags = [];
    if (chat.pined) flags.push("pinned");
    if (chat.archived) flags.push("archived");
    if (chat.muted > 0) flags.push("muted");

    console.log(`[CHAT~] ${chat.name} [${flags.join(", ")}]`);
  });

  // Message events
  wa.event.on("message:created", async (msg) => {
    const direction = msg.me ? "→" : "←";
    console.log(`[MSG${direction}] ${msg.type} in ${msg.cid}`);

    if (!msg.me && msg.type === "text") {
      const text = (await msg.content()).toString();

      if (text.toLowerCase() === "ping") {
        await wa.Message.text(msg.cid, "pong!");
      }
    }
  });

  wa.event.on("message:updated", (msg) => {
    const status_names = ["PENDING", "SENT", "RECEIVED", "READ", "PLAYED"];
    console.log(`[MSG~] ${msg.id} → ${status_names[msg.status]}`);
  });

  // Connect
  await wa.pair(async (data) => {
    if (Buffer.isBuffer(data)) {
      require("fs").writeFileSync("qr.png", data);
      console.log("Scan qr.png");
    }
  });

  console.log("Bot ready - listening to events...");
}

main().catch(console.error);
```
