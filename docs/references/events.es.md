# Events

`WhatsApp` expone una API de eventos tipada sobre la propia instancia. Usa `wa.on(event, handler)` para
suscribirte; la llamada devuelve una **función de desuscripción** para que puedas desconectar el oyente sin
mantener una referencia al handler original. `wa.once(event, handler)` funciona del mismo modo y se
autodesconecta tras el primer disparo.

Cada payload de evento termina con la instancia de `WhatsApp` como **último argumento**, lo que hace
ergonómicos los handlers inline sin cerrar sobre `wa` desde el ámbito exterior.

---

## Importación

```typescript title="ESM / TypeScript"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({ engine: new FileSystemEngine('./data/wa') });
```

---

## API

| Método               | Devuelve       | Descripción                                                            |
| -------------------- | -------------- | ---------------------------------------------------------------------- |
| `wa.on(event, h)`    | `() => void`   | Registra un oyente. Llama a la función devuelta para desconectarlo.    |
| `wa.once(event, h)`  | `() => void`   | Registra un oyente de un solo disparo. La función devuelta lo desconecta antes. |
| `wa.off(event, h)`   | `this`         | Elimina un oyente previamente registrado.                              |

```typescript title="Suscribirse y desuscribirse"
const off = wa.on('message:created', (msg, chat) => {
    console.log(`[${chat.id}] ${msg.caption}`);
});

// luego
off();
```

---

## Conexión

| Evento          | Signatura       | Se dispara cuando...                                                         |
| --------------- | --------------- | ---------------------------------------------------------------------------- |
| `connected`     | `[wa]`          | El socket alcanza `connection === 'open'` y la sesión está lista.            |
| `disconnected`  | `[wa]`          | Ocurre un cierre no transitorio después de que la sesión estaba en línea (la limpieza del motor ya se completó cuando esto se dispara). |

!!! info "Los cierres transitorios son silenciosos"
    El `restartRequired` obligatorio del protocolo (status `515`) justo después de la sincronización inicial **no**
    dispara `disconnected`. La librería reconecta con cero delay y el consumidor
    ve una sesión ininterrumpida.

```typescript title="Ciclo de vida de conexión"
wa.on('connected',    (client) => console.log('online'));
wa.on('disconnected', (client) => console.log('offline'));
```

---

## Contacts

| Evento             | Signatura                | Se dispara cuando...                                                   |
| ------------------ | ------------------------ | ---------------------------------------------------------------------- |
| `contact:created`  | `[contact, chat, wa]`    | Un nuevo contacto es insertado, o auto-creado desde un mensaje entrante. |
| `contact:updated`  | `[contact, chat, wa]`    | El nombre, notify, imagen, status o LID de un contacto cambia.          |
| `contact:deleted`  | `[contact, chat, wa]`    | Baileys reporta una eliminación de contacto (`contacts.delete`).       |

El argumento `chat` es el chat 1:1 del contacto (creado al vuelo desde la caché cuando se necesita),
para que puedas responder o traer el historial sin un lookup extra.

```typescript title="Saludar a nuevos contactos"
wa.on('contact:created', async (contact, chat) => {
    await chat.text(`Welcome, ${contact.name ?? contact.notify ?? 'friend'}!`);
});
```

---

## Chats

| Evento             | Signatura        | Se dispara cuando...                                                                     |
| ------------------ | ---------------- | ---------------------------------------------------------------------------------------- |
| `chat:created`     | `[chat, wa]`     | Un nuevo chat es insertado, o auto-creado desde un mensaje entrante.                     |
| `chat:deleted`     | `[chat, wa]`     | Baileys reporta una eliminación de chat (`chats.delete`).                                |
| `chat:pinned`      | `[chat, wa]`     | El chat es fijado.                                                                       |
| `chat:unpinned`    | `[chat, wa]`     | El chat es desfijado.                                                                    |
| `chat:archived`    | `[chat, wa]`     | El chat es archivado.                                                                    |
| `chat:unarchived`  | `[chat, wa]`     | El chat es desarchivado.                                                                 |
| `chat:muted`       | `[chat, wa]`     | Se observa un `muteEndTime` en el futuro.                                                |
| `chat:unmuted`     | `[chat, wa]`     | `muteEndTime` es limpiado o establecido en el pasado.                                    |

```typescript title="Auditar moderación de chats"
wa.on('chat:archived',   (chat) => console.log('archived',   chat.id));
wa.on('chat:unarchived', (chat) => console.log('unarchived', chat.id));
```

---

## Messages

| Evento               | Signatura                       | Se dispara cuando...                                                              |
| -------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| `message:created`    | `[message, chat, wa]`           | Un nuevo mensaje es insertado (entrante o saliente).                              |
| `message:updated`    | `[message, chat, wa]`           | Un mensaje es editado, tiene un cambio de estado o su contenido se actualiza (ubicación en vivo). |
| `message:deleted`    | `[message, chat, wa]`           | Un mensaje es revocado (`protocolMessage.REVOKE`).                                |
| `message:reacted`    | `[message, chat, emoji, wa]`    | Llega una reacción. `emoji` es `''` cuando la reacción se elimina.                |
| `message:starred`    | `[message, chat, wa]`           | Un mensaje es destacado.                                                          |
| `message:unstarred`  | `[message, chat, wa]`           | A un mensaje se le quita el destacado.                                            |
| `message:forwarded`  | `[message, chat, wa]`           | Un mensaje entrante lleva la bandera `forwarded`.                                 |
| `message:seen`       | `[message, chat, wa]`           | Se observa un recibo de lectura o reproducción para el mensaje.                   |

```typescript title="Bot react-when-mentioned" hl_lines="3"
wa.on('message:created', async (msg, chat) => {
    if (msg.caption?.toLowerCase().includes('@bot')) {
        await chat.text('here!');
    }
});

wa.on('message:reacted', (msg, chat, emoji) => {
    console.log(`Reacted ${emoji || '∅'} on ${msg.id}`);
});
```

---

## Escuchar todos los eventos

Como los nombres de eventos forman un conjunto conocido, puedes adjuntar un oyente a cada uno con un
solo bucle. El ejemplo de abajo loggea cada evento que fluye por el cliente — útil para
debugging.

```typescript title="Trazar todos los eventos"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({ engine: new FileSystemEngine('./data/wa') });

const events = [
    'connected', 'disconnected',
    'contact:created', 'contact:updated', 'contact:deleted',
    'chat:created', 'chat:deleted',
    'chat:pinned', 'chat:unpinned',
    'chat:archived', 'chat:unarchived',
    'chat:muted', 'chat:unmuted',
    'message:created', 'message:updated', 'message:deleted',
    'message:reacted',
    'message:starred', 'message:unstarred',
    'message:forwarded', 'message:seen',
] as const;

for (const event of events) {
    wa.on(event, (...args) => {
        console.log(`[${event}]`, args.length, 'args');
    });
}

await wa.connect((qr) => console.log('QR length:', (qr as Buffer).length));
```

---

## Semántica de `once`

`wa.once(event, handler)` se dispara como máximo una vez y luego se autodesconecta. La función devuelta por
`once` te permite cancelar la suscripción antes de que el evento siquiera llegue:

```typescript title="Esperar al primer mensaje"
const cancel = wa.once('message:created', (msg, chat) => {
    console.log('first message:', chat.id, msg.caption);
});

// Opcional: abortar antes de que llegue cualquier mensaje.
setTimeout(cancel, 60_000);
```

---

## Migración desde v2

!!! warning "Cambio de signatura"
    En v2, los handlers de mensaje y contacto recibían `[entity, wa]`. En v3, el **chat** ahora se
    inserta justo antes de `wa`:

    - `message:*`  → `[message, chat, wa]`
    - `contact:*`  → `[contact, chat, wa]`
    - `message:reacted` → `[message, chat, emoji, wa]`

    Actualiza las listas de parámetros de tus handlers al actualizar.
