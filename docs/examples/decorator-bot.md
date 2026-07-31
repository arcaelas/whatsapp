# Decorator Bot

Full runnable bot built with the Stage 3 decorator API (`@arcaelas/whatsapp/decorators`). Every first-class decorator is exercised in a single file: lifecycle, pairing, commands, filtering, periodic tasks, workflows and a generic inbound logger.

---

## Prerequisites

```bash
yarn add @arcaelas/whatsapp
```

!!! info "Engine of your choice"
    The example uses `SQLiteEngine` so the bot state survives restarts in a single file. Swap it for
    `FileSystemEngine`, `RedisEngine` or `S3Engine` — the decorator API is engine-agnostic. Engines
    always come from `@arcaelas/whatsapp`, never from the `/decorators` sub-entry.

---

## Complete code

```typescript title="bot.ts"
import { writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
  WhatsAppBot,
  command,
  connect,
  delay,
  disconnect,
  every,
  from,
  guard,
  on,
  pair,
  pipe,
} from "@arcaelas/whatsapp/decorators";
import { SQLiteEngine } from "@arcaelas/whatsapp";
import type { Chat, Message } from "@arcaelas/whatsapp";

const ADMIN_PHONE = "5491111111111";

class DecoratorBot extends WhatsAppBot {
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

  // ---- Periodic tasks --------------------------------------------------

  @every(30_000)
  heartbeat() {
    console.log("[heartbeat] alive", new Date().toISOString());
  }

  // Never overlaps with itself: the next run waits for this one to finish.
  @delay(60_000)
  async sweep() {
    const chats = await this.Chat.list(0, 50);
    console.log("[sweep] tracking", chats.length, "chats");
  }

  // ---- Sequential workflow (@pipe) ------------------------------------

  @pipe("talk", 0)
  async talk_step_1(msg: Message) {
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
  @guard((msg) => !(msg as Message).me)
  log_inbound(msg: Message) {
    console.log("[inbound]", msg.from, msg.type, msg.id);
  }
}

// ---- Entry point -------------------------------------------------------

const bot = new DecoratorBot({
  engine: new SQLiteEngine(new DatabaseSync(".sessions/bot.db")),
  phone: 5491112345678,
});

await bot.connect(); // pairing handled by @pair

process.on("SIGINT", async () => {
  await bot.disconnect();
  process.exit(0);
});
```

---

## Walkthrough

### `class DecoratorBot extends WhatsAppBot`

`WhatsAppBot` **is** the `WhatsApp` client plus the decorator wiring, so the bot instance carries
`this.Chat`, `this.Message`, `this.on(...)` and every option of the constructor. The wiring runs on
the first `connect()`, and a reconnect does not duplicate the listeners.

### `@pair()`

The bot does **not** pass a callback to `connect()`. Pairing is delegated entirely to the `on_pair`
method: if baileys delivers a `Buffer`, it is a QR PNG and is written to disk; if it delivers a
string, it is a PIN code to type in the WhatsApp mobile app. Multiple `@pair` methods — if present —
run concurrently.

### `@connect()` / `@disconnect()`

Aliases of `@on('connected')` and `@on('disconnected')`. Useful for wiring side-effects (metrics,
graceful shutdown hooks, cache warm-up) to the connection lifecycle.

### `@command('/help')`

String form: `@command` applies `@on('message:created')`, a guard matching
`msg.caption.startsWith('/help')` and a transform that rewrites the handler signature to
`(msg, chat, args)`, where `args` is the tail split by whitespace.

### `@command(/^\/echo\s+(.+)$/)`

RegExp form: the regex is tested against `msg.caption`. `args` is `match.slice(1)`, so the first
capture group is the echoed text. This is the idiomatic way to parse complex command shapes without
writing manual `split`/`trim` logic.

### `@command('/shutdown') + @from(ADMIN_PHONE)`

`@from` registers an async guard that normalizes the phone to a JID on first use (via the client's
internal resolver) and caches it. The command only runs when the message's author matches the admin.
Pass `string[]` for multiple admins or a `(jid) => boolean` predicate for custom matching.

### `@every(30_000)` and `@delay(60_000)`

`@every` installs a `setInterval`: executions are independent and can overlap if the method takes
longer than the interval. `@delay` chains `setTimeout` calls instead, so the next run only starts
after the previous one resolved. Both start on `connected` and stop on `disconnected`, and neither
receives arguments — reach the client through `this`.

### `@pipe('talk', 0)` and `@pipe('talk', 1)`

Two steps of the same workflow. They run **sequentially** on every `message:created`, ordered by
`index`. Step 0 tags the message with `received_at`; step 1 reads that field — because both steps
share the same `msg` reference, the mutation is visible downstream. Any number of steps can belong
to the same workflow, and workflows are independent of each other.

### `@on('message:created') + @guard(...)`

Generic inbound logger that demonstrates the plain event subscription with an ad-hoc guard. `@guard`
is stackable and short-circuits with AND semantics; `msg.me` is `true` for messages authored by the
bot, so filtering it out prevents self-logging loops.

!!! warning "Guards receive `unknown` arguments"
    The predicate signature is `(...args: unknown[])`, so `@guard((msg: Message) => !msg.me)` does
    **not** compile under `strict`. Let the parameter be inferred and cast inside the body, as in
    `@guard((msg) => !(msg as Message).me)`.

---

## Variant: `@Bot` with default options

`@Bot(defaults)` turns any class into a `WhatsAppBot` subclass and merges the options you pass at
construction time over its defaults:

```typescript title="bot-decorated.ts"
import { FileSystemEngine } from "@arcaelas/whatsapp";
import { WhatsAppBot, Bot, connect } from "@arcaelas/whatsapp/decorators";

@Bot({
  engine: new FileSystemEngine(".sessions/bot"),
  phone: 5491112345678,
})
class Staging extends WhatsAppBot {
  @connect()
  on_open() {
    console.log("connected");
  }
}

const bot = new Staging({ engine: new FileSystemEngine(".sessions/staging") });
await bot.connect();
```

!!! warning "Keep `extends WhatsAppBot`"
    Stage 3 decorators cannot change the declared type of a class. `@Bot` produces the right object
    at runtime, but without `extends WhatsAppBot` TypeScript will not see `connect()` or
    `disconnect()` on your class.

---

## Running

```bash
yarn tsx bot.ts
```

The first run prints a PIN (or writes `qr.png`). Pair the phone, observe the `[lifecycle] connected` line, then send:

- `/help` — the command help listing.
- `/echo hello world` — the bot replies `hello world`.
- `/shutdown` — only the admin phone can trigger it.

While running, the `[heartbeat]` log ticks every 30 seconds, `[sweep]` runs a minute after the previous sweep finished, and every inbound message flows through the `talk` workflow and the generic logger.

---

## See also

- [References / Decorators](../references/decorators.md) — full decorator reference and stacking rules.
- [References / Events](../references/events.md) — event names and payloads.
- [Examples / Basic bot](basic-bot.md) — the same use case written against the raw `WhatsApp` client (no decorators).
