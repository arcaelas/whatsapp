# Chat

Class for chat management.

---

## Import

The Chat class is accessed through the WhatsApp instance:

```typescript
const wa = new WhatsApp();
// wa.Chat is available after instantiation
```

---

## IChatRaw

Raw chat object stored in the engine:

```typescript
interface IChatRaw {
  id: string;
  name?: string | null;
  displayName?: string | null;
  description?: string | null;
  unreadCount?: number | null;
  readOnly?: boolean | null;
  archived?: boolean | null;
  pinned?: number | null;
  muteEndTime?: number | null;
  markedAsUnread?: boolean | null;
  participant?: IGroupParticipant[] | null;
  createdBy?: string | null;
  createdAt?: number | null;
  ephemeralExpiration?: number | null;
}

interface IGroupParticipant {
  id: string;
  admin: string | null;
}
```

---

## Properties

Each Chat instance has the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Chat ID (JID) |
| `name` | `string` | Chat name (fallback: `raw.name` -> `raw.displayName` -> phone from JID) |
| `type` | `"contact" \| "group"` | Chat type (based on JID suffix) |
| `content` | `string` | Chat/group description (empty string if not set) |
| `pined` | `boolean` | Whether the chat is pinned |
| `archived` | `boolean` | Whether the chat is archived |
| `muted` | `number \| false` | Mute end timestamp or `false` if unmuted |
| `readed` | `boolean` | Whether the chat is read |
| `readonly` | `boolean` | Whether the chat is read-only |
| `raw` | `IChatRaw` | Raw chat data |

---

## Static methods

### get()

Gets a specific chat. If the chat is not in storage, it tries to find the contact and create one.

```typescript
const chat = await wa.Chat.get(cid: string): Promise<Chat | null>
```

**Example:**

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  console.log(`Name: ${chat.name}`);
  console.log(`Type: ${chat.type}`);
}
```

### list()

Gets chats with pagination.

```typescript
const chats = await wa.Chat.list(offset?: number, limit?: number): Promise<Chat[]>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `offset` | `number` | `0` | Starting position |
| `limit` | `number` | `50` | Maximum chats |

**Example:**

```typescript
const chats = await wa.Chat.list(0, 100);
for (const chat of chats) {
  console.log(`${chat.name} (${chat.type})`);
}
```

### pin()

Pins or unpins a chat by ID. Delegates to the instance method internally.

```typescript
const success = await wa.Chat.pin(cid: string, value: boolean): Promise<boolean>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `cid` | `string` | Chat ID |
| `value` | `boolean` | `true` to pin, `false` to unpin |

**Example:**

```typescript
// Pin
await wa.Chat.pin("5491112345678@s.whatsapp.net", true);

// Unpin
await wa.Chat.pin("5491112345678@s.whatsapp.net", false);
```

### archive()

Archives or unarchives a chat by ID. Delegates to the instance method internally.

```typescript
const success = await wa.Chat.archive(cid: string, value: boolean): Promise<boolean>
```

**Example:**

```typescript
// Archive
await wa.Chat.archive("5491112345678@s.whatsapp.net", true);

// Unarchive
await wa.Chat.archive("5491112345678@s.whatsapp.net", false);
```

### mute()

Mutes or unmutes a chat by ID. Delegates to the instance method internally.

```typescript
const success = await wa.Chat.mute(cid: string, duration: number | null): Promise<boolean>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `cid` | `string` | Chat ID |
| `duration` | `number \| null` | Duration in milliseconds or `null` to unmute |

**Example:**

```typescript
// Mute for 8 hours
await wa.Chat.mute("5491112345678@s.whatsapp.net", 8 * 60 * 60 * 1000);

// Unmute
await wa.Chat.mute("5491112345678@s.whatsapp.net", null);
```

### seen()

Marks a chat as read by ID. Delegates to the instance method internally.

```typescript
const success = await wa.Chat.seen(cid: string): Promise<boolean>
```

**Example:**

```typescript
await wa.Chat.seen("5491112345678@s.whatsapp.net");
```

### remove()

Deletes a chat by ID. For groups it leaves the group, for individual chats it sends a delete modification. Also performs cascade delete of all stored data under `chat/{cid}`.

```typescript
const success = await wa.Chat.remove(cid: string): Promise<boolean>
```

**Example:**

```typescript
await wa.Chat.remove("5491112345678@s.whatsapp.net");
```

---

## Instance methods

### refresh()

Refreshes chat data from WhatsApp. For groups, fetches group metadata (name, description, participants, creator). For individual chats, refreshes the associated contact. Returns `this` on success, `null` if no socket is available.

```typescript
await chat.refresh(): Promise<this | null>
```

**Example:**

```typescript
const chat = await wa.Chat.get("123456789@g.us");
if (chat) {
  const refreshed = await chat.refresh();
  if (refreshed) {
    console.log("Updated name:", refreshed.name);
    console.log("Description:", refreshed.content);
  }
}
```

### remove()

Deletes this chat. For groups, leaves the group. For individual chats, sends a delete modification to WhatsApp. Also performs cascade delete of all stored data under `chat/{cid}` via `engine.set(key, null)`.

```typescript
await chat.remove(): Promise<boolean>
```

**Example:**

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  await chat.remove();
}
```

### pin()

Pins or unpins this chat.

```typescript
await chat.pin(value: boolean): Promise<boolean>
```

**Example:**

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  await chat.pin(true); // Pin
  await chat.pin(false); // Unpin
}
```

### archive()

Archives or unarchives this chat.

```typescript
await chat.archive(value: boolean): Promise<boolean>
```

**Example:**

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  await chat.archive(true); // Archive
  await chat.archive(false); // Unarchive
}
```

### mute()

Mutes or unmutes this chat.

```typescript
await chat.mute(duration: number | null): Promise<boolean>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `duration` | `number \| null` | Duration in ms (0 or `null` to unmute) |

**Example:**

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  await chat.mute(8 * 60 * 60 * 1000); // Mute for 8 hours
  await chat.mute(null); // Unmute
}
```

### seen()

Marks this chat as read.

```typescript
await chat.seen(): Promise<boolean>
```

**Example:**

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  await chat.seen();
}
```

### members()

Gets members of this chat. For groups, fetches participants from WhatsApp and returns them as Contact instances. For individual chats, returns an array with the single contact.

```typescript
await chat.members(offset?: number, limit?: number): Promise<Contact[]>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `offset` | `number` | `0` | Starting position |
| `limit` | `number` | `50` | Maximum members |

**Example:**

```typescript
const chat = await wa.Chat.get("123456789@g.us");
if (chat) {
  const members = await chat.members(0, 100);
  console.log(`Members: ${members.length}`);
  for (const member of members) {
    console.log(`  - ${member.name}: ${member.phone}`);
  }
}
```

### messages()

Gets messages from this chat with pagination. Delegates to `wa.Message.list(cid, offset, limit)`.

```typescript
await chat.messages(offset?: number, limit?: number): Promise<Message[]>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `offset` | `number` | `0` | Starting position |
| `limit` | `number` | `50` | Maximum messages |

**Example:**

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  const messages = await chat.messages(0, 100);
  for (const msg of messages) {
    console.log(`${msg.type}: ${msg.caption}`);
  }
}
```

### contact()

Gets the contact associated with this chat. Returns `null` for group chats.

```typescript
await chat.contact(): Promise<Contact | null>
```

**Example:**

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat) {
  const contact = await chat.contact();
  if (contact) {
    console.log(`Contact: ${contact.name}`);
  }
}
```

---

## Chat types

### Individual chat

JID format: `{phone}@s.whatsapp.net`

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat?.type === "contact") {
  console.log("Individual chat");
}
```

### Group

JID format: `{id}@g.us`

```typescript
const chat = await wa.Chat.get("123456789@g.us");
if (chat?.type === "group") {
  console.log("Group:", chat.name);
  const members = await chat.members(0, 100);
  console.log(`Members: ${members.length}`);
}
```

---

## Complete example

```typescript
// Handle new chats
wa.event.on("chat:created", async (chat) => {
  console.log(`New chat: ${chat.name} (${chat.type})`);

  if (chat.type === "group") {
    const members = await chat.members(0, 100);
    console.log(`Group with ${members.length} members`);
  }
});

// Auto mark as read
wa.event.on("message:created", async (msg) => {
  if (!msg.me) {
    await wa.Chat.seen(msg.cid);
  }
});

// Archive old chats
async function archive_old_chats() {
  const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
  if (chat && !chat.archived) {
    await chat.archive(true);
    console.log(`Archived: ${chat.name}`);
  }
}
```
