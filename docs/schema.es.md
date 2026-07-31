# Esquemas de datos

Referencia para cada documento que `@arcaelas/whatsapp` escribe a través de un `Engine`.

Los documentos pasan por `serialize()` (que usa `BufferJSON` de baileys), por lo que el motor solo ve
y persiste **strings**. Los contenidos binarios son la única excepción: cuando el driver implementa
`set_buffer` se escriben crudos, y si no caen en un documento JSON con base64. Los drivers son
tuberías opacas; no están al tanto de JSON, de WhatsApp, ni de buffers.

---

## Vista general del layout de almacenamiento

El orquestador escribe en un conjunto pequeño y fijo de ramas:

| Rama         | Propósito                                                                         |
| ------------ | ----------------------------------------------------------------------------------- |
| `/session/`  | Credenciales de autenticación y material del protocolo Signal.                     |
| `/contact/`  | Metadatos de contactos (un documento por id de contacto).                          |
| `/chat/`     | Metadatos de chats + documentos de mensajes por chat (con sus subdocumentos de contenido). |
| `/status/`   | Estados (`Feed`) y su contenido.                                                   |
| `/lid/`      | Índice bidireccional de búsqueda LID ↔ JID.                                        |

Las rutas usan `/` como separador y **nunca empiezan ni terminan con barra** una vez normalizadas —
todos los drivers colapsan `//` y recortan los extremos.

---

## Índice de rutas

| Ruta                                    | Propósito                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `/session/creds`                        | `AuthenticationCreds` de baileys (identidad, prekey firmada, registro…).       |
| `/session/<category>/<id>`              | Material de Signal escrito por el key store de baileys (`pre-key`, `session`, `sender-key`, `app-state-sync-key`, …). |
| `/contact/<id>`                         | Documento del contacto.                                                        |
| `/chat/<cid>`                           | Documento del chat.                                                            |
| `/chat/<cid>/message/<mid>`             | Documento del mensaje, incluyendo el `WAMessage` crudo completo de baileys.    |
| `/chat/<cid>/message/<mid>/content`     | Contenido del mensaje (binario crudo, o `{ data: "<base64>" }`).               |
| `/status/<id>`                          | Documento del estado.                                                          |
| `/status/<id>/content`                  | Contenido del estado (binario crudo, o `{ data: "<base64>" }`).                |
| `/lid/<lid>`                            | Mapa directo: LID → JID (string serializado).                                  |
| `/lid/<pn>`                             | Mapa inverso: JID → LID (string serializado).                                  |
| `/lid/<digits>_reverse`                 | Fallback legado que lee el resolver de JIDs; solo lo escribían versiones antiguas. |

!!! note "Claves de sesión"
    El conjunto exacto de rutas `/session/<category>/<id>` depende de lo que baileys persista. La
    librería trata cada categoría de forma uniforme: serializa el valor con `BufferJSON` y lo escribe
    bajo `/session/<category>/<id>`.

---

## Ordenamiento: el `score`

`engine.set(path, value, score?)` recibe un score opcional, que es por lo que `list` ordena (DESC).

| Documento                          | Score                                                          |
| ---------------------------------- | ---------------------------------------------------------------- |
| `/chat/<cid>/message/<mid>`        | El `created_at` del mensaje (epoch ms).                         |
| `/status/<id>` (publicado por ti)  | La marca de tiempo de la publicación.                           |
| Todo lo demás                      | Ninguno — el driver cae en la hora de escritura.                |

Por eso resincronizar el historial no reordena tus chats: reescribir un mensaje viejo conserva su
posición original.

---

## Formas de los documentos

Todos los documentos se serializan a JSON con `BufferJSON`. Los buffers se codifican como:

```json
{ "type": "Buffer", "data": "<base64 string>" }
```

`deserialize<T>(raw)` reconstruye las instancias originales de `Buffer` / `Uint8Array` al leer, y
devuelve `null` ante un documento corrupto o truncado en lugar de lanzar.

---

### Contacto — `/contact/<id>`

```ts
interface ContactRaw {
    id: string;                   // identificador LID o PN, según el addressing
    lid?: string | null;          // LID cuando se conoce
    phone_number?: string | null; // JID PN cuando baileys lo conoce
    name?: string | null;         // nombre de agenda
    notify?: string | null;       // nombre público que puso el contacto
    verified_name?: string | null;// nombre verificado de negocio
    img_url?: string | null;      // URL de la foto de perfil ("changed" al rotarla)
    status?: string | null;       // bio / info
}
```

Ejemplo de payload:

```json
{
    "id": "5491112345678@s.whatsapp.net",
    "lid": "140913951141911@lid",
    "phone_number": "5491112345678@s.whatsapp.net",
    "name": "Juan Perez",
    "notify": "Juanito",
    "verified_name": null,
    "img_url": "https://pps.whatsapp.net/v/t61.24694-24/...",
    "status": "Disponible 24/7"
}
```

Los getters de [`Contact`](references/contact.es.md) derivan `name`, `phone`, `jid`, `lid` y `photo`
de este documento.

---

### Chat — `/chat/<cid>`

El documento del chat solo persiste los campos que el orquestador sigue:

```ts
interface ChatRaw {
    id: string;
    name?: string | null;
    archived?: boolean | null;
    pinned?: number | null;          // timestamp del pin; null/ausente = sin fijar
    mute_end_time?: number | null;   // epoch ms; <= Date.now() significa sin silenciar
    unread_count?: number | null;
}
```

Ejemplo de payload:

```json
{
    "id": "120363123456789@g.us",
    "name": "Dev Team",
    "archived": false,
    "pinned": 1767371367857,
    "mute_end_time": null,
    "unread_count": 5
}
```

---

### Mensaje — `/chat/<cid>/message/<mid>`

```ts
import type { WAMessage } from 'baileys';

interface MessageRaw {
    id: string;                  // key.id
    cid: string;                 // remoteJidAlt || remoteJid
    mid: string | null;          // contextInfo.stanzaId (mensaje citado)
    me: boolean;                 // key.fromMe
    type: 'text' | 'image' | 'video' | 'audio' | 'sticker'
        | 'document' | 'location' | 'poll' | 'vcard' | 'event';
    author: string;              // JID resuelto del remitente
    status: number;              // 0..5, ver la tabla de abajo
    starred: boolean;
    forwarded: boolean;          // contextInfo.isForwarded
    created_at: number;          // epoch ms (messageTimestamp * 1000)
    deleted_at: number | null;   // epoch ms en que vence un mensaje temporal
    mime: string;                // mimetype del media, o text/plain
    caption: string;             // cuerpo del texto, pie, pregunta de encuesta o descripción del evento
    edited: boolean;
    multiple?: boolean;          // encuestas: selección múltiple, preservada entre re-syncs
    reactions?: { author: string; emoji: string; at: number }[];
    raw: WAMessage;              // crudo completo de baileys, usado para reenviar / redescargar
}
```

Valores numéricos de `status`, y el string legible que expone
[`Message.status`](references/message.es.md):

| Valor | `msg.status`  | Significado                    |
| ----- | ------------- | ------------------------------ |
| `0`   | `'error'`     | Error de envío                 |
| `1`   | `'pending'`   | Pendiente                      |
| `2`   | `'sent'`      | Confirmado por el servidor     |
| `3`   | `'delivered'` | Entregado al destinatario      |
| `4`   | `'read'`      | Leído por el destinatario      |
| `5`   | `'played'`    | Reproducido (audio/video)      |

---

### Contenido del mensaje — `/chat/<cid>/message/<mid>/content`

Se escribe crudo cuando el driver implementa `set_buffer`; si no, como un pequeño envoltorio JSON:

```ts
interface ContentEnvelope {
    data: string;   // contenido codificado en base64
}
```

El contenido depende de `type`:

| `type`                                               | Contenido                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `text`                                               | Texto UTF-8 (el cuerpo del mensaje).                                 |
| `location`                                           | JSON UTF-8 `{ "lat": number, "lng": number }`.                       |
| `poll`                                               | JSON UTF-8 `{ "content": string, "options": [{ "content": string }] }`. |
| `vcard`                                              | Las vCards crudas, unidas por saltos de línea.                       |
| `event`                                              | JSON UTF-8 del `eventMessage` de baileys.                            |
| `image` / `video` / `audio` / `sticker` / `document` | Bytes descifrados descargados con `downloadMediaMessage`.            |

!!! info "El contenido es opcional y se escribe una sola vez"
    El subdocumento solo se escribe cuando hay algo que guardar — los buffers vacíos se saltan — y
    solo en la **primera** entrega del mensaje: los re-syncs lo omiten porque el contenido ya vive en
    el motor. `Message.content()` devuelve `Buffer.alloc(0)` cuando no hay nada guardado y el media
    ya no se puede descargar.

---

### Estado — `/status/<id>`

```ts
import type { WAMessage } from 'baileys';

interface FeedRaw {
    id: string;
    author_jid: string;
    type: 'text' | 'image' | 'video' | 'audio';
    caption: string;
    mime: string;
    created_at: number;   // epoch ms
    expires_at: number;   // created_at + 24h (FEED_TTL_MS)
    viewed: boolean;      // true una vez que se envió el read receipt
    raw: WAMessage;
}
```

Su contenido vive en `/status/<id>/content` con las mismas reglas de envoltorio que un mensaje. Ver
[Feed](references/feed.es.md).

---

### Credenciales de sesión — `/session/creds`

El valor es el objeto **opaco** `AuthenticationCreds` de baileys serializado con `BufferJSON`. La
librería no inspecciona ni documenta sus campos internos; trátalo como una caja negra propiedad de
baileys.

Para rotar la sesión manualmente, haz `unset('/session/creds')` y deja que `connect()` la regenere en
el siguiente intento — el orquestador relee las credenciales al inicio de cada reintento.

---

### Índice LID — `/lid/<lid>`, `/lid/<pn>`

| Ruta                    | Valor                                                                       |
| ----------------------- | ----------------------------------------------------------------------------- |
| `/lid/<lid>`            | **String** codificado en JSON: el JID/PN canónico de ese LID.                |
| `/lid/<pn>`             | **String** codificado en JSON: el LID de ese PN (lo escribe `lid-mapping.update`). |
| `/lid/<digits>_reverse` | Fallback legado, todavía se lee cuando el mapa directo está vacío.           |

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
```

Una escritura en `/chat/120363@g.us/message/ABC` ejecuta:

```
SET   wa:default:doc:chat/120363@g.us/message/ABC  "<json>"
ZADD  wa:default:idx:chat/120363@g.us/message      <score>  "chat/120363@g.us/message/ABC"
```

| Operación         | Primitivas de Redis                                                        |
| ----------------- | ---------------------------------------------------------------------------- |
| `get(path)`       | `GET <prefix>:doc:<path>`                                                  |
| `set(path,v,s)`   | `SET` + `ZADD` en un solo pipeline cuando el cliente lo expone             |
| `unset(path)`     | `DEL` del doc + `ZREM` del índice padre + cascada `SCAN`/`DEL`             |
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
<base>/chat/120363@g.us/
├── index.json                     # el documento del chat
├── .order                         # índice ordenado de los hijos
└── message/
    ├── .order
    ├── ABC/
    │   ├── index.json             # el documento del mensaje
    │   └── content/
    │       └── content.bin        # el contenido crudo
    └── DEF/
        └── index.json
```

| Operación     | Comportamiento en el sistema de archivos                                    |
| ------------- | ----------------------------------------------------------------------------- |
| `get(path)`   | `readFile(<base>/<path>/index.json)`; `null` si falta.                       |
| `set(path,v)` | `mkdir -p`, escritura atómica (tmp + rename); el `score` se aplica con `utimes`. |
| `unset(path)` | `rm -rf <base>/<path>`. Idempotente.                                         |
| `list(path)`  | Índice ordenado desde `.order` (o reconstruido con `readdir` + `stat`) y luego lectura. |
| `count(path)` | Tamaño del índice ordenado.                                                  |
| `clear()`     | `rm -rf <base>`.                                                             |

### `S3Engine`

Cada ruta se convierte en un objeto bajo `<basedir>/`, con `@` reemplazado por `_at_`, más un objeto
`.order` por prefijo que guarda los scores que S3 no puede almacenar (`LastModified` es de solo
lectura). Los binarios se guardan como documentos en base64, porque el driver no implementa métodos
de binario crudo.

---

## `unset()` en cascada

`unset(path)` elimina el documento **y todo el subárbol debajo de él**. Es intencional y se usa en
todo el orquestador para limpiezas masivas baratas:

| Quién llama                     | Ruta pasada a `unset()`              | Qué se elimina                                            |
| ------------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| `chat.delete()`                 | `/chat/<cid>`                        | El doc del chat + cada mensaje y su contenido.             |
| `chat.clear()`                  | `/chat/<cid>/message`                | Todos los mensajes del chat; el documento del chat sobrevive. |
| `msg.delete()`                  | `/chat/<cid>/message/<mid>`          | El doc del mensaje + su subdocumento de contenido.         |
| Estado revocado                 | `/status/<id>`                       | El doc del estado + su contenido.                          |
| Logout con `autoclean: false`   | `/session/creds`                     | Solo las credenciales; el historial se conserva.           |

!!! warning "No hay unset por hoja"
    `unset` siempre cae en cascada. Para eliminar solo una subhoja, apúntala directamente (p. ej.
    `unset('/chat/<cid>/message/<mid>/content')` para soltar solo el contenido y conservar los
    metadatos del mensaje).

---

## Helpers de serialización

Los motores nunca ven objetos tipados — solo strings. Los helpers `serialize` / `deserialize`
manejan la frontera JSON ↔ objeto y preservan las instancias de `Buffer` mediante `BufferJSON`:

```ts
import { serialize, deserialize } from '@arcaelas/whatsapp';

await wa.engine.set('/app/config', serialize({ greeting: 'hola' }));

const raw = await wa.engine.get('/app/config');
const doc = deserialize<{ greeting: string }>(raw);  // → { greeting: 'hola' } | null
```

Usa los mismos helpers desde cualquier código propio que toque el motor si quieres compatibilidad
bit a bit con lo que escribe el orquestador.
