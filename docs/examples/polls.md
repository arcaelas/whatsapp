# Polls

Polls in WhatsApp are end-to-end encrypted: each vote is encrypted on the voter's
device and only the poll creator (and `@arcaelas/whatsapp` running on their session)
can decrypt the tally. The library handles key derivation and decryption transparently
— you only deal with `content`, `options` and `count`.

!!! info "Encryption is automatic"
    The library derives the per-poll HMAC key, decrypts incoming
    `pollUpdateMessage` payloads and merges them into the original `Poll` instance.
    You never need to touch raw bytes or vote signatures.

---

## Setup

```typescript title="client.ts"
import { WhatsApp } from '@arcaelas/whatsapp';
import { FileSystemEngine } from '@arcaelas/whatsapp/engines';

export const wa = new WhatsApp({
    engine: new FileSystemEngine(__dirname),
    phone: 14155551234,
});

await wa.connect((auth) => {
    if (typeof auth === 'string') {
        console.log('Pair code:', auth);
    }
});
```

---

## Creating a poll

`wa.Message.poll(cid, { content, options })` posts a single-choice poll. `content`
is the question; each entry in `options` is an object with a `content` string.

```typescript title="create-poll.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

await wa.Message.poll(GROUP_CID, {
    content: 'What should we order for lunch?',
    options: [
        { content: 'Pizza' },
        { content: 'Sushi' },
        { content: 'Tacos' },
    ],
});
```

---

## Receiving votes

Vote tallies arrive as `message:updated` events on the original poll. Detect with
`instanceof wa.Message.Poll`, then read `options` (each entry is `{ content, count }`)
and the `multiple` flag.

```typescript title="watch-poll.ts"
import { wa } from './client';

wa.on('message:updated', (msg, chat) => {
    if (!(msg instanceof wa.Message.Poll)) {
        return;
    }
    console.log(`[${chat.name}] ${msg.caption}`);
    console.log(`Mode: ${msg.multiple ? 'multi-select' : 'single-select'}`);
    for (const option of msg.options) {
        console.log(`  ${option.content}: ${option.count}`);
    }
});
```

!!! tip "Per-message subscription"
    If you only care about a specific poll, use `poll.watch(handler)` after creating
    it — the library returns an unsubscribe function and only fires for that exact
    message.

---

## Voting programmatically

Call `poll.select(index)` to cast a single-choice vote, or `poll.select([i, j])` for
multi-select polls. Indices map to the order of `options` in the original
`PollOptions`.

```typescript title="vote.ts"
import { wa } from './client';

const POLL_CID = '120363025912345678@g.us';
const POLL_MID = '3EB0C7689C2E0F5A4F4E';

const poll = await wa.Message.get(POLL_CID, POLL_MID);
if (poll instanceof wa.Message.Poll) {
    if (poll.multiple) {
        await poll.select([0, 2]); // first and third option
    } else {
        await poll.select(1); // second option
    }
}
```

---

## Auto-vote bot (test helper)

Useful for integration tests: whenever a poll arrives in a watched chat, the bot
picks a random valid option and votes. Demonstrates create + receive + vote in a
single example.

```typescript title="auto-vote-bot.ts"
import { wa } from './client';

const TEST_GROUP = '120363025912345678@g.us';

wa.on('message:created', async (msg) => {
    if (!(msg instanceof wa.Message.Poll)) {
        return;
    }
    if (msg.cid !== TEST_GROUP || msg.me) {
        return;
    }

    const total_options = msg.options.length;
    if (total_options === 0) {
        return;
    }

    if (msg.multiple) {
        // Pick a random non-empty subset.
        const picks: number[] = [];
        for (let i = 0; i < total_options; i++) {
            if (Math.random() < 0.5) {
                picks.push(i);
            }
        }
        if (picks.length === 0) {
            picks.push(Math.floor(Math.random() * total_options));
        }
        await msg.select(picks);
    } else {
        const choice = Math.floor(Math.random() * total_options);
        await msg.select(choice);
    }

    console.log(`Auto-voted on "${msg.caption}"`);
});
```

---

## Quoting a poll in a reply

Like every `Message` subclass, `Poll` inherits `text()`, `image()`, etc. — replying
to a poll quotes it automatically.

```typescript title="reply-to-poll.ts"
import { wa } from './client';

wa.on('message:updated', async (msg) => {
    if (!(msg instanceof wa.Message.Poll)) {
        return;
    }
    const total = msg.options.reduce((sum, o) => sum + o.count, 0);
    if (total >= 10) {
        await msg.text(`Closing the vote — we got ${total} responses.`);
    }
});
```
