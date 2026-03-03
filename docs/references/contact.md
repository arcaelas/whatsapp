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

## IContactRaw

Raw contact object stored in the engine:

```typescript
interface IContactRaw {
  id: string;
  lid?: string | null;
  name?: string | null;
  notify?: string | null;
  verifiedName?: string | null;
  imgUrl?: string | null;
  status?: string | null;
}
```

---

## Properties

Each Contact instance has the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Contact ID (JID) |
| `name` | `string` | Contact name (fallback chain: `raw.name` -> `raw.notify` -> phone from JID) |
| `phone` | `string` | Phone number extracted from JID |
| `photo` | `string \| null` | Profile photo URL or `null` |
| `content` | `string` | Contact bio/status (empty string if not set) |
| `raw` | `IContactRaw` | Raw contact data |

### rename()

Renames a contact by ID. Delegates to the instance method internally.

```typescript
const success = await wa.Contact.rename(uid: string, name: string): Promise<boolean>
```

**Example:**

```typescript
await wa.Contact.rename("5491112345678@s.whatsapp.net", "John Work");
```

### refresh()

Refreshes a contact's data from WhatsApp by ID. Delegates to the instance method internally.

```typescript
const contact = await wa.Contact.refresh(uid: string): Promise<Contact | null>
```

**Example:**

```typescript
const contact = await wa.Contact.refresh("5491112345678@s.whatsapp.net");
if (contact) {
  console.log("Updated photo:", contact.photo);
}
```

---

## Instance methods

### rename()

Renames a contact locally. Returns `true` if the contact existed in storage and was updated, `false` otherwise.

```typescript
await contact.rename(name: string): Promise<boolean>
```

**Example:**

```typescript
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");
if (contact) {
  const success = await contact.rename("John Work");
  console.log("Renamed:", success);
}
```

### refresh()

Refreshes profile data (photo and bio) from WhatsApp. Returns `this` on success, `null` if no socket is available.

```typescript
await contact.refresh(): Promise<this | null>
```

**Example:**

```typescript
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");
if (contact) {
  const refreshed = await contact.refresh();
  if (refreshed) {
    console.log("Updated photo:", refreshed.photo);
    console.log("Updated bio:", refreshed.content);
  }
}
```

### chat()

Gets or creates the chat associated with this contact.

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

Gets a specific contact. Accepts JID (`{phone}@s.whatsapp.net`), plain phone number, or LID (`{id}@lid`). When a LID is provided, it resolves to the actual JID via a reverse index (`lid/{lid}` key in the engine).

```typescript
const contact = await wa.Contact.get(uid: string): Promise<Contact | null>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `uid` | `string` | JID, phone number, or LID |

**Example:**

```typescript
// By JID
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");

// By phone number (auto-appends @s.whatsapp.net)
const contact = await wa.Contact.get("5491112345678");

// By LID (resolves via reverse index)
const contact = await wa.Contact.get("123456@lid");

if (contact) {
  console.log(`Name: ${contact.name}`);
  console.log(`Phone: ${contact.phone}`);
  console.log(`Photo: ${contact.photo ?? "No photo"}`);
  console.log(`Bio: ${contact.content}`);
}
```

### list()

Lists contacts with pagination.

```typescript
const contacts = await wa.Contact.list(offset?: number, limit?: number): Promise<Contact[]>
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `offset` | `number` | `0` | Starting position |
| `limit` | `number` | `50` | Maximum contacts |

**Example:**

```typescript
// Get first 100 contacts
const contacts = await wa.Contact.list(0, 100);
console.log(`Total contacts: ${contacts.length}`);

for (const contact of contacts) {
  console.log(`- ${contact.name}: ${contact.phone}`);
}

// Paginate
let page = 0;
const page_size = 50;
let all_contacts: typeof contacts = [];

while (true) {
  const batch = await wa.Contact.list(page * page_size, page_size);
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
| `{id}@lid` | Alternative contact ID (LID) | `123456@lid` |

LID identifiers are stored with a reverse index (`lid/{lid}` -> JID) so that `Contact.get()` can resolve them to the actual JID.

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

// Search and rename contacts
async function organize_contacts() {
  const contacts = await wa.Contact.list(0, 1000);

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

  const contact = await wa.Contact.get(msg.cid);

  if (contact) {
    console.log(`Message from: ${contact.name}`);
    console.log(`Bio: ${contact.content}`);
  } else {
    const phone = msg.cid.split("@")[0];
    console.log(`Message from: ${phone} (unknown)`);
  }
});
```
