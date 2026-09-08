# Groups

Group chats use the same API as 1:1 conversations — the only difference is that the
identifier ends with `@g.us`. The `Chat` instance exposes the group-specific helpers
(`members()`, `admins()`, `admin()`, `content()`, `rename()`, `describe()`, `add()`,
`remove()`, `promote()`, `demote()`, `invite()`, `revoke()`, `announce()`, `restrict()`),
and every other action method works the same.

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
    A `Contact` exposes `name`, `phone`, `jid`, `lid`, `photo` and `me`. In groups addressed by
    LID, `phone` may be `null` — fall back to `lid` as in the snippet above.

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

### Mentioning users

Write `@<phone>` in the text and name the same people in `mentions`. The library resolves each one
to the identifier the group uses — a LID in groups migrated to the new addressing — and rewrites the
`@` accordingly, so the recipient sees a real mention:

```typescript title="mention.ts"
await wa.Message.text(GROUP_CID, '@14155557777 can you review the PR?', { mentions: ['14155557777'] });

wa.on('message:created', async (msg) => {
    if (msg.mentioned) {
        console.log('mentioned me, along with', (await msg.mentions()).map((who) => who.name));
    }
});
```

---

## Admin-only commands

`chat.admins()` returns the group administrators, so a command can check the author's role against
the group itself instead of a hand-kept whitelist. The following bot listens for `!purge` and only
acts when the sender administers the group.

```typescript title="admin-commands.ts"
import { Text } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:created', async (msg, chat) => {
    if (chat.type === 'group' && msg instanceof Text && msg.caption.trim() === '!purge') {
        const author = await msg.author();
        const admins = await chat.admins();
        if (admins.some((who) => who.phone === author.phone)) {
            await chat.clear();
            await msg.text('History cleared.');
        } else await msg.text('Only admins can run that command.');
    }
});
```

!!! warning "Compare resolved contacts, not `msg.from`"
    `msg.from` is the author identifier as stored: a `@s.whatsapp.net` JID in most groups, but a
    `@lid` in groups migrated to the new addressing. `msg.author()` canonicalizes it, so compare
    `phone` (or `lid`) between contacts as above.

!!! tip "Decorator alternative"
    For a fixed list of operators prefer the `@from` decorator from `@arcaelas/whatsapp/decorators`
    — it resolves phones, JIDs and LIDs for you and works with arrays.

---

## Membership changes

Membership travels as events: `chat:joined`, `chat:left`, `chat:promoted` and `chat:demoted`
carry the chat and the affected contacts, and `chat:updated` fires when the group is renamed or
described.

```typescript title="membership.ts"
import { wa } from './client';

wa.on('chat:joined',   (chat, people) => console.log(`${people.map((who) => who.name)} joined ${chat.name}`));
wa.on('chat:left',     (chat, people) => console.log(`${people.map((who) => who.name)} left ${chat.name}`));
wa.on('chat:promoted', (chat, people) => console.log(`${people.map((who) => who.name)} now admin in ${chat.name}`));
wa.on('chat:demoted',  (chat, people) => console.log(`${people.map((who) => who.name)} no longer admin in ${chat.name}`));
wa.on('chat:updated',  (chat) => console.log(`${chat.name} was renamed or described`));
```

The system notice WhatsApp shows for each change still arrives as a `message:created` with an
empty caption and a `messageStubType` in the raw document; the events above are the way to react to
it.

---

## Creating, joining and moderating

`wa.Chat.create` opens a group with the account as admin and `wa.Chat.join` enters one by invite
link. Every moderation action lives on the instance and needs admin rights.

```typescript title="moderate.ts"
import { wa } from './client';

const group = await wa.Chat.create('Release crew', ['14155557777', '14155558888']);
console.log(await group.invite());                   // https://chat.whatsapp.com/…

await group.describe('Coordination for the 2.0 release');
await group.promote('14155557777');
await group.announce(true);                          // only admins send
await group.remove('14155558888');                   // 1 when WhatsApp accepted it

const joined = await wa.Chat.join('https://chat.whatsapp.com/AbCdEfGhIjK');
console.log(joined?.name, await joined?.admin());   // admin(): whether the account moderates it
```

!!! warning "WhatsApp decides who can be added"
    `add()` returns how many entered: a person whose *Groups* privacy is *My contacts* cannot be
    added by an account they have not saved, and someone removed cannot be added back right away.
    Share `invite()` with them instead.

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
