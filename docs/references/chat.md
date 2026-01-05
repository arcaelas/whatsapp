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

## Properties

Each Chat instance has the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Chat ID (JID) |
| `name` | `string` | Chat name |
| `type` | `"contact" \| "group"` | Chat type |
| `content` | `string` | Chat/group description |
| `pined` | `boolean` | Pinned chat |
| `archived` | `boolean` | Archived chat |
| `muted` | `number \| false` | Mute end timestamp or `false` if unmuted |
| `readed` | `boolean` | If chat is read |
| `readonly` | `boolean` | If chat is read-only |

---

## Static methods

### get()

Gets a specific chat.

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

### paginate()

Gets chats with pagination.

```typescript
const chats = await wa.Chat.paginate(offset?: number, limit?: number): Promise<Chat[]>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `offset` | `number` | `0` | Starting position |
| `limit` | `number` | `50` | Maximum chats |

**Example:**

```typescript
const chats = await wa.Chat.paginate(0, 100);
for (const chat of chats) {
  console.log(`${chat.name} (${chat.type})`);
}
```

### pin()

Pins or unpins a chat.

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

Archives or unarchives a chat.

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

Mutes or unmutes a chat.

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

Marks a chat as read.

```typescript
const success = await wa.Chat.seen(cid: string): Promise<boolean>
```

**Example:**

```typescript
await wa.Chat.seen("5491112345678@s.whatsapp.net");
```

### remove()

Deletes a chat (with cascade delete of all messages).

```typescript
const success = await wa.Chat.remove(cid: string): Promise<boolean>
```

### cascade_delete()

Deletes all chat data from storage without notifying WhatsApp.

```typescript
await wa.Chat.cascade_delete(cid: string): Promise<void>
```

**Note:** This only removes local storage data. Use `remove()` to also notify WhatsApp.

### add_message()

Adds a message to the chat's message index.

```typescript
await wa.Chat.add_message(cid: string, mid: string, timestamp: number): Promise<void>
```

### remove_message()

Removes a message from the chat's message index.

```typescript
await wa.Chat.remove_message(cid: string, mid: string): Promise<void>
```

### list_messages()

Lists message IDs from the chat (paginated).

```typescript
const ids = await wa.Chat.list_messages(cid: string, offset?: number, limit?: number): Promise<string[]>
```

### count_messages()

Counts messages in a chat.

```typescript
const count = await wa.Chat.count_messages(cid: string): Promise<number>
```

### members()

Gets members of a group.

```typescript
const members = await wa.Chat.members(
  cid: string,
  offset?: number,
  limit?: number
): Promise<Contact[]>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cid` | `string` | - | Group ID |
| `offset` | `number` | `0` | Starting position |
| `limit` | `number` | `50` | Maximum members |

**Example:**

```typescript
const members = await wa.Chat.members("123456789@g.us", 0, 100);
console.log(`Members: ${members.length}`);
for (const member of members) {
  console.log(`  - ${member.name}: ${member.phone}`);
}
```

---

## Instance methods

### messages()

Gets messages from this chat with pagination.

```typescript
const messages = await chat.messages(offset?: number, limit?: number): Promise<Message[]>
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
  const members = await wa.Chat.members(chat.id, 0, 1000);
  console.log(`Members: ${members.length}`);
}
```

---

## Complete example

```typescript
// List all archived chats
wa.event.on("chat:created", async (chat) => {
  console.log(`New chat: ${chat.name} (${chat.type})`);

  if (chat.type === "group") {
    const members = await wa.Chat.members(chat.id, 0, 100);
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
  // Get chat from storage and archive if needed
  const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
  if (chat && !chat.archived) {
    await wa.Chat.archive(chat.id, true);
    console.log(`Archived: ${chat.name}`);
  }
}
```
