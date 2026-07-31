# Message

`Message` is the root class for every incoming or outgoing WhatsApp message. It owns the whole
instance API — getters, author/chat resolution, content, reactions, replies, forwarding, editing,
deletion — and ten specialized subclasses add the payload-specific parts:

| Subclass   | Adds                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| `Text`     | `preview()` — the embedded link card.                                   |
| `Image`    | `width`, `height`, `size`, `thumb()`                                    |
| `Video`    | `width`, `height`, `duration`, `size`, `thumb()`                        |
| `Audio`    | `ptt`, `duration`, `size`, `waveform`                                   |
| `Sticker`  | `width`, `height`, `animated`, `size`                                   |
| `Document` | `name`, `pages`, `size`                                                 |
| `Location` | `lat`, `lng`, `live`, `link`                                            |
| `Poll`     | `multiple`, `options`, `votes()`, `select()`                            |
| `VCard`    | `contacts`                                                              |
| `Event`    | `name`, `start`, `end`, `canceled`, `link`, `place`                     |

The `message(wa, raw)` factory evaluates the type and returns the right subclass instance. It
accepts either a persisted document or a raw baileys `WAMessage` — in the latter case the document
(id, type, author, caption, mime, dates) is derived on the spot.

---

## Import

```typescript title="imports.ts"
import {
    WhatsApp,
    Message,
    message,
    Text, Image, Video, Audio, Sticker, Document, Location, Poll, VCard, Event,
} from '@arcaelas/whatsapp';
```

The subclasses are **module exports**. The same classes are also re-exposed on the client delegate
(`wa.Message.Poll`, `wa.Message.Image`, …), so both spellings of the `instanceof` check are
equivalent.

---

## Runtime type detection

```typescript title="instanceof.ts" hl_lines="2 6 11 15 19 23"
wa.on('message:created', async (msg, chat) => {
    if (msg instanceof Text) {
        console.log('text:', msg.caption);
        console.log('link card:', await msg.preview());
    }
    if (msg instanceof Image) {
        const bytes = await msg.content();
        console.log('image:', msg.width, 'x', msg.height, bytes.length, 'bytes');
    }
    if (msg instanceof Video) {
        const stream = await msg.stream();   // pipe to S3, ffmpeg, …
        console.log('video:', msg.duration, 's');
    }
    if (msg instanceof Audio) {
        console.log('voice note?', msg.ptt, 'waveform points:', msg.waveform.length);
    }
    if (msg instanceof Sticker) {
        console.log('sticker animated?', msg.animated);
    }
    if (msg instanceof Document) {
        console.log('file:', msg.name, msg.pages, 'pages', msg.size, 'bytes');
    }
    if (msg instanceof Location) {
        console.log('at', msg.lat, msg.lng, 'live?', msg.live, msg.link);
    }
    if (msg instanceof Poll) {
        console.log('question:', msg.caption, 'options:', msg.options);
    }
    if (msg instanceof VCard) {
        console.log('contacts:', msg.contacts);
    }
    if (msg instanceof Event) {
        console.log('event:', msg.name, '@', msg.start);
    }
});
```

The fast path is `msg.type`, a synchronous getter:

```typescript title="switch-type.ts"
switch (msg.type) {
    case 'text':     break;
    case 'image':    break;
    case 'video':    break;
    case 'audio':    break;
    case 'sticker':  break;
    case 'document': break;
    case 'location': break;
    case 'poll':     break;
    case 'vcard':    break;
    case 'event':    break;
}
```

---

## Properties

| Property     | Type                                                              | Description                                                                                     |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `id`         | `string`                                                          | Message identifier (`key.id` in baileys).                                                        |
| `cid`        | `string`                                                          | Identifier of the chat the message belongs to.                                                   |
| `mid`        | `string \| null`                                                  | Identifier of the quoted message, or `null`.                                                     |
| `from`       | `string`                                                          | Author JID, for synchronous access (no hydration).                                               |
| `me`         | `boolean`                                                         | `true` when the authenticated account is the author.                                             |
| `type`       | `'text' \| 'image' \| 'video' \| 'audio' \| 'sticker' \| 'document' \| 'location' \| 'poll' \| 'vcard' \| 'event'` | Message type. |
| `mime`       | `string`                                                          | `text/plain` for text, `text/json` for poll/location/vcard/event, the real MIME for media.       |
| `caption`    | `string`                                                          | Message text or media caption (the question in a poll, the description in an event).             |
| `status`     | `'error' \| 'pending' \| 'sent' \| 'delivered' \| 'read' \| 'played'` | Readable delivery state.                                                                    |
| `read`       | `boolean`                                                         | `true` once the state reached `read` or `played`.                                                |
| `reason`     | `string \| null`                                                  | Rejection reason when `status` is `error`: `restricted` (WhatsApp limited the account and blocks new chats), `invalid-session`, or the raw server code otherwise. `null` in any other state. |
| `business`   | `string \| null`                                                  | Verified business name signing the message (WhatsApp renders it under the text), or `null`.      |
| `starred`    | `boolean`                                                         | `true` when the message is starred.                                                              |
| `forwarded`  | `boolean`                                                         | `true` when the message was forwarded.                                                           |
| `edited`     | `boolean`                                                         | `true` when the message was edited.                                                              |
| `once`       | `boolean`                                                         | `true` when the message is view-once.                                                            |
| `created_at` | `string`                                                          | Creation date as an **ISO UTC string**.                                                          |
| `expires_at` | `string \| null`                                                  | Expiration of an ephemeral message as **ISO UTC**, or `null`.                                    |

!!! warning "Dates are ISO strings and `status` is a word"
    `created_at` / `expires_at` are `string` (`'2026-07-31T14:05:03.000Z'`), not epoch numbers, and
    `status` is a readable string, not a numeric enum. The raw numeric values still live in
    `_raw.created_at`, `_raw.deleted_at` and `_raw.status` if you need arithmetic:

    ```typescript
    const age_ms = Date.now() - new Date(msg.created_at).getTime();
    ```

!!! danger "`status: 'error'` with `reason: 'restricted'` is not fixed by retrying"
    That is server code **463**: WhatsApp limited the account and blocks it from **opening new
    chats**, while already established chats keep working. Re-sending the same message fails
    again; the same text from another account goes through.

    ```typescript
    const sent = await Message.text(wa, cid, "hi");
    if (sent?.status === 'error' && sent.reason === 'restricted') {
        // this line can only continue conversations that already exist
    }
    ```

---

## Methods

### `author()` / `chat()`

```typescript
author(): Promise<Contact>
chat(): Promise<Chat>
```

Resolve the sender and the conversation from the engine, falling back to a minimal instance when
the document is not persisted yet.

```typescript title="author-chat.ts"
const sender = await msg.author();
const chat   = await msg.chat();

console.log(sender.name, sender.phone, chat.name);
```

### `message()`

```typescript
message(): Promise<Message | null>
```

The **quoted** message when `mid` is set, `null` otherwise.

```typescript title="quoted.ts"
const quoted = await msg.message();

if (quoted) {
    console.log('replying to:', quoted.caption);
}
```

### `content()` / `stream()`

```typescript
content(): Promise<Buffer>
stream(): Promise<Readable>
```

The message payload. Media subclasses read the engine cache first and fall back to a baileys
download; everything else returns what was persisted at reception:

| Type                                          | Payload                                                              |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `text`                                        | UTF-8 text.                                                          |
| `image` / `video` / `audio` / `sticker` / `document` | Decrypted binary.                                             |
| `location`                                    | JSON `{ lat, lng }`.                                                 |
| `poll`                                        | JSON `{ content, options: [{ content }] }`.                          |
| `vcard`                                       | The raw vCards.                                                      |
| `event`                                       | JSON of the event message.                                           |

```typescript title="content.ts"
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';

if (msg instanceof Image) {
    await writeFile(`${msg.id}.jpg`, await msg.content());
}

if (msg instanceof Video) {
    (await msg.stream()).pipe(createWriteStream(`${msg.id}.mp4`));
}
```

`content()` returns an empty buffer when nothing was stored and the media can no longer be
downloaded (expired payloads).

### `reactions()`

```typescript
reactions(): Promise<{ emoji: string; count: number }[]>
```

The message reactions grouped by emoji with their count.

```typescript title="reactions.ts"
for (const { emoji, count } of await msg.reactions()) {
    console.log(emoji, count);
}
```

### `react(emoji)`

Reacts to the message; an empty string removes your reaction.

```typescript title="react.ts"
await msg.react('❤️');
await msg.react('');   // remove
```

### `star(value)` / `seen()`

```typescript title="star-seen.ts"
await msg.star(true);
await msg.seen();
```

### `edit(caption)`

Edits the caption of a message **you** authored (`me === true`) of type `text`, `image` or `video`.
Returns `false` for anything else.

```typescript title="edit.ts"
if (msg.me) {
    await msg.edit('Updated content');
}
```

### `forward(target)`

```typescript
forward(target: string | Chat | Contact): Promise<boolean>
```

Forwards the message to another chat. A `string` is any identifier (phone, JID, LID, group id); a
`Chat` uses its raw identifier; a `Contact` uses its JID (or LID).

```typescript title="forward.ts"
await msg.forward('5215555555555');

const chat = await wa.Chat.get('120363000000000000@g.us');
await msg.forward(chat!);

const person = await wa.Contact.get('5215555555555');
await msg.forward(person!);
```

### `delete(all?)`

```typescript
delete(all = false): Promise<boolean>
```

!!! warning "The default deletes for you only"
    `delete()` removes the message **from this device only** (`deleteForMe`). Pass `true` to revoke
    it for everyone. Either way the document is removed from the engine.

```typescript title="delete.ts"
await msg.delete();       // only for me (default)
await msg.delete(true);   // for everyone
```

---

## Replies

Every send helper is mirrored on the instance as a reply: the current message is quoted
automatically.

| Method                        | Signature                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `msg.text(caption, extra?)`   | `(string, { once? }) => Promise<Message \| null>`                                           |
| `msg.image(buf, extra?)`      | `(Buffer, { once?, caption? }) => Promise<Message \| null>`                                 |
| `msg.video(buf, extra?)`      | `(Buffer, { once?, caption? }) => Promise<Message \| null>`                                 |
| `msg.audio(buf, extra?)`      | `(Buffer, { once?, ptt? }) => Promise<Message \| null>`                                     |
| `msg.location(loc, extra?)`   | `({ lat, lng }, { once? }) => Promise<Message \| null>`                                     |
| `msg.poll(input, extra?)`     | `({ content, options }, { once?, multiple? }) => Promise<Message \| null>`                  |
| `msg.document(buf, extra)`    | `(Buffer, { file_name, mimetype?, caption?, once? }) => Promise<Message \| null>`           |
| `msg.vcard(contacts, extra?)` | `({ name, phone }[], { once? }) => Promise<Message \| null>`                                |
| `msg.event(data, extra?)`     | `({ name, caption?, start, end?, place? }, { once? }) => Promise<Message \| null>`          |

```typescript title="reply.ts"
wa.on('message:created', async (msg) => {
    if (!msg.me && msg.caption.toLowerCase() === 'ping') {
        await msg.text('pong');
    }
});
```

---

## Statics (`Message.*` and `wa.Message.*`)

Every static takes the **client as its first argument**. The `wa.Message` delegate exposes the same
methods with the client already applied, which is what you normally use:

```typescript
await Message.text(wa, cid, 'hello');   // explicit client
await wa.Message.text(cid, 'hello');    // same call through the delegate
```

### Read

| Static                      | Signature                                                                  |
| --------------------------- | ---------------------------------------------------------------------------- |
| `Message.get`               | `(wa, cid, mid) => Promise<Message \| null>`                                |
| `Message.list`              | `(wa, cid, offset?, limit?) => Promise<Message[]>` (defaults `0, 50`)       |
| `Message.reactions`         | `(wa, cid, mid) => Promise<{ emoji, count }[]>`                             |

### Act

| Static             | Signature                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `Message.react`    | `(wa, cid, mid, emoji) => Promise<boolean>`                       |
| `Message.star`     | `(wa, cid, mid, value) => Promise<boolean>`                       |
| `Message.seen`     | `(wa, cid, mid) => Promise<boolean>`                              |
| `Message.edit`     | `(wa, cid, mid, caption) => Promise<boolean>`                     |
| `Message.forward`  | `(wa, cid, mid, target) => Promise<boolean>`                      |
| `Message.delete`   | `(wa, cid, mid, all?) => Promise<boolean>` (default `false`)      |

### Send

```typescript title="send.ts"
await wa.Message.text(cid, 'hello', { once: true });
await wa.Message.image(cid, buffer, { caption: 'look' });
await wa.Message.video(cid, buffer, { caption: 'demo' });
await wa.Message.audio(cid, buffer, { ptt: true });          // ptt defaults to true
await wa.Message.location(cid, { lat: 8.3, lng: -62.7 });
await wa.Message.poll(cid, {
    content: 'What should we order?',
    options: [{ content: 'Pizza' }, { content: 'Sushi' }],
}, { multiple: true });
await wa.Message.document(cid, buffer, { file_name: 'contract.pdf', mimetype: 'application/pdf' });
await wa.Message.vcard(cid, [{ name: 'Ana', phone: '+584121234567' }]);
await wa.Message.event(cid, { name: 'Demo', start: new Date(), place: { lat: 8.3, lng: -62.7 } });
```

Every send helper returns the created `Message` (already of the right subclass) or `null` when
there is no session or WhatsApp rejected the payload.

### Send options

```typescript title="options.ts"
interface SendExtra {
    mid?: string;    // quoted message id — the reply helpers fill it for you
    once?: boolean;  // view-once
}

// image / video: SendExtra & { caption?: string }
// audio:         SendExtra & { ptt?: boolean }            (default: true)
// poll:          SendExtra & { multiple?: boolean }       (default: false)
// document:      SendExtra & { file_name: string; mimetype?: string; caption?: string }
```

!!! info "`file_name` is required for documents"
    `wa.Message.document(cid, buf, { file_name })` is the only send helper with a mandatory option;
    `mimetype` defaults to `application/octet-stream`.

---

## Polls

`Poll.options` exposes each choice with its live vote count, `votes()` breaks the tally down per
voter, and `select()` casts a vote from the authenticated account.

```typescript title="poll.ts" hl_lines="12 19"
const sent = await wa.Message.poll(cid, {
    content: "What's for lunch?",
    options: [{ content: 'Pizza' }, { content: 'Tacos' }, { content: 'Ramen' }],
});

wa.on('message:updated', async (msg) => {
    if (msg instanceof Poll) {
        for (const option of msg.options) {
            console.log(option.name, '->', option.count);   // { name, count }
        }
        for (const vote of await msg.votes()) {
            console.log(vote.contact, 'voted', vote.name);  // { name, contact }
        }
    }
});

if (sent instanceof Poll) {
    await sent.select(0);        // single choice
    await sent.select([0, 2]);   // only meaningful when `multiple === true`
}
```

!!! info "Incoming votes are decrypted for you"
    Votes travel encrypted. The client decrypts every `pollUpdateMessage`, merges it into the stored
    poll and emits `message:updated`, so `options` and `votes()` are always up to date.

!!! warning "`select()` is best-effort"
    Emitted votes are encrypted and relayed correctly, but WhatsApp does **not** propagate a vote
    cast from a linked (companion) device, which is what this library is. Incoming votes decrypt
    fine; your own vote may not show up on other devices.

---

## Location

`Location` covers both static pins (`locationMessage`) and live locations (`liveLocationMessage`);
`live` tells them apart and `link` builds the Google Maps URL.

```typescript title="location.ts"
await wa.Message.location(cid, { lat: 19.4326, lng: -99.1332 });

wa.on('message:updated', (msg) => {
    if (msg instanceof Location && msg.live) {
        console.log('live update ->', msg.lat, msg.lng, msg.link);
    }
});
```

!!! warning "Sending is always a static pin"
    The send API takes `{ lat, lng }` only. Broadcasting a *live* location is not supported;
    receiving live updates is, through `message:updated`.

---

## Audio

`ptt` differentiates voice notes from audio files, and `waveform` returns the protocol's 0-100
amplitude points, ready to paint.

```typescript title="audio.ts"
import { readFileSync } from 'node:fs';

await wa.Message.audio(cid, readFileSync('./note.ogg'));                  // voice note (default)
await wa.Message.audio(cid, readFileSync('./song.mp3'), { ptt: false });  // audio file

wa.on('message:created', (msg) => {
    if (msg instanceof Audio) {
        console.log(msg.ptt ? 'voice note' : 'audio file', msg.duration, 's');
        console.log(msg.waveform);   // number[]
    }
});
```

---

## Text previews

```typescript title="preview.ts"
if (msg instanceof Text) {
    const card = await msg.preview();
    if (card) {
        console.log(card.link, card.name, card.content, card.thumb?.length);
    }
}
```

`preview()` returns `null` when the message carries no link metadata.

---

## Events

```typescript title="event.ts"
if (msg instanceof Event) {
    console.log(msg.name);       // event title
    console.log(msg.caption);    // description
    console.log(msg.start);      // ISO UTC
    console.log(msg.end);        // ISO UTC | null
    console.log(msg.canceled);   // boolean
    console.log(msg.link);       // join link ('' when absent)
    console.log(msg.place);      // { lat, lng } | null
}
```

!!! tip "Event payloads"
    Listeners for `message:*` receive `(msg, chat, wa)` and `msg` is already an instance of the right
    subclass, so `instanceof` works with no manual discrimination.
