# Bot con Persistencia S3

Bot de produccion usando Amazon S3 para almacenamiento.

---

## Requisitos

- Cuenta de AWS con acceso a S3
- Bucket S3 creado
- Credenciales IAM con permisos S3

---

## Configuracion AWS

### Crear bucket

```bash
aws s3 mb s3://mi-bot-whatsapp --region us-east-1
```

### Politica IAM minima

```json title="policy.json"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::mi-bot-whatsapp",
        "arn:aws:s3:::mi-bot-whatsapp/*"
      ]
    }
  ]
}
```

---

## Variables de entorno

```bash title=".env"
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_REGION=us-east-1
S3_BUCKET=mi-bot-whatsapp
BOT_PREFIX=!
```

---

## Codigo

```typescript title="bot.ts"
import { WhatsApp, S3Engine } from "@arcaelas/whatsapp";
import "dotenv/config";

async function main() {
  // Validar variables de entorno
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET } = process.env;

  if (!S3_BUCKET) {
    throw new Error("S3_BUCKET no configurado");
  }

  // Crear engine S3
  const engine = new S3Engine({
    bucket: S3_BUCKET,
    prefix: ".baileys/produccion",
    credentials: AWS_ACCESS_KEY_ID ? {
      region: AWS_REGION || "us-east-1",
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    } : undefined, // Usa IAM role si no hay credenciales
  });

  // Crear instancia
  const wa = new WhatsApp({
    engine,
    sync: true,
    online: false,
  });

  // Logging
  wa.on("open", () => console.log("[INFO] Conectado"));
  wa.on("close", () => console.log("[WARN] Desconectado"));
  wa.on("error", (e) => console.error("[ERROR]", e.message));
  wa.on("progress", (p) => console.log(`[SYNC] ${p}%`));

  // Mensajes
  wa.on("message:created", async (msg) => {
    if (msg.me) return;
    if (!(msg instanceof wa.Message.Text)) return;

    const text = (await msg.content()).toString();
    const prefix = process.env.BOT_PREFIX || "!";

    if (!text.startsWith(prefix)) return;

    const [cmd] = text.slice(prefix.length).split(" ");

    switch (cmd.toLowerCase()) {
      case "ping":
        await wa.Message.Message.text(msg.cid, "pong!");
        break;

      case "status":
        await wa.Message.Message.text(
          msg.cid,
          `*Estado del Bot*\n\n` +
          `Engine: S3\n` +
          `Bucket: ${S3_BUCKET}\n` +
          `Region: ${AWS_REGION || "us-east-1"}\n` +
          `Uptime: ${Math.floor(process.uptime() / 60)} minutos`
        );
        break;

      case "ayuda":
        await wa.Message.Message.text(
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
      // En produccion, enviar QR por otro medio
      require("fs").writeFileSync("/tmp/qr.png", data);
      console.log("[INFO] QR guardado en /tmp/qr.png");
    } else {
      console.log("[INFO] Codigo:", data);
    }
  });

  await wa.sync((p) => console.log(`[SYNC] ${p}%`));
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
  bot:
    build: .
    restart: unless-stopped
    environment:
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
      - AWS_REGION=${AWS_REGION}
      - S3_BUCKET=${S3_BUCKET}
      - BOT_PREFIX=${BOT_PREFIX}
    volumes:
      - /tmp:/tmp  # Para el QR temporal
```

---

## AWS Lambda (opcional)

Para ejecutar como funcion Lambda con API Gateway:

```typescript title="lambda.ts"
import { WhatsApp, S3Engine } from "@arcaelas/whatsapp";
import { APIGatewayProxyHandler } from "aws-lambda";

let wa: WhatsApp | null = null;

async function getWhatsApp(): Promise<WhatsApp> {
  if (wa) return wa;

  wa = new WhatsApp({
    engine: new S3Engine({
      bucket: process.env.S3_BUCKET!,
      prefix: ".baileys/lambda",
    }),
    sync: false,
    online: false,
  });

  await wa.pair();
  return wa;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const whatsapp = await getWhatsApp();
  const body = JSON.parse(event.body || "{}");

  // Enviar mensaje via API
  if (body.action === "send") {
    const { to, message } = body;
    await whatsapp.Message.Message.text(to, message);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  }

  return {
    statusCode: 400,
    body: JSON.stringify({ error: "Invalid action" }),
  };
};
```

---

## Monitoreo

### Health check

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

### CloudWatch Logs

```typescript
// Reemplazar console.log con formato estructurado
function log(level: string, message: string, meta?: object) {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  }));
}

wa.on("open", () => log("INFO", "Conectado"));
wa.on("error", (e) => log("ERROR", e.message, { stack: e.stack }));
```
