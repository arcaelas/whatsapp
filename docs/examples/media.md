# Media

Send and receive images, videos, audio (including voice notes), locations, and forward
existing media between chats.

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

!!! warning "No document API"
    `@arcaelas/whatsapp` v3 does not expose a `document` send method. Only
    `text`, `image`, `video`, `audio`, `location` and `poll` are supported.

---

## Setup

Every snippet below assumes the same client. Instantiate it once and reuse:

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

## Images

Send an image with an optional caption. The first argument is the destination CID, the
second is the binary buffer.

```typescript title="send-image.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

const buffer = await readFile('./assets/sunset.jpg');

await wa.Message.image('14155557777@s.whatsapp.net', buffer, {
    caption: 'Sunset from the office today',
});
```

Detect incoming images with `instanceof wa.Message.Image`, then call `content()` to
download the bytes:

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

Same shape as images. Provide an MP4 buffer; the server takes care of thumbnail
generation.

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
        // Stream straight to disk — useful for large clips.
        const out = createWriteStream(`./inbox/${msg.id}.mp4`);
        const stream = await msg.stream();
        stream.pipe(out);
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
await wa.Message.audio('14155557777@s.whatsapp.net', ogg, { ptt: true });

// Regular audio file
await wa.Message.audio('14155557777@s.whatsapp.net', ogg, { ptt: false });
```

Incoming audio exposes a `ptt` getter so you can branch on voice notes vs. attachments:

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

## Location

Static and live locations share the same constructor. The library exposes parsed
`lat`, `lng`, `link` and `live` getters on incoming `Gps` messages.

```typescript title="send-location.ts"
import { wa } from './client';

// Static pin
await wa.Message.location('14155557777@s.whatsapp.net', {
    lat: 40.4168,
    lng: -3.7038,
});

// Live location flag (server still treats this as a static pin until the device
// streams updates; the `live` flag is exposed on the receiving side)
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

## Forwarding

Any message instance can be forwarded to another chat in one call. Accepts a CID
string, a `Chat`, or a `Contact`.

```typescript title="forward.ts"
import { wa } from './client';

const ARCHIVE_CID = '14155550000@s.whatsapp.net';

wa.on('message:created', async (msg) => {
    // Archive every photo I receive into a personal chat with myself.
    if (msg instanceof wa.Message.Image && !msg.me) {
        const ok = await msg.forward(ARCHIVE_CID);
        console.log(ok ? 'Forwarded' : 'Forward failed');
    }
});
```
