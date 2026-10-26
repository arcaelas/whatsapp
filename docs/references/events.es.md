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
    console.log(`[${chat.id}] ${msg.caption()}`);
});

// más tarde
off();
```

---

## Conexión

| Evento          | Firma                | Se dispara cuando…                                                            |
| --------------- | -------------------- | ------------------------------------------------------------------------------ |
| `connected`     | `[wa]`               | El socket alcanza `connection === 'open'` y la sesión está lista.             |
| `disconnected`  | `[wa, farewell]`     | Ocurre un cierre no transitorio después de que la sesión estuvo en línea (la limpieza del motor ya terminó cuando se dispara). `farewell` dice por qué: `{ code, reason, expired, detail }`. |
| `error`         | `[error, wa]`        | Un fallo que no tumba la conexión pero que el consumidor necesita conocer, como `ERR_OTP_EXPIRED` (la propiedad `code` lleva el identificador). |

!!! info "Los cierres transitorios son silenciosos"
    El `restartRequired` (estado `515`) que exige el protocolo justo tras el sync inicial **no**
    dispara `disconnected`. La librería reconecta sin espera y el consumidor ve una sesión
    ininterrumpida. `disconnect({ silent: true })` también silencia el evento de ese cierre
    concreto.

```typescript title="Ciclo de vida de la conexión"
wa.on('connected',    (client) => console.log('online'));
wa.on('disconnected', (client, farewell) => console.log('offline', farewell.reason, farewell.code, farewell.expired));
wa.on('error',        (error) => console.error(error.code, error.message));
```

---

## Contactos

| Evento             | Firma                      | Se dispara cuando…                                                       |
| ------------------ | -------------------------- | -------------------------------------------------------------------------- |
| `contact:created`  | `[contact, chat, wa]`      | Se registra un contacto nuevo, o se autocrea desde un mensaje entrante.   |
| `contact:updated`  | `[contact, chat, wa]`      | Cambia el nombre, el notify, la imagen, el estado o el LID de un contacto; también cuando `content()` lee una biografía distinta de la guardada.|
| `contact:deleted`  | `[contact, wa]`            | Una ficha sale del motor: la guardada bajo el LID, cuando WhatsApp revela su teléfono y la ficha se une a la del teléfono. |
| `contact:presence` | `[contact, action, wa]`    | Alguien entró, salió, escribe o graba. Solo llega de los contactos suscritos con `contact.sub()`; `action` es `online`, `offline`, `typing` o `recording` —dejar de escribir o de grabar llega como `online`—, y `offline` guarda la última conexión del contacto en `contact.seen`. |

El argumento `chat` es el chat 1:1 del contacto (construido desde la caché cuando hace falta), así
que puedes responder o leer el historial sin un lookup adicional.

```typescript title="Saludar a los contactos nuevos"
wa.on('contact:created', async (contact, chat, client) => {
    await client.Message.text(chat.id, `Welcome, ${contact.name}!`);
});
```

---

## Chats

| Evento             | Firma            | Se dispara cuando…                                                                        |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------ |
| `chat:created`     | `[chat, wa]`     | Se registra un chat nuevo, o se autocrea desde un mensaje entrante.                        |
| `chat:deleted`     | `[chat, wa]`     | Baileys reporta la eliminación de un chat (`chats.delete`), o un chat guardado bajo un LID se une al de su teléfono. |
| `chat:pinned`      | `[chat, wa]`     | El chat pasa de no fijado a fijado.                                                        |
| `chat:unpinned`    | `[chat, wa]`     | El chat pasa de fijado a no fijado.                                                        |
| `chat:archived`    | `[chat, wa]`     | El chat pasa de no archivado a archivado.                                                  |
| `chat:unarchived`  | `[chat, wa]`     | El chat pasa de archivado a no archivado.                                                  |
| `chat:muted`       | `[chat, wa]`     | El chat pasa de no silenciado a silenciado: un `muteEndTime` en el futuro.                 |
| `chat:unmuted`     | `[chat, wa]`     | El chat pasa de silenciado a no silenciado: `muteEndTime` limpio o en el pasado.           |
| `chat:updated`     | `[chat, wa]`     | Un grupo cambió de nombre o de descripción.                                                |
| `chat:joined`      | `[chat, contacts, wa]` | Entraron personas a un grupo — invitadas, agregadas o por enlace. `contacts` dice quiénes. |
| `chat:left`        | `[chat, contacts, wa]` | Personas salieron de un grupo o fueron expulsadas, la cuenta incluida.                |
| `chat:promoted`    | `[chat, contacts, wa]` | Personas pasaron a administrar el grupo.                                              |
| `chat:demoted`     | `[chat, contacts, wa]` | Personas dejaron de administrar el grupo.                                             |

Los seis eventos de fijado, archivado y silencio salen solo cuando el valor cambia de verdad: un
cambio hecho con `chat.pinned()`, `chat.archived()` o `chat.muted()` los emite en cuanto WhatsApp lo
acepta, y uno hecho desde otro dispositivo, con el eco de WhatsApp; el eco de un cambio propio ya no
encuentra diferencia y no los repite.

```typescript title="Auditar la moderación de chats"
wa.on('chat:archived',   (chat) => console.log('archived',   chat.id));
wa.on('chat:unarchived', (chat) => console.log('unarchived', chat.id));
wa.on('chat:muted',      (chat) => console.log('muted until', chat.muted()));
wa.on('chat:joined',     (chat, people) => console.log(people.map((who) => who.name), 'joined', chat.name()));
wa.on('chat:promoted',   (chat, people) => console.log(people.map((who) => who.name), 'now admin in', chat.name()));
```

---

## Mensajes

| Evento               | Firma                           | Se dispara cuando…                                                                 |
| -------------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| `message:created`    | `[message, chat, wa]`           | Se guarda un mensaje nuevo: entrante, o saliente desde el teléfono u otro dispositivo vinculado. Los mensajes enviados con esta librería no lo emiten. |
| `message:updated`    | `[message, chat, wa]`           | Un mensaje se edita, cambia su estado, se descifra un voto de encuesta o una respuesta a un evento, o se fija o se suelta. |
| `message:deleted`    | `[message, chat, wa]`           | Un mensaje se revoca (`protocolMessage.REVOKE`). El documento se conserva, marcado con `revoked_at`. |
| `message:reacted`    | `[message, chat, emoji, contact, wa]` | Llega una reacción. `emoji` es `''` cuando la reacción se retira; `contact` es quien reaccionó, así el eco de una propia se distingue de una real. |
| `message:starred`    | `[message, chat, wa]`           | Un mensaje se destaca.                                                              |
| `message:unstarred`  | `[message, chat, wa]`           | Un mensaje deja de estar destacado.                                                 |
| `message:forwarded`  | `[message, chat, wa]`           | Un mensaje recién almacenado llegó reenviado (`forward()` es `true`) (se emite justo después de `message:created`). |
| `message:seen`       | `[message, chat, wa]`           | Se observa un receipt de lectura o reproducción del mensaje.                        |

```typescript title="Bot que responde a las menciones" hl_lines="2"
wa.on('message:created', async (msg, chat) => {
    if (!msg.me && msg.caption().toLowerCase().includes('@bot')) {
        await msg.text('here!');
    }
});

wa.on('message:reacted', (msg, chat, emoji, who) => {
    console.log(`${who.name} reacted ${emoji || '∅'} on ${msg.id}`);
});
```

!!! warning "Protégete de tus propios mensajes"
    `message:created` también se dispara con lo que la cuenta envía desde el teléfono u otro
    dispositivo vinculado, con `msg.me` en `true`. Sin un chequeo `!msg.me` un bot responde los
    mensajes de su propia cuenta.

---

## Estados

| Evento         | Firma          | Se dispara cuando…                                              |
| -------------- | -------------- | ----------------------------------------------------------------- |
| `feed:created` | `[feed, wa]`   | Llega un estado, o publicas uno con `Feed.create()`.                 |
| `feed:updated` | `[feed, wa]`   | El estado se marca como visto, por `seen(true)` o por un read receipt, o alguien reacciona a él. |
| `feed:deleted` | `[feed, wa]`   | El autor revoca el estado.                                       |

Los estados nunca emiten `message:*`, y su payload **no lleva chat**. Ver [Feed](feed.es.md).

```typescript title="Observar estados"
wa.on('feed:created', async (post) => {
    console.log((await post.author()).name, post.caption);
    await post.seen(true);
});
```

---

## Catálogos

| Evento            | Firma           | Se dispara cuando…                                                                              |
| ----------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `catalog:updated` | `[catalog, wa]` | Una descarga posterior del catálogo de un negocio trae algo distinto para esa colección.        |

Las descargas posteriores a la primera ocurren de fondo, cuando `contact.catalog()` lee un catálogo
guardado con más de 24 horas. La primera descarga de un negocio y una colección que no existía
antes no lo emiten. `catalog.sub()` lo acota a un solo catálogo. Ver [Catalog](catalog.es.md).

```typescript title="Seguir los cambios del catálogo"
wa.on('catalog:updated', async (catalog) => {
    console.log((await catalog.contact()).name, catalog.name, catalog.updated_at);
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
    'connected', 'disconnected', 'error',
    'contact:created', 'contact:updated', 'contact:deleted', 'contact:presence',
    'chat:created', 'chat:updated', 'chat:deleted',
    'chat:joined', 'chat:left', 'chat:promoted', 'chat:demoted',
    'chat:pinned', 'chat:unpinned',
    'chat:archived', 'chat:unarchived',
    'chat:muted', 'chat:unmuted',
    'message:created', 'message:updated', 'message:deleted',
    'message:reacted',
    'message:starred', 'message:unstarred',
    'message:forwarded', 'message:seen',
    'feed:created', 'feed:updated', 'feed:deleted',
    'catalog:updated',
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

`wa.once(event, handler)` se dispara como máximo una vez y luego se autodesconecta. La función que
devuelve `once` te permite cancelar la suscripción antes de que el evento llegue:

```typescript title="Esperar el primer mensaje"
const cancel = wa.once('message:created', (msg, chat) => {
    console.log('first message:', chat.id, msg.caption());
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
    - `message:reacted`   → `[message, chat, emoji, contact, wa]`
    - `contact:*`         → `[contact, chat, wa]`
    - `contact:deleted`   → `[contact, wa]`
    - `contact:presence`  → `[contact, action, wa]`
    - `chat:*`            → `[chat, wa]`
    - `chat:joined` / `chat:left` / `chat:promoted` / `chat:demoted` → `[chat, contacts, wa]`
    - `feed:*`            → `[feed, wa]`
    - `catalog:updated`   → `[catalog, wa]`
    - `connected`         → `[wa]`
    - `disconnected`      → `[wa, farewell]`
    - `error`             → `[error, wa]`
