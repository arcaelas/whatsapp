# Getting Started

This tutorial walks you through a complete `@arcaelas/whatsapp` session: bootstrapping a project, picking a storage engine, listening to events, pairing the device, replying to a message, and shutting down gracefully.

---

## 1. Bootstrap the project

Create a fresh directory and add the package:

```bash
mkdir whatsapp-bot && cd whatsapp-bot
yarn init -y
yarn add @arcaelas/whatsapp
yarn add -D tsx typescript @types/node
```

Create an `index.ts` file at the project root — that is where the rest of this guide will live.

---

## 2. Pick an engine

The `Engine` is the persistence layer for credentials, chats, contacts and messages. The library ships four implementations:

=== "SQLiteEngine (recommended)"

    ```typescript title="index.ts"
    import { DatabaseSync } from "node:sqlite";   // Node 22+
    import { SQLiteEngine } from "@arcaelas/whatsapp";

    // Node 20-21: import Database from 'better-sqlite3' and use new Database(file)
    const engine = new SQLiteEngine(new DatabaseSync(".sessions/bot.db"));
    ```

    One file, indexed pagination and raw binary storage. Needs Node 22+ for `node:sqlite`, or
    `better-sqlite3` on older runtimes.

=== "FileSystemEngine (local dev)"

    ```typescript title="index.ts"
    import { FileSystemEngine } from "@arcaelas/whatsapp";

    const engine = new FileSystemEngine(__dirname + "/.session");
    ```

    Stores everything as readable JSON files under the directory you provide. Ideal while you are
    poking around and want to inspect what the library writes.

=== "RedisEngine (distributed)"

    ```typescript title="index.ts"
    import Redis from "ioredis";
    import { RedisEngine } from "@arcaelas/whatsapp";

    const redis = new Redis(process.env.REDIS_URL!);
    const engine = new RedisEngine(redis, "bot:main");
    ```

    Backs the session with Redis and namespaces keys with the prefix you pass. Lets you scale
    horizontally and survive container restarts.

=== "S3Engine (serverless)"

    ```typescript title="index.ts"
    import { S3Client } from "@aws-sdk/client-s3";
    import { S3Engine } from "@arcaelas/whatsapp";

    const engine = new S3Engine({
        s3: new S3Client({ region: "us-east-1" }),
        bucket: "sessions",
        basedir: "wa/bot",
    });
    ```

    For stateless deployments where neither disk nor Redis is available.

!!! tip
    You can also implement the `Engine` interface yourself to target PostgreSQL, DynamoDB or anything else. See [Engines](references/engines.md).

---

## 3. Instantiate the client

`new WhatsApp(...)` does not open a connection — it only wires the entities and the event emitter.

```typescript title="index.ts" hl_lines="4 5 6 7"
import { DatabaseSync } from "node:sqlite";
import { WhatsApp, SQLiteEngine } from "@arcaelas/whatsapp";

const engine = new SQLiteEngine(new DatabaseSync(".sessions/bot.db"));
const wa = new WhatsApp({
    engine,
    phone: 5491112345678, // omit to fall back to QR pairing
});
```

The `phone` field decides the pairing flow: provide it to receive a PIN, or omit it to receive a QR
PNG buffer. With `phone` set you can still force the QR with `method: 'qr'`.

---

## 4. Register listeners before connecting

Always attach listeners **before** calling `connect()` so you never miss the first events. Every listener receives the primary payload first and the `WhatsApp` instance last; message and contact events also receive the related `Chat` in the middle.

```typescript title="index.ts"
wa.on("connected", () => {
    console.log("session ready");
});

wa.on("disconnected", () => {
    console.log("session closed");
});

wa.on("message:created", async (msg, chat) => {
    if (!msg.me) {
        console.log(`[${chat.name}] ${msg.caption}`);
    }
});
```

The full event map (`chat:*`, `contact:*`, `message:*`, `feed:*`) is documented in [Events](references/events.md).

---

## 5. Connect and handle the pairing payload

`connect(callback)` resolves once the session syncs. The callback fires whenever baileys hands you a fresh pairing artifact: a `string` (PIN) when `phone` is set, or a `Buffer` (PNG QR) otherwise. It may fire more than once if the previous code expires before the user completes pairing.

```typescript title="index.ts"
import { writeFileSync } from "node:fs";

await wa.connect(async (code) => {
    if (typeof code === "string") {
        console.log("Pair code:", code);
    } else {
        writeFileSync("qr.png", code);
        console.log("QR written to qr.png — scan it with WhatsApp");
    }
});
```

!!! success
    When `connect()` resolves, the engine has the credentials persisted. Subsequent runs reuse them automatically — no second pairing required.

---

## 6. Reply to incoming messages

Replying is a method on the message itself — it quotes the original automatically. To send without
quoting, use the `wa.Message` delegate with the chat id.

```typescript title="index.ts" hl_lines="3 6"
wa.on("message:created", async (msg, chat) => {
    if (!msg.me && msg.caption.toLowerCase() === "ping") {
        await msg.text("pong");                       // quoted reply
    }
    if (!msg.me && msg.caption.toLowerCase() === "hello") {
        await wa.Message.text(chat.id, "hi there");   // standalone message
    }
});
```

`wa.Message` covers the ten sendable types: `text`, `image`, `video`, `audio`, `sticker`,
`document`, `location`, `poll`, `vcard` and `event`. See [Messages](references/message.md).

---

## 7. Graceful shutdown

Just exit the process: the socket dies with it and the credentials stay in the engine, so the next
run reconnects without pairing again.

```typescript title="index.ts"
process.on("SIGINT", () => process.exit(0));
```

!!! danger "`disconnect()` is not a shutdown"
    `wa.disconnect()` unlinks the device from the phone and drops the credentials — the next
    `connect()` asks for a new PIN or QR. Reserve it for when you really want to close the session,
    and pass `{ destroy: true }` to wipe the engine along with it.

---

## 8. Run it

```bash
npx tsx index.ts
```

The first run prints the PIN (or writes `qr.png`); pair the device, wait for the `connected` log, then send a message to your number to see the listener fire.

---

## Going further

A few client options worth knowing about:

- **`method`** *(default `'otp'`)* — only meaningful together with `phone`: switch it to `'qr'` to get the QR even when a number is configured.
- **`autoclean`** *(default `true`)* — on a remote `loggedOut`, clears the entire engine so the next `connect()` starts from a clean slate. Set to `false` to preserve chat/message history and only drop credentials.
- **`reconnect`** *(default `true`)* — accepts a boolean, a number of max attempts, or `{ max, interval }` (interval in seconds, default 60). Transient closes triggered by the protocol do not consume retry budget.
- **`sync`** *(default `false`)* — set it to `true` to download the full message history on link, media included; contacts, credentials and LID mappings are synced either way.
- **`device`** *(default `'Chrome'`)* — the name this session shows under *Linked devices*; name each session when an account holds several.
- **`debug`** *(default `'silent'`)* — the level of baileys' internal log, up to `'trace'`, for when a remote close needs diagnosing.

The complete option list, event map and entity APIs live in [References](references/whatsapp.md). For end-to-end recipes browse the [Basic Bot](examples/basic-bot.md) example or the [Decorator Bot](examples/decorator-bot.md) showcase.
