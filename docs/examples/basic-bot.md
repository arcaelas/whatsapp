# Basic Bot

A minimal end-to-end example: a single file that connects to WhatsApp, logs every incoming message, and replies `pong` whenever it receives `ping`.

This is the "hello world" of `@arcaelas/whatsapp` v3. Everything you need lives in one file — engine creation, event handlers, a reply, and a clean shutdown.

---

## Full example

```typescript title="index.ts"
import { join } from 'node:path';
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new FileSystemEngine(join(__dirname, 'session')),
    phone: 584144709840,
});

wa.on('connected', () => {
    console.log('[wa] connected');
});

wa.on('disconnected', () => {
    console.log('[wa] disconnected');
});

wa.on('message:created', async (msg, chat, wa) => {
    if (msg.me) {
        return;
    }

    console.log(`[${chat.name}] ${msg.caption}`);

    if (msg.caption.trim().toLowerCase() === 'ping') {
        await msg.text('pong');
    }
});

process.on('SIGINT', async () => {
    console.log('\n[wa] shutting down...');
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

Run it:

```bash
npx tsx index.ts
```

---

## How it works

### 1. Engine

```typescript
engine: new FileSystemEngine(join(__dirname, 'session')),
```

The engine is the persistence layer. `FileSystemEngine` writes credentials, chats, contacts and messages under the directory you give it. Delete that directory and the next run starts a fresh session.

### 2. Phone vs QR

```typescript
phone: 584144709840,
```

When `phone` is set, the first connect emits a **PIN** (string) — type it in WhatsApp under *Linked devices > Link with phone number*. Omit `phone` and you receive a **PNG Buffer** containing the QR code instead.

!!! tip
    During development, scan a fresh QR with the WhatsApp mobile app to confirm the PIN flow. Once paired, the engine remembers the session and skips this step on every subsequent run.

### 3. Lifecycle events

```typescript
wa.on('connected', ...)
wa.on('disconnected', ...)
```

`connected` fires once the session has fully synced and the bot is ready to send/receive. `disconnected` fires on any non-transient close (the client auto-reconnects on transient closes by default).

### 4. Incoming messages

```typescript
wa.on('message:created', async (msg, chat, wa) => {
    if (msg.me) {
        return;
    }
    // ...
});
```

Every listener receives the artifact, the chat, and the client instance. The `!msg.me` guard is essential — without it the bot will react to its own outgoing messages and loop forever.

### 5. Replying

```typescript
await msg.text('pong');
```

`msg.text(...)` is a quoted reply — the original message appears as a citation. To send a standalone message instead, use `wa.Message.text(chat.id, 'pong')`.

### 6. Graceful shutdown

```typescript
process.on('SIGINT', async () => {
    await wa.disconnect();
    process.exit(0);
});
```

`disconnect()` closes the socket cleanly and cancels any pending reconnect timer. Pass `{ destroy: true }` if you want to wipe the engine on exit (useful for tests).

---

## Next steps

- [Command bot](./command-bot.md) — parse `/help`, `/ping`, `/echo` and dispatch handlers.
- [Custom engine](./custom-engine.md) — implement your own storage backend.
