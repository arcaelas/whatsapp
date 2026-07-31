# Media

Send and receive images, videos, audio (including voice notes), documents and locations, read the
stickers you get, and forward existing media between chats.

All media is sent as a `Buffer` — the library does not read from disk for you, so you
control how the bytes arrive (filesystem, HTTP, S3, FFmpeg pipe, etc.).

!!! info "Size limits"
    WhatsApp enforces hard caps on media payloads:

    - **Images** ~5 MB
    - **Videos** ~16 MB
    - **Audio / voice notes** ~16 MB
    - **Documents** ~100 MB

    Anything larger is rejected by the server before delivery. Compress or transcode
    before sending.

!!! info "Sendable vs. receivable"
    You can send `text`, `image`, `video`, `audio`, `document`, `location`, `poll`, `vcard` and
    `event`. **Stickers can only be received** — there is no `wa.Message.sticker`.

---

## Setup

Every snippet below assumes the same client. Instantiate it once and reuse:

```typescript title="client.ts"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

export const wa = new WhatsApp({
    engine: new FileSystemEngine(__dirname + '/.session'),
    phone: 14155551234,
});

await wa.connect((auth) => {
    if (typeof auth === 'string') {
        console.log('Pair code:', auth);
    }
});
```

---

## Images

Send an image with an optional caption. The first argument is the destination identifier, the
second is the binary buffer.

```typescript title="send-image.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

const buffer = await readFile('./assets/sunset.jpg');

await wa.Message.image('14155557777', buffer, {
    caption: 'Sunset from the office today',
});
```

Detect incoming images with `instanceof Image`, then call `content()` to download the bytes:

```typescript title="receive-image.ts"
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Image } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:created', async (msg, chat) => {
    if (msg instanceof Image) {
        const bytes = await msg.content();
        await writeFile(join('./inbox', `${msg.id}.jpg`), bytes);
        console.log(`Saved ${bytes.length} bytes from ${chat.name}`);
        console.log(`${msg.width}x${msg.height}, ${msg.size} bytes announced`);

        const thumb = await msg.thumb();     // embedded JPEG preview, or null
        if (thumb) {
            await writeFile(join('./inbox', `${msg.id}.thumb.jpg`), thumb);
        }
    }
});
```

---

## Videos

Same shape as images. Provide an MP4 buffer; the server takes care of thumbnail
generation.

```typescript title="send-video.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

const clip = await readFile('./assets/demo.mp4');

await wa.Message.video('14155557777', clip, {
    caption: 'Quick demo of the new flow',
});
```

```typescript title="receive-video.ts"
import { createWriteStream } from 'node:fs';
import { Video } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:created', async (msg) => {
    if (msg instanceof Video) {
        console.log(`${msg.duration}s, ${msg.width}x${msg.height}`);
        // Stream straight to disk — useful for large clips.
        const out = createWriteStream(`./inbox/${msg.id}.mp4`);
        (await msg.stream()).pipe(out);
    }
});
```

---

## Audio and voice notes

Audio defaults to **push-to-talk** (voice note). Pass `ptt: false` for a regular audio
attachment.

```typescript title="send-voice-note.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

const ogg = await readFile('./assets/reply.ogg');

// Voice note (default)
await wa.Message.audio('14155557777', ogg, { ptt: true });

// Regular audio file
await wa.Message.audio('14155557777', ogg, { ptt: false });
```

Incoming audio exposes `ptt`, `duration` and the protocol `waveform`:

```typescript title="receive-audio.ts"
import { writeFile } from 'node:fs/promises';
import { Audio } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:created', async (msg) => {
    if (msg instanceof Audio) {
        const kind = msg.ptt ? 'voice-note' : 'audio';
        const bytes = await msg.content();
        await writeFile(`./inbox/${msg.id}-${kind}.ogg`, bytes);
        console.log(`Received ${kind}: ${msg.duration}s, ${msg.waveform.length} waveform points`);
    }
});
```

---

## Documents

`file_name` is mandatory; `mimetype` defaults to `application/octet-stream`.

```typescript title="send-document.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

await wa.Message.document('14155557777', await readFile('./contract.pdf'), {
    file_name: 'contract.pdf',
    mimetype: 'application/pdf',
    caption: 'Please sign page 4',
});
```

```typescript title="receive-document.ts"
import { writeFile } from 'node:fs/promises';
import { Document } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:created', async (msg) => {
    if (msg instanceof Document) {
        console.log(msg.name, msg.pages, 'pages,', msg.size, 'bytes,', msg.mime);
        await writeFile(`./inbox/${msg.name || msg.id}`, await msg.content());
    }
});
```

---

## Stickers

Receive-only, with dimensions and an `animated` flag:

```typescript title="receive-sticker.ts"
import { writeFile } from 'node:fs/promises';
import { Sticker } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:created', async (msg) => {
    if (msg instanceof Sticker) {
        console.log(`${msg.width}x${msg.height}`, msg.animated ? '(animated)' : '(static)');
        await writeFile(`./inbox/${msg.id}.webp`, await msg.content());
    }
});
```

---

## Location

Sending takes a static pin; receiving covers both static and live locations through the `Location`
subclass.

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
        console.log(`Maps URL: ${msg.link}`);
        if (msg.live) {
            console.log('Live location — updates arrive as message:updated');
        }
    }
});
```

!!! warning "Live location is receive-only"
    The send API accepts `{ lat, lng }` and nothing else: broadcasting your own live location is not
    supported. Incoming live locations keep updating through `message:updated`, with `live === true`.

---

## Forwarding

Any message instance can be forwarded to another chat in one call. Accepts an identifier
string, a `Chat`, or a `Contact`.

```typescript title="forward.ts"
import { Image } from '@arcaelas/whatsapp';
import { wa } from './client';

const ARCHIVE_CID = '14155550000';

wa.on('message:created', async (msg) => {
    // Archive every photo I receive into a personal chat with myself.
    if (msg instanceof Image && !msg.me) {
        const ok = await msg.forward(ARCHIVE_CID);
        console.log(ok ? 'Forwarded' : 'Forward failed');
    }
});
```

---

## Where the bytes live

The first time a media message arrives, the payload is downloaded and persisted next to the message
document (`/chat/<cid>/message/<mid>/content`). From then on, `content()` and `stream()` read the
engine cache and only fall back to a fresh baileys download when the cache is empty — which is why
old media can still be read after WhatsApp expired it, and why `content()` returns an empty buffer
when neither source has it.
