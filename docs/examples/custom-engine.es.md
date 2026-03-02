# Bot con Engine Personalizado

Bot de produccion usando un engine personalizado para almacenamiento.

---

## Descripcion

Este ejemplo muestra como crear un bot que usa un engine personalizado
(PostgreSQL, S3, etc.) en lugar del FileEngine por defecto.

La libreria ya incluye `RedisEngine` como export oficial, asi que puedes usarlo
directamente sin implementar uno propio.

---

## Ejemplo: Usando el RedisEngine incluido

### Usar el engine

```typescript title="bot.ts"
import { writeFileSync } from "fs";
import Redis from "ioredis";
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";
import "dotenv/config";

async function main() {
  // Crear conexion Redis
  const client = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

  // Usar el RedisEngine incluido
  const engine = new RedisEngine(client, "wa:mi-bot");

  // Crear instancia con engine Redis
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
      writeFileSync("/tmp/qr.png", data);
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

## Ejemplo de Engine Personalizado

Si necesitas un backend diferente, implementa la interfaz `Engine`.
El contrato clave de `set(key, null)` es que debe eliminar la key Y todas las sub-keys
con ese prefijo (cascade delete).

```typescript title="CustomEngine.ts"
import type { Engine } from "@arcaelas/whatsapp";

class MyEngine implements Engine {
  async get(key: string): Promise<string | null> {
    // Retornar valor almacenado o null
  }

  async set(key: string, value: string | null): Promise<void> {
    if (value === null) {
      // IMPORTANTE: Debe hacer cascade delete.
      // Eliminar la key exacta Y todas las keys que empiecen con key + "/"
      // Ejemplo: set("chat/123", null) debe tambien eliminar
      //   chat/123/index, chat/123/messages, chat/123/message/*/*, etc.
    } else {
      // Almacenar el valor
    }
  }

  async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
    // Retornar keys que coincidan con el prefix, ordenadas por mas reciente
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
