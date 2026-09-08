# Events

`WhatsApp` exposes a typed event API on the instance itself. Use `wa.on(event, handler)` to
subscribe; the call returns an **unsubscribe function** so you can detach the listener without
keeping a reference to the original handler. `wa.once(event, handler)` works the same way and
auto-detaches after the first fire.

Every event payload ends with the `WhatsApp` instance as the **last argument**, which makes
inline handlers ergonomic without closing over `wa` from the outer scope.

---

## Import

```typescript title="ESM / TypeScript"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({ engine: new FileSystemEngine('./data/wa') });
```

---

## API

| Method                 | Returns        | Description                                                            |
| ---------------------- | -------------- | ------------------------------------------------------------------------ |
| `wa.on(event, h)`      | `() => void`   | Registers a listener. Call the returned function to detach it.          |
| `wa.once(event, h)`    | `() => void`   | Registers a one-shot listener. Returned function detaches it early.     |
| `wa.off(event, h)`     | `this`         | Removes a previously registered listener.                               |
| `wa.emit(event, …)`    | `boolean`      | Emits an event; `true` when listeners were present.                     |

```typescript title="Subscribe and unsubscribe"
const off = wa.on('message:created', (msg, chat) => {
    console.log(`[${chat.id}] ${msg.caption}`);
});

// later
off();
```

---

## Connection

| Event           | Signature            | Fires when…                                                                  |
| --------------- | -------------------- | ---------------------------------------------------------------------------- |
| `connected`     | `[wa]`               | The socket reaches `connection === 'open'` and the session is ready.         |
| `disconnected`  | `[wa, farewell]`     | A non-transient close occurs after the session was online (engine cleanup is already complete when this fires). `farewell` says why: `{ code, reason, expired, detail }`. |
| `error`         | `[error, wa]`        | A failure that does not drop the connection but the consumer needs to know, such as `ERR_OTP_EXPIRED` (the `code` property carries the identifier). |

!!! info "Transient closes are silent"
    The protocol-mandated `restartRequired` (status `515`) right after the initial sync does
    **not** trigger `disconnected`. The library reconnects with zero delay and the consumer
    sees an uninterrupted session. `disconnect({ silent: true })` also mutes the event for that
    specific close.

```typescript title="Connection lifecycle"
wa.on('connected',    (client) => console.log('online'));
wa.on('disconnected', (client, farewell) => console.log('offline', farewell.reason, farewell.code, farewell.expired));
wa.on('error',        (error) => console.error(error.code, error.message));
```

---

## Contacts

| Event              | Signature                  | Fires when…                                                            |
| ------------------ | -------------------------- | ---------------------------------------------------------------------- |
| `contact:created`  | `[contact, chat, wa]`      | A new contact is upserted, or auto-created from an inbound message.    |
| `contact:updated`  | `[contact, chat, wa]`      | A contact's name, notify, image, status or LID changes.                |
| `contact:presence` | `[contact, action, wa]`    | Someone came online, went offline, is typing, recording, stopped typing or stopped recording. Only arrives for contacts watched with `contact.watch()`; `action` is one of `online`, `offline`, `typing`, `recording`, `stopped-typing`, `stopped-recording`. |

The `chat` argument is the contact's 1:1 chat (built from the cache when needed), so you can reply
or fetch history without an extra lookup.

```typescript title="Greet new contacts"
wa.on('contact:created', async (contact, chat, client) => {
    await client.Message.text(chat.id, `Welcome, ${contact.name}!`);
});
```

---

## Chats

| Event              | Signature        | Fires when…                                                                              |
| ------------------ | ---------------- | ---------------------------------------------------------------------------------------- |
| `chat:created`     | `[chat, wa]`     | A new chat is upserted, or auto-created from an inbound message.                         |
| `chat:deleted`     | `[chat, wa]`     | Baileys reports a chat deletion (`chats.delete`).                                        |
| `chat:pinned`      | `[chat, wa]`     | The chat is pinned.                                                                      |
| `chat:unpinned`    | `[chat, wa]`     | The chat is unpinned.                                                                    |
| `chat:archived`    | `[chat, wa]`     | The chat is archived.                                                                    |
| `chat:unarchived`  | `[chat, wa]`     | The chat is unarchived.                                                                  |
| `chat:muted`       | `[chat, wa]`     | A `muteEndTime` in the future is observed.                                               |
| `chat:unmuted`     | `[chat, wa]`     | `muteEndTime` is cleared or set in the past.                                             |
| `chat:updated`     | `[chat, wa]`     | A group changed its name or description.                                                 |
| `chat:joined`      | `[chat, contacts, wa]` | People entered a group — invited, added or joined by link. `contacts` says who.     |
| `chat:left`        | `[chat, contacts, wa]` | People left a group or were removed, the account included.                          |
| `chat:promoted`    | `[chat, contacts, wa]` | People became group admins.                                                         |
| `chat:demoted`     | `[chat, contacts, wa]` | People lost the admin role.                                                         |

```typescript title="Audit chat moderation"
wa.on('chat:archived',   (chat) => console.log('archived',   chat.id));
wa.on('chat:unarchived', (chat) => console.log('unarchived', chat.id));
wa.on('chat:muted',      (chat) => console.log('muted until', chat.muted));
wa.on('chat:joined',     (chat, people) => console.log(people.map((who) => who.name), 'joined', chat.name));
wa.on('chat:promoted',   (chat, people) => console.log(people.map((who) => who.name), 'now admin in', chat.name));
```

---

## Messages

| Event                | Signature                       | Fires when…                                                                       |
| -------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| `message:created`    | `[message, chat, wa]`           | A new message is upserted (inbound or outbound).                                  |
| `message:updated`    | `[message, chat, wa]`           | A message is edited, its status changes, its content updates (live location), a poll vote or an event response is decrypted, or it is pinned or unpinned. |
| `message:deleted`    | `[message, chat, wa]`           | A message is revoked (`protocolMessage.REVOKE`). The document stays, flagged with `revoked`. |
| `message:reacted`    | `[message, chat, emoji, contact, wa]` | A reaction arrives. `emoji` is `''` when the reaction is removed; `contact` is who reacted, so an own echo is told apart from a real reaction. |
| `message:starred`    | `[message, chat, wa]`           | A message is starred.                                                             |
| `message:unstarred`  | `[message, chat, wa]`           | A message is unstarred.                                                           |
| `message:forwarded`  | `[message, chat, wa]`           | A newly stored message carries the `forwarded` flag (it is emitted right after `message:created`). |
| `message:seen`       | `[message, chat, wa]`           | A read or play receipt is observed for the message.                               |

```typescript title="React-when-mentioned bot" hl_lines="2"
wa.on('message:created', async (msg, chat) => {
    if (!msg.me && msg.caption.toLowerCase().includes('@bot')) {
        await msg.text('here!');
    }
});

wa.on('message:reacted', (msg, chat, emoji, who) => {
    console.log(`${who.name} reacted ${emoji || '∅'} on ${msg.id}`);
});
```

!!! warning "Guard against your own messages"
    `message:created` fires for outbound messages too. Without a `!msg.me` check a bot replies to
    itself in a loop.

---

## Statuses

| Event          | Signature      | Fires when…                                                     |
| -------------- | -------------- | ----------------------------------------------------------------- |
| `feed:created` | `[feed, wa]`   | A status arrives, or you publish one with `account.post()`.          |
| `feed:updated` | `[feed, wa]`   | The status is marked as viewed, by `view()` or by a read receipt. |
| `feed:deleted` | `[feed, wa]`   | The author revokes the status.                                   |

Status broadcasts never emit `message:*`, and their payload carries **no chat**. See
[Feed](feed.md).

```typescript title="Watch statuses"
wa.on('feed:created', async (post) => {
    console.log((await post.author()).name, post.caption);
    await post.view();
});
```

---

## Listening to every event

Because the event names form a known set, you can attach a listener to each of them with a
single loop. The example below logs every event flowing through the client — useful for
debugging.

```typescript title="Trace all events"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({ engine: new FileSystemEngine('./data/wa') });

const events = [
    'connected', 'disconnected', 'error',
    'contact:created', 'contact:updated', 'contact:presence',
    'chat:created', 'chat:updated', 'chat:deleted',
    'chat:joined', 'chat:left', 'chat:promoted', 'chat:demoted',
    'chat:pinned', 'chat:unpinned',
    'chat:archived', 'chat:unarchived',
    'chat:muted', 'chat:unmuted',
    'message:created', 'message:updated', 'message:deleted',
    'message:reacted',
    'message:starred', 'message:unstarred',
    'message:forwarded', 'message:seen',
    'feed:created', 'feed:updated', 'feed:deleted',
] as const;

for (const event of events) {
    wa.on(event, (...args) => {
        console.log(`[${event}]`, args.length, 'args');
    });
}

await wa.connect((qr) => console.log('QR length:', (qr as Buffer).length));
```

---

## `once` semantics

`wa.once(event, handler)` fires at most once and then auto-detaches. The function returned by
`once` lets you cancel the subscription before the event ever arrives:

```typescript title="Wait for the first message"
const cancel = wa.once('message:created', (msg, chat) => {
    console.log('first message:', chat.id, msg.caption);
});

// Optional: bail out before any message arrives.
setTimeout(cancel, 60_000);
```

---

## Payload shape

!!! info "Entity, context, client"
    Every payload follows the same order: the **artifact** first, its **context** in the middle
    (the chat, and the emoji for reactions), and the **client** last.

    - `message:*`         → `[message, chat, wa]`
    - `message:reacted`   → `[message, chat, emoji, contact, wa]`
    - `contact:*`         → `[contact, chat, wa]`
    - `contact:presence`  → `[contact, action, wa]`
    - `chat:*`            → `[chat, wa]`
    - `chat:joined` / `chat:left` / `chat:promoted` / `chat:demoted` → `[chat, contacts, wa]`
    - `feed:*`            → `[feed, wa]`
    - `connected`         → `[wa]`
    - `disconnected`      → `[wa, farewell]`
    - `error`             → `[error, wa]`
