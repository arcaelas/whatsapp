# Message

`Message` is the root class for every incoming or outgoing WhatsApp message. It owns the whole
instance API — getters, author/chat resolution, content, reactions, replies, forwarding, editing,
deletion —, inherits the sends of `Sender`, and eleven specialized subclasses add the payload-specific parts:

| Subclass   | Adds                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| `Text`     | `preview` — the embedded link card.                                     |
| `Image`    | `width`, `height`, `size`, `thumb`                                      |
| `Video`    | `width`, `height`, `duration`, `size`, `thumb`, `ptv`                   |
| `Audio`    | `ptt`, `duration`, `size`, `waveform`, `played()`                       |
| `Sticker`  | `width`, `height`, `animated`, `size`, `thumb`                          |
| `Document` | `name`, `pages`, `size`, `thumb`                                        |
| `Location` | `lat`, `lng`, `name`, `address`, `live`, `link`                         |
| `Poll`     | `multiple`, `options`, `votes()`, `select()`                            |
| `VCard`    | `contacts` — `{ name, phone }`, with the phone in E.164 (digits only when the card has no country code). |
| `Event`    | `name`, `start`, `end`, `canceled`, `link`, `place`, `going`, `attendees()`, `select()` |
| `Product`  | `pid`, `name`, `price`, `currency`, `link`, `thumb()`, `photo()`, `sku`, `hidden`, `catalog()` |

`width` and `height` are `0` when the media does not carry them, as happens with an image sent from
this session when baileys has no image library (`sharp` or `jimp`). A round video note arrives as a
`Video` with `ptv: true`; a GIF is a `Video` with `ptv: false`. `thumb` is the embedded JPEG
—PNG on a sticker—, or `null`.

`new wa.Message(timeline)` evaluates the type and returns the right subclass instance. The timeline
is the document the engine keeps at `/chat/<cid>/message/<mid>`: the raws exactly as baileys emitted
them, in arrival order, with no envelope. The first one is the `WAMessage` as WhatsApp delivered it;
the ones after it are what baileys emitted for it: the messages that refer to it (reactions, pins,
edits, revokes, votes and event responses, encrypted and also decrypted on arrival), every
`messages.update` with content, and the `{ lid, pn }` mapping when the chat was translated from LID
to phone. Receipts and status changes are not appended: they leave a single delivery record with the
highest state. Each getter searches the timeline backwards for the latest raw that defines its value,
and nothing is rewritten: after an edit, the previous text is still in the timeline.

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
        console.log('link card:', msg.preview);
    }
    if (msg instanceof wa.Message.Image) {
        const bytes = await msg.content();
        console.log('image:', msg.width, 'x', msg.height, bytes.length, 'bytes');
    }
    if (msg instanceof wa.Message.Video) {
        const stream = await msg.stream();   // pipe to S3, ffmpeg, …
        console.log('video:', msg.duration, 's', 'round note?', msg.ptv);
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
        console.log('at', msg.lat, msg.lng, msg.name, msg.address, 'live?', msg.live, msg.link);
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
| `mime`       | `string`                                                          | `text/plain` for text and product cards, `application/json` for poll/location/vcard/event, the real MIME for media. |
| `status`     | `'error' \| 'pending' \| 'sent' \| 'delivered' \| 'read' \| 'played'` | Delivery state; a later `error` overrides any progress.                                     |
| `reason`     | `string \| null`                                                  | Rejection reason when `status` is `error`: `restricted` (WhatsApp limited the account and blocks new chats), `invalid-session`, or the raw code. |
| `mentioned`  | `boolean`                                                         | `true` when the account is mentioned in the body (compares JID and LID).                         |
| `edited`     | `boolean`                                                         | `true` when the timeline holds a later edit.                                                     |
| `once`       | `boolean`                                                         | `true` when the message is view-once or play-once; `content()` still returns its binary.        |
| `expires_at` | `string \| null`                                                  | Expiration of a disappearing message as ISO, or `null`.                                          |
| `revoked_at` | `string \| null`                                                  | When it was deleted for everyone, as ISO, or `null`. The message stays so the interface can show *this message was deleted*. |
| `business`   | `string \| null`                                                  | Verified business name signing the message, or `null`.                                           |
| `created_at` | `string`                                                          | Creation date as ISO.                                                                            |

!!! danger "`status: 'error'` with `reason: 'restricted'` is not fixed by retrying"
    That is server code **463**: WhatsApp limited the account and blocks it from opening new chats,
    while established chats keep working.

---

## Methods

Every value the account can also change is a single method: it reads without an argument and
writes with one. What the account cannot change rejects with `UNAUTHORIZED`.

### `caption()` / `caption(value)`

```typescript
caption(): string
caption(value: string): Promise<string>
```

The text or media caption as of the last edit (the question in a poll, the description in an event,
the comment of a location —empty when it has none—, the body or description in a product card). With text it edits a message **you** authored of type
`text`, `image` or `video` within the 15 minutes WhatsApp allows editing; anything else, or a later
edit, rejects with `UNAUTHORIZED`.

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
Pinning in a group that does not allow the account rejects with `UNAUTHORIZED`.

### `reactions()` / `reactions(emoji)`

```typescript
reactions(): { emoji: string; count: number }[]
reactions(emoji: string): Promise<boolean>
```

Without an argument, the current reactions grouped by emoji —each author's last one—. With an emoji
it reacts, and `''` removes the reaction; in a chat that does not allow the account it rejects with
`UNAUTHORIZED`.

### `delete(all?)`

```typescript
delete(all?: boolean): Promise<boolean>
```

`delete()` removes the message for you only and drops it from the engine. `delete(true)` deletes it
for everyone when it is yours —it stays in place with `revoked_at` set—; on someone else's message it
deletes it for you only.

### `content()` / `stream()`

```typescript
content(): Promise<Buffer>
stream(): Promise<Readable>
```

The payload. Media returns the stored binary or downloads it —asking WhatsApp to re-send expired
media— and stores it; it **throws** when it cannot be downloaded. `stream()` delivers the stored one
or, when missing, the download as it arrives, without buffering it in memory nor storing it:
`content()` is the one that stores. View-once messages return their binary too: `once` tells whether
it is one. The other types derive it from the timeline:

| Type                                          | Payload                                    |
| --------------------------------------------- | ------------------------------------------ |
| `text`                                        | UTF-8 text.                                |
| `image` / `video` / `audio` / `sticker` / `document` | Decrypted binary.                   |
| `location`                                    | JSON `{ lat, lng, name, address }`.        |
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
reaction —with `emoji` and `contact`—, is read or its audio is played. In a group the read arrives
through the receipts and `seen` fires once, with the first one. Returns the function that
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
| `video(cid?, buf, extra?)`    | `Buffer`                                                 | `caption?`, `gif?`, `ptv?`                   |
| `audio(cid?, buf, extra?)`    | `Buffer`                                                 | `ptt?` (default `true`)                      |
| `document(cid?, buf, extra)`  | `Buffer`                                                 | `file_name`, `mimetype?`, `caption?`         |
| `location(cid?, loc, extra?)` | `{ lat, lng, name?, address? }`                          | —                                            |
| `poll(cid?, input, extra?)`   | `{ content, options: [{ content }] }`                    | `multiple?`                                  |
| `vcard(cid?, contacts, extra?)` | `{ name, phone }[]`                                    | —                                            |
| `event(cid?, data, extra?)`   | `{ name, caption?, start, end?, place?: { lat, lng, name?, address? } }` | —                            |

`cid` exists only on the statics. Every send returns the created `Message`, already of the right
subclass; it rejects with `ERR_INVALID_CHAT` when the chat cannot be resolved and with
`ERR_SEND_FAILED` when WhatsApp does not return the sent message.

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
voter —`contact` is the voter's JID, the phone one when known—, and `select()` casts a vote from the
authenticated account; `select([])` withdraws it. `multiple` comes from the poll's
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
    await sent.select([0, 2]);   // only when `multiple === true`; otherwise ERR_POLL_OPTION
}
```

`select()` rejects with `ERR_POLL_OPTION` when an index is out of range or several go to a
single-choice poll, and with `ERR_POLL_SECRET` when the message does not carry the secret the
vote is encrypted with.

!!! info "Incoming votes are decrypted for you"
    Votes travel encrypted. The client appends every `pollUpdateMessage` to the poll's timeline as
    baileys emitted it, together with the vote already decrypted, and emits `message:updated`;
    `options` and `votes()` read the decrypted ones —only a vote that could not be decrypted on
    arrival is retried on read— and count each voter's last vote by send time.

!!! warning "`select()` is best-effort"
    Emitted votes are encrypted and relayed correctly, but WhatsApp does **not** propagate a vote
    cast from a linked (companion) device, which is what this library is. Incoming votes decrypt
    fine; your own vote may not show up on other devices.

---

## Location

`Location` covers both static pins (`locationMessage`) and live locations (`liveLocationMessage`);
`live` tells them apart, `name` and `address` describe the place when the pin carries them —`null`
otherwise, and always on a live location—, `caption()` is the comment written with the pin, and
`link` is the Google Maps URL with the point marked.

```typescript title="location.ts"
await wa.Message.location(cid, { lat: 19.4326, lng: -99.1332, name: 'Palacio de Bellas Artes', address: 'Av. Juárez S/N, Centro, CDMX' });

wa.on('message:created', (msg) => {
    if (msg instanceof wa.Message.Location && msg.live) {
        console.log('live location ->', msg.lat, msg.lng, msg.link);
    }
});
```

!!! warning "Sending is always a static pin"
    The send API takes `{ lat, lng, name?, address? }`: broadcasting a *live* location is not supported. On a
    received live location, `lat` and `lng` are the coordinates of the message as it arrived.

---

## Audio

`ptt` differentiates voice notes from audio files, `waveform` returns the protocol's 0-100
amplitude points, ready to paint, and `played()` tells whether it was played; `played(true)`
acknowledges it —its sender sees the blue mic— and puts the account online, like `seen(true)`.

```typescript title="audio.ts"
import { readFileSync } from 'node:fs';

await wa.Message.audio(cid, readFileSync('./note.ogg'));                  // voice note (default)
await wa.Message.audio(cid, readFileSync('./song.mp3'), { ptt: false });  // audio file

wa.on('message:created', async (msg) => {
    if (msg instanceof wa.Message.Audio) {
        console.log(msg.ptt ? 'voice note' : 'audio file', msg.duration, 's');
        console.log(msg.waveform);   // number[]
        if (msg.played() === false) await msg.played(true);
    }
});
```

---

## Text previews

```typescript title="preview.ts"
if (msg instanceof wa.Message.Text) {
    const card = msg.preview;
    if (card) {
        console.log(card.link, card.name, card.content, card.thumb?.length);
    }
}
```

`preview` is `null` when the message carries no link metadata.

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
    console.log(msg.place);      // { lat, lng, name, address } | null
}
```

`going` counts the confirmed attendees, companions included, and `attendees()` lists every response
with the contact's name, in arrival order: `{ name, contact, response: 'yes' | 'no' | 'maybe', guests
}`, where `contact` is the attendee's JID —the phone one when known—. `select(value, guests?)`
answers from the account with `'yes'`, `'no'` or `'maybe'`, plus companions when the event allows
them; it rejects with `ERR_EVENT_OPTION` on an unknown answer or companions that do not apply —on
`'no'` or on an event without companions— and with `ERR_EVENT_SECRET` when the message does not
carry the secret the answer is encrypted with. Like poll votes, WhatsApp may not propagate an answer
sent from a linked device. Responses arrive encrypted and are appended to its timeline as baileys emitted
them, together with the response decrypted with the event's secret on arrival, and emit
`message:updated` on the `Event`; only a response that could not be decrypted then is retried on
read.

```typescript title="attendees.ts"
wa.on('message:updated', async (msg) => {
    if (msg instanceof wa.Message.Event) {
        console.log(msg.going, 'going');
        for (const entry of await msg.attendees()) console.log(entry.name, entry.response, entry.guests);
    }
});

if (msg instanceof wa.Message.Event) await msg.select('yes', 1);   // going, with one companion
```

!!! tip "Event payloads"
    Listeners for `message:*` receive `(msg, chat, wa)` and `msg` is already an instance of the right
    subclass, so `instanceof` works with no manual discrimination.

---

## Products

A `wa.Message.Product` is the card a Business account shares from its catalog. It has the same
surface as the catalog product ([`wa.Product`](catalog.md)), with `pid` for the product and `id` for
the message, and `instanceof wa.Product` is `true` for it too. `thumb()` is the thumbnail embedded in
the card and `photo()` the product cover in the business catalog, both as a Buffer, empty when there
is none; they stay methods, as on the catalog product, which downloads them. `hidden` is always
`false`, because the card only travels while the product is visible. `status` is the
inherited delivery state, `caption()` the body of the card or the description, and `content()` the
description. `catalog()` brings the catalog that publishes it —the business comes from the card's
`businessOwnerJid`, or its author when the card does not carry it—, or `null` when the product is no
longer published; [`wa.Catalog.product(uid, pid)`](catalog.md) brings the product itself.

```typescript title="product.ts"
if (msg instanceof wa.Message.Product) {
    console.log(msg.name, msg.price, msg.currency);                // 'Camisa', 15.5, 'USD'
    console.log(msg.id, msg.pid, msg.sku, msg.link);               // message id, product id, sku, link
    console.log(msg.caption(), (await msg.content()).toString());    // body or description; description
    console.log((await msg.thumb()).length, (await msg.photo()).length, msg.hidden); // Buffers, false
    const catalog = await msg.catalog();                           // Catalog | null
}
```

!!! note "Receive only"
    Sending product cards and editing the catalog are not part of the API: WhatsApp did not answer
    those requests from a linked device during verification, so they are not shipped.
