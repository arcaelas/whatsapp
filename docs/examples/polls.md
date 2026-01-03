# Polls

Examples of creating and handling polls.

---

## Create poll

```typescript
// Simple poll
await wa.Message.poll("123456789@g.us", {
  content: "What's your favorite color?",
  options: [
    { content: "Red" },
    { content: "Blue" },
    { content: "Green" },
    { content: "Yellow" }
  ]
});
```

---

## Read poll data

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.type !== "poll") return;

  // Poll content is JSON
  const buffer = await msg.content();
  const poll = JSON.parse(buffer.toString()) as {
    content: string;
    options: Array<{ content: string }>;
  };

  console.log(`Poll: ${poll.content}`);
  console.log("Options:");
  poll.options.forEach((opt, i) => {
    console.log(`  ${i + 1}. ${opt.content}`);
  });
});
```

---

## Poll bot

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "text") return;

  const text = (await msg.content()).toString();

  // Command: !poll Question | Option1 | Option2 | ...
  if (text.startsWith("!poll ")) {
    const content = text.slice(6);
    const parts = content.split("|").map(s => s.trim());

    if (parts.length < 3) {
      await wa.Message.text(
        msg.cid,
        "Usage: !poll Question | Option1 | Option2 | ...\n\n" +
        "Example:\n" +
        "!poll What should we eat? | Pizza | Sushi | Burger"
      );
      return;
    }

    const [question, ...options] = parts;

    if (options.length > 12) {
      await wa.Message.text(msg.cid, "Maximum 12 options allowed");
      return;
    }

    await wa.Message.poll(msg.cid, {
      content: question,
      options: options.map(opt => ({ content: opt }))
    });

    await wa.Message.text(msg.cid, `Poll created: "${question}"`);
  }
});
```

---

## Timed poll

```typescript
async function create_timed_poll(
  wa: WhatsApp,
  chat_id: string,
  question: string,
  options: string[],
  duration_minutes: number
) {
  // Create poll
  const poll_msg = await wa.Message.poll(chat_id, {
    content: question,
    options: options.map(opt => ({ content: opt }))
  });

  if (!poll_msg) return;

  await wa.Message.text(chat_id, `Poll active for ${duration_minutes} minutes`);

  // Wait duration
  await new Promise(r => setTimeout(r, duration_minutes * 60 * 1000));

  // Announce end
  await wa.Message.text(chat_id, `*Poll ended!*\n\nCheck results in the poll.`);
}

// Usage
await create_timed_poll(
  wa,
  "123456789@g.us",
  "What movie should we watch?",
  ["Action", "Comedy", "Horror", "Drama"],
  5 // 5 minutes
);
```

---

## Important notes

!!! info "Option limit"
    WhatsApp allows maximum 12 options per poll.

!!! warning "Vote visibility"
    Votes on WhatsApp are anonymous. You can only see total count, not who voted.

!!! tip "Polls in groups"
    Polls work best in groups where there are more participants.
