# Media

Envía y recibe imágenes, videos, audio (incluyendo notas de voz), ubicaciones, y reenvía
medios existentes entre chats.

Todos los medios se envían como un `Buffer` — la librería no lee desde disco por ti, por lo que
tú controlas cómo llegan los bytes (filesystem, HTTP, S3, pipe FFmpeg, etc.).

!!! info "Límites de tamaño"
    WhatsApp aplica topes duros sobre los payloads de medios:

    - **Imágenes** ~5 MB
    - **Videos** ~16 MB
    - **Audio / notas de voz** ~16 MB
    - **Documentos** ~100 MB

    Cualquier cosa más grande es rechazada por el servidor antes de la entrega. Comprime o transcodifica
    antes de enviar.

!!! warning "Sin API de documentos"
    `@arcaelas/whatsapp` v3 no expone un método de envío `document`. Solo
    `text`, `image`, `video`, `audio`, `location` y `poll` están soportados.

---

## Configuración

Cada snippet abajo asume el mismo cliente. Instáncialo una vez y reutilízalo:

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

## Imágenes

Envía una imagen con un caption opcional. El primer argumento es el CID de destino, el
segundo es el buffer binario.

```typescript title="send-image.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

const buffer = await readFile('./assets/sunset.jpg');

await wa.Message.image('14155557777@s.whatsapp.net', buffer, {
    caption: 'Sunset from the office today',
});
```

Detecta imágenes entrantes con `instanceof wa.Message.Image`, luego llama a `content()` para
descargar los bytes:

```typescript title="receive-image.ts"
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { wa } from './client';

wa.on('message:created', async (msg, chat) => {
    if (msg instanceof wa.Message.Image) {
        const bytes = await msg.content();
        const path = join('./inbox', `${msg.id}.jpg`);
        await writeFile(path, bytes);
        console.log(`Saved ${bytes.length} bytes from ${chat.name}`);
        if (msg.caption) {
            console.log('Caption:', msg.caption);
        }
    }
});
```

---

## Videos

Misma forma que las imágenes. Proporciona un buffer MP4; el servidor se encarga de la generación
de thumbnail.

```typescript title="send-video.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

const clip = await readFile('./assets/demo.mp4');

await wa.Message.video('14155557777@s.whatsapp.net', clip, {
    caption: 'Quick demo of the new flow',
});
```

```typescript title="receive-video.ts"
import { createWriteStream } from 'node:fs';
import { wa } from './client';

wa.on('message:created', async (msg) => {
    if (msg instanceof wa.Message.Video) {
        // Stream directo a disco — útil para clips grandes.
        const out = createWriteStream(`./inbox/${msg.id}.mp4`);
        const stream = await msg.stream();
        stream.pipe(out);
    }
});
```

---

## Audio y notas de voz

El audio por defecto es **push-to-talk** (nota de voz). Pasa `ptt: false` para un adjunto de audio
regular.

```typescript title="send-voice-note.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

const ogg = await readFile('./assets/reply.ogg');

// Nota de voz (por defecto)
await wa.Message.audio('14155557777@s.whatsapp.net', ogg, { ptt: true });

// Archivo de audio regular
await wa.Message.audio('14155557777@s.whatsapp.net', ogg, { ptt: false });
```

El audio entrante expone un getter `ptt` para que puedas ramificar entre notas de voz y adjuntos:

```typescript title="receive-audio.ts"
import { writeFile } from 'node:fs/promises';
import { wa } from './client';

wa.on('message:created', async (msg) => {
    if (msg instanceof wa.Message.Audio) {
        const kind = msg.ptt ? 'voice-note' : 'audio';
        const bytes = await msg.content();
        await writeFile(`./inbox/${msg.id}-${kind}.ogg`, bytes);
        console.log(`Received ${kind} (${bytes.length} bytes)`);
    }
});
```

---

## Ubicación

Las ubicaciones estáticas y en vivo comparten el mismo constructor. La librería expone getters parseados
`lat`, `lng`, `link` y `live` en los mensajes `Gps` entrantes.

```typescript title="send-location.ts"
import { wa } from './client';

// Pin estático
await wa.Message.location('14155557777@s.whatsapp.net', {
    lat: 40.4168,
    lng: -3.7038,
});

// Bandera de ubicación en vivo (el servidor aún lo trata como un pin estático hasta que el dispositivo
// transmite actualizaciones; la bandera `live` se expone en el lado receptor)
await wa.Message.location('14155557777@s.whatsapp.net', {
    lat: 40.4168,
    lng: -3.7038,
    live: true,
});
```

```typescript title="receive-location.ts"
import { wa } from './client';

wa.on('message:created', (msg) => {
    if (msg instanceof wa.Message.Gps) {
        console.log(`Pin: ${msg.lat}, ${msg.lng}`);
        console.log(`Maps URL: ${msg.link}`);
        if (msg.live) {
            console.log('Live location stream — expect updates via message:updated');
        }
    }
});
```

---

## Reenvío

Cualquier instancia de mensaje puede reenviarse a otro chat en una sola llamada. Acepta un CID
string, un `Chat` o un `Contact`.

```typescript title="forward.ts"
import { wa } from './client';

const ARCHIVE_CID = '14155550000@s.whatsapp.net';

wa.on('message:created', async (msg) => {
    // Archivar cada foto que recibo en un chat personal conmigo mismo.
    if (msg instanceof wa.Message.Image && !msg.me) {
        const ok = await msg.forward(ARCHIVE_CID);
        console.log(ok ? 'Forwarded' : 'Forward failed');
    }
});
```
