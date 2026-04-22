# Decorator Bot

Bot completo y ejecutable construido con la API de decoradores Stage 3 (`@arcaelas/whatsapp/decorators`). Cada decorador de primera clase se ejercita en un único archivo: ciclo de vida, pairing, comandos, filtrado, tareas periódicas, workflows y un logger genérico de entrantes.

---

## Requisitos previos

```bash
yarn add @arcaelas/whatsapp ioredis
```

!!! info "Motor Redis"
    El ejemplo usa `RedisEngine` para que el estado del bot sobreviva a los reinicios. Reemplázalo por `FileSystemEngine` si prefieres un store local en archivos — la API de decoradores es agnóstica al motor.

---

## Código completo

```typescript title="bot.ts"
import { writeFile } from "node:fs/promises";
import Redis from "ioredis";
import {
  Bot,
  command,
  connect,
  disconnect,
  every,
  from,
  guard,
  on,
  pair,
  pipe,
} from "@arcaelas/whatsapp/decorators";
import { RedisEngine } from "@arcaelas/whatsapp";
import type { Chat, Message, WhatsApp } from "@arcaelas/whatsapp";

const ADMIN_PHONE = "5491111111111";

@Bot({
  engine: new RedisEngine(new Redis()),
  phone: "5491112345678",
})
class DecoratorBot {
  // ---- Pairing (PIN / QR) ---------------------------------------------

  @pair()
  async on_pair(code: string | Buffer) {
    if (Buffer.isBuffer(code)) {
      await writeFile("qr.png", code);
      console.log("[pair] QR saved to qr.png");
    } else {
      console.log("[pair] pairing code:", code);
    }
  }

  // ---- Lifecycle -------------------------------------------------------

  @connect()
  on_open() {
    console.log("[lifecycle] connected");
  }

  @disconnect()
  on_close() {
    console.log("[lifecycle] disconnected");
  }

  // ---- Commands --------------------------------------------------------

  @command("/help")
  async help(msg: Message, chat: Chat, args: string[]) {
    await msg.text(
      [
        "Available commands:",
        "  /help           — show this message",
        "  /echo <text>    — echo the provided text",
        "  /shutdown       — admin-only",
      ].join("\n"),
    );
  }

  @command(/^\/echo\s+(.+)$/)
  async echo(msg: Message, chat: Chat, args: string[]) {
    const [text] = args;
    await msg.text(text);
  }

  // Comando solo-admin: @from filtra por autor ANTES de que el handler se ejecute.
  @command("/shutdown")
  @from(ADMIN_PHONE)
  async shutdown(msg: Message) {
    await msg.text("shutting down");
    process.exit(0);
  }

  // ---- Tarea periódica ------------------------------------------------

  @every(30_000)
  heartbeat() {
    console.log("[heartbeat] alive", new Date().toISOString());
  }

  // ---- Workflow secuencial (@pipe) -----------------------------------

  @pipe("talk", 0)
  async talk_step_1(msg: Message, chat: Chat, wa: WhatsApp) {
    (msg as unknown as { received_at: number }).received_at = Date.now();
    console.log("[talk:0] tagged", msg.id);
  }

  @pipe("talk", 1)
  async talk_step_2(msg: Message) {
    const tagged = msg as unknown as { received_at: number };
    console.log("[talk:1] elapsed", Date.now() - tagged.received_at, "ms");
  }

  // ---- Logger genérico de entrantes -----------------------------------

  @on("message:created")
  @guard((msg: Message) => !msg.me)
  log_inbound(msg: Message) {
    console.log("[inbound]", msg.from, msg.type, msg.id);
  }
}

// ---- Entry point -------------------------------------------------------

const bot = new DecoratorBot();
await bot.connect(); // pairing manejado por @pair

process.on("SIGINT", async () => {
  await bot.disconnect();
  process.exit(0);
});
```

---

## Walkthrough

### `@Bot({ engine, phone })`

Convierte `DecoratorBot` en una subclase de `WhatsAppBot`. La clase no necesita extender nada manualmente. El decorador siembra las opciones por defecto (motor Redis + teléfono para emparejamiento por PIN); un override en runtime puede pasarse en tiempo de construcción, p. ej. `new DecoratorBot({ phone: "5499999999999" })`.

### `@pair()`

El bot **no** pasa un callback a `connect()`. El emparejamiento se delega enteramente al método `on_pair`: si baileys entrega un `Buffer`, es un PNG de QR y se escribe a disco; si entrega un string, es un código PIN para tipear en la app móvil de WhatsApp. Múltiples métodos `@pair` — si están presentes — se ejecutarían concurrentemente.

### `@connect()` / `@disconnect()`

Alias de `@on('connected')` y `@on('disconnected')`. Útiles para cablear efectos secundarios (métricas, hooks de apagado limpio, precalentamiento de caché) al ciclo de vida de la conexión.

### `@command('/help')`

Forma string: `@command` aplica `@on('message:created')`, un guard que coincide `msg.caption.startsWith('/help')` y una transformación que reescribe la signatura del handler a `(msg, chat, args)`, donde `args` es la cola dividida por whitespace.

### `@command(/^\/echo\s+(.+)$/)`

Forma RegExp: el regex se testea contra `msg.caption`. `args` es `match.slice(1)`, por lo que el primer capture group es el texto ecoado. Esta es la forma idiomática de parsear formas de comando complejas sin escribir lógica manual de `split`/`trim`.

### `@command('/shutdown') + @from(ADMIN_PHONE)`

`@from` registra un guard async que normaliza el teléfono a un JID en el primer uso (vía el resolver interno) y lo cachea. El comando solo se ejecuta cuando el autor del mensaje coincide con el admin. Pasa `string[]` para múltiples admins o un predicado `(jid) => boolean` para matching personalizado.

### `@every(30_000)`

Instala un `setInterval` de 30 segundos que comienza en `connected` y se limpia en `disconnected`. El callback no recibe argumentos; accede a la instancia a través de `this`.

### `@pipe('talk', 0)` y `@pipe('talk', 1)`

Dos pasos del mismo workflow. Se ejecutan **secuencialmente** en cada `message:created`, ordenados por `index`. El paso 0 etiqueta el mensaje con `received_at`; el paso 1 lee ese campo — porque ambos pasos comparten la misma referencia de `msg`, la mutación es visible aguas abajo. Cualquier número de pasos puede pertenecer al mismo workflow, y los workflows son independientes entre sí.

### `@on('message:created') + @guard(...)`

Logger genérico de entrantes que demuestra la suscripción plana a eventos con un guard ad-hoc. `@guard` es apilable y hace corto-circuito con semántica AND; `msg.me` es `true` para mensajes autorizados por el bot, por lo que filtrarlo previene loops de auto-logging.

---

## Ejecución

```bash
yarn tsx bot.ts
```

La primera ejecución imprime un PIN (o escribe `qr.png`). Empareja el teléfono, observa la línea `[lifecycle] connected`, y luego envía:

- `/help` — el listado de ayuda de comandos.
- `/echo hello world` — el bot responde `hello world`.
- `/shutdown` — solo el teléfono admin puede dispararlo.

Mientras corre, el log `[heartbeat]` tickea cada 30 segundos, y cada mensaje entrante fluye por el workflow `talk` y el logger genérico.

---

## Ver también

- [References / Decorators](../references/decorators.es.md) — referencia completa de decoradores y reglas de apilado.
- [References / Events](../references/events.es.md) — nombres y payloads de eventos.
- [Examples / Basic bot](basic-bot.es.md) — el mismo caso de uso escrito contra el cliente `WhatsApp` crudo (sin decoradores).
