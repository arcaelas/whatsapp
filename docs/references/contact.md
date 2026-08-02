# Contact

The `Contact` entity is a **minimal card** derived from the raw contact document: who the person
is (`name`), how to address them (`phone`, `jid`, `lid`) and what they look like (`photo`). Every
value is a synchronous getter over `_raw`; nothing is fetched lazily behind your back.

`Contact.get(uid)` is the single entry point and dispatches by identifier shape:

- Plain phone (digits only, no `@`) → normalized to `<digits>@s.whatsapp.net`.
- JID (`<number>@s.whatsapp.net`) → resolved and read from the engine.
- LID (`<number>@lid`) → resolved through the persisted LID↔JID index, or through baileys'
  own LID mapping when the index has no entry yet.

Group JIDs (`@g.us`) are rejected — use [`wa.Chat.get(groupId)`](chat.md) for those.

---

## Import

```typescript title="imports.ts"
import { WhatsApp, Contact, FileSystemEngine } from '@arcaelas/whatsapp';
```

You rarely construct contacts yourself: use `wa.Contact`, the session-bound subclass produced by
the internal `contact(wa)` factory. The exported `Contact` class carries the getters only.

!!! warning "Typing your own helpers"
    `chat()` lives on the bound subclass, so a parameter annotated with the exported `Contact` will
    not see it. Derive the right type instead:

    ```typescript
    import type { WhatsApp } from '@arcaelas/whatsapp';

    type Person = InstanceType<WhatsApp['Contact']>;

    async function open(person: Person) {
        const chat = await person.chat();   // available
    }
    ```

---

## Where instances come from

- `wa.Contact.get(uid)` — dispatch by phone, JID or LID.
- `wa.Contact.list(offset, limit)` — paginated reads.
- `chat.members(offset, limit)` — chat participants.
- `msg.author()` — the sender of a message.
- `await wa.account()` — the authenticated account itself, as an [`Account`](#account).
- `contact:created` / `contact:updated` event payloads.

```typescript title="bootstrap.ts"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({ engine: new FileSystemEngine('./.whatsapp') });

await wa.connect((auth) => console.log(auth));

// Phone number (digits only)
const by_phone = await wa.Contact.get('5215555555555');

// JID
const by_jid = await wa.Contact.get('5215555555555@s.whatsapp.net');

// LID (hidden identifier assigned by WhatsApp)
const by_lid = await wa.Contact.get('192837465@lid');

console.log(by_phone?.name, by_jid?.phone, by_lid?.lid);
```

!!! info "Why the dispatch?"
    WhatsApp exposes several flavors of identifier for the same user. `Contact.get` normalizes them
    through the client's internal resolver, so your code only ever passes strings (or numbers) in
    and gets back a normalized `Contact`.

---

## Properties

All properties are synchronous getters over the internal `_raw` document.

| Property | Type             | Description                                                                                        |
| -------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| `name`   | `string`         | Address-book name → push name → verified business name → phone → the id without its domain.        |
| `phone`  | `string \| null` | Digits of the **PN JID only**, never derived from a LID. `null` when no JID is determinable.        |
| `jid`    | `string \| null` | Legacy JID (`@s.whatsapp.net`) reported by baileys or derived from the id. `null` when unknown.     |
| `lid`    | `string \| null` | LID (`@lid`) when definable, `null` otherwise.                                                      |
| `photo`  | `string \| null` | Profile picture URL; `null` when absent or not an `http` URL (baileys reports `changed` on rotation). |

!!! warning "There is no `id`, `me` or `content` getter"
    A contact exposes exactly the five properties above plus `chat()`. The persisted document is
    available as `_raw` (`id`, `lid`, `phone_number`, `name`, `notify`, `verified_name`, `img_url`,
    `status`), but it is internal: prefer the getters. The bio (`status`) is reachable through
    [`chat.content()`](chat.md#content) on the 1:1 chat.

```typescript title="properties.ts"
const person = await wa.Contact.get('5215555555555');

if (person) {
    console.log(person.name);   // 'Alice' | '5215555555555'
    console.log(person.phone);  // '5215555555555' | null
    console.log(person.jid);    // '5215555555555@s.whatsapp.net' | null
    console.log(person.lid);    // '192837465@lid' | null
    console.log(person.photo);  // 'https://pps.whatsapp.net/…' | null
}
```

---

## Methods

### `chat()`

```typescript
chat(): Promise<Chat>
```

Resolves the contact's 1:1 `Chat`: the document persisted in the engine, or a minimal instance
built on the spot when the conversation does not exist yet. It is async because the lookup goes
through the engine.

```typescript title="contact-chat.ts"
const person = await wa.Contact.get('5215555555555');

if (person) {
    const chat = await person.chat();
    await chat.typing(true);
    await wa.Message.text(chat.id, 'Ready to go!');
    await chat.typing(false);
}
```

!!! tip "Groups are not contacts"
    `Contact.get` filters out `@g.us` identifiers. To reach a group, call `wa.Chat.get(groupId)`
    and use `chat.members()` to hydrate its participants as contacts.

---

## Statics (via `wa.Contact`)

| Static            | Signature                                                     | Notes                                                                                        |
| ----------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `wa.Contact.get`  | `(uid: string \| number) => Promise<Contact \| null>`         | Engine first; if not persisted, discovers it over the network and materializes the document.  |
| `wa.Contact.list` | `(offset?: number, limit?: number) => Promise<Contact[]>`     | Paginated persisted contacts, most recent first. Defaults: `0, 50`.                           |

### Discovery in `get`

When the engine has no `/contact/<jid>` document and the socket is up, `get` probes the network:

1. `onWhatsApp(phone)` — verifies the account exists and returns its canonical JID (plus LID).
2. `profilePictureUrl(jid)` — fills `img_url`.
3. `fetchStatus(jid)` — fills the bio.
4. Writes `/contact/<jid>` and, when a LID was returned, the `/lid/<lid>` index entry.

It returns `null` when the identifier cannot be resolved or the number is not on WhatsApp.

```typescript title="statics.ts"
// Iterate every persisted contact
let offset = 0;

while (true) {
    const batch = await wa.Contact.list(offset, 100);
    if (batch.length === 0) {
        break;
    }
    for (const person of batch) {
        console.log(person.phone, person.name, person.photo ?? '(no photo)');
    }
    offset += batch.length;
}
```

---

## Account

`Account extends Contact` is the authenticated user, returned by [`wa.account()`](whatsapp.md#the-account).
On top of every `Contact` getter it operates on the own profile:

| Member                | What it does                                                              |
| --------------------- | ------------------------------------------------------------------------- |
| `rename(name)`        | Updates the public name on WhatsApp (and on the instance).                |
| `picture(content)`    | Sets the profile picture (Buffer or https URL); `null` removes it.        |
| `content()`           | Reads the bio.                                                            |
| `content(text)`       | Updates the bio.                                                          |
| `online(value)`       | Publishes presence; the socket starts offline (`markOnlineOnConnect: false`). |
| `post({ caption, buffer, audience })` | Publishes a status; the audience accepts `Contact`, JID, LID or phone. |

---

## Persistence paths

Contact-related records live under the following keys in the configured engine:

| Path             | Value                                                        | Written by                                                              |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `/contact/<id>`  | Serialized contact document.                                 | `contacts.upsert` / `contacts.update`, inbound messages, `Contact.get`.  |
| `/lid/<lid>`     | Serialized JID string — forward index for LID resolution.    | `Contact.get`, contact upserts, `lid-mapping.update`.                    |
| `/lid/<pn>`      | Serialized LID string — reverse index.                       | `lid-mapping.update`.                                                    |
| `/chat/<id>`     | Chat document; `chat()` hydrates from here.                  | `chats.*` events, inbound messages.                                     |

!!! warning "Engine consistency"
    When `autoclean` is `true` (default) and a remote `loggedOut` is received, the entire engine is
    wiped to force a fresh sync on the next login. Set `autoclean: false` in the `WhatsApp`
    constructor if you want to keep contacts, chats and messages across re-auths.

```typescript title="preserve-data.ts"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new FileSystemEngine('./.whatsapp'),
    autoclean: false, // keep /contact/*, /lid/*, /chat/* across relogins
});
```
