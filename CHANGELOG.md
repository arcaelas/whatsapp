# Changelog

All notable changes to `@arcaelas/whatsapp` will be documented in this file.

## [Unreleased]

---

## [3.0.0] - 2026-04-21

### BREAKING

- **Package layout**: public entry points split into core (`@arcaelas/whatsapp`) and decorator API (`@arcaelas/whatsapp/decorators`). `exports` map added to `package.json`.
- **Engine classes renamed**: `Redis` → `RedisEngine`, `FileSystem` → `FileSystemEngine`. Importing the old names breaks.
- **Source tree restructured**: V1 root files (`src/Chat.ts`, `Contact.ts`, `Message.ts`, `WhatsApp.ts`, `src/store/*`) removed; all library code now lives under `src/lib/{chat,contact,message,store,whatsapp,bot}/`.
- **Event signatures extended**: `message:*` and `contact:*` listeners now receive `[entity, chat, wa]` (was `[entity, wa]`). `message:reacted` is `[msg, chat, emoji, wa]`.
- **Previously public internals made internal**: `wa.socket` getter removed; `wa.resolve_jid()` renamed to `wa._resolve_jid()` (internal use only). Consumers should use the public delegates `wa.Message`, `wa.Chat`, `wa.Contact`.
- **Message base class**: single-class architecture with specialized subclasses (`Text`, `Image`, `Video`, `Audio`, `Gps`, `Poll`). Constructor is `new Message({ wa, doc })`.
- **Engine contract is string-only**: `Engine.{get,set,unset,list,count,clear}` operate on strings; serialization via `BufferJSON` moved to a dedicated layer (`serialize`/`deserialize`).
- **`disconnect()` emits a Boom-like error with `statusCode=428`** (`connectionClosed`) so the close handler sees an explicit signal instead of `undefined`.

### Features

- **`@Bot(options)` class decorator**: turns any class into a WhatsApp bot with default options; constructor accepts a partial override.
- **Method decorators**: `@on(event)`, `@guard(pred)`, `@once([event])`, `@command(pattern)`, `@from(phone|jid|lid|array|pred)`, `@pair()`, `@pipe(workflow, index)`, `@every(ms)`, `@connect()`, `@disconnect()`.
- **`WhatsAppBot`**: optional base class that wires decorated handlers at `connect()`.
- **Workflow pipelines**: `@pipe(name, index)` executes multiple steps sequentially on `message:created`, sharing the same mutable arguments between steps.
- **`@pair()` runs in parallel**: multiple methods decorated with `@pair` run concurrently via `Promise.all` when baileys emits a code.
- **Auto-register to `message:created`**: methods decorated with `@guard` or `@from` without an explicit `@on` register implicitly to `message:created`.
- **`@once(event)` shortcut**: combines `@on(event) + @once()` in a single decorator.
- **Client options**:
  - `autoclean` (default `true`): on remote `loggedOut`, clears the entire engine. With `false`, only `/session/creds` is removed, preserving history.
  - `reconnect` (default `true`, infinite with 60s interval): accepts `boolean`, `number` (max attempts), or `{ max, interval }`. Transient closes (`restartRequired`) do not consume retry budget.
  - `sync` (default `false`): enables baileys `syncFullHistory`; a new `messaging-history.set` handler persists imported chats/contacts/messages.
- **PIN refresh**: every baileys QR refresh emits a new pair code via the callback (previously emitted only once per `connect()`).
- **Re-read of creds on each retry**: the internal `start()` re-reads `/session/creds` before each attempt so external cleanups take effect on reconnect.
- **Message getters**: `msg.type`, `msg.from` exposed as synchronous getters.

### Fixes

- **`restartRequired` (515) treated as transient**: the baileys post-pair-success reset no longer emits `disconnected` and reconnects with zero delay.
- **Retry timer cancellation**: `disconnect()` cancels any pending reconnect `setTimeout`, eliminating ghost reconnections.
- **Engine cleanup order**: on `loggedOut`, the engine cleanup (`clear()` or `unset('/session/creds')`) completes before `disconnected` is emitted, so listeners see the final state.

### Internal

- Stage 3 decorator infrastructure with `Symbol.metadata` polyfill for Node < 22.
- `tsconfig.json`: removed `experimentalDecorators` and `emitDecoratorMetadata` (required by Stage 3).
- JSDoc bilingüe (Spanish + English) across the public surface.
- Clean-code pass on the decorator layer: no early returns, no inline comments inside functions, consistent `snake_case` for method names.

---

## [2.0.0] - 2026-03-02

### BREAKING

- **Baileys**: upgrade from v6.7.18 to v7.0.0-rc.9
- **API surface**: constructors, interfaces, and static methods changed significantly from published 1.4.0 (see 1.4.0 notes below)
- **All entry points** (`Contact.get`, `Chat.get`, `Message.get/list/count/send*`) now normalize any identifier format (JID, LID, phone) via `resolveJID()`

### Features

- **WhatsApp**: new public method `resolveJID(uid)` normalizes any identifier (JID `@s.whatsapp.net`, LID `@lid`, phone number) to JID
- **Contact**: `Contact.get(uid)` accepts JID, LID, or plain phone number
- **Chat**: static delegates `pin(cid, value)`, `archive(cid, value)`, `mute(cid, duration)`, `seen(cid)`, `remove(cid)`
- **Chat**: instance method `contact()` returns the associated Contact for 1:1 chats
- **Message**: all send statics accept optional `mid` parameter for quoted replies
- **Message**: instance send methods `text()`, `image()`, `video()`, `audio()`, `location()`, `poll()` that reply to the current message
- **WhatsApp**: listen to Baileys v7 `lid-mapping.update` event for bidirectional LID/PN persistence

### Docs

- Align all 33 documentation files with actual source code API
- Fix phantom static methods (`Message.react()`, `Chat.members()`, `Message.forward()`) in examples
- Fix internal links in ES docs pointing to EN versions
- Fix storage schema documentation (index format, directory structure)

### Internal

- Replace `proto.Message.AppStateSyncKeyData.fromObject()` with `.create()` (Baileys v7)
- Remove all unnecessary type casts in WhatsApp.ts (Baileys v7 Contact/Chat types are properly typed)
- Persist LID inverse index (`lid/{lid}` -> jid) on contact upsert/update and via `lid-mapping.update`

---

## [1.4.0] - 2026-03-02

Version bump only. No code changes from 1.3.0.

---

## [1.3.0] - 2026-03-02

### Changes

- **build**: replace esbuild with `tsc` + `tsc-alias` for dual ESM/CJS output (6b207ba)
- **ci**: add `.github/workflows/publish.yml` with conditional npm publish (6b207ba)
- **chore**: align `.prettierrc` to standard across `@arcaelas` packages (6b207ba)
- **refactor**: migrate all imports to `~/` path aliases (6b207ba)
- **chore**: replace `eslint.config.js` with `eslint.config.mjs` (6b207ba)
- **chore**: add `prepublishOnly` (build + version bump) and `postpublish` (cleanup) scripts (6b207ba)

### Removed

- `esbuild.js` build script

---

## [1.2.3] - 2026-02-11

### Features

- **Message**: add `stream()` method returning a `Readable` for piping media directly to S3 without loading full file in RAM (8723dcd)
- **Message**: refactor `content()` to consume `stream()` internally with chunk collection and engine caching (8723dcd)

Closes #4.

---

## [1.2.2] - 2026-02-09

Version bump only.

---

## [1.2.1] - 2026-02-09

### Fixes

- Fix indentation in raw chat object construction in `WhatsApp.ts` (c9b4be1)
- Add explicit `Buffer<ArrayBuffer>` cast in media download (c9b4be1)

---

## [1.2.0] - 2026-02-09

### Changes

- Regenerate `yarn.lock` with updated dependency tree (~1900 lines changed)
- Update `.gitignore`

---

## [1.1.1] - 2026-02-08

Version bump only.

---

## [1.1.0] - 2026-02-08

### Features

- **core**: rewrite WhatsApp, Chat, Contact, Message using factory pattern with context binding (1a23067)
- **store**: add `RedisEngine` as persistence driver (2fcca99)
- **store**: add `Engine` interface with delete-by-prefix support (bb83f4f, 2fcca99)
- **Chat**: add `_last_messages()` helper for `chatModify` operations (2abb314)
- **Chat**: `pin()`, `archive()`, `mute()` now include `lastMessages` parameter (2abb314)
- **Chat**: `seen()` with correct message reference (2abb314)

### Docs

- Add MkDocs documentation site with full API reference and examples (1a23067)
- Add i18n support with English/Spanish translations (6fdcf88)
- Add banner image and branding (6fdcf88)
- Add schema documentation (`docs/schema.md`) (2fcca99)
- Fix API documentation to match actual implementation (d3ff0bf)

### Refactor

- Adopt scoped function pattern to fix TS4094 circular reference (2abb314)
- Simplify `FileEngine` to single persistence driver (1a23067)
- Improve code structure and readability (4a5d8d1)

### Removed

- `MemoryEngine` driver
- `S3Engine` driver

Closes #2.

---

## [1.0.21] - 2025-07-26

- feat: add `seen()` method to Message (6065b05)
- feat: mark `forward()` and `delete()` as deprecated (6065b05)

---

## [1.0.20] - 2025-07-26

- feat: implement Contact model with full event handling (83a5986, 07272cd)
- refactor: separate socket event handlers for better organization (07272cd)
- docs: add initial CHANGELOG (16dcc3c, 7b8cf17)

---

## [1.0.19] - 2025-07-26

- refactor: introduce `raw` getter for message data access (157490f)
- refactor: implement resource release pattern in chat and message methods (15be77f)
- feat: add message author info and improve mutex release handling (7fa54cc, b12da52)
- fix: add release calls to socket operations (7f8a2dc)

---

## [1.0.18] - 2025-07-25

- feat: add message role, type detection, and content retrieval methods (5273d4c)

---

## [1.0.17] - 2025-07-25

- feat: implement cache system and automatic reconnection with `node-cache` (e458423)

---

## [1.0.16] - 2025-07-25

- feat: add 5-second delay before requesting pairing code (180dcb1)
- fix: disable pairing code request, return NO-CODE placeholder (02b9c26)

---

## [1.0.15] - 2025-07-25

- feat: configure macOS browser agent and add message retrieval handler (5f82eff)
- feat: emit socket events to process middleware with store context (9f8a033)

---

## [1.0.14] - 2025-07-25

- refactor: simplify WhatsApp connection handling and remove unused imports (ad6a158)

---

## [1.0.13] - 2025-07-25

- fix: move store initialization after options configuration (9ed0bd0)

---

## [1.0.12] - 2025-07-25

- refactor: optimize WhatsApp connection flow and remove redundant event emissions (616a989)

---

## [1.0.11] - 2025-07-25

- fix: await socket connection before requesting pairing code (7bd91f4)

---

## [1.0.10] - 2025-07-25

- refactor: simplify WhatsApp login to code-based authentication only (c52fd97)

---

## [1.0.9] - 2025-07-25

- fix: improve socket connection handling with explicit state check and longer timeout (a08e55f)

---

## [1.0.8] - 2025-07-25

- fix: make browser option conditional in WASocket configuration (b7c7b48)

---

## [1.0.7] - 2025-07-25

- feat: allow custom browser description in WhatsApp client initialization (4ccad93)

---

## [1.0.6] - 2025-07-25

- chore: minor adjustments (740e719)

---

## [1.0.5] - 2025-07-25

- refactor: optimize event handling and add process event emission (57a77ec)

---

## [1.0.4] - 2025-07-25

- docs: add JSDoc comments to WhatsApp class methods and interfaces (c538750)

---

## [1.0.3] - 2025-07-25

- refactor: simplify store interface with match pattern and unset operations (860ea49)
- refactor: optimize chat message retrieval and standardize store operations (cdf6815)
- refactor: optimize message retrieval with match pattern (8da294d)
- feat: add `chat()` method to Message class (35389d8)
- docs: JSDoc comments to Message, Chat, Base classes (ec56c32, 0bd5cb0, f51b081)

---

## [1.0.2] - 2025-07-25

- docs: remove baileys peer dependency from installation instructions (7cc4344)

---

## [1.0.1] - 2025-07-25

- feat: initial WhatsApp client with Chat, Message, Contact models and Store (44530cd, 5b6971d, 329e091)

---

## [1.0.0] - 2025-07-25

- feat: initial project setup (1240d17)
