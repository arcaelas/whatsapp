# Esquemas de datos

Referencia para cada documento que `@arcaelas/whatsapp` escribe a través de un `Engine`.

Cada documento conserva el raw tal como WhatsApp lo entrega a través de baileys, con los nombres de
campo de baileys: la librería no traduce nada al escribir, y lo único propio que agrega es el
envoltorio de los timelines y los documentos de metadatos. Los nombres en snake_case pertenecen a los
getters de las entidades, que los derivan del raw al leer, así que un campo que baileys agrega se
guarda sin esperar a que la librería lo mapee.

Los documentos pasan por `serialize()`, por lo que el motor solo ve y persiste **strings**. Los
contenidos binarios son la única excepción: cuando el driver implementa `set_buffer` se escriben
crudos, y si no caen en un documento JSON con base64. Los drivers son tuberías opacas; no están al
tanto de JSON, de WhatsApp, ni de buffers.

!!! warning "Documentos escritos por 8.x"
    9.0.0 no lee los documentos escritos por 8.x — documentos de contacto y de chat en snake_case,
    mensajes con un campo `raw` — y no hay migración: los listados los omiten, igual que un documento
    corrupto, en vez de fallar. La sesión sí se conserva: `/session` no cambió de forma y las llaves
    de app-state que 8.x guardó como texto base64 se recuperan al leerlas.

---

## Vista general del layout de almacenamiento

El orquestador escribe en un conjunto pequeño y fijo de ramas:

| Rama         | Propósito                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------- |
| `/session/`  | Credenciales de autenticación y material del protocolo Signal.                               |
| `/contact/`  | El `Contact` de baileys de cada contacto, bajo su JID canónico.                              |
| `/chat/`     | El `Chat` de baileys de cada conversación, el timeline de cada mensaje y su binario de media. |
| `/status/`   | El timeline de cada estado (`Feed`) y su binario de media.                                   |
| `/lid/`      | Índice bidireccional de búsqueda LID ↔ JID.                                                  |
| `/catalog/`  | El timeline de cada colección del catálogo (`Catalog`), por negocio.                         |
| `/blocklist` | Un único documento con los JIDs que la cuenta tiene bloqueados.                              |
| `/pinned`    | Un único documento con los JIDs de los chats fijados.                                        |
| `/unmapped`  | Un único documento con los LIDs de las fichas y chats guardados todavía sin teléfono.        |

Cualquier ruta de una entidad puede tener además un hijo `metadata` con los valores propios de la
integración; ver [Metadatos](#metadatos-pathmetadata).

Las rutas usan `/` como separador y **nunca empiezan ni terminan con barra** una vez normalizadas —
todos los drivers colapsan `//` y recortan los extremos.

---

## Índice de rutas

| Ruta                                      | Propósito                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `/session/creds`                          | `AuthenticationCreds` de baileys (identidad, prekey firmada, registro…).      |
| `/session/<category>/<id>`                | Material de Signal escrito por el key store de baileys (`pre-key`, `session`, `sender-key`, `app-state-sync-key`, …). |
| `/contact/<jid>`                          | El `Contact` de baileys.                                                      |
| `/contact/<jid>/metadata`                 | Metadatos del contacto.                                                       |
| `/contact/<jid>/photo`                    | `{ url }` de la última foto de perfil descargada; su binario en `photo/content`. |
| `/contact/<jid>/bio`                      | `{ status, at }` de la última biografía leída: `content()` no vuelve a preguntar en 24 h. |
| `/chat/<cid>`                             | El `Chat` de baileys.                                                         |
| `/chat/<cid>/metadata`                    | Metadatos del chat.                                                           |
| `/chat/<cid>/photo`                       | `{ url }` de la última foto del grupo descargada; su binario en `photo/content`. |
| `/chat/<cid>/message/<mid>`               | Timeline del mensaje: el `WAMessage` y cada evento posterior.                 |
| `/chat/<cid>/message/<mid>/content`       | Binario del media (crudo, o `{ data: "<base64>" }`).                          |
| `/chat/<cid>/message/<mid>/metadata`      | Metadatos del mensaje.                                                        |
| `/status/<id>`                            | Timeline del estado.                                                          |
| `/status/<id>/content`                    | Binario del media del estado (crudo, o `{ data: "<base64>" }`).               |
| `/status/<id>/metadata`                   | Metadatos del estado.                                                         |
| `/status/<id>/audience`                   | Arreglo de JIDs a los que `Feed.create()` publicó el estado; el retiro va a ellos. |
| `/lid/<lid>`                              | Mapa directo: LID → JID (string serializado).                                 |
| `/lid/<pn>`                               | Mapa inverso: JID → LID (string serializado).                                 |
| `/lid/<digits>_reverse`                   | Fallback legado que lee el resolver de JIDs; solo lo escribían versiones antiguas. |
| `/catalog/<jid>/collection/<id>`          | Timeline de las descargas de una colección del catálogo.                      |
| `/catalog/<jid>/collection/<id>/metadata` | Metadatos del catálogo; la librería guarda aquí `updated_at`.                 |
| `/catalog/<jid>/product/<pid>/metadata`   | Metadatos de un producto del catálogo.                                        |
| `/blocklist`                              | Arreglo de JIDs bloqueados.                                                   |
| `/pinned`                                 | Arreglo de JIDs de los chats fijados: `pinned(true)` los cuenta con una lectura. |
| `/unmapped`                               | Arreglo de LIDs guardados sin teléfono: la conexión revisa sólo estos.         |

!!! note "Claves de sesión"
    El conjunto exacto de rutas `/session/<category>/<id>` depende de lo que baileys persista. La
    librería trata cada categoría de forma uniforme: serializa el valor con `serialize()` y lo escribe
    bajo `/session/<category>/<id>`, un valor `null` lo borra, y las escrituras sobre una misma ruta
    se encolan en orden. Los valores de `app-state-sync-key` se reconstruyen con
    `proto.Message.AppStateSyncKeyData.fromObject` al leerlos, lo que además decodifica las claves que
    versiones anteriores guardaron como texto base64.

---

## Ordenamiento: el `score`

`engine.set(path, value, score?)` recibe un score opcional, que es por lo que `list` ordena (DESC).

| Documento                         | Score                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `/chat/<cid>`                     | `conversationTimestamp` × 1000: la última actividad, en epoch ms (la hora de escritura mientras no lo tenga). |
| `/chat/<cid>/message/<mid>`       | `messageTimestamp` × 1000 (epoch ms).                                                  |
| `/status/<id>`                    | `messageTimestamp` × 1000 (epoch ms).                                                  |
| `/catalog/<jid>/collection/<id>`  | Su posición en la descarga: la primera colección devuelta recibe el score más alto.    |
| Todo lo demás                     | Ninguno — el driver cae en la hora de escritura.                                       |

Cada evento que se suma a un timeline reescribe el documento con su score original, así que un
recibo o una reacción sobre un mensaje viejo lo dejan en su sitio.

---

## Formas de los documentos

Todos los documentos son JSON escrito por `serialize()`. Los valores del proto conservan sus valores
reales — enums y longs como números, bytes como Buffers — en lugar del mapeo JSON del proto, así un
raw releído se sigue comparando con los enums de baileys. Los buffers se codifican con el
`BufferJSON` de baileys:

```json
{ "type": "Buffer", "data": "<base64 string>" }
```

`deserialize<T>(raw)` reconstruye las instancias originales de `Buffer` al leer, y devuelve `null`
ante un documento corrupto o truncado en lugar de lanzar.

---

### Timelines

Los mensajes, los estados y las colecciones del catálogo se guardan como un **timeline**: un arreglo
con los raws exactamente como los emitió baileys, en orden de llegada y sin sobre. El primer raw es
la entidad tal como llegó; cada raw posterior es un evento que baileys emitió para ella —un
`messages.update`, un mensaje que la refiere—. Nada de lo registrado se reescribe: un raw nuevo se
suma al final, y un raw idéntico al último es su eco y se ignora. Los getters buscan en el timeline,
de atrás hacia adelante, el último raw que define su valor, así que una edición deja vigente el texto
nuevo y el anterior queda en el timeline.

La única excepción es la entrega. Los recibos (`message-receipt.update`) y los `messages.update` que
sólo traen `status` no se suman: reemplazan un único registro de entrega `{ key, update: { status } }`
al final del timeline, con el estado más alto alcanzado —un error manda, con su
`messageStubParameters`, hasta que llega un avance—. Así un mensaje propio en un grupo de 200 no
suma 600 raws de acuses.

```ts
import type { LIDMapping, MessageUserReceiptUpdate, WAMessage, WAMessageUpdate } from 'baileys';

// el timeline de un mensaje o un estado es un Raw[] en orden de llegada
type Raw = WAMessage | WAMessageUpdate | MessageUserReceiptUpdate | LIDMapping;
```

---

### Contacto — `/contact/<jid>`

El `Contact` de baileys, guardado bajo su JID canónico: el JID de teléfono cuando se conoce, el LID
si no.

```ts
interface Contact {           // Contact de baileys
    id: string;               // LID o JID de teléfono, tal como lo entregó baileys
    lid?: string;             // LID cuando se conoce
    phoneNumber?: string;     // JID de teléfono cuando se conoce
    name?: string;            // nombre de agenda
    notify?: string;          // nombre público que puso el contacto
    username?: string;        // nombre de usuario, cuando WhatsApp lo envía
    verifiedName?: string;    // nombre verificado de negocio
    imgUrl?: string | null;   // URL de la foto de perfil ("changed" al rotarla)
    status?: string;          // bio / info
}
```

Ejemplo de payload:

```json
{
    "id": "5491112345678@s.whatsapp.net",
    "lid": "140913951141911@lid",
    "phoneNumber": "5491112345678@s.whatsapp.net",
    "name": "Juan Perez",
    "notify": "Juanito",
    "imgUrl": "https://pps.whatsapp.net/v/t61.24694-24/...",
    "status": "Hey there! I am using WhatsApp."
}
```

Las actualizaciones parciales — `contacts.update`, o el nombre público de un mensaje entrante cuando
el contacto aún no tiene nombre — se fusionan campo por campo sobre el documento guardado, y un campo
que llega como `undefined` nunca sobrescribe: una actualización que trae solo la foto conserva el
nombre. Los getters de [`Contact`](references/contact.es.md) derivan `id`, `name` y `phone` de este
documento; `content()` guarda en `/contact/<id>/bio` la biografía que lee con la hora de la consulta
—y en `status` cuando cambia—, y `photo()` guarda la foto bajo `/contact/<id>/photo`.

Cuando WhatsApp revela el teléfono detrás de un LID — con `lid-mapping.update`, o con la revisión de
`/unmapped` que corre en cada conexión — el contacto, el chat y los mensajes guardados bajo el LID
pasan al JID de teléfono con sus binarios y sus metadatos, y las copias del LID se borran. Los campos
que el contacto y el chat ya tenían bajo el teléfono mandan, y cada mensaje movido recibe una entrada
`{ lid, pn }`.

---

### Chat — `/chat/<cid>`

El `Chat` de baileys (`proto.IConversation`), guardado sin su arreglo `messages` bajo el id canónico
— el JID de teléfono cuando se conoce, si no el LID o el `@g.us` — y fusionado campo por campo en
cada `chats.upsert`, `chats.update`, `groups.upsert`, `groups.update` y mensaje nuevo. Estos son los
campos que lee la librería; cualquier otro campo que envíe baileys se conserva tal como llegó:

```ts
interface Chat {                             // Chat de baileys
    id: string;                              // JID de teléfono, LID o @g.us
    name?: string | null;                    // asunto del grupo, o nombre del contacto
    description?: string | null;             // descripción del grupo
    archived?: boolean | null;
    pinned?: number | null;                  // timestamp del pin; null/ausente = sin fijar
    muteEndTime?: number | null;             // epoch ms; <= Date.now() significa sin silenciar
    unreadCount?: number | null;
    conversationTimestamp?: number | null;   // epoch en segundos de la última actividad: ordena la lista
    pnJid?: string | null;                   // JID de teléfono del chat, cuando se conoce
}
```

Ejemplo de payload:

```json
{
    "id": "120363123456789@g.us",
    "name": "Dev Team",
    "description": "Standup at 9:00",
    "archived": false,
    "pinned": 1767371367857,
    "unreadCount": 5,
    "conversationTimestamp": 1767371360
}
```

`conversationTimestamp` × 1000 es el score con el que se escribe el documento, así que `Chat.list`
devuelve los chats por actividad real. Cada escritura conserva el mayor valor entre lo que llega y lo
guardado, y un mensaje nuevo lo sube a su propio timestamp, así que fijar, archivar, silenciar o
marcar leído nunca mueven un chat de sitio.

Los setters de [`Chat`](references/chat.es.md) — `archived()`, `pinned()`, `muted()`, `name()`,
`content()`, `ephemeral()` y `seen()` — escriben este documento en cuanto WhatsApp acepta el cambio y
emiten el evento `chat:*` que corresponde; el eco que llega después ya no encuentra diferencia y no
lo repite. Un `unreadCount` positivo en `chats.update` es un incremento, como lo
define baileys, y se suma al guardado; `0` lo reinicia y `-1` es un chat marcado como no leído.

---

### Mensaje — `/chat/<cid>/message/<mid>`

Un timeline. El primer raw es el `WAMessage` tal como llegó o como lo envió la librería; cada raw
posterior es exactamente lo que baileys emitió para él:

```ts
[
    WAMessage,          // el mensaje (messages.upsert)
    WAMessage,          // un mensaje que lo refiere: reactionMessage, pinInChatMessage, protocolMessage
                        // (edición, retiro), pollUpdateMessage o encEventResponseMessage, cifrado
    { key, update },    // ese voto o esa respuesta descifrados al llegar, con la forma del messages.update de baileys
    { key, update },    // messages.update: destacado, edición, retiro, pollUpdates o eventResponses de baileys
    { lid, pn },        // lid-mapping.update: el chat se tradujo de su LID al teléfono
    { key, update },    // el registro de entrega: { status }, el más alto de los acuses y estados
]
```

Un mensaje que lo refiere no se suma dos veces cuando su id ya está en el timeline. Los envíos y las
acciones de la propia librería llegan por el mismo camino: baileys les hace eco, y lo que la librería
retransmite por su cuenta (una edición de media, un voto, una vista única, un reenvío) se publica en
`messages.upsert` como cualquier otro mensaje.

Ejemplo de payload, un texto enviado que fue leído; el segundo raw es el registro de entrega que
dejaron los acuses:

```json
[
    {
        "key": { "remoteJid": "5491112345678@s.whatsapp.net", "fromMe": true, "id": "3EB0C767D26A1D0F8A7B" },
        "message": { "conversation": "Hi!" },
        "messageTimestamp": 1767371360,
        "status": 1
    },
    {
        "key": { "remoteJid": "5491112345678@s.whatsapp.net", "fromMe": true, "id": "3EB0C767D26A1D0F8A7B" },
        "update": { "status": 4 }
    }
]
```

Los getters de [`Message`](references/message.es.md) buscan en el timeline de atrás hacia adelante: la
última edición da `caption`, el último pin da `pinned` y el último raw con `starred` da `starred`. Un
retiro marca `revoked_at` y conserva el texto. Un voto o una respuesta de evento se guarda cifrado, como
lo emite baileys, y además descifrado al llegar —probando cada identidad por LID y por teléfono del
votante y del creador—, así la lectura no descifra; sólo el que no se pudo descifrar entonces se
reintenta al leer, y gana el último voto de cada votante por su hora de envío. `msg.status` toma el
estado del registro de entrega: en el ejemplo de arriba es `'read'`.

El `status` del `WAMessage` y del registro de entrega es el valor numérico del proto; un recibo
cuenta como `3`, o como `4` con `readTimestamp` y `5` con `playedTimestamp`. El string legible que
expone [`Message.status`](references/message.es.md):

| Valor | `msg.status`  | Significado                    |
| ----- | ------------- | ------------------------------ |
| `0`   | `'error'`     | Error de envío                 |
| `1`   | `'pending'`   | Pendiente                      |
| `2`   | `'sent'`      | Confirmado por el servidor     |
| `3`   | `'delivered'` | Entregado al destinatario      |
| `4`   | `'read'`      | Leído por el destinatario      |
| `5`   | `'played'`    | Reproducido (audio/video)      |

El rechazo y la firma del negocio también se leen de los raws. Cuando el servidor rechaza un envío,
el stub del ack llega en `messageStubParameters` del mensaje o de una actualización, y
[`Message.reason`](references/message.es.md) lo traduce (`463` → `restricted`, `479` →
`invalid-session`); el nombre del negocio verificado llega en `verifiedBizName` del `WAMessage` y lo
expone `Message.business`.

---

### Contenido del mensaje — `/chat/<cid>/message/<mid>/content`

Aquí solo vive el binario de los mensajes de media: imagen, video, audio, sticker y documento. Se
escribe crudo cuando el driver implementa `set_buffer`; si no, como un pequeño envoltorio JSON:

```ts
interface ContentEnvelope {
    data: string;   // contenido codificado en base64
}
```

Los demás tipos no guardan nada aquí: `content()` deriva su contenido del timeline.

| `type`                                               | Se guarda aquí               | `Message.content()` devuelve                                            |
| ---------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `text`                                               | Nada                         | Texto UTF-8 de la última edición.                                       |
| `location`                                           | Nada                         | JSON UTF-8 `{ "lat": number, "lng": number }`.                          |
| `poll`                                               | Nada                         | JSON UTF-8 `{ "content": string, "options": [{ "content": string }] }`. |
| `vcard`                                              | Nada                         | Las vCards crudas, unidas por saltos de línea.                          |
| `event`                                              | Nada                         | JSON UTF-8 del `eventMessage` de baileys.                               |
| `product`                                            | Nada                         | Descripción del producto en UTF-8.                                      |
| `image` / `video` / `audio` / `sticker` / `document` | Los bytes descifrados        | Los bytes guardados, o una descarga nueva.                              |

!!! info "El binario se escribe una sola vez"
    El binario se escribe en la primera entrega del mensaje, o cuando la librería lo envía, y solo
    cuando hay bytes que guardar. `Message.content()` lo devuelve; cuando falta, lo descarga —pidiéndole
    a WhatsApp que lo reenvíe si caducó—, lo guarda y lo devuelve, y lanza si no se puede descargar.
    `Message.stream()` entrega el guardado o la descarga mientras llega, sin acumularla ni guardarla.

---

### Estado — `/status/<id>`

Un timeline como el del mensaje. Solo se guardan los estados de texto, imagen, video y audio, en su
primera entrega o cuando la cuenta los publica; un retiro borra el documento con su binario.

```ts
[
    WAMessage,          // el mensaje de status@broadcast
    { lid, pn },        // el autor se tradujo de su LID al teléfono
    WAMessage,          // un reactionMessage al estado
    { key, update },    // el registro de entrega: los acuses de quien lo vio; seen(true) lo deja en leído
]
```

Un estado publicado con `Feed.create()` guarda en `/status/<id>/audience` los JIDs a los que se
publicó, y `delete()` retira el estado a esos mismos; sin ese documento —un estado publicado desde el
teléfono— el retiro va a la agenda.

`created_at`, `expires_at` (24 horas después, `FEED_TTL_MS`) y `seen()` los deriva
[`Feed`](references/feed.es.md) y no se guardan. La librería no borra un estado cuando vence. Su
binario vive en `/status/<id>/content` con las mismas reglas de envoltorio que un mensaje.

---

### Catálogo — `/catalog/<jid>/collection/<id>`

Cada colección del catálogo de un negocio es el timeline de sus descargas distintas, bajo el JID de
teléfono del negocio: cada elemento es la colección exactamente como la devuelve `getCollections` de
baileys. Un negocio sin colecciones tiene una sola con todos los productos de `getCatalog`, el
teléfono del negocio como `id`, `''` como `name` y sin `status`. La colección no nombra a su dueño ni
la hora de la descarga: el dueño sale de la ruta, y la librería escribe la hora de la última descarga
en la metadata de la colección como `updated_at`.

```ts
import type { Product } from 'baileys';

type Collection = {
    id: string;                                        // id de la colección; el teléfono en el catálogo sin colecciones
    name: string;                                      // '' en el catálogo sin colecciones
    products: Product[];                               // productos de baileys, en el orden del catálogo
    status?: { status: string; canAppeal: boolean };   // ausente en el catálogo sin colecciones
};

// el documento es un Collection[]: cada descarga distinta, la última es la vigente
// /catalog/<jid>/collection/<id>/metadata guarda { updated_at: <epoch ms de la última descarga>, ... }
```

Cada producto es el nodo de baileys:

```ts
interface Product {                                        // Product de baileys
    id: string;
    name: string;
    description: string;
    price: number;                                         // milésimas de la unidad de la moneda
    currency: string;                                      // ISO 4217
    retailerId?: string;
    url?: string;
    isHidden?: boolean;
    imageUrls: { requested: string; original: string };    // portada en 100×100 y portada original
    reviewStatus: { whatsapp: string };                    // veredicto de la revisión de Meta
    availability: 'in stock';                              // baileys lo escribe literal
}
```

Ejemplo de payload:

```json
[
    {
        "id": "5491112345678",
        "name": "",
        "products": [
            {
                "id": "8034215663256571",
                "imageUrls": {
                    "requested": "https://mmg.whatsapp.net/v/t45.5328-4/...",
                    "original": "https://mmg.whatsapp.net/v/t45.5328-4/..."
                },
                "reviewStatus": { "whatsapp": "APPROVED" },
                "availability": "in stock",
                "name": "Linen shirt",
                "retailerId": "SHIRT-001",
                "url": "https://shop.example.com/linen-shirt",
                "description": "100% linen, size M",
                "price": 15500,
                "currency": "USD",
                "isHidden": false
            }
        ]
    }
]
```

El timeline guarda solo las descargas que cambiaron algo: una descarga idéntica al último elemento
solo refresca `updated_at`, y una distinta suma un elemento y emite `catalog:updated`. Una colección
que una respuesta posterior de colecciones ya no devuelve se borra; una descarga que WhatsApp no
responde no borra nada. [`Catalog`](references/catalog.es.md) lee el último elemento y se construye
con su dueño, `new wa.Catalog(timeline, jid)`; cada `wa.Product` se construye con uno de sus
productos, `new wa.Product([product], jid)`.

---

### Índices — `/pinned` y `/unmapped`

Dos arreglos JSON que evitan recorrer los chats, como hace WhatsApp Web con los índices que lleva en
memoria. `/pinned` tiene los JIDs de los chats fijados y lo mantienen los ecos de WhatsApp y
`pinned()`. `/unmapped` tiene los LIDs de las fichas y chats guardados sin teléfono: cada escritura de
uno así lo agrega, y cada conexión revisa sólo esos LIDs, une al teléfono los que ya tienen mapeo y
deja el resto. La primera conexión que no los encuentra recorre `/contact` y `/chat` una vez y los
arma.

---

### Lista de bloqueados — `/blocklist`

Un arreglo JSON con los JIDs normalizados que la cuenta tiene bloqueados:

```json
["5491187654321@s.whatsapp.net"]
```

Se reescribe en cada conexión con la lista de WhatsApp, cuando WhatsApp responde, y se mantiene al
día con el evento `blocklist.update`. [`chat.blocked()`](references/chat.es.md) lo lee sin
salir a la red, y le pregunta a WhatsApp solo mientras el documento no existe.

---

### Metadatos — `<path>/metadata`

Toda entidad tiene `metadata(patch?)`: valores de la integración que viven en el motor, en un hijo
`metadata` de la ruta de la entidad. Sin argumento los lee; con un objeto fusiona sus claves de
primer nivel sobre las guardadas, borra las que valen `null` o `undefined`, y devuelve el resultado;
cuando no queda nada, el documento se borra. WhatsApp nunca ve estos valores, y no sobreviven a un
cambio de motor ni a vaciar el motor.

| Entidad                                               | Ruta                                        |
| ----------------------------------------------------- | ------------------------------------------- |
| `Contact`                                             | `/contact/<jid>/metadata`                   |
| `Chat`                                                | `/chat/<cid>/metadata`                      |
| `Message` y sus subclases, tarjetas de producto incluidas | `/chat/<cid>/message/<mid>/metadata`    |
| `Feed`                                                | `/status/<id>/metadata`                     |
| `Catalog`                                             | `/catalog/<jid>/collection/<id>/metadata`   |
| `Product` de un catálogo                              | `/catalog/<jid>/product/<pid>/metadata`     |

```ts
const chat = await wa.Chat.get('5491112345678');

await chat?.metadata({ crm_id: 'A-1029', stage: 'lead' }); // fusiona
await chat?.metadata({ stage: null });                     // borra stage
const values = await chat?.metadata();                     // { crm_id: 'A-1029' }
```

Los metadatos van a donde va su entidad: borrar un chat o un mensaje los borra en cascada, y un LID
absorbido por su teléfono se los lleva consigo. Los del catálogo son el único lugar donde la librería
escribe una clave propia, `updated_at`, la hora de la última descarga: el raw de la colección no trae
hora. Borrarla hace que la siguiente lectura de `contact.catalog()` vuelva a descargar.

---

### Credenciales de sesión — `/session/creds`

El valor es el objeto **opaco** `AuthenticationCreds` de baileys serializado con `serialize()`. La
librería no inspecciona ni documenta sus campos internos; trátalo como una caja negra propiedad de
baileys.

Para rotar la sesión manualmente, haz `unset('/session/creds')` y deja que `connect()` la regenere en
el siguiente intento — el orquestador relee las credenciales al inicio de cada reintento.

---

### Índice LID — `/lid/<lid>`, `/lid/<pn>`

| Ruta                    | Valor                                                                         |
| ----------------------- | ----------------------------------------------------------------------------- |
| `/lid/<lid>`            | **String** codificado en JSON: el JID/PN canónico de ese LID.                 |
| `/lid/<pn>`             | **String** codificado en JSON: el LID de ese PN, escrito junto con el mapa directo. |
| `/lid/<digits>_reverse` | Fallback legado, todavía se lee cuando el mapa directo está vacío.            |

El resolver de JIDs usa este índice para normalizar cualquier identificador `@lid` a un JID canónico
`@s.whatsapp.net`, y cae en el mapeo de LID propio de baileys cuando el índice no tiene la entrada.

---

## Mapeo de rutas por motor

### `SQLiteEngine`

Una sola tabla, `documents` por defecto:

```sql
CREATE TABLE documents (
    path   TEXT PRIMARY KEY,
    parent TEXT NOT NULL,
    score  INTEGER NOT NULL,
    value  TEXT NOT NULL DEFAULT '',
    binary BLOB
);
CREATE INDEX documents_order ON documents (parent, score DESC);
```

| Operación     | SQL                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| `get`         | `SELECT value FROM documents WHERE path = ?`                              |
| `set`         | `INSERT … ON CONFLICT(path) DO UPDATE SET value, score`                   |
| `unset`       | `DELETE … WHERE path = ? OR (path >= ? AND path < ?)` (subárbol por rango) |
| `list`        | `SELECT value … WHERE parent = ? ORDER BY score DESC LIMIT ? OFFSET ?`    |
| `count`       | `SELECT COUNT(*) … WHERE parent = ?`                                      |
| `get/set_buffer` | La columna `binary` (BLOB) de la misma fila.                           |

### `RedisEngine`

```
<prefix>:doc:<path>          -> valor string (el documento serializado)
<prefix>:doc:<path>:bin      -> binario crudo (cuando el cliente soporta buffers)
<prefix>:idx:<parent_path>   -> sorted set; score = el score pasado a set, member = ruta completa del hijo
<prefix>:dir:<parent_path>   -> set; los subdirectorios de la ruta (niveles que no son documentos)
```

Una escritura en `/chat/120363@g.us/message/ABC` ejecuta:

```
SET   wa:default:doc:chat/120363@g.us/message/ABC  "<json>"
ZADD  wa:default:idx:chat/120363@g.us/message      <score>  "chat/120363@g.us/message/ABC"
SADD  wa:default:dir:chat/120363@g.us              "chat/120363@g.us/message"
SADD  wa:default:dir:chat                          "chat/120363@g.us"
SADD  wa:default:dir:                              "chat"
```

| Operación         | Primitivas de Redis                                                        |
| ----------------- | ---------------------------------------------------------------------------- |
| `get(path)`       | `GET <prefix>:doc:<path>`                                                  |
| `set(path,v,s)`   | `SET` + `ZADD` + un `SADD` por ancestro, en un solo pipeline cuando el cliente lo expone |
| `unset(path)`     | Recorre `ZREVRANGE idx:` + `SMEMBERS dir:` por el subárbol, un nivel por tanda, y luego `DEL` en lotes de 500 + `ZREM`/`SREM` del padre |
| `list(path)`      | `ZREVRANGE <prefix>:idx:<path>` + `MGET`                                   |
| `count(path)`     | `ZCARD <prefix>:idx:<path>` (O(1))                                         |
| `clear()`         | `SCAN`/`DEL` sobre `<prefix>:*`                                            |

Usa un prefijo distinto por cuenta cuando compartas una misma instancia de Redis:

```ts
import IORedis from 'ioredis';
import { RedisEngine } from '@arcaelas/whatsapp';

const redis = new IORedis(process.env.REDIS_URL!);

const engine_a = new RedisEngine(redis, 'wa:5491112345678');
const engine_b = new RedisEngine(redis, 'wa:584121234567');
```

### `FileSystemEngine`

Cada ruta lógica se mapea a un directorio que contiene el documento como `index.json`:

```
<base>/chat/
├── .order                             # orden de los chats
└── 120363123456789@g.us/
    ├── index.json                     # el documento del chat
    ├── metadata/
    │   └── index.json                 # los metadatos del chat
    └── message/
        ├── .order                     # orden de los mensajes
        ├── 3EB0C767D26A1D0F8A7B/
        │   ├── index.json             # el timeline del mensaje
        │   └── content/
        │       └── content.bin        # el binario del media
        └── 3EB0A1B2C3D4E5F60718/
            └── index.json
```

| Operación        | Comportamiento en el sistema de archivos                                                    |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `get(path)`      | Lee `<base>/<path>/index.json` del disco, de forma asíncrona; `null` si falta.              |
| `set(path,v)`    | `mkdir -p`, escritura atómica (tmp + rename) y el `score` aplicado con `utimes`.            |
| `unset(path)`    | `rm -rf <base>/<path>`. Idempotente.                                                        |
| `list(path)`     | Índice ordenado desde `.order` (o reconstruido con `readdir` + `stat`), y luego los documentos de la página en paralelo. |
| `count(path)`    | Tamaño del índice ordenado.                                                                 |
| `get/set_buffer` | `content.bin` junto al documento.                                                           |
| `clear()`        | `rm -rf <base>`.                                                                            |

### `S3Engine`

Cada ruta se convierte en un objeto bajo `<basedir>/`, con `@` reemplazado por `_at_`, más un objeto
`.order` por prefijo que guarda los scores que S3 no puede almacenar (`LastModified` es de solo
lectura). Los binarios se guardan como documentos en base64, porque el driver no implementa métodos
de binario crudo.

---

## `unset()` en cascada

`unset(path)` elimina el documento **y todo el subárbol debajo de él**. Es intencional y se usa en
todo el orquestador para limpiezas masivas baratas:

| Quién llama                                          | Ruta pasada a `unset()`              | Qué se elimina                                                        |
| ---------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| `chat.delete()`, o un chat borrado en otro dispositivo | `/chat/<cid>`                      | El documento del chat, sus metadatos, y cada mensaje con su binario y sus metadatos. |
| `chat.clear()`                                       | `/chat/<cid>/message`                | Todos los mensajes del chat; el documento del chat y sus metadatos sobreviven. |
| `msg.delete()` (solo para mí)                        | `/chat/<cid>/message/<mid>`          | El timeline del mensaje, su binario y sus metadatos.                  |
| Estado retirado                                      | `/status/<id>`                       | El timeline del estado, su binario y sus metadatos.                   |
| Colección que WhatsApp ya no devuelve                | `/catalog/<jid>/collection/<id>`     | El timeline de la colección y sus metadatos.                          |
| `metadata()` que queda vacío                         | `<path>/metadata`                    | Solo el documento de metadatos.                                       |
| LID absorbido por su teléfono                        | `/contact/<lid>`, `/chat/<lid>`      | Las copias del LID, una vez movidas al teléfono.                      |
| `disconnect()` sin `destroy`                         | `/session`                           | Credenciales y claves de Signal; el historial se conserva.            |
| Logout con `autoclean: false`                        | `/session/creds`                     | Solo las credenciales; el historial se conserva.                      |

!!! warning "No hay unset por hoja"
    `unset` siempre cae en cascada. Para eliminar solo una subhoja, apúntala directamente (p. ej.
    `unset('/chat/<cid>/message/<mid>/content')` para soltar solo el binario y conservar el timeline
    del mensaje).

---

## Helpers de serialización

Los motores nunca ven objetos tipados — solo strings. Los helpers `serialize` / `deserialize`
manejan la frontera JSON ↔ objeto: `serialize` escribe los valores del proto con sus valores reales
y los dos preservan las instancias de `Buffer` mediante `BufferJSON`:

```ts
import { serialize, deserialize } from '@arcaelas/whatsapp';

await wa.engine.set('/app/config', serialize({ greeting: 'hi' }));

const raw = await wa.engine.get('/app/config');
const doc = deserialize<{ greeting: string }>(raw);  // → { greeting: 'hi' } | null
```

Usa los mismos helpers desde cualquier código propio que toque el motor si quieres compatibilidad
bit a bit con lo que escribe el orquestador.
