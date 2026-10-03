# Feed

`Feed` is a **status broadcast** post — what WhatsApp stores under the `status@broadcast` chat. It
is a class of its own, separate from [`Message`](message.md), and extends `Sender`: replying to a
status sends to the author's 1:1 chat quoting it, as WhatsApp does.

Statuses live for 24 hours (`FEED_TTL_MS`), never emit `message:*` events, and travel through their
own channel: `feed:created`, `feed:updated` and `feed:deleted`.

---

## Import

```typescript title="imports.ts"
import { WhatsApp, feed, FEED_TTL_MS, type Feed } from '@arcaelas/whatsapp';
```

`Feed` is a type; the class lives on the session as `wa.Feed`, built by the `feed` factory —the
default export of `src/lib/feed.ts`—. Instances come from:

- `wa.Feed.create({ … })` — the status you publish.
- `wa.Feed.get(id)` and `wa.Feed.list(offset, limit)` — the stored ones.
- The `feed:created`, `feed:updated` and `feed:deleted` events.
- `new wa.Feed(timeline)`, with a timeline stored at `/status/<id>`.

---

## Publishing

```typescript
wa.Feed.create(input: { caption?: string; media?: { buffer: Buffer; mime: string }; audience?: (Contact | string | number)[] }): Promise<Feed>
```

A text status with `caption` alone, or an image, video or audio status with `media`, told apart by
`media.mime` and with `caption` as its caption. Without `audience` it goes to every contact stored in
the engine; WhatsApp delivers it to nobody outside the audience. It rejects with `ERR_FEED_EMPTY`
without `caption` nor `media`.

```typescript title="publish.ts"
await wa.Feed.create({ caption: 'We are live!' });
await wa.Feed.create({
    caption: 'New collection',
    media: { buffer: await readFile('./promo.jpg'), mime: 'image/jpeg' },
    audience: ['5491112345678'],
});
```

!!! info "Who sees a status"
    WhatsApp only shows a status to people who have the author saved in their contacts, even when
    they are in the audience.

---

## Properties

| Property     | Type                                        | Notes                                                       |
| ------------ | ------------------------------------------- | ----------------------------------------------------------- |
| `id`         | `string`                                    | Status identifier.                                          |
| `from`       | `string`                                    | JID of the author: the phone when known, otherwise the LID. |
| `me`         | `boolean`                                   | `true` when the status is your own.                         |
| `type`       | `'text' \| 'image' \| 'video' \| 'audio'`   | Kind of status.                                             |
| `mime`       | `string`                                    | `text/plain` for text, the real MIME for media.             |
| `caption`    | `string`                                    | The text, or the media caption.                             |
| `created_at` | `string`                                    | Publication date, ISO.                                      |
| `expires_at` | `string`                                    | Expiration, ISO — 24 hours after `created_at`.              |

---

## Methods

### `seen()` / `seen(true)`

```typescript
seen(): boolean
seen(value: true): Promise<boolean>
```

Without an argument, whether you already viewed it —your own always are—. With `true` it sends the
read receipt, appends it to the timeline, emits `feed:updated` and puts the account online; calling
it again sends nothing.

### `delete()`

```typescript
delete(): Promise<boolean>
```

On your own status it revokes it for everyone, and the echo removes it from the engine and emits
`feed:deleted`. On someone else's it only removes it from the engine and emits `feed:deleted`.

### `content()` / `stream()` / `author()`

```typescript
content(): Promise<Buffer>
stream(): Promise<Readable>
author(): Promise<Contact>
```

`content()` is the media binary —the stored one or the download, which gets stored; it throws when
it cannot be downloaded— or, on a text status, the caption as a Buffer. `author()` is the `Contact`
who published it.

### Replies

`text()`, `image()`, `video()`, `audio()` and the other [sends](message.md#sending) inherited from
`Sender` reply to the status: they go to the author's 1:1 chat and quote it.

```typescript title="reply.ts"
wa.on('feed:created', async (post) => {
    await post.seen(true);
    await post.text('Nice!');
});
```

### `sub(handler)` / `metadata()`

```typescript
sub(handler: (event: { name: 'updated' | 'deleted' | 'seen'; payload: Feed }) => void): () => void
```

`sub()` reports what happens to the status: it changes, is revoked, or gets viewed. `metadata()`
keeps integration values under `/status/<id>/metadata`, the same way as
[`contact.metadata()`](contact.md#metadata).

---

## Statics (via `wa.Feed`)

| Static           | Signature                                               | Notes                                     |
| ---------------- | ------------------------------------------------------- | ----------------------------------------- |
| `wa.Feed.get`    | `(id: string) => Promise<Feed \| null>`                 | The stored status.                        |
| `wa.Feed.list`   | `(offset?: number, limit?: number) => Promise<Feed[]>`  | Current statuses, newest first.           |
| `wa.Feed.create` | `(input) => Promise<Feed>`                              | See [Publishing](#publishing).            |

---

## Events

| Event          | Signature      | Fires when…                                                           |
| -------------- | -------------- | ----------------------------------------------------------------------- |
| `feed:created` | `[feed, wa]`   | A status arrives from a contact, or you publish one with `Feed.create()`. |
| `feed:updated` | `[feed, wa]`   | The status is viewed, by `seen(true)` or by a read receipt, or receives a reaction. |
| `feed:deleted` | `[feed, wa]`   | The status is revoked, or `delete()` removes it.                       |

Unlike `message:*`, the payload has **no chat argument**: statuses do not belong to a conversation.

---

## Persistence

| Path                     | Value                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `/status/<id>`           | The status timeline: the raws exactly as baileys emitted them, the `WAMessage` first, then the reactions, the `{ key, receipt }` receipts —`seen(true)` appends the own one with that shape— and the `{ lid, pn }` mapping when the author arrived by LID. |
| `/status/<id>/content`   | The media binary of an image, video or audio status. A text status has none. |
| `/status/<id>/metadata`  | The values written with `metadata()`.                                     |

!!! note "Nothing expires by itself"
    The library does not delete statuses after 24 hours; `Feed.list()` leaves out the expired ones
    and `expires_at` tells when WhatsApp considers them gone.
