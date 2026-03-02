# Custom Engine Bot

Production bot using a custom engine for storage.

---

## Description

This example shows how to create a bot that uses a custom engine
(PostgreSQL, S3, etc.) instead of the default FileEngine.

The library already includes `RedisEngine` as an official export, so you can use it directly
without implementing your own.

---

## Example: Using the built-in RedisEngine

### Use the engine

```typescript title="bot.ts"
import { writeFileSync } from "fs";
import Redis from "ioredis";
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";
import "dotenv/config";

async function main() {
  // Create Redis connection
  const client = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

  // Use the built-in RedisEngine
  const engine = new RedisEngine(client, "wa:my-bot");

  // Create instance with Redis engine
  const wa = new WhatsApp({ engine });

  // Logging
  wa.event.on("open", () => console.log("[INFO] Connected"));
  wa.event.on("close", () => console.log("[WARN] Disconnected"));
  wa.event.on("error", (e) => console.error("[ERROR]", e.message));

  // Messages
  wa.event.on("message:created", async (msg) => {
    if (msg.me || msg.type !== "text") return;

    const text = (await msg.content()).toString();
    const prefix = process.env.BOT_PREFIX || "!";

    if (!text.startsWith(prefix)) return;

    const [cmd] = text.slice(prefix.length).split(" ");

    switch (cmd.toLowerCase()) {
      case "ping":
        await wa.Message.text(msg.cid, "pong!");
        break;

      case "status":
        await wa.Message.text(
          msg.cid,
          `*Bot Status*\n\n` +
          `Engine: Redis\n` +
          `Uptime: ${Math.floor(process.uptime() / 60)} minutes`
        );
        break;

      case "help":
        await wa.Message.text(
          msg.cid,
          `Commands:\n` +
          `${prefix}ping - Test\n` +
          `${prefix}status - Bot status\n` +
          `${prefix}help - This message`
        );
        break;
    }
  });

  // Connect
  console.log("[INFO] Starting bot...");
  await wa.pair(async (data) => {
    if (Buffer.isBuffer(data)) {
      writeFileSync("/tmp/qr.png", data);
      console.log("[INFO] QR saved to /tmp/qr.png");
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

## Custom Engine Example

If you need a different backend, implement the `Engine` interface.
The key contract for `set(key, null)` is that it must delete the key AND all sub-keys
with that prefix (cascade delete).

```typescript title="CustomEngine.ts"
import type { Engine } from "@arcaelas/whatsapp";

class MyEngine implements Engine {
  async get(key: string): Promise<string | null> {
    // Return stored value or null
  }

  async set(key: string, value: string | null): Promise<void> {
    if (value === null) {
      // IMPORTANT: Must cascade delete.
      // Delete the exact key AND all keys starting with key + "/"
      // Example: set("chat/123", null) must also delete
      //   chat/123/index, chat/123/messages, chat/123/message/*/*, etc.
    } else {
      // Store the value
    }
  }

  async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
    // Return keys matching prefix, ordered by most recent
  }
}
```

---

## Docker

```dockerfile title="Dockerfile"
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

CMD ["node", "--import", "tsx", "bot.ts"]
```

```yaml title="docker-compose.yml"
version: "3.8"

services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped

  bot:
    build: .
    restart: unless-stopped
    depends_on:
      - redis
    environment:
      - REDIS_URL=redis://redis:6379
      - BOT_PREFIX=!
    volumes:
      - /tmp:/tmp  # For temporary QR
```

---

## Health check

```typescript
import { createServer } from "http";

// Add after initializing the bot
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      connected: wa.socket !== null,
      uptime: process.uptime(),
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(3000, () => {
  console.log("[INFO] Health check at http://localhost:3000/health");
});
```

---

## Environment variables

```bash title=".env"
REDIS_URL=redis://localhost:6379
BOT_PREFIX=!
```
