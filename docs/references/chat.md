# Chat

The `Chat` entity represents a WhatsApp conversation — a 1:1 chat with a contact or a group. What
the chat is (`id`, `type`, `count`) are getters; every value the account can also change is a single
method that reads without an argument and writes with one, and rejects with `UNAUTHORIZED` when
the account has no right to change it.

The class is `wa.Chat`, built when the session connects by the `chat` factory —the default export of
`src/lib/chat.ts`, published as `chat`—, which only depends on the session and on baileys.

---

## Import

```typescript title="imports.ts"
import { WhatsApp, FileSystemEngine, type Chat } from '@arcaelas/whatsapp';
```

`Chat` is exported as a type: the instance of `wa.Chat`, with every getter and method below. The
class itself is `wa.Chat`, published by the session: use it to construct a chat (`new wa.Chat(raw)`),
for the statics and for `instanceof`.

---

## Where instances come from

- `wa.Chat.get(cid)` — the stored chat by phone, JID, LID or group id, or `null`.
- `wa.Chat.list(offset, limit)` — paginated read of persisted chats.
- `wa.Chat.create(name, members)` — a group you just created.
- `wa.Chat.join(invite)` — a group you just entered by invite link.
- `new wa.Chat(raw)` — from a baileys `Chat` document.
- `contact.chat()` — the 1:1 chat of a `Contact`, stored or built on the spot.
- `msg.chat()` — the chat a message belongs to.
- Event payloads (`message:*`, `chat:*`, `contact:*`) — the `Chat` travels with them.

```typescript title="bootstrap.ts"
const chat = await wa.Chat.get('5215555555555');
if (chat) {
    console.log(chat.name(), chat.type, chat.count);
}
```

---

## Properties

| Property | Type                   | Description                                                                               |
| -------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| `id`     | `string`               | Full JID: the phone's on a 1:1, the `@g.us` on a group, the LID when it is not mapped. Same format as `contact.id` and `msg.cid`. |
| `type`   | `'contact' \| 'group'` | 1:1 conversation or group.                                                                |
| `count`  | `number`               | Unread messages; `seen()` sets it to `0`.                                                 |

---

## Methods

Every method works on a 1:1 and on a group unless it says otherwise. What changes the account's own
state —archive, pin, mute, rename, describe, disappearing messages— is stored in the instance and in
the engine as soon as WhatsApp accepts it, and emits the matching `chat:*` event; WhatsApp's echo
arriving later finds no difference and does not repeat it. A group operation rejects with
`UNAUTHORIZED` when the account lacks the permission or is not in the group, and on a 1:1 when it
only exists in groups.

### `name()` / `name(value)`

```typescript
name(): string
name(value: string): Promise<string>
```

On a 1:1, the contact's name (address book, public name or phone); on a group, the subject. With
text, on a 1:1 it changes the name the account saves the contact with in its address book —on the
chat and on the card, the same as [`contact.rename(value)`](contact.md#rename-name)—, and on a group
it tries to change the subject, which needs permission.

### `content()` / `content(value)`

```typescript
content(value?: string): Promise<string>
```

On a 1:1, the contact's bio as [`contact.content()`](contact.md#content-contentvalue) reads it —from
WhatsApp, or the stored one without network—; on a group, the description. With text it tries to
change the group description (`''` removes it); on a 1:1 it rejects, because the bio belongs to the
other person.

### `photo()` / `photo(value)`

```typescript
photo(value?: Buffer | null): Promise<Buffer>
```

On a 1:1, the contact's picture; on a group, the group's, stored under `/chat/<id>/photo` and,
like the contact's, checked again after 24 hours and downloaded only when it changed. An empty Buffer when there is none or privacy hides it. With
a Buffer it tries to change the group picture (`null` removes it) and returns the result; on a 1:1
it rejects. It rejects with `ERR_PROFILE_PICTURE_LIB` when neither `sharp` nor `jimp` is installed.

### `archived()` / `pinned()` / `muted()`

```typescript
archived(): boolean
archived(value: boolean): Promise<boolean>
pinned(): boolean
pinned(value: boolean): Promise<boolean>
muted(): string | null
muted(until: string | number | Date | false): Promise<string | null>
```

Read or change whether the chat is archived, pinned —WhatsApp allows three, so `pinned(true)`
returns `false` when there is no room, counted with the `/pinned` index in a single read— or muted until an ISO date (`false` unmutes it). They only
affect the account.

```typescript title="state.ts"
await chat.archived(true);
await chat.muted(Date.now() + 8 * 3_600_000);
console.log(chat.pinned(), chat.muted());
```

### `blocked()` / `blocked(value)`

```typescript
blocked(value?: boolean): Promise<boolean>
```

On a 1:1, reads or changes whether the account has the contact blocked; the stored `/blocklist` is
updated right away, because WhatsApp does not notify the own change. On a group it rejects.

### `ephemeral()` / `ephemeral(value)`

```typescript
ephemeral(): number | false
ephemeral(value: 86_400 | 604_800 | 7_776_000 | false): Promise<number | false>
```

Reads or sets the duration of disappearing messages: 24 hours, 7 days or 90 days, or `false` to turn
them off. On a 1:1 either side can change it; on a group it tries and rejects without permission.

### `seen()` / `seen(false)`

```typescript
seen(value?: boolean): Promise<boolean>
```

With `true` or no argument, marks the pending messages as read —the other side sees the blue ticks—
and sets `count` to `0`. With `false` it marks the chat as unread, like WhatsApp's option; WhatsApp
has no unread state per message.

### `typing(value)` / `recording(value)`

```typescript
typing(value: boolean): Promise<boolean>
recording(value: boolean): Promise<boolean>
```

Show or hide the «typing…» or «recording audio…» notice to the other participants.

!!! info "The account goes online by itself"
    `typing(true)`, `recording(true)` and `seen()` announce the account online, like WhatsApp Web,
    and after 30 seconds without any of them it is announced unavailable: that is what updates the
    last seen others see. Sending messages does not announce it; `(await wa.me())?.online(value)` forces it.

### `messages(offset?, limit?)`

```typescript
messages(offset?: number, limit?: number): Promise<Message[]>
```

The stored messages of the chat, newest first. Defaults: `0, 50`.

### `clear()` / `delete()`

```typescript
clear(): Promise<boolean>
delete(): Promise<boolean>
```

`clear()` empties the messages on the account and in the engine, keeping the chat. `delete()`
removes the chat from the account and from the engine; on a group it also leaves it —when still a
member— and waits for the leave notice, so it does not come back as a read-only chat.

### `members(offset?, limit?)`

```typescript
members(offset?: number, limit?: number): Promise<Contact[]>
```

On a group, the participants; on a 1:1, the contact and the account itself. On a group it rejects
when the account is not in it.

### `admins(offset?, limit?)` / `admin()` / `admin(value, ...who)`

```typescript
admins(offset?: number, limit?: number): Promise<Contact[]>
admin(): Promise<boolean>
admin(value: boolean, ...who: (Contact | string | number)[]): Promise<number>
```

Groups only. `admins()` lists the admins; `admin()` says whether the account is one; `admin(true,
...who)` grants the rank and `admin(false, ...who)` removes it, returning how many it applied to.

### `add(...who)` / `remove(...who)`

```typescript
add(...who: (Contact | string | number)[]): Promise<number>
remove(...who: (Contact | string | number)[]): Promise<number>
```

Groups only. Try to add or remove participants by `Contact`, JID, LID or phone and return how many
it applied to. Someone whose privacy only lets their contacts add them does not join: they need the
[`invite()`](#invite-revoke) link.

### `invite()` / `revoke()`

```typescript
invite(): Promise<string>
revoke(): Promise<string>
```

Groups only. The current invite link, or a new one after revoking the current.

### `announce()` / `restrict()`

```typescript
announce(value?: boolean): Promise<boolean>
restrict(value?: boolean): Promise<boolean>
```

Groups only. Read or change whether only admins send messages (`announce`) or edit the subject,
description and picture (`restrict`).

### `sub(handler)`

```typescript
sub(handler: (event: { name: ChatEvent; payload: Chat; message?: Message; contacts?: Contact[]; presence?: Presence }) => void): () => void
```

Subscribes to everything that happens to the chat: `created`, `updated` —name, description,
archived, pinned, muted— and `deleted`; `message` with the new message in `message`; on a group,
`joined`, `left`, `promoted` and `demoted` with the participants in `contacts`; on a 1:1, `presence`
with the contact's action in `presence`, which needs the account online. It returns the function
that unsubscribes.

```typescript title="sub.ts"
const stop = chat.sub(({ name, message, contacts }) => console.log(name, message?.caption() ?? '', contacts?.length ?? ''));
```

### `metadata()`

```typescript
metadata(): Promise<Record<string, unknown>>
metadata(key: string): Promise<unknown>
metadata(key: string, value: unknown): Promise<Record<string, unknown>>
metadata(patch: Record<string, unknown>): Promise<Record<string, unknown>>
```

Values of your integration attached to the chat under `/chat/<id>/metadata`, the same way as
[`contact.metadata()`](contact.md#metadata): all of them, one key, or a merge where `null` deletes.

---

## Sending

`Chat` extends `Sender`, the base of every send: `chat.text('hi')` sends to this chat and
`wa.Chat.text(cid, 'hi')` to any chat, creating it when it did not exist. The methods, their options
—`mid`, `once`, `expiration`, `mentions`— and stickers are in [Message › Sending](message.md#sending).

```typescript title="send.ts"
const chat = await wa.Chat.get('5215555555555');
await chat?.text('Ready to go!');
await wa.Chat.image('5215555555555', buffer, { caption: 'look', once: true });
```

---

## Statics (via `wa.Chat`)

| Static           | Signature                                                                   | Notes                                                                                   |
| ---------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `wa.Chat.get`    | `(cid: string \| number) => Promise<Chat \| null>`                          | The stored chat by phone, JID, LID or group id; `null` when it is not stored.           |
| `wa.Chat.list`   | `(offset?: number, limit?: number) => Promise<Chat[]>`                      | Persisted chats, most active first. Defaults: `0, 50`.                                  |
| `wa.Chat.create` | `(name: string, members: (Contact \| string \| number)[]) => Promise<Chat>` | Creates a group with the account as admin and stores it. Members WhatsApp could not add are absent. |
| `wa.Chat.join`   | `(invite: string) => Promise<Chat \| null>`                                 | Joins a group by its invite link or bare code; `null` when the link does not work.      |

```typescript title="groups.ts"
const team = await wa.Chat.create('Dev Team', ['5491112345678']);
await team.content('Daily standup at 9:30');
await team.admin(true, '5491112345678');
await team.restrict(true);
console.log(await team.invite());
```
