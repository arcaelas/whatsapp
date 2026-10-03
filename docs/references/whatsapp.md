# WhatsApp

The `WhatsApp` class is the orchestrator of the client. It owns the storage engine, exposes the
`Contact`, `Chat`, `Message`, `Feed`, `Catalog` and `Product` entities bound to the session, returns
the own contact with `me()`, and emits the full event map.
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
| `sync`      | `boolean`                                                  | `false` | Downloads the **message history** on link. Contacts, credentials, LID mappings and tctokens always sync regardless of this flag. |
| `device`    | `string`                                                   | `'Chrome'` | Name this session shows under the phone's *Linked devices*. With several sessions on one account it is the only thing telling them apart. Avoid `'Desktop'` together with `sync: true`: baileys 7.0.0-rc14 then advertises the retired `WIN32` platform and WhatsApp closes the handshake with 428 before the QR. |
| `debug`     | `'silent' \| 'fatal' \| 'error' \| 'warn' \| 'info' \| 'debug' \| 'trace'` | `'silent'` | Level of baileys' internal log. `Farewell` gives the close code; the exchange that led to it only shows up at `debug` or `trace`. |

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
    order to *send*; they are always processed. `sync: true` adds the FULL history download, and
    with it every media of that history: on a large account that is minutes of download before the
    first `connected`, so it stays off unless you ask for it.

---

## Surface

```typescript
wa.engine                            // the storage engine you passed in
wa.Contact / wa.Chat / wa.Message    // entities, published on connect
wa.Feed / wa.Catalog / wa.Product    // statuses, catalogs and products, published on connect
await wa.me()                        // the own Contact, or null while pairing

await wa.connect(callback)           // callback receives the PIN (string) or the QR (PNG Buffer)
await wa.disconnect({ silent?, destroy? })   // unlinks the device from the phone

wa.on(event, handler)                // returns the unsubscribe function
wa.once(event, handler)              // returns the unsubscribe function
wa.off(event, handler)               // returns `this`
wa.emit(event, ...args)              // returns true when listeners were present
```

!!! danger "There is no private state to reach for"
    The baileys socket, the credentials and the retry state live in the closure of `connect`,
    not on the instance. `wa._socket` and friends **do not exist**: everything goes through the
    methods above. The entities are published on the first `connect`, once the socket exists —
    before it they are undefined— and keep their identity across reconnections.

---

## Lifecycle

### `connect(callback)`

```typescript
connect(callback: (auth: string | Buffer) => void | Promise<void>): Promise<void>
```

Opens the connection. The callback is invoked every time there is a new authentication artifact
until the device is linked:

- `phone` set and `method` left at `'otp'` → callback receives the **PIN string**. Every three QR
  refreshes (about 100 seconds) the request is renewed, reusing the same code.
- `phone` set with `method: 'qr'`, or no `phone` at all → callback receives a **PNG `Buffer`**
  with the QR code, which refreshes roughly every 20 seconds.

While the device is not linked, a QR series that runs out opens another one right away, and the PIN
keeps the same code, even across a restart of the process.

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

Closes the session **for real**: it unlinks the device from the phone (`logout`), ends the socket,
cancels any pending reconnect and drops `/session` from the engine. The promise settles once the
phone acknowledged the unlink. It is a deliberate, final operation: the next `connect()` pairs
again.

| Option    | Type      | Default | Description                                                                          |
| --------- | --------- | ------- | ------------------------------------------------------------------------------------ |
| `silent`  | `boolean` | `false` | Suppresses the `disconnected` event **for this close only**.                         |
| `destroy` | `boolean` | `false` | Calls `engine.clear()` instead of `unset('/session')` — chats, messages and contacts go too. |

Neither flag decides whether the session dies; they only modulate side effects. Credentials are
removed in both cases: the device no longer exists on the phone, so reconnecting with them would
only return a `loggedOut`.

!!! danger "Do not call it to shut a process down"
    A restart or a deploy should just exit the process: the socket dies with it and the credentials
    survive for the next `connect()`. Calling `disconnect()` there unlinks the line on every
    restart and burns one of the four linked-device slots each time you pair again.

    ```typescript title="Graceful shutdown"
    process.on('SIGTERM', () => process.exit(0));   // no disconnect(): the session survives
    ```

```typescript title="Unlink and keep the history for later study"
await wa.disconnect();
```

```typescript title="Unlink silently and wipe everything"
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
    console.log(`[${chat.id}] ${msg.caption()}`);
});

off(); // detach later
```

!!! tip "`emit` is public on purpose"
    The library entities use it to propagate the changes they cause (`Feed.seen(true)` emits
    `feed:updated`, `Poll.select()` emits `message:updated`). You can emit your own payloads to
    exercise handlers in tests without a live socket.

---

## The own contact

```typescript
me(): Promise<Contact | null>
```

Returns the account itself as a [`Contact`](contact.md) —`me` is `true`— with the session's public
name, or `null` while there is no user yet (during pairing). The profile is changed on it: `rename()`,
`content(value)`, `photo(value)` and `online()` only work on the own contact and reject with
`ERR_NOT_ALLOWED` on any other.

```typescript title="me.ts"
const me = await wa.me();

await me?.rename('Sales');                  // public name
await me?.photo(buffer);                    // changes the picture; null removes it
await me?.content('Open 9-18h');            // writes the bio
await me?.online(true);                     // presence: the socket starts offline
await wa.Feed.create({ caption: 'We are live!' });   // statuses are published with Feed
```

---

## Entities

The instance carries the entities bound to the current session, published on connect. Each class
is built by its factory (`contact`, `chat`, `message`, `feed`, `catalog`, `product`) on the first
connection; the package exports those factories, and the names `Contact`, `Chat`, `Message`, `Feed`,
`Catalog` and `Product` only as types.

| Property     | What it is                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `wa.Contact` | `Contact` class bound to the session: `new wa.Contact(raw)`, `wa.Contact.get`, `wa.Contact.list`. See [Contact](contact.md). |
| `wa.Chat`    | `Chat` class bound to the session: `new wa.Chat(raw)`, `wa.Chat.get`, `wa.Chat.list`, `wa.Chat.create`, `wa.Chat.join`. See [Chat](chat.md). |
| `wa.Message` | `Message` class bound to the session: `new wa.Message(timeline)` returns the subclass of its type; reads, sends, by-id actions and the subclasses. |
| `wa.Feed`    | `Feed` class bound to the session: `new wa.Feed(timeline)`, `wa.Feed.get`, `wa.Feed.list`, `wa.Feed.create`. See [Feed](feed.md). |
| `wa.Catalog` | `Catalog` class bound to the session, one instance per collection of a business: `new wa.Catalog(timeline, jid, updated_at)`, `wa.Catalog.product(uid, pid)`. The catalogs are read with `contact.catalog()`. See [Catalog](catalog.md). |
| `wa.Product` | Catalog `Product` class bound to the session: `new wa.Product(timeline, jid)`. `instanceof wa.Product` also recognizes the product cards that arrive in chats. |
| `wa.engine`  | Direct access to the storage engine.                                                                 |
| `wa.me()`    | The own `Contact`, or `null` while pairing.                                                         |

```typescript title="Using the entities"
const chats  = await wa.Chat.list(0, 20);
const person = await wa.Contact.get('5491112345678');
await wa.Message.text('5491112345678', 'Hello');

console.log((await wa.me())?.name);
```

### The `wa.Message` class

The bound class carries every read, send and by-id action with the session already applied:

| Group  | Members                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------ |
| Read   | `get(cid, mid)`, `list(cid, offset?, limit?)`, `reactions(cid, mid)`                             |
| Send   | `text`, `image`, `video`, `audio`, `sticker`, `location`, `poll`, `document`, `vcard`, `event`   |
| Act    | `react(cid, mid, emoji)`, `star(cid, mid, value)`, `seen(cid, mid)`, `edit(cid, mid, caption)`, `forward(cid, mid, target)`, `delete(cid, mid, all?)`, `pin(cid, mid, value, days?)` |
| Classes | `Text`, `Image`, `Video`, `Audio`, `Sticker`, `Document`, `Location`, `Poll`, `VCard`, `Event`, `Product` |

Those classes exist only there: the package exports `Text`, `Poll` and the rest as types, so
`instanceof` goes through the bound class, as in `msg instanceof wa.Message.Poll`.

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

!!! info "`disconnected` says why"
    The event carries a second argument, `Farewell`: `code` (baileys status code or `null`),
    `reason` (`loggedOut`, `connectionReplaced`, `badSession`, … or `unknown`), `expired` (`true`
    when the phone unlinked the session: no retry, credentials are dead) and `detail` (the
    underlying error message). `wa.on('error', …)` reports failures that do not drop the
    connection, such as `ERR_OTP_EXPIRED` when the pairing code budget runs out.

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
wa.on('disconnected', (_, farewell) => console.log('offline:', farewell.reason, farewell.code));

wa.on('message:created', async (msg, chat) => {
    if (!msg.me && msg.caption() === '/ping') {
        await msg.text(`pong from ${chat.name()}`);
    }
});

await wa.connect((pin) => console.log('PIN:', pin));
```
