# Message

`Message` es la clase raíz para cada mensaje entrante o saliente de WhatsApp. Posee toda la API de
instancia — getters, resolución de autor/chat, contenido, reacciones, respuestas, forwarding,
edición, eliminación — y once subclases especializadas añaden lo propio de cada payload:

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
| `Product` | `name`, `description`, `price`, `currency`, `product_id`, `retailer_id`, `url`, `owner`, `thumb()`, `item()` |

La factory `new Message(init, raw)` evalúa el tipo y devuelve la instancia de la subclase correcta. Acepta
tanto un documento persistido como un `WAMessage` crudo de baileys — en ese caso el documento (id,
tipo, autor, caption, mime, fechas) se deriva ahí mismo.

---

## Importación

```typescript title="imports.ts"
import {
  WhatsApp,
  Message,
  message,
  Text, Image, Video, Audio, Sticker, Document, Location, Poll, VCard, Event, Product,
} from "@arcaelas/whatsapp";
```

Las subclases son **exports del módulo**. Las mismas clases se re-exponen además en el delegado del
cliente (`wa.Message.Poll`, `wa.Message.Image`, …), así que ambas formas del chequeo `instanceof`
son equivalentes.

---

## Detección de tipo en runtime

```typescript title="instanceof.ts" hl_lines="2 6 11 15 19 23"
wa.on("message:created", async (msg, chat) => {
  if (msg instanceof Text) {
    console.log("texto:", msg.caption);
    console.log("tarjeta del enlace:", await msg.preview());
  }
  if (msg instanceof Image) {
    const bytes = await msg.content();
    console.log("imagen:", msg.width, "x", msg.height, bytes.length, "bytes");
  }
  if (msg instanceof Video) {
    const stream = await msg.stream(); // canalizar a S3, ffmpeg, …
    console.log("video:", msg.duration, "s");
  }
  if (msg instanceof Audio) {
    console.log("¿nota de voz?", msg.ptt, "puntos de onda:", msg.waveform.length);
  }
  if (msg instanceof Sticker) {
    console.log("¿sticker animado?", msg.animated);
  }
  if (msg instanceof Document) {
    console.log("archivo:", msg.name, msg.pages, "páginas", msg.size, "bytes");
  }
  if (msg instanceof Location) {
    console.log("en", msg.lat, msg.lng, "¿en vivo?", msg.live, msg.link);
  }
  if (msg instanceof Poll) {
    console.log("pregunta:", msg.caption, "opciones:", msg.options);
  }
  if (msg instanceof VCard) {
    console.log("contactos:", msg.contacts);
  }
  if (msg instanceof Event) {
    console.log("evento:", msg.name, "@", msg.start);
  }
  if (msg instanceof Product) {
    console.log("producto:", msg.name, msg.price, msg.currency, "de", msg.owner);
  }
});
```

La vía rápida es `msg.type`, un getter síncrono:

```typescript title="switch-type.ts"
switch (msg.type) {
  case "text":     break;
  case "image":    break;
  case "video":    break;
  case "audio":    break;
  case "sticker":  break;
  case "document": break;
  case "location": break;
  case "poll":     break;
  case "vcard":    break;
  case "event":    break;
  case "product":  break;
}
```

---

## Propiedades

| Propiedad | Tipo | Descripción |
| --------- | ---- | ----------- |
| `id` | `string` | Identificador del mensaje (`key.id` en baileys). |
| `cid` | `string` | Identificador del chat al que pertenece el mensaje. |
| `mid` | `string \| null` | Identificador del mensaje citado, o `null`. |
| `from` | `string` | JID del autor, para acceso síncrono (sin hidratación). |
| `me` | `boolean` | `true` cuando el autor es la cuenta autenticada. |
| `type` | `'text' \| 'image' \| 'video' \| 'audio' \| 'sticker' \| 'document' \| 'location' \| 'poll' \| 'vcard' \| 'event' \| 'product'` | Tipo del mensaje. |
| `mime` | `string` | `text/plain` en texto, `text/json` en poll/location/vcard/event/product, el MIME real en media. |
| `caption` | `string` | Texto del mensaje o pie del media (la pregunta en una encuesta, la descripción en un evento o en una tarjeta de producto). |
| `status` | `'error' \| 'pending' \| 'sent' \| 'delivered' \| 'read' \| 'played'` | Estado de entrega legible. |
| `read` | `boolean` | `true` cuando el estado llegó a `read` o `played`. |
| `reason` | `string \| null` | Motivo del rechazo cuando `status` es `error`: `restricted` (WhatsApp limitó la cuenta y bloquea abrir chats nuevos), `invalid-session`, o el código crudo del servidor si es otro. `null` en cualquier otro estado. |
| `business` | `string \| null` | Nombre del negocio verificado que firma el mensaje (WhatsApp lo muestra bajo el texto), o `null`. |
| `starred` | `boolean` | `true` si el mensaje está destacado. |
| `forwarded` | `boolean` | `true` si el mensaje fue reenviado. |
| `edited` | `boolean` | `true` si el mensaje fue editado. |
| `revoked` | `boolean` | `true` si se eliminó para todos. El documento se conserva para que la interfaz muestre *se eliminó este mensaje* en su lugar. |
| `revoked_at` | `string \| null` | Fecha del retiro en **ISO UTC**, o `null`. |
| `pinned` | `boolean` | `true` mientras el mensaje está fijado en el chat. |
| `mentioned` | `boolean` | `true` si la cuenta autenticada está mencionada en el cuerpo (compara JID y LID). |
| `once` | `boolean` | `true` si es de una sola lectura (view-once). |
| `created_at` | `string` | Fecha de creación como **string ISO UTC**. |
| `expires_at` | `string \| null` | Vencimiento de un mensaje temporal en **ISO UTC**, o `null`. |

!!! warning "Las fechas son strings ISO y `status` es una palabra"
    `created_at` / `expires_at` son `string` (`'2026-07-31T14:05:03.000Z'`), no números epoch, y
    `status` es un string legible, no un enum numérico. Los valores numéricos crudos siguen en
    `_raw.created_at`, `_raw.deleted_at` y `_raw.status` si necesitas hacer aritmética:

    ```typescript
    const age_ms = Date.now() - new Date(msg.created_at).getTime();
    ```

!!! danger "`status: 'error'` con `reason: 'restricted'` no se arregla reintentando"
    Es el código **463** del servidor: WhatsApp limitó esa cuenta y le bloquea **abrir chats
    nuevos**, aunque los chats ya establecidos siguen funcionando. Reenviar el mismo mensaje
    vuelve a fallar; el mismo texto desde otra cuenta llega sin problema.

    ```typescript
    const sent = await wa.Message.text(cid, "hola");
    if (sent?.status === 'error' && sent.reason === 'restricted') {
        // esta línea solo puede continuar conversaciones que ya existen
    }
    ```

---

## Métodos

### `author()` / `chat()`

```typescript
author(): Promise<Contact>
chat(): Promise<Chat>
```

Resuelven el remitente y la conversación desde el motor, cayendo en una instancia mínima cuando el
documento todavía no está persistido.

```typescript title="author-chat.ts"
const sender = await msg.author();
const chat   = await msg.chat();

console.log(sender.name, sender.phone, chat.name);
```

### `mentions()`

```typescript
mentions(): Promise<Contact[]>
```

Los contactos **mencionados** en el cuerpo, en orden de aparición, resueltos desde el motor con una
instancia mínima cuando no están persistidos. Solo el texto, la imagen y el video llevan menciones.

El `caption` conserva el identificador crudo del protocolo —`@233539534610440`—: sustituirlo por el
nombre es cosa de quien lo presenta.

```typescript title="mentions.ts"
if (msg.mentioned) {
  const people = await msg.mentions();
  const text = people.reduce((acc, person) => acc.replace(`@${(person.lid ?? person.jid ?? '').split('@')[0]}`, `@${person.name}`), msg.caption);
  console.log(text);
}
```

### `message()`

```typescript
message(): Promise<Message | null>
```

El mensaje **citado** cuando hay `mid`, `null` si no.

```typescript title="quoted.ts"
const quoted = await msg.message();

if (quoted) {
  console.log("respondiendo a:", quoted.caption);
}
```

### `content()` / `stream()`

```typescript
content(): Promise<Buffer>
stream(): Promise<Readable>
```

El contenido del mensaje. Las subclases de media leen primero la caché del motor y caen en una
descarga de baileys; el resto devuelve lo que se persistió al recibirlo:

| Tipo | Contenido |
| ---- | --------- |
| `text` | Texto UTF-8. |
| `image` / `video` / `audio` / `sticker` / `document` | Binario descifrado. |
| `location` | JSON `{ lat, lng }`. |
| `poll` | JSON `{ content, options: [{ content }] }`. |
| `vcard` | Las vCards crudas. |
| `event` | JSON del mensaje de evento. |

```typescript title="content.ts"
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";

if (msg instanceof Image) {
  await writeFile(`${msg.id}.jpg`, await msg.content());
}

if (msg instanceof Video) {
  (await msg.stream()).pipe(createWriteStream(`${msg.id}.mp4`));
}
```

`content()` devuelve un buffer vacío cuando no se guardó nada y el media ya no se puede descargar
(contenido vencido).

### `reactions()`

```typescript
reactions(): Promise<{ emoji: string; count: number }[]>
```

Las reacciones del mensaje agrupadas por emoji con su conteo.

```typescript title="reactions.ts"
for (const { emoji, count } of await msg.reactions()) {
  console.log(emoji, count);
}
```

### `react(emoji)`

Reacciona al mensaje; un string vacío retira tu reacción.

```typescript title="react.ts"
await msg.react("❤️");
await msg.react(""); // retirar
```

### `star(value)` / `seen()`

```typescript title="star-seen.ts"
await msg.star(true);
await msg.seen();
```

### `pin(value, days?)`

```typescript
pin(value: boolean, days: 1 | 7 | 30 = 7): Promise<boolean>
```

Fija el mensaje en el chat por 24 horas, 7 días o 30 días, o lo suelta. WhatsApp lo confirma con
`message:updated` y `pinned` cambia en el mensaje guardado.

```typescript title="pin.ts"
await msg.pin(true, 30);
await msg.pin(false);
```

### `watch(handler)`

```typescript
watch(handler: (event: { name: 'read' | 'played' | 'deleted'; payload: Message }) => void): () => void
```

Supervisa qué le pasa a este mensaje: que lo lean, que reproduzcan su audio o que lo retiren. Solo
cuentan los avances — un estado repetido no es noticia — y todo tipo de mensaje lo hereda. Devuelve
la función que deja de supervisar.

```typescript title="watch.ts"
const sent = await wa.Message.audio(cid, buffer);
const stop = sent!.watch(({ name }) => {
  console.log(name);   // 'read', luego 'played'
  if (name === "played") stop();
});
```

### `edit(caption)`

Edita el pie de un mensaje **propio** (`me === true`) de tipo `text`, `image` o `video`. Devuelve
`false` para cualquier otro caso.

```typescript title="edit.ts"
if (msg.me) {
  await msg.edit("Contenido actualizado");
}
```

### `forward(target)`

```typescript
forward(target: string | Chat | Contact): Promise<boolean>
```

Reenvía el mensaje a otro chat. Un `string` es cualquier identificador (teléfono, JID, LID, id de
grupo); un `Chat` usa su identificador crudo; un `Contact` usa su JID (o su LID).

```typescript title="forward.ts"
await msg.forward("5215555555555");

const chat = await wa.Chat.get("120363000000000000@g.us");
await msg.forward(chat!);

const person = await wa.Contact.get("5215555555555");
await msg.forward(person!);
```

### `delete(all?)`

```typescript
delete(all = false): Promise<boolean>
```

!!! warning "Por defecto elimina solo para ti"
    `delete()` elimina el mensaje **solo en este dispositivo** (`deleteForMe`) y borra su documento
    del motor. Pasa `true` para revocarlo para todos: entonces el documento se conserva, marcado
    con `revoked` / `revoked_at`, para que la interfaz muestre *se eliminó este mensaje* donde estaba.

```typescript title="delete.ts"
await msg.delete();     // solo para mí (por defecto)
await msg.delete(true); // para todos
```

---

## Respuestas

Cada helper de envío está reflejado en la instancia como respuesta: el mensaje actual se cita
automáticamente.

| Método | Firma |
| ------ | ----- |
| `msg.text(caption, extra?)` | `(string, { once?, mentions? }) => Promise<Message \| null>` |
| `msg.image(buf, extra?)` | `(Buffer, { once?, caption?, mentions? }) => Promise<Message \| null>` |
| `msg.video(buf, extra?)` | `(Buffer, { once?, caption?, gif?, mentions? }) => Promise<Message \| null>` |
| `msg.audio(buf, extra?)` | `(Buffer, { once?, ptt? }) => Promise<Message \| null>` |
| `msg.sticker(buf, extra?)` | `(Buffer, { once? }) => Promise<Message \| null>` |
| `msg.location(loc, extra?)` | `({ lat, lng }, { once? }) => Promise<Message \| null>` |
| `msg.poll(input, extra?)` | `({ content, options }, { once?, multiple? }) => Promise<Message \| null>` |
| `msg.document(buf, extra)` | `(Buffer, { file_name, mimetype?, caption?, once? }) => Promise<Message \| null>` |
| `msg.vcard(contacts, extra?)` | `({ name, phone }[], { once? }) => Promise<Message \| null>` |
| `msg.event(data, extra?)` | `({ name, caption?, start, end?, place? }, { once? }) => Promise<Message \| null>` |

```typescript title="reply.ts"
wa.on("message:created", async (msg) => {
  if (!msg.me && msg.caption.toLowerCase() === "ping") {
    await msg.text("pong");
  }
});
```

---

## Estáticos (`wa.Message.*`)

Los estáticos viven en la **clase ligada** `wa.Message`, con la sesión ya aplicada; la clase base
`Message` exportada lleva la API de instancia y las subclases, sin estáticos.

```typescript
await wa.Message.text(cid, "hola");
const found = await wa.Message.get(cid, mid);
```

### Lectura

| Estático | Firma |
| -------- | ----- |
| `wa.Message.get` | `(cid, mid) => Promise<Message \| null>` |
| `wa.Message.list` | `(cid, offset?, limit?) => Promise<Message[]>` (por defecto `0, 50`) |
| `wa.Message.reactions` | `(cid, mid) => Promise<{ emoji, count }[]>` |

### Acción

| Estático | Firma |
| -------- | ----- |
| `wa.Message.react` | `(cid, mid, emoji) => Promise<boolean>` |
| `wa.Message.star` | `(cid, mid, value) => Promise<boolean>` |
| `wa.Message.seen` | `(cid, mid) => Promise<boolean>` |
| `wa.Message.edit` | `(cid, mid, caption) => Promise<boolean>` |
| `wa.Message.forward` | `(cid, mid, target) => Promise<boolean>` |
| `wa.Message.delete` | `(cid, mid, all?) => Promise<boolean>` (por defecto `false`) |
| `wa.Message.pin` | `(cid, mid, value, days?) => Promise<boolean>` (por defecto `7`) |

### Envío

```typescript title="send.ts"
await wa.Message.text(cid, "hola", { once: true });
await wa.Message.text(cid, "@5491112345678 mira esto", { mentions: ["5491112345678"] });
await wa.Message.image(cid, buffer, { caption: "mira" });
await wa.Message.video(cid, buffer, { caption: "demo" });
await wa.Message.video(cid, buffer, { gif: true });         // en bucle y sin sonido
await wa.Message.sticker(cid, webp);                        // WebP, estático o animado
await wa.Message.audio(cid, buffer, { ptt: true });          // ptt es true por defecto
await wa.Message.location(cid, { lat: 8.3, lng: -62.7 });
await wa.Message.poll(cid, {
  content: "¿Qué pedimos?",
  options: [{ content: "Pizza" }, { content: "Sushi" }],
}, { multiple: true });
await wa.Message.document(cid, buffer, { file_name: "contrato.pdf", mimetype: "application/pdf" });
await wa.Message.vcard(cid, [{ name: "Ana", phone: "+584121234567" }]);
await wa.Message.event(cid, { name: "Demo", start: new Date(), place: { lat: 8.3, lng: -62.7 } });
```

Cada helper de envío devuelve el `Message` creado (ya de la subclase correcta) o `null` cuando no
hay sesión o WhatsApp rechazó el contenido.

### Opciones de envío

```typescript title="options.ts"
interface SendExtra {
  mid?: string;                                  // id del mensaje citado — los helpers de respuesta lo completan por ti
  once?: boolean;                                // una sola lectura (view-once)
  mentions?: (string | number | Contact)[];      // a quiénes refiere el `@` del cuerpo
}

// image:         SendExtra & { caption?: string }
// video:         SendExtra & { caption?: string; gif?: boolean }
// audio:         SendExtra & { ptt?: boolean }            (por defecto: true)
// poll:          SendExtra & { multiple?: boolean }       (por defecto: false)
// document:      SendExtra & { file_name: string; mimetype?: string; caption?: string }
```

!!! info "`file_name` es obligatorio en documentos"
    `wa.Message.document(cid, buf, { file_name })` es el único helper de envío con una opción
    obligatoria; `mimetype` cae por defecto en `application/octet-stream`.

!!! info "Menciones: escribe el teléfono, la librería lo traduce"
    Escribe `@<teléfono>` en el texto y pasa a las mismas personas en `mentions` (teléfono, JID, LID
    o `Contact`). En un grupo que identifica a sus miembros por LID la mención debe viajar como LID
    y el `@` debe decir ese número, o WhatsApp lo pinta como texto plano: la librería resuelve cada
    uno y reescribe el `@` por ti, así el `mentioned` del receptor es `true` y `mentions()` resuelve
    los contactos.

---

## Encuestas

`Poll.options` expone cada opción con su conteo de votos en vivo, `votes()` desglosa el resultado
por votante y `select()` emite un voto desde la cuenta autenticada.

```typescript title="poll.ts" hl_lines="12 19"
const sent = await wa.Message.poll(cid, {
  content: "¿Qué almorzamos?",
  options: [{ content: "Pizza" }, { content: "Tacos" }, { content: "Ramen" }],
});

wa.on("message:updated", async (msg) => {
  if (msg instanceof Poll) {
    for (const option of msg.options) {
      console.log(option.name, "->", option.count);  // { name, count }
    }
    for (const vote of await msg.votes()) {
      console.log(vote.contact, "votó", vote.name);  // { name, contact }
    }
  }
});

if (sent instanceof Poll) {
  await sent.select(0);      // opción única
  await sent.select([0, 2]); // solo tiene sentido cuando `multiple === true`
}
```

!!! info "Los votos entrantes se descifran por ti"
    Los votos viajan cifrados. El cliente descifra cada `pollUpdateMessage`, lo fusiona con la
    encuesta almacenada y emite `message:updated`, así que `options` y `votes()` están siempre al
    día.

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

wa.on("message:updated", (msg) => {
  if (msg instanceof Location && msg.live) {
    console.log("actualización en vivo ->", msg.lat, msg.lng, msg.link);
  }
});
```

!!! warning "El envío siempre es un pin estático"
    La API de envío recibe solo `{ lat, lng }`. Emitir una ubicación *en vivo* no está soportado;
    recibir sus actualizaciones sí, vía `message:updated`.

---

## Audio

`ptt` distingue las notas de voz de los archivos de audio, y `waveform` devuelve los puntos de
amplitud 0-100 del protocolo, listos para pintar.

```typescript title="audio.ts"
import { readFileSync } from "node:fs";

await wa.Message.audio(cid, readFileSync("./note.ogg"));                  // nota de voz (por defecto)
await wa.Message.audio(cid, readFileSync("./song.mp3"), { ptt: false });  // archivo de audio

wa.on("message:created", (msg) => {
  if (msg instanceof Audio) {
    console.log(msg.ptt ? "nota de voz" : "archivo de audio", msg.duration, "s");
    console.log(msg.waveform); // number[]
  }
});
```

---

## Previews de texto

```typescript title="preview.ts"
if (msg instanceof Text) {
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
if (msg instanceof Event) {
  console.log(msg.name);     // título del evento
  console.log(msg.caption);  // descripción
  console.log(msg.start);    // ISO UTC
  console.log(msg.end);      // ISO UTC | null
  console.log(msg.canceled); // boolean
  console.log(msg.link);     // link de unión ('' si no hay)
  console.log(msg.place);    // { lat, lng } | null
}
```

`going` cuenta a los asistentes confirmados, acompañantes incluidos, y `attendees()` lista cada
respuesta con el nombre del contacto, en orden de llegada: `{ name, contact, response: 'going' |
'not_going' | 'maybe', guests }`. Las respuestas llegan cifradas, se descifran con el secreto del
evento y emiten `message:updated` sobre el `Event`.

```typescript title="attendees.ts"
wa.on("message:updated", async (msg) => {
  if (msg instanceof Event) {
    console.log(msg.going, "asisten");
    for (const entry of await msg.attendees()) console.log(entry.name, entry.response, entry.guests);
  }
});
```

!!! tip "Payloads de eventos"
    Los listeners de `message:*` reciben `(msg, chat, wa)` y `msg` ya es instancia de la subclase
    correcta, así que `instanceof` funciona sin discriminación manual.

---

## Productos

Un `Product` es la tarjeta que una cuenta Business comparte desde su catálogo: lo que WhatsApp
muestra en la burbuja, más de quién es. `content()` devuelve la tarjeta como JSON e `item()` trae la
ficha completa desde el [`Catalog`](catalog.es.md) del dueño, o `null` cuando ya no está publicada.

```typescript title="product.ts"
if (msg instanceof Product) {
  console.log(msg.name, msg.price, msg.currency);   // 'Camisa', 15.5, 'USD'
  console.log(msg.description, msg.caption);        // descripción; caption es el texto del cuerpo, o la descripción
  console.log(msg.product_id, msg.retailer_id, msg.url, msg.owner);
  const thumb = await msg.thumb();                  // JPEG embebido, o null
  const item = await msg.item();                    // { id, owner, name, price, images, … } | null
}
```

!!! note "Solo recepción"
    Enviar tarjetas de producto y editar el catálogo no forman parte de la API: WhatsApp no
    respondió esas peticiones desde un dispositivo vinculado durante la verificación, así que no se
    publican.
