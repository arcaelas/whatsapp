# Decorators

Stage 3 decorator API layered on top of the WhatsApp client. Opt-in via the sub-entry `@arcaelas/whatsapp/decorators`; the core package (`@arcaelas/whatsapp`) remains unchanged.

The decorator layer wires methods declared on a class against the real event emitter at `connect()` time. It does not replace the client — it binds decorated methods to events, timers, pairing callbacks and sequential workflows.

---

## Import

```typescript title="bot.ts"
import {
  Bot,
  on,
  guard,
  once,
  connect,
  disconnect,
  every,
  pair,
  from,
  pipe,
  command,
  WhatsAppBot,
} from "@arcaelas/whatsapp/decorators";
```

---

## Requirements

!!! info "Environment"
    - **Node.js ≥ 20**. The package polyfills `Symbol.metadata` internally, so the runtime does not need native support.
    - **TypeScript ≥ 5**. Use native Stage 3 decorators. Do **not** enable `experimentalDecorators` or `emitDecoratorMetadata` in `tsconfig.json` — they target the legacy proposal and are incompatible.
    - No Reflect-metadata dependency required.

Minimal `tsconfig.json`:

```json title="tsconfig.json"
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true
  }
}
```

---

## Overview

| Decorator | Signature | Summary |
|-----------|-----------|---------|
| `@Bot` | `(options: IWhatsApp) => ClassDecorator` | Turns a class into a `WhatsAppBot` subclass with default options. |
| `@on` | `(event: string) => MethodDecorator` | Subscribes the method to a client event. Stackable. |
| `@guard` | `(pred: (...args) => boolean \| Promise<boolean>) => MethodDecorator` | Pre-check run before the handler. Stackable (AND). |
| `@once` | `(event?: string) => MethodDecorator` | Runs the handler one time, then unsubscribes. Accepts an optional event shortcut. |
| `@connect` | `() => MethodDecorator` | Alias of `@on('connected')`. |
| `@disconnect` | `() => MethodDecorator` | Alias of `@on('disconnected')`. |
| `@every` | `(ms: number) => MethodDecorator` | Periodic timer bound to the connection lifecycle. |
| `@pair` | `() => MethodDecorator` | Pairing (PIN/QR) callback. Multiple methods run in parallel. |
| `@from` | `(src: string \| string[] \| (jid) => boolean) => MethodDecorator` | Filters by message author (JID, LID or phone). |
| `@command` | `(pattern: string \| RegExp) => MethodDecorator` | Textual command over `message:created` with args parsing. |
| `@pipe` | `(workflow: string, index: number) => MethodDecorator` | Sequential pipeline step sharing mutable arguments. |

---

## `@Bot(options)`

Class decorator that converts the target into a subclass of `WhatsAppBot`. The consumer does **not** need to extend `WhatsAppBot` manually. At construction time the partial override passed to `new Bot(override?)` is merged on top of the `default_options` supplied to the decorator.

**Signature**

```typescript
function Bot(default_options: IWhatsApp): ClassDecorator;
```

**Behaviour**

- The produced subclass inherits from `WhatsAppBot`, so `connect()` is the wiring entry point.
- Methods and metadata of the original class are copied onto the generated subclass.
- The constructor accepts a `Partial<IWhatsApp>` that overrides the decorator defaults.

```typescript title="minimal-bot.ts"
import Redis from "ioredis";
import { Bot, connect, RedisEngine } from "@arcaelas/whatsapp/decorators";

@Bot({
  engine: new RedisEngine(new Redis()),
  phone: "5491112345678",
})
class MyBot {
  @connect()
  on_open() {
    console.log("connected");
  }
}

const bot = new MyBot();
await bot.connect();
```

Passing an override at construction time:

```typescript
const staging = new MyBot({ phone: "5491199999999" });
```

---

## `@on(event)`

Subscribes the method to a client event. The decorator is **stackable** — multiple `@on` entries on the same method register multiple subscriptions without duplication within the same method.

```typescript
@on("message:created")
@on("message:updated")
log_message(msg: Message, chat: Chat, wa: WhatsApp) {
  console.log(msg.id);
}
```

Valid event names are documented in [References / Events](events.md). Common values include `connected`, `disconnected`, `message:created`, `message:updated`, `message:reacted`, `contact:created`, `contact:updated`, `chat:created`, `chat:updated`.

!!! tip "Listener payload"
    Handler arguments mirror the emitter payload. For message events the signature is `(msg, chat, wa)`; for contact events `(contact, chat, wa)`.

---

## `@guard(pred)`

Registers a predicate evaluated **before** the handler. Multiple guards accumulate and are evaluated sequentially in declaration order with **AND** semantics — any guard returning falsy short-circuits and the handler does not run.

```typescript
@on("message:created")
@guard((msg: Message) => !msg.me)
@guard((msg: Message) => msg.type === "text")
on_inbound_text(msg: Message) {
  /* ... */
}
```

**Auto-registration**: if the method has no explicit `@on` but at least one `@guard` (or `@from`, which adds a guard internally), it is implicitly registered to `message:created`.

```typescript
// Equivalent to @on('message:created') + @guard(...)
@guard((msg: Message) => msg.type === "image")
on_image(msg: Message) {
  /* ... */
}
```

---

## `@once()` / `@once(event)`

Marks the handler to fire **one time** and then auto-unsubscribe. Two forms:

- `@once()` — pure modifier, combine with `@on` (or with an implicit auto-registration).
- `@once(event)` — shortcut equivalent to `@on(event) + @once()`.

```typescript
@once("connected")
greet_once() {
  console.log("first connection");
}

@on("message:created")
@once()
first_message(msg: Message) {
  console.log("first inbound message");
}
```

---

## `@connect()` / `@disconnect()`

Semantic aliases of `@on('connected')` and `@on('disconnected')`. The method runs when the WhatsApp connection opens or closes respectively.

```typescript
@connect()
on_open() {
  console.log("connected");
}

@disconnect()
on_close() {
  console.log("disconnected");
}
```

---

## `@every(ms)`

Installs a periodic timer. The interval starts when `connected` is emitted and is cleared on `disconnected`, so the callback does not run while the client is offline.

```typescript
@every(30_000)
async heartbeat() {
  console.log("tick", Date.now());
}
```

!!! warning
    Timer callbacks receive no arguments. If you need access to the client, capture it via `this` (the method is bound to the bot instance).

---

## `@pair()`

Marks the method as a pairing callback. When baileys delivers a PIN or QR, all `@pair` methods are invoked in parallel via `Promise.all`. A `connect(callback?)` argument — if passed — runs alongside them.

```typescript
@pair()
async on_pin(code: string | Buffer) {
  if (Buffer.isBuffer(code)) {
    await writeFile("qr.png", code);
  } else {
    console.log("pair code:", code);
  }
}
```

Since `connect()` no longer needs an explicit callback when `@pair` is present:

```typescript
await bot.connect(); // pairing handled by @pair methods
```

---

## `@from(source)`

Filters `message:created` by the message author. The source is one of:

- `string` — JID (`5491112345678@s.whatsapp.net`), LID (`<digits>@lid`) or plain phone number (`5491112345678`).
- `string[]` — any of the entries matches (OR).
- `(jid: string) => boolean` — custom predicate over `msg.from`.

Strings are normalised the first time the guard runs, using the internal resolver `wa._resolve_jid(uid)`. Results are cached in a `Set` on the handler so subsequent invocations are O(1).

```typescript
@command("/ban")
@from(["5491111111111", "5492222222222"])
ban_user(msg: Message, chat: Chat, args: string[]) {
  /* admin-only */
}

@from((jid) => jid.endsWith("@s.whatsapp.net"))
personal_only(msg: Message) {
  /* ... */
}
```

**Auto-registration**: like `@guard`, a method decorated only with `@from` (no `@on`) is auto-registered to `message:created`.

---

## `@command(pattern)`

Shortcut for a textual command on `message:created`. Internally it applies:

1. `@on('message:created')`.
2. A guard matching `pattern` against `msg.caption`:
   - `string` pattern → `startsWith`.
   - `RegExp` pattern → `test`.
3. A transform that rewrites the arguments to `(msg, chat, args)`:
   - For a string pattern, `args` is the remaining text split by whitespace.
   - For a `RegExp`, `args` is `match.slice(1)` (capture groups).

```typescript
@command("/help")
show_help(msg: Message, chat: Chat, args: string[]) {
  /* args = [] for "/help", ["topic"] for "/help topic" */
}

@command(/^\/echo\s+(.+)$/)
echo(msg: Message, chat: Chat, args: string[]) {
  const [text] = args;
  /* ... */
}
```

!!! note "Argument shape"
    `@command` rewrites the handler signature from `(msg, chat, wa)` to `(msg, chat, args)`. The `wa` instance remains accessible via `this`.

---

## `@pipe(workflow, index)`

Registers the method as a step inside a named **workflow**. All steps with the same `workflow` name run sequentially on every `message:created`, ordered by `index` ascending. Steps share the same arguments (`msg`, `chat`, `wa`), so mutations on those objects propagate to later steps.

```typescript
@pipe("inbound", 0)
async step_1(msg: Message) {
  (msg as any).tags = ["fresh"];
}

@pipe("inbound", 1)
async step_2(msg: Message) {
  (msg as any).tags.push("audited");
}
```

Contract:

- Sequential: each step is awaited before the next.
- Shared state: mutations on `msg`/`chat` are visible downstream.
- No guards / events apply — `@pipe` is self-contained.
- Multiple workflows coexist; each runs independently on `message:created`.

!!! warning "Do not mix with `@on` on the same method"
    A method decorated with `@pipe` is registered solely as a step. Adding `@on` or `@guard` on the same method has no effect on the workflow.

---

## Stacking rules

Legend: ✅ compose · ⚠️ composable, read the note · ❌ not supported.

| With → / Base ↓ | `@on` | `@guard` | `@once` | `@from` | `@command` | `@pipe` | `@every` | `@pair` |
|---|---|---|---|---|---|---|---|---|
| `@on` (stackable) | ✅ | ✅ | ✅ | ✅ | ⚠️ redundant | ❌ | ⚠️ | ❌ |
| `@guard` (stackable) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ⚠️ | ❌ |
| `@once` | ✅ | ✅ | — | ✅ | ✅ | ❌ | ❌ | ❌ |
| `@from` (single) | ✅ | ✅ | ✅ | ❌ two `@from` | ✅ | ❌ | ❌ | ❌ |
| `@command` (single) | ⚠️ | ✅ | ✅ | ✅ | ❌ two `@command` | ❌ | ❌ | ❌ |
| `@pipe` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ same step index clashes | ❌ | ❌ |
| `@every` | ⚠️ emits `__every:*` event — do not combine with real events | ⚠️ guards run without a message | ❌ | ❌ | ❌ | ❌ | ❌ duplicate ms creates two timers | ❌ |
| `@pair` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ multiple methods run in parallel |

Key notes:

- **`@command` + `@command`** on the same method is invalid — the second pattern replaces the first transform; declare two methods instead.
- **`@from` + `@from`** on the same method: only the **last** registered set is respected in terms of source resolution; for OR matching pass an array to a single `@from`.
- **`@pipe` is terminal**: a method marked as a pipe step should not carry any other decorator.
- **`@every` + `@on`** registers the method to both the timer and an event — the timer invocation receives no args, which can break handlers that expect `(msg, chat, wa)`.
- **`@pair` is its own channel** (`__pair`); never combine with `@on`.

---

## Execution semantics

### Listener dispatch

Listeners for the same event run **concurrently** under the EventEmitter — the underlying emitter calls listeners synchronously without awaiting them, so two handlers for `message:created` start in parallel.

Inside a single handler the flow is **sequential**:

1. All `guards` are awaited in declaration order (AND short-circuit).
2. All `transforms` are awaited in declaration order, producing the final argument list.
3. The handler body runs with the transformed arguments.

### Timers

`@every(ms)` handlers start on the `connected` event via `setInterval(run, ms)` and are cancelled on `disconnected`. A reconnect cycle therefore re-arms them from scratch.

### Pairing

`@pair` callbacks are collected at `connect()` and invoked in parallel with `Promise.all`. If the consumer passes a callback to `connect(callback)`, it runs in parallel alongside the decorator-based callbacks.

### Workflows

A `@pipe(workflow, _)` group is registered as a single listener on `message:created`. When the event fires, steps are sorted by `index` and awaited sequentially:

```typescript
for (const step of sorted_steps) {
  await step(msg, chat, wa);
}
```

Because the arguments are shared, mutations on `msg` or `chat` are observable by subsequent steps.

---

## Advanced: custom decorators

The infrastructure exposes a `decorator<P>()` factory to build your own parametric decorators without touching the metadata layer directly. The callback mutates the resolved `HandlerMeta` entry — push events, guards, transforms or flip `once`.

**Signature**

```typescript
function decorator<P extends unknown[]>(
  callback: (
    metadata: Record<string | symbol, unknown>,
    handler: HandlerMeta,
    params: P,
  ) => void,
): (...params: P) => MethodDecorator;
```

**Example — `@onlyType('image')`**

```typescript title="custom-decorators.ts"
import { decorator } from "@arcaelas/whatsapp/decorators";
import type { Message } from "@arcaelas/whatsapp";

export const only_type = decorator<[type: Message["type"]]>(
  (_meta, handler, [type]) => {
    handler.guards.push((...args) => {
      const msg = args[0] as Message;
      return msg.type === type;
    });
  },
);
```

Usage:

```typescript
@only_type("image")
on_image(msg: Message) {
  /* ... */
}
```

The factory auto-registers to `message:created` by virtue of the guard being added without an `@on` — identical behaviour to the built-in `@guard` / `@from`.

!!! info "Exposed primitives"
    For more complex cases (timers, workflows, new event channels) the following are public: `HANDLERS` (symbol), `HandlerMeta`, `BotSchema`, `WorkflowStep`, `register_workflow_step()`. See `src/lib/bot/decorator.ts` for the full schema contract.

---

## See also

- [Examples / Decorator bot](../examples/decorator-bot.md) — complete runnable example.
- [References / Events](events.md) — event names and payloads.
- [References / WhatsApp](whatsapp.md) — underlying client.
