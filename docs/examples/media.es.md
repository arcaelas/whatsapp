# Media

Envía y recibe imágenes, videos, audio (incluyendo notas de voz), documentos y ubicaciones, lee los
stickers que te llegan, y reenvía medios existentes entre chats.

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

!!! info "Enviables vs. recibibles"
    Puedes enviar `text`, `image`, `video`, `audio`, `document`, `location`, `poll`, `vcard` y
    `event`. **Los stickers solo se reciben** — no existe `wa.Message.sticker`.

---

## Configuración

Cada fragmento de abajo asume el mismo cliente. Instáncialo una vez y reutilízalo:

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

## Imágenes

Envía una imagen con un pie opcional. El primer argumento es el identificador destino, el
segundo es el buffer binario.

```typescript title="send-image.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

const buffer = await readFile('./assets/sunset.jpg');

await wa.Message.image('14155557777', buffer, {
    caption: 'Atardecer desde la oficina hoy',
});
```

Detecta las imágenes entrantes con `instanceof Image` y luego llama a `content()` para descargar los
bytes:

```typescript title="receive-image.ts"
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Image } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:created', async (msg, chat) => {
    if (msg instanceof Image) {
        const bytes = await msg.content();
        await writeFile(join('./inbox', `${msg.id}.jpg`), bytes);
        console.log(`Guardados ${bytes.length} bytes de ${chat.name}`);
        console.log(`${msg.width}x${msg.height}, ${msg.size} bytes anunciados`);

        const thumb = await msg.thumb();     // vista previa JPEG embebida, o null
        if (thumb) {
            await writeFile(join('./inbox', `${msg.id}.thumb.jpg`), thumb);
        }
    }
});
```

---

## Videos

La misma forma que las imágenes. Proporciona un buffer MP4; el servidor se encarga de generar la
miniatura.

```typescript title="send-video.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

const clip = await readFile('./assets/demo.mp4');

await wa.Message.video('14155557777', clip, {
    caption: 'Demo rápida del nuevo flujo',
});
```

```typescript title="receive-video.ts"
import { createWriteStream } from 'node:fs';
import { Video } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:created', async (msg) => {
    if (msg instanceof Video) {
        console.log(`${msg.duration}s, ${msg.width}x${msg.height}`);
        // Canaliza directo a disco — útil para clips grandes.
        const out = createWriteStream(`./inbox/${msg.id}.mp4`);
        (await msg.stream()).pipe(out);
    }
});
```

---

## Audio y notas de voz

El audio se envía por defecto como **push-to-talk** (nota de voz). Pasa `ptt: false` para un archivo
de audio normal.

```typescript title="send-voice-note.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

const ogg = await readFile('./assets/reply.ogg');

// Nota de voz (por defecto)
await wa.Message.audio('14155557777', ogg, { ptt: true });

// Archivo de audio normal
await wa.Message.audio('14155557777', ogg, { ptt: false });
```

El audio entrante expone `ptt`, `duration` y el `waveform` del protocolo:

```typescript title="receive-audio.ts"
import { writeFile } from 'node:fs/promises';
import { Audio } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:created', async (msg) => {
    if (msg instanceof Audio) {
        const kind = msg.ptt ? 'voice-note' : 'audio';
        const bytes = await msg.content();
        await writeFile(`./inbox/${msg.id}-${kind}.ogg`, bytes);
        console.log(`Recibido ${kind}: ${msg.duration}s, ${msg.waveform.length} puntos de onda`);
    }
});
```

---

## Documentos

`file_name` es obligatorio; `mimetype` cae por defecto en `application/octet-stream`.

```typescript title="send-document.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

await wa.Message.document('14155557777', await readFile('./contract.pdf'), {
    file_name: 'contrato.pdf',
    mimetype: 'application/pdf',
    caption: 'Por favor firma la página 4',
});
```

```typescript title="receive-document.ts"
import { writeFile } from 'node:fs/promises';
import { Document } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:created', async (msg) => {
    if (msg instanceof Document) {
        console.log(msg.name, msg.pages, 'páginas,', msg.size, 'bytes,', msg.mime);
        await writeFile(`./inbox/${msg.name || msg.id}`, await msg.content());
    }
});
```

---

## Stickers

Solo de recepción, con dimensiones y una bandera `animated`:

```typescript title="receive-sticker.ts"
import { writeFile } from 'node:fs/promises';
import { Sticker } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:created', async (msg) => {
    if (msg instanceof Sticker) {
        console.log(`${msg.width}x${msg.height}`, msg.animated ? '(animado)' : '(estático)');
        await writeFile(`./inbox/${msg.id}.webp`, await msg.content());
    }
});
```

---

## Ubicación

El envío admite un pin estático; la recepción cubre tanto las ubicaciones estáticas como las en vivo
a través de la subclase `Location`.

```typescript title="send-location.ts"
import { wa } from './client';

await wa.Message.location('14155557777', {
    lat: 40.4168,
    lng: -3.7038,
});
```

```typescript title="receive-location.ts"
import { Location } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:created', (msg) => {
    if (msg instanceof Location) {
        console.log(`Pin: ${msg.lat}, ${msg.lng}`);
        console.log(`URL de Maps: ${msg.link}`);
        if (msg.live) {
            console.log('Ubicación en vivo — las actualizaciones llegan como message:updated');
        }
    }
});
```

!!! warning "La ubicación en vivo es solo de recepción"
    La API de envío acepta `{ lat, lng }` y nada más: transmitir tu propia ubicación en vivo no está
    soportado. Las ubicaciones en vivo entrantes siguen actualizándose por `message:updated`, con
    `live === true`.

---

## Reenvío

Cualquier instancia de mensaje puede reenviarse a otro chat en una sola llamada. Acepta un
identificador string, un `Chat` o un `Contact`.

```typescript title="forward.ts"
import { Image } from '@arcaelas/whatsapp';
import { wa } from './client';

const ARCHIVE_CID = '14155550000';

wa.on('message:created', async (msg) => {
    // Archiva cada foto que recibo en un chat personal conmigo mismo.
    if (msg instanceof Image && !msg.me) {
        const ok = await msg.forward(ARCHIVE_CID);
        console.log(ok ? 'Reenviado' : 'Falló el reenvío');
    }
});
```

---

## Dónde viven los bytes

La primera vez que llega un mensaje de media, el contenido se descarga y se persiste junto al
documento del mensaje (`/chat/<cid>/message/<mid>/content`). A partir de ahí, `content()` y
`stream()` leen la caché del motor y solo caen en una descarga nueva de baileys cuando la caché está
vacía — por eso los medios viejos se siguen pudiendo leer después de que WhatsApp los venció, y por
eso `content()` devuelve un buffer vacío cuando ninguna de las dos fuentes lo tiene.
