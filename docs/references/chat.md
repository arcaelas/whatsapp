# Chat

The `Chat` entity represents a WhatsApp conversation — either a 1:1 chat with a contact or a group. It exposes read-only metadata (name, description, pinned/archived/muted state) and mutating methods that propagate changes to WhatsApp servers and local persistence via the configured engine.

Every instance is bound to a `WhatsApp` context through the `chat(wa)` factory, which also exposes static delegates such as `wa.Chat.get(cid)`, `wa.Chat.list(offset, limit)` and per-action shortcuts (`pin`, `archive`, `mute`, `seen`, `clear`, `delete`).

---

## Import

```typescript title="imports.ts"
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";
// or
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";
```

The `Chat` class itself is not exported as a top-level name. Access the bound constructor through `wa.Chat` (returned from the `chat(wa)` factory internally wired by the `WhatsApp` constructor).

---

## Constructor

`Chat` instances are not meant to be built manually. They are produced by:

- `wa.Chat.get(cid)` — load or bootstrap by CID.
- `wa.Chat.list(offset, limit)` — paginated read of persisted chats.
- `contact.chat` — eager property on a `Contact` instance (1:1 chats).
- Event payloads (`message:created`, `message:updated`, etc.) — the second argument is always the `Chat` the message belongs to.

```typescript title="bootstrap.ts"
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new RedisEngine({ url: "redis://127.0.0.1:6379" }),
});

await wa.connect();

const chat = await wa.Chat.get("5215555555555@s.whatsapp.net");
if (chat) {
  console.log(chat.name, chat.type);
}
```

!!! info "Auto-bootstrap"
    `wa.Chat.get(cid)` resolves the CID (phone, JID, or LID). If no record exists in the engine but the contact is reachable, a minimal `IChatRaw` document is created and persisted before returning the instance.

---

## Properties

All properties are synchronous getters over the internal `_raw: IChatRaw` document.

| Property | Type | Description |
| -------- | ---- | ----------- |
| `id` | `string` | JID of the chat (e.g. `5215555555555@s.whatsapp.net` or `120363...@g.us`). |
| `cid` | `string` | Alias of `id`. Use whichever reads better in your code. |
| `type` | `"contact" \| "group"` | Derived from the JID suffix (`@g.us` → group). |
| `name` | `string` | Local name → display name → phone fallback. |
| `content` | `string` | Group description (empty string for 1:1 chats). |
| `pinned` | `boolean` | `true` when the pin flag is set. |
| `archived` | `boolean` | `true` if the chat is archived. |
| `muted` | `boolean` | `true` when the chat is muted and the mute window has not expired. |
| `read` | `boolean` | `true` when `unread_count === 0` and the chat is not marked as unread. |
| `readonly` | `boolean` | `true` for broadcast/announce-only channels. |

### `IChatRaw`

Persisted shape backing every `Chat` instance.

```typescript title="IChatRaw.ts"
export interface IChatRaw {
  id: string;
  name?: string | null;
  display_name?: string | null;
  description?: string | null;
  unread_count?: number | null;
  read_only?: boolean | null;
  archived?: boolean | null;
  pinned?: number | null;
  mute_end_time?: number | null;
  marked_as_unread?: boolean | null;
  participants?: GroupParticipant[] | null;
  created_by?: string | null;
  created_at?: number | null;
  ephemeral_expiration?: number | null;
}

export interface GroupParticipant {
  id: string;
  admin: string | null; // "admin" | "superadmin" | null
}
```

---

## Methods

Instance methods that mutate state always write through to the socket first and then persist the new snapshot to the engine.

### `refresh()`

Re-hydrates chat metadata from the live socket. For groups, fetches the full group metadata (subject, description, participants, owner). For 1:1, refreshes the associated contact's profile and syncs the display name.

```typescript title="refresh.ts"
const chat = await wa.Chat.get(cid);
await chat?.refresh();
```

Returns `this` on success, `null` if there is no active socket.

### `pin(value: boolean)`

Pins or unpins the chat. Propagates to WhatsApp via `chatModify` and requires a reference to the last message in the chat.

```typescript title="pin.ts"
await chat.pin(true);  // pin
await chat.pin(false); // unpin
```

### `archive(value: boolean)`

Archives or unarchives the chat.

```typescript title="archive.ts"
await chat.archive(true);
```

### `mute(value: boolean)`

Mutes the chat. `true` mutes forever (internally set to ~100 years). `false` restores notifications.

```typescript title="mute.ts"
await chat.mute(true);  // mute forever
await chat.mute(false); // unmute
```

### `seen()`

Marks every message in the chat as read. Reads the last persisted message to build the ack key.

```typescript title="seen.ts"
await chat.seen();
```

### `typing(on: boolean)` / `recording(on: boolean)`

Toggle presence indicators. They send a `sendPresenceUpdate` call with `composing`/`recording` or `paused`.

```typescript title="typing.ts"
await chat.typing(true);
await new Promise((r) => setTimeout(r, 1_500));
await chat.typing(false);
```

!!! tip "Natural cadence"
    Set `typing(true)`, send the message, then `typing(false)` to mimic human behavior. Keep the window short (1–3 s) — WhatsApp clears `composing` automatically after a few seconds.

### `clear()`

Clears all persisted messages of the chat from the local engine. Does not touch the remote chat.

```typescript title="clear.ts"
await chat.clear();
```

### `delete()`

Deletes the chat locally and remotely. For groups, leaves the group (`groupLeave`). For 1:1, fires `chatModify { delete: true }`. Removes the chat document and all messages from the engine.

```typescript title="delete.ts"
await chat.delete();
```

!!! warning "Irreversible"
    `delete()` cascades into the local `/chat/{cid}/message` prefix. Back up your engine snapshot if you need the history.

### `members(offset?: number, limit?: number)`

Returns chat participants as `Contact` instances. For 1:1 chats, yields the other party (only when `offset === 0`). For groups, pages through `groupMetadata().participants`, hydrating each participant via `wa.Contact.get`.

```typescript title="members.ts"
const chat = await wa.Chat.get("120363000000000000@g.us");
if (chat?.type === "group") {
  let offset = 0;
  while (true) {
    const batch = await chat.members(offset, 50);
    if (batch.length === 0) break;
    for (const member of batch) {
      console.log(member.phone, member.name);
    }
    offset += batch.length;
  }
}
```

### `messages(offset?: number, limit?: number)`

Shortcut for `wa.Message.list(this.id, offset, limit)`. Returns messages ordered by engine mtime DESC.

```typescript title="messages.ts"
const latest = await chat.messages(0, 20);
for (const msg of latest) {
  console.log(msg.type, msg.caption);
}
```

### `contact()` *(1:1 only)*

For 1:1 chats, the fastest way to obtain the counterpart is through `wa.Contact.get(chat.id)`. For the inverse (contact → chat), use the eager `contact.chat` property.

```typescript title="contact-from-chat.ts"
const chat = await wa.Chat.get("5215555555555@s.whatsapp.net");
if (chat?.type === "contact") {
  const contact = await wa.Contact.get(chat.id);
  console.log(contact?.name);
}
```

---

## Static (delegate via `wa.Chat`)

Every mutating method has a static delegate bound to the `WhatsApp` instance. They resolve the CID internally and fall back to `false`/`null` when no chat matches.

| Delegate | Signature | Notes |
| -------- | --------- | ----- |
| `wa.Chat.get` | `(cid: string) => Promise<Chat \| null>` | Resolves phone/JID/LID and bootstraps from contact when missing. |
| `wa.Chat.list` | `(offset?: number, limit?: number) => Promise<Chat[]>` | Paginates persisted chats by mtime DESC. Defaults: `0, 50`. |
| `wa.Chat.pin` | `(cid: string, value: boolean) => Promise<boolean>` | |
| `wa.Chat.archive` | `(cid: string, value: boolean) => Promise<boolean>` | |
| `wa.Chat.mute` | `(cid: string, value: boolean) => Promise<boolean>` | |
| `wa.Chat.seen` | `(cid: string) => Promise<boolean>` | |
| `wa.Chat.clear` | `(cid: string) => Promise<boolean>` | Local only. |
| `wa.Chat.delete` | `(cid: string) => Promise<boolean>` | Remote + local. |

```typescript title="delegates.ts" hl_lines="12 13 14"
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new FileSystemEngine({ path: "./.whatsapp" }),
});

await wa.connect();

const cid = "5215555555555@s.whatsapp.net";

// One-liner delegates — no need to hydrate the Chat instance first
await wa.Chat.pin(cid, true);
await wa.Chat.mute(cid, true);
await wa.Chat.seen(cid);

// Paginated listing
const chats = await wa.Chat.list(0, 100);
console.log(`Tracking ${chats.length} chats.`);
```

!!! tip "When to use statics vs instances"
    Reach for static delegates when you already have a `cid` string from an event payload or a stored reference — they save a round-trip. Instantiate a `Chat` when you need metadata (`name`, `type`, `members()`) or will run several operations on the same chat.
