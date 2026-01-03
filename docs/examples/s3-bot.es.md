# Bot con Engine Personalizado

Bot de produccion usando un engine personalizado para almacenamiento.

---

## Descripcion

Este ejemplo muestra como crear un bot que usa un engine personalizado
(Redis, PostgreSQL, S3, etc.) en lugar del FileEngine por defecto.

---

## Ejemplo: Redis Engine

### Crear el engine

```typescript title="RedisEngine.ts"
import type { Engine } from "@arcaelas/whatsapp";
import { createClient } from "redis";

export class RedisEngine implements Engine {
  private client: ReturnType<typeof createClient>;

  constructor(url: string) {
    this.client = createClient({ url });
  }

  async connect() {
    await this.client.connect();
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async set(key: string, value: string | null): Promise<void> {
    if (value === null) {
      await this.client.del(key);
    } else {
      await this.client.set(key, value);
    }
  }

  async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
    const keys = await this.client.keys(`${prefix}*`);
    return keys.slice(offset, offset + limit);
  }
}
```

### Usar el engine

```typescript title="bot.ts"
import { WhatsApp } from "@arcaelas/whatsapp";
import { RedisEngine } from "./RedisEngine";
import "dotenv/config";

async function main() {
  // Crear engine Redis
  const engine = new RedisEngine(process.env.REDIS_URL || "redis://localhost:6379");
  await engine.connect();

  // Crear instancia con engine personalizado
  const wa = new WhatsApp({ engine });

  // Logging
  wa.event.on("open", () => console.log("[INFO] Conectado"));
  wa.event.on("close", () => console.log("[WARN] Desconectado"));
  wa.event.on("error", (e) => console.error("[ERROR]", e.message));

  // Mensajes
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
          `*Estado del Bot*\n\n` +
          `Engine: Redis\n` +
          `Uptime: ${Math.floor(process.uptime() / 60)} minutos`
        );
        break;

      case "ayuda":
        await wa.Message.text(
          msg.cid,
          `Comandos:\n` +
          `${prefix}ping - Test\n` +
          `${prefix}status - Estado del bot\n` +
          `${prefix}ayuda - Este mensaje`
        );
        break;
    }
  });

  // Conectar
  console.log("[INFO] Iniciando bot...");
  await wa.pair(async (data) => {
    if (Buffer.isBuffer(data)) {
      require("fs").writeFileSync("/tmp/qr.png", data);
      console.log("[INFO] QR guardado en /tmp/qr.png");
    } else {
      console.log("[INFO] Codigo:", data);
    }
  });

  console.log("[INFO] Bot listo!");

  // Mantener proceso vivo
  process.on("SIGINT", () => {
    console.log("[INFO] Cerrando...");
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
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
      - /tmp:/tmp  # Para el QR temporal
```

---

## Health check

```typescript
import { createServer } from "http";

// Agregar despues de inicializar el bot
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
  console.log("[INFO] Health check en http://localhost:3000/health");
});
```

---

## Variables de entorno

```bash title=".env"
REDIS_URL=redis://localhost:6379
BOT_PREFIX=!
```

---

## Otros engines

Consulta la documentacion de [Engines](../references/engines.md) para ver
ejemplos de PostgreSQL, MongoDB, y otros.
