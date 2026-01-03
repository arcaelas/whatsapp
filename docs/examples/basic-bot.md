# Basic Bot

Simple bot that responds to text messages.

---

## Complete code

```typescript title="bot.ts"
import { WhatsApp } from "@arcaelas/whatsapp";

async function main() {
  const wa = new WhatsApp();

  // Connection events
  wa.event.on("open", () => console.log("[INFO] Connected"));
  wa.event.on("close", () => console.log("[WARN] Disconnected"));
  wa.event.on("error", (e) => console.error("[ERROR]", e.message));

  // Handle messages
  wa.event.on("message:created", async (msg) => {
    // Ignore own messages
    if (msg.me) return;

    // Only text
    if (msg.type !== "text") return;

    const text = (await msg.content()).toString().toLowerCase();

    // Respond to greetings
    if (text === "hello" || text === "hi") {
      await wa.Message.text(msg.cid, "Hello! How can I help you?");
      return;
    }

    // Commands
    if (text === "ping") {
      await wa.Message.text(msg.cid, "pong!");
      return;
    }

    if (text === "time") {
      const now = new Date().toLocaleString();
      await wa.Message.text(msg.cid, `Current time: ${now}`);
      return;
    }

    if (text === "help") {
      await wa.Message.text(
        msg.cid,
        "*Available commands:*\n\n" +
        "- hello/hi: Greeting\n" +
        "- ping: Connectivity test\n" +
        "- time: Current time\n" +
        "- help: This message"
      );
      return;
    }
  });

  // Connect
  console.log("[INFO] Starting bot...");
  await wa.pair(async (data) => {
    if (Buffer.isBuffer(data)) {
      require("fs").writeFileSync("qr.png", data);
      console.log("[INFO] QR saved to qr.png");
    } else {
      console.log("[INFO] Code:", data);
    }
  });

  console.log("[INFO] Bot ready!");

  // Keep process alive
  process.on("SIGINT", () => {
    console.log("[INFO] Closing...");
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
```

---

## Run

```bash
npx tsx bot.ts
```

---

## Usage

Send these messages to the connected WhatsApp:

```
hello     → Hello! How can I help you?
ping      → pong!
time      → Current time: 1/1/2025, 2:30:00 PM
help      → Available commands list
```

---

## Notes

!!! tip "Prefixes"
    Consider adding a prefix (`!`, `/`, `.`) to commands to avoid conflicts with normal messages.

!!! warning "Rate limits"
    WhatsApp has rate limits. Avoid sending too many messages in a short period.
