# Feed

`Feed` is a **status broadcast** post — what WhatsApp stores under the `status@broadcast` chat. It
extends [`Message`](message.md), so it inherits the readable getters, `author()`, `content()` and
`stream()`, and it voids everything a status does not support.

Statuses live for 24 hours (`FEED_TTL_MS`), never emit `message:*` events, and travel through their
own channel: `feed:created`, `feed:updated` and `feed:deleted`.

---

## Import

```typescript title="imports.ts"
import { WhatsApp, Feed, FEED_TTL_MS } from '@arcaelas/whatsapp';
```

You never construct a `Feed` yourself. Instances come from:

- `wa.feed({ … })` — the post you publish.
- The `feed:created`, `feed:updated` and `feed:deleted` events.

---

## Publishing

```typescript
wa.feed(post: { content?: Buffer; caption?: string; contacts: (string | number)[] }): Promise<Feed | null>
```

```typescript title="publish.ts"
// Text status
await wa.feed({
    caption: 'We are live!',
    contacts: ['5491112345678', 584121234567],
});

// Image or video status — the type is inferred from the binary signature
await wa.feed({
    content: await readFile('./promo.jpg'),
    caption: 'New collection',
    contacts: ['5491112345678'],
});
```

!!! warning "`contacts` is the audience, and it is mandatory"
    WhatsApp does not deliver a status to anyone outside the list you pass. There is no "all my
    contacts" shortcut: build the list yourself, for instance from `wa.Contact.list()`.

| Error              | Thrown when                                       |
| ------------------ | ------------------------------------------------- |
| `ERR_FEED_EMPTY`   | Neither `content` nor `caption` was given.        |
| `ERR_FEED_MEDIA`   | `content` is neither a JPEG/PNG/WebP nor an MP4.  |

---

## Properties

Inherited from `Message`, with the values a status actually carries:

| Property     | Type                                        | Notes                                                                     |
| ------------ | ------------------------------------------- | --------------------------------------------------------------------------- |
| `id`         | `string`                                    | Status identifier.                                                        |
| `cid`        | `string`                                    | Always `'status@broadcast'`.                                              |
| `type`       | `'text' \| 'image' \| 'video' \| 'audio'`   | Kind of status.                                                           |
| `caption`    | `string`                                    | The text, or the media footer.                                            |
| `mime`       | `string`                                    | `text/plain` for text, the real MIME for media.                           |
| `from`       | `string`                                    | JID of the author.                                                        |
| `created_at` | `string`                                    | Publication date, ISO UTC.                                                |
| `expires_at` | `string \| null`                            | Expiration, ISO UTC — 24 hours after `created_at`.                        |
| `viewed`     | `boolean`                                   | `true` once a read receipt was sent for this status.                      |

```typescript title="properties.ts"
wa.on('feed:created', async (post) => {
    const author = await post.author();
    console.log(`${author.name}: ${post.caption}`);
    console.log('expires at', post.expires_at, 'viewed?', post.viewed);
});
```

!!! info "The 24-hour window is exported"
    `FEED_TTL_MS` is the status lifetime in milliseconds (`86_400_000`), the same constant used to
    compute `expires_at`.

---

## Methods

### `view()`

```typescript
view(): Promise<boolean>
```

Marks the status as seen: sends the read receipt, persists `viewed` and emits `feed:updated`.
Calling it twice is safe — the receipt is only sent the first time. Returns `false` when there is
no live socket.

```typescript title="view.ts"
wa.on('feed:created', async (post) => {
    await post.view();
});
```

`seen()` is an alias of `view()`, so the `Message` habit keeps working.

### Inherited and usable

| Method        | Behaviour on a status                                                              |
| ------------- | ------------------------------------------------------------------------------------ |
| `author()`    | The `Contact` who published it.                                                    |
| `chat()`      | A minimal `Chat` for `status@broadcast` (statuses are not a real conversation).     |
| `content()`   | The text as UTF-8, or the downloaded media binary.                                 |
| `stream()`    | The content as a `Readable`.                                                       |
| `reactions()` | Reactions grouped by emoji; a reaction on a status arrives as `feed:updated`.       |

### Unsupported

```typescript title="unsupported.ts"
try {
    await post.delete();
} catch (error) {
    // Error: ERR_FEED_UNSUPPORTED
}
```

`message()`, `react()`, `star()`, `edit()`, `forward()`, `delete()` and every reply helper
(`text()`, `image()`, `video()`, `audio()`, `location()`, `poll()`, `document()`, `vcard()`,
`event()`) throw **`ERR_FEED_UNSUPPORTED`**.

!!! info "TypeScript stops you first"
    The overrides are declared with **no parameters** and a `Promise<never>` return, so
    `post.react('❤️')` does not even compile. The runtime error is the second line of defence.

---

## Events

| Event          | Signature      | Fires when…                                                                 |
| -------------- | -------------- | ----------------------------------------------------------------------------- |
| `feed:created` | `[feed, wa]`   | A status arrives from a contact, or you publish one with `wa.feed()`.        |
| `feed:updated` | `[feed, wa]`   | The status is marked as viewed, or someone reacts to it.                     |
| `feed:deleted` | `[feed, wa]`   | The author revokes the status.                                               |

Unlike `message:*`, the payload has **no chat argument**: statuses do not belong to a conversation.

```typescript title="events.ts"
wa.on('feed:created', async (post) => {
    if (post.type === 'image') {
        await writeFile(`./statuses/${post.id}.jpg`, await post.content());
    }
    await post.view();
});

wa.on('feed:deleted', (post) => console.log('revoked:', post.id));
```

---

## Persistence

| Path                     | Value                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `/status/<id>`           | The status document (`author_jid`, `type`, `caption`, `mime`, `created_at`, `expires_at`, `viewed`, `raw`). |
| `/status/<id>/content`   | The payload: raw binary when the driver supports buffers, base64 JSON otherwise. |

!!! note "Nothing expires by itself"
    The library does not garbage-collect statuses after 24 hours; `expires_at` tells you when
    WhatsApp considers them gone. Prune them yourself with `wa.engine.unset('/status/<id>')` if
    storage matters.
