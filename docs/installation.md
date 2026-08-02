# Installation

Install `@arcaelas/whatsapp` into any Node.js project. The package is published to npm as a dual ESM/CJS build with TypeScript declarations included.

---

## 1. Requirements

- **Node.js >= 20**. The library bundles a `Symbol.metadata` polyfill so the `/decorators` sub-entry runs on Node 20 and 21 too; on Node 22+ the native symbol is used.
- A **package manager**. `yarn` is the recommended choice; `npm` and `pnpm` work as well.

!!! note
    No external API keys are required. Pairing happens locally through baileys, either by phone PIN or by scanning a QR code.

---

## 2. Install the package

=== "yarn"

    ```bash
    yarn add @arcaelas/whatsapp
    ```

=== "npm"

    ```bash
    npm install @arcaelas/whatsapp
    ```

=== "pnpm"

    ```bash
    pnpm add @arcaelas/whatsapp
    ```

This pulls in the only runtime dependencies the library needs: `baileys@7.0.0-rc14`, `pino` and `qrcode`.

---

## 3. Optional peers

Nothing extra is needed for `FileSystemEngine` or for a custom `Engine`. The rest is installed only
when you use the matching feature:

| Package                | Needed for                                              |
| ---------------------- | -------------------------------------------------------- |
| `@aws-sdk/client-s3`   | `S3Engine`                                              |
| `sharp` **or** `jimp`  | `account.picture(…)` — baileys resizes the picture   |
| `ioredis`              | The client you hand to `RedisEngine`                    |
| `better-sqlite3`       | The database you hand to `SQLiteEngine` on Node < 22    |

```bash
yarn add @aws-sdk/client-s3   # only if you use S3Engine
yarn add sharp                # only if you set a profile picture
yarn add ioredis              # only if you use RedisEngine
```

!!! tip "SQLite with zero dependencies"
    `SQLiteEngine` takes an already-open database, so on **Node 22+** the native `node:sqlite` module
    is enough:

    ```typescript
    import { DatabaseSync } from 'node:sqlite';
    import { SQLiteEngine } from '@arcaelas/whatsapp';

    const engine = new SQLiteEngine(new DatabaseSync('.sessions/5491112345678.db'));
    ```

    On Node 20 and 21, install `better-sqlite3` and pass `new Database(file)` instead.

---

## 4. Package exports

The package exposes two entry points through its `exports` map:

```typescript title="core entry"
import { WhatsApp, FileSystemEngine, SQLiteEngine, RedisEngine, S3Engine } from "@arcaelas/whatsapp";
```

```typescript title="decorator DSL"
import { WhatsAppBot, Bot, on, guard, command, pair } from "@arcaelas/whatsapp/decorators";
```

Both entries ship ESM and CJS builds — your bundler or Node loader will pick the right one automatically.

!!! warning "Engines are not in the decorators entry"
    `@arcaelas/whatsapp/decorators` exports only the decorator API. Entities and engines always come
    from `@arcaelas/whatsapp`.

---

## 5. TypeScript configuration

The core entry needs no special compiler flags. For the decorator sub-entry there is also nothing to configure: the library targets **Stage 3 decorators** (the standard form supported natively by TypeScript 5+), so you do **not** need `experimentalDecorators` or `emitDecoratorMetadata` in your `tsconfig.json`.

A minimal `tsconfig.json` is enough:

```json title="tsconfig.json"
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "NodeNext",
        "moduleResolution": "NodeNext",
        "strict": true,
        "esModuleInterop": true
    }
}
```

!!! tip
    To run TypeScript directly without an explicit build step, use [`tsx`](https://github.com/privatenumber/tsx): `npx tsx index.ts`.

---

## 6. Environment

No `.env` setup is required to start. baileys handles the WhatsApp Web protocol locally and persists session data through the `Engine` you provide. If you choose `RedisEngine`, configure your Redis connection through `ioredis` as you normally would.

---

Once installed, head over to [Getting Started](getting-started.md) to wire up your first session.
