# Polls

Las encuestas en WhatsApp están cifradas end-to-end: cada voto se cifra en el dispositivo del votante
y solo el creador de la encuesta (y `@arcaelas/whatsapp` corriendo en su sesión)
puede descifrar el conteo. La librería maneja la derivación de claves y el descifrado de forma transparente
— solo tratas con `content`, `options` y `count`.

!!! info "El cifrado es automático"
    La librería deriva la clave HMAC por encuesta, descifra los payloads entrantes de
    `pollUpdateMessage` y los fusiona en la instancia original de `Poll`.
    Nunca necesitas tocar bytes crudos ni firmas de votos.

---

## Configuración

```typescript title="client.ts"
import { WhatsApp } from '@arcaelas/whatsapp';
import { FileSystemEngine } from '@arcaelas/whatsapp/engines';

export const wa = new WhatsApp({
    engine: new FileSystemEngine(__dirname),
    phone: 14155551234,
});

await wa.connect((auth) => {
    if (typeof auth === 'string') {
        console.log('Pair code:', auth);
    }
});
```

---

## Crear una encuesta

`wa.Message.poll(cid, { content, options })` publica una encuesta de elección única. `content`
es la pregunta; cada entrada en `options` es un objeto con un string `content`.

```typescript title="create-poll.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

await wa.Message.poll(GROUP_CID, {
    content: 'What should we order for lunch?',
    options: [
        { content: 'Pizza' },
        { content: 'Sushi' },
        { content: 'Tacos' },
    ],
});
```

---

## Recibir votos

Los conteos de votos llegan como eventos `message:updated` sobre la encuesta original. Detéctalos con
`instanceof wa.Message.Poll`, luego lee `options` (cada entrada es `{ content, count }`)
y la bandera `multiple`.

```typescript title="watch-poll.ts"
import { wa } from './client';

wa.on('message:updated', (msg, chat) => {
    if (!(msg instanceof wa.Message.Poll)) {
        return;
    }
    console.log(`[${chat.name}] ${msg.caption}`);
    console.log(`Mode: ${msg.multiple ? 'multi-select' : 'single-select'}`);
    for (const option of msg.options) {
        console.log(`  ${option.content}: ${option.count}`);
    }
});
```

!!! tip "Suscripción por mensaje"
    Si solo te importa una encuesta específica, usa `poll.watch(handler)` después de crearla
    — la librería devuelve una función de desuscripción y solo se dispara para ese mensaje exacto.

---

## Votar programáticamente

Llama a `poll.select(index)` para emitir un voto de elección única, o `poll.select([i, j])` para
encuestas multi-select. Los índices mapean al orden de `options` en el `PollOptions`
original.

```typescript title="vote.ts"
import { wa } from './client';

const POLL_CID = '120363025912345678@g.us';
const POLL_MID = '3EB0C7689C2E0F5A4F4E';

const poll = await wa.Message.get(POLL_CID, POLL_MID);
if (poll instanceof wa.Message.Poll) {
    if (poll.multiple) {
        await poll.select([0, 2]); // primera y tercera opción
    } else {
        await poll.select(1); // segunda opción
    }
}
```

---

## Bot de auto-voto (helper de tests)

Útil para tests de integración: cada vez que llega una encuesta en un chat observado, el bot
elige una opción válida al azar y vota. Demuestra crear + recibir + votar en un
solo ejemplo.

```typescript title="auto-vote-bot.ts"
import { wa } from './client';

const TEST_GROUP = '120363025912345678@g.us';

wa.on('message:created', async (msg) => {
    if (!(msg instanceof wa.Message.Poll)) {
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
        // Elegir un subconjunto no vacío aleatorio.
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
        const choice = Math.floor(Math.random() * total_options);
        await msg.select(choice);
    }

    console.log(`Auto-voted on "${msg.caption}"`);
});
```

---

## Citar una encuesta en una respuesta

Como cada subclase de `Message`, `Poll` hereda `text()`, `image()`, etc. — responder
a una encuesta la cita automáticamente.

```typescript title="reply-to-poll.ts"
import { wa } from './client';

wa.on('message:updated', async (msg) => {
    if (!(msg instanceof wa.Message.Poll)) {
        return;
    }
    const total = msg.options.reduce((sum, o) => sum + o.count, 0);
    if (total >= 10) {
        await msg.text(`Closing the vote — we got ${total} responses.`);
    }
});
```
