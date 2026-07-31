# Decorator Bot

Bot completo y ejecutable construido con la API de decoradores Stage 3 (`@arcaelas/whatsapp/decorators`). Cada decorador de primera clase se ejercita en un único archivo: ciclo de vida, pairing, comandos, filtrado, tareas periódicas, workflows y un logger genérico de entrantes.

---

## Requisitos previos

```bash
yarn add @arcaelas/whatsapp
```

!!! info "El motor que prefieras"
    El ejemplo usa `SQLiteEngine` para que el estado del bot sobreviva a los reinicios en un solo
    archivo. Reemplázalo por `FileSystemEngine`, `RedisEngine` o `S3Engine` — la API de decoradores
    es agnóstica al motor. Los motores siempre vienen de `@arcaelas/whatsapp`, nunca de la
    sub-entrada `/decorators`.

---

## Código completo

```typescript title="bot.ts"
import { writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
  WhatsAppBot,
  command,
  connect,
  delay,
  disconnect,
  every,
  from,
  guard,
  on,
  pair,
  pipe,
} from "@arcaelas/whatsapp/decorators";
import { SQLiteEngine } from "@arcaelas/whatsapp";
import type { Chat, Message } from "@arcaelas/whatsapp";

const ADMIN_PHONE = "5491111111111";

class DecoratorBot extends WhatsAppBot {
  // ---- Emparejamiento (PIN / QR) --------------------------------------

  @pair()
  async on_pair(code: string | Buffer) {
    if (Buffer.isBuffer(code)) {
      await writeFile("qr.png", code);
      console.log("[pair] QR guardado en qr.png");
    } else {
      console.log("[pair] código de emparejamiento:", code);
    }
  }

  // ---- Ciclo de vida ---------------------------------------------------

  @connect()
  on_open() {
    console.log("[lifecycle] conectado");
  }

  @disconnect()
  on_close() {
    console.log("[lifecycle] desconectado");
  }

  // ---- Comandos --------------------------------------------------------

  @command("/help")
  async help(msg: Message, chat: Chat, args: string[]) {
    await msg.text(
      [
        "Comandos disponibles:",
        "  /help           — muestra este mensaje",
        "  /echo <texto>   — repite el texto indicado",
        "  /shutdown       — solo administradores",
      ].join("\n"),
    );
  }

  @command(/^\/echo\s+(.+)$/)
  async echo(msg: Message, chat: Chat, args: string[]) {
    const [text] = args;
    await msg.text(text);
  }

  // Comando solo para admins: @from filtra por autor ANTES de correr el handler.
  @command("/shutdown")
  @from(ADMIN_PHONE)
  async shutdown(msg: Message) {
    await msg.text("apagando");
    process.exit(0);
  }

  // ---- Tareas periódicas -----------------------------------------------

  @every(30_000)
  heartbeat() {
    console.log("[heartbeat] vivo", new Date().toISOString());
  }

  // Nunca se solapa consigo mismo: la siguiente corrida espera a que termine esta.
  @delay(60_000)
  async sweep() {
    const chats = await this.Chat.list(0, 50);
    console.log("[sweep] siguiendo", chats.length, "chats");
  }

  // ---- Workflow secuencial (@pipe) ------------------------------------

  @pipe("talk", 0)
  async talk_step_1(msg: Message) {
    (msg as unknown as { received_at: number }).received_at = Date.now();
    console.log("[talk:0] etiquetado", msg.id);
  }

  @pipe("talk", 1)
  async talk_step_2(msg: Message) {
    const tagged = msg as unknown as { received_at: number };
    console.log("[talk:1] transcurrido", Date.now() - tagged.received_at, "ms");
  }

  // ---- Logger genérico de entrantes -----------------------------------

  @on("message:created")
  @guard((msg) => !(msg as Message).me)
  log_inbound(msg: Message) {
    console.log("[inbound]", msg.from, msg.type, msg.id);
  }
}

// ---- Punto de entrada --------------------------------------------------

const bot = new DecoratorBot({
  engine: new SQLiteEngine(new DatabaseSync(".sessions/bot.db")),
  phone: 5491112345678,
});

await bot.connect(); // emparejamiento manejado por @pair

process.on("SIGINT", async () => {
  await bot.disconnect();
  process.exit(0);
});
```

---

## Recorrido

### `class DecoratorBot extends WhatsAppBot`

`WhatsAppBot` **es** el cliente `WhatsApp` más el cableado de decoradores, así que la instancia lleva
`this.Chat`, `this.Message`, `this.on(...)` y todas las opciones del constructor. El cableado ocurre
en el primer `connect()`, y una reconexión no duplica los listeners.

### `@pair()`

El bot **no** pasa un callback a `connect()`. El emparejamiento se delega enteramente al método
`on_pair`: si baileys entrega un `Buffer`, es un QR en PNG y se escribe a disco; si entrega un
string, es un código PIN para tipear en la app móvil de WhatsApp. Varios métodos `@pair` —si los
hay— corren concurrentemente.

### `@connect()` / `@disconnect()`

Alias de `@on('connected')` y `@on('disconnected')`. Útiles para enganchar efectos secundarios
(métricas, hooks de apagado ordenado, precalentamiento de caché) al ciclo de vida de la conexión.

### `@command('/help')`

Forma string: `@command` aplica `@on('message:created')`, un guard que verifica
`msg.caption.startsWith('/help')` y un transform que reescribe la firma del handler a
`(msg, chat, args)`, donde `args` es la cola partida por espacios.

### `@command(/^\/echo\s+(.+)$/)`

Forma RegExp: la expresión se prueba contra `msg.caption`. `args` es `match.slice(1)`, así que el
primer grupo de captura es el texto a repetir. Es la manera idiomática de parsear comandos complejos
sin escribir `split`/`trim` a mano.

### `@command('/shutdown') + @from(ADMIN_PHONE)`

`@from` registra un guard asíncrono que normaliza el teléfono a JID en el primer uso (vía el resolver
interno del cliente) y lo cachea. El comando solo corre cuando el autor del mensaje coincide con el
admin. Pasa `string[]` para varios administradores o un predicado `(jid) => boolean` para una
coincidencia propia.

### `@every(30_000)` y `@delay(60_000)`

`@every` instala un `setInterval`: las ejecuciones son independientes y pueden solaparse si el método
tarda más que el intervalo. `@delay` encadena llamadas a `setTimeout`, así que la siguiente corrida
solo arranca cuando la anterior resolvió. Ambos arrancan en `connected` y se detienen en
`disconnected`, y ninguno recibe argumentos — accede al cliente a través de `this`.

### `@pipe('talk', 0)` y `@pipe('talk', 1)`

Dos pasos del mismo workflow. Corren **secuencialmente** en cada `message:created`, ordenados por
`index`. El paso 0 etiqueta el mensaje con `received_at`; el paso 1 lee ese campo — como ambos
comparten la misma referencia `msg`, la mutación es visible aguas abajo. Cualquier cantidad de pasos
puede pertenecer al mismo workflow, y los workflows son independientes entre sí.

### `@on('message:created') + @guard(...)`

Logger genérico de entrantes que demuestra la suscripción simple a un evento con un guard ad-hoc.
`@guard` es apilable y cortocircuita con semántica AND; `msg.me` es `true` en los mensajes que
escribió el bot, así que filtrarlos evita bucles de autologueo.

!!! warning "Los guards reciben argumentos `unknown`"
    La firma del predicado es `(...args: unknown[])`, así que `@guard((msg: Message) => !msg.me)`
    **no** compila con `strict`. Deja que el parámetro se infiera y castea dentro del cuerpo, como en
    `@guard((msg) => !(msg as Message).me)`.

---

## Variante: `@Bot` con opciones por defecto

`@Bot(defaults)` convierte cualquier clase en una subclase de `WhatsAppBot` y fusiona las opciones
que pasas en la construcción sobre sus valores por defecto:

```typescript title="bot-decorated.ts"
import { FileSystemEngine } from "@arcaelas/whatsapp";
import { WhatsAppBot, Bot, connect } from "@arcaelas/whatsapp/decorators";

@Bot({
  engine: new FileSystemEngine(".sessions/bot"),
  phone: 5491112345678,
})
class Staging extends WhatsAppBot {
  @connect()
  on_open() {
    console.log("conectado");
  }
}

const bot = new Staging({ engine: new FileSystemEngine(".sessions/staging") });
await bot.connect();
```

!!! warning "Mantén `extends WhatsAppBot`"
    Los decoradores Stage 3 no pueden cambiar el tipo declarado de una clase. `@Bot` produce el
    objeto correcto en runtime, pero sin `extends WhatsAppBot` TypeScript no verá `connect()` ni
    `disconnect()` en tu clase.

---

## Ejecución

```bash
yarn tsx bot.ts
```

La primera ejecución imprime un PIN (o escribe `qr.png`). Empareja el teléfono, observa la línea `[lifecycle] conectado` y luego envía:

- `/help` — el listado de ayuda de comandos.
- `/echo hola mundo` — el bot responde `hola mundo`.
- `/shutdown` — solo el teléfono admin puede dispararlo.

Mientras corre, el log `[heartbeat]` late cada 30 segundos, `[sweep]` corre un minuto después de que terminó el barrido anterior, y cada mensaje entrante fluye por el workflow `talk` y por el logger genérico.

---

## Ver también

- [References / Decorators](../references/decorators.es.md) — referencia completa de decoradores y reglas de apilado.
- [References / Events](../references/events.es.md) — nombres y payloads de eventos.
- [Examples / Basic bot](basic-bot.es.md) — el mismo caso de uso escrito contra el cliente `WhatsApp` crudo (sin decoradores).
