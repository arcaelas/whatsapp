# Contact

Class for contact management.

---

## Import

The Contact class is accessed through the WhatsApp instance:

```typescript
const wa = new WhatsApp();
// wa.Contact is available after instantiation
```

---

## Properties

Each Contact instance has the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Contact ID (JID) |
| `me` | `boolean` | `true` if it's the connected account |
| `name` | `string` | Contact name |
| `phone` | `string` | Phone number |
| `photo` | `string \| undefined` | Profile photo URL |

---

## Instance methods

### rename()

Renames a contact locally.

```typescript
await contact.rename(name: string): Promise<void>
```

**Example:**

```typescript
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");
if (contact) {
  await contact.rename("John Work");
}
```

### chat()

Gets the chat associated with this contact.

```typescript
const chat = await contact.chat(): Promise<Chat | null>
```

**Example:**

```typescript
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");
if (contact) {
  const chat = await contact.chat();
  if (chat) {
    console.log(`Chat with ${contact.name}: ${chat.id}`);
  }
}
```

---

## Static methods

### get()

Gets a specific contact.

```typescript
const contact = await wa.Contact.get(jid: string): Promise<Contact | null>
```

**Example:**

```typescript
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");
if (contact) {
  console.log(`Name: ${contact.name}`);
  console.log(`Phone: ${contact.phone}`);
  console.log(`Photo: ${contact.photo || "No photo"}`);
}
```

### rename()

Renames a contact by JID.

```typescript
await wa.Contact.rename(jid: string, name: string): Promise<void>
```

**Example:**

```typescript
await wa.Contact.rename("5491112345678@s.whatsapp.net", "John Work");
```

### paginate()

Lists contacts with pagination.

```typescript
const contacts = await wa.Contact.paginate(
  offset?: number,
  limit?: number
): Promise<Contact[]>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `offset` | `number` | `0` | Starting position |
| `limit` | `number` | `50` | Maximum contacts |

**Example:**

```typescript
// Get first 100 contacts
const contacts = await wa.Contact.paginate(0, 100);
console.log(`Total contacts: ${contacts.length}`);

for (const contact of contacts) {
  console.log(`- ${contact.name}: ${contact.phone}`);
}

// Paginate
let page = 0;
const page_size = 50;
let all_contacts: Contact[] = [];

while (true) {
  const batch = await wa.Contact.paginate(page * page_size, page_size);
  if (batch.length === 0) break;
  all_contacts = [...all_contacts, ...batch];
  page++;
}
```

---

## JID formats

WhatsApp uses different JID formats:

| Format | Description | Example |
|--------|-------------|---------|
| `{phone}@s.whatsapp.net` | Individual user | `5491112345678@s.whatsapp.net` |
| `{id}@g.us` | Group | `123456789@g.us` |
| `{phone}@lid` | Linked device | `5491112345678@lid` |

---

## Complete example

```typescript
// Handle new contacts
wa.event.on("contact:created", (contact) => {
  console.log(`New contact: ${contact.name} (${contact.phone})`);
});

// Handle contact updates
wa.event.on("contact:updated", (contact) => {
  console.log(`Contact updated: ${contact.name}`);
});

// Search and rename contact
async function organize_contacts() {
  const contacts = await wa.Contact.paginate(0, 1000);

  for (const contact of contacts) {
    // Add prefix to contacts without custom name
    if (contact.name === contact.phone) {
      await contact.rename(`Contact ${contact.phone}`);
    }
  }
}

// Get contact info when receiving message
wa.event.on("message:created", async (msg) => {
  if (msg.me) return;

  // Extract phone from JID
  const phone = msg.cid.split("@")[0];
  const contact = await wa.Contact.get(msg.cid);

  if (contact) {
    console.log(`Message from: ${contact.name}`);
  } else {
    console.log(`Message from: ${phone} (unknown)`);
  }
});
```
