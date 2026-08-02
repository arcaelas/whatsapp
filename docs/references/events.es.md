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

| Método                 | Devuelve       | Descripción                                                              |
| ---------------------- | -------------- | -------------------------------------------------------------------------- |
| `wa.on(event, h)`      | `() => void`   | Registra un listener. Llama a la función devuelta para desengancharlo.    |
| `wa.once(event, h)`    | `() => void`   | Registra un listener de un solo disparo. La función devuelta lo cancela.  |
| `wa.off(event, h)`     | `this`         | Elimina un listener registrado previamente.                               |
| `wa.emit(event, …)`    | `boolean`      | Emite un evento; `true` si había listeners.                               |

```typescript title="Suscribir y desuscribir"
const off = wa.on('message:created', (msg, chat) => {
    console.log(`[${chat.id}] ${msg.caption}`);
});

// más tarde
off();
```

---

## Conexión

| Evento          | Firma           | Se dispara cuando…                                                            |
| --------------- | --------------- | ------------------------------------------------------------------------------ |
| `connected`     | `[wa]`          | El socket alcanza `connection === 'open'` y la sesión está lista.             |
| `disconnected`  | `[wa]`          | Ocurre un cierre no transitorio después de que la sesión estuvo en línea (la limpieza del motor ya terminó cuando se dispara). |

!!! info "Los cierres transitorios son silenciosos"
    El `restartRequired` (estado `515`) que exige el protocolo justo tras el sync inicial **no**
    dispara `disconnected`. La librería reconecta sin espera y el consumidor ve una sesión
    ininterrumpida. `disconnect({ silent: true })` también silencia el evento de ese cierre
    concreto.

```typescript title="Ciclo de vida de la conexión"
wa.on('connected',    (client) => console.log('online'));
wa.on('disconnected', (client) => console.log('offline'));
```

---

## Contactos

| Evento             | Firma                    | Se dispara cuando…                                                       |
| ------------------ | ------------------------ | -------------------------------------------------------------------------- |
| `contact:created`  | `[contact, chat, wa]`    | Se registra un contacto nuevo, o se autocrea desde un mensaje entrante.   |
| `contact:updated`  | `[contact, chat, wa]`    | Cambia el nombre, el notify, la imagen, el estado o el LID de un contacto.|

El argumento `chat` es el chat 1:1 del contacto (construido desde la caché cuando hace falta), así
que puedes responder o leer el historial sin un lookup adicional.

```typescript title="Saludar a los contactos nuevos"
wa.on('contact:created', async (contact, chat, client) => {
    await client.Message.text(chat.id, `¡Bienvenido, ${contact.name}!`);
});
```

---

## Chats

| Evento             | Firma            | Se dispara cuando…                                                                        |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------ |
| `chat:created`     | `[chat, wa]`     | Se registra un chat nuevo, o se autocrea desde un mensaje entrante.                        |
| `chat:deleted`     | `[chat, wa]`     | Baileys reporta la eliminación de un chat (`chats.delete`).                                |
| `chat:pinned`      | `[chat, wa]`     | El chat se fija.                                                                           |
| `chat:unpinned`    | `[chat, wa]`     | El chat se desfija.                                                                        |
| `chat:archived`    | `[chat, wa]`     | El chat se archiva.                                                                        |
| `chat:unarchived`  | `[chat, wa]`     | El chat se desarchiva.                                                                     |
| `chat:muted`       | `[chat, wa]`     | Se observa un `muteEndTime` en el futuro.                                                  |
| `chat:unmuted`     | `[chat, wa]`     | `muteEndTime` se limpia o queda en el pasado.                                              |

```typescript title="Auditar la moderación de chats"
wa.on('chat:archived',   (chat) => console.log('archivado',   chat.id));
wa.on('chat:unarchived', (chat) => console.log('desarchivado', chat.id));
wa.on('chat:muted',      (chat) => console.log('silenciado hasta', chat.muted));
```

---

## Mensajes

| Evento               | Firma                           | Se dispara cuando…                                                                 |
| -------------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| `message:created`    | `[message, chat, wa]`           | Se registra un mensaje nuevo (entrante o saliente).                                 |
| `message:updated`    | `[message, chat, wa]`           | Un mensaje se edita, cambia su estado, se actualiza su contenido (ubicación en vivo) o se descifra un voto de encuesta. |
| `message:deleted`    | `[message, chat, wa]`           | Un mensaje se revoca (`protocolMessage.REVOKE`).                                    |
| `message:reacted`    | `[message, chat, emoji, wa]`    | Llega una reacción. `emoji` es `''` cuando la reacción se retira.                   |
| `message:starred`    | `[message, chat, wa]`           | Un mensaje se destaca.                                                              |
| `message:unstarred`  | `[message, chat, wa]`           | Un mensaje deja de estar destacado.                                                 |
| `message:forwarded`  | `[message, chat, wa]`           | Un mensaje recién almacenado trae la bandera `forwarded` (se emite justo después de `message:created`). |
| `message:seen`       | `[message, chat, wa]`           | Se observa un receipt de lectura o reproducción del mensaje.                        |

```typescript title="Bot que responde a las menciones" hl_lines="2"
wa.on('message:created', async (msg, chat) => {
    if (!msg.me && msg.caption.toLowerCase().includes('@bot')) {
        await msg.text('¡acá estoy!');
    }
});

wa.on('message:reacted', (msg, chat, emoji) => {
    console.log(`Reaccionaron ${emoji || '∅'} en ${msg.id}`);
});
```

!!! warning "Protégete de tus propios mensajes"
    `message:created` también se dispara con los mensajes salientes. Sin un chequeo `!msg.me` un bot
    se responde a sí mismo en bucle.

---

## Estados

| Evento         | Firma          | Se dispara cuando…                                              |
| -------------- | -------------- | ----------------------------------------------------------------- |
| `feed:created` | `[feed, wa]`   | Llega un estado, o publicas uno con `account.post()`.                |
| `feed:updated` | `[feed, wa]`   | El estado se marca como visto, o alguien reacciona a él.        |
| `feed:deleted` | `[feed, wa]`   | El autor revoca el estado.                                       |

Los estados nunca emiten `message:*`, y su payload **no lleva chat**. Ver [Feed](feed.es.md).

```typescript title="Observar estados"
wa.on('feed:created', async (post) => {
    console.log((await post.author()).name, post.caption);
    await post.view();
});
```

---

## Escuchar todos los eventos

Como los nombres de eventos forman un conjunto conocido, puedes enganchar un listener a cada uno con
un solo bucle. El ejemplo de abajo registra cada evento que fluye por el cliente — útil para
depurar.

```typescript title="Trazar todos los eventos"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({ engine: new FileSystemEngine('./data/wa') });

const events = [
    'connected', 'disconnected',
    'contact:created', 'contact:updated',
    'chat:created', 'chat:deleted',
    'chat:pinned', 'chat:unpinned',
    'chat:archived', 'chat:unarchived',
    'chat:muted', 'chat:unmuted',
    'message:created', 'message:updated', 'message:deleted',
    'message:reacted',
    'message:starred', 'message:unstarred',
    'message:forwarded', 'message:seen',
    'feed:created', 'feed:updated', 'feed:deleted',
] as const;

for (const event of events) {
    wa.on(event, (...args) => {
        console.log(`[${event}]`, args.length, 'args');
    });
}

await wa.connect((qr) => console.log('Tamaño del QR:', (qr as Buffer).length));
```

---

## Semántica de `once`

`wa.once(event, handler)` se dispara como máximo una vez y luego se autodesconecta. La función que
devuelve `once` te permite cancelar la suscripción antes de que el evento llegue:

```typescript title="Esperar el primer mensaje"
const cancel = wa.once('message:created', (msg, chat) => {
    console.log('primer mensaje:', chat.id, msg.caption);
});

// Opcional: abandonar antes de que llegue ningún mensaje.
setTimeout(cancel, 60_000);
```

---

## Forma del payload

!!! info "Entidad, contexto, cliente"
    Todos los payloads siguen el mismo orden: el **artefacto** primero, su **contexto** en el medio
    (el chat, y el emoji en las reacciones) y el **cliente** al final.

    - `message:*`         → `[message, chat, wa]`
    - `message:reacted`   → `[message, chat, emoji, wa]`
    - `contact:*`         → `[contact, chat, wa]`
    - `chat:*`            → `[chat, wa]`
    - `feed:*`            → `[feed, wa]`
    - `connected` / `disconnected` → `[wa]`
