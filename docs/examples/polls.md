# Polls

Polls in WhatsApp are end-to-end encrypted: each vote is encrypted on the voter's
device and only the poll creator (and `@arcaelas/whatsapp` running on their session)
can decrypt the tally. The library handles key derivation and decryption transparently
— you only deal with `options`, `votes()` and `select()`.

!!! info "Encryption is automatic"
    The library derives the per-poll HMAC key, decrypts incoming `pollUpdateMessage` payloads,
    merges them into the stored poll and emits `message:updated`. You never need to touch raw bytes
    or vote signatures.

---

## Setup

```typescript title="client.ts"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

export const wa = new WhatsApp({
    engine: new FileSystemEngine(__dirname + '/.session'),
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

`wa.Message.poll(cid, { content, options }, extra?)` posts a single-choice poll. `content`
is the question; each entry in `options` is an object with a `content` string. Pass
`{ multiple: true }` to allow several answers.

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

// Multi-select variant
await wa.Message.poll(GROUP_CID, {
    content: 'Which days do you come to the office?',
    options: [{ content: 'Mon' }, { content: 'Wed' }, { content: 'Fri' }],
}, { multiple: true });
```

---

## Receiving votes

Vote tallies arrive as `message:updated` events on the original poll. Detect with
`instanceof Poll`, then read `options` — each entry is `{ name, count }` — and the
`multiple` flag.

```typescript title="watch-poll.ts"
import { Poll } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:updated', (msg, chat) => {
    if (msg instanceof Poll) {
        console.log(`[${chat.name}] ${msg.caption}`);
        console.log(`Mode: ${msg.multiple ? 'multi-select' : 'single-select'}`);
        for (const option of msg.options) {
            console.log(`  ${option.name}: ${option.count}`);
        }
    }
});
```

!!! tip "Filtering a single poll"
    There is no per-message subscription helper. Keep the id you care about and compare it inside
    the listener:

    ```typescript
    const off = wa.on('message:updated', (msg) => {
        if (msg instanceof Poll && msg.id === poll_id) {
            console.log(msg.options);
        }
    });

    off();   // unsubscribe when you are done
    ```

---

## Who voted for what

`votes()` breaks the tally down per voter. Each entry is `{ name, contact }`, where `name` is the
chosen option and `contact` is the voter's phone.

```typescript title="votes.ts"
import { Poll } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:updated', async (msg) => {
    if (msg instanceof Poll) {
        for (const vote of await msg.votes()) {
            console.log(`${vote.contact} voted for ${vote.name}`);
        }
    }
});
```

---

## Voting programmatically

Call `poll.select(index)` to cast a single-choice vote, or `poll.select([i, j])` for
multi-select polls. Indices map to the order of `options`.

```typescript title="vote.ts"
import { Poll } from '@arcaelas/whatsapp';
import { wa } from './client';

const POLL_CID = '120363025912345678@g.us';
const POLL_MID = '3EB0C7689C2E0F5A4F4E';

const poll = await wa.Message.get(POLL_CID, POLL_MID);

if (poll instanceof Poll) {
    if (poll.multiple) {
        await poll.select([0, 2]); // first and third option
    } else {
        await poll.select(1);      // second option
    }
}
```

!!! warning "`select()` is best-effort"
    The vote is encrypted and relayed correctly, but WhatsApp does **not** propagate a vote emitted
    from a linked (companion) device — which is what this library is. Incoming votes decrypt fine;
    your own vote may not appear on other devices. `select()` returns `false` when the poll has no
    encryption key, there is no socket, or no valid index was given.

---

## Auto-vote bot (test helper)

Useful for integration tests: whenever a poll arrives in a watched chat, the bot
picks a random valid option and votes. Demonstrates create + receive + vote in a
single example.

```typescript title="auto-vote-bot.ts"
import { Poll } from '@arcaelas/whatsapp';
import { wa } from './client';

const TEST_GROUP = '120363025912345678@g.us';

wa.on('message:created', async (msg) => {
    if (!(msg instanceof Poll)) {
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
        await msg.select(Math.floor(Math.random() * total_options));
    }

    console.log(`Auto-voted on "${msg.caption}"`);
});
```

---

## Quoting a poll in a reply

Like every `Message` subclass, `Poll` inherits `text()`, `image()`, etc. — replying
to a poll quotes it automatically.

```typescript title="reply-to-poll.ts"
import { Poll } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:updated', async (msg) => {
    if (!(msg instanceof Poll)) {
        return;
    }
    const total = msg.options.reduce((sum, option) => sum + option.count, 0);
    if (total >= 10) {
        await msg.text(`Closing the vote — we got ${total} responses.`);
    }
});
```
