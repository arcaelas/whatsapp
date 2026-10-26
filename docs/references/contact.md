# Contact

The `Contact` entity is a **minimal card** over the contact document that baileys delivers. Who the
person is (`name`) and how to address them (`id`, `phone`) are synchronous reads of that document;
the bio ([`content()`](#content-contentvalue)), the picture ([`photo()`](#photo-photovalue)) and the
catalogs ([`catalog()`](#catalog)) reach the network. Chat actions —block, mute, pin, archive, mark as
read— live in [`Chat`](chat.md): `await person.chat()` opens it. `Contact` extends `Sender`, so
`person.text('hi')` and the other [sends](message.md#sending), `typing()` and `recording()` go to
its 1:1 chat.

`Contact.get(uid)` is the single entry point and dispatches by identifier shape:

- Plain phone (digits only, no `@`) → normalized to `<digits>@s.whatsapp.net`.
- JID (`<number>@s.whatsapp.net`) → resolved and read from the engine.
- LID (`<number>@lid`) → resolved through the persisted LID↔JID index, or through baileys'
  own LID mapping when the index has no entry yet.

Group JIDs (`@g.us`) yield `null` — use [`wa.Chat.get(group_id)`](chat.md) for those.

---

## Import

```typescript title="imports.ts"
import { WhatsApp, FileSystemEngine, type Contact } from '@arcaelas/whatsapp';
```

`Contact` is exported as a type. The class is `wa.Contact`, which the session builds with the
`contact` factory —the default export of `src/lib/contact.ts`, published as `contact`— when it connects: use it to construct a contact (`new wa.Contact(raw)`) and for
`instanceof`.

!!! tip "Typing your own helpers"
    The exported `Contact` type is the instance of `wa.Contact`, with every getter and method, so it
    can annotate your own parameters:

    ```typescript
    import type { Contact } from '@arcaelas/whatsapp';

    async function open(person: Contact) {
        const chat = await person.chat();   // available
    }
    ```

---

## Where instances come from

- `wa.Contact.get(uid)` — dispatch by phone, JID or LID.
- `wa.Contact.list(offset, limit)` — paginated reads.
- `new wa.Contact(raw)` — from a baileys `Contact` document.
- `chat.members(offset, limit)` — chat participants.
- `msg.author()` — the sender of a message.
- `await wa.me()` — the account itself.
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

console.log(by_phone?.name, by_jid?.phone, by_lid?.id);
```

!!! info "Why the dispatch?"
    WhatsApp exposes several flavors of identifier for the same user. `Contact.get` normalizes them
    through the client's internal resolver, so your code only ever passes strings (or numbers) in
    and gets back a normalized `Contact`.

---

## Properties

Every property is a synchronous getter over the stored document.

| Property | Type             | Description                                                                                 |
| -------- | ---------------- | ------------------------------------------------------------------------------------------- |
| `id`     | `string`         | Full JID: the phone's (`@s.whatsapp.net`) when known, otherwise the LID (`@lid`). Same format as `chat.id` and `msg.from`. |
| `name`   | `string`         | Address-book name → push name → verified business name → phone → the id without its domain. |
| `phone`  | `string \| null` | Digits of the JID. `null` while the contact is only known by an unmapped LID.               |
| `me`     | `boolean`        | `true` when the contact is the account itself, compared by JID and by LID.                  |
| `seen`   | `string \| null` | Last seen as ISO, as its presence delivered it; `null` until it arrives or when privacy hides it. |

!!! info "The document stays private"
    The stored document is the baileys `Contact` (`id`, `lid`, `phoneNumber`, `name`, `notify`,
    `verifiedName`, `imgUrl`, `status`) and the instance keeps it in a private field: the getters
    and methods are the way to read it.

```typescript title="properties.ts"
const person = await wa.Contact.get('5215555555555');

if (person) {
    console.log(person.id);       // '192837465@lid' | '5215555555555@s.whatsapp.net'
    console.log(person.name);     // 'Alice' | '5215555555555'
    console.log(person.phone);    // '5215555555555' | null
}
```

---

## Methods

### `content()` / `content(value)`

```typescript
content(value?: string): Promise<string>
```

Without an argument, the bio. WhatsApp gives no notice when someone changes it, so it is asked at
most once every 24 hours and stored in the engine, under `/contact/<id>/bio`, with the time of the
query; meanwhile it is read from there. When it changed it is also stored in the contact document
and emits `contact:updated`; without network it returns the last stored one. It is `''` both when the
contact has none and when their privacy hides it.

With text it changes the bio of the account itself, stores it and returns it; on any other contact
it rejects with `UNAUTHORIZED`.

```typescript title="content.ts"
console.log(await person.content());   // 'Available' | ''

const me = await wa.me();
await me?.content('Open 9-18h');       // writes the own bio
await person.content('Hi');            // rejects with UNAUTHORIZED
```

### `rename(name)`

```typescript
rename(name: string): Promise<string>
```

On the account itself it changes the WhatsApp public name. On another contact it changes the name the
account saves it with in its address book, like [`chat.name(value)`](chat.md#name-namevalue) on its
1:1 chat: the phone shows it, the card and the chat keep that name and `contact:updated` is emitted.
It returns the name. A group subject is not a contact name: it is changed with `chat.name(value)` and
needs permission.

```typescript title="rename.ts"
await (await wa.me())?.rename('Sales');    // public profile
await person.rename('John from the shop'); // the account's address book
```

### `photo()` / `photo(value)`

```typescript
photo(value?: Buffer | null): Promise<Buffer>
```

Without an argument, the profile picture. It is stored under `/contact/<id>/photo` with the time it
was checked: for 24 hours it comes from the engine; afterwards the URL is asked from WhatsApp again
—the change notice does not reach every account— and it is downloaded only when the picture changed. Without a picture, or when the contact's
privacy hides it, it returns an empty Buffer; without network, the last stored one.

With a Buffer it changes the picture of the account itself, and `null` removes it; it returns the
resulting picture. On any other contact it rejects with `UNAUTHORIZED`, and it rejects with
`ERR_PROFILE_PICTURE_LIB` when neither `sharp` nor `jimp` is installed.

```typescript title="photo.ts"
const picture = await person.photo();
if (picture.length) await writeFile('./avatar.jpg', picture);

await me?.photo(await readFile('./logo.jpg'));   // the own picture
await me?.photo(null);                           // removes it
```

### `catalog()`

```typescript
catalog(): Promise<Catalog[]>
```

The business's product catalogs as [`Catalog`](catalog.md) instances: one per collection or, when
the business has no collections, a single one with every product, the phone as `id` and an empty
`name`. A contact without a catalog, a business without products or a query WhatsApp does not answer
yield `[]` without storing anything, and the next call asks again; a contact without a known phone
also yields `[]`.

- The first read downloads the collections and the full catalog in parallel, each request cut off
  at 20 seconds, and stores them in the engine.
- Later reads come from the engine. When a stored download is older than 24 hours, the stored
  catalogs are returned and refreshed in the background; each catalog that changed emits
  [`catalog:updated`](events.md#catalogs).

```typescript title="catalog.ts"
for (const catalog of await person.catalog()) {
    for (const item of await catalog.products(0, 10)) {
        console.log(catalog.name, item.name, item.price, item.currency);
    }
}
```

### `chat()`

```typescript
chat(): Promise<Chat>
```

Resolves the contact's 1:1 `Chat`: the document persisted in the engine, or a minimal instance
built on the spot when the conversation does not exist yet. Blocking, muting, pinning, archiving
and marking as read are done on it.

```typescript title="contact-chat.ts"
const chat = await person.chat();
await chat.blocked(true);
await wa.Message.text(chat.id, 'Ready to go!');
```

!!! tip "Groups are not contacts"
    `Contact.get` filters out `@g.us` identifiers. To reach a group, call `wa.Chat.get(group_id)`
    and use `chat.members()` to hydrate its participants as contacts.

### `sub(handler)`

```typescript
sub(handler: (event: { name: 'created' | 'updated' | 'deleted' | 'online' | 'offline' | 'typing' | 'recording'; payload: Contact }) => void): () => void
```

Subscribes to everything that happens to the contact, already filtered down to this person:
`created`, `updated` and `deleted` follow the `contact:*` events, and `online`, `offline`, `typing`
and `recording` follow its presence. When the contact stops typing or recording, WhatsApp reports
it as `online`. With `offline` comes its last seen, in [`seen`](#properties). The presence
subscription is requested from WhatsApp in the background; it returns the function that
unsubscribes.

```typescript title="sub.ts"
const stop = person.sub(({ name, payload }) => console.log(payload.name, name, payload.seen ?? ''));
setTimeout(stop, 60_000);
```

!!! info "Presence needs the account online"
    WhatsApp only sends presence to an account that announced itself with
    `(await wa.me())?.online(true)`, and it stops sending it when the socket reconnects. Every
    `sub()` stays in a per-contact pool and the library requests presence again on every
    `connected`; the same handler on the same contact is not registered twice and returns the same
    unsubscribe function.

### `metadata()`

```typescript
metadata(): Promise<Record<string, unknown>>
metadata(key: string): Promise<unknown>
metadata(key: string, value: unknown): Promise<Record<string, unknown>>
metadata(patch: Record<string, unknown>): Promise<Record<string, unknown>>
```

Values of your integration attached to the contact. Without arguments it returns all of them; with a
key, its value or `null`; with a key and a value, or with an object, it merges them and returns the
result, and a `null` value deletes the key. They live in the engine under `/contact/<id>/metadata`
and WhatsApp never sees them, so they are lost when switching engines or re-syncing; when nothing is
left, the document is deleted.

```typescript title="metadata.ts"
await person.metadata('age', 18);            // { age: 18 }
await person.metadata({ city: 'Lima' });     // { age: 18, city: 'Lima' }
await person.metadata('age');                // 18
await person.metadata('year');               // null
await person.metadata('age', null);          // { city: 'Lima' }
```

---

## Statics (via `wa.Contact`)

| Static            | Signature                                                 | Notes                                                                                       |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `wa.Contact.get`  | `(uid: string \| number) => Promise<Contact \| null>`     | Engine first; if not persisted, discovers it over the network and materializes the document. |
| `wa.Contact.list` | `(offset?: number, limit?: number) => Promise<Contact[]>` | Paginated persisted contacts, most recent first. Defaults: `0, 50`.                          |

### Discovery in `get`

When the engine has no `/contact/<jid>` document and the socket is up, `get` probes the network:

1. `onWhatsApp(phone)` — verifies the account exists and returns its canonical JID (plus LID).
2. It does not store the card: it is born with its chat —when you write to it— or with its first
   message. When a LID was returned, it writes the index entries `/lid/<lid>` and `/lid/<jid>`.

It returns `null` only when the identifier cannot be resolved or the number is not on WhatsApp; when
the query fails over the network it rejects with that error, so «does not exist» and «no network»
are not confused. A new public name arrives with the contact's next message and emits
`contact:updated`.

```typescript title="statics.ts"
// Iterate every persisted contact
let offset = 0;

while (true) {
    const batch = await wa.Contact.list(offset, 100);
    if (batch.length === 0) {
        break;
    }
    for (const person of batch) {
        console.log(person.phone, person.name);
    }
    offset += batch.length;
}
```

---

## The own profile

`await wa.me()` returns the account itself as a `Contact` (`me` is `true`). On it,
[`rename(name)`](#rename-name) changes the public name instead of the address book one;
`content(value)`, `photo(value)` and `online(value)` only work on it and reject with
`UNAUTHORIZED` on any other contact:

| Method          | What it does                                                                 |
| --------------- | ---------------------------------------------------------------------------- |
| `online()`      | On any contact, the last presence that arrived —`'online'`, `'offline'`, `'typing'` or `'recording'`—, stored in its card; `null` when none ever did. It arrives for contacts subscribed with `sub()`. |
| `online(value)` | Announces the account online or offline; the socket starts offline.          |

```typescript title="profile.ts"
const me = await wa.me();
await me?.rename('Sales');
await me?.online(true);
```

Statuses are published with [`wa.Feed.create()`](feed.md#publishing).

---

## Persistence paths

Contact-related records live under the following keys in the configured engine:

| Path                             | Value                                                                                                                                                                    | Written by                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `/contact/<id>`                  | The baileys `Contact` (`id`, `lid`, `phoneNumber`, `name`, `notify`, `verifiedName`, `imgUrl`, `status`), merged field by field, under the phone JID when it is known and the LID otherwise. | `contacts.upsert` / `contacts.update`, inbound messages, `Contact.get`. |
| `/contact/<id>/metadata`         | The contact's integration metadata.                                                                                                                                      | `contact.metadata(patch)`.                                              |
| `/contact/<id>/photo`            | `{ url }` of the last downloaded picture, and its binary under `/contact/<id>/photo/content`.                                                                            | `contact.photo()`.                                                      |
| `/contact/<id>/bio`              | `{ status, at }`: the last bio read from WhatsApp and the time of the query.                                                                                             | `contact.content()`.                                                    |
| `/lid/<lid>`                     | Serialized JID string — forward index for LID resolution.                                                                                                                | `Contact.get`, contact upserts and updates, `lid-mapping.update`.       |
| `/lid/<pn>`                      | Serialized LID string — reverse index.                                                                                                                                   | The same writers as `/lid/<lid>`.                                       |
| `/blocklist`                     | The list of identifiers the account has blocked; `blocked()` reads it.                                                                                                   | Every connection, `blocklist.update`.                                   |
| `/chat/<id>`                     | Chat document; `chat()` hydrates from here.                                                                                                                              | `chats.*` events, inbound messages.                                     |
| `/catalog/<jid>/collection/<id>` | Timeline of each catalog collection: every distinct download as baileys returned it, with `updated_at` in its metadata; `catalog()` hydrates from here.                  | `contact.catalog()`.                                                      |

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
