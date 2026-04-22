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

The `Engine` is the persistence layer for credentials, chats, contacts, and messages. The library ships two implementations:

=== "FileSystemEngine (local dev)"

    ```typescript title="index.ts"
    import { FileSystemEngine } from "@arcaelas/whatsapp";

    const engine = new FileSystemEngine(__dirname + "/.session");
    ```

    Stores everything as files under the directory you provide. Ideal for development and single-process deployments.

=== "RedisEngine (production)"

    ```typescript title="index.ts"
    import { RedisEngine } from "@arcaelas/whatsapp";
    import Redis from "ioredis";

    const engine = new RedisEngine(new Redis(process.env.REDIS_URL!), "bot:main");
    ```

    Backs the session by Redis and namespaces keys with the prefix you pass. Lets you scale horizontally and survive container restarts.

!!! tip
    You can also implement the `Engine` interface yourself to target SQLite, S3, DynamoDB, or anything else. See [Engines](references/engines.md).

---

## 3. Instantiate the client

`new WhatsApp(...)` does not open a connection — it only wires the delegates and the event emitter.

```typescript title="index.ts" hl_lines="4 5 6 7"
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";

const engine = new FileSystemEngine(__dirname + "/.session");
const wa = new WhatsApp({
    engine,
    phone: 584144709840, // omit to fall back to QR pairing
});
```

The `phone` field decides the pairing flow: provide it to receive an 8-character PIN, or omit it to receive a QR PNG buffer.

---

## 4. Register listeners before connecting

Always attach listeners **before** calling `connect()` so you never miss the first events. Every listener receives the primary payload first and the `WhatsApp` instance last; message and chat events also receive the related `Chat` in the middle.

```typescript title="index.ts"
wa.on("connected", () => {
    console.log("session ready");
});

wa.on("disconnected", () => {
    console.log("session closed");
});

wa.on("message:created", async (msg, chat, wa) => {
    if (msg.me) return;
    console.log(`[${chat.id}] ${msg.caption}`);
});
```

The full event map (`chat:*`, `contact:*`, `message:updated`, `message:reacted`, `message:seen`, etc.) is documented in [References](references/whatsapp.md).

---

## 5. Connect and handle the pairing payload

`connect(callback)` resolves once the session syncs. The callback fires whenever baileys hands you a fresh pairing artifact: a `string` (PIN) when `phone` is set, or a `Buffer` (PNG QR) otherwise. The callback may fire more than once if the previous code expires before the user completes pairing.

```typescript title="index.ts"
import { writeFileSync } from "node:fs";

await wa.connect(async (code) => {
    if (typeof code === "string") {
        console.log("Pair code:", code);
    } else if (Buffer.isBuffer(code)) {
        writeFileSync("qr.png", code);
        console.log("QR written to qr.png — scan it with WhatsApp");
    }
});
```

!!! success
    When `connect()` resolves, the engine has the credentials persisted. Subsequent runs reuse them automatically — no second pairing required.

---

## 6. Reply to incoming messages

The `wa.Message` delegate exposes `text`, `image`, `video`, `audio`, `location`, and `poll`. Pass the chat id (or any identifier — phone, JID, or LID) and the body:

```typescript title="index.ts" hl_lines="3 4 5"
wa.on("message:created", async (msg, chat, wa) => {
    if (msg.me) return;
    if (msg.caption?.toLowerCase() === "ping") {
        await wa.Message.text(chat.id, "pong");
    }
});
```

Each method also has an instance variant on the message itself (`msg.text("...")`) that quotes the original message in the reply.

---

## 7. Graceful shutdown

Cancel pending reconnects and close the socket cleanly on SIGINT:

```typescript title="index.ts"
process.on("SIGINT", async () => {
    await wa.disconnect();
    process.exit(0);
});
```

Pass `{ destroy: true }` to also wipe the engine on the way out — useful in tests or when rotating accounts.

---

## 8. Run it

```bash
npx tsx index.ts
```

The first run prints the PIN (or writes `qr.png`); pair the device, wait for the `connected` log, then send a message to your number to see the listener fire.

---

## Going further

A few client options worth knowing about:

- **`autoclean`** *(default `true`)* — on a remote `loggedOut`, clears the entire engine so the next `connect()` starts from a clean slate. Set to `false` to preserve chat/message history and only drop credentials.
- **`reconnect`** *(default `true`)* — accepts `boolean`, a number of max attempts, or `{ max, interval }` (interval in seconds, default 60). Transient closes triggered by the protocol do not consume retry budget.
- **`sync`** *(default `false`)* — enables baileys' full history sync; imported chats, contacts, and messages are persisted through the engine.

The complete option list, event map, and delegate APIs live in [References](references/whatsapp.md). For end-to-end recipes (bots, webhooks, decorators, multi-account setups) browse the [Basic Bot](examples/basic-bot.md) example or the [Decorator Bot](examples/decorator-bot.md) showcase.
