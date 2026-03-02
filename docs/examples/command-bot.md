# Command Bot

Bot with structured and modular command system.

---

## Project structure

```
my-bot/
  src/
    commands/
      index.ts
      ping.ts
      help.ts
      time.ts
    index.ts
  package.json
  tsconfig.json
```

---

## Code

### src/commands/index.ts

```typescript
import type { WhatsApp } from "@arcaelas/whatsapp";

// Message type (inferred from wa.Message)
type Message = InstanceType<WhatsApp["Message"]>;

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

// Command registry
export const commands = new Map<string, Command>();

// Helper to register command
export function register_command(cmd: Command) {
  commands.set(cmd.name, cmd);
  cmd.aliases?.forEach(alias => commands.set(alias, cmd));
}

// Import and register commands
import "./ping";
import "./help";
import "./time";
```

### src/commands/ping.ts

```typescript
import { register_command } from "./index";

register_command({
  name: "ping",
  description: "Check bot latency",
  aliases: ["p"],
  async execute({ wa, cid }) {
    const start = Date.now();
    await wa.Message.text(cid, "pong!");
    console.log(`Latency: ${Date.now() - start}ms`);
  },
});
```

### src/commands/help.ts

```typescript
import { commands, register_command } from "./index";

register_command({
  name: "help",
  description: "Show command list",
  aliases: ["h", "?"],
  async execute({ wa, cid }) {
    const unique_commands = new Map<string, string>();

    commands.forEach((cmd) => {
      if (!unique_commands.has(cmd.name)) {
        unique_commands.set(cmd.name, cmd.description);
      }
    });

    let message = "*Available commands:*\n\n";
    unique_commands.forEach((desc, name) => {
      message += `!${name} - ${desc}\n`;
    });

    await wa.Message.text(cid, message);
  },
});
```

### src/commands/time.ts

```typescript
import { register_command } from "./index";

register_command({
  name: "time",
  description: "Show current time",
  aliases: ["t"],
  async execute({ wa, cid }) {
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const date = now.toLocaleDateString("en-US", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    await wa.Message.text(cid, `${time}\n${date}`);
  },
});
```

### src/index.ts

```typescript
import { writeFileSync } from "fs";
import { WhatsApp } from "@arcaelas/whatsapp";
import { commands, CommandContext } from "./commands";

const PREFIX = "!";

async function main() {
  const wa = new WhatsApp();

  wa.event.on("open", () => console.log("Bot connected"));
  wa.event.on("error", (e) => console.error("Error:", e.message));

  wa.event.on("message:created", async (msg) => {
    // Ignore own messages
    if (msg.me) return;

    // Only text
    if (msg.type !== "text") return;

    const text = (await msg.content()).toString();

    // Check prefix
    if (!text.startsWith(PREFIX)) return;

    // Parse command and arguments
    const [command_name, ...args] = text.slice(PREFIX.length).split(" ");
    const cmd = commands.get(command_name.toLowerCase());

    if (!cmd) {
      await wa.Message.text(msg.cid, `Command not found. Type ${PREFIX}help`);
      return;
    }

    // Execute command
    const ctx: CommandContext = {
      wa,
      msg,
      cid: msg.cid,
      args,
      text: text.slice(PREFIX.length + command_name.length + 1),
    };

    try {
      await cmd.execute(ctx);
    } catch (error) {
      console.error(`Error in command ${cmd.name}:`, error);
      await wa.Message.text(msg.cid, "An error occurred while executing the command");
    }
  });

  // Connect
  await wa.pair(async (data) => {
    if (Buffer.isBuffer(data)) {
      writeFileSync("qr.png", data);
      console.log("Scan qr.png");
    }
  });

  console.log("Bot ready!");
}

main().catch(console.error);
```

---

## Adding new commands

### Command with arguments

```typescript title="src/commands/say.ts"
import { register_command } from "./index";

register_command({
  name: "say",
  description: "Repeat a message",
  aliases: ["echo"],
  async execute({ wa, cid, text }) {
    if (!text.trim()) {
      await wa.Message.text(cid, "Usage: !say <message>");
      return;
    }
    await wa.Message.text(cid, text);
  },
});
```

### Command with validation

```typescript title="src/commands/dice.ts"
import { register_command } from "./index";

register_command({
  name: "dice",
  description: "Roll a dice",
  aliases: ["roll"],
  async execute({ wa, cid, args }) {
    const sides = parseInt(args[0]) || 6;

    if (sides < 2 || sides > 100) {
      await wa.Message.text(cid, "Dice must have between 2 and 100 sides");
      return;
    }

    const result = Math.floor(Math.random() * sides) + 1;
    await wa.Message.text(cid, `${sides}-sided dice: ${result}`);
  },
});
```

### Groups only command

```typescript title="src/commands/group.ts"
import { register_command } from "./index";

register_command({
  name: "group",
  description: "Group information",
  aliases: ["g"],
  async execute({ wa, cid }) {
    // Only in groups
    if (!cid.endsWith("@g.us")) {
      await wa.Message.text(cid, "This command only works in groups");
      return;
    }

    const chat = await wa.Chat.get(cid);
    if (!chat) return;

    const members = await chat.members(0, 1000);

    await wa.Message.text(
      cid,
      `*${chat.name}*\n\n` +
      `Members: ${members.length}`
    );
  },
});
```

---

## Run

```bash
npx tsx src/index.ts
```

---

## Usage

```
!ping          -> pong!
!help          -> Command list
!time          -> 2:30:45 PM - Monday, January 1, 2025
!say Hello     -> Hello
!dice 20       -> 20-sided dice: 15
!group         -> Group information
```
