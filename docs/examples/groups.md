# Groups

Group chats use the same API as 1:1 conversations — the only difference is that the
CID ends with `@g.us`. The `Chat` instance exposes group-specific helpers like
`members()` and works with the static delegates on `wa.Chat.*`.

!!! info "Detection"
    Use `chat.type === 'group'` to branch on group vs. contact chats. The check is
    derived from the JID suffix and is always synchronous.

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

## Detecting a group message

```typescript title="detect-group.ts"
import { wa } from './client';

wa.on('message:created', async (msg, chat) => {
    if (chat.type === 'group') {
        const author = await msg.author();
        console.log(`[${chat.name}] ${author.name}: ${msg.caption}`);
    }
});
```

---

## Listing members

`chat.members(offset, limit)` returns hydrated `Contact` instances and is paginated.
For typical groups, fetching the first 500 in a single call is enough.

```typescript title="list-members.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

const chat = await wa.Chat.get(GROUP_CID);
if (chat && chat.type === 'group') {
    const members = await chat.members(0, 500);
    console.log(`${chat.name} has ${members.length} members:`);
    for (const member of members) {
        console.log(`- ${member.name} (${member.id})`);
    }
}
```

---

## Sending to a group

Identical to a 1:1 chat — just point at the group CID:

```typescript title="send-to-group.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

await wa.Message.text(GROUP_CID, 'Standup starts in 5 minutes');

const banner = await readFile('./assets/standup.png');
await wa.Message.image(GROUP_CID, banner, { caption: 'See you there!' });
```

!!! warning "Mentioning users"
    The v3 send API does not currently expose a parameter for `ContextInfo.mentionedJid`,
    so `@user` mentions cannot be attached to outgoing messages from this library. The
    raw mention list is available on **incoming** messages via `msg._doc.raw` if you
    need to react to mentions inbound.

---

## Admin-only commands

There is no built-in role check — match `msg.from` against your own whitelist. The
following bot listens for `!purge` and only acts if the sender is in the admin set.

```typescript title="admin-commands.ts"
import { wa } from './client';

const ADMINS = new Set([
    '14155550001@s.whatsapp.net',
    '14155550002@s.whatsapp.net',
]);

wa.on('message:created', async (msg, chat) => {
    if (chat.type !== 'group') {
        return;
    }
    if (!(msg instanceof wa.Message.Text)) {
        return;
    }
    if (msg.caption.trim() !== '!purge') {
        return;
    }
    if (!ADMINS.has(msg.from)) {
        await msg.text('Only admins can run that command.');
        return;
    }
    await chat.clear();
    await msg.text('Local history cleared.');
});
```

!!! tip "Decorator alternative"
    For larger bots prefer the `@from` decorator from
    `@arcaelas/whatsapp/decorators` — it eliminates the boilerplate above and works
    with both single JIDs and arrays.

---

## Join / leave events

The v3 event map (`connected`, `chat:*`, `contact:*`, `message:*`) does **not**
include dedicated `group:join` or `group:leave` events. To react to membership
changes today you have two options:

- Listen for the system `message:created` event and inspect the underlying
  `msg._doc.raw.messageStubType` for Baileys group stubs (`GROUP_PARTICIPANT_ADD`,
  `GROUP_PARTICIPANT_REMOVE`, etc.).
- Poll `chat.members()` periodically and diff against a cached set.

```typescript title="membership-poll.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';
const known = new Set<string>();

setInterval(async () => {
    const chat = await wa.Chat.get(GROUP_CID);
    if (!chat || chat.type !== 'group') {
        return;
    }
    const current = await chat.members(0, 500);
    const current_ids = new Set(current.map((c) => c.id));

    for (const id of current_ids) {
        if (!known.has(id)) {
            console.log(`Joined: ${id}`);
        }
    }
    for (const id of known) {
        if (!current_ids.has(id)) {
            console.log(`Left: ${id}`);
        }
    }
    known.clear();
    for (const id of current_ids) {
        known.add(id);
    }
}, 30_000);
```

---

## Archive, pin and mute

The static delegates on `wa.Chat` accept any CID — including a group's. Each one
returns `true` on success.

```typescript title="manage-group.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

await wa.Chat.archive(GROUP_CID, true);
await wa.Chat.pin(GROUP_CID, true);
await wa.Chat.mute(GROUP_CID, true);

// Reverse them later
await wa.Chat.mute(GROUP_CID, false);
await wa.Chat.archive(GROUP_CID, false);
```

The instance-level equivalents (`chat.archive(true)`, `chat.pin(true)`,
`chat.mute(true)`) work identically once you've called `wa.Chat.get(cid)`.
