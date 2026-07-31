# Polls

Las encuestas en WhatsApp están cifradas end-to-end: cada voto se cifra en el dispositivo del votante
y solo el creador de la encuesta (y `@arcaelas/whatsapp` corriendo en su sesión)
puede descifrar el conteo. La librería maneja la derivación de claves y el descifrado de forma transparente
— solo tratas con `options`, `votes()` y `select()`.

!!! info "El cifrado es automático"
    La librería deriva la clave HMAC por encuesta, descifra los payloads entrantes de
    `pollUpdateMessage`, los fusiona en la encuesta almacenada y emite `message:updated`. Nunca
    necesitas tocar bytes crudos ni firmas de votos.

---

## Configuración

```typescript title="client.ts"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

export const wa = new WhatsApp({
    engine: new FileSystemEngine(__dirname + '/.session'),
    phone: 14155551234,
});

await wa.connect((auth) => {
    if (typeof auth === 'string') {
        console.log('Código de emparejamiento:', auth);
    }
});
```

---

## Crear una encuesta

`wa.Message.poll(cid, { content, options }, extra?)` publica una encuesta de opción única. `content`
es la pregunta; cada entrada de `options` es un objeto con un string `content`. Pasa
`{ multiple: true }` para permitir varias respuestas.

```typescript title="create-poll.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

await wa.Message.poll(GROUP_CID, {
    content: '¿Qué pedimos para el almuerzo?',
    options: [
        { content: 'Pizza' },
        { content: 'Sushi' },
        { content: 'Tacos' },
    ],
});

// Variante de selección múltiple
await wa.Message.poll(GROUP_CID, {
    content: '¿Qué días vienes a la oficina?',
    options: [{ content: 'Lun' }, { content: 'Mié' }, { content: 'Vie' }],
}, { multiple: true });
```

---

## Recibir votos

Los conteos de votos llegan como eventos `message:updated` sobre la encuesta original. Detéctalos con
`instanceof Poll` y luego lee `options` — cada entrada es `{ name, count }` — y la bandera
`multiple`.

```typescript title="watch-poll.ts"
import { Poll } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:updated', (msg, chat) => {
    if (msg instanceof Poll) {
        console.log(`[${chat.name}] ${msg.caption}`);
        console.log(`Modo: ${msg.multiple ? 'selección múltiple' : 'selección única'}`);
        for (const option of msg.options) {
            console.log(`  ${option.name}: ${option.count}`);
        }
    }
});
```

!!! tip "Filtrar una sola encuesta"
    No hay un helper de suscripción por mensaje. Guarda el id que te interesa y compáralo dentro del
    listener:

    ```typescript
    const off = wa.on('message:updated', (msg) => {
        if (msg instanceof Poll && msg.id === poll_id) {
            console.log(msg.options);
        }
    });

    off();   // desuscribirse cuando termines
    ```

---

## Quién votó qué

`votes()` desglosa el conteo por votante. Cada entrada es `{ name, contact }`, donde `name` es la
opción elegida y `contact` es el teléfono del votante.

```typescript title="votes.ts"
import { Poll } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:updated', async (msg) => {
    if (msg instanceof Poll) {
        for (const vote of await msg.votes()) {
            console.log(`${vote.contact} votó por ${vote.name}`);
        }
    }
});
```

---

## Votar programáticamente

Llama a `poll.select(index)` para emitir un voto de opción única, o `poll.select([i, j])` para
encuestas de selección múltiple. Los índices siguen el orden de `options`.

```typescript title="vote.ts"
import { Poll } from '@arcaelas/whatsapp';
import { wa } from './client';

const POLL_CID = '120363025912345678@g.us';
const POLL_MID = '3EB0C7689C2E0F5A4F4E';

const poll = await wa.Message.get(POLL_CID, POLL_MID);

if (poll instanceof Poll) {
    if (poll.multiple) {
        await poll.select([0, 2]); // primera y tercera opción
    } else {
        await poll.select(1);      // segunda opción
    }
}
```

!!! warning "`select()` es best-effort"
    El voto se cifra y se retransmite correctamente, pero WhatsApp **no** propaga un voto emitido
    desde un dispositivo vinculado (companion) — que es lo que esta librería es. Los votos entrantes
    se descifran bien; tu propio voto puede no aparecer en otros dispositivos. `select()` devuelve
    `false` cuando la encuesta no tiene clave de cifrado, no hay socket, o no se pasó ningún índice
    válido.

---

## Bot de voto automático (helper de pruebas)

Útil para tests de integración: cada vez que llega una encuesta a un chat vigilado, el bot
elige una opción válida al azar y vota. Demuestra crear + recibir + votar en un
solo ejemplo.

```typescript title="auto-vote-bot.ts"
import { Poll } from '@arcaelas/whatsapp';
import { wa } from './client';

const TEST_GROUP = '120363025912345678@g.us';

wa.on('message:created', async (msg) => {
    if (!(msg instanceof Poll)) {
        return;
    }
    if (msg.cid !== TEST_GROUP || msg.me) {
        return;
    }

    const total_options = msg.options.length;
    if (total_options === 0) {
        return;
    }

    if (msg.multiple) {
        // Elige un subconjunto aleatorio no vacío.
        const picks: number[] = [];
        for (let i = 0; i < total_options; i++) {
            if (Math.random() < 0.5) {
                picks.push(i);
            }
        }
        if (picks.length === 0) {
            picks.push(Math.floor(Math.random() * total_options));
        }
        await msg.select(picks);
    } else {
        await msg.select(Math.floor(Math.random() * total_options));
    }

    console.log(`Voto automático en "${msg.caption}"`);
});
```

---

## Citar una encuesta en una respuesta

Como toda subclase de `Message`, `Poll` hereda `text()`, `image()`, etc. — responder a una encuesta
la cita automáticamente.

```typescript title="reply-to-poll.ts"
import { Poll } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:updated', async (msg) => {
    if (!(msg instanceof Poll)) {
        return;
    }
    const total = msg.options.reduce((sum, option) => sum + option.count, 0);
    if (total >= 10) {
        await msg.text(`Cerramos la votación — tuvimos ${total} respuestas.`);
    }
});
```
