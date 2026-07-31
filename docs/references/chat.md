# Chat

The `Chat` entity represents a WhatsApp conversation — either a 1:1 chat with a contact or a group.
It exposes read-only metadata through synchronous getters (name, type, pinned/archived/muted state,
unread count) and mutating methods that propagate changes to WhatsApp and to local persistence
through the configured engine.

Every instance is bound to a `WhatsApp` context through the internal `chat(wa)` factory, which also
exposes the statics `wa.Chat.get(cid)` and `wa.Chat.list(offset, limit)`.

---

## Import

```typescript title="imports.ts"
import { WhatsApp, Chat, FileSystemEngine } from '@arcaelas/whatsapp';
```

The exported `Chat` class is the **base** class: it carries the getters and nothing else. The
constructor you actually use is `wa.Chat`, the session-bound subclass that adds the methods below
and the statics.

!!! warning "Typing your own helpers"
    The chats that travel in the events are instances of the bound subclass. Annotating a parameter
    with the exported `Chat` hides `members()`, `messages()`, `content()` and every action method.
    Derive the right type instead:

    ```typescript
    import type { WhatsApp } from '@arcaelas/whatsapp';

    type Conversation = InstanceType<WhatsApp['Chat']>;

    async function summarize(chat: Conversation) {
        const recent = await chat.messages(0, 20);   // available
    }
    ```

---

## Where instances come from

- `wa.Chat.get(cid)` — load by phone, JID, LID or group id.
- `wa.Chat.list(offset, limit)` — paginated read of persisted chats.
- `contact.chat()` — the 1:1 chat of a `Contact`.
- `msg.chat()` — the chat a message belongs to.
- Event payloads (`message:*`, `chat:*`, `contact:*`) — the `Chat` travels with them.

```typescript title="bootstrap.ts"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({ engine: new FileSystemEngine('./.whatsapp') });

await wa.connect((auth) => console.log(auth));

const chat = await wa.Chat.get('5215555555555');
if (chat) {
    console.log(chat.name, chat.type);
}
```

!!! info "`get` never writes"
    `wa.Chat.get(cid)` resolves the identifier and returns the persisted document, or a **minimal
    instance built on the spot** when the chat does not exist yet. Nothing is persisted by the
    lookup itself: the chat document appears the first time WhatsApp reports it (`chats.upsert`) or
    a message lands in it. It returns `null` only when the identifier cannot be resolved.

---

## Properties

All properties are synchronous getters over the internal `_raw` document.

| Property   | Type             | Description                                                                                                |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `id`       | `string`         | The **phone** for 1:1 chats (`5215555555555`), or the raw identifier for groups (`…@g.us`) and LIDs.        |
| `name`     | `string`         | Group or contact name; falls back to `id`.                                                                  |
| `type`     | `'contact' \| 'group'` | Derived from the identifier suffix (`@g.us` → group).                                                 |
| `archived` | `boolean`        | `true` when the chat is archived.                                                                           |
| `pinned`   | `boolean`        | `true` when the chat is pinned.                                                                             |
| `count`    | `number`         | Unread messages.                                                                                            |
| `muted`    | `string \| null` | **ISO UTC date** until which the chat stays muted, or `null` when it is not muted (or the window expired).  |

!!! warning "`id` is not a JID for 1:1 chats"
    A `@s.whatsapp.net` identifier is trimmed down to its phone, so `chat.id` reads as
    `5215555555555`. That value is accepted everywhere in this library (`wa.Message.text(chat.id, …)`,
    `wa.Chat.get(chat.id)`), because identifiers are normalized internally. Groups and LIDs keep
    their raw form. The untouched identifier is always available in `chat._raw.id`.

!!! info "`muted` is a date, not a boolean"
    ```typescript
    if (chat.muted) {
        console.log('muted until', new Date(chat.muted).toLocaleString());
    }
    ```

The getters `cid`, `content`, `read` and `readonly` no longer exist: use `_raw.id` for the raw
identifier, the async [`content()`](#content) method for the description, and `count === 0` to know
whether everything was read.

---

## Methods

Mutating methods write to the socket first and then persist the new snapshot to the engine. They
return `false` when there is no live socket.

### `content()`

```typescript
content(): Promise<string>
```

The chat description: the group's subject for groups, or the contact's bio for 1:1 chats. It is
async because neither value lives in the chat document — groups go through `groupMetadata` (cached
for 15 seconds) and 1:1 chats read the contact document.

```typescript title="content.ts"
const description = await chat.content(); // '' when there is none
```

### `members(offset?, limit?)`

```typescript
members(offset = 0, limit = 50): Promise<Contact[]>
```

Chat participants as `Contact` instances: group members for groups; the counterpart and yourself
for 1:1 chats. Group metadata is memoized for 15 seconds so paging does not repeat the round-trip.

```typescript title="members.ts"
const chat = await wa.Chat.get('120363000000000000@g.us');

if (chat?.type === 'group') {
    let offset = 0;
    while (true) {
        const batch = await chat.members(offset, 50);
        if (batch.length === 0) {
            break;
        }
        for (const member of batch) {
            console.log(member.phone, member.name);
        }
        offset += batch.length;
    }
}
```

### `messages(offset?, limit?)`

```typescript
messages(offset = 0, limit = 50): Promise<Message[]>
```

Shortcut for `Message.list(wa, chat._raw.id, offset, limit)`. Messages come back from the most
recent to the oldest.

```typescript title="messages.ts"
const latest = await chat.messages(0, 20);

for (const msg of latest) {
    console.log(msg.type, msg.caption);
}
```

### `typing(value)` / `recording(value)`

Toggle the presence indicators (`composing` / `recording`, or `paused` with `false`).

```typescript title="typing.ts"
await chat.typing(true);
await new Promise((r) => setTimeout(r, 1_500));
await chat.typing(false);
```

!!! tip "Natural cadence"
    Set `typing(true)`, send the message, then `typing(false)` to mimic human behavior. Keep the
    window short (1–3 s) — WhatsApp clears `composing` automatically after a few seconds.

### `archive(value)`

Archives or unarchives the chat on the account.

```typescript title="archive.ts"
await chat.archive(true);
```

### `pin(value)`

Pins or unpins the chat.

```typescript title="pin.ts"
const ok = await chat.pin(true);
```

!!! warning "WhatsApp allows 3 pinned chats"
    A fourth pin is silently dropped by WhatsApp, so the limit is checked **before** sending:
    `pin(true)` returns `false` when three other chats are already pinned (or when the socket is
    down) and nothing is sent.

### `mute(until)`

```typescript
mute(until: string | number | Date | false): Promise<boolean>
```

Mutes the chat until the given deadline. `false` — or any past date — unmutes it.

```typescript title="mute.ts"
await chat.mute('2026-08-01T10:00:00Z');       // ISO string
await chat.mute(Date.now() + 8 * 3_600_000);   // epoch ms
await chat.mute(new Date('2026-12-31'));       // Date
await chat.mute(false);                        // unmute
```

### `seen()`

Marks the whole chat as read on the account and resets `count` to `0`.

```typescript title="seen.ts"
await chat.seen();
```

### `clear()`

Clears the chat messages on the account **and** in the engine, keeping the chat itself. Always
returns `true`: the local cleanup is idempotent, so it works even without a socket.

```typescript title="clear.ts"
await chat.clear();
```

### `delete()`

Deletes the chat and its messages on the account and in the engine. For groups it **leaves the
group** (`groupLeave`). Always returns `true`.

```typescript title="delete.ts"
await chat.delete();
```

!!! warning "Irreversible"
    `delete()` cascades over the `/chat/<id>` subtree, which includes every message and its stored
    payload. Back up your engine snapshot if you need the history.

---

## Statics (via `wa.Chat`)

| Static         | Signature                                                  | Notes                                                                          |
| -------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `wa.Chat.get`  | `(cid: string \| number) => Promise<Chat \| null>`         | Resolves phone / JID / LID / group id. `null` only when it cannot be resolved.   |
| `wa.Chat.list` | `(offset?: number, limit?: number) => Promise<Chat[]>`     | Paginates persisted chats, most recent first. Defaults: `0, 50`.                 |

There are no per-action statics (`wa.Chat.pin`, `wa.Chat.mute`, …): fetch the chat once and call the
method on the instance.

```typescript title="statics.ts" hl_lines="4 5 6"
const cid = '5215555555555';

const chat = await wa.Chat.get(cid);
if (chat) {
    await chat.pin(true);
    await chat.mute('2026-08-01T10:00:00Z');
    await chat.seen();
}

const chats = await wa.Chat.list(0, 100);
console.log(`Tracking ${chats.length} chats.`);
```

---

## Groups

There is no separate group class: a group is a `Chat` whose identifier ends with `@g.us`.

```typescript title="groups.ts"
wa.on('message:created', async (msg, chat) => {
    if (chat.type === 'group') {
        const author = await msg.author();
        console.log(`[${chat.name}] ${author.name}: ${msg.caption}`);
    }
});
```

| You want…                 | Use                                        |
| ------------------------- | ------------------------------------------ |
| The subject / description | `await chat.content()`                     |
| The participants          | `await chat.members(0, 500)`               |
| To leave the group        | `await chat.delete()`                      |
| To send to the group      | `await wa.Message.text(chat._raw.id, '…')` |
