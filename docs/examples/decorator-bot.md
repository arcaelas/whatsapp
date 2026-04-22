# Decorator Bot

Full runnable bot built with the Stage 3 decorator API (`@arcaelas/whatsapp/decorators`). Every first-class decorator is exercised in a single file: lifecycle, pairing, commands, filtering, periodic tasks, workflows and a generic inbound logger.

---

## Prerequisites

```bash
yarn add @arcaelas/whatsapp ioredis
```

!!! info "Redis engine"
    The example uses `RedisEngine` so the bot state survives restarts. Swap it for `FileSystemEngine` if you prefer a local file store — the decorator API is engine-agnostic.

---

## Complete code

```typescript title="bot.ts"
import { writeFile } from "node:fs/promises";
import Redis from "ioredis";
import {
  Bot,
  command,
  connect,
  disconnect,
  every,
  from,
  guard,
  on,
  pair,
  pipe,
} from "@arcaelas/whatsapp/decorators";
import { RedisEngine } from "@arcaelas/whatsapp";
import type { Chat, Message, WhatsApp } from "@arcaelas/whatsapp";

const ADMIN_PHONE = "5491111111111";

@Bot({
  engine: new RedisEngine(new Redis()),
  phone: "5491112345678",
})
class DecoratorBot {
  // ---- Pairing (PIN / QR) ---------------------------------------------

  @pair()
  async on_pair(code: string | Buffer) {
    if (Buffer.isBuffer(code)) {
      await writeFile("qr.png", code);
      console.log("[pair] QR saved to qr.png");
    } else {
      console.log("[pair] pairing code:", code);
    }
  }

  // ---- Lifecycle -------------------------------------------------------

  @connect()
  on_open() {
    console.log("[lifecycle] connected");
  }

  @disconnect()
  on_close() {
    console.log("[lifecycle] disconnected");
  }

  // ---- Commands --------------------------------------------------------

  @command("/help")
  async help(msg: Message, chat: Chat, args: string[]) {
    await msg.text(
      [
        "Available commands:",
        "  /help           — show this message",
        "  /echo <text>    — echo the provided text",
        "  /shutdown       — admin-only",
      ].join("\n"),
    );
  }

  @command(/^\/echo\s+(.+)$/)
  async echo(msg: Message, chat: Chat, args: string[]) {
    const [text] = args;
    await msg.text(text);
  }

  // Admin-only command: @from filters by author BEFORE the handler runs.
  @command("/shutdown")
  @from(ADMIN_PHONE)
  async shutdown(msg: Message) {
    await msg.text("shutting down");
    process.exit(0);
  }

  // ---- Periodic task ---------------------------------------------------

  @every(30_000)
  heartbeat() {
    console.log("[heartbeat] alive", new Date().toISOString());
  }

  // ---- Sequential workflow (@pipe) ------------------------------------

  @pipe("talk", 0)
  async talk_step_1(msg: Message, chat: Chat, wa: WhatsApp) {
    (msg as unknown as { received_at: number }).received_at = Date.now();
    console.log("[talk:0] tagged", msg.id);
  }

  @pipe("talk", 1)
  async talk_step_2(msg: Message) {
    const tagged = msg as unknown as { received_at: number };
    console.log("[talk:1] elapsed", Date.now() - tagged.received_at, "ms");
  }

  // ---- Generic inbound logger -----------------------------------------

  @on("message:created")
  @guard((msg: Message) => !msg.me)
  log_inbound(msg: Message) {
    console.log("[inbound]", msg.from, msg.type, msg.id);
  }
}

// ---- Entry point -------------------------------------------------------

const bot = new DecoratorBot();
await bot.connect(); // pairing handled by @pair

process.on("SIGINT", async () => {
  await bot.disconnect();
  process.exit(0);
});
```

---

## Walkthrough

### `@Bot({ engine, phone })`

Converts `DecoratorBot` into a subclass of `WhatsAppBot`. The class does not need to extend anything manually. The decorator seeds the default options (Redis engine + phone for PIN pairing); a runtime override can be passed at construction time, e.g. `new DecoratorBot({ phone: "5499999999999" })`.

### `@pair()`

The bot does **not** pass a callback to `connect()`. Pairing is delegated entirely to the `on_pair` method: if baileys delivers a `Buffer`, it is a QR PNG and is written to disk; if it delivers a string, it is a PIN code to type in the WhatsApp mobile app. Multiple `@pair` methods — if present — would run concurrently.

### `@connect()` / `@disconnect()`

Aliases of `@on('connected')` and `@on('disconnected')`. Useful for wiring side-effects (metrics, graceful shutdown hooks, cache warm-up) to the connection lifecycle.

### `@command('/help')`

String form: `@command` applies `@on('message:created')`, a guard matching `msg.caption.startsWith('/help')` and a transform that rewrites the handler signature to `(msg, chat, args)`, where `args` is the tail split by whitespace.

### `@command(/^\/echo\s+(.+)$/)`

RegExp form: the regex is tested against `msg.caption`. `args` is `match.slice(1)`, so the first capture group is the echoed text. This is the idiomatic way to parse complex command shapes without writing manual `split`/`trim` logic.

### `@command('/shutdown') + @from(ADMIN_PHONE)`

`@from` registers an async guard that normalises the phone to a JID on first use (via the internal resolver) and caches it. The command only runs when the message's author matches the admin. Pass `string[]` for multiple admins or a `(jid) => boolean` predicate for custom matching.

### `@every(30_000)`

Installs a `setInterval` of 30 seconds that starts on `connected` and is cleared on `disconnected`. The callback receives no arguments; access the instance through `this`.

### `@pipe('talk', 0)` and `@pipe('talk', 1)`

Two steps of the same workflow. They run **sequentially** on every `message:created`, ordered by `index`. Step 0 tags the message with `received_at`; step 1 reads that field — because both steps share the same `msg` reference, the mutation is visible downstream. Any number of steps can belong to the same workflow, and workflows are independent of each other.

### `@on('message:created') + @guard(...)`

Generic inbound logger that demonstrates the plain event subscription with an ad-hoc guard. `@guard` is stackable and short-circuits with AND semantics; `msg.me` is `true` for messages authored by the bot, so filtering it out prevents self-logging loops.

---

## Running

```bash
yarn tsx bot.ts
```

The first run prints a PIN (or writes `qr.png`). Pair the phone, observe the `[lifecycle] connected` line, then send:

- `/help` — the command help listing.
- `/echo hello world` — the bot replies `hello world`.
- `/shutdown` — only the admin phone can trigger it.

While running, the `[heartbeat]` log ticks every 30 seconds, and every inbound message flows through the `talk` workflow and the generic logger.

---

## See also

- [References / Decorators](../references/decorators.md) — full decorator reference and stacking rules.
- [References / Events](../references/events.md) — event names and payloads.
- [Examples / Basic bot](basic-bot.md) — the same use case written against the raw `WhatsApp` client (no decorators).
