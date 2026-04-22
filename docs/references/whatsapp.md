# WhatsApp

The `WhatsApp` class is the orchestrator of the v3 client. It owns the storage engine, exposes the
`Chat`, `Contact` and `Message` delegates, and emits the full event map. Instantiating the class
does **not** open a connection; you must call `connect(callback)` explicitly.

---

## Import

```typescript title="ESM / TypeScript"
import { WhatsApp, FileSystemEngine, RedisEngine } from '@arcaelas/whatsapp';
```

---

## Constructor

```typescript
new WhatsApp(options: IWhatsApp)
```

The `engine` option is **required**. Every other field is optional.

| Option      | Type                                                    | Default | Description                                                                                                            |
| ----------- | ------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `engine`    | `Engine`                                                | —       | Storage engine implementing the `Engine` contract. See [Engines](engines.md).                                          |
| `phone`     | `number \| string`                                      | —       | Phone number for PIN pairing. When omitted, the callback receives a QR PNG buffer instead.                             |
| `autoclean` | `boolean`                                               | `true`  | On a remote `loggedOut`, clears the entire engine. With `false` only `/session/creds` is removed (history is kept).    |
| `reconnect` | `boolean \| number \| { max?: number; interval?: number }` | `true`  | Auto-reconnect policy for non-`loggedOut` closes. `interval` is in seconds. `true` retries forever every 60s.          |
| `sync`      | `boolean`                                               | `false` | Enables baileys `syncFullHistory`; imported chats, contacts and messages are persisted via `messaging-history.set`.    |

!!! info "Reconnect shortcuts"
    - `true` — retry forever every 60 seconds.
    - `false` — never reconnect.
    - `5` — retry up to 5 times, 60 seconds apart.
    - `{ max: 3, interval: 10 }` — retry 3 times, 10 seconds apart.

---

## Lifecycle

### `connect(callback?)`

```typescript
connect(callback: (auth: string | Buffer) => void | Promise<void>): Promise<void>
```

Opens the connection. The callback is invoked every time baileys produces a new authentication
artifact:

- If `phone` was provided → callback receives the **PIN string** (e.g. `"ABCD-1234"`).
- Otherwise → callback receives a **PNG `Buffer`** with the QR code.

The promise resolves when the session has fully synced and `connection === 'open'`. It rejects if
the server returns `loggedOut` or if the reconnect budget is exhausted.

```typescript title="Connect with QR (FileSystemEngine)" hl_lines="6 7 8"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';
import { writeFileSync } from 'node:fs';

const wa = new WhatsApp({ engine: new FileSystemEngine('./data/wa') });

await wa.connect((auth) => {
    writeFileSync('./qr.png', auth as Buffer);
});
```

```typescript title="Connect with PIN (RedisEngine)" hl_lines="7 8 9 10"
import IORedis from 'ioredis';
import { WhatsApp, RedisEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new RedisEngine(new IORedis(), 'wa:5491112345678'),
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

Closes the socket cleanly.

| Option    | Type      | Default | Description                                                                                          |
| --------- | --------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `destroy` | `boolean` | `false` | If `true`, `engine.clear()` is called after closing — wipes the entire store.                        |
| `silent`  | `boolean` | `false` | Reserved flag (currently consumed but does not change observable behavior).                          |

Internally, `disconnect()` cancels any pending reconnect timer and ends the socket with a
Boom-like error carrying `statusCode = 428` (`connectionClosed`) so the close handler sees an
explicit signal rather than `undefined`.

```typescript title="Graceful shutdown"
process.on('SIGTERM', async () => {
    await wa.disconnect();
});
```

```typescript title="Logout + wipe"
await wa.disconnect({ destroy: true });
```

---

## Events

`WhatsApp` exposes a typed event API. Listeners registered with `on` and `once` return an
**unsubscribe function** for ergonomic cleanup. See [Events](events.md) for the complete map.

| Method          | Returns          | Description                                                              |
| --------------- | ---------------- | ------------------------------------------------------------------------ |
| `on(e, h)`      | `() => void`     | Registers a listener; the returned function detaches it.                 |
| `once(e, h)`    | `() => void`     | Registers a one-shot listener; returned function detaches it preemptively.|
| `off(e, h)`     | `this`           | Removes a previously registered listener.                                |

```typescript title="Subscribe and unsubscribe" hl_lines="5"
const off = wa.on('message:created', (msg, chat) => {
    console.log(`[${chat.id}] ${msg.caption}`);
});

off(); // detach later
```

---

## Delegates

The instance carries three constructors bound to the current `WhatsApp` and `engine`:

| Delegate     | Type                            | Purpose                                              |
| ------------ | ------------------------------- | ---------------------------------------------------- |
| `wa.Contact` | `ReturnType<typeof contact>`    | `new wa.Contact(raw, chat)` and contact statics.     |
| `wa.Chat`    | `ReturnType<typeof chat>`       | `new wa.Chat(raw)` and chat statics.                 |
| `wa.Message` | `ReturnType<typeof message>`    | `new wa.Message({ wa, doc })` and message statics.   |
| `wa.engine`  | `Engine`                        | Direct access to the storage engine.                 |

```typescript title="Using delegates"
const chats = await wa.Chat.list({ limit: 20 });
const contact = await wa.Contact.get('5491112345678');
await wa.Message.text('5491112345678', 'Hello from v3');
```

---

## Lifecycle semantics

!!! tip "Transient closes (`restartRequired`, code `515`)"
    The protocol-mandated reset that follows the initial sync is treated as transient. It does
    **not** emit `disconnected` and does **not** consume retry budget; reconnect happens with
    zero delay.

!!! warning "`loggedOut` (code `401`)"
    On `loggedOut`, the engine cleanup completes **before** the `disconnected` event fires:

    - `autoclean: true` (default) → `engine.clear()` runs first.
    - `autoclean: false`           → only `/session/creds` is removed; history is preserved.

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
    engine: new RedisEngine(new IORedis(), 'wa:default'),
    phone: 5491112345678,
    reconnect: { max: 5, interval: 30 },
    autoclean: true,
});

wa.on('connected',    () => console.log('online'));
wa.on('disconnected', () => console.log('offline'));

wa.on('message:created', async (msg, chat) => {
    if (msg.caption === '/ping') {
        await chat.text('pong');
    }
});

await wa.connect((pin) => console.log('PIN:', pin));
```
