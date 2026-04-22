# Message

`Message` is the root class for every incoming or outgoing WhatsApp message. It follows a single-base-class architecture: `Message` owns the full instance API (getters, persistence, reactions, replies, forwarding, deletion, edits), and six specialized subclasses override `content()` and add payload-specific helpers:

- `Text` — conversation and extended text.
- `Image` / `Video` / `Audio` — media with `stream()` and `content()` helpers.
- `Gps` — static and live location, with `lat`, `lng`, `link`, `live` getters.
- `Poll` — multi-option polls with vote aggregation and `select()` for voting.

The `message(wa)` factory returns a delegate object mounted as `wa.Message`, which exposes both the subclasses (for `instanceof` checks) and the static send/CRUD methods.

---

## Import

```typescript title="imports.ts"
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";
```

Subclasses live on `wa.Message`:

```typescript title="subclasses.ts"
// wa.Message.Text, wa.Message.Image, wa.Message.Video,
// wa.Message.Audio, wa.Message.Gps, wa.Message.Poll
```

---

## Constructor

Instances are built by the library (`wa.Message.get`, `wa.Message.list`, event payloads, `send*` results). If you must construct one manually, the shape is:

```typescript title="ctor.ts"
import type { IMessage } from "@arcaelas/whatsapp";

new wa.Message.Text({ wa, doc });
// doc: IMessage — the persisted document from the engine.
```

Under the hood, every send helper calls an internal `build_instance(doc)` that picks the right subclass based on `doc.type` (`'text' | 'image' | 'video' | 'audio' | 'location' | 'poll'`).

---

## Class hierarchy & runtime type detection

Use `instanceof` against the subclasses exposed on `wa.Message`:

```typescript title="instanceof.ts" hl_lines="2 5 9 13 16 19"
wa.on("message:created", async (msg, chat) => {
  if (msg instanceof wa.Message.Text) {
    console.log("text:", msg.caption);
  }
  if (msg instanceof wa.Message.Image) {
    const bytes = await msg.content();
    console.log("image bytes:", bytes.length, "caption:", msg.caption);
  }
  if (msg instanceof wa.Message.Video) {
    const stream = await msg.stream();
    // pipe to S3, ffmpeg, etc.
  }
  if (msg instanceof wa.Message.Audio) {
    console.log("voice note?", msg.ptt);
  }
  if (msg instanceof wa.Message.Gps) {
    console.log("at", msg.lat, msg.lng, "live?", msg.live);
  }
  if (msg instanceof wa.Message.Poll) {
    console.log("question:", msg.caption, "opts:", msg.options);
  }
});
```

The fast path is `msg.type`, a synchronous getter returning `MessageType`:

```typescript title="switch-type.ts"
switch (msg.type) {
  case "text": /* ... */ break;
  case "image": /* ... */ break;
  case "video": /* ... */ break;
  case "audio": /* ... */ break;
  case "location": /* ... */ break;
  case "poll": /* ... */ break;
}
```

---

## Properties

### Base `Message`

| Property | Type | Description |
| -------- | ---- | ----------- |
| `id` | `string` | Message id (the `key.id` in Baileys). |
| `cid` | `string` | JID of the chat the message belongs to. |
| `type` | `MessageType` | `'text' \| 'image' \| 'video' \| 'audio' \| 'location' \| 'poll'`. |
| `from` | `string` | JID of the author (sync — no contact hydration). |
| `mid` | `string \| null` | Quoted message id (reply reference). |
| `me` | `boolean` | `true` when the message was sent by the authenticated account. |
| `caption` | `string` | Text / media caption / poll question. Empty for pure media without caption. |
| `starred` | `boolean` | Whether the message is starred. |
| `forwarded` | `boolean` | Whether the message was forwarded. |
| `once` | `boolean` | `true` when the message has an ephemeral expiration set. |
| `created_at` | `number` | Timestamp in milliseconds. |
| `deleted_at` | `number \| null` | Absolute expiration timestamp when ephemeral. |
| `status` | `MessageStatus` | Delivery state (see enum below). |
| `edited` | `boolean` | `true` after `edit()` succeeded. |

### `MessageStatus`

```typescript title="MessageStatus.ts"
export enum MessageStatus {
  ERROR = 0,
  PENDING = 1,
  SERVER_ACK = 2,
  DELIVERED = 3,
  READ = 4,
  PLAYED = 5,
}
```

### Subclass extras

`Audio`

| Property | Type | Notes |
| -------- | ---- | ----- |
| `ptt` | `boolean` | `true` for push-to-talk voice notes. |

`Gps`

| Property | Type | Notes |
| -------- | ---- | ----- |
| `lat` | `number` | Latitude in degrees. |
| `lng` | `number` | Longitude in degrees. |
| `link` | `string` | Google Maps URL at zoom 15. |
| `live` | `boolean` | `true` for `liveLocationMessage`. |

`Poll`

| Property | Type | Notes |
| -------- | ---- | ----- |
| `multiple` | `boolean` | `true` when multiple options can be selected. |
| `options` | `{ content: string; count: number }[]` | Up-to-date choices with live vote counts. |

### `IMessage`

```typescript title="IMessage.ts"
import type { WAMessage } from "baileys";

export type MessageType =
  | "text" | "image" | "video" | "audio" | "location" | "poll";

export interface IMessage {
  id: string;
  cid: string;
  mid: string | null;
  me: boolean;
  type: MessageType;
  author: string;
  status: MessageStatus;
  starred: boolean;
  forwarded: boolean;
  created_at: number;
  deleted_at: number | null;
  mime: string;
  caption: string;
  edited: boolean;
  raw: WAMessage;
}
```

---

## Methods

### `chat(): Promise<Chat>`

Returns the `Chat` this message belongs to. Prefers the persisted snapshot; falls back to a minimal instance built from the CID.

```typescript title="chat.ts"
const chat = await msg.chat();
await chat.typing(true);
```

### `author(): Promise<Contact>`

Resolves the sender as a `Contact` via `wa.Contact.get(msg.from)`. Falls back to a minimal instance if the contact is not in the engine yet.

```typescript title="author.ts"
const sender = await msg.author();
console.log(sender.name, sender.phone);
```

### `content(): Promise<Buffer>`

Returns the message payload as a `Buffer`. Each subclass overrides this method:

| Subclass | Return |
| -------- | ------ |
| `Text` | `Buffer.from(caption, 'utf-8')` — no engine round-trip. |
| `Image` / `Video` / `Audio` | Binary body (engine cache → fallback to `downloadMediaMessage`). |
| `Gps` / `Poll` | Raw persisted bytes, if any. |
| Base `Message` | Raw persisted bytes, or empty buffer. |

```typescript title="content.ts"
if (msg instanceof wa.Message.Image) {
  const bytes = await msg.content();
  // await uploadToS3(bytes);
}
```

### `stream(): Promise<Readable>` *(Image/Video/Audio only)*

Returns a `Readable` that you can pipe without loading the full media into memory. Falls through engine cache → `downloadMediaMessage` → empty buffer.

```typescript title="stream.ts" hl_lines="4 5"
import { createWriteStream } from "node:fs";

if (msg instanceof wa.Message.Video) {
  const src = await msg.stream();
  const dst = createWriteStream("./out.mp4");
  src.pipe(dst);
}
```

### `react(emoji: string)`

Reacts to the message. Pass an empty string to remove the reaction.

```typescript title="react.ts"
await msg.react("thumbs-up");
await msg.react(""); // remove
```

### `forward(target: ForwardTarget)`

`ForwardTarget = string | Chat | Contact`. Accepts a CID, a `Chat`, or a `Contact` (uses `contact.chat.id`). Attempts a native relay first, then falls back to re-sending the payload as a new message for the content type.

```typescript title="forward.ts"
await msg.forward("5215555555555@s.whatsapp.net");

const chat = await wa.Chat.get("120363000000000000@g.us");
await msg.forward(chat!);

const contact = await wa.Contact.get("5215555555555");
await msg.forward(contact!);
```

### `edit(text: string)`

Edits the text/caption of a message you authored (`msg.me === true`). Rewrites the engine document and flips `edited = true`.

```typescript title="edit.ts"
if (msg.me) {
  await msg.edit("Updated content");
}
```

### `delete(all: boolean = true)`

Deletes the message. `all = true` (default) removes it for everyone; `all = false` removes it only from the current device.

```typescript title="delete.ts"
await msg.delete();      // delete for everyone
await msg.delete(false); // delete for me only
```

### `star(value: boolean)`

Stars or unstars the message and persists the new flag.

```typescript title="star.ts"
await msg.star(true);
```

### `seen()`

Marks this individual message as read.

```typescript title="seen.ts"
await msg.seen();
```

### `watch(handler: (msg: Message) => void): () => void`

Subscribes to `message:updated` events filtered to this message. Returns an unsubscribe function.

```typescript title="watch.ts"
const unsubscribe = msg.watch((updated) => {
  console.log("status ->", updated.status);
});

// later:
unsubscribe();
```

### Reply helpers

Every send helper is mirrored on the instance as a reply (automatically fills `mid` with the current message id).

| Method | Signature |
| ------ | --------- |
| `msg.text(caption, opts?)` | `(string, SendOptions) => Promise<Message \| null>` |
| `msg.image(buf, opts?)` | `(Buffer, SendMediaOptions) => Promise<Message \| null>` |
| `msg.video(buf, opts?)` | `(Buffer, SendMediaOptions) => Promise<Message \| null>` |
| `msg.audio(buf, opts?)` | `(Buffer, SendAudioOptions) => Promise<Message \| null>` |
| `msg.location(loc, opts?)` | `(LocationOptions, SendOptions) => Promise<Message \| null>` |
| `msg.poll(poll, opts?)` | `(PollOptions, SendOptions) => Promise<Message \| null>` |

```typescript title="reply.ts"
wa.on("message:created", async (msg, chat) => {
  if (msg instanceof wa.Message.Text && msg.caption.toLowerCase() === "ping") {
    await msg.text("pong");
  }
});
```

---

## Poll flow

Polls are a special case. `Poll.options` exposes live vote counts, and `Poll.select(index | indices)` casts a vote from the authenticated account. Use `multiple` to know whether more than one option can be selected.

```typescript title="poll.ts" hl_lines="8 16 17"
// Create a poll
const sent = await wa.Message.poll("5215555555555@s.whatsapp.net", {
  content: "What's for lunch?",
  options: [{ content: "Pizza" }, { content: "Tacos" }, { content: "Ramen" }],
});

// React to poll updates
wa.on("message:updated", (msg) => {
  if (msg instanceof wa.Message.Poll) {
    for (const opt of msg.options) {
      console.log(opt.content, "->", opt.count);
    }
  }
});

// Vote (single or multi)
if (sent instanceof wa.Message.Poll) {
  await sent.select(0);          // vote for "Pizza"
  await sent.select([0, 2]);     // only works if `multiple === true`
}
```

!!! info "Vote visibility"
    `options[].count` is aggregated from `pollUpdates` stored in the underlying `WAMessage`. Counts update when Baileys emits `message.update` for the poll message; listen to `message:updated` to refresh your UI.

---

## Live location (`Gps`)

`Gps` wraps both `locationMessage` (static) and `liveLocationMessage` (live). Use `.live` to tell them apart; the other getters (`lat`, `lng`, `link`) are identical for both.

```typescript title="gps.ts"
wa.on("message:updated", (msg) => {
  if (msg instanceof wa.Message.Gps && msg.live) {
    console.log("live update ->", msg.lat, msg.lng, msg.link);
  }
});
```

Send a static location:

```typescript title="send-location.ts"
await wa.Message.location("5215555555555@s.whatsapp.net", {
  lat: 19.4326,
  lng: -99.1332,
});
```

!!! warning "Live location"
    The `LocationOptions.live` flag is reserved but not yet consumed by the send path — the client can only send static pins. Receiving live updates is fully supported through `message:updated`.

---

## Audio (`ptt`)

`Audio.ptt` differentiates voice notes (push-to-talk) from regular audio files. When sending, the `SendAudioOptions.ptt` flag controls this (defaults to `true` — voice note).

```typescript title="audio.ts"
import { readFileSync } from "node:fs";

// Send a voice note (default)
await wa.Message.audio(cid, readFileSync("./note.ogg"));

// Send as a regular audio file
await wa.Message.audio(cid, readFileSync("./song.mp3"), { ptt: false });

// Detect on incoming
wa.on("message:created", async (msg) => {
  if (msg instanceof wa.Message.Audio) {
    console.log(msg.ptt ? "voice note" : "audio file");
  }
});
```

---

## `ForwardTarget`

```typescript title="ForwardTarget.ts"
import type { Chat, Contact } from "@arcaelas/whatsapp";

export type ForwardTarget = string | Chat | Contact;
```

Accepted inputs:

- `string` — a CID (phone, JID, or LID); resolved internally.
- `Chat` — uses `chat.id`.
- `Contact` — uses `contact.chat.id` (the 1:1 JID).

---

## Send options

```typescript title="options.ts"
export interface SendOptions {
  mid?: string; // quoted message id (reply)
}

export interface SendMediaOptions extends SendOptions {
  caption?: string;
}

export interface SendAudioOptions extends SendOptions {
  ptt?: boolean; // defaults to true (voice note)
}

export interface LocationOptions {
  lat: number;
  lng: number;
  live?: boolean; // reserved, not yet used on send
}

export interface PollOptions {
  content: string;                        // question
  options: Array<{ content: string }>;    // choices
}
```

---

## Static (delegate via `wa.Message`)

### CRUD

| Delegate | Signature |
| -------- | --------- |
| `wa.Message.get` | `(cid: string, mid: string) => Promise<Message \| null>` |
| `wa.Message.list` | `(cid: string, offset?: number, limit?: number) => Promise<Message[]>` (defaults `0, 50`) |
| `wa.Message.count` | `(cid: string) => Promise<number>` |
| `wa.Message.edit` | `(cid, mid, text) => Promise<boolean>` |
| `wa.Message.delete` | `(cid, mid, all?) => Promise<boolean>` (default `true`) |
| `wa.Message.react` | `(cid, mid, emoji) => Promise<boolean>` |
| `wa.Message.forward` | `(cid, mid, target: ForwardTarget) => Promise<boolean>` |
| `wa.Message.seen` | `(cid, mid) => Promise<boolean>` |
| `wa.Message.star` | `(cid, mid, value: boolean) => Promise<boolean>` |
| `wa.Message.watch` | `(cid, mid, handler) => () => void` |

### Send

| Delegate | Signature |
| -------- | --------- |
| `wa.Message.text` | `(cid, caption, opts?: SendOptions) => Promise<Message \| null>` |
| `wa.Message.image` | `(cid, buf, opts?: SendMediaOptions) => Promise<Message \| null>` |
| `wa.Message.video` | `(cid, buf, opts?: SendMediaOptions) => Promise<Message \| null>` |
| `wa.Message.audio` | `(cid, buf, opts?: SendAudioOptions) => Promise<Message \| null>` |
| `wa.Message.location` | `(cid, loc: LocationOptions, opts?: SendOptions) => Promise<Message \| null>` |
| `wa.Message.poll` | `(cid, poll: PollOptions, opts?: SendOptions) => Promise<Message \| null>` |

### End-to-end example

```typescript title="send-delegates.ts" hl_lines="13 17 22 24 26"
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";
import { readFileSync } from "node:fs";

const wa = new WhatsApp({
  engine: new FileSystemEngine({ path: "./.whatsapp" }),
});

await wa.connect();

const cid = "5215555555555@s.whatsapp.net";

// Basic text
const greeting = await wa.Message.text(cid, "Hello from v3!");

// Reply (mid pins the quoted message)
if (greeting) {
  await wa.Message.text(cid, "And a follow-up.", { mid: greeting.id });
}

// Media
await wa.Message.image(cid, readFileSync("./banner.png"), { caption: "Banner" });
await wa.Message.audio(cid, readFileSync("./note.ogg"), { ptt: true });

// Location
await wa.Message.location(cid, { lat: 19.4326, lng: -99.1332 });

// Poll
await wa.Message.poll(cid, {
  content: "Pick a framework",
  options: [{ content: "Next" }, { content: "Remix" }, { content: "Astro" }],
});

// CRUD on existing messages
const history = await wa.Message.list(cid, 0, 20);
for (const m of history) {
  if (m.me && !m.edited && m instanceof wa.Message.Text) {
    await wa.Message.edit(cid, m.id, `[edited] ${m.caption}`);
  }
}
```

!!! tip "Event payloads"
    Listeners for `message:*` receive `(msg, chat, wa)`. `msg` is already an instance of the correct subclass, so you can run `instanceof` against `wa.Message.Text`, `wa.Message.Image`, and friends directly — no manual discrimination needed.
