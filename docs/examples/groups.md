# Group Management

Examples of working with WhatsApp groups.

---

## Get group information

```typescript
const chat = await wa.Chat.get("123456789@g.us");

if (chat && chat.type === "group") {
  console.log(`Name: ${chat.name}`);
  console.log(`ID: ${chat.id}`);

  // Members
  const members = await chat.members(0, 1000);
  console.log(`Members: ${members.length}`);

  for (const member of members) {
    console.log(`  - ${member.name} (${member.phone})`);
  }
}
```

---

## Detect groups in events

```typescript
wa.event.on("chat:created", (chat) => {
  if (chat.type === "group") {
    console.log(`Group created: ${chat.name}`);
  }
});

wa.event.on("message:created", async (msg) => {
  // Check if message is from a group
  const is_group = msg.cid.endsWith("@g.us");

  if (is_group) {
    console.log(`Message in group: ${msg.cid}`);
  }
});
```

---

## Send messages to groups

```typescript
// Send text to a group
await wa.Message.text("123456789@g.us", "Hello group!");

// Send image to a group
import * as fs from "fs";
const img = fs.readFileSync("photo.jpg");
await wa.Message.image("123456789@g.us", img, "Photo for the group");

// Create poll in group
await wa.Message.poll("123456789@g.us", {
  content: "Where should we meet?",
  options: [
    { content: "At my place" },
    { content: "At the park" },
    { content: "Downtown" }
  ]
});
```

---

## Reply in groups

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me) return;

  // Only process group messages
  if (!msg.cid.endsWith("@g.us")) return;

  if (msg.type !== "text") return;

  const text = (await msg.content()).toString().toLowerCase();

  // Reply
  if (text.includes("hello")) {
    await wa.Message.text(msg.cid, "Hello! Welcome to the group");
  }
});
```

---

## Get group members

```typescript
const group_id = "123456789@g.us";
const chat = await wa.Chat.get(group_id);

if (chat) {
  const members = await chat.members(0, 1000);

  console.log(`Group has ${members.length} members:`);
  for (const member of members) {
    console.log(`  - ${member.name}: ${member.phone}`);
  }
}
```

---

## Export members to JSON

```typescript
import * as fs from "fs";

async function export_group_members(wa: WhatsApp, group_id: string) {
  const chat = await wa.Chat.get(group_id);
  if (!chat || chat.type !== "group") {
    throw new Error("Group not found");
  }

  const members = await chat.members(0, 10000);

  const data = {
    group: {
      id: chat.id,
      name: chat.name,
    },
    exported_at: new Date().toISOString(),
    members: members.map(m => ({
      id: m.id,
      phone: m.phone,
      name: m.name,
    })),
  };

  const filename = `group_${chat.name.replace(/[^a-z0-9]/gi, "_")}.json`;
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));

  console.log(`Exported ${members.length} members to ${filename}`);
}
```

---

## Command bot for groups

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "text") return;

  // Only in groups
  if (!msg.cid.endsWith("@g.us")) return;

  const text = (await msg.content()).toString();
  if (!text.startsWith("!")) return;

  const [cmd] = text.slice(1).split(" ");

  switch (cmd.toLowerCase()) {
    case "info":
      const chat = await wa.Chat.get(msg.cid);
      if (chat) {
        const members = await chat.members(0, 1000);
        await wa.Message.text(
          msg.cid,
          `*${chat.name}*\n\n` +
          `ID: ${chat.id}\n` +
          `Members: ${members.length}`
        );
      }
      break;

    case "members":
      const group_chat = await wa.Chat.get(msg.cid);
      if (group_chat) {
        const group_members = await group_chat.members(0, 50);
        const list = group_members.map(m => `- ${m.name}`).join("\n");
        await wa.Message.text(msg.cid, `*Members:*\n${list}`);
      }
      break;
  }
});
```

---

## Notes

!!! info "Group JID"
    Groups have JID format `{id}@g.us`

!!! tip "Differentiation"
    Use `chat.type === "group"` or `cid.endsWith("@g.us")` to detect groups
