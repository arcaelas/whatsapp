# Bot de Comandos

Bot con sistema de comandos estructurado y modular.

---

## Estructura del proyecto

```
mi-bot/
  src/
    commands/
      index.ts
      ping.ts
      ayuda.ts
      hora.ts
    index.ts
  package.json
  tsconfig.json
```

---

## Codigo

### src/commands/index.ts

```typescript
import { Message, WhatsApp } from "@arcaelas/whatsapp";

export interface CommandContext {
  wa: WhatsApp;
  msg: Message;
  cid: string;
  args: string[];
  text: string;
}

export interface Command {
  name: string;
  description: string;
  aliases?: string[];
  execute: (ctx: CommandContext) => Promise<void>;
}

// Registro de comandos
export const commands = new Map<string, Command>();

// Helper para registrar comando
export function registerCommand(cmd: Command) {
  commands.set(cmd.name, cmd);
  cmd.aliases?.forEach(alias => commands.set(alias, cmd));
}

// Importar y registrar comandos
import "./ping";
import "./ayuda";
import "./hora";
```

### src/commands/ping.ts

```typescript
import { registerCommand } from "./index";

registerCommand({
  name: "ping",
  description: "Verificar latencia del bot",
  aliases: ["p"],
  async execute({ wa, cid }) {
    const start = Date.now();
    await wa.Message.Message.text(cid, "pong!");
    console.log(`Latencia: ${Date.now() - start}ms`);
  },
});
```

### src/commands/ayuda.ts

```typescript
import { commands, registerCommand } from "./index";

registerCommand({
  name: "ayuda",
  description: "Mostrar lista de comandos",
  aliases: ["help", "h", "?"],
  async execute({ wa, cid }) {
    const uniqueCommands = new Map<string, string>();

    commands.forEach((cmd) => {
      if (!uniqueCommands.has(cmd.name)) {
        uniqueCommands.set(cmd.name, cmd.description);
      }
    });

    let message = "*Comandos disponibles:*\n\n";
    uniqueCommands.forEach((desc, name) => {
      message += `!${name} - ${desc}\n`;
    });

    await wa.Message.Message.text(cid, message);
  },
});
```

### src/commands/hora.ts

```typescript
import { registerCommand } from "./index";

registerCommand({
  name: "hora",
  description: "Mostrar hora actual",
  aliases: ["time", "t"],
  async execute({ wa, cid }) {
    const now = new Date();
    const time = now.toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const date = now.toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    await wa.Message.Message.text(cid, `${time}\n${date}`);
  },
});
```

### src/index.ts

```typescript
import { WhatsApp } from "@arcaelas/whatsapp";
import { commands, CommandContext } from "./commands";

const PREFIX = "!";

async function main() {
  const wa = new WhatsApp({ sync: true, online: false });

  wa.on("open", () => console.log("Bot conectado"));
  wa.on("error", (e) => console.error("Error:", e.message));

  wa.on("message:created", async (msg) => {
    // Ignorar mensajes propios
    if (msg.me) return;

    // Solo texto
    if (!(msg instanceof wa.Message.Text)) return;

    const text = (await msg.content()).toString();

    // Verificar prefijo
    if (!text.startsWith(PREFIX)) return;

    // Parsear comando y argumentos
    const [commandName, ...args] = text.slice(PREFIX.length).split(" ");
    const cmd = commands.get(commandName.toLowerCase());

    if (!cmd) {
      await wa.Message.Message.text(msg.cid, `Comando no encontrado. Escribe ${PREFIX}ayuda`);
      return;
    }

    // Ejecutar comando
    const ctx: CommandContext = {
      wa,
      msg,
      cid: msg.cid,
      args,
      text: text.slice(PREFIX.length + commandName.length + 1),
    };

    try {
      await cmd.execute(ctx);
    } catch (error) {
      console.error(`Error en comando ${cmd.name}:`, error);
      await wa.Message.Message.text(msg.cid, "Ocurrio un error ejecutando el comando");
    }
  });

  // Conectar
  await wa.pair(async (data) => {
    if (Buffer.isBuffer(data)) {
      require("fs").writeFileSync("qr.png", data);
      console.log("Escanea qr.png");
    }
  });

  await wa.sync();
  console.log("Bot listo!");
}

main().catch(console.error);
```

---

## Agregar nuevos comandos

### Comando con argumentos

```typescript title="src/commands/decir.ts"
import { registerCommand } from "./index";

registerCommand({
  name: "decir",
  description: "Repetir un mensaje",
  aliases: ["echo", "say"],
  async execute({ wa, cid, text }) {
    if (!text.trim()) {
      await wa.Message.Message.text(cid, "Uso: !decir <mensaje>");
      return;
    }
    await wa.Message.Message.text(cid, text);
  },
});
```

### Comando con validacion

```typescript title="src/commands/dado.ts"
import { registerCommand } from "./index";

registerCommand({
  name: "dado",
  description: "Lanzar un dado",
  aliases: ["dice", "roll"],
  async execute({ wa, cid, args }) {
    const sides = parseInt(args[0]) || 6;

    if (sides < 2 || sides > 100) {
      await wa.Message.Message.text(cid, "El dado debe tener entre 2 y 100 caras");
      return;
    }

    const result = Math.floor(Math.random() * sides) + 1;
    await wa.Message.Message.text(cid, `Dado de ${sides} caras: ${result}`);
  },
});
```

### Comando solo para grupos

```typescript title="src/commands/grupo.ts"
import { registerCommand } from "./index";

registerCommand({
  name: "grupo",
  description: "Informacion del grupo",
  aliases: ["group", "g"],
  async execute({ wa, cid }) {
    // Solo en grupos
    if (!cid.endsWith("@g.us")) {
      await wa.Message.Message.text(cid, "Este comando solo funciona en grupos");
      return;
    }

    const chat = await wa.Chat.get(cid);
    if (!chat) return;

    const members = await chat.members(0, 1000);

    await wa.Message.Message.text(
      cid,
      `*${chat.name}*\n\n` +
      `Miembros: ${members.length}`
    );
  },
});
```

---

## Ejecutar

```bash
npx tsx src/index.ts
```

---

## Uso

```
!ping          -> pong!
!ayuda         -> Lista de comandos
!hora          -> 14:30:45 - lunes, 1 de enero de 2025
!decir Hola    -> Hola
!dado 20       -> Dado de 20 caras: 15
!grupo         -> Informacion del grupo
```
