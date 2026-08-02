# WhatsApp

The `WhatsApp` class is the orchestrator of the client. It owns the storage engine, exposes the
`Contact`, `Chat` and `Message` entities bound to the session, and emits the full event map.
Instantiating the class does **not** open a connection; you must call `connect(callback)`
explicitly.

---

## Import

```typescript title="ESM / TypeScript"
import { WhatsApp, FileSystemEngine, RedisEngine } from '@arcaelas/whatsapp';

// The default export is the same class, so this is equivalent:
// import WhatsApp from '@arcaelas/whatsapp';
```

---

## Constructor

```typescript
new WhatsApp(options: IWhatsApp)
```

The `engine` option is **required**. Every other field is optional.

| Option      | Type                                                       | Default | Description                                                                                                                     |
| ----------- | ---------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `engine`    | `Engine`                                                   | —       | Storage engine implementing the `Engine` contract. See [Engines](engines.md).                                                   |
| `phone`     | `number \| string`                                         | —       | Account phone number. Its presence enables PIN pairing; **without it linking is always by QR**.                                  |
| `method`    | `'qr' \| 'otp'`                                            | `'otp'` | Picks the linking channel **only when `phone` is set**. Without `phone` it is ignored, since a PIN cannot be requested without a number. |
| `autoclean` | `boolean`                                                  | `true`  | On a remote `loggedOut`, clears the entire engine. With `false` only `/session/creds` is removed (history is kept).             |
| `reconnect` | `boolean \| number \| { max?: number; interval?: number }` | `true`  | Auto-reconnect policy for non-`loggedOut` closes. `interval` is in seconds. `true` retries forever every 60s.                    |
| `sync`      | `boolean`                                                  | `true`  | Downloads the **message history** on link. Contacts, credentials, LID mappings and tctokens always sync regardless of this flag. |

!!! info "Reconnect shortcuts"
    - `true` — retry forever every 60 seconds.
    - `false` — never reconnect.
    - `5` — retry up to 5 times, 60 seconds apart.
    - `{ max: 3, interval: 10 }` — retry 3 times, 10 seconds apart.

!!! tip "The option types are exported"
    `IWhatsApp` (the constructor options), `ReconnectOption` and `DisconnectOptions` are exported
    from the package, so you can annotate your own factories and wrappers:

    ```typescript
    import type { IWhatsApp, ReconnectOption, DisconnectOptions } from '@arcaelas/whatsapp';

    function build(engine: IWhatsApp['engine'], reconnect: ReconnectOption): IWhatsApp {
        return { engine, reconnect };
    }

    const shutdown: DisconnectOptions = { silent: true, destroy: false };
    ```

!!! warning "`sync` only gates the message history"
    Non-FULL syncs carry the LID mappings and the trusted-contact tokens that baileys requires in
    order to *send*; they are always processed. `sync: false` skips the FULL history download only.

---

## Surface

```typescript
wa.engine                            // the storage engine you passed in
wa.Contact / wa.Chat / wa.Message    // entities, published on connect
await wa.account()                   // Account of the authenticated user, or null while pairing

await wa.connect(callback)           // callback receives the PIN (string) or the QR (PNG Buffer)
await wa.disconnect({ silent?, destroy? })

wa.on(event, handler)                // returns the unsubscribe function
wa.once(event, handler)              // returns the unsubscribe function
wa.off(event, handler)               // returns `this`
wa.emit(event, ...args)              // returns true when listeners were present
```

!!! danger "There is no private state to reach for"
    The baileys socket, the credentials and the retry state live in the closure of `connect`,
    not on the instance. `wa._socket` and friends **do not exist**: everything goes through the
    methods above. The entities and `account()` are published inside `connect`, once the socket
    exists — before the first connection they are undefined.

---

## Lifecycle

### `connect(callback)`

```typescript
connect(callback: (auth: string | Buffer) => void | Promise<void>): Promise<void>
```

Opens the connection. The callback is invoked every time baileys produces a new authentication
artifact (it refreshes roughly every 20 seconds until the device is linked):

- `phone` set and `method` left at `'otp'` → callback receives the **PIN string**.
- `phone` set with `method: 'qr'`, or no `phone` at all → callback receives a **PNG `Buffer`**
  with the QR code.

The promise resolves when the session syncs and `connection === 'open'`. It rejects with
`Error('Logged out')` on `loggedOut`, or with `Error('Reconnect attempts exhausted (N)')` when the
retry budget runs out.

```typescript title="Connect with QR (FileSystemEngine)" hl_lines="6 7 8"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';
import { writeFileSync } from 'node:fs';

const wa = new WhatsApp({ engine: new FileSystemEngine('./data/wa') });

await wa.connect((auth) => {
    writeFileSync('./qr.png', auth as Buffer);
});
```

```typescript title="Connect with PIN (SQLiteEngine)" hl_lines="8 9 10 11"
import { DatabaseSync } from 'node:sqlite';
import { WhatsApp, SQLiteEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new SQLiteEngine(new DatabaseSync('./data/5491112345678.db')),
    phone: 5491112345678,
});

await wa.connect((auth) => {
    console.log('Pair this code on your phone:', auth);
});
```

### `disconnect(options?)`

```typescript
disconnect(options?: { silent?: boolean; destroy?: boolean }): Promise<void>
```

Closes the socket cleanly and cancels any pending reconnect timer.

| Option    | Type      | Default | Description                                                              |
| --------- | --------- | ------- | ------------------------------------------------------------------------ |
| `silent`  | `boolean` | `false` | Suppresses the `disconnected` event **for this close only**.             |
| `destroy` | `boolean` | `false` | Calls `engine.clear()` after closing — wipes the entire store.           |

Internally the socket is ended with a Boom-like error carrying
`output.statusCode = 428` (`connectionClosed`), so the close handler sees an explicit signal
rather than `undefined`.

```typescript title="Graceful shutdown"
process.on('SIGTERM', async () => {
    await wa.disconnect();
});
```

```typescript title="Silent close + wipe"
await wa.disconnect({ silent: true, destroy: true });
```

---

## Events

`WhatsApp` exposes a typed event API. Listeners registered with `on` and `once` return an
**unsubscribe function** for ergonomic cleanup. See [Events](events.md) for the complete map.

| Method             | Returns        | Description                                                                |
| ------------------ | -------------- | -------------------------------------------------------------------------- |
| `on(e, h)`         | `() => void`   | Registers a listener; the returned function detaches it.                   |
| `once(e, h)`       | `() => void`   | Registers a one-shot listener; the returned function detaches it early.    |
| `off(e, h)`        | `this`         | Removes a previously registered listener.                                  |
| `emit(e, ...args)` | `boolean`      | Emits a client event; `true` when listeners were present.                  |

```typescript title="Subscribe and unsubscribe" hl_lines="5"
const off = wa.on('message:created', (msg, chat) => {
    console.log(`[${chat.id}] ${msg.caption}`);
});

off(); // detach later
```

!!! tip "`emit` is public on purpose"
    The library entities use it to propagate the changes they cause (`Feed.view()` emits
    `feed:updated`, `Poll.select()` emits `message:updated`). You can emit your own payloads to
    exercise handlers in tests without a live socket.

---

## The account

```typescript
account(): Promise<Account | null>
```

Returns the authenticated account as an [`Account`](contact.md#account) — a `Contact` subclass
bound to the session — or `null` while there is no user yet (during pairing). The card arrives
with the profile picture already resolved.

```typescript title="account.ts"
const account = await wa.account();

await account.rename('Sales');              // public name
await account.picture(buffer);              // Buffer or https URL; null removes it
await account.content();                    // reads the bio
await account.content('Open 9-18h');        // updates it
await account.online(true);                 // presence: the socket starts offline

const post = await account.post({
    caption: 'We are live!',
    audience: [contact, 5491112345678, '584121234567@s.whatsapp.net'],
});
```

`post` publishes a status broadcast and returns the created [`Feed`](feed.md); the audience is
mandatory and accepts `Contact` instances, JIDs, LIDs or phone numbers.

| Error                     | Thrown when                                       |
| ------------------------- | ------------------------------------------------- |
| `ERR_FEED_EMPTY`          | Neither `buffer` nor `caption` was given.         |
| `ERR_FEED_MEDIA`          | `buffer` is neither a JPEG/PNG/WebP nor an MP4.   |
| `ERR_PROFILE_PICTURE_LIB` | `picture()` without `sharp` nor `jimp` installed. |

---

## Entities

The instance carries the three entities bound to the current session, published on connect:

| Property     | What it is                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `wa.Contact` | `Contact` subclass bound to the session: `new wa.Contact(raw)`, `wa.Contact.get`, `wa.Contact.list`. |
| `wa.Chat`    | `Chat` subclass bound to the session: `new wa.Chat(raw)`, `wa.Chat.get`, `wa.Chat.list`.             |
| `wa.Message` | `Message` subclass bound to the session: reads, sends, by-id actions and the subclasses.             |
| `wa.engine`  | Direct access to the storage engine.                                                                 |
| `wa.account()` | The authenticated user as an [`Account`](contact.md#account), or `null` while pairing.             |

```typescript title="Using the entities"
const chats  = await wa.Chat.list(0, 20);
const person = await wa.Contact.get('5491112345678');
await wa.Message.text('5491112345678', 'Hello');

console.log((await wa.account())?.name);
```

### The `wa.Message` class

The bound class carries every read, send and by-id action with the session already applied:

| Group  | Members                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------ |
| Read   | `get(cid, mid)`, `list(cid, offset?, limit?)`, `reactions(cid, mid)`                             |
| Send   | `text`, `image`, `video`, `audio`, `location`, `poll`, `document`, `vcard`, `event`              |
| Act    | `react(cid, mid, emoji)`, `star(cid, mid, value)`, `seen(cid, mid)`, `edit(cid, mid, caption)`, `forward(cid, mid, target)`, `delete(cid, mid, all?)` |
| Classes | `Text`, `Image`, `Video`, `Audio`, `Sticker`, `Document`, `Location`, `Poll`, `VCard`, `Event`   |

The classes exposed there are the very same ones exported by the package, so
`msg instanceof wa.Message.Poll` and `msg instanceof Poll` are equivalent.

---

## Lifecycle semantics

!!! tip "Transient closes (`restartRequired`, code `515`)"
    The protocol-mandated reset that follows the initial sync is treated as transient. It does
    **not** emit `disconnected` and does **not** consume retry budget; reconnect happens with
    zero delay.

!!! warning "`loggedOut` (code `401`)"
    On `loggedOut`, the engine cleanup completes **before** the `disconnected` event fires:

    - `autoclean: true` (default) → `engine.clear()` runs first.
    - `autoclean: false`          → only `/session/creds` is removed; history is preserved.

    The promise returned by `connect()` rejects with `Error('Logged out')`.

!!! info "Manual disconnect (`statusCode = 428`)"
    `disconnect()` ends the socket with a Boom-like error carrying
    `output.statusCode = 428`. This makes manual closes distinguishable from network-level
    errors when you inspect `lastDisconnect.error` in custom tooling.

---

## Full example

```typescript title="server.ts"
import IORedis from 'ioredis';
import { WhatsApp, RedisEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new RedisEngine(new IORedis(), 'wa:5491112345678'),
    phone: 5491112345678,
    reconnect: { max: 5, interval: 30 },
    autoclean: true,
});

wa.on('connected',    () => console.log('online'));
wa.on('disconnected', () => console.log('offline'));

wa.on('message:created', async (msg, chat) => {
    if (!msg.me && msg.caption === '/ping') {
        await msg.text(`pong from ${chat.name}`);
    }
});

await wa.connect((pin) => console.log('PIN:', pin));
```
