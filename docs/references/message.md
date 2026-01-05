# Message

Class for message handling and sending.

---

## Import

The Message class is accessed through the WhatsApp instance:

```typescript
const wa = new WhatsApp();
// wa.Message is available after instantiation
```

---

## Properties

Each Message instance has the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique message ID |
| `cid` | `string` | Chat ID (JID) |
| `mid` | `string \| null` | Parent message ID (for replies) |
| `me` | `boolean` | `true` if sent by the connected account |
| `author` | `string` | Message author JID |
| `type` | `MessageType` | Message type |
| `mime` | `string` | MIME type for media |
| `caption` | `string` | Caption/text content |
| `status` | `MESSAGE_STATUS` | Message status |
| `starred` | `boolean` | Starred message |
| `forwarded` | `boolean` | Forwarded message |
| `edited` | `boolean` | Edited message |
| `created_at` | `number` | Creation timestamp (ms) |
| `deleted_at` | `number \| null` | Expiration timestamp (ms) for ephemeral messages |

### MessageType

```typescript
type MessageType = "text" | "image" | "video" | "audio" | "location" | "poll";
```

### MESSAGE_STATUS

```typescript
enum MESSAGE_STATUS {
  ERROR = 0,
  PENDING = 1,
  SERVER_ACK = 2,
  DELIVERED = 3,
  READ = 4,
  PLAYED = 5
}
```

---

## Instance methods

### content()

Gets the message content as Buffer.

```typescript
const buffer = await msg.content(): Promise<Buffer>
```

**Returns:** `Promise<Buffer>` - Message content

**Example:**

```typescript
wa.event.on("message:created", async (msg) => {
  const buffer = await msg.content();

  if (msg.type === "text") {
    console.log("Text:", buffer.toString());
  }

  if (msg.type === "image") {
    require("fs").writeFileSync("image.jpg", buffer);
  }
});
```

---

## Static methods

### get()

Gets a specific message.

```typescript
const msg = await wa.Message.get(cid: string, mid: string): Promise<Message | null>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `cid` | `string` | Chat ID |
| `mid` | `string` | Message ID |

### text()

Sends a text message.

```typescript
const msg = await wa.Message.text(
  cid: string,
  text: string
): Promise<Message | null>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `cid` | `string` | Chat ID |
| `text` | `string` | Message text |

**Example:**

```typescript
await wa.Message.text("5491112345678@s.whatsapp.net", "Hello!");
```

### image()

Sends an image.

```typescript
const msg = await wa.Message.image(
  cid: string,
  buffer: Buffer,
  caption?: string
): Promise<Message | null>
```

**Example:**

```typescript
const img = require("fs").readFileSync("photo.jpg");
await wa.Message.image("5491112345678@s.whatsapp.net", img, "Check this out!");
```

### video()

Sends a video.

```typescript
const msg = await wa.Message.video(
  cid: string,
  buffer: Buffer,
  caption?: string
): Promise<Message | null>
```

**Example:**

```typescript
const vid = require("fs").readFileSync("video.mp4");
await wa.Message.video("5491112345678@s.whatsapp.net", vid, "Interesting video");
```

### audio()

Sends an audio (voice note).

```typescript
const msg = await wa.Message.audio(
  cid: string,
  buffer: Buffer,
  ptt?: boolean
): Promise<Message | null>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cid` | `string` | - | Chat ID |
| `buffer` | `Buffer` | - | Audio data |
| `ptt` | `boolean` | `true` | Push-to-talk (voice note) |

**Example:**

```typescript
const audio = require("fs").readFileSync("audio.ogg");
await wa.Message.audio("5491112345678@s.whatsapp.net", audio);

// Normal audio (not voice note)
await wa.Message.audio("5491112345678@s.whatsapp.net", audio, false);
```

### location()

Sends a location.

```typescript
const msg = await wa.Message.location(
  cid: string,
  coords: { lat: number; lng: number }
): Promise<Message | null>
```

**Example:**

```typescript
await wa.Message.location("5491112345678@s.whatsapp.net", {
  lat: -34.6037,
  lng: -58.3816
});
```

### poll()

Creates a poll.

```typescript
const msg = await wa.Message.poll(
  cid: string,
  poll: PollOptions
): Promise<Message | null>
```

**PollOptions:**

```typescript
interface PollOptions {
  content: string;
  options: Array<{ content: string }>;
}
```

**Example:**

```typescript
await wa.Message.poll("123456789@g.us", {
  content: "What should we eat?",
  options: [
    { content: "Pizza" },
    { content: "Sushi" },
    { content: "Burger" }
  ]
});
```

### react()

Reacts to a message.

```typescript
const success = await wa.Message.react(
  cid: string,
  mid: string,
  emoji: string
): Promise<boolean>
```

**Example:**

```typescript
// Add reaction
await wa.Message.react(msg.cid, msg.id, "👍");

// Remove reaction
await wa.Message.react(msg.cid, msg.id, "");
```

### remove()

Deletes a message.

```typescript
const success = await wa.Message.remove(cid: string, mid: string): Promise<boolean>
```

### forward()

Forwards a message to another chat.

```typescript
const success = await wa.Message.forward(
  cid: string,
  mid: string,
  to_cid: string
): Promise<boolean>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `cid` | `string` | Original chat ID |
| `mid` | `string` | Message ID to forward |
| `to_cid` | `string` | Destination chat ID |

### edit()

Edits a text message.

```typescript
const success = await wa.Message.edit(
  cid: string,
  mid: string,
  text: string
): Promise<boolean>
```

!!! warning "Limitation"
    You can only edit your own messages.

### watch()

Observes changes on a specific message.

```typescript
const unsubscribe = wa.Message.watch(
  cid: string,
  mid: string,
  handler: (msg: Message) => void
): () => void
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `cid` | `string` | Chat ID |
| `mid` | `string` | Message ID |
| `handler` | `(msg: Message) => void` | Callback called when message changes |

**Returns:** `() => void` - Unsubscribe function

**Example:**

```typescript
const unsubscribe = wa.Message.watch(msg.cid, msg.id, (updated) => {
  console.log(`Message status: ${updated.status}`);
});

// Stop watching
unsubscribe();
```

### notify()

Notifies watchers of a message update (internal use).

```typescript
wa.Message.notify(cid: string, mid: string): void
```

---

## Complete example

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me) return;

  // Handle text
  if (msg.type === "text") {
    const text = (await msg.content()).toString();
    console.log(`Text: ${text}`);

    if (text === "!ping") {
      await wa.Message.text(msg.cid, "pong!");
    }
  }

  // Handle images
  if (msg.type === "image") {
    const buffer = await msg.content();
    console.log(`Image: ${buffer.length} bytes`);

    // Reply with reaction
    await wa.Message.react(msg.cid, msg.id, "👍");
  }

  // Handle polls
  if (msg.type === "poll") {
    const buffer = await msg.content();
    const poll = JSON.parse(buffer.toString());
    console.log(`Poll: ${poll.content}`);
  }
});
```
