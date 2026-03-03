# Data Schemas

Standardized schemas for storage in `@arcaelas/whatsapp`.

**Principles:**
- **Minimal**: Only essential fields
- **Flat**: No unnecessary nesting
- **Typed**: Explicit types
- **Temporal**: Timestamps in milliseconds UTC
- **Nullable**: `null` for absence, never `undefined`

---

# Raw Schemas

Classes work with "raw" objects that contain protocol properties. Getters/setters expose a simplified API.

---

## Contact Raw

Raw contact object properties (`IContactRaw`).

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique contact JID |
| `lid` | `string \| null` | Alternative ID in LID format |
| `name` | `string \| null` | Name saved in user's address book |
| `notify` | `string \| null` | Profile push name set by the contact |
| `verifiedName` | `string \| null` | Verified business account name |
| `imgUrl` | `string \| null` | Profile picture URL (may expire or be `"changed"`) |
| `status` | `string \| null` | Contact profile bio/status |

### Raw Example

```json
{
    "id": "584144709840@s.whatsapp.net",
    "lid": "140913951141911@lid",
    "name": "Juan Perez",
    "notify": "Juanito",
    "verifiedName": null,
    "imgUrl": "https://pps.whatsapp.net/v/t61.24694-24/...",
    "status": "Available 24/7"
}
```

---

## Chat Raw

Raw conversation object properties (`IChatRaw`).

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique chat JID |
| `name` | `string \| null` | Chat or group name |
| `displayName` | `string \| null` | Alternative display name |
| `description` | `string \| null` | Group description |
| `unreadCount` | `number \| null` | Unread message count |
| `readOnly` | `boolean \| null` | Whether the chat is read-only |
| `archived` | `boolean \| null` | Whether the chat is archived |
| `pinned` | `number \| null` | Pin timestamp |
| `muteEndTime` | `number \| null` | Mute expiration timestamp |
| `markedAsUnread` | `boolean \| null` | Whether manually marked as unread |
| `participant` | `IGroupParticipant[] \| null` | Group participant list |
| `createdBy` | `string \| null` | Group creator JID |
| `createdAt` | `number \| null` | Creation timestamp |
| `ephemeralExpiration` | `number \| null` | Ephemeral message duration (seconds) |

### IGroupParticipant

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Participant JID |
| `admin` | `string \| null` | Admin role: `null`, `"admin"`, `"superadmin"` |

### Raw Example

```json
{
    "id": "120363123456789@g.us",
    "name": "Development Team",
    "displayName": null,
    "description": "Project coordination group",
    "unreadCount": 5,
    "readOnly": false,
    "archived": false,
    "pinned": 1767371367857,
    "muteEndTime": null,
    "markedAsUnread": false,
    "createdAt": 1700000000,
    "createdBy": "584144709840@s.whatsapp.net",
    "participant": [
        { "id": "584144709840@s.whatsapp.net", "admin": "superadmin" },
        { "id": "584121234567@s.whatsapp.net", "admin": null }
    ],
    "ephemeralExpiration": 604800
}
```

---

## Message Raw

Raw message object properties. The library stores two parts: `IMessageIndex` (metadata) and `WAMessage` (full Baileys raw).

### MessageKey (key)

| Property | Type | Description |
|----------|------|-------------|
| `key.remoteJid` | `string \| null` | Chat JID |
| `key.fromMe` | `boolean \| null` | Whether the message is own |
| `key.id` | `string \| null` | Unique message ID |
| `key.participant` | `string \| null` | Sender JID (in groups) |

### Main Properties

| Property | Type | Description |
|----------|------|-------------|
| `message` | `Message \| null` | Message content (see Message Content) |
| `messageTimestamp` | `number \| null` | Creation timestamp |
| `status` | `MessageStatus \| null` | Delivery status (0-5) |
| `pushName` | `string \| null` | Sender name |
| `broadcast` | `boolean \| null` | Whether it's a broadcast message |
| `starred` | `boolean \| null` | Whether it's starred |
| `duration` | `number \| null` | Duration in seconds (audio/video) |
| `labels` | `string[] \| null` | Message labels |

### Message Statuses (status)

| Value | Constant | Description |
|-------|----------|-------------|
| `0` | `ERROR` | Send error |
| `1` | `PENDING` | Pending send |
| `2` | `SERVER_ACK` | Server acknowledged |
| `3` | `DELIVERED` | Delivered to recipient |
| `4` | `READ` | Read by recipient |
| `5` | `PLAYED` | Played (audio/video) |

### Media Properties

| Property | Type | Description |
|----------|------|-------------|
| `mediaCiphertextSha256` | `Uint8Array \| null` | SHA256 hash of encrypted media |
| `mediaData` | `MediaData \| null` | Media data |
| `quotedStickerData` | `MediaData \| null` | Quoted sticker data |

### Temporal Properties

| Property | Type | Description |
|----------|------|-------------|
| `ephemeralStartTimestamp` | `number \| null` | Expiration timer start |
| `ephemeralDuration` | `number \| null` | Duration until expiration (seconds) |
| `ephemeralOffToOn` | `boolean \| null` | Whether changed from off to on |
| `ephemeralOutOfSync` | `boolean \| null` | Whether out of sync |
| `revokeMessageTimestamp` | `number \| null` | Revocation timestamp |

### Reaction and Poll Properties

| Property | Type | Description |
|----------|------|-------------|
| `reactions` | `Reaction[] \| null` | Message reactions |
| `pollUpdates` | `PollUpdate[] \| null` | Poll updates |
| `pollAdditionalMetadata` | `PollAdditionalMetadata \| null` | Additional poll metadata |
| `messageSecret` | `Uint8Array \| null` | Secret for decrypting votes |

### Receipt Properties

| Property | Type | Description |
|----------|------|-------------|
| `userReceipt` | `UserReceipt[] \| null` | Per-user read receipts |
| `messageC2STimestamp` | `number \| null` | Client-to-server timestamp |

### Stub Properties (System Messages)

| Property | Type | Description |
|----------|------|-------------|
| `messageStubType` | `StubType \| null` | System message type |
| `messageStubParameters` | `string[] \| null` | Stub parameters |

### Business Properties

| Property | Type | Description |
|----------|------|-------------|
| `bizPrivacyStatus` | `BizPrivacyStatus \| null` | Business privacy status |
| `verifiedBizName` | `string \| null` | Verified business name |

### Status/History Properties

| Property | Type | Description |
|----------|------|-------------|
| `statusPsa` | `StatusPSA \| null` | Status PSA |
| `statusAlreadyViewed` | `boolean \| null` | Whether status was already viewed |
| `isMentionedInStatus` | `boolean \| null` | Whether mentioned in status |
| `statusMentions` | `string[] \| null` | JIDs mentioned in status |
| `statusMentionMessageInfo` | `StatusMentionMessage \| null` | Status mention message info |
| `statusMentionSources` | `string[] \| null` | Mention sources |

### Pin Properties

| Property | Type | Description |
|----------|------|-------------|
| `pinInChat` | `PinInChat \| null` | Pinned message info |
| `keepInChat` | `KeepInChat \| null` | Keep in chat |

### Bot/AI Properties

| Property | Type | Description |
|----------|------|-------------|
| `is1PBizBotMessage` | `boolean \| null` | Whether it's a 1P business bot message |
| `botMessageInvokerJid` | `string \| null` | JID that invoked the bot |
| `botTargetId` | `string \| null` | Bot target ID |
| `isSupportAiMessage` | `boolean \| null` | Whether it's a support AI message |
| `supportAiCitations` | `Citation[] \| null` | AI citations |
| `agentId` | `string \| null` | Agent ID |

### Internal Properties

| Property | Type | Description |
|----------|------|-------------|
| `ignore` | `boolean \| null` | Whether to ignore |
| `multicast` | `boolean \| null` | Whether multicast |
| `urlText` | `boolean \| null` | Whether contains text URL |
| `urlNumber` | `boolean \| null` | Whether contains number URL |
| `clearMedia` | `boolean \| null` | Whether to clear media |
| `photoChange` | `PhotoChange \| null` | Photo change |
| `futureproofData` | `Uint8Array \| null` | Future compatibility data |
| `isGroupHistoryMessage` | `boolean \| null` | Whether group history message |
| `originalSelfAuthorUserJidString` | `string \| null` | Original author JID |
| `premiumMessageInfo` | `PremiumMessageInfo \| null` | Premium message info |
| `commentMetadata` | `CommentMetadata \| null` | Comment metadata |
| `eventResponses` | `EventResponse[] \| null` | Event responses |
| `eventAdditionalMetadata` | `EventAdditionalMetadata \| null` | Additional event metadata |
| `reportingTokenInfo` | `ReportingTokenInfo \| null` | Reporting token info |
| `newsletterServerId` | `number \| null` | Newsletter server ID |
| `targetMessageId` | `MessageKey \| null` | Target message ID |
| `messageAddOns` | `MessageAddOn[] \| null` | Message add-ons |
| `paymentInfo` | `PaymentInfo \| null` | Payment info |
| `quotedPaymentInfo` | `PaymentInfo \| null` | Quoted payment info |
| `finalLiveLocation` | `LiveLocationMessage \| null` | Final live location |

### Raw Example

```json
{
    "key": {
        "remoteJid": "584144709840@s.whatsapp.net",
        "fromMe": false,
        "id": "AC07DE0D18FA8254897A26C90B2FFD98",
        "participant": null
    },
    "message": {
        "extendedTextMessage": {
            "text": "Hello world",
            "contextInfo": {
                "stanzaId": "AC9BE0D81D965A3C240B6ACAA891C6FD",
                "participant": "584121234567@s.whatsapp.net",
                "isForwarded": false,
                "forwardingScore": 0,
                "expiration": 604800
            }
        }
    },
    "messageTimestamp": 1767366759,
    "status": 4,
    "pushName": "Juan Perez",
    "broadcast": false,
    "starred": false,
    "duration": null,
    "labels": [],
    "ephemeralStartTimestamp": 1767366759,
    "ephemeralDuration": 604800,
    "reactions": [
        { "text": "❤️", "groupingKey": "❤️", "senderTimestampMs": 1767366800000 }
    ],
    "userReceipt": [
        { "userJid": "584144709840@s.whatsapp.net", "readTimestamp": 1767366800 }
    ]
}
```

---

## Message Content

Content types inside `message`.

### Text

| Property | Type | Description |
|----------|------|-------------|
| `conversation` | `string` | Simple text |
| `extendedTextMessage.text` | `string` | Text with metadata |
| `extendedTextMessage.contextInfo` | `ContextInfo` | Context information |

### Media

| Property | Type | Description |
|----------|------|-------------|
| `imageMessage` | `ImageMessage` | Image message |
| `videoMessage` | `VideoMessage` | Video message |
| `audioMessage` | `AudioMessage` | Audio message |
| `documentMessage` | `DocumentMessage` | Document message |
| `stickerMessage` | `StickerMessage` | Sticker message |

### Media Properties (common)

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string` | Download URL (temporary) |
| `directPath` | `string` | Direct CDN path |
| `mediaKey` | `Uint8Array` | Decryption key |
| `mimetype` | `string` | MIME type |
| `fileLength` | `number` | Size in bytes |
| `fileSha256` | `Uint8Array` | File SHA256 hash |
| `fileEncSha256` | `Uint8Array` | Encrypted SHA256 hash |
| `mediaKeyTimestamp` | `number` | Key timestamp |
| `jpegThumbnail` | `Uint8Array` | JPEG thumbnail in base64 |
| `caption` | `string` | Media caption |
| `width` | `number` | Width in pixels |
| `height` | `number` | Height in pixels |
| `seconds` | `number` | Duration (audio/video) |
| `ptt` | `boolean` | Push-to-talk (voice note) |
| `waveform` | `Uint8Array` | Audio waveform |
| `streamingSidecar` | `Uint8Array` | Streaming data |

### Location

| Property | Type | Description |
|----------|------|-------------|
| `locationMessage.degreesLatitude` | `number` | Latitude |
| `locationMessage.degreesLongitude` | `number` | Longitude |
| `liveLocationMessage.degreesLatitude` | `number` | Live latitude |
| `liveLocationMessage.degreesLongitude` | `number` | Live longitude |
| `liveLocationMessage.sequenceNumber` | `number` | Sequence number |
| `liveLocationMessage.caption` | `string` | Location caption |

### Poll

| Property | Type | Description |
|----------|------|-------------|
| `pollCreationMessage.name` | `string` | Poll question |
| `pollCreationMessage.options` | `Option[]` | Answer options |
| `pollCreationMessage.selectableOptionsCount` | `number` | Selectable count |
| `pollUpdateMessage.pollCreationMessageKey` | `MessageKey` | Poll reference |
| `pollUpdateMessage.vote` | `PollEncValue` | Encrypted vote |

### Reaction

| Property | Type | Description |
|----------|------|-------------|
| `reactionMessage.key` | `MessageKey` | Message being reacted to |
| `reactionMessage.text` | `string` | Reaction emoji |
| `reactionMessage.senderTimestampMs` | `number` | Sender timestamp |

### Protocol

| Property | Type | Description |
|----------|------|-------------|
| `protocolMessage.type` | `ProtocolMessageType` | Protocol type |
| `protocolMessage.key` | `MessageKey` | Target message |
| `protocolMessage.editedMessage` | `Message` | Edited message |
| `protocolMessage.timestampMs` | `number` | Action timestamp |

### ProtocolMessage Types

| Value | Constant | Description |
|-------|----------|-------------|
| `0` | `REVOKE` | Delete message |
| `3` | `EPHEMERAL_SETTING` | Configure ephemeral messages |
| `6` | `EPHEMERAL_SYNC_RESPONSE` | Sync response |
| `7` | `HISTORY_SYNC_NOTIFICATION` | History notification |
| `14` | `MESSAGE_EDIT` | Edit message |

### ContextInfo

| Property | Type | Description |
|----------|------|-------------|
| `stanzaId` | `string` | Quoted message ID |
| `participant` | `string` | Quoted message author |
| `quotedMessage` | `Message` | Quoted message content |
| `isForwarded` | `boolean` | Whether forwarded |
| `forwardingScore` | `number` | Times forwarded |
| `expiration` | `number` | Seconds until expiration |
| `ephemeralSettingTimestamp` | `number` | Configuration timestamp |
| `mentionedJid` | `string[]` | Mentioned JIDs |

---

# API Schemas

Simplified schemas exposed by classes.

---

## Contact

| Property | Type | Raw Source | Description |
|----------|------|------------|-------------|
| `id` | `string` | `id` | Unique contact JID |
| `name` | `string` | `name \|\| notify \|\| id.split("@")[0]` | Contact name |
| `photo` | `string \| null` | `imgUrl` | Profile picture URL |
| `phone` | `string` | `id.split("@")[0]` | Phone number |
| `content` | `string` | `status \|\| ""` | Contact bio |

### Storage Key

```
contact/{id}/index
```

**Stored format**: `IContactRaw` JSON (id, lid, name, notify, verifiedName, imgUrl, status).

---

## Chat

| Property | Type | Raw Source | Description |
|----------|------|------------|-------------|
| `id` | `string` | `id` | Unique chat JID |
| `type` | `"contact" \| "group"` | Derived from `id` | Chat type |
| `name` | `string` | `name \|\| displayName \|\| id.split("@")[0]` | Chat name |
| `content` | `string` | `description \|\| ""` | Description |
| `pinned` | `boolean` | `pinned !== null` | Whether pinned |
| `archived` | `boolean` | `archived \|\| false` | Whether archived |
| `muted` | `number` | `muteEndTime \|\| 0` | Mute end timestamp (0 if unmuted) |
| `read` | `boolean` | `unreadCount === 0 && !markedAsUnread` | Whether read |
| `readonly` | `boolean` | `readOnly \|\| false` | Whether read-only |

### Storage Key

```
chat/{id}/index
```

**Stored format**: `IChatRaw` JSON (id, name, displayName, description, unreadCount, readOnly, archived, pinned, muteEndTime, markedAsUnread, participant, createdBy, createdAt, ephemeralExpiration).

---

## Message

### IMessageIndex (stored in `chat/{cid}/message/{id}/index`)

| Property | Type | Raw Source | Description |
|----------|------|------------|-------------|
| `id` | `string` | `key.id` | Unique ID |
| `cid` | `string` | `key.remoteJidAlt \|\| key.remoteJid` | Chat ID |
| `mid` | `string \| null` | `contextInfo.stanzaId` | Parent message |
| `me` | `boolean` | `key.fromMe` | Whether own message |
| `type` | `MessageType` | Derived from `message` | Message type |
| `author` | `string` | `key.participant \|\| key.remoteJid` (uses `\|\|` not `??`) | Author |
| `status` | `MESSAGE_STATUS` | `status` | Delivery status |
| `starred` | `boolean` | `starred` | Whether starred |
| `forwarded` | `boolean` | `contextInfo.isForwarded` | Whether forwarded |
| `created_at` | `number` | `messageTimestamp * 1000` | Creation (ms) |
| `deleted_at` | `number \| null` | `ephemeralStartTimestamp + ephemeralDuration` | Expiration |
| `mime` | `string` | Derived from `message` | MIME type |
| `caption` | `string` | `*.caption \|\| ""` | Caption |
| `edited` | `boolean` | Set on edit | Whether edited |

### Instance methods

| Method | Return Type | Description |
|--------|-------------|-------------|
| `content()` | `Promise<Buffer>` | Gets message content as Buffer (async) |
| `stream()` | `Promise<Readable>` | Gets content as Readable stream (async) |
| `react(emoji)` | `Promise<boolean>` | Reacts to the message |
| `edit(text)` | `Promise<boolean>` | Edits the message (own messages only) |
| `remove()` | `Promise<boolean>` | Deletes the message for everyone |
| `forward(to_cid)` | `Promise<boolean>` | Forwards to another chat |
| `text(content)` | `Promise<Message \| null>` | Replies with text |
| `image(buffer, caption?)` | `Promise<Message \| null>` | Replies with image |
| `video(buffer, caption?)` | `Promise<Message \| null>` | Replies with video |
| `audio(buffer, ptt?)` | `Promise<Message \| null>` | Replies with audio |
| `location(opts)` | `Promise<Message \| null>` | Replies with location |
| `poll(opts)` | `Promise<Message \| null>` | Replies with poll |

### Storage

| Key | Content |
|-----|---------|
| `chat/{cid}/message/{id}/index` | JSON with IMessageIndex metadata |
| `chat/{cid}/message/{id}/content` | Buffer base64 |
| `chat/{cid}/message/{id}/raw` | Full WAMessage raw (for forward, re-download) |

---

## Field Summary

| Entity | API Getters | Raw Fields (IChatRaw/IContactRaw) |
|--------|-------------|-----------------------------------|
| **Contact** | 5 (id, name, photo, phone, content) | 7 (id, lid, name, notify, verifiedName, imgUrl, status) |
| **Chat** | 9 (id, type, name, content, pinned, archived, muted, read, readonly) | 14 |
| **Message** | 14 index fields + async methods | WAMessage (50+) |

---

# Storage Guidelines

Storage strategies for different backends.

---

## Primary Fields (Columns/Indexes)

Scalar fields used for filters/searches:

| Entity | Primary Fields |
|--------|----------------|
| **Contact** | `id` |
| **Chat** | `id`, `archived`, `pinned`, `muteEndTime` |
| **Message** | `id`, `cid`, `me`, `author`, `status`, `created_at`, `starred` |

---

## NoSQL Strategy (Key-Value)

For FileEngine, RedisEngine, or other key-value stores.

### Key Structure

```
contact/{id}/index          -> IContactRaw JSON
lid/{lid}                   -> JID string
chat/{id}/index             -> IChatRaw JSON
chat/{cid}/messages         -> Message index text file
chat/{cid}/message/{id}/index   -> IMessageIndex JSON
chat/{cid}/message/{id}/content -> Buffer base64
chat/{cid}/message/{id}/raw     -> WAMessage JSON
```

### Storage Format

```json
// contact/{id}/index -- stores IContactRaw
{
    "id": "584144709840@s.whatsapp.net",
    "lid": "140913951141911@lid",
    "name": "Juan Perez",
    "notify": "Juanito",
    "verifiedName": null,
    "imgUrl": "https://...",
    "status": "Available"
}

// chat/{id}/index -- stores IChatRaw
{
    "id": "120363123456789@g.us",
    "name": "Dev Team",
    "displayName": null,
    "description": "Group description",
    "unreadCount": 5,
    "readOnly": false,
    "archived": false,
    "pinned": 1767371367857,
    "muteEndTime": null,
    "markedAsUnread": false,
    "participant": [
        { "id": "584144709840@s.whatsapp.net", "admin": "superadmin" }
    ],
    "createdBy": "584144709840@s.whatsapp.net",
    "createdAt": 1700000000,
    "ephemeralExpiration": 604800
}

// chat/{cid}/message/{id}/index -- stores IMessageIndex
{
    "id": "AC07DE0D18FA8254897A26C90B2FFD98",
    "cid": "584144709840@s.whatsapp.net",
    "mid": null,
    "me": false,
    "type": "text",
    "author": "584144709840@s.whatsapp.net",
    "status": 4,
    "starred": false,
    "forwarded": false,
    "created_at": 1767366759000,
    "deleted_at": null,
    "mime": "text/plain",
    "caption": "",
    "edited": false
}
```

### Advantages

- **Simplicity**: Everything is JSON, no migrations
- **Atomicity**: One record = one key
- **Flexibility**: Add fields without altering structure

### Considerations

**Listings and Filters:**
```
# List contacts
engine.list("contact/")

# List messages of a chat
Read chat/{cid}/messages index, then fetch each message

# Filter starred messages
Requires iterating and filtering in memory
```

**Cleanup (Cascade Delete):**
```
# Delete chat and all its messages
engine.set("chat/{cid}", null)
# The engine cascade-deletes all sub-keys: chat/{cid}/*
```

**Orphan Data:**
- When deleting chat: `set("chat/{cid}", null)` removes all keys with prefix `chat/{cid}/`
- When deleting contact: `set("contact/{id}/index", null)` (no dependencies)

---

## SQL Strategy (Relational)

For PostgreSQL, MySQL, SQLite.

### Table Schema

```sql
-- Contacts (stores IContactRaw fields)
CREATE TABLE contacts (
    id VARCHAR(50) PRIMARY KEY,
    lid VARCHAR(50),
    name VARCHAR(255),
    notify VARCHAR(255),
    verified_name VARCHAR(255),
    img_url TEXT,
    status TEXT
);

-- Chats (stores IChatRaw fields)
CREATE TABLE chats (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255),
    display_name VARCHAR(255),
    description TEXT,
    unread_count INTEGER,
    read_only BOOLEAN DEFAULT FALSE,
    archived BOOLEAN DEFAULT FALSE,
    pinned BIGINT,  -- timestamp or NULL
    mute_end_time BIGINT,  -- timestamp or NULL
    marked_as_unread BOOLEAN DEFAULT FALSE,
    created_by VARCHAR(50),
    created_at BIGINT,
    ephemeral_expiration INTEGER
);

-- Group participants
CREATE TABLE chat_participants (
    chat_id VARCHAR(50) REFERENCES chats(id) ON DELETE CASCADE,
    contact_id VARCHAR(50),
    admin VARCHAR(20),  -- NULL, 'admin', 'superadmin'
    PRIMARY KEY (chat_id, contact_id)
);

-- Messages (stores IMessageIndex fields)
CREATE TABLE messages (
    id VARCHAR(50),
    cid VARCHAR(50) REFERENCES chats(id) ON DELETE CASCADE,
    mid VARCHAR(50),  -- parent message (reply)
    me BOOLEAN NOT NULL,
    type VARCHAR(20) NOT NULL,
    author VARCHAR(50) NOT NULL,
    status SMALLINT DEFAULT 1,
    starred BOOLEAN DEFAULT FALSE,
    forwarded BOOLEAN DEFAULT FALSE,
    created_at BIGINT NOT NULL,
    deleted_at BIGINT,
    mime VARCHAR(100),
    caption TEXT,
    edited BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (cid, id)
);

-- Message content (separated for efficiency)
CREATE TABLE message_contents (
    cid VARCHAR(50),
    message_id VARCHAR(50),
    content BYTEA,
    raw JSONB,
    PRIMARY KEY (cid, message_id),
    FOREIGN KEY (cid, message_id) REFERENCES messages(cid, id) ON DELETE CASCADE
);

-- Reactions
CREATE TABLE message_reactions (
    cid VARCHAR(50),
    message_id VARCHAR(50),
    reactor_id VARCHAR(50),
    emoji VARCHAR(10),
    timestamp BIGINT,
    PRIMARY KEY (cid, message_id, reactor_id),
    FOREIGN KEY (cid, message_id) REFERENCES messages(cid, id) ON DELETE CASCADE
);
```

### Recommended Indexes

```sql
-- Frequent searches
CREATE INDEX idx_messages_chat ON messages(cid);
CREATE INDEX idx_messages_created ON messages(cid, created_at DESC);
CREATE INDEX idx_messages_author ON messages(author);
CREATE INDEX idx_messages_starred ON messages(cid, starred) WHERE starred = TRUE;

-- Chat filters
CREATE INDEX idx_chats_archived ON chats(archived) WHERE archived = TRUE;
CREATE INDEX idx_chats_pinned ON chats(pinned) WHERE pinned IS NOT NULL;
```

### Advantages

- **Integrity**: Foreign keys guarantee consistency
- **Cascade Delete**: `ON DELETE CASCADE` cleans automatically
- **Efficient Filters**: Indexes on search fields
- **Joins**: Relate data without multiple queries

### Common Queries

```sql
-- Chat messages sorted
SELECT * FROM messages WHERE cid = ? ORDER BY created_at DESC LIMIT 50;

-- Starred messages from user
SELECT * FROM messages WHERE me = TRUE AND starred = TRUE;

-- Chats with unread messages
SELECT * FROM chats WHERE unread_count > 0 OR marked_as_unread = TRUE;

-- Delete chat (cascade deletes messages, reactions, etc.)
DELETE FROM chats WHERE id = ?;
```

---

## Comparison

| Aspect | NoSQL (Key-Value) | SQL (Relational) |
|--------|-------------------|------------------|
| **Setup** | Minimal | Requires migrations |
| **Filters** | In memory | Native indexes |
| **Joins** | N queries | 1 query |
| **Cascade Delete** | Via `set(key, null)` | Automatic |
| **Schema Flexibility** | High | Requires ALTER |
| **Orphan Data** | Possible if contract not followed | Impossible |
| **Scalability** | Horizontal | Vertical |

---

## Recommendations by Use Case

### Simple Bot / Prototype
- **Backend**: FileEngine (JSON files)
- **Reason**: Zero setup, easy debugging

### Production Bot (< 100k messages)
- **Backend**: SQLite + FileEngine (content)
- **Reason**: Balance between performance and simplicity

### Production Bot (> 100k messages)
- **Backend**: PostgreSQL + Redis (cache)
- **Reason**: Indexes, cascade delete, complex queries

### Multi-tenant / SaaS
- **Backend**: PostgreSQL with partitioning by `cid`
- **Reason**: Data isolation, per-tenant cleanup

---

## Orphan Data Prevention

### Principle

> When deleting a parent entity, ALWAYS delete its dependencies.

### Deletion Cascade

```
Delete Contact:
+-- contact/{id}/index

Delete Chat (via set("chat/{cid}", null)):
|-- chat/{id}/index
|-- chat/{id}/messages
|-- chat/{id}/message/*/index
|-- chat/{id}/message/*/content
|-- chat/{id}/message/*/raw
+-- (SQL) chat_participants, messages, message_contents, message_reactions

Delete Message (via set("chat/{cid}/message/{mid}", null)):
|-- chat/{cid}/message/{id}/index
|-- chat/{cid}/message/{id}/content
+-- chat/{cid}/message/{id}/raw
    (SQL) message_contents, message_reactions
```

### Implementation

Cascade delete is handled by the Engine's `set(key, null)` contract. The library calls:

```typescript
// Delete chat and all its content
await wa.Chat.remove(cid);
// or
const chat = await wa.Chat.get(cid);
await chat.remove();

// Internally calls:
// await wa.engine.set("chat/{cid}", null);
// which cascade-deletes all sub-keys
```
