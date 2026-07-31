# Groups

Group chats use the same API as 1:1 conversations — the only difference is that the
identifier ends with `@g.us`. The `Chat` instance exposes the group-specific helpers
`members()` and `content()`, and every action method works the same.

!!! info "Detection"
    Use `chat.type === 'group'` to branch on group vs. contact chats. The check is
    derived from the identifier suffix and is always synchronous.

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

!!! warning "`chat.id` keeps the raw form for groups"
    In a 1:1 chat, `chat.id` is trimmed down to the phone; in a group it stays the full
    `120363…@g.us`. Both are accepted anywhere the library takes an identifier.

---

## Listing members and reading the subject

`chat.members(offset, limit)` returns `Contact` instances and is paginated; the group metadata is
memoized for 15 seconds, so paging does not repeat the round-trip. `chat.content()` resolves the
group description.

```typescript title="list-members.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

const chat = await wa.Chat.get(GROUP_CID);

if (chat && chat.type === 'group') {
    console.log(chat.name, '—', await chat.content());

    const members = await chat.members(0, 500);
    console.log(`${members.length} members:`);
    for (const member of members) {
        console.log(`- ${member.name} (${member.phone ?? member.lid})`);
    }
}
```

!!! info "Contacts have no `id` getter"
    A `Contact` exposes `name`, `phone`, `jid`, `lid` and `photo`. In groups addressed by LID,
    `phone` may be `null` — fall back to `lid` as in the snippet above.

---

## Sending to a group

Identical to a 1:1 chat — just point at the group identifier:

```typescript title="send-to-group.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

await wa.Message.text(GROUP_CID, 'Standup starts in 5 minutes');

const banner = await readFile('./assets/standup.png');
await wa.Message.image(GROUP_CID, banner, { caption: 'See you there!' });
```

!!! warning "Mentioning users"
    The send API does not expose a parameter for `contextInfo.mentionedJid`, so `@user` mentions
    cannot be attached to outgoing messages. The mention list of an **incoming** message is
    reachable through the raw document if you need to react to it:

    ```typescript
    const mentioned = msg._raw.raw.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
    ```

---

## Admin-only commands

There is no built-in role check — match `msg.from` against your own whitelist. The
following bot listens for `!purge` and only acts if the sender is in the admin set.

```typescript title="admin-commands.ts"
import { Text } from '@arcaelas/whatsapp';
import { wa } from './client';

const ADMINS = new Set([
    '14155550001@s.whatsapp.net',
    '14155550002@s.whatsapp.net',
]);

wa.on('message:created', async (msg, chat) => {
    if (chat.type !== 'group') {
        return;
    }
    if (!(msg instanceof Text)) {
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
    await msg.text('History cleared.');
});
```

!!! warning "Whitelists and LID addressing"
    `msg.from` is the author identifier as stored: a `@s.whatsapp.net` JID in most groups, but a
    `@lid` in groups migrated to the new addressing. Store both forms, or compare against
    `(await msg.author()).phone`.

!!! tip "Decorator alternative"
    For larger bots prefer the `@from` decorator from `@arcaelas/whatsapp/decorators` — it resolves
    phones, JIDs and LIDs for you and works with arrays.

---

## Membership changes

The event map has no dedicated `group:join` / `group:leave` events. Baileys delivers membership
changes as system messages, which arrive as `message:created` with an empty caption and a
`messageStubType` in the raw document:

```typescript title="membership.ts"
import { wa } from './client';

wa.on('message:created', (msg, chat) => {
    const stub = msg._raw.raw.messageStubType;
    if (chat.type === 'group' && stub) {
        console.log('[group event]', chat.name, stub, msg._raw.raw.messageStubParameters);
    }
});
```

The alternative, which does not depend on the raw shape, is diffing the member list:

```typescript title="membership-poll.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';
const known = new Set<string>();

setInterval(async () => {
    const chat = await wa.Chat.get(GROUP_CID);
    if (!chat || chat.type !== 'group') {
        return;
    }
    const current = new Set(
        (await chat.members(0, 500)).map((member) => member.jid ?? member.lid ?? member.name),
    );

    for (const id of current) {
        if (!known.has(id)) {
            console.log(`Joined: ${id}`);
        }
    }
    for (const id of known) {
        if (!current.has(id)) {
            console.log(`Left: ${id}`);
        }
    }
    known.clear();
    for (const id of current) {
        known.add(id);
    }
}, 30_000);
```

---

## Archive, pin, mute and leave

Chat actions live on the instance — there are no per-action statics.

```typescript title="manage-group.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

const chat = await wa.Chat.get(GROUP_CID);

if (chat) {
    await chat.archive(true);
    await chat.pin(true);                              // false when 3 chats are already pinned
    await chat.mute('2026-08-01T10:00:00Z');           // ISO date, epoch ms or Date

    // Reverse them later
    await chat.mute(false);
    await chat.archive(false);

    // Leaving the group is `delete()`
    // await chat.delete();
}
```

!!! danger "`delete()` leaves the group"
    For a group chat, `delete()` calls `groupLeave` and then drops the local subtree. There is no
    "delete locally only" variant — use `clear()` if you just want to free storage.
