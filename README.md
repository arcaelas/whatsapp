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

**Peers opcionales**, solo si usas la función correspondiente:

| Paquete | Necesario para |
| --- | --- |
| `@aws-sdk/client-s3` | `S3Engine` |
| `sharp` o `jimp` | `cuenta.photo(buffer)`, `group.photo(...)` |

`RedisEngine` y `SQLiteEngine` no necesitan nada: reciben el cliente ya construido, así que tú aportas el `ioredis`, `better-sqlite3` o `node:sqlite` que prefieras.

---

## Primeros pasos

```ts
import WhatsApp, { FileSystemEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new FileSystemEngine('.sessions/5491112345678'),
    phone: 5491112345678,
});

wa.on('message:created', async (msg) => {
    if (!msg.me && msg.caption() === 'ping') {
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
new WhatsApp({ engine, phone?, method?, autoclean?, reconnect?, sync?, device?, debug? })
```

| Opción | Descripción |
| --- | --- |
| `engine` | Motor de persistencia. Único obligatorio. |
| `phone` | Teléfono de la cuenta. Habilita el emparejamiento por PIN; sin él la vinculación es siempre por QR. |
| `method` | `'otp'` (default) o `'qr'`. **Solo aplica cuando hay `phone`**. |
| `autoclean` | Al recibir `loggedOut`: `true` (default) vacía el motor; `false` borra solo las credenciales. |
| `reconnect` | `true` (default) reintenta indefinidamente cada 60 s. Acepta `false`, un número de intentos o `{ max, interval }`. |
| `sync` | Descarga el historial completo al vincular, media incluida (default `false`). |
| `device` | Nombre con el que la sesión aparece en *Dispositivos vinculados* (default `'Chrome'`). |
| `debug` | Nivel del log interno de baileys, de `'silent'` (default) a `'trace'`. |

### Superficie

```ts
wa.engine                     // motor de persistencia
wa.Contact / wa.Chat / wa.Message / wa.Feed / wa.Catalog / wa.Product   // entidades, publicadas al conectar
await wa.me()                 // el Contact propio, o null sin usuario

await wa.connect(callback)    // callback recibe el PIN (string) o el QR (Buffer PNG)
await wa.disconnect({ silent?, destroy? })   // desvincula el dispositivo del teléfono

wa.on(event, handler)         // devuelve la función para desuscribirse
wa.once(event, handler)
wa.off(event, handler)
wa.emit(event, ...args)
```

Las entidades se publican en el primer `connect`, cuando el socket ya existe —antes no están definidas— y conservan su identidad entre reconexiones. El estado interno (socket, credenciales, reintentos) vive en el closure de `connect` — no hay nada que hurgar en la instancia.

`disconnect()` cierra la sesión de verdad: desvincula el dispositivo del teléfono y borra las credenciales; el próximo `connect()` vuelve a vincular. Para apagar un proceso basta con salir: el socket muere con él y la sesión sobrevive.

### La cuenta: `wa.me()`

La cuenta es un contacto más: `await wa.me()` devuelve el `Contact` propio (`me` es `true`), o `null` mientras no hay usuario. En él `rename()` cambia el nombre público; en otro contacto cambia el nombre de agenda, igual que `chat.name(value)` en su 1:1. `content(value)`, `photo(value)` y `online()` sólo funcionan en él; en otro contacto rechazan con `UNAUTHORIZED`.

```ts
const yo = await wa.me();

await yo?.rename('Ventas');              // nombre público
await yo?.photo(buffer);                 // cambia la foto de perfil; null la elimina
await yo?.content('Atendemos 9-18h');    // la bio
await yo?.online(true);                  // presencia: el socket arranca offline
await yo?.catalog();                     // sus Catalog, uno por colección
await wa.Feed.create({ caption: '¡Estamos en vivo!' });   // los estados se publican con Feed
```

---

## Entidades

Cada entidad expone getters puros sobre el raw que entregó WhatsApp —en mensajes, estados y catálogos, sobre su timeline de eventos— y métodos que actúan contra WhatsApp. Las clases viven en el cliente, ya ligadas a la sesión (`wa.Contact`, `wa.Chat`, `wa.Message`, `wa.Feed`, `wa.Catalog`, `wa.Product`); el paquete exporta sus nombres solo como tipos (`import type { Message } from '@arcaelas/whatsapp'`), así que `instanceof` se hace contra el cliente: `msg instanceof wa.Message.Image`.

Toda entidad tiene `metadata(patch?)` para guardar valores propios de la integración junto a ella: sin argumento lee; con un objeto fusiona, y las claves en `null` o `undefined` se borran; devuelve el objeto resultante. Vive en el engine, en `<ruta de la entidad>/metadata`, y se borra si queda vacío; WhatsApp nunca lo ve, y se pierde al cambiar de engine o al resincronizar.

```ts
await chat.metadata({ ticket: 'T-1024' });   // { ticket: 'T-1024' }
await chat.metadata();                       // lo lee
await chat.metadata({ ticket: null });       // {}: borra la clave
```

### Contact

```ts
const person = await wa.Contact.get('5491112345678');   // teléfono, JID o LID
const page = await wa.Contact.list(0, 50);

if (person) {
    person.id        // JID completo: el del teléfono, o el LID si no se conoce
    person.name      // agenda → nombre público → nombre verificado → teléfono
    person.phone     // solo del JID PN, nunca del LID; null si no es determinable
    person.me        // true si es la propia cuenta
    await person.photo();          // foto de perfil, Buffer; vacío si no tiene o la oculta
    await person.content();        // biografía; se consulta a WhatsApp a lo sumo cada 24 h y se guarda en el engine
    await person.rename('Juan');   // nombre de agenda, igual que chat.name('Juan'); en wa.me(), el público
    await person.chat();
    await person.catalog();        // sus Catalog, uno por colección
    await person.metadata('edad', 18);   // { edad: 18 }; metadata('edad') → 18
    const stop = person.sub(({ name, presence }) => console.log(name, presence));   // created, updated, deleted, presence
}
```

`get` lee del motor y, si el contacto no está persistido, lo descubre por red y lo materializa; un fallo de red rechaza, así `null` es sólo «no está en WhatsApp».

### Chat

```ts
const chat = await wa.Chat.get('5491112345678');
const chats = await wa.Chat.list(0, 50);

if (chat) {
    chat.id          // JID completo: teléfono en un 1:1, @g.us en un grupo, LID sin mapear
    chat.type        // 'contact' | 'group'
    chat.count       // mensajes sin leer
    chat.name()      // nombre del contacto o asunto del grupo
    chat.archived()  // boolean
    chat.pinned()    // boolean
    chat.muted()     // fecha ISO hasta la que está silenciado, o null
    chat.ephemeral() // segundos de los mensajes temporales, o false

    await chat.content();    // descripción del grupo, o bio del contacto en un 1:1
    await chat.messages(0, 50);
    await chat.members(0, 50);  // en un 1:1, el contacto y la cuenta
    await chat.photo();         // foto del grupo o del contacto, Buffer
    await chat.blocked(true);   // solo 1:1
    await chat.typing(true);
    await chat.recording(true);
    await chat.archived(true);
    await chat.pinned(true);          // false si ya hay 3 fijados: WhatsApp descarta el cuarto
    await chat.muted('2026-08-01T10:00:00Z');   // o false para desactivar
    await chat.seen();             // marca el chat completo como leído
    await chat.ephemeral(604_800); // mensajes temporales: 86400, 604800, 7776000 o false
    await chat.clear();            // vacía los mensajes, conserva el chat
    await chat.delete();           // elimina el chat (sale del grupo si aplica)
    const stop = chat.sub(({ name, message, contacts, presence }) => { … });   // created, updated, deleted, message, joined, left, promoted, demoted, presence
}
```

**Grupos** — sin permiso, o fuera del grupo, rechazan con `UNAUTHORIZED`:

```ts
const group = await wa.Chat.create('Equipo', ['5491112345678']);
await wa.Chat.join('https://chat.whatsapp.com/…');

await group.admins();                  // administradores
await group.admin();                   // true si la cuenta administra
await group.name('Equipo Dev');
await group.content('Standup a las 9:30');   // descripción; UNAUTHORIZED sin permiso
await group.photo(buffer);             // necesita sharp o jimp
await group.add('5491187654321');      // devuelve cuántos entraron
await group.remove('5491187654321');   // devuelve cuántos salieron
await group.admin(true, '5491187654321');    // da el rango; admin(false, …) lo quita
await group.invite();                  // enlace vigente
await group.revoke();                  // enlace nuevo
await group.announce(true);            // solo admins envían
await group.restrict(true);            // solo admins editan
```

### Message

```ts
const page = await wa.Message.list(cid, 0, 50);   // del más reciente al más antiguo
const msg = await wa.Message.get(cid, mid);
```

**Propiedades**

| | |
| --- | --- |
| `id` `cid` `mid` | identificadores del mensaje, su chat y el mensaje citado |
| `from` `me` | JID del autor —el de teléfono cuando la llave lo trae— y si soy yo |
| `type` | `text` `image` `video` `audio` `sticker` `document` `location` `poll` `vcard` `event` `product` |
| `mime` | `text/plain` en texto y producto, `application/json` en poll/location/vcard/event, el real en media |
| `status` | `'error'` `'pending'` `'sent'` `'delivered'` `'read'` `'played'` |
| `edited` `once` `mentioned` | banderas del mensaje |
| `revoked_at` | cuándo se eliminó para todos, en ISO, o `null` |
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

// cada valor: sin argumento lo lee, con argumento lo cambia
msg.caption();                           // texto vigente o pie del media
await msg.caption('texto corregido');    // edita texto, imagen o video propios en sus primeros 15 min; si no, UNAUTHORIZED
msg.forward();                           // true si llegó reenviado
await msg.forward('584121234567');       // reenvía a un CID, Chat o Contact y devuelve el Message
msg.seen();                              // true si ya lo leyeron
await msg.seen(true);                    // acusa leído
msg.starred(); await msg.starred(true);
msg.pinned(); await msg.pinned(true, 7); // fija 1, 7 o 30 días; false lo suelta
msg.reactions();                         // [{ emoji, count }]
await msg.reactions('❤️');               // reacciona; '' la retira
await msg.delete();                      // solo para mí
await msg.delete(true);                  // para todos si es mío; si es ajeno, solo para mí
await msg.mentions();                    // contactos mencionados
const stop = msg.sub(({ name }) => { … });   // updated, deleted, reacted, seen, played

await msg.text('respuesta');             // responde citando este mensaje
await msg.image(buffer, { caption: '…' });
```

`content()` depende del tipo: el texto en bytes, `{ lat, lng }` en JSON para una ubicación, `{ content, options }` en JSON para una encuesta, las vCards, el evento en JSON, la descripción del producto, o el binario del media: el guardado en el engine o, si falta, la descarga, pidiendo a WhatsApp el reenvío del media caducado.

**Envío** (los mismos diez por tipo, en instancia para responder y en el cliente para iniciar):

```ts
await wa.Chat.text(cid, 'hola');                     // también chat.text('hola') y wa.Message.text(cid, …)
await wa.Message.text(cid, 'hola', { once: true });
await wa.Message.text(cid, '@5491112345678 mira', { mentions: ['5491112345678'] });
await wa.Message.image(cid, buffer, { caption: 'mira' });
await wa.Message.video(cid, buffer, { gif: true });
await wa.Message.image(cid, webp, { sticker: true });
await wa.Message.audio(cid, buffer, { ptt: true });
await wa.Message.location(cid, { lat: 8.3, lng: -62.7, name: 'Tienda', address: 'Av. Principal 1' });
await wa.Message.poll(cid, { content: '¿Qué pedimos?', options: [{ content: 'Pizza' }, { content: 'Sushi' }] });
await wa.Message.document(cid, buffer, { file_name: 'contrato.pdf' });
await wa.Message.vcard(cid, [{ name: 'Ana', phone: '+584121234567' }]);
await wa.Message.event(cid, { name: 'Demo', start: new Date() });
```

**Subclases** — el tipo decide la instancia, así que `instanceof` contra las subclases de `wa.Message` alcanza:

```ts
if (msg instanceof wa.Message.Image) console.log(msg.width, msg.height, msg.size, msg.thumb);
if (msg instanceof wa.Message.Poll)  console.log(msg.options, msg.multiple, await msg.votes());
```

| Clase | Agrega |
| --- | --- |
| `Text` | `preview` → `{ link, name, content, thumb }` del enlace citado |
| `Image` | `width` `height` `size` `thumb` |
| `Video` | `width` `height` `size` `duration` `thumb` `ptv` (videonota redonda; un GIF es `ptv: false`) |
| `Audio` | `ptt` `duration` `size` `waveform` (0-100, lista para pintar) `played()` / `played(true)` |
| `Sticker` | `width` `height` `size` `animated` `thumb` |
| `Document` | `name` `pages` `size` `thumb` |
| `Location` | `lat` `lng` `name` `address` `live` `link` (Google Maps) |
| `Poll` | `options` `multiple` `votes()` (con el JID del votante) `select(i)` —`select([])` retira el voto; rechaza con `ERR_POLL_OPTION` o `ERR_POLL_SECRET`— |
| `VCard` | `contacts` (`{ name, phone }`, el teléfono en E.164) |
| `Event` | `name` `start` `end` `canceled` `place` (`{ lat, lng, name, address }`) `link` `going` `attendees()` `select('yes' \| 'no' \| 'maybe', guests?)` |
| `Product` | `pid` `name` `price` `currency` `link` `sku` `hidden` `thumb()` `photo()` `catalog()`; `id` es el del mensaje y `content()` la descripción — solo recepción, y también es `instanceof wa.Product` |

### Feed

Publicaciones de estado (`status@broadcast`), con su propia clase: `id`, `from`, `me`, `type` (`text` `image` `video` `audio`), `mime`, `caption`, `created_at` y `expires_at` (24 h después de publicado), más `seen()` / `seen(true)`, `delete()`, `content()`, `stream()`, `author()`, `sub()`, `metadata()` y las respuestas de `Sender`, que van al chat 1:1 del autor citando el estado.

```ts
await wa.Feed.create({ caption: 'Nueva colección', media: { buffer, mime: 'image/jpeg' } });   // sin audience: a mi agenda; el binario debe ser lo que dice mime (ERR_FEED_MEDIA)
const vigentes = await wa.Feed.list();

wa.on('feed:created', async (post) => {
    console.log((await post.author()).name, post.caption, post.expires_at);
    await post.seen(true);         // envía el recibo de visto y emite feed:updated
    await post.text('¡Lindo!');    // responde en el chat del autor
});
```

WhatsApp sólo muestra un estado a quien tiene al autor guardado en sus contactos.

### Catalog

Los catálogos de un negocio, el propio o el de cualquier contacto Business: un `Catalog` por colección o, si el negocio no tiene colecciones, uno con todos sus productos; sin catálogo, o sin respuesta, `[]` sin guardar nada. Se leen con el getter `catalog` del contacto: la primera lectura los descarga (colecciones y catálogo completo en paralelo, cada consulta cortada a los 20 s) y las siguientes salen del engine; con más de 24 h se devuelve lo guardado y se refresca de fondo, emitiendo `catalog:updated` si cambió. Solo lectura.

```ts
const propios = (await (await wa.me())?.catalog()) ?? [];   // los de la cuenta
const negocio = await wa.Contact.get('5491112345678');         // o los de cualquier negocio

for (const catalog of (await negocio?.catalog()) ?? []) {
    catalog.id; catalog.name; catalog.updated_at;   // name vacío en el que reúne todo el catálogo; updated_at en ISO, desde su metadata
    await catalog.contact();                        // el negocio dueño
    await catalog.products(0, 50);                  // Product[] en el orden del catálogo
    const stop = catalog.sub(({ payload }) => console.log(payload.name));   // cada descarga que lo cambió
}

const item = await wa.Catalog.product('5491112345678', 'SKU-123');   // por id de producto o por sku
```

Cada `Product` del catálogo expone `id` y `pid` (el id del producto), `name`, `price` (en unidades; WhatsApp lo manda en milésimas), `currency`, `link`, `thumb` (portada de 100×100), `photo` (portada original), `sku`, `hidden`, `status` (la revisión de Meta), `content()` con la descripción, `catalog()` con el `Catalog` que lo publica (o `null` si ya no está publicado) y `metadata()`. `instanceof wa.Product` es `true` para estos productos y para las tarjetas de producto que llegan a un chat.

---

## Eventos

```ts
const off = wa.on('message:created', (msg, chat) => { … });
off();   // desuscribe
```

| Evento | Argumentos |
| --- | --- |
| `connected` | `(wa)` |
| `disconnected` | `(wa, farewell)` — `{ code, reason, expired, detail }` |
| `error` | `(error, wa)` |
| `contact:created` `contact:updated` | `(contact, chat, wa)` |
| `contact:deleted` | `(contact, wa)` — la ficha del LID, al unirse a la del teléfono |
| `contact:presence` | `(contact, action, wa)` — solo de los contactos vigilados con `sub()` |
| `chat:created` `chat:updated` `chat:deleted` | `(chat, wa)` |
| `chat:joined` `chat:left` `chat:promoted` `chat:demoted` | `(chat, contacts, wa)` |
| `chat:pinned` `chat:unpinned` | `(chat, wa)` |
| `chat:archived` `chat:unarchived` | `(chat, wa)` |
| `chat:muted` `chat:unmuted` | `(chat, wa)` |
| `message:created` `message:updated` `message:deleted` | `(message, chat, wa)` |
| `message:starred` `message:unstarred` `message:forwarded` `message:seen` | `(message, chat, wa)` |
| `message:reacted` | `(message, chat, emoji, contact, wa)` |
| `feed:created` `feed:updated` `feed:deleted` | `(feed, wa)` |
| `catalog:updated` | `(catalog, wa)` — una descarga posterior cambió el catálogo |

`message:created` no se emite para los mensajes que envía la propia librería. `chat:pinned`, `chat:archived`, `chat:muted` y sus opuestos se emiten solo cuando el valor cambia de verdad.

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

Cada documento es el raw tal como lo entrega WhatsApp: el `Contact` y el `Chat` de baileys, fusionados campo por campo, o un timeline: los raws exactamente como los emitió baileys, en orden de llegada y sin sobre —el mensaje con los mensajes que lo refieren (reacciones, pin, edición, retiro, votos y asistencias, cifrados), cada `messages.update` y cada recibo; el estado con sus recibos; cada colección del catálogo con sus descargas distintas—. Cada getter busca en reversa el último raw que define su valor. Bajo `<ruta>/content` solo va el binario del media, y bajo `<ruta>/metadata`, los metadatos de la entidad. 9.0.0 no lee los documentos que escribió 8.x (documentos en snake_case, mensajes con campo `raw`): no hay migración.

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

`RedisEngine` borra en cascada recorriendo sus índices (`idx:` y `dir:`), nunca con `SCAN`: un `unset` cuesta el subárbol, no el keyspace entero. Los almacenes escritos antes de 8.4.0 no tienen `dir:`; arranca con un prefijo nuevo para no dejar huérfanos.

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
        await msg.reactions('👑');
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

wa.on('message:created', async (msg) => {
    if (msg instanceof wa.Message.Image) {
        await writeFile(`${msg.id}.jpg`, await msg.content());
    }
});
```

**Responder solo en grupos**

```ts
wa.on('message:created', async (msg, chat) => {
    if (chat.type === 'group' && !msg.me) {
        await msg.reactions('👀');
    }
});
```

**Reconectar con límite y desvincular en silencio**

```ts
const wa = new WhatsApp({ engine, phone: 5491112345678, reconnect: { max: 5, interval: 30 } });
await wa.disconnect({ silent: true });   // desvincula sin emitir `disconnected`
```

---

## Licencia

MIT — © 2026 Arcaelas Insiders.
