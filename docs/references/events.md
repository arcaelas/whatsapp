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

| Method               | Returns        | Description                                                            |
| -------------------- | -------------- | ---------------------------------------------------------------------- |
| `wa.on(event, h)`    | `() => void`   | Registers a listener. Call the returned function to detach it.         |
| `wa.once(event, h)`  | `() => void`   | Registers a one-shot listener. Returned function detaches it early.    |
| `wa.off(event, h)`   | `this`         | Removes a previously registered listener.                              |

```typescript title="Subscribe and unsubscribe"
const off = wa.on('message:created', (msg, chat) => {
    console.log(`[${chat.id}] ${msg.caption}`);
});

// later
off();
```

---

## Connection

| Event           | Signature       | Fires when…                                                                  |
| --------------- | --------------- | ---------------------------------------------------------------------------- |
| `connected`     | `[wa]`          | The socket reaches `connection === 'open'` and the session is ready.         |
| `disconnected`  | `[wa]`          | A non-transient close occurs after the session was online (engine cleanup is already complete when this fires). |

!!! info "Transient closes are silent"
    The protocol-mandated `restartRequired` (status `515`) right after the initial sync does
    **not** trigger `disconnected`. The library reconnects with zero delay and the consumer
    sees an uninterrupted session.

```typescript title="Connection lifecycle"
wa.on('connected',    (client) => console.log('online'));
wa.on('disconnected', (client) => console.log('offline'));
```

---

## Contacts

| Event              | Signature                | Fires when…                                                            |
| ------------------ | ------------------------ | ---------------------------------------------------------------------- |
| `contact:created`  | `[contact, chat, wa]`    | A new contact is upserted, or auto-created from an inbound message.    |
| `contact:updated`  | `[contact, chat, wa]`    | A contact's name, notify, image, status, or LID changes.               |
| `contact:deleted`  | `[contact, chat, wa]`    | Baileys reports a contact deletion (`contacts.delete`).                |

The `chat` argument is the contact's 1:1 chat (created on the fly from the cache when needed),
so you can reply or fetch history without an extra lookup.

```typescript title="Greet new contacts"
wa.on('contact:created', async (contact, chat) => {
    await chat.text(`Welcome, ${contact.name ?? contact.notify ?? 'friend'}!`);
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

```typescript title="Audit chat moderation"
wa.on('chat:archived',   (chat) => console.log('archived',   chat.id));
wa.on('chat:unarchived', (chat) => console.log('unarchived', chat.id));
```

---

## Messages

| Event                | Signature                       | Fires when…                                                                       |
| -------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| `message:created`    | `[message, chat, wa]`           | A new message is upserted (inbound or outbound).                                  |
| `message:updated`    | `[message, chat, wa]`           | A message is edited, has a status change, or its content updates (live location). |
| `message:deleted`    | `[message, chat, wa]`           | A message is revoked (`protocolMessage.REVOKE`).                                  |
| `message:reacted`    | `[message, chat, emoji, wa]`    | A reaction arrives. `emoji` is `''` when the reaction is removed.                 |
| `message:starred`    | `[message, chat, wa]`           | A message is starred.                                                             |
| `message:unstarred`  | `[message, chat, wa]`           | A message is unstarred.                                                           |
| `message:forwarded`  | `[message, chat, wa]`           | An incoming message carries the `forwarded` flag.                                 |
| `message:seen`       | `[message, chat, wa]`           | A read or play receipt is observed for the message.                               |

```typescript title="React-when-mentioned bot" hl_lines="3"
wa.on('message:created', async (msg, chat) => {
    if (msg.caption?.toLowerCase().includes('@bot')) {
        await chat.text('here!');
    }
});

wa.on('message:reacted', (msg, chat, emoji) => {
    console.log(`Reacted ${emoji || '∅'} on ${msg.id}`);
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
    'connected', 'disconnected',
    'contact:created', 'contact:updated', 'contact:deleted',
    'chat:created', 'chat:deleted',
    'chat:pinned', 'chat:unpinned',
    'chat:archived', 'chat:unarchived',
    'chat:muted', 'chat:unmuted',
    'message:created', 'message:updated', 'message:deleted',
    'message:reacted',
    'message:starred', 'message:unstarred',
    'message:forwarded', 'message:seen',
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

## Migrating from v2

!!! warning "Signature change"
    In v2, message and contact handlers received `[entity, wa]`. In v3, the **chat** is now
    inserted right before `wa`:

    - `message:*`  → `[message, chat, wa]`
    - `contact:*`  → `[contact, chat, wa]`
    - `message:reacted` → `[message, chat, emoji, wa]`

    Update your handlers' parameter lists when upgrading.
