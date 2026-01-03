# Getting Started

This tutorial will guide you step by step to create your first WhatsApp bot.

---

## 1. Create the project

```bash
mkdir my-whatsapp-bot
cd my-whatsapp-bot
npm init -y
npm install @arcaelas/whatsapp typescript tsx
```

---

## 2. Basic structure

Create the main file:

```typescript title="index.ts"
import { WhatsApp } from "@arcaelas/whatsapp";

async function main() {
  // Create WhatsApp instance
  const wa = new WhatsApp();

  // Listen to events before connecting
  wa.event.on("open", () => console.log("Connected!"));
  wa.event.on("close", () => console.log("Disconnected"));
  wa.event.on("error", (err) => console.error("Error:", err.message));

  // Connect showing QR in console
  console.log("Waiting for QR...");
  await wa.pair(async (data) => {
    if (Buffer.isBuffer(data)) {
      // Save QR as image
      const fs = await import("fs");
      fs.writeFileSync("qr.png", data);
      console.log("QR saved to qr.png - Scan with your phone");
    } else {
      // 8 digit code (if using phone)
      console.log("Pairing code:", data);
    }
  });

  console.log("Bot started!");
}

main().catch(console.error);
```

---

## 3. Run

```bash
npx tsx index.ts
```

1. The `qr.png` file will appear
2. Open it and scan with WhatsApp > Linked devices
3. The bot will connect automatically

!!! success "Done!"
    Once connected, the session is saved in `.baileys/default/` and you won't need to scan again.

---

## 4. Listen to messages

Add a listener for incoming messages:

```typescript title="index.ts" hl_lines="20-35"
import { WhatsApp } from "@arcaelas/whatsapp";

async function main() {
  const wa = new WhatsApp();

  // Listen to new messages
  wa.event.on("message:created", async (msg) => {
    // Ignore own messages
    if (msg.me) return;

    // Only process text
    if (msg.type !== "text") return;

    // Get content as text
    const content = (await msg.content()).toString();
    console.log(`[${msg.type}] ${msg.cid}: ${content}`);

    const text = content.toLowerCase();

    if (text === "hello") {
      await wa.Message.text(msg.cid, "Hello! I'm a bot. Type 'help' to see commands.");
    }

    if (text === "help") {
      await wa.Message.text(
        msg.cid,
        "Available commands:\n" +
        "- hello: Greeting\n" +
        "- time: Current time\n" +
        "- ping: Response test"
      );
    }

    if (text === "time") {
      await wa.Message.text(msg.cid, `It's ${new Date().toLocaleTimeString()}`);
    }

    if (text === "ping") {
      await wa.Message.text(msg.cid, "pong!");
    }
  });

  // Connect
  await wa.pair(async (data) => {
    if (Buffer.isBuffer(data)) {
      require("fs").writeFileSync("qr.png", data);
      console.log("Scan qr.png");
    }
  });

  console.log("Bot ready!");
}

main().catch(console.error);
```

---

## 5. Connection with pairing code

If you prefer not to scan QR, use the phone number:

```typescript
const wa = new WhatsApp({
  phone: "5491112345678", // Without + or spaces
});

await wa.pair(async (data) => {
  if (typeof data === "string") {
    console.log("Enter this code on your phone:", data);
    // Go to WhatsApp > Linked devices > Link a device
    // Select "Link with phone number"
  }
});
```

---

## 6. Handle different message types

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me) return;

  const buffer = await msg.content();

  // Text message
  if (msg.type === "text") {
    const text = buffer.toString();
    console.log("Text:", text);
  }

  // Image
  if (msg.type === "image") {
    console.log(`Image: ${buffer.length} bytes`);
    if (msg.caption) {
      console.log(`Caption: ${msg.caption}`);
    }
    // Save image
    require("fs").writeFileSync("image.jpg", buffer);
  }

  // Video
  if (msg.type === "video") {
    console.log(`Video: ${buffer.length} bytes`);
  }

  // Audio (voice note)
  if (msg.type === "audio") {
    console.log(`Audio: ${buffer.length} bytes`);
  }

  // Location
  if (msg.type === "location") {
    const coords = JSON.parse(buffer.toString());
    console.log(`Location: ${coords.lat}, ${coords.lng}`);
  }

  // Poll
  if (msg.type === "poll") {
    const poll = JSON.parse(buffer.toString());
    console.log(`Poll: ${poll.content}`);
    poll.options.forEach((opt: { content: string }, i: number) => {
      console.log(`  ${i + 1}. ${opt.content}`);
    });
  }
});
```

---

## 7. Send messages

```typescript
const cid = "5491198765432@s.whatsapp.net";

// Text
await wa.Message.text(cid, "Hello!");

// Text quoting message
await wa.Message.text(cid, "Reply", "MESSAGE_ID_TO_QUOTE");

// Image with caption
const img = require("fs").readFileSync("photo.jpg");
await wa.Message.image(cid, img, "Check out this photo!");

// Video
const vid = require("fs").readFileSync("video.mp4");
await wa.Message.video(cid, vid, "Interesting video");

// Audio (voice note)
const aud = require("fs").readFileSync("audio.ogg");
await wa.Message.audio(cid, aud);

// Location
await wa.Message.location(cid, {
  lat: -34.6037,
  lng: -58.3816
});

// Poll
await wa.Message.poll(cid, {
  content: "Which do you prefer?",
  options: [
    { content: "Option A" },
    { content: "Option B" },
    { content: "Option C" }
  ]
});
```

---

## 8. React to messages

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me) return;
  if (msg.type !== "text") return;

  const text = (await msg.content()).toString().toLowerCase();

  // React with emoji
  if (text.includes("thanks")) {
    await wa.Message.react(msg.cid, msg.id, "❤️");
  }

  if (text.includes("haha")) {
    await wa.Message.react(msg.cid, msg.id, "😂");
  }

  // Remove reaction
  // await wa.Message.react(msg.cid, msg.id, "");
});
```

---

## 9. Mark chat as read

```typescript
wa.event.on("message:created", async (msg) => {
  // Mark chat as read
  await wa.Chat.seen(msg.cid);
});
```

---

## Next step

Now that you have a basic bot running, explore the detailed documentation:

- [WhatsApp Reference](references/whatsapp.md) - Configuration and events
- [Chat Reference](references/chat.md) - Conversation management
- [Message Reference](references/message.md) - Message types
- [Advanced examples](examples/basic-bot.md) - Recommended patterns
