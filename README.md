![Arcaelas Insiders](https://raw.githubusercontent.com/arcaelas/dist/main/banner/svg/dark.svg#gh-dark-mode-only) ![Arcaelas Insiders](https://raw.githubusercontent.com/arcaelas/dist/main/banner/svg/light.svg#gh-light-mode-only)

# @arcaelas/whatsapp

> A **multi‑device**, storage‑agnostic WhatsApp client for Node.js.
>
> _Typed end‑to‑end · Sends any media · Zero‑boilerplate API · Written in TypeScript only_

<p align="center">
  <a href="https://www.npmjs.com/package/@arcaelas/whatsapp"><img src="https://img.shields.io/npm/v/@arcaelas/whatsapp?color=cb3837" alt="npm version"></a>
  <img src="https://img.shields.io/bundlephobia/minzip/@arcaelas/whatsapp?label=gzip" alt="bundle size">
  <img src="https://img.shields.io/github/license/arcaelas/whatsapp" alt="MIT">
</p>

---

## Contents

-   [Install](#install)
-   [Quick Start](#quick-start)
-   [Zero to Hero Guide](#zero-to-hero-guide)

    -   [1. Create a Store](#1-create-a-store)
    -   [2. Initialise the client](#2-initialise-the-client)
    -   [3. Read chats & messages](#3-read-chats--messages)
    -   [4. Send your first message](#4-send-your-first-message)

-   [Interfaces & Types](#interfaces--types)

    -   [`IWhatsApp`](#iwhatsapp)
    -   [`Store`](#store)

-   [API Reference](#api-reference)

    -   [Chats](#chats)
    -   [Messages](#messages)
    -   [Presence](#presence)
    -   [Media Helpers](#media-helpers)

-   [Storage Back‑ends](#storage-back‑ends)

    -   [In‑memory](#in‑memory)
    -   [File‑system](#file‑system)
    -   [Redis](#redis)

-   [Recipes](#recipes)
-   [Troubleshooting](#troubleshooting)
-   [Contributing](#contributing)
-   [License](#license)

---

## Install

```bash
# core package
yarn add @arcaelas/whatsapp
```

> Node 18+ required. Works in ESM & TypeScript projects out of the box.

---

## Quick Start

```ts
import WhatsApp from '@arcaelas/whatsapp';
import qrcode from 'qrcode-terminal';

const socket = new WhatsApp({
    phone: '+01000000000',
    loginType: 'qr',
    qr: (buffer) => qrcode.generate(buffer.toString('base64'), { small: true }),
});

await socket.ready(); // blocks until authenticated

const [chat] = await socket.chats();
await chat.send('Hello from Arcaelas 🤖');
```

---

## Zero‑to‑Hero Guide

### 1. Create a Store

The library is **storage‑agnostic**. Implement the minimal `Store` contract once and reuse everywhere.

```ts
/** Minimal in‑memory store for demos */
const MemoryStore: Store = {
    map: new Map<string, string>(),

    has(key) {
        return this.map.has(key);
    },
    get(key) {
        return JSON.parse(this.map.get(key) ?? 'null');
    },
    set(key, value) {
        if (value == null) return this.delete(key);
        this.map.set(key, JSON.stringify(value));
        return true;
    },
    delete(key) {
        return this.map.delete(key);
    },
    async *keys() {
        for (const k of this.map.keys()) yield k;
    },
    async *values() {
        for (const v of this.map.values()) yield JSON.parse(v);
    },
    async *entries() {
        for (const [k, v] of this.map.entries()) yield [k, JSON.parse(v)];
    },
    clear() {
        this.map.clear();
        return true;
    },
};
```

## Storage Layer

The client is completely storage-agnostic. You may use Redis, filesystem or in-memory persistence. The storage system must implement the `Store` interface.

### Key structure (logical)

```
account:{phone}:index                           → Account
account:{phone}:chat:{id}:index                 → Chat
account:{phone}:chat:{id}:message:{id}:index    → Message
```

### Directory-style translation

```
account/
└── {phone}/
    ├── index
    └── chat/
        └── {id}/
            ├── index
            └── message/
                └── {id}/
                    └── index
```

> ✅ Esto permite separar metadatos de contenido, aplicar TTLs, y reducir lecturas innecesarias.

### 2. Initialise the client

```ts
const socket = new WhatsApp({
    phone: '+584100000000',
    loginType: 'code',
    code: (pairCode) => console.log('Pair with:', pairCode),
    store: MemoryStore,
});
```

### 3. Read chats & messages

```ts
const chats = await socket.chats();
for (const chat of chats) {
    console.log(`📨 ${chat.id} has ${await chat.messages().then((m) => m.length)} messages`);
}
```

### 4. Send your first message

```ts
const [target] = chats;
await target.send('¡Hola Mundo!', { once: true });
```

---

## Interfaces & Types

### `IWhatsApp`

```ts
interface IWhatsApp<T extends 'qr' | 'code'> {
    phone: string;
    store?: Store;
    loginType: T;
    code: T extends 'code' ? (code: string) => void : never;
    qr: T extends 'qr' ? (buffer: Buffer) => void : never;
}
```

| Field       | Required      | Description                                                                        |
| ----------- | ------------- | ---------------------------------------------------------------------------------- |
| `phone`     | ✔             | International format (`+5841…`).                                                   |
| `store`     | ✖             | Backend persistence (defaults to in‑memory volatile store).                        |
| `loginType` | ✔             | `'qr'` or `'code'`. Determines which callback is required.                         |
| `code`      | _Conditional_ | Fired once with the pairing **numeric code** when `loginType === 'code'`.          |
| `qr`        | _Conditional_ | Fired with a **Buffer JPG/PNG** containing the QR image when `loginType === 'qr'`. |

### `Store`

Contract used everywhere the SDK needs persistence: creds, chats, media pointers… Full JSDoc in `src/types/Store.ts`.

```ts
interface Store {
    has(key: string): boolean | Promise<boolean>;
    get(key: string): any | Promise<any>;
    set(key: string, value: any): boolean | Promise<boolean>;
    delete(key: string): boolean | Promise<boolean>;
    keys(): AsyncGenerator<string>;
    values(): AsyncGenerator<any>;
    entries(): AsyncGenerator<[string, any]>;
    clear(): boolean | Promise<boolean>;
    scan?(pattern: string): string[] | Promise<string[]>;
}
```

---

## API Reference

### Chats

```ts
socket.chats(): Promise<Chat[]>;
```

| Method                | Description                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| `pin()`               | Pin chat to top.                                                       |
| `mute()` / `unmute()` | Toggle notifications.                                                  |
| `seen()`              | Mark as read.                                                          |
| `presence(state)`     | Update own presence (`available`, `composing`, `recording`, `paused`). |
| `delete()`            | Remove chat locally.                                                   |
| `messages()`          | Fetch cached messages (lazy‑loaded).                                   |

### Messages

| Method              | Description                                |
| ------------------- | ------------------------------------------ |
| `content()`         | Returns payload: `string` or `Buffer`.     |
| `reply(body, opts)` | Reply in thread. Supports all media types. |
| `seen()`            | Mark as read.                              |
| `delete()`          | Delete for everyone when possible.         |
| `like(emoji)`       | Simple reaction helper.                    |
| `forward(chatid)`   | Forward to another chat.                   |

Return type fields:

```ts
type MessageBase = {
    id: string;
    type: 'text' | 'image' | 'audio' | 'video' | 'location';
    caption?: string;
    once?: boolean;
    ptt?: boolean; // push‑to‑talk
    ptv?: boolean; // video‑note
};
```

### Presence

```ts
await chat.presence('composing'); // typing…
```

### Media Helpers

All `send()`/`reply()` share the same overload signature:

```ts
send(body: string | Buffer | { lat: number; lon: number }, opts?: SendOptions): Promise<Message>;

interface SendOptions {
  type?: "audio" | "video" | "image" | "location";
  caption?: string; // images
  ptt?: boolean; // audio
  ptv?: boolean; // video‑note
  once?: boolean; // view‑once
}
```

---

## Storage Back‑ends

### In‑memory

Use the demo `MemoryStore` from the Zero‑to‑Hero section. Volatile.

### File‑system

```ts
import fs from 'node:fs/promises';

function FSStore(dir: string): Store {
    /* … */
}
```

Stores everything under `.cache/` exactly like the suggested tree.

### Redis

```ts
import { createClient } from 'redis';

function RedisStore(client = createClient()): Store {
    /* … */
}
```

Use `SCAN` for iteration and implement `scan(pattern)` via `KEYS`/`SCAN` glob.

---

## Recipes

### Auto‑responder bot

```ts
socket.on('message', async (msg) => {
    if (msg.type === 'text' && msg.content().includes('ping')) {
        await msg.reply('pong 🏓');
    }
});
```

### Send location every hour

```ts
setInterval(async () => {
    await chat.send({ lat: 8.3014, lon: -62.7166 }, { type: 'location' });
}, 3.6e6);
```

---

## Troubleshooting

| Error                           | Cause & Fix                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `401 – Session invalid`         | Credentials expired → re‑authenticate (clear `store` keys for `auth:` prefix).         |
| `ERR_PACKAGE_PATH_NOT_EXPORTED` | Make sure you import ESM build (`import …`).                                           |
| `BaileysBoomError 428`          | Connection closed by server – client will auto‑retry; ensure network clock is in sync. |

---

## Contributing

1. Fork → branch → PR (conventional commits).
2. `yarn lint && yarn test` must pass.
3. Document new features in this README.

---

## License

MIT — © 2025 [Miguel Alejandro](https://github.com/arcaelas) / Arcaelas Insiders.
