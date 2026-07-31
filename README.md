![Arcaelas Insiders](https://raw.githubusercontent.com/arcaelas/dist/main/banner/svg/dark.svg#gh-dark-mode-only) ![Arcaelas Insiders](https://raw.githubusercontent.com/arcaelas/dist/main/banner/svg/light.svg#gh-light-mode-only)

# @arcaelas/whatsapp

> Cliente de WhatsApp para Node.js sobre **baileys**, con persistencia intercambiable.
>
> _TypeScript de punta a punta · Entidades con getters puros · Motores enchufables · DSL de decoradores_

<p align="center">
  <a href="https://www.npmjs.com/package/@arcaelas/whatsapp"><img src="https://img.shields.io/npm/v/@arcaelas/whatsapp?color=cb3837" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-339933" alt="node >=20">
</p>

---

## Contenido

- [Instalación](#instalación)
- [Primeros pasos](#primeros-pasos)
- [Cliente](#cliente)
- [Entidades](#entidades)
  - [Contact](#contact)
  - [Chat](#chat)
  - [Message](#message)
  - [Feed](#feed)
- [Eventos](#eventos)
- [Motores de persistencia](#motores-de-persistencia)
- [Bots con decoradores](#bots-con-decoradores)
- [Recetas](#recetas)
- [Licencia](#licencia)

---

## Instalación

```bash
yarn add @arcaelas/whatsapp
```

Node 20 o superior. El paquete se distribuye en ESM y CJS.

**Peers opcionales**, solo si usás la función correspondiente:

| Paquete | Necesario para |
| --- | --- |
| `@aws-sdk/client-s3` | `S3Engine` |
| `sharp` o `jimp` | `wa.profile({ photo })` |

`RedisEngine` y `SQLiteEngine` no necesitan nada: reciben el cliente ya construido, así que servís vos el `ioredis`, `better-sqlite3` o `node:sqlite` que prefieras.

---

## Primeros pasos

```ts
import WhatsApp, { FileSystemEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new FileSystemEngine('.sessions/5491112345678'),
    phone: 5491112345678,
});

wa.on('message:created', async (msg) => {
    if (!msg.me && msg.caption === 'ping') {
        await msg.text('pong 🏓');
    }
});

// Con `phone` llega un PIN (string); sin `phone`, el QR como Buffer PNG.
await wa.connect((auth) => {
    console.log(typeof auth === 'string' ? `PIN: ${auth}` : 'QR listo');
});
```

---

## Cliente

```ts
new WhatsApp({ engine, phone?, method?, autoclean?, reconnect?, sync? })
```

| Opción | Descripción |
| --- | --- |
| `engine` | Motor de persistencia. Único obligatorio. |
| `phone` | Teléfono de la cuenta. Habilita el emparejamiento por PIN; sin él la vinculación es siempre por QR. |
| `method` | `'otp'` (default) o `'qr'`. **Solo aplica cuando hay `phone`**. |
| `autoclean` | Al recibir `loggedOut`: `true` (default) vacía el motor; `false` borra solo las credenciales. |
| `reconnect` | `true` (default) reintenta indefinidamente cada 60 s. Acepta `false`, un número de intentos o `{ max, interval }`. |
| `sync` | Descarga el historial completo al vincular (default `true`). |

### Superficie

```ts
wa.engine                     // motor de persistencia
wa.contact                    // Contact de la cuenta autenticada, o null sin sesión
wa.Contact / wa.Chat / wa.Message   // entidades ligadas a este cliente

await wa.connect(callback)    // callback recibe el PIN (string) o el QR (Buffer PNG)
await wa.disconnect({ silent?, destroy? })

wa.on(event, handler)         // devuelve la función para desuscribirse
wa.once(event, handler)
wa.off(event, handler)
wa.emit(event, ...args)

await wa.profile({ name?, content?, photo? })   // nombre público, bio y foto
await wa.feed({ content?, caption?, contacts }) // publica un estado
```

El estado interno (socket de baileys, emisor, credenciales) es **privado de verdad**: no está accesible desde la instancia. Todo pasa por los métodos de arriba.

### Perfil y estados

```ts
await wa.profile({ name: 'Ventas', content: 'Atendemos 9-18h' });
await wa.profile({ photo: buffer });        // o una URL
await wa.profile({ photo: null });          // elimina la foto

const post = await wa.feed({
    caption: '¡Estamos en vivo!',
    contacts: ['5491112345678', '584121234567'],   // audiencia obligatoria
});
```

`contacts` no es opcional: WhatsApp no entrega el estado a nadie fuera de esa lista. Con `content` (Buffer) se publica imagen o video —el tipo se deduce de la firma del binario— y `caption` queda como pie.

---

## Entidades

Cada entidad expone getters puros sobre su documento y métodos que actúan contra WhatsApp. `wa.Contact`, `wa.Chat` y `wa.Message` ya vienen ligados al cliente; las clases sueltas se importan del paquete cuando querés `instanceof` o los estáticos con el cliente explícito.

### Contact

```ts
const person = await wa.Contact.get('5491112345678');   // teléfono, JID o LID
const page = await wa.Contact.list(0, 50);

if (person) {
    person.name      // agenda → nombre público → nombre verificado → teléfono
    person.phone     // solo del JID PN, nunca del LID; null si no es determinable
    person.jid       // '5491112345678@s.whatsapp.net' | null
    person.lid       // '123456789@lid' | null
    person.photo     // URL de la foto | null
    await person.chat();
}
```

`get` lee del motor y, si el contacto no está persistido, lo descubre por red y lo materializa.

### Chat

```ts
const chat = await wa.Chat.get('5491112345678');
const chats = await wa.Chat.list(0, 50);

if (chat) {
    chat.id        // teléfono en contactos; id crudo en grupos y LIDs
    chat.name
    chat.type      // 'contact' | 'group'
    chat.archived  // boolean
    chat.pinned    // boolean
    chat.muted     // fecha ISO UTC hasta la que está silenciado, o null
    chat.count     // mensajes sin leer

    await chat.content();    // descripción del grupo, o bio del contacto en un 1:1
    await chat.messages(0, 50);
    await chat.members(0, 50);
    await chat.typing(true);
    await chat.recording(true);
    await chat.archive(true);
    await chat.pin(true);          // false si ya hay 3 fijados: WhatsApp descarta el cuarto
    await chat.mute('2026-08-01T10:00:00Z');   // o false para desactivar
    await chat.seen();             // marca el chat completo como leído
    await chat.clear();            // vacía los mensajes, conserva el chat
    await chat.delete();           // elimina el chat (sale del grupo si aplica)
}
```

### Message

```ts
import { Poll, Image } from '@arcaelas/whatsapp';

const page = await wa.Message.list(cid, 0, 50);   // del más reciente al más antiguo
const msg = await wa.Message.get(cid, mid);
```

**Propiedades**

| | |
| --- | --- |
| `id` `cid` `mid` | identificadores del mensaje, su chat y el mensaje citado |
| `from` `me` | JID del autor y si soy yo |
| `type` | `text` `image` `video` `audio` `sticker` `document` `location` `poll` `vcard` `event` |
| `mime` | `text/plain`, `text/json` en poll/location/vcard/event, el real en media |
| `caption` | texto del mensaje o pie del media |
| `status` | `'error'` `'pending'` `'sent'` `'delivered'` `'read'` `'played'` |
| `read` `starred` `forwarded` `edited` `once` | banderas del mensaje |
| `reason` | motivo del rechazo cuando `status` es `'error'` (`restricted`, `invalid-session`, o el código del servidor), si no `null` |
| `business` | nombre del negocio verificado que firma el mensaje, o `null` |
| `created_at` `expires_at` | fechas en ISO UTC (`expires_at` solo en mensajes temporales) |

**Métodos**

```ts
await msg.author();      // Contact
await msg.chat();        // Chat
await msg.message();     // el mensaje citado, si hay `mid`
await msg.content();     // Buffer
await msg.stream();      // Readable
await msg.reactions();   // [{ emoji, count }]

await msg.react('❤️');   // emoji vacío la retira
await msg.star(true);
await msg.seen();
await msg.edit('texto corregido');       // texto, imagen o video propios
await msg.forward('584121234567');       // CID, Chat o Contact destino
await msg.delete();                      // solo en mi dispositivo
await msg.delete(true);                  // para todos

await msg.text('respuesta');             // responder citando este mensaje
await msg.image(buffer, { caption: '…' });
```

**Envío** (los mismos nueve por tipo, en instancia para responder y en el cliente para iniciar):

```ts
await wa.Message.text(cid, 'hola', { once: true });
await wa.Message.image(cid, buffer, { caption: 'mirá' });
await wa.Message.video(cid, buffer);
await wa.Message.audio(cid, buffer, { ptt: true });
await wa.Message.location(cid, { lat: 8.3, lng: -62.7 });
await wa.Message.poll(cid, { content: '¿Qué pedimos?', options: [{ content: 'Pizza' }, { content: 'Sushi' }] });
await wa.Message.document(cid, buffer, { file_name: 'contrato.pdf' });
await wa.Message.vcard(cid, [{ name: 'Ana', phone: '+584121234567' }]);
await wa.Message.event(cid, { name: 'Demo', start: new Date() });
```

**Subclases** — el tipo decide la instancia, así que `instanceof` alcanza:

```ts
if (msg instanceof Image) console.log(msg.width, msg.height, msg.size, await msg.thumb());
if (msg instanceof Poll)  console.log(msg.options, msg.multiple, await msg.votes());
```

| Clase | Agrega |
| --- | --- |
| `Text` | `preview()` → `{ link, name, content, thumb }` del enlace citado |
| `Image` | `width` `height` `size` `thumb()` |
| `Video` | `width` `height` `size` `duration` `thumb()` |
| `Audio` | `ptt` `duration` `size` `waveform` (0-100, lista para pintar) |
| `Sticker` | `width` `height` `size` `animated` |
| `Document` | `name` `pages` `size` |
| `Location` | `lat` `lng` `live` `link` (Google Maps) |
| `Poll` | `options` `multiple` `votes()` `select(i)` |
| `VCard` | `contacts` |
| `Event` | `name` `start` `end` `canceled` `place` `link` |

### Feed

Publicaciones de estado (`status@broadcast`). Extiende `Message`, así que hereda `author()`, `content()`, `stream()` y `caption`.

```ts
wa.on('feed:created', async (post) => {
    console.log((await post.author()).name, post.caption, post.expires_at);
    await post.view();     // envía el read receipt
});
```

Lo que un estado no admite (`react`, `star`, `edit`, `forward`, `delete`, responder) lanza `ERR_FEED_UNSUPPORTED`.

---

## Eventos

```ts
const off = wa.on('message:created', (msg, chat) => { … });
off();   // desuscribe
```

| Evento | Argumentos |
| --- | --- |
| `connected` `disconnected` | `(wa)` |
| `contact:created` `contact:updated` | `(contact, chat, wa)` |
| `chat:created` `chat:deleted` | `(chat, wa)` |
| `chat:pinned` `chat:unpinned` | `(chat, wa)` |
| `chat:archived` `chat:unarchived` | `(chat, wa)` |
| `chat:muted` `chat:unmuted` | `(chat, wa)` |
| `message:created` `message:updated` `message:deleted` | `(message, chat, wa)` |
| `message:starred` `message:unstarred` `message:forwarded` `message:seen` | `(message, chat, wa)` |
| `message:reacted` | `(message, chat, emoji, wa)` |
| `feed:created` `feed:updated` `feed:deleted` | `(feed, wa)` |

---

## Motores de persistencia

Un motor es un almacén key/value de strings bajo rutas jerárquicas. El contrato completo:

```ts
interface Engine {
    get(path: string): Promise<string | null>;
    set(path: string, value: string, score?: number): Promise<void>;
    unset(path: string): Promise<boolean>;                          // borra el sub-árbol
    list(path: string, offset?: number, limit?: number): Promise<string[]>;   // hijos directos, score DESC
    count(path: string): Promise<number>;
    clear(): Promise<void>;

    get_buffer?(path: string): Promise<Buffer | null>;              // opcional: binarios sin base64
    set_buffer?(path: string, data: Buffer, score?: number): Promise<void>;
}
```

`score` fija el orden de `list` (los mensajes pasan su `created_at`), de modo que reescribir historia antigua no altera la cronología. Los binarios son opcionales: un motor que no los implemente sigue siendo válido y la librería cae al documento serializado.

```ts
import Database from 'better-sqlite3';
import IORedis from 'ioredis';
import { S3Client } from '@aws-sdk/client-s3';
import { FileSystemEngine, SQLiteEngine, RedisEngine, S3Engine } from '@arcaelas/whatsapp';

new FileSystemEngine('.sessions/5491112345678');
new SQLiteEngine(new Database('.sessions/5491112345678.db'));
new RedisEngine(new IORedis(), 'wa:5491112345678');
new S3Engine({ s3: new S3Client({}), bucket: 'sesiones', basedir: 'wa/5491112345678' });
```

`SQLiteEngine` es el más eficiente de los integrados. Sobre un chat real de 55.146 mensajes, frente al filesystem: 220 MB → 64 MB en disco, primer `list` 115 ms → 0,6 ms, y dos archivos en total en lugar de ~110.000 inodes.

Cada cliente necesita **su propio** motor: nunca compartas una instancia entre dos cuentas.

---

## Bots con decoradores

```ts
import { FileSystemEngine, type Chat, type Message } from '@arcaelas/whatsapp';
import { WhatsAppBot, connect, command, from, every } from '@arcaelas/whatsapp/decorators';

class Bot extends WhatsAppBot {
    @connect()
    async on_ready() {
        console.log('conectado');
    }

    @command('/precio')
    async price(msg: Message, chat: Chat, args: string[]) {
        await msg.text(`Consultando ${args[0] ?? 'el catálogo'}…`);
    }

    @from('5491112345678')
    async only_admin(msg: Message) {
        await msg.react('👑');
    }

    @every(3_600_000)
    async hourly() {
        console.log('cada hora, mientras esté conectado');
    }
}

const bot = new Bot({ engine: new FileSystemEngine('.sessions/bot'), phone: 5491112345678 });
await bot.connect((auth) => console.log(auth));
```

Decoradores disponibles: `@on`, `@once`, `@connect`, `@disconnect`, `@command`, `@guard`, `@from`, `@pipe`, `@every`, `@delay`, `@pair`, y `@Bot` como decorador de clase.

---

## Recetas

**Descargar el media de cada imagen recibida**

```ts
import { writeFile } from 'node:fs/promises';
import { Image } from '@arcaelas/whatsapp';

wa.on('message:created', async (msg) => {
    if (msg instanceof Image) {
        await writeFile(`${msg.id}.jpg`, await msg.content());
    }
});
```

**Responder solo en grupos**

```ts
wa.on('message:created', async (msg, chat) => {
    if (chat.type === 'group' && !msg.me) {
        await msg.react('👀');
    }
});
```

**Reconectar con límite y cerrar en silencio**

```ts
const wa = new WhatsApp({ engine, phone: 5491112345678, reconnect: { max: 5, interval: 30 } });
await wa.disconnect({ silent: true });   // no emite `disconnected`
```

---

## Licencia

ISC — © 2026 [Miguel Alejandro](https://github.com/arcaelas) / Arcaelas Insiders.
