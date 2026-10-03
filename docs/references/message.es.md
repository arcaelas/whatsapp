# Message

`Message` es la clase raíz para cada mensaje entrante o saliente de WhatsApp. Posee toda la API de
instancia — getters, resolución de autor/chat, contenido, reacciones, respuestas, forwarding,
edición, eliminación —, hereda los envíos de `Sender`, y once subclases especializadas añaden lo propio de cada payload:

| Subclase | Añade |
| -------- | ----- |
| `Text` | `preview()` — la tarjeta del enlace embebido. |
| `Image` | `width`, `height`, `size`, `thumb()` |
| `Video` | `width`, `height`, `duration`, `size`, `thumb()` |
| `Audio` | `ptt`, `duration`, `size`, `waveform`, `played`, `play()` |
| `Sticker` | `width`, `height`, `animated`, `size` |
| `Document` | `name`, `pages`, `size` |
| `Location` | `lat`, `lng`, `live`, `link` |
| `Poll` | `multiple`, `options`, `votes()`, `select()` |
| `VCard` | `contacts` |
| `Event` | `name`, `start`, `end`, `canceled`, `link`, `place`, `going`, `attendees()` |
| `Product` | `pid`, `name`, `price`, `currency`, `link`, `thumb`, `photo`, `sku`, `hidden`, `catalog()` |

`width` y `height` valen `0` cuando el media no los trae, como pasa con una imagen enviada desde
esta sesión cuando baileys no tiene librería de imágenes (`sharp` o `jimp`).

`new wa.Message(timeline)` evalúa el tipo y devuelve la instancia de la subclase correcta. El
timeline es el documento que el engine guarda en `/chat/<cid>/message/<mid>`: los raws exactamente
como los emitió baileys, en orden de llegada y sin sobre. El primero es el `WAMessage` tal como lo
entregó WhatsApp; los siguientes son lo que baileys emitió para él: los mensajes que lo refieren
(reacciones, fijaciones, ediciones, retiros, votos y respuestas de evento, todavía cifrados), cada
`messages.update` —una lectura llega como uno, sin contenido—, los recibos y el mapeo `{ lid, pn }`
cuando el chat se tradujo de LID a teléfono. Cada getter busca en el timeline, de atrás hacia
adelante, el último raw que define su valor, y nada se reescribe: tras una edición, el texto anterior
sigue en el timeline.

---

## Importación

```typescript title="imports.ts"
import {
    WhatsApp,
    message,
    type Message,
    type Text, type Image, type Video, type Audio, type Sticker, type Document,
    type Location, type Poll, type VCard, type Event, type Product,
} from '@arcaelas/whatsapp';
```

Los nombres importados con `type` son **tipos**: anotan el código y no existen en runtime. Las
clases viven en la sesión que abre `connect()`: `wa.Message` y sus subclases `wa.Message.Text`,
`wa.Message.Poll`, `wa.Message.Image`, …, que son contra las que se comprueba `instanceof`.
`Product` es la unión del producto del catálogo y de la tarjeta que llega a un chat, e
`instanceof wa.Product` reconoce ambos. `message(init)` es la factory con la que el cliente
construye `wa.Message`.

!!! warning "`instanceof` se comprueba contra `wa.Message.*`"
    `Event` también es un global de Node, y con el `lib` DOM también lo son `Text`, `Image` y
    `Document`: `msg instanceof Event` compila, pero comprueba el global en lugar de la clase de la
    librería. Escribe `msg instanceof wa.Message.Event`.

---

## Detección de tipo en runtime

```typescript title="instanceof.ts" hl_lines="2 6 11 15 19 23"
wa.on('message:created', async (msg, chat) => {
    if (msg instanceof wa.Message.Text) {
        console.log('text:', msg.caption());
        console.log('link card:', await msg.preview());
    }
    if (msg instanceof wa.Message.Image) {
        const bytes = await msg.content();
        console.log('image:', msg.width, 'x', msg.height, bytes.length, 'bytes');
    }
    if (msg instanceof wa.Message.Video) {
        const stream = await msg.stream();   // canalizar a S3, ffmpeg, …
        console.log('video:', msg.duration, 's');
    }
    if (msg instanceof wa.Message.Audio) {
        console.log('voice note?', msg.ptt, 'waveform points:', msg.waveform.length);
    }
    if (msg instanceof wa.Message.Sticker) {
        console.log('sticker animated?', msg.animated);
    }
    if (msg instanceof wa.Message.Document) {
        console.log('file:', msg.name, msg.pages, 'pages', msg.size, 'bytes');
    }
    if (msg instanceof wa.Message.Location) {
        console.log('at', msg.lat, msg.lng, 'live?', msg.live, msg.link);
    }
    if (msg instanceof wa.Message.Poll) {
        console.log('question:', msg.caption(), 'options:', msg.options);
    }
    if (msg instanceof wa.Message.VCard) {
        console.log('contacts:', msg.contacts);
    }
    if (msg instanceof wa.Message.Event) {
        console.log('event:', msg.name, '@', msg.start);
    }
    if (msg instanceof wa.Message.Product) {
        console.log('product:', msg.name, msg.price, msg.currency, 'pid', msg.pid);
    }
});
```

La vía rápida es `msg.type`, un getter síncrono:

```typescript title="switch-type.ts"
switch (msg.type) {
    case 'text':     break;
    case 'image':    break;
    case 'video':    break;
    case 'audio':    break;
    case 'sticker':  break;
    case 'document': break;
    case 'location': break;
    case 'poll':     break;
    case 'vcard':    break;
    case 'event':    break;
    case 'product':  break;
}
```

---

## Propiedades

| Propiedad    | Tipo                                                              | Descripción                                                                                      |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `id`         | `string`                                                          | Identificador del mensaje (`key.id` en baileys).                                                 |
| `cid`        | `string`                                                          | Chat al que pertenece: el JID del teléfono cuando se conoce; si no, el LID o el id del grupo.   |
| `mid`        | `string \| null`                                                  | Identificador del mensaje citado, o `null`.                                                      |
| `from`       | `string`                                                          | JID del autor: el del teléfono cuando la llave lo trae; si no, el LID.                           |
| `me`         | `boolean`                                                         | `true` cuando la cuenta autenticada es la autora.                                                |
| `type`       | `'text' \| 'image' \| 'video' \| 'audio' \| 'sticker' \| 'document' \| 'location' \| 'poll' \| 'vcard' \| 'event' \| 'product'` | Tipo del mensaje. |
| `mime`       | `string`                                                          | `text/plain` en texto y productos, `text/json` en encuesta/ubicación/tarjeta/evento, el MIME real en media. |
| `status`     | `'error' \| 'pending' \| 'sent' \| 'delivered' \| 'read' \| 'played'` | Estado de entrega; un `error` posterior manda sobre cualquier avance.                       |
| `reason`     | `string \| null`                                                  | Motivo del rechazo cuando `status` es `error`: `restricted` (WhatsApp limitó la cuenta y bloquea chats nuevos), `invalid-session`, o el código crudo. |
| `mentioned`  | `boolean`                                                         | `true` cuando la cuenta está mencionada en el cuerpo (compara JID y LID).                        |
| `edited`     | `boolean`                                                         | `true` cuando el timeline guarda una edición posterior.                                          |
| `once`       | `boolean`                                                         | `true` cuando es de una sola vista o reproducción; `content()` igual devuelve su binario.       |
| `expires_at` | `string \| null`                                                  | Vencimiento de un mensaje temporal en ISO, o `null`.                                             |
| `revoked`    | `string \| null`                                                  | Cuándo se eliminó para todos, en ISO, o `null`. El mensaje queda para que la interfaz muestre *se eliminó este mensaje*. |
| `business`   | `string \| null`                                                  | Negocio verificado que firma el mensaje, o `null`.                                               |
| `created_at` | `string`                                                          | Fecha de creación en ISO.                                                                        |

!!! danger "`status: 'error'` con `reason: 'restricted'` no se arregla reintentando"
    Es el código **463**: WhatsApp limitó la cuenta y le impide abrir chats nuevos, mientras los
    chats ya establecidos siguen funcionando.

---

## Métodos

Cada valor que la cuenta también puede cambiar es un único método: lee sin argumento y escribe con
uno. Lo que la cuenta no puede cambiar rechaza con `ERR_NOT_ALLOWED`.

### `caption()` / `caption(value)`

```typescript
caption(): string
caption(value: string): Promise<string>
```

El texto o el pie del media según la última edición (la pregunta en una encuesta, la descripción en
un evento, el cuerpo o la descripción en un producto). Con texto edita un mensaje **tuyo** de tipo
`text`, `image` o `video`; cualquier otro rechaza con `ERR_NOT_ALLOWED`.

### `forward()` / `forward(target)`

```typescript
forward(): boolean
forward(target: Chat | Contact | string): Promise<Message>
```

Sin argumento, si llegó reenviado. Con un destino —un `Chat`, un `Contact` o cualquier
identificador— lo reenvía allí y devuelve el `Message` reenviado, que se guarda como cualquier
mensaje enviado.

### `seen()` / `seen(true)`

```typescript
seen(): boolean
seen(value: true): Promise<boolean>
```

Sin argumento, si ya lo leyeron (`status` es `read` o `played`). Con `true` lo acusa leído y pone la
cuenta en línea, como [`chat.seen()`](chat.es.md#seen-seenfalse). Marcar como no leído sólo existe
para el chat entero: `chat.seen(false)`.

### `starred()` / `pinned()`

```typescript
starred(): boolean
starred(value: boolean): Promise<boolean>
pinned(): boolean
pinned(value: boolean, days?: 1 | 7 | 30): Promise<boolean>
```

Leen o cambian si el mensaje está destacado, o fijado en el chat por 1, 7 (por defecto) o 30 días.

### `reactions()` / `reactions(emoji)`

```typescript
reactions(): { emoji: string; count: number }[]
reactions(emoji: string): Promise<boolean>
```

Sin argumento, las reacciones vigentes agrupadas por emoji —la última de cada autor—. Con un emoji
reacciona, y `''` retira la reacción.

### `delete(all?)`

```typescript
delete(all?: boolean): Promise<boolean>
```

`delete()` elimina el mensaje sólo para ti y lo saca del motor. `delete(true)` lo elimina para todos
cuando es tuyo —queda en su sitio con `revoked`—; en un mensaje ajeno lo elimina sólo para ti.

### `content()` / `stream()`

```typescript
content(): Promise<Buffer>
stream(): Promise<Readable>
```

El contenido. El media devuelve el binario guardado o lo descarga —pidiendo a WhatsApp el reenvío si
caducó— y lo guarda; **lanza** si no se puede descargar. Los mensajes de una sola vista también
devuelven su binario: `once` dice si lo es. Los demás tipos lo derivan del timeline:

| Tipo                                          | Contenido                                  |
| --------------------------------------------- | ------------------------------------------ |
| `text`                                        | Texto UTF-8.                               |
| `image` / `video` / `audio` / `sticker` / `document` | Binario descifrado.                 |
| `location`                                    | JSON `{ lat, lng }`.                       |
| `poll`                                        | JSON `{ content, options: [{ content }] }`. |
| `vcard`                                       | Las vCard crudas.                          |
| `event`                                       | JSON del mensaje del evento.               |
| `product`                                     | La descripción del producto.               |

### `author()` / `chat()` / `message()` / `mentions()`

```typescript
author(): Promise<Contact>
chat(): Promise<Chat>
message(): Promise<Message | null>
mentions(): Promise<Contact[]>
```

Puentes al autor, al chat (guardado o mínimo), al mensaje **citado** cuando hay `mid`, y a los
contactos mencionados en el cuerpo. `caption()` conserva el `@<id>` crudo de cada mención:
reemplazarlo por el nombre le toca a quien lo muestra.

### `sub(handler)`

```typescript
sub(handler: (event: { name: 'updated' | 'deleted' | 'reacted' | 'seen' | 'played'; payload: Message; emoji?: string; contact?: Contact }) => void): () => void
```

Se suscribe a lo que le pasa a este mensaje: cambia, se elimina para todos, recibe una reacción
—con `emoji` y `contact`—, lo leen o reproducen su audio. Devuelve la función que desuscribe.

### `metadata()`

```typescript
metadata(): Promise<Record<string, unknown>>
metadata(key: string): Promise<unknown>
metadata(key: string, value: unknown): Promise<Record<string, unknown>>
metadata(patch: Record<string, unknown>): Promise<Record<string, unknown>>
```

Valores de la integración bajo `/chat/<cid>/message/<mid>/metadata`, igual que
[`contact.metadata()`](contact.es.md#metadata).

---

## Envíos

`Contact`, `Chat` y `Message` extienden una clase base, `Sender`: cada una dice qué es y a qué chat
pertenece, y con eso la base resuelve los envíos —como estáticos reciben el chat, en la instancia lo
toman de ella—, `typing()`, `recording()` y `metadata()`. Desde un `Contact` el envío va a su chat
1:1; desde un `Message` va a su chat y lo **cita**.

```typescript title="send.ts"
await wa.Chat.text(cid, 'hola');                       // estático: cualquier chat, creado si falta
await chat.text('hola');                               // instancia: este chat
await msg.text('pong');                                // respuesta: cita msg
await wa.Message.text(cid, 'hola', { mid });           // los mismos estáticos están en wa.Message
```

| Método                        | Contenido                                                | Opciones propias                             |
| ----------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| `text(cid?, caption, extra?)` | `string`                                                 | —                                            |
| `image(cid?, buf, extra?)`    | `Buffer`                                                 | `caption?`, `sticker?`                       |
| `video(cid?, buf, extra?)`    | `Buffer`                                                 | `caption?`, `gif?`                           |
| `audio(cid?, buf, extra?)`    | `Buffer`                                                 | `ptt?` (por defecto `true`)                  |
| `document(cid?, buf, extra)`  | `Buffer`                                                 | `file_name`, `mimetype?`, `caption?`         |
| `location(cid?, loc, extra?)` | `{ lat, lng }`                                           | —                                            |
| `poll(cid?, input, extra?)`   | `{ content, options: [{ content }] }`                    | `multiple?`                                  |
| `vcard(cid?, contacts, extra?)` | `{ name, phone }[]`                                    | —                                            |
| `event(cid?, data, extra?)`   | `{ name, caption?, start, end?, place? }`                | —                                            |

`cid` sólo existe en los estáticos. Cada envío devuelve el `Message` creado, ya de la subclase
correcta, y rechaza con `ERR_INVALID_CHAT` cuando el chat no se puede resolver.

```typescript title="options.ts"
interface Extra {
    mid?: string;                                  // cita ese mensaje
    once?: boolean;                                // una sola vista o reproducción
    expiration?: 86_400 | 604_800 | 7_776_000;     // segundos para que desaparezca
    mentions?: (Contact | string | number)[];      // a quién se refiere cada `@<teléfono>` del texto
}
```

!!! info "Stickers"
    `image(buf, { sticker: true })` envía un sticker. WhatsApp sólo acepta WebP: otro formato se
    convierte a WebP de 512×512 con `sharp` cuando está instalado, y sin él el envío rechaza con
    `ERR_STICKER_LIB`. `sharp` sigue siendo una dependencia opcional.

!!! info "Menciones: escribe el teléfono, la librería lo traduce"
    Escribe `@<teléfono>` en el texto y pasa las mismas personas en `mentions`. En un grupo que
    direcciona a sus miembros por LID, la librería reescribe cada `@` al LID, así el `mentioned` del
    receptor es `true` y `mentions()` resuelve los contactos.

---

## Estáticos (`wa.Message.*`)

| Estático            | Firma                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| `wa.Message.get`    | `(cid, mid) => Promise<Message \| null>`                               |
| `wa.Message.list`   | `(cid, offset?, limit?) => Promise<Message[]>` (por defecto `0, 50`)   |
| `wa.Message.delete` | `(cid, mid, all?) => Promise<boolean>`                                 |

Además de los envíos de [Envíos](#envios). Lo demás se hace sobre la instancia:
`(await wa.Message.get(cid, mid))?.reactions('👍')`.

---

## Encuestas

`Poll.options` expone cada opción con su conteo de votos en vivo, `votes()` desglosa el resultado
por votante y `select()` emite un voto desde la cuenta autenticada. `multiple` sale del
`selectableOptionsCount` de la encuesta: WhatsApp manda `1` en las de una sola respuesta.

```typescript title="poll.ts" hl_lines="12 19"
const sent = await wa.Message.poll(cid, {
    content: "What's for lunch?",
    options: [{ content: 'Pizza' }, { content: 'Tacos' }, { content: 'Ramen' }],
});

wa.on('message:updated', async (msg) => {
    if (msg instanceof wa.Message.Poll) {
        for (const option of msg.options) {
            console.log(option.name, '->', option.count);   // { name, count }
        }
        for (const vote of await msg.votes()) {
            console.log(vote.contact, 'voted', vote.name);  // { name, contact }
        }
    }
});

if (sent instanceof wa.Message.Poll) {
    await sent.select(0);        // opción única
    await sent.select([0, 2]);   // solo tiene sentido cuando `multiple === true`
}
```

!!! info "Los votos entrantes se descifran por ti"
    Los votos viajan cifrados. El cliente suma cada `pollUpdateMessage` al timeline de la encuesta
    tal como lo emitió baileys y emite `message:updated`; `options` y `votes()` los descifran al
    leerlos y cuentan el último voto de cada votante.

!!! warning "`select()` es best-effort"
    Los votos emitidos se cifran y se retransmiten correctamente, pero WhatsApp **no** propaga un
    voto emitido desde un dispositivo vinculado (companion), que es lo que esta librería es. Los
    votos entrantes se descifran bien; tu propio voto puede no aparecer en otros dispositivos.

---

## Ubicación

`Location` cubre tanto los pines estáticos (`locationMessage`) como las ubicaciones en vivo
(`liveLocationMessage`); `live` los distingue y `link` construye la URL de Google Maps.

```typescript title="location.ts"
await wa.Message.location(cid, { lat: 19.4326, lng: -99.1332 });

wa.on('message:created', (msg) => {
    if (msg instanceof wa.Message.Location && msg.live) {
        console.log('live location ->', msg.lat, msg.lng, msg.link);
    }
});
```

!!! warning "El envío siempre es un pin estático"
    La API de envío recibe solo `{ lat, lng }`: emitir una ubicación *en vivo* no está soportado. En
    una ubicación en vivo recibida, `lat` y `lng` son las coordenadas del mensaje tal como llegó.

---

## Audio

`ptt` distingue las notas de voz de los archivos de audio, y `waveform` devuelve los puntos de
amplitud 0-100 del protocolo, listos para pintar.

```typescript title="audio.ts"
import { readFileSync } from 'node:fs';

await wa.Message.audio(cid, readFileSync('./note.ogg'));                  // nota de voz (por defecto)
await wa.Message.audio(cid, readFileSync('./song.mp3'), { ptt: false });  // archivo de audio

wa.on('message:created', (msg) => {
    if (msg instanceof wa.Message.Audio) {
        console.log(msg.ptt ? 'voice note' : 'audio file', msg.duration, 's');
        console.log(msg.waveform);   // number[]
    }
});
```

---

## Previews de texto

```typescript title="preview.ts"
if (msg instanceof wa.Message.Text) {
    const card = await msg.preview();
    if (card) {
        console.log(card.link, card.name, card.content, card.thumb?.length);
    }
}
```

`preview()` devuelve `null` cuando el mensaje no trae metadata de enlace.

---

## Eventos de calendario

```typescript title="event.ts"
if (msg instanceof wa.Message.Event) {
    console.log(msg.name);       // título del evento
    console.log(msg.caption());    // descripción
    console.log(msg.start);      // ISO UTC
    console.log(msg.end);        // ISO UTC | null
    console.log(msg.canceled);   // boolean
    console.log(msg.link);       // enlace de unión ('' si no hay)
    console.log(msg.place);      // { lat, lng } | null
}
```

`going` cuenta a los asistentes confirmados, acompañantes incluidos, y `attendees()` lista cada
respuesta con el nombre del contacto, en orden de llegada: `{ name, contact, response: 'going' |
'not_going' | 'maybe', guests }`. Las respuestas llegan cifradas y se suman a su timeline tal como
las emitió baileys —con la respuesta que baileys ya descifró, cuando pudo—, emiten `message:updated`
sobre el `Event` y se descifran con el secreto del evento al leerlas.

```typescript title="attendees.ts"
wa.on('message:updated', async (msg) => {
    if (msg instanceof wa.Message.Event) {
        console.log(msg.going, 'going');
        for (const entry of await msg.attendees()) console.log(entry.name, entry.response, entry.guests);
    }
});
```

!!! tip "Payloads de eventos"
    Los listeners de `message:*` reciben `(msg, chat, wa)` y `msg` ya es instancia de la subclase
    correcta, así que `instanceof` funciona sin discriminación manual.

---

## Productos

Un `wa.Message.Product` es la tarjeta que una cuenta Business comparte desde su catálogo. Tiene la
misma superficie que el producto del catálogo ([`wa.Product`](catalog.es.md)), con `pid` para el
producto e `id` para el mensaje, e `instanceof wa.Product` también es `true` para ella. `thumb` es la
miniatura embebida como data URL; `photo` siempre es `null`, porque la tarjeta no trae foto pública,
y `hidden` siempre es `false`, porque la tarjeta solo viaja mientras el producto es visible. `status`
es el estado de entrega heredado, `caption()` el cuerpo de la tarjeta o la descripción, y `content()`
la descripción. `catalog()` trae el catálogo que lo publica —el negocio sale del `businessOwnerJid`
de la tarjeta, o de su autor cuando la tarjeta no lo trae—, o `null` cuando el producto ya no está
publicado; [`wa.Catalog.product(uid, pid)`](catalog.es.md) trae el producto en sí.

```typescript title="product.ts"
if (msg instanceof wa.Message.Product) {
    console.log(msg.name, msg.price, msg.currency);                // 'Camisa', 15.5, 'USD'
    console.log(msg.id, msg.pid, msg.sku, msg.link);               // id del mensaje, id del producto, sku, enlace
    console.log(msg.caption(), (await msg.content()).toString());    // cuerpo o descripción; descripción
    console.log(msg.thumb, msg.photo, msg.hidden);                 // data URL | null, null, false
    const catalog = await msg.catalog();                           // Catalog | null
}
```

!!! note "Solo recepción"
    Enviar tarjetas de producto y editar el catálogo no forman parte de la API: WhatsApp no
    respondió esas peticiones desde un dispositivo vinculado durante la verificación, así que no se
    publican.
