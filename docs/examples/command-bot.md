# Command Bot

A bot that handles textual commands like `/help`, `/ping`, `/info` and `/echo <text>` — without decorators. Just the raw `wa.on('message:created', ...)` event and a tiny dispatch table.

This pattern is ideal when you want explicit control over routing, or when decorators are not an option (e.g. you're not using TypeScript with `experimentalDecorators`).

---

## Full example

```typescript title="index.ts"
import { join } from 'node:path';
import { WhatsApp, FileSystemEngine, type Message, type Chat } from '@arcaelas/whatsapp';

const PREFIX = '/';

type CommandHandler = (args: string, msg: Message, chat: Chat) => Promise<void>;

const wa = new WhatsApp({
    engine: new FileSystemEngine(join(__dirname, 'session')),
    phone: 584144709840,
});

const commands = new Map<string, CommandHandler>();

commands.set('help', async (_args, msg) => {
    await msg.text(
        [
            'Available commands:',
            '  /help          — show this message',
            '  /ping          — health check',
            '  /info          — chat metadata',
            '  /echo <text>   — repeat <text>',
        ].join('\n'),
    );
});

commands.set('ping', async (_args, msg) => {
    await msg.text('pong');
});

commands.set('info', async (_args, msg, chat) => {
    const total = await wa.Message.count(chat.id);
    await msg.text(
        [
            `chat:    ${chat.name}`,
            `id:      ${chat.id}`,
            `type:    ${chat.type}`,
            `stored:  ${total} messages`,
        ].join('\n'),
    );
});

commands.set('echo', async (args, msg) => {
    if (!args) {
        await msg.text('usage: /echo <text>');
        return;
    }
    await msg.text(args);
});

wa.on('message:created', async (msg, chat) => {
    if (msg.me) {
        return;
    }

    const text = msg.caption.trim();
    if (!text.startsWith(PREFIX)) {
        return;
    }

    const space = text.indexOf(' ');
    const name = (space === -1 ? text.slice(PREFIX.length) : text.slice(PREFIX.length, space)).toLowerCase();
    const args = space === -1 ? '' : text.slice(space + 1).trim();

    const handler = commands.get(name);
    if (!handler) {
        await msg.text(`unknown command: /${name} — try /help`);
        return;
    }

    try {
        await handler(args, msg, chat);
    } catch (err) {
        console.error(`[cmd:${name}] failed`, err);
        await msg.text('internal error');
    }
});

process.on('SIGINT', async () => {
    await wa.disconnect();
    process.exit(0);
});

wa.connect((auth) => {
    if (typeof auth === 'string') {
        console.log(`[wa] pairing code: ${auth}`);
    } else {
        console.log('[wa] scan the QR (PNG buffer received)');
    }
}).catch((err) => {
    console.error('[wa] connect failed:', err);
    process.exit(1);
});
```

---

## Anatomy of the dispatcher

### 1. Registry

```typescript
const commands = new Map<string, CommandHandler>();
```

A `Map` is enough — keys are command names, values are async handlers. Adding a new command is one `commands.set(...)` call. No reflection, no metadata.

### 2. Parsing

```typescript
const text = msg.caption.trim();
if (!text.startsWith(PREFIX)) {
    return;
}

const space = text.indexOf(' ');
const name = (space === -1 ? text.slice(PREFIX.length) : text.slice(PREFIX.length, space)).toLowerCase();
const args = space === -1 ? '' : text.slice(space + 1).trim();
```

Splitting on the **first** whitespace gives the command name and a single string of arguments. If you need richer parsing (flags, quoted strings) plug in a CLI parser like `minimist` or `yargs-parser` here.

### 3. Dispatch

```typescript
const handler = commands.get(name);
if (!handler) {
    await msg.text(`unknown command: /${name} — try /help`);
    return;
}
```

Unknown commands get a friendly hint instead of silence — much better UX than ignoring them.

### 4. Error isolation

```typescript
try {
    await handler(args, msg, chat);
} catch (err) {
    console.error(`[cmd:${name}] failed`, err);
    await msg.text('internal error');
}
```

A `try/catch` around the handler keeps a single buggy command from crashing the whole bot.

---

## Sending without quoting

`msg.text(...)` always replies with a citation. To send a standalone message in the same chat use the static delegate:

```typescript
await wa.Message.text(chat.id, 'standalone message — no quote');
```

---

## What if I want less boilerplate?

If you're writing many commands and want a more declarative style, the library ships with an optional `@command` decorator that handles parsing, dispatch and error wrapping for you.

!!! tip "Check out the decorator example"
    See [`examples/decorator-bot.md`](./decorator-bot.md) for the same bot rewritten with `@command('help')`, `@command('echo')`, etc. The dispatch logic disappears entirely — you only declare the methods.

For one-off bots or when you need full control over routing, the `Map` pattern shown here stays the simplest, most explicit option.

---

## Next steps

- [Basic bot](./basic-bot.md) — even simpler, no commands.
- [Custom engine](./custom-engine.md) — bring your own storage.
