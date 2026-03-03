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
| `index` | `IMessageIndex` | Message index data |
| `raw` | `WAMessage` | Protocol raw WAMessage |

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

### IMessageIndex

```typescript
interface IMessageIndex {
  id: string;
  cid: string;
  mid: string | null;
  me: boolean;
  type: MessageType;
  author: string;
  status: MESSAGE_STATUS;
  starred: boolean;
  forwarded: boolean;
  created_at: number;
  deleted_at: number | null;
  mime: string;
  caption: string;
  edited: boolean;
}
```

### IMessage

```typescript
interface IMessage {
  index: IMessageIndex;
  raw: WAMessage;
}
```

---

## Instance methods

### stream()

Gets the message content as a Readable stream. For text messages returns the text as a stream, for location/poll returns JSON. For media (image, video, audio) downloads from WhatsApp.

```typescript
await msg.stream(): Promise<Readable>
```

### content()

Gets the message content as Buffer. Uses cache from the engine when available, otherwise reads from `stream()`.

```typescript
await msg.content(): Promise<Buffer>
```

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

### edit()

Edits the message text or caption. Only works on own messages (`me === true`). Returns `false` if no socket or not own message.

```typescript
await msg.edit(text: string): Promise<boolean>
```

**Example:**

```typescript
const msg = await wa.Message.text("5491112345678@s.whatsapp.net", "Helllo!");
if (msg) {
  await msg.edit("Hello!");
}
```

!!! warning "Limitation"
    You can only edit your own messages.

### remove()

Deletes the message for everyone. Removes from the chat message index and performs cascade delete of stored message data.

```typescript
await msg.remove(): Promise<boolean>
```

**Example:**

```typescript
const msg = await wa.Message.get("5491112345678@s.whatsapp.net", "MESSAGE_ID");
if (msg) {
  await msg.remove();
}
```

### forward()

Forwards the message to another chat. Tries to use the native Baileys forward mechanism first, falls back to re-sending the content.

```typescript
await msg.forward(to_cid: string): Promise<boolean>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `to_cid` | `string` | Destination chat ID |

**Example:**

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.type === "image") {
    // Forward image to another chat
    await msg.forward("123456789@g.us");
  }
});
```

### react()

Reacts to the message with an emoji. Pass an empty string to remove the reaction.

```typescript
await msg.react(emoji: string): Promise<boolean>
```

**Example:**

```typescript
wa.event.on("message:created", async (msg) => {
  if (!msg.me && msg.type === "image") {
    await msg.react("👍");
  }
});

// Remove reaction
await msg.react("");
```

### Reply methods

Instance methods that reply to the current message (using the current message as quoted/parent). All return `Promise<Message | null>`.

#### text()

```typescript
await msg.text(content: string): Promise<Message | null>
```

#### image()

```typescript
await msg.image(buffer: Buffer, caption?: string): Promise<Message | null>
```

#### video()

```typescript
await msg.video(buffer: Buffer, caption?: string): Promise<Message | null>
```

#### audio()

```typescript
await msg.audio(buffer: Buffer, ptt?: boolean): Promise<Message | null>
```

#### location()

```typescript
await msg.location(opts: LocationOptions): Promise<Message | null>
```

#### poll()

```typescript
await msg.poll(opts: PollOptions): Promise<Message | null>
```

**Example:**

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me) return;

  const text = (await msg.content()).toString();

  if (text === "!ping") {
    // Reply to the message
    await msg.text("pong!");
  }

  if (text === "!location") {
    await msg.location({ lat: -34.6037, lng: -58.3816 });
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

### list()

Lists messages from a chat with pagination. Messages are ordered by most recent first.

```typescript
const messages = await wa.Message.list(cid: string, offset?: number, limit?: number): Promise<Message[]>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cid` | `string` | - | Chat ID |
| `offset` | `number` | `0` | Starting position |
| `limit` | `number` | `50` | Maximum messages |

**Example:**

```typescript
const messages = await wa.Message.list("5491112345678@s.whatsapp.net", 0, 100);
for (const msg of messages) {
  console.log(`${msg.type}: ${msg.caption}`);
}
```

### count()

Counts messages in a chat.

```typescript
const count = await wa.Message.count(cid: string): Promise<number>
```

**Example:**

```typescript
const count = await wa.Message.count("5491112345678@s.whatsapp.net");
console.log(`Total messages: ${count}`);
```

### text()

Sends a text message. Pass `mid` to quote/reply to a specific message.

```typescript
const msg = await wa.Message.text(
  cid: string,
  text: string,
  mid?: string
): Promise<Message | null>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `cid` | `string` | Chat ID |
| `text` | `string` | Message text |
| `mid` | `string` | (optional) Message ID to reply to |

**Example:**

```typescript
// Simple message
await wa.Message.text("5491112345678@s.whatsapp.net", "Hello!");

// Reply to a message
await wa.Message.text("5491112345678@s.whatsapp.net", "Reply!", "MESSAGE_ID");
```

### image()

Sends an image. Pass `mid` to quote/reply to a specific message.

```typescript
const msg = await wa.Message.image(
  cid: string,
  buffer: Buffer,
  caption?: string,
  mid?: string
): Promise<Message | null>
```

**Example:**

```typescript
const img = require("fs").readFileSync("photo.jpg");
await wa.Message.image("5491112345678@s.whatsapp.net", img, "Check this out!");

// Reply with image
await wa.Message.image("5491112345678@s.whatsapp.net", img, "Here!", "MESSAGE_ID");
```

### video()

Sends a video. Pass `mid` to quote/reply to a specific message.

```typescript
const msg = await wa.Message.video(
  cid: string,
  buffer: Buffer,
  caption?: string,
  mid?: string
): Promise<Message | null>
```

**Example:**

```typescript
const vid = require("fs").readFileSync("video.mp4");
await wa.Message.video("5491112345678@s.whatsapp.net", vid, "Interesting video");
```

### audio()

Sends an audio (voice note by default). Pass `mid` to quote/reply to a specific message.

```typescript
const msg = await wa.Message.audio(
  cid: string,
  buffer: Buffer,
  ptt?: boolean,
  mid?: string
): Promise<Message | null>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cid` | `string` | - | Chat ID |
| `buffer` | `Buffer` | - | Audio data |
| `ptt` | `boolean` | `true` | Push-to-talk (voice note) |
| `mid` | `string` | - | (optional) Message ID to reply to |

**Example:**

```typescript
const audio = require("fs").readFileSync("audio.ogg");
await wa.Message.audio("5491112345678@s.whatsapp.net", audio);

// Normal audio (not voice note)
await wa.Message.audio("5491112345678@s.whatsapp.net", audio, false);
```

### location()

Sends a location. Pass `mid` to quote/reply to a specific message.

```typescript
const msg = await wa.Message.location(
  cid: string,
  opts: LocationOptions,
  mid?: string
): Promise<Message | null>
```

**LocationOptions:**

```typescript
interface LocationOptions {
  lat: number;
  lng: number;
  live?: boolean;
}
```

**Example:**

```typescript
await wa.Message.location("5491112345678@s.whatsapp.net", {
  lat: -34.6037,
  lng: -58.3816
});
```

### poll()

Creates a poll. Pass `mid` to quote/reply to a specific message.

```typescript
const msg = await wa.Message.poll(
  cid: string,
  opts: PollOptions,
  mid?: string
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

### edit()

Edits a message by chat ID and message ID. Delegates to the instance method internally.

```typescript
const success = await wa.Message.edit(cid: string, mid: string, text: string): Promise<boolean>
```

**Example:**

```typescript
await wa.Message.edit("5491112345678@s.whatsapp.net", "MESSAGE_ID", "Corrected text");
```

### remove()

Deletes a message by chat ID and message ID. Delegates to the instance method internally.

```typescript
const success = await wa.Message.remove(cid: string, mid: string): Promise<boolean>
```

**Example:**

```typescript
await wa.Message.remove("5491112345678@s.whatsapp.net", "MESSAGE_ID");
```

### react()

Reacts to a message by chat ID and message ID. Delegates to the instance method internally.

```typescript
const success = await wa.Message.react(cid: string, mid: string, emoji: string): Promise<boolean>
```

**Example:**

```typescript
await wa.Message.react("5491112345678@s.whatsapp.net", "MESSAGE_ID", "👍");
```

### forward()

Forwards a message to another chat by chat ID and message ID. Delegates to the instance method internally.

```typescript
const success = await wa.Message.forward(cid: string, mid: string, to_cid: string): Promise<boolean>
```

**Example:**

```typescript
await wa.Message.forward("5491112345678@s.whatsapp.net", "MESSAGE_ID", "123456789@g.us");
```

### watch()

Observes changes on a specific message (status updates, edits, etc.).

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
      // Reply to the message
      await msg.text("pong!");
    }
  }

  // Handle images
  if (msg.type === "image") {
    const buffer = await msg.content();
    console.log(`Image: ${buffer.length} bytes`);

    // React to the message
    await msg.react("👍");
  }

  // Handle polls
  if (msg.type === "poll") {
    const buffer = await msg.content();
    const poll = JSON.parse(buffer.toString());
    console.log(`Poll: ${poll.content}`);
  }

  // Forward any media to a backup group
  if (["image", "video", "audio"].includes(msg.type)) {
    await msg.forward("123456789@g.us");
  }
});

// Track message delivery
wa.event.on("message:created", async (msg) => {
  if (!msg.me) return;

  const unsubscribe = wa.Message.watch(msg.cid, msg.id, (updated) => {
    if (updated.status >= 3) {
      console.log(`Message ${msg.id} delivered`);
      unsubscribe();
    }
  });
});

// Count messages in a chat
const count = await wa.Message.count("5491112345678@s.whatsapp.net");
console.log(`Total messages: ${count}`);
```
