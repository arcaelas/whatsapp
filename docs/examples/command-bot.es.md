# Command Bot

Un bot que maneja comandos textuales como `/help`, `/ping`, `/info` y `/echo <text>` — sin decoradores. Solo el evento crudo `wa.on('message:created', ...)` y una pequeña tabla de despacho.

Este patrón es ideal cuando quieres control explícito sobre el enrutamiento, o cuando los decoradores no son una opción (p. ej. no estás usando TypeScript con `experimentalDecorators`).

---

## Ejemplo completo

```typescript title="index.ts"
import { join } from 'node:path';
import { WhatsApp, FileSystemEngine, type Message, type Chat } from '@arcaelas/whatsapp';

const PREFIX = '/';

type CommandHandler = (args: string, msg: Message, chat: Chat) => Promise<void>;

const wa = new WhatsApp({
    engine: new FileSystemEngine(join(__dirname, 'session')),
    phone: 584144709840,
});

const commands = new Map<string, CommandHandler>();

commands.set('help', async (_args, msg) => {
    await msg.text(
        [
            'Available commands:',
            '  /help          — show this message',
            '  /ping          — health check',
            '  /info          — chat metadata',
            '  /echo <text>   — repeat <text>',
        ].join('\n'),
    );
});

commands.set('ping', async (_args, msg) => {
    await msg.text('pong');
});

commands.set('info', async (_args, msg, chat) => {
    const total = await wa.Message.count(chat.id);
    await msg.text(
        [
            `chat:    ${chat.name}`,
            `id:      ${chat.id}`,
            `type:    ${chat.type}`,
            `stored:  ${total} messages`,
        ].join('\n'),
    );
});

commands.set('echo', async (args, msg) => {
    if (!args) {
        await msg.text('usage: /echo <text>');
        return;
    }
    await msg.text(args);
});

wa.on('message:created', async (msg, chat) => {
    if (msg.me) {
        return;
    }

    const text = msg.caption.trim();
    if (!text.startsWith(PREFIX)) {
        return;
    }

    const space = text.indexOf(' ');
    const name = (space === -1 ? text.slice(PREFIX.length) : text.slice(PREFIX.length, space)).toLowerCase();
    const args = space === -1 ? '' : text.slice(space + 1).trim();

    const handler = commands.get(name);
    if (!handler) {
        await msg.text(`unknown command: /${name} — try /help`);
        return;
    }

    try {
        await handler(args, msg, chat);
    } catch (err) {
        console.error(`[cmd:${name}] failed`, err);
        await msg.text('internal error');
    }
});

process.on('SIGINT', async () => {
    await wa.disconnect();
    process.exit(0);
});

wa.connect((auth) => {
    if (typeof auth === 'string') {
        console.log(`[wa] pairing code: ${auth}`);
    } else {
        console.log('[wa] scan the QR (PNG buffer received)');
    }
}).catch((err) => {
    console.error('[wa] connect failed:', err);
    process.exit(1);
});
```

---

## Anatomía del despachador

### 1. Registro

```typescript
const commands = new Map<string, CommandHandler>();
```

Un `Map` es suficiente: las claves son nombres de comandos, los valores son handlers async. Añadir un nuevo comando es una única llamada `commands.set(...)`. Sin reflexión, sin metadata.

### 2. Parsing

```typescript
const text = msg.caption.trim();
if (!text.startsWith(PREFIX)) {
    return;
}

const space = text.indexOf(' ');
const name = (space === -1 ? text.slice(PREFIX.length) : text.slice(PREFIX.length, space)).toLowerCase();
const args = space === -1 ? '' : text.slice(space + 1).trim();
```

Dividir en el **primer** whitespace da el nombre del comando y un único string de argumentos. Si necesitas parsing más rico (flags, strings entrecomillados) conecta un parser CLI como `minimist` o `yargs-parser` aquí.

### 3. Despacho

```typescript
const handler = commands.get(name);
if (!handler) {
    await msg.text(`unknown command: /${name} — try /help`);
    return;
}
```

Los comandos desconocidos reciben una pista amigable en lugar de silencio — mucho mejor UX que ignorarlos.

### 4. Aislamiento de errores

```typescript
try {
    await handler(args, msg, chat);
} catch (err) {
    console.error(`[cmd:${name}] failed`, err);
    await msg.text('internal error');
}
```

Un `try/catch` alrededor del handler evita que un único comando con bugs crashee todo el bot.

---

## Enviando sin citar

`msg.text(...)` siempre responde con una citación. Para enviar un mensaje independiente en el mismo chat usa el delegado estático:

```typescript
await wa.Message.text(chat.id, 'standalone message — no quote');
```

---

## ¿Y si quiero menos boilerplate?

Si estás escribiendo muchos comandos y quieres un estilo más declarativo, la librería incluye un decorador opcional `@command` que maneja el parsing, despacho y envoltorio de errores por ti.

!!! tip "Revisa el ejemplo de decoradores"
    Ver [`examples/decorator-bot.es.md`](./decorator-bot.es.md) para el mismo bot reescrito con `@command('help')`, `@command('echo')`, etc. La lógica de despacho desaparece por completo: solo declaras los métodos.

Para bots únicos o cuando necesitas control total sobre el enrutamiento, el patrón `Map` mostrado aquí sigue siendo la opción más simple y explícita.

---

## Siguientes pasos

- [Basic bot](./basic-bot.es.md) — aún más simple, sin comandos.
- [Custom engine](./custom-engine.es.md) — trae tu propio almacenamiento.
