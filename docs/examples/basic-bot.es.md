# Basic Bot

Un ejemplo mínimo end-to-end: un único archivo que se conecta a WhatsApp, loggea cada mensaje entrante y responde `pong` cada vez que recibe `ping`.

Este es el "hola mundo" de `@arcaelas/whatsapp` v3. Todo lo que necesitas vive en un solo archivo: creación del motor, handlers de eventos, una respuesta y un apagado limpio.

---

## Ejemplo completo

```typescript title="index.ts"
import { join } from 'node:path';
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new FileSystemEngine(join(__dirname, 'session')),
    phone: 584144709840,
});

wa.on('connected', () => {
    console.log('[wa] connected');
});

wa.on('disconnected', () => {
    console.log('[wa] disconnected');
});

wa.on('message:created', async (msg, chat, wa) => {
    if (msg.me) {
        return;
    }

    console.log(`[${chat.name}] ${msg.caption}`);

    if (msg.caption.trim().toLowerCase() === 'ping') {
        await msg.text('pong');
    }
});

process.on('SIGINT', async () => {
    console.log('\n[wa] shutting down...');
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

Ejecútalo:

```bash
npx tsx index.ts
```

---

## Cómo funciona

### 1. Engine

```typescript
engine: new FileSystemEngine(join(__dirname, 'session')),
```

El motor es la capa de persistencia. `FileSystemEngine` escribe credenciales, chats, contactos y mensajes bajo el directorio que le das. Elimina ese directorio y la siguiente ejecución comenzará una sesión fresca.

### 2. Phone vs QR

```typescript
phone: 584144709840,
```

Cuando `phone` está establecido, el primer connect emite un **PIN** (string); tipéalo en WhatsApp bajo *Dispositivos vinculados > Vincular con número de teléfono*. Omite `phone` y recibirás un **Buffer PNG** con el código QR.

!!! tip "Consejo"
    Durante el desarrollo, escanea un QR fresco con la app móvil de WhatsApp para confirmar el flujo de PIN. Una vez emparejado, el motor recuerda la sesión y se salta este paso en cada ejecución subsecuente.

### 3. Eventos de ciclo de vida

```typescript
wa.on('connected', ...)
wa.on('disconnected', ...)
```

`connected` se dispara una vez que la sesión se ha sincronizado completamente y el bot está listo para enviar/recibir. `disconnected` se dispara en cualquier cierre no transitorio (el cliente autoreconecta en cierres transitorios por defecto).

### 4. Mensajes entrantes

```typescript
wa.on('message:created', async (msg, chat, wa) => {
    if (msg.me) {
        return;
    }
    // ...
});
```

Cada oyente recibe el artefacto, el chat y la instancia del cliente. El guard `!msg.me` es esencial — sin él el bot reaccionará a sus propios mensajes salientes y entrará en loop infinito.

### 5. Respondiendo

```typescript
await msg.text('pong');
```

`msg.text(...)` es una respuesta citada: el mensaje original aparece como una citación. Para enviar un mensaje independiente, usa `wa.Message.text(chat.id, 'pong')`.

### 6. Apagado limpio

```typescript
process.on('SIGINT', async () => {
    await wa.disconnect();
    process.exit(0);
});
```

`disconnect()` cierra el socket limpiamente y cancela cualquier timer de reconexión pendiente. Pasa `{ destroy: true }` si quieres borrar el motor al salir (útil para tests).

---

## Siguientes pasos

- [Command bot](./command-bot.es.md) — parsea `/help`, `/ping`, `/echo` y despacha handlers.
- [Custom engine](./custom-engine.es.md) — implementa tu propio backend de almacenamiento.
