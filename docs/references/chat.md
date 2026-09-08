# Chat

The `Chat` entity represents a WhatsApp conversation — either a 1:1 chat with a contact or a group.
It exposes read-only metadata through synchronous getters (name, type, pinned/archived/muted state,
unread count) and mutating methods that propagate changes to WhatsApp and to local persistence
through the configured engine.

Every instance is bound to a `WhatsApp` context through the internal `chat(wa)` factory, which also
exposes the statics `wa.Chat.get(cid)`, `wa.Chat.list(offset, limit)`, `wa.Chat.create(name, members)`
and `wa.Chat.join(invite)`.

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
- `wa.Chat.create(name, members)` — a group you just created.
- `wa.Chat.join(invite)` — a group you just entered by invite link.
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

Mutating methods write to the socket first and then persist the new snapshot to the engine. The
group-only ones (`rename`, `describe`, `picture`, `add`, `remove`, `promote`, `demote`, `invite`,
`revoke`, `announce`, `restrict`) return `false`, `null` or `0` on a 1:1 chat and do nothing.

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

### `admins(offset?, limit?)` / `admin()`

```typescript
admins(offset = 0, limit = 50): Promise<Contact[]>
admin(): Promise<boolean>
```

`admins()` returns the group administrators as `Contact` instances (empty on a 1:1); `admin()` says
whether the **account itself** administers the group. Every group operation below needs it, so check
first when the outcome matters.

```typescript title="admins.ts"
if (await chat.admin()) {
    console.log('I can moderate', (await chat.admins()).map((who) => who.name));
}
```

### `messages(offset?, limit?)`

```typescript
messages(offset = 0, limit = 50): Promise<Message[]>
```

Shortcut for `wa.Message.list(chat._raw.id, offset, limit)`. Messages come back from the most
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
    `pin(true)` returns `false` when three other chats are already pinned and nothing is sent.

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

### `ephemeral(seconds)`

```typescript
ephemeral(seconds: 86_400 | 604_800 | 7_776_000 | false): Promise<boolean>
```

Disappearing messages for the chat: one day, one week, 90 days, or `false` to turn them off. On a
group it needs admin rights; on a 1:1 it applies to both sides.

```typescript title="ephemeral.ts"
await chat.ephemeral(604_800);   // a week
await chat.ephemeral(false);     // off
```

### `watch(handler)`

```typescript
watch(handler: (event: { name: ChatWatch; payload: Contact | Message }) => void): Promise<() => void>
```

Supervises the whole conversation: what the person on the other end does (`online`, `offline`,
`typing`, `recording`, `stopped-typing`, `stopped-recording`, with the `Contact` as payload) and every
new `message` (with the `Message` as payload). On a group there is no single person to follow, so
only the messages arrive. It returns the function that stops watching.

```typescript title="watch.ts"
const stop = await chat.watch(({ name, payload }) => {
    if (name === 'message') console.log('new:', (payload as Message).caption);
    else console.log(chat.name, 'is', name);
});

stop();
```

!!! info "Presence is per session"
    WhatsApp does not broadcast presence on its own and stops sending it on reconnect, so the watch
    is set up again on every new session.

### `rename(name)` / `describe(text)` / `picture(content)`

```typescript
rename(name: string): Promise<boolean>
describe(text: string): Promise<boolean>
picture(content: Buffer | string | null): Promise<boolean>
```

Change the group's subject, description (empty text removes it) and picture (`Buffer`, `https` URL,
or `null` to remove). WhatsApp confirms the first two with `chat:updated`. `picture()` needs `sharp`
or `jimp` installed and throws `ERR_PROFILE_PICTURE_LIB` otherwise.

```typescript title="edit-group.ts"
await chat.rename('Dev Team');
await chat.describe('Daily standup at 9:30');
await chat.picture(await readFile('./team.jpg'));
```

### `add(...who)` / `remove(...who)` / `promote(...who)` / `demote(...who)`

```typescript
add(...who: (string | number | Contact)[]): Promise<number>
remove(...who: (string | number | Contact)[]): Promise<number>
promote(...who: (string | number | Contact)[]): Promise<number>
demote(...who: (string | number | Contact)[]): Promise<number>
```

Manage the participants by phone, JID, LID or `Contact`. Each call returns **how many** WhatsApp
accepted: a person whose privacy forbids being added, or who is not in the group, does not count.
The changes travel back as `chat:joined`, `chat:left`, `chat:promoted` and `chat:demoted`.

```typescript title="participants.ts"
const added = await chat.add('5491112345678', '5491187654321');   // 2 when both entered
await chat.promote('5491112345678');
await chat.demote('5491112345678');
await chat.remove('5491187654321');
```

!!! warning "WhatsApp decides who can be added"
    A person whose *Groups* privacy is set to *My contacts* cannot be added by an account they do
    not have saved, and someone removed from a group cannot be added back right away. In both cases
    `add()` returns `0`: hand them the invite link instead.

### `invite()` / `revoke()`

```typescript
invite(): Promise<string | null>
revoke(): Promise<string | null>
```

The current invite link (`https://chat.whatsapp.com/<code>`), or a fresh one after invalidating the
previous. Both return `null` on a 1:1 and when the account does not administer the group.

```typescript title="invite.ts"
const link = await chat.invite();
const fresh = await chat.revoke();   // the old link stops working
```

### `announce(value)` / `restrict(value)`

```typescript
announce(value: boolean): Promise<boolean>
restrict(value: boolean): Promise<boolean>
```

`announce(true)` lets only admins send messages; `restrict(true)` lets only admins edit the group
info. `false` opens each one to everyone again.

```typescript title="settings.ts"
await chat.announce(true);    // read-only for members
await chat.restrict(true);    // members cannot rename or describe
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

| Static           | Signature                                                  | Notes                                                                          |
| ---------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `wa.Chat.get`    | `(cid: string \| number) => Promise<Chat \| null>`         | Resolves phone / JID / LID / group id. `null` only when it cannot be resolved.   |
| `wa.Chat.list`   | `(offset?: number, limit?: number) => Promise<Chat[]>`     | Paginates persisted chats, most recent first. Defaults: `0, 50`.                 |
| `wa.Chat.create` | `(name: string, members: (string \| number \| Contact)[]) => Promise<Chat>` | Creates a group with the account as admin and persists its chat. Members WhatsApp could not add are simply absent. |
| `wa.Chat.join`   | `(invite: string) => Promise<Chat \| null>`                 | Joins a group by its invite link or bare code. `null` when WhatsApp did not admit the account. |

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

const team = await wa.Chat.create('Dev Team', ['5491112345678', '5491187654321']);
console.log(team._raw.id, await team.invite());

const joined = await wa.Chat.join('https://chat.whatsapp.com/AbCdEfGhIjK');
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
| The admins, or whether you are one | `await chat.admins()`, `await chat.admin()` |
| To create or join one     | `await wa.Chat.create(name, members)`, `await wa.Chat.join(link)` |
| To rename or describe it  | `await chat.rename('…')`, `await chat.describe('…')` |
| To manage participants    | `await chat.add(…)`, `remove(…)`, `promote(…)`, `demote(…)` |
| The invite link           | `await chat.invite()`, `await chat.revoke()` |
| Admin-only mode           | `await chat.announce(true)`, `await chat.restrict(true)` |
| To mention someone        | `await wa.Message.text(chat._raw.id, '@5491112345678 hi', { mentions: ['5491112345678'] })` |
| To leave the group        | `await chat.delete()`                      |
| To send to the group      | `await wa.Message.text(chat._raw.id, '…')` |
