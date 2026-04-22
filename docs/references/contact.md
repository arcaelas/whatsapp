# Contact

The `Contact` entity represents any WhatsApp user your session is aware of — whether they started a chat, appear in a group, or were discovered via `onWhatsApp` lookups. Every contact ships with an eager `chat` property pointing to its 1:1 `Chat` instance, so you can jump from "who" to "where" without extra lookups.

`Contact.get(uid)` is the single entry point and dispatches by identifier shape:

- Plain phone (digits only, no `@`) → resolved through `socket.onWhatsApp(phone)`.
- JID (`<number>@s.whatsapp.net`) → looked up in the engine, refreshed from socket if missing.
- LID (`<number>@lid`) → resolved via the persisted LID↔JID mapping.

---

## Import

```typescript title="imports.ts"
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";
// or
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";
```

Use the bound constructor via `wa.Contact`. The `contact(wa)` factory (internal) produces a `_Contact` subclass tied to the WhatsApp context — that is what static delegates operate on.

---

## Constructor

Like `Chat`, `Contact` instances are not intended to be built directly. They come from:

- `wa.Contact.get(uid)` — smart dispatch by phone, JID, or LID.
- `wa.Contact.list(offset, limit)` — paginated reads.
- `chat.members()` — group participants.
- Event handlers for `contact:created`/`contact:updated`.
- `msg.author()` — the sender of a message.

```typescript title="bootstrap.ts"
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new RedisEngine({ url: "redis://127.0.0.1:6379" }),
});

await wa.connect();

// Phone number (digits only)
const byPhone = await wa.Contact.get("5215555555555");

// JID
const byJid = await wa.Contact.get("5215555555555@s.whatsapp.net");

// LID (hidden identifier assigned by WhatsApp)
const byLid = await wa.Contact.get("192837465@lid");

console.log(byPhone?.name, byJid?.phone, byLid?.id);
```

!!! info "Why the smart dispatch?"
    WhatsApp exposes three flavors of identifier for the same user. `Contact.get` normalizes them through an internal resolver plus a live `onWhatsApp` probe, so your code only ever passes strings in and gets back a normalized `Contact` (with a valid JID on `.id`).

---

## Properties

All properties are synchronous getters over the internal `_raw: IContactRaw` shape — except `chat`, which is hydrated eagerly at construction.

| Property | Type | Description |
| -------- | ---- | ----------- |
| `id` | `string` | Canonical JID (e.g. `5215555555555@s.whatsapp.net`). |
| `jid` | `string` | Alias of `id`. |
| `lid` | `string \| null` | Linked device identifier (`@lid`) when available. |
| `name` | `string` | Local name → push notify → phone fallback. |
| `phone` | `string` | Digits before `@` in the JID. |
| `photo` | `string \| null` | Profile picture URL (cached after first `refresh`/`get`). |
| `content` | `string` | Status/bio text. |
| `me` | `boolean` | `true` when the instance represents the authenticated account. |
| `chat` | `Chat` | Eager 1:1 chat bound to this contact. |

### `IContactRaw`

```typescript title="IContactRaw.ts"
export interface IContactRaw {
  id: string;
  lid?: string | null;
  name?: string | null;
  notify?: string | null;
  verified_name?: string | null;
  img_url?: string | null;
  status?: string | null;
}
```

### Eager `chat` property

`Contact.chat` is not a function — it is a fully constructed `wa.Chat` instance available synchronously. It lets you pipeline calls like:

```typescript title="eager-chat.ts"
const contact = await wa.Contact.get("5215555555555");
if (contact) {
  await contact.chat.pin(true);
  await contact.chat.typing(true);
  await wa.Message.text(contact.chat.id, "Ready to go!");
  await contact.chat.typing(false);
}
```

!!! tip "`chat` for groups"
    Only 1:1 chats are discovered by `Contact.get`. Group JIDs (`@g.us`) are filtered out — use `wa.Chat.get(groupJid)` when you need the group entity.

---

## Methods

### `rename(name: string)`

Renames the contact locally (device address book only). Does not propagate to WhatsApp servers, but the new value is immediately visible through `.name` and persisted via the engine.

```typescript title="rename.ts"
const contact = await wa.Contact.get("5215555555555");
await contact?.rename("Alice Example");
```

Returns `true` on success, `false` when the contact cannot be resolved.

### `refresh()`

Re-hydrates `photo` and `content` (bio/status) from the live socket and rewrites the engine document. Returns `this` on success, `null` if there is no active socket.

```typescript title="refresh.ts"
const contact = await wa.Contact.get("5215555555555@s.whatsapp.net");
await contact?.refresh();
console.log(contact?.photo, contact?.content);
```

!!! info "Automatic hydration"
    `wa.Contact.get(uid)` already fetches profile data the first time a JID is seen. Call `refresh()` only when you need fresh metadata (e.g. the user updated their avatar).

---

## Static (delegate via `wa.Contact`)

| Delegate | Signature | Notes |
| -------- | --------- | ----- |
| `wa.Contact.get` | `(uid: string) => Promise<Contact \| null>` | Smart dispatch: phone / JID / LID. |
| `wa.Contact.list` | `(offset?: number, limit?: number) => Promise<Contact[]>` | Paginated persisted contacts (mtime DESC). Defaults: `0, 50`. Each result has `chat` pre-loaded. |
| `wa.Contact.rename` | `(uid: string, name: string) => Promise<boolean>` | Delegate to instance `rename`. |
| `wa.Contact.refresh` | `(uid: string) => Promise<Contact \| null>` | Delegate to instance `refresh`. |

```typescript title="delegates.ts"
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new FileSystemEngine({ path: "./.whatsapp" }),
});

await wa.connect();

// One-liner delegates
await wa.Contact.rename("5215555555555", "Alice");
await wa.Contact.refresh("5215555555555@s.whatsapp.net");

// Iterate every contact
let offset = 0;
while (true) {
  const batch = await wa.Contact.list(offset, 100);
  if (batch.length === 0) break;
  for (const c of batch) {
    console.log(c.phone, c.name, c.photo ?? "(no photo)");
  }
  offset += batch.length;
}
```

---

## Persistence paths

Contact-related records live under the following keys in the configured engine:

| Path | Value | Written by |
| ---- | ----- | ---------- |
| `/contact/{jid}` | Serialized `IContactRaw`. | `Contact.get`, `rename`, `refresh`, `contact:*` events. |
| `/lid/{lid}` | Serialized JID string — reverse index for LID resolution. | `Contact.get` when a LID is discovered; `lid-mapping.update` event. |
| `/chat/{jid}` | Serialized `IChatRaw` — the eager `contact.chat` loads from here. | `Chat.get`, message persistence, `chats.*` events. |

!!! warning "Engine consistency"
    When `autoclean` is `true` (default) and a remote `loggedOut` is received, the entire engine is wiped to force a fresh sync on the next login. Set `autoclean: false` in the `WhatsApp` constructor options if you want to keep contacts/chats/messages across re-auths.

```typescript title="preserve-data.ts"
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new RedisEngine({ url: "redis://127.0.0.1:6379" }),
  autoclean: false, // keep /contact/*, /lid/*, /chat/* across relogins
});
```
