# Message

`Message` is the root class for every incoming or outgoing WhatsApp message. It owns the whole
instance API — getters, author/chat resolution, content, reactions, replies, forwarding, editing,
deletion —, inherits the sends of `Sender`, and eleven specialized subclasses add the payload-specific parts:

| Subclass   | Adds                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| `Text`     | `preview()` — the embedded link card.                                   |
| `Image`    | `width`, `height`, `size`, `thumb()`                                    |
| `Video`    | `width`, `height`, `duration`, `size`, `thumb()`                        |
| `Audio`    | `ptt`, `duration`, `size`, `waveform`, `played`, `play()`               |
| `Sticker`  | `width`, `height`, `animated`, `size`                                   |
| `Document` | `name`, `pages`, `size`                                                 |
| `Location` | `lat`, `lng`, `live`, `link`                                            |
| `Poll`     | `multiple`, `options`, `votes()`, `select()`                            |
| `VCard`    | `contacts`                                                              |
| `Event`    | `name`, `start`, `end`, `canceled`, `link`, `place`, `going`, `attendees()` |
| `Product`  | `pid`, `name`, `price`, `currency`, `link`, `thumb`, `photo`, `sku`, `hidden`, `catalog()` |

`width` and `height` are `0` when the media does not carry them, as happens with an image sent from
this session when baileys has no image library (`sharp` or `jimp`).

`new wa.Message(timeline)` evaluates the type and returns the right subclass instance. The timeline
is the document the engine keeps at `/chat/<cid>/message/<mid>`: the raws exactly as baileys emitted
them, in arrival order, with no envelope. The first one is the `WAMessage` as WhatsApp delivered it;
the ones after it are what baileys emitted for it: the messages that refer to it (reactions, pins,
edits, revokes, votes and event responses, still encrypted), every `messages.update` —a read arrives
as one, with no content—, the receipts, and the `{ lid, pn }` mapping when the chat was translated
from LID to phone. Each getter searches the timeline backwards for the latest raw that defines its
value, and nothing is rewritten: after an edit, the previous text is still in the timeline.

---

## Import

```typescript title="imports.ts"
import {
    WhatsApp,
    message,
    type Message,
    type Text, type Image, type Video, type Audio, type Sticker, type Document,
    type Location, type Poll, type VCard, type Event, type Product,
} from '@arcaelas/whatsapp';
```

The names imported with `type` are **types**: they annotate code and do not exist at runtime. The
classes live on the session that `connect()` opens: `wa.Message` and its subclasses
`wa.Message.Text`, `wa.Message.Poll`, `wa.Message.Image`, …, which are what `instanceof` checks
against. `Product` is the union of the catalog product and the card that arrives in a chat, and
`instanceof wa.Product` recognizes both. `message(init)` is the factory the client uses to build
`wa.Message`.

!!! warning "`instanceof` goes against `wa.Message.*`"
    `Event` is also a Node global, and with the DOM `lib` so are `Text`, `Image` and `Document`:
    `msg instanceof Event` compiles, but it checks the global instead of the library class. Write
    `msg instanceof wa.Message.Event`.

---

## Runtime type detection

```typescript title="instanceof.ts" hl_lines="2 6 11 15 19 23"
wa.on('message:created', async (msg, chat) => {
    if (msg instanceof wa.Message.Text) {
        console.log('text:', msg.caption());
        console.log('link card:', await msg.preview());
    }
    if (msg instanceof wa.Message.Image) {
        const bytes = await msg.content();
        console.log('image:', msg.width, 'x', msg.height, bytes.length, 'bytes');
    }
    if (msg instanceof wa.Message.Video) {
        const stream = await msg.stream();   // pipe to S3, ffmpeg, …
        console.log('video:', msg.duration, 's');
    }
    if (msg instanceof wa.Message.Audio) {
        console.log('voice note?', msg.ptt, 'waveform points:', msg.waveform.length);
    }
    if (msg instanceof wa.Message.Sticker) {
        console.log('sticker animated?', msg.animated);
    }
    if (msg instanceof wa.Message.Document) {
        console.log('file:', msg.name, msg.pages, 'pages', msg.size, 'bytes');
    }
    if (msg instanceof wa.Message.Location) {
        console.log('at', msg.lat, msg.lng, 'live?', msg.live, msg.link);
    }
    if (msg instanceof wa.Message.Poll) {
        console.log('question:', msg.caption(), 'options:', msg.options);
    }
    if (msg instanceof wa.Message.VCard) {
        console.log('contacts:', msg.contacts);
    }
    if (msg instanceof wa.Message.Event) {
        console.log('event:', msg.name, '@', msg.start);
    }
    if (msg instanceof wa.Message.Product) {
        console.log('product:', msg.name, msg.price, msg.currency, 'pid', msg.pid);
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
    case 'product':  break;
}
```

---

## Properties

| Property     | Type                                                              | Description                                                                                     |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `id`         | `string`                                                          | Message identifier (`key.id` in baileys).                                                        |
| `cid`        | `string`                                                          | Chat the message belongs to: the phone JID when known, otherwise the LID or the group id.        |
| `mid`        | `string \| null`                                                  | Identifier of the quoted message, or `null`.                                                     |
| `from`       | `string`                                                          | Author JID: the phone JID when the key carries it, otherwise the LID.                            |
| `me`         | `boolean`                                                         | `true` when the authenticated account is the author.                                             |
| `type`       | `'text' \| 'image' \| 'video' \| 'audio' \| 'sticker' \| 'document' \| 'location' \| 'poll' \| 'vcard' \| 'event' \| 'product'` | Message type. |
| `mime`       | `string`                                                          | `text/plain` for text and product cards, `text/json` for poll/location/vcard/event, the real MIME for media. |
| `status`     | `'error' \| 'pending' \| 'sent' \| 'delivered' \| 'read' \| 'played'` | Delivery state; a later `error` overrides any progress.                                     |
| `reason`     | `string \| null`                                                  | Rejection reason when `status` is `error`: `restricted` (WhatsApp limited the account and blocks new chats), `invalid-session`, or the raw code. |
| `mentioned`  | `boolean`                                                         | `true` when the account is mentioned in the body (compares JID and LID).                         |
| `edited`     | `boolean`                                                         | `true` when the timeline holds a later edit.                                                     |
| `once`       | `boolean`                                                         | `true` when the message is view-once or play-once; `content()` still returns its binary.        |
| `expires_at` | `string \| null`                                                  | Expiration of a disappearing message as ISO, or `null`.                                          |
| `revoked`    | `string \| null`                                                  | When it was deleted for everyone, as ISO, or `null`. The message stays so the interface can show *this message was deleted*. |
| `business`   | `string \| null`                                                  | Verified business name signing the message, or `null`.                                           |
| `created_at` | `string`                                                          | Creation date as ISO.                                                                            |

!!! danger "`status: 'error'` with `reason: 'restricted'` is not fixed by retrying"
    That is server code **463**: WhatsApp limited the account and blocks it from opening new chats,
    while established chats keep working.

---

## Methods

Every value the account can also change is a single method: it reads without an argument and
writes with one. What the account cannot change rejects with `ERR_NOT_ALLOWED`.

### `caption()` / `caption(value)`

```typescript
caption(): string
caption(value: string): Promise<string>
```

The text or media caption as of the last edit (the question in a poll, the description in an event,
the body or description in a product card). With text it edits a message **you** authored of type
`text`, `image` or `video`; anything else rejects with `ERR_NOT_ALLOWED`.

### `forward()` / `forward(target)`

```typescript
forward(): boolean
forward(target: Chat | Contact | string): Promise<Message>
```

Without an argument, whether it arrived forwarded. With a target —a `Chat`, a `Contact` or any
identifier— it forwards it there and returns the forwarded `Message`, which is stored like any sent
message.

### `seen()` / `seen(true)`

```typescript
seen(): boolean
seen(value: true): Promise<boolean>
```

Without an argument, whether it was read (`status` is `read` or `played`). With `true` it
acknowledges it as read and puts the account online, like [`chat.seen()`](chat.md#seen-seenfalse).
Marking as unread only exists for the whole chat: `chat.seen(false)`.

### `starred()` / `pinned()`

```typescript
starred(): boolean
starred(value: boolean): Promise<boolean>
pinned(): boolean
pinned(value: boolean, days?: 1 | 7 | 30): Promise<boolean>
```

Read or change whether the message is starred, or pinned in the chat for 1, 7 (default) or 30 days.

### `reactions()` / `reactions(emoji)`

```typescript
reactions(): { emoji: string; count: number }[]
reactions(emoji: string): Promise<boolean>
```

Without an argument, the current reactions grouped by emoji —each author's last one—. With an emoji
it reacts, and `''` removes the reaction.

### `delete(all?)`

```typescript
delete(all?: boolean): Promise<boolean>
```

`delete()` removes the message for you only and drops it from the engine. `delete(true)` deletes it
for everyone when it is yours —it stays in place with `revoked` set—; on someone else's message it
deletes it for you only.

### `content()` / `stream()`

```typescript
content(): Promise<Buffer>
stream(): Promise<Readable>
```

The payload. Media returns the stored binary or downloads it —asking WhatsApp to re-send expired
media— and stores it; it **throws** when it cannot be downloaded. View-once messages return their
binary too: `once` tells whether it is one. The other types derive it from the timeline:

| Type                                          | Payload                                    |
| --------------------------------------------- | ------------------------------------------ |
| `text`                                        | UTF-8 text.                                |
| `image` / `video` / `audio` / `sticker` / `document` | Decrypted binary.                   |
| `location`                                    | JSON `{ lat, lng }`.                       |
| `poll`                                        | JSON `{ content, options: [{ content }] }`. |
| `vcard`                                       | The raw vCards.                            |
| `event`                                       | JSON of the event message.                 |
| `product`                                     | The product description.                   |

### `author()` / `chat()` / `message()` / `mentions()`

```typescript
author(): Promise<Contact>
chat(): Promise<Chat>
message(): Promise<Message | null>
mentions(): Promise<Contact[]>
```

Bridges to the author, the chat (stored or minimal), the **quoted** message when `mid` is set, and
the contacts mentioned in the body. `caption()` keeps the raw `@<id>` of each mention: replacing it
with a name belongs to whoever renders it.

### `sub(handler)`

```typescript
sub(handler: (event: { name: 'updated' | 'deleted' | 'reacted' | 'seen' | 'played'; payload: Message; emoji?: string; contact?: Contact }) => void): () => void
```

Subscribes to what happens to this message: it changes, is deleted for everyone, receives a
reaction —with `emoji` and `contact`—, is read or its audio is played. Returns the function that
unsubscribes.

### `metadata()`

```typescript
metadata(): Promise<Record<string, unknown>>
metadata(key: string): Promise<unknown>
metadata(key: string, value: unknown): Promise<Record<string, unknown>>
metadata(patch: Record<string, unknown>): Promise<Record<string, unknown>>
```

Integration values under `/chat/<cid>/message/<mid>/metadata`, the same way as
[`contact.metadata()`](contact.md#metadata).

---

## Sending

`Contact`, `Chat` and `Message` extend a base class, `Sender`: each one tells what it is and which
chat it belongs to, and the base resolves from that the sends —as statics they take the chat, on the
instance they read it—, `typing()`, `recording()` and `metadata()`. From a `Contact` the send goes
to its 1:1 chat; from a `Message` it goes to its chat and **quotes** it.

```typescript title="send.ts"
await wa.Chat.text(cid, 'hello');                      // static: any chat, created if missing
await chat.text('hello');                              // instance: this chat
await msg.text('pong');                                // reply: quotes msg
await wa.Message.text(cid, 'hi', { mid });             // the same statics are on wa.Message
```

| Method                        | Payload                                                  | Own options                                  |
| ----------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| `text(cid?, caption, extra?)` | `string`                                                 | —                                            |
| `image(cid?, buf, extra?)`    | `Buffer`                                                 | `caption?`, `sticker?`                       |
| `video(cid?, buf, extra?)`    | `Buffer`                                                 | `caption?`, `gif?`                           |
| `audio(cid?, buf, extra?)`    | `Buffer`                                                 | `ptt?` (default `true`)                      |
| `document(cid?, buf, extra)`  | `Buffer`                                                 | `file_name`, `mimetype?`, `caption?`         |
| `location(cid?, loc, extra?)` | `{ lat, lng }`                                           | —                                            |
| `poll(cid?, input, extra?)`   | `{ content, options: [{ content }] }`                    | `multiple?`                                  |
| `vcard(cid?, contacts, extra?)` | `{ name, phone }[]`                                    | —                                            |
| `event(cid?, data, extra?)`   | `{ name, caption?, start, end?, place? }`                | —                                            |

`cid` exists only on the statics. Every send returns the created `Message`, already of the right
subclass, and rejects with `ERR_INVALID_CHAT` when the chat cannot be resolved.

```typescript title="options.ts"
interface Extra {
    mid?: string;                                  // quotes that message
    once?: boolean;                                // view-once or play-once
    expiration?: 86_400 | 604_800 | 7_776_000;     // seconds until it disappears
    mentions?: (Contact | string | number)[];      // who each `@<phone>` in the text refers to
}
```

!!! info "Stickers"
    `image(buf, { sticker: true })` sends a sticker. WhatsApp only takes WebP: another format is
    converted to 512×512 WebP with `sharp` when it is installed, and without it the send rejects
    with `ERR_STICKER_LIB`. `sharp` stays an optional dependency.

!!! info "Mentions: write the phone, the library translates it"
    Write `@<phone>` in the text and pass the same people in `mentions`. In a group that addresses
    its members by LID the library rewrites each `@` to the LID, so the recipient's `mentioned` is
    `true` and `mentions()` resolves the contacts.

---

## Statics (`wa.Message.*`)

| Static              | Signature                                                          |
| ------------------- | ------------------------------------------------------------------ |
| `wa.Message.get`    | `(cid, mid) => Promise<Message \| null>`                           |
| `wa.Message.list`   | `(cid, offset?, limit?) => Promise<Message[]>` (defaults `0, 50`)  |
| `wa.Message.delete` | `(cid, mid, all?) => Promise<boolean>`                             |

Plus the sends of [Sending](#sending). The rest is done on the instance: `(await wa.Message.get(cid,
mid))?.reactions('👍')`.

---

## Polls

`Poll.options` exposes each choice with its live vote count, `votes()` breaks the tally down per
voter, and `select()` casts a vote from the authenticated account. `multiple` comes from the poll's
`selectableOptionsCount`: WhatsApp sends `1` for single-choice polls.

```typescript title="poll.ts" hl_lines="12 19"
const sent = await wa.Message.poll(cid, {
    content: "What's for lunch?",
    options: [{ content: 'Pizza' }, { content: 'Tacos' }, { content: 'Ramen' }],
});

wa.on('message:updated', async (msg) => {
    if (msg instanceof wa.Message.Poll) {
        for (const option of msg.options) {
            console.log(option.name, '->', option.count);   // { name, count }
        }
        for (const vote of await msg.votes()) {
            console.log(vote.contact, 'voted', vote.name);  // { name, contact }
        }
    }
});

if (sent instanceof wa.Message.Poll) {
    await sent.select(0);        // single choice
    await sent.select([0, 2]);   // only meaningful when `multiple === true`
}
```

!!! info "Incoming votes are decrypted for you"
    Votes travel encrypted. The client appends every `pollUpdateMessage` to the poll's timeline as
    baileys emitted it and emits `message:updated`; `options` and `votes()` decrypt them on read and
    count the last vote of each voter.

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

wa.on('message:created', (msg) => {
    if (msg instanceof wa.Message.Location && msg.live) {
        console.log('live location ->', msg.lat, msg.lng, msg.link);
    }
});
```

!!! warning "Sending is always a static pin"
    The send API takes `{ lat, lng }` only: broadcasting a *live* location is not supported. On a
    received live location, `lat` and `lng` are the coordinates of the message as it arrived.

---

## Audio

`ptt` differentiates voice notes from audio files, and `waveform` returns the protocol's 0-100
amplitude points, ready to paint.

```typescript title="audio.ts"
import { readFileSync } from 'node:fs';

await wa.Message.audio(cid, readFileSync('./note.ogg'));                  // voice note (default)
await wa.Message.audio(cid, readFileSync('./song.mp3'), { ptt: false });  // audio file

wa.on('message:created', (msg) => {
    if (msg instanceof wa.Message.Audio) {
        console.log(msg.ptt ? 'voice note' : 'audio file', msg.duration, 's');
        console.log(msg.waveform);   // number[]
    }
});
```

---

## Text previews

```typescript title="preview.ts"
if (msg instanceof wa.Message.Text) {
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
if (msg instanceof wa.Message.Event) {
    console.log(msg.name);       // event title
    console.log(msg.caption());    // description
    console.log(msg.start);      // ISO UTC
    console.log(msg.end);        // ISO UTC | null
    console.log(msg.canceled);   // boolean
    console.log(msg.link);       // join link ('' when absent)
    console.log(msg.place);      // { lat, lng } | null
}
```

`going` counts the confirmed attendees, companions included, and `attendees()` lists every response
with the contact's name, in arrival order: `{ name, contact, response: 'going' | 'not_going' |
'maybe', guests }`. Responses arrive encrypted and are appended to its timeline as baileys emitted
them —with the response baileys already decrypted, when it could—, emit `message:updated` on the
`Event`, and are decrypted with the event's secret on read.

```typescript title="attendees.ts"
wa.on('message:updated', async (msg) => {
    if (msg instanceof wa.Message.Event) {
        console.log(msg.going, 'going');
        for (const entry of await msg.attendees()) console.log(entry.name, entry.response, entry.guests);
    }
});
```

!!! tip "Event payloads"
    Listeners for `message:*` receive `(msg, chat, wa)` and `msg` is already an instance of the right
    subclass, so `instanceof` works with no manual discrimination.

---

## Products

A `wa.Message.Product` is the card a Business account shares from its catalog. It has the same
surface as the catalog product ([`wa.Product`](catalog.md)), with `pid` for the product and `id` for
the message, and `instanceof wa.Product` is `true` for it too. `thumb` is the embedded thumbnail as
a data URL; `photo` is always `null`, because the card carries no public photo, and `hidden` is
always `false`, because the card only travels while the product is visible. `status` is the
inherited delivery state, `caption()` the body of the card or the description, and `content()` the
description. `catalog()` brings the catalog that publishes it —the business comes from the card's
`businessOwnerJid`, or its author when the card does not carry it—, or `null` when the product is no
longer published; [`wa.Catalog.product(uid, pid)`](catalog.md) brings the product itself.

```typescript title="product.ts"
if (msg instanceof wa.Message.Product) {
    console.log(msg.name, msg.price, msg.currency);                // 'Camisa', 15.5, 'USD'
    console.log(msg.id, msg.pid, msg.sku, msg.link);               // message id, product id, sku, link
    console.log(msg.caption(), (await msg.content()).toString());    // body or description; description
    console.log(msg.thumb, msg.photo, msg.hidden);                 // data URL | null, null, false
    const catalog = await msg.catalog();                           // Catalog | null
}
```

!!! note "Receive only"
    Sending product cards and editing the catalog are not part of the API: WhatsApp did not answer
    those requests from a linked device during verification, so they are not shipped.
