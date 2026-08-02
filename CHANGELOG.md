# Changelog

All notable changes to `@arcaelas/whatsapp` will be documented in this file.

## [7.0.1] - 2026-08-02

### Fixed

- **Messages died at a single check when the receiver asked for a retry.** When the peer cannot decrypt a message (session desync — routine against WhatsApp Business API numbers, which rotate keys often) it sends a retry request. The internal baileys retry cache indexes the sent message by its JID, but the retry request arrives addressed by LID, so the lookup missed, baileys answered "message not available" and the message was silently lost forever — stuck at one check while the very next message, encrypted over the renegotiated session, went through. That alternating loss is fixed by wiring the official `getMessage` fallback to the engine: the store locates the message under either addressing and baileys re-encrypts and resends it.

## [7.0.0] - 2026-08-01

### BREAKING CHANGES

- **The client is the emitter and the session; everything else moved into `connect`.** `WhatsApp` exposes `emit/on/once/off`, `connect`, `disconnect`, `engine` and the entities it publishes once the socket exists: `wa.Contact`, `wa.Chat`, `wa.Message` and `wa.account()`. Before the first `connect` those properties are undefined. Event processing lives inside `connect` as listeners over the socket — no private methods, no handler modules, no internal channel.
- **Entity factories take the live session.** `contact(init)`, `chat(init)`, `message(init)` and `Feed` receive `{ wa, engine, socket }`, so their methods no longer null-check the socket. Each entity file exports its base class as `default` plus its factory; the package barrel keeps every public name (`Contact`, `Chat`, `Message`, `Feed`, subclasses, engines).
- **`Message` statics dropped the client argument.** `Message.text(wa, cid, …)` is now `wa.Message.text(cid, …)` — same for `get`, `list`, every send and every by-id action. The `message(wa, raw)` factory is gone: `new Message(init, raw)` derives the document from a raw `WAMessage` and returns the per-type subclass from the constructor itself (`new Message(init, poll_raw) instanceof Poll`).
- **`wa.profile()`, `wa.feed()` and the `wa.contact` getter were replaced by `Account`.** `await wa.account()` returns an `Account extends Contact` bound to the session.
- **`internal.ts` removed.** The socket no longer travels through a WeakMap: entities receive it in their `init`. The shared identifier resolution is now `jid_of(engine, uid, socket?)`, exported from the store barrel.
- **`IWhatsApp`, `DisconnectOptions` and `ReconnectOption` are derived types.** The client file exports only the class; the entry point derives those names from it, so existing imports keep compiling.

### Added

- **`Account extends Contact`** — the authenticated account: `rename(name)` updates the public name, `picture(content)` sets the profile picture (Buffer or URL; `null` removes it), `content()` reads the bio and `content(text)` updates it, `online(value)` publishes presence (the socket starts with `markOnlineOnConnect: false`), and `post({ caption, buffer, audience })` publishes a status where the audience accepts `Contact` instances, JIDs, LIDs or phone numbers.
- **`connect` over a live session replaces it** — the previous socket is closed silently before opening the new one.

### Fixed

- **`Feed.content()` read a path that never existed** (`/chat/status@broadcast/message/…` instead of `/status/…`), so status binaries were never found. `Feed` now overrides `content()` with the real path.
- **A module cycle crashed direct imports.** `message → contact → status → message` left `Feed extends Message` evaluating against an uninitialized binding when the message module was the entry point. Moving `jid_of` to the store barrel broke the cycle; every module now loads standalone.
- **Factory return types exposed the bare base.** `Chat.get`/`list` (and Contact's) typed their result as the base class without methods, so consumers lost `chat.pin`, `chat.messages` and friends at compile time. The factories now name their class (`_Chat`, `_Contact`) and the event map types instances of the bound classes.

## [6.2.3] - 2026-08-01

### Changed

- **The client file is down to the class alone.** Inline comments are gone and the JSDoc is one bilingual line per member plus its `@param`/`@returns`/`@throws`; `sniff_media`, `write_content` and the poll-vote decryption dissolved into the two places that used them, and so did the type tables and the numeric status constants, which now read from `proto.WebMessageInfo.Status`. The module no longer exports anything but `export default class WhatsApp`: `IWhatsApp`, `DisconnectOptions` and `ReconnectOption` are derived in the entry point from the class itself, so the package's public surface is unchanged. 897 lines against 1214.
- **The internal channel only carries the socket.** `bind(owner, socket)` and `session(owner)` replace the state object with a function inside, and `resolve_jid` became a plain function in `internal.ts` that takes the owner. The constructor's wiring is now `bind(this, null)`.

## [6.2.2] - 2026-08-01

### Changed

- **The event processing moved into `connect` and shrank.** 6.2.1 had relocated the handlers to a `lib/handlers.ts` without actually removing anything: the client plus that file added up to more lines than the original. They now live inside `connect` as local closures sharing four helpers (`load`, `save`, `fire`, `locate`), which removed 14 exported signatures with their bilingual JSDoc; the contact merge became a single spread, the chat flags compute their patch and their event in one place instead of two, poll-vote decryption became a dedicated function, and message bodies are a table by type. The module is a single file again: 1214 lines against the 1511 it started with. **The public API is unchanged**, verified by diffing the emitted declarations.

## [6.2.1] - 2026-08-01

### Changed

- **`connect` wires the socket and the class stops holding the processing.** Every baileys handler (`messaging-history.set`, contacts, LID mapping, chats, messages and receipts) is now a plain function in `whatsapp/lib/handlers.ts` that takes the client, processes the event and re-emits it through `wa.emit(...)`; `connect` subscribes them and owns the serial chain that keeps two events over the same document from interleaving. The client dropped its 17 private methods and went from 13 private fields to 3 — the emitter, the normalized options and the teardown that `disconnect` invokes — while connection state (retries, timer, intentional/silent close) lives in the closure of the connection that owns it. `index.ts` went from 1511 lines to 671. **The public API is unchanged**: same options, same properties, same methods, same events, verified by diffing the emitted declarations against 6.2.0.

## [6.2.0] - 2026-07-31

### Added

- **`activity` on the chat document** — epoch ms of the chat's last message. It is now the score every chat write passes to the engine, so `Chat.list` comes back ordered by real activity instead of by whichever document happened to be written last. The field is additive: a document stored without it falls back to the last persisted message, so no migration is required.

### Fixed

- **Any chat write reordered the list.** Chats were persisted with no score, and `Engine.set` defaults to `Date.now()`, so pinning, archiving, muting, marking as read or merely receiving a flag update pushed the chat to the top of `Chat.list`. This is the same defect already fixed for messages in 6.0.0. Every chat write — the sync upserts, the flag updates and the `pin`/`archive`/`mute`/`seen` actions — now passes the chat's activity, and only a new message moves it.

## [6.1.3] - 2026-07-31

### Fixed

- **Completing a contact card emitted no event.** `#persist_contact` only announced `contact:created`, and only when the card did not exist. A card that existed blank and then got its name (the usual case after a re-sync, or when a message arrives carrying a `pushName`) changed on disk in silence, so any consumer memoizing contacts kept showing the bare phone number until it restarted. It now emits `contact:updated` whenever the merge actually changes a field.

## [6.1.2] - 2026-07-31

### Fixed

- **Re-syncs wiped contact names.** `contacts.upsert` arrives during a re-sync with the fields empty, and `#persist_contact` overwrote the whole document with it, so `name`, `notify` and `verified_name` already known were lost and chats fell back to showing the bare phone number (a verified business that read `Cleverty` turned into `56927587725`). The document is now merged: an incoming `null` never erases a value already stored. `contacts.update` also picks up `verifiedName`, which it was ignoring.
- **A blanked contact card now heals itself.** Message upserts filled the contact in only when it did not exist; they now also complete it when it exists with no name at all, using the `pushName` and the verified business name that travel with the message.

## [6.1.1] - 2026-07-31

### Fixed

- **Message state could move backwards.** WhatsApp re-emits acks out of order when a session reconnects — a `sent` (2) arriving after a `delivered` (3) for the same message — and `messages.update` applied whatever came last, so a message already read fell back to sent and the UI showed fewer ticks than it had. The state now only moves forward; `error` stays terminal and may still override. The history re-sync got the same guard: when a document is rewritten because something else changed (an edit, a star), the state already known is kept instead of the one the history reports.

## [6.1.0] - 2026-07-31

### Fixed

- **Message state never advanced on LID-addressed chats.** `messages.update`, `message-receipt.update` and reactions looked the document up at `/chat/${key.remoteJid}/message/${key.id}`, but WhatsApp addresses those updates by LID —with a device suffix (`…:9@lid`) more often than not— while the document lives under the JID it was stored with. Every receipt was silently dropped and messages stayed in `pending` forever. The three handlers now resolve the chat before reading, and `#resolve_jid` normalizes the device suffix out of a LID.
- **Quoted messages were sent without the quote.** `send()` passed `quoted` inside `sendMessage`'s *content*, but baileys reads it from the *options* argument, so the outgoing message carried no `contextInfo` and `mid` came back `null`. This affected **every reply**: the `mid` option of the statics *and* all the instance reply methods (`msg.text()`, `msg.image()`, `msg.video()`, `msg.audio()`, …), which always quote the message they hang off. The quote now travels in the options and works for every message type.

### Added

- **`Message.reason`** — why the server rejected a message when `status` is `error`: `restricted` (code 463: WhatsApp limited the account and blocks opening new chats, existing ones keep working), `invalid-session` (479), or the raw code for anything else. `null` in any other state. The rejection stub is now persisted with the message.
- **`Message.business`** — verified business name signing the message (what WhatsApp renders under the text of a Business account), or `null`.

## [6.0.0] - 2026-07-31

> Publicada como `5.1.0` por error de numeración y deprecada acto seguido: los cambios de
> abajo son breaking, así que la versión correcta es la 6.0.0.
> Released as `5.1.0` by a numbering mistake and deprecated right after: the changes below are
> breaking, so the correct version is 6.0.0.

### BREAKING CHANGES

- **Entities rewritten to a minimal surface.** `Contact`, `Chat`, `Message` and `Feed` now expose only their documented properties and methods; every entity file exports just its base class and its factory. Removed along the way: `IContactRaw`/`IChatRaw`/`IMessage`/`MessageStatus` and the `Send*` types (the shapes are inline and reused via indexed access, e.g. `Message['_raw']`), the `contact_name` helper, `Contact.rename/refresh/me/content/id`, `Chat.cid/content/read/readonly/refresh`, `Message.watch/count` and the `Gps` class (now `Location`).
- **`Message` subclasses are module-level exports** — `Text`, `Image`, `Video`, `Audio`, `Sticker`, `Document`, `Location`, `Poll`, `VCard`, `Event` extend `Message` and are imported directly (`msg instanceof Poll`) instead of hanging off the client (`wa.Message.Poll`). Instances are built with `message(wa, raw)`, which accepts the persisted document or a raw `WAMessage` and dispatches by type; `Message` statics take the client first (`Message.text(wa, cid, …)`).
- **Readable message values** — `status` is now `'error' | 'pending' | 'sent' | 'delivered' | 'read' | 'played'`, `created_at` and `expires_at` are ISO UTC strings, `delete()` defaults to this-device-only (`delete(true)` deletes for everyone), and `mime` reports `text/json` for poll/location/vcard/event. The persisted document keeps the protocol numeric values, so no data migration is required.
- **`Feed` extends `Message`** — inherits `author/chat/content/stream`, adds `viewed`/`view()`, and throws `ERR_FEED_UNSUPPORTED` on everything a status cannot do (`react`, `star`, `edit`, `forward`, `delete`, replies).
- **The client's internal state is now truly private.** `_socket`, `_event`, `_resolve_jid`, `_phone`, `_method`, `_autoclean`, `_reconnect` and `_sync` became JS `#` fields: they no longer show up in `Object.keys`, `getOwnPropertyNames` or symbols, and the `.d.ts` only emits `#private`. Consumers interact through `on`/`once`/`off`/`emit` and the documented methods; entities reach the socket via an internal friend channel that is not part of the public barrel. Code reaching into `wa._socket` for raw baileys access must be reworked.
- **Linking method simplified** — without `phone` the method is always QR; `method` only picks the channel when `phone` is set (OTP by default). Previously `method: 'otp'` without a phone silently fell back to QR.

### Added

- **Ordering score in the `Engine` contract** — `set(path, value, score?)`: the score (document epoch ms, e.g. `created_at`) drives `list` ordering instead of write time. `FileSystemEngine` applies it via file mtime, `RedisEngine` via the sorted-set score and `S3Engine` via its persisted index. Every message write passes `created_at`, so re-syncs that rewrite history no longer destroy chronology.
- **Persisted reactions** — reactions live on the message document and survive restarts; `msg.reactions()` returns `{ emoji, count }[]`.
- **Media metadata straight from the protocol** — `Image`/`Video` expose `width`, `height`, `size` and `thumb()`; `Video`/`Audio` expose `duration`; `Audio` adds the protocol `waveform` (0-100, ready to paint without decoding the file); `Text.preview()` returns the embedded link card (`{ link, name, content, thumb }`).
- **Optional binary operations in the `Engine` contract** — `get_buffer?` / `set_buffer?` store media raw instead of base64 inside JSON (33% less weight and no parsing to read it back), implemented by `FileSystemEngine` (a `content.bin` next to the document), `RedisEngine` (its own key, via `getBuffer`) and `SQLiteEngine` (a `BLOB` column). Both are optional: a driver without them stays valid and the library falls back to the serialized document, which is also how already-stored sessions keep working with no migration.
- **`Sticker` message type**, `msg.message()` for the quoted message, real view-once detection in `msg.once`, and `once` as a send option.
- **`wa.profile({ name, content, photo })`** — updates the WhatsApp profile in one call: public name, bio and picture (URL or Buffer; `null` removes it). Throws `ERR_PROFILE_PICTURE_LIB` when neither `sharp` nor `jimp` is installed, since baileys needs one of them to resize the picture.
- **`wa.feed({ content, caption, contacts })`** — publishes a status broadcast and returns the created `Feed`. `contacts` is the audience: WhatsApp does not deliver the status to anyone outside `statusJidList`. Text (caption only) or image/video (type inferred from the binary signature).
- **`wa.contact`** — the authenticated account as a `Contact` (jid, lid, name), or `null` while there is no session.
- **`wa.emit(event, …)`** — public emitter, so entities and consumers propagate events through the same documented surface.
- **`SQLiteEngine`** — SQLite persistence driver: one `(path, parent, score, value)` table with a `(parent, score DESC)` index. The most efficient built-in driver, since it delegates to the engine what the others hand-roll: `list` is an indexed `ORDER BY score DESC LIMIT/OFFSET` (no in-memory index, no order file), `count` a `COUNT(*)` and cascading `unset` a single range statement. Measured on a real 55,146-message chat against the filesystem: **220 MB → 64 MB on disk**, first `list` **115 ms → 0.6 ms**, writes 0.34 ms → 0.19 ms, and two files instead of ~110,000 inodes. Adds no dependency: the already-open database is injected (`new SQLiteEngine(db)`) and both `better-sqlite3` and the native `node:sqlite` satisfy the `SQLiteDatabase` interface.
- **`S3Engine`** — AWS S3 persistence driver implementing the `Engine` contract, with an optional in-memory cache. Options: `{ s3, bucket, basedir, cache }`, where `cache` is `false` (disabled) or `{ ttl, when(key) }` — `when` decides which keys are cached and each entry is cleared by a `setTimeout` (no read-time expiry check). Requires the peer `@aws-sdk/client-s3`.

- **`Document.name` and `Document.pages`**, `Chat.count` (unread messages) and `Chat.content()` — the group's subject or, on a 1:1, the contact's bio; async because neither lives in the chat document.

### Fixed

- **`@from()` was broken by the client encapsulation** — it reached `wa._resolve_jid` through a cast that hid the type error, so the guard threw at runtime. It now goes through the internal channel.
- **Re-syncs no longer rewrite nor re-download the already-persisted history.** On every reconnect baileys re-delivers the full history; documents without visible changes are now skipped entirely (no write, no event spam) and message binaries are only materialized on first delivery — previously every reconnect rewrote every doc and re-downloaded every media file.
- **Atomic writes in `FileSystemEngine`** — documents are written to a temp file and renamed, so an interrupted write can no longer leave a truncated `index.json`.
- **Corrupt documents no longer poison reads** — `deserialize` returns `null` on invalid JSON instead of throwing, so one truncated doc behaves as missing instead of breaking the whole page.
- **Duplicate handler wiring on reconnect** — calling `WhatsAppBot.connect()` again (e.g. after a manual `disconnect`) re-wired every decorated handler, firing each one twice per event. Wiring now happens once per instance.
- **Serialized event handling** — baileys handlers ran concurrently and interleaved read-modify-write cycles over the same document (lost updates). All business handlers now run through a per-client serial queue.
- **Read receipts persist message status** — `message-receipt.update` now advances `status` to `READ`/`PLAYED` on the stored document (it previously only emitted `message:seen`, leaving the doc stale).
- **`connect()` while connected self-heals** — an existing socket is closed silently before starting the new one instead of leaking two live sockets.
- **`disconnect({ silent: true })` finally works** — the option was dead code (`void options.silent`); it now actually suppresses that close's `disconnected` event.
- **`wa.Message` works again after the entity refactor** — it is a bound-shortcut object exposing the same `Message` statics without repeating the client, plus the ten subclasses for `instanceof`.

### Changed

- **baileys upgraded to `7.0.0-rc14`** — brings the profile-picture `tctoken` fix (rc13 nested it wrong in the IQ, so `profilePictureUrl` could hang for contacts with a privacy token), a refreshed WhatsApp Web version and the experimental `Browsers.android`.
- **Every engine now keeps a per-directory sorted index, maintained incrementally.** `list` and `count` no longer scan and re-sort the parent on each page — the ordering is kept up to date by `set`/`unset`. Measured on a real 55.146-message chat: **warm page 21 ms → 1.3 ms**, `count` O(1), index memory ~7 MB and bounded (LRU, `cached` option, default 12 directories).
  - `FileSystemEngine` — index backed by `<dir>/.order`, so a fresh process no longer needs 55k `stat` calls: **cold page 728 ms → 115 ms**. The file is rebuilt automatically when the child count does not match (external deletions) or when it is unreadable.
  - `RedisEngine` — the index already lived in Redis; writes now group document and index in a **pipeline**, halving latency and removing the window where a crash between `SET` and `ZADD` left a document orphaned from the index (invisible to `list`).
  - `S3Engine` — used to page by listing the **whole** prefix on every call (~55 `ListObjectsV2` per page on a large chat); it now lists once and reuses the index, backed by the `.order` object. That object also stores the explicit `score`, which S3 cannot represent (`LastModified` is read-only), so **`S3Engine` finally honors chronological ordering** like the other drivers.
- **Shared driver utilities moved to `store/engine/lib`** (`SortedIndex`, `IndexCache`, path helpers). `FileSystemEngine` and `RedisEngine` no longer reach the barrel that re-exports `S3Engine`, so importing them never pulls the optional `@aws-sdk/client-s3` peer.


### Changed (internal)

- **Internal refactors with no public API or behavior changes.** Deduplicated the contact upsert logic into a private helper shared by `contacts.upsert` and the message auto-create path; consolidated the bot decorator schema initialization into `ensure_schema` (now reused by `resolve` and `register_workflow_step`, with `once`/`command` composing over `resolve`).
- **Parallelized independent I/O in the Signal session store** — `keys.get` / `keys.set` now use `Promise.all` instead of serial `await` loops, reducing handshake latency.
- **Declarative cleanups** — contact-update patch built with conditional spread; engine `list` filters with `.filter()` instead of imperative push loops.

---

## [4.2.0] - 2026-06-16

### BREAKING CHANGES

- **`Contact.chat` is now an async method** — `chat(): Promise<Chat>` instead of an eager sync property, for consistency with `Message.chat()` / `Message.author()`. Call sites must switch from `contact.chat` to `(await contact.chat())`.
- **Removed the `contact:deleted` event** — baileys never emits `contacts.delete`, so the event and its dead listener were removed from `WhatsAppEventMap`.

### Changed

- **baileys upgraded to `7.0.0-rc13`** — `shouldSyncHistoryMessage` is now set explicitly to preserve the rc.9 history-sync behavior (rc13 changed its default); removed the deprecated `printQRInTerminal`; `disconnect()` now awaits the async `socket.end()`.

### Added

- **`Document` entity** (`documentMessage`) — files sent as documents (PDF, image, audio, video, etc.), with `file_name`, `size`, `pages`, `title` getters and `wa.Message.document(cid, buf, { file_name, mimetype?, caption? })`.
- **`VCard` entity** (`contactMessage` / `contactsArrayMessage`) — contact cards with a `contacts: { name, phone }[]` getter and `wa.Message.vcard(cid, [{ name, phone }])` (the vCard is generated with a clickable `waid`).
- **`Event` entity** (`eventMessage`) — calendar events with `name`, `start`, `end`, `canceled`, `link`, `place` getters (description via the inherited `caption`) and `wa.Message.event(cid, { name, caption?, start, end?, place? })`.

---

## [3.1.1] - 2026-05-18

### Fixes

- **Poll vote encryption**: `Poll.select()` now derives the HMAC with the normalized LID identity (`socket.user.lid` stripped of device suffix) for both voter and creator JIDs. WhatsApp silently dropped votes whose HMAC used the phone JID. Mirrors the fix `devmsh/whatsapp-bridge` applies to whatsmeow.
- **`messageSecret` base64 normalization**: `Poll.select()` decodes `messageContextInfo.messageSecret` from base64 string when needed (proto deserialization may produce string instead of `Buffer`), avoiding a wrong HMAC key.
- **Orchestrator `pollUpdateMessage` decrypt**: aligned to the same LID-normalized identity. Previously self-vote echoes silently failed `decryptPollVote` because the voter JID was taken from `msg.key.remoteJid` (counterpart) instead of our own LID.
- **Local merge after `Poll.select()`**: `socket.relayMessage` does not emit a local upsert to the originating companion, so the bot's own vote never came back through `messages.upsert`. `Poll.select()` now merges the vote into `_doc.raw.pollUpdates` and emits `message:updated` directly so `options[].count` reflects the change without waiting for a non-existent echo.

### Features

- **`SendPollOptions` export**: new public type extending `SendOptions` with `multiple?: boolean`. `wa.Message.poll(cid, p, { multiple: true })` and `msg.poll(p, { multiple: true })` now accept the flag. Internally maps to baileys' `selectableCount` (`1` → single via V3 proto, `0` → multi via V1 proto).
- **`IMessage.multiple` persisted flag**: `wa.Message.poll()` writes the explicit `multiple` to the persisted doc. `Poll.multiple` reads this flag first because WhatsApp normalizes `selectableOptionsCount` to `0` on echo of own polls regardless of intent. Foreign polls keep falling back to the proto count.

---

## [3.1.0] - 2026-05-18

### BREAKING

- **`status@broadcast` messages no longer emit `message:*`**: publications, edits, reactions and revocations on status broadcasts are routed to the new `feed:*` event channel. Consumers that filtered statuses inside `message:created` handlers must migrate to the dedicated `feed:*` listeners.
- **`status@broadcast` no longer emits `chat:*`**: `chats.update` entries with `id === 'status@broadcast'` are silenced. Previously the orchestrator persisted a virtual `/chat/status@broadcast` and emitted `chat:archived`/`chat:muted`/`chat:pinned` against it.
- **Storage layout**: status documents live at `/status/{id}` (was `/chat/status@broadcast/message/{id}`). Pre-existing status entries become orphaned (expire naturally within 24h).

### Features

- **`Feed` entity** (`src/lib/status`): represents a status broadcast post. Exposes `id`, `type`, `viewed`, `caption`, `created_at`, `expires_at`, plus `author()`, `stream()`, `content()` and `view()`. The 24h TTL is exported as `FEED_TTL_MS`.
- **New events**: `feed:created` (publication), `feed:updated` (reaction via `messages.reaction` or read receipt via `message-receipt.update` or `Feed.view()` call), `feed:deleted` (`protocolMessage` REVOKE).
- **Public exports**: `Feed`, `FEED_TTL_MS`, `IFeedRaw`, `FeedType` from `@arcaelas/whatsapp`.

### Performance

- **`Message.author()`** and **`Message.chat()`**: instance-memoized via promise cache (`??=`). First call hits the engine; subsequent calls reuse the same resolved promise — race-free under concurrent access.
- **`Feed.author()`**: harmonized to the same promise-memoized pattern.
- **`Chat.members()`** (groups only): the underlying `groupMetadata` response is memoized on the instance with a 15s TTL. Concurrent calls within the window share a single socket round-trip.

### Internal

- `WhatsApp._event` exposed as `@internal readonly` (was `private`) so entities in sibling modules can emit (e.g. `Feed.view()` emits `feed:updated`).

---

## [3.0.2] - 2026-04-30

### Features

- **`Message.mime`**: synchronous getter exposed on the base `Message` class (returns `_doc.mime`). Previously the field was only accessible on the internal document.
- **`Message.stream()`**: instance method moved to the base class so any `Message` typed reference can call it (was only defined on `Image`/`Video`/`Audio`). Returns a `Readable` of the media bytes (cache → baileys download → empty buffer fallback). The subclasses now inherit it directly.

### Internal

- Removed redundant `stream()` overrides on `Image`, `Video`, `Audio`. Their `content()` overrides remain (they drain the inherited stream).

---

## [3.0.1] - 2026-04-30

### Fixes

- **Build**: `build:esm` now passes `--resolve-full-paths` to `tsc-alias` so emitted ESM imports include explicit `.js` extensions and `/index.js` for directory imports. Without this, Node.js raised `ERR_UNSUPPORTED_DIR_IMPORT` when consumers loaded the package (`@arcaelas/whatsapp` and `@arcaelas/whatsapp/decorators`). Republished 3.0.0 was unpublished and superseded by 3.0.1.

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

### Documentation

- Rewrite all English references (`whatsapp`, `chat`, `contact`, `message`, `engines`, `events`, `schema`) against the V3 source.
- Rewrite all English examples (`basic-bot`, `command-bot`, `custom-engine`, `media`, `groups`, `polls`) with runnable V3 snippets using the required `engine` option, `connect(callback)` flow and `(msg, chat, wa)` event signatures.
- Rewrite home (`index`, `installation`, `getting-started`) and advanced (`engine`) docs to match the V3 API surface.
- Add `references/decorators.md` documenting the full Stage 3 decorator API with stacking rules.
- Add `examples/decorator-bot.md` with a complete runnable bot that uses every decorator.
- Translate all 19 EN docs to Spanish at the corresponding `.es.md` paths.
- Remove `baileys-payloads` docs (EN + ES) and its entry in `mkdocs.yml` (nav + `nav_translations`).
- Update `mkdocs.yml` to expose the new `Decorators` reference and `Decorator Bot` example in both languages.

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
