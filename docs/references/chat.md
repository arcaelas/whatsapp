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
| `type` | `"chat" \| "group"` | Chat type |
| `pined` | `boolean` | Pinned chat |
| `archived` | `boolean` | Archived chat |
| `muted` | `number` | Mute timestamp (0 = unmuted) |

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

### pin()

Pins or unpins a chat.

```typescript
await wa.Chat.pin(cid: string, pin?: boolean): Promise<void>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cid` | `string` | - | Chat ID |
| `pin` | `boolean` | `true` | `true` to pin, `false` to unpin |

**Example:**

```typescript
// Pin
await wa.Chat.pin("5491112345678@s.whatsapp.net");

// Unpin
await wa.Chat.pin("5491112345678@s.whatsapp.net", false);
```

### archive()

Archives or unarchives a chat.

```typescript
await wa.Chat.archive(cid: string, archive?: boolean): Promise<void>
```

**Example:**

```typescript
// Archive
await wa.Chat.archive("5491112345678@s.whatsapp.net");

// Unarchive
await wa.Chat.archive("5491112345678@s.whatsapp.net", false);
```

### mute()

Mutes or unmutes a chat.

```typescript
await wa.Chat.mute(cid: string, until?: number): Promise<void>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `cid` | `string` | Chat ID |
| `until` | `number` | Unix timestamp when mute expires (0 or omit to unmute) |

**Example:**

```typescript
// Mute for 8 hours
const eight_hours = Date.now() + (8 * 60 * 60 * 1000);
await wa.Chat.mute("5491112345678@s.whatsapp.net", eight_hours);

// Unmute
await wa.Chat.mute("5491112345678@s.whatsapp.net", 0);
```

### seen()

Marks a chat as read.

```typescript
await wa.Chat.seen(cid: string): Promise<void>
```

**Example:**

```typescript
await wa.Chat.seen("5491112345678@s.whatsapp.net");
```

### remove()

Deletes a chat.

```typescript
await wa.Chat.remove(cid: string): Promise<void>
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

## Chat types

### Individual chat

JID format: `{phone}@s.whatsapp.net`

```typescript
const chat = await wa.Chat.get("5491112345678@s.whatsapp.net");
if (chat?.type === "chat") {
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
    await wa.Chat.archive(chat.id);
    console.log(`Archived: ${chat.name}`);
  }
}
```
