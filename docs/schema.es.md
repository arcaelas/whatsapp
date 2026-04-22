# Esquemas de datos

Referencia para cada documento que `@arcaelas/whatsapp` v3 escribe a través de un `Engine`.

La librería nunca almacena blobs binarios directamente: cada valor pasa primero por
`serialize()` (que usa `BufferJSON` de baileys) por lo que el motor solo ve y
persiste **strings**. Los drivers de motor (`RedisEngine`, `FileSystemEngine`) son
tuberías opacas; no están al tanto de JSON, de WhatsApp, ni de buffers.

---

## Vista general del layout de almacenamiento

El orquestador (`WhatsApp`) escribe en un conjunto pequeño y fijo de rutas. Todo
lo que produce la librería vive bajo una de estas ramas:

| Rama         | Propósito                                                                       |
| ------------ | ------------------------------------------------------------------------------- |
| `/session/`  | Credenciales de autenticación y material del protocolo Signal.                  |
| `/contact/`  | Metadatos de contacto (un documento por JID de contacto).                       |
| `/chat/`     | Metadatos del chat + documentos de mensaje por chat (con sub-documentos de contenido separados). |
| `/lid/`      | Índice bidireccional LID ↔ JID.                                                 |

Las rutas usan `/` como separador y **nunca comienzan ni terminan con una barra** una vez
normalizadas — ambos motores colapsan `//` y recortan `/` iniciales/finales.

---

## Índice de rutas

Cada ruta concreta que el orquestador puede escribir o leer.

| Ruta                                              | Propósito                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `/session/creds`                                  | `AuthenticationCreds` de baileys (PIN, signed prekey, identity, registration). |
| `/session/pre-key/<id>`                           | Entrada de pre-key de Signal escrita por el key store de baileys.         |
| `/session/session/<id>`                           | Registro de sesión de Signal por identidad remota.                        |
| `/session/app-state-sync-key/<id>`                | App-state sync key (reconstruida vía `proto.Message.AppStateSyncKeyData.create`). |
| `/session/sender-key/<id>`                        | Sender keys de grupo.                                                     |
| `/session/sender-key-memory/<id>`                 | Memoria de sender-key usada durante el fan-out.                           |
| `/session/device-list/<jid>`                      | Lista de dispositivos en caché para un JID.                               |
| `/session/lid-mapping/<id>`                       | Entradas de mapeo LID en caché persistidas por el key store de baileys.   |
| `/contact/<jid>`                                  | Documento de contacto (`IContactRaw`).                                    |
| `/chat/<cid>`                                     | Documento de chat (`IChatRaw`).                                           |
| `/chat/<cid>/message/<mid>`                       | Documento de mensaje (`IMessage`) incluyendo el `WAMessage` raw completo de baileys. |
| `/chat/<cid>/message/<mid>/content`               | Payload decodificado `{ data: "<base64>" }` (texto, JSON o bytes de media). |
| `/lid/<lid>`                                      | Mapa directo: LID → JID (string).                                         |
| `/lid/<lid>_reverse`                              | Fallback inverso usado por `_resolve_jid()` cuando el LID no está mapeado. |

!!! note "Claves de sesión"
    El conjunto exacto de rutas `/session/<category>/<id>` depende de lo que baileys
    persista. La librería trata cada categoría uniformemente: serializa el
    valor con `BufferJSON` y lo escribe bajo `/session/<category>/<id>`.

---

## Formas de los documentos

Todos los documentos son JSON serializados con `BufferJSON`. Los buffers se codifican como:

```json
{ "type": "Buffer", "data": "<base64 string>" }
```

`deserialize<T>(raw)` reconstruye las instancias originales `Buffer`/`Uint8Array`
al leer.

---

### `IContactRaw` — `/contact/<jid>`

```ts
interface IContactRaw {
    id: string;                  // JID canónico (p. ej. 584144709840@s.whatsapp.net)
    lid: string | null;          // identificador LID alternativo cuando se conoce
    name: string | null;         // nombre de libreta de direcciones
    notify: string | null;       // push name definido por el contacto
    verified_name: string | null;// nombre verificado de negocio
    img_url: string | null;      // URL de la foto de perfil ("changed" si rotó)
    status: string | null;       // bio / about
}
```

Payload de ejemplo:

```json
{
    "id": "584144709840@s.whatsapp.net",
    "lid": "140913951141911@lid",
    "name": "Juan Perez",
    "notify": "Juanito",
    "verified_name": null,
    "img_url": "https://pps.whatsapp.net/v/t61.24694-24/...",
    "status": "Available 24/7"
}
```

---

### `IChatRaw` — `/chat/<cid>`

El documento de chat solo persiste los campos que el orquestador rastrea explícitamente (ver
`_handle_chats_upsert` / `_handle_chats_update`):

```ts
interface IChatRaw {
    id: string;
    name?: string | null;
    archived?: boolean | null;
    pinned?: number | null;          // timestamp de pin; null/ausente = sin pin
    mute_end_time?: number | null;   // ms epoch; <= Date.now() significa sin silenciar
    unread_count?: number | null;
    read_only?: boolean | null;
}
```

Payload de ejemplo:

```json
{
    "id": "120363123456789@g.us",
    "name": "Dev Team",
    "archived": false,
    "pinned": 1767371367857,
    "mute_end_time": null,
    "unread_count": 5,
    "read_only": false
}
```

---

### `IMessage` — `/chat/<cid>/message/<mid>`

```ts
interface IMessage {
    id: string;                  // key.id
    cid: string;                 // remoteJidAlt || remoteJid
    mid: string | null;          // contextInfo.stanzaId (padre para respuestas)
    me: boolean;                 // key.fromMe
    type: 'text' | 'image' | 'video' | 'audio' | 'location' | 'poll';
    author: string;              // JID resuelto del remitente
    status: MessageStatus;       // 0..5 (ERROR..PLAYED)
    starred: boolean;
    forwarded: boolean;          // contextInfo.isForwarded
    created_at: number;          // ms epoch (messageTimestamp * 1000)
    deleted_at: number | null;   // ms epoch cuando expira un efímero
    mime: string;                // text/plain | application/json | mimetype de media
    caption: string;             // cuerpo de texto o caption/title/option-list para media
    edited: boolean;
    raw: WAMessage;              // raw completo de baileys, usado para forward / re-descarga
}
```

Enum `MessageStatus`:

| Valor | Constante    | Significado                      |
| ----- | ------------ | -------------------------------- |
| `0`   | `ERROR`      | Error de envío                   |
| `1`   | `PENDING`    | Pendiente                        |
| `2`   | `SERVER_ACK` | Confirmado por el servidor       |
| `3`   | `DELIVERED`  | Entregado al destinatario        |
| `4`   | `READ`       | Leído por el destinatario        |
| `5`   | `PLAYED`     | Reproducido (audio/video)        |

---

### Contenido del mensaje — `/chat/<cid>/message/<mid>/content`

Almacenado como un pequeño sobre JSON:

```ts
interface IMessageContent {
    data: string;                // payload codificado en base64
}
```

La forma del contenido depende de `IMessage.type`:

| `type`     | Payload (tras decodificar base64)                                          |
| ---------- | -------------------------------------------------------------------------- |
| `text`     | Texto UTF-8 (el cuerpo del mensaje).                                       |
| `location` | JSON UTF-8 `{ "lat": number, "lng": number }`.                             |
| `poll`     | JSON UTF-8 `{ "content": string, "options": [{ "content": string }] }`.    |
| `image` / `video` / `audio` | Bytes desencriptados crudos descargados vía `downloadMediaMessage`. |

!!! info "Información: el contenido es opcional"
    El sub-documento `content` solo se escribe cuando hay algo que
    almacenar — los buffers vacíos se omiten. `Message.content()` devuelve
    `Buffer.alloc(0)` cuando falta.

---

### Credenciales de sesión — `/session/creds`

El valor es el objeto **opaco** `AuthenticationCreds` de baileys serializado
con `BufferJSON`. La librería no introspecciona ni documenta sus campos
internos; los consumidores deben tratarlo como una caja negra propiedad de baileys.

Para rotar la sesión manualmente, `unset('/session/creds')` y deja que
`connect()` lo regenere en el próximo `start()` (el orquestador vuelve a leer
las creds al inicio de cada reintento).

---

### Índice LID — `/lid/<lid>` y `/lid/<lid>_reverse`

| Ruta                  | Valor                                              |
| --------------------- | -------------------------------------------------- |
| `/lid/<lid>`          | **String** codificado en JSON: el JID/PN canónico. |
| `/lid/<lid>_reverse`  | **String** o **number** codificado en JSON: fallback PN cuando el mapa directo está vacío. |

Usado por `WhatsApp._resolve_jid()` para normalizar cualquier identificador `@lid` a un
JID `@s.whatsapp.net` canónico.

---

## Mapeo de rutas del motor

### `RedisEngine`

El driver de Redis usa dos keyspaces por ruta lógica:

```
<prefix>:doc:<path>          -> valor string (el documento serializado)
<prefix>:idx:<parent_path>   -> sorted set; score = mtime (Date.now()), member = ruta hija completa
```

Por lo que una escritura a `/chat/120363@g.us/message/ABC` realmente ejecuta:

```
SET   wa:default:doc:chat/120363@g.us/message/ABC  "<json>"
ZADD  wa:default:idx:chat/120363@g.us/message      <ts>  "chat/120363@g.us/message/ABC"
```

| Operación         | Primitivas de Redis                                                        |
| ----------------- | -------------------------------------------------------------------------- |
| `get(path)`       | `GET <prefix>:doc:<path>`                                                  |
| `set(path,v)`     | `SET <prefix>:doc:<path>` + `ZADD <prefix>:idx:<parent> Date.now() <path>` |
| `unset(path)`     | `DEL` doc + `ZREM` del índice padre + cascada `SCAN/DEL` sobre `doc:<path>/*` e `idx:<path>(/*)` |
| `list(path)`      | `ZREVRANGE <prefix>:idx:<path>` + `MGET` sobre los documentos coincidentes (un par de round-trip) |
| `count(path)`     | `ZCARD <prefix>:idx:<path>` (O(1))                                         |
| `clear()`         | `SCAN/DEL` sobre `<prefix>:*`                                              |

El prefijo por defecto es `wa:default`. Usa un prefijo diferente por cuenta cuando
compartas una instancia de Redis entre sesiones:

```ts
import IORedis from 'ioredis';
import { RedisEngine } from '@arcaelas/whatsapp';

const redis = new IORedis(process.env.REDIS_URL);

const engine_a = new RedisEngine(redis, 'wa:584144709840');
const engine_b = new RedisEngine(redis, 'wa:584121234567');
```

---

### `FileSystemEngine`

El driver del sistema de archivos mapea cada ruta lógica a un directorio y escribe el
documento dentro como `index.json`:

```
<base>/<path>/index.json      -> documento
```

Una escritura a `/chat/120363@g.us/message/ABC` produce:

```
<base>/chat/120363@g.us/message/ABC/index.json
```

Las sub-rutas simplemente se anidan como directorios adicionales junto a `index.json`, por lo que un
recurso y sus hijos pueden coexistir en disco:

```
<base>/chat/120363@g.us/
├── index.json                     # el documento del chat
└── message/
    ├── ABC/
    │   ├── index.json             # el documento del mensaje
    │   └── content/
    │       └── index.json         # el sobre { data: base64 }
    └── DEF/
        └── index.json
```

| Operación     | Comportamiento en el filesystem                                          |
| ------------- | ------------------------------------------------------------------------ |
| `get(path)`   | `readFile(<base>/<path>/index.json)`; devuelve `null` cuando falta.      |
| `set(path,v)` | `mkdir -p <base>/<path>` luego `writeFile(index.json)` (refresca mtime). |
| `unset(path)` | `rm -rf <base>/<path>`. Idempotente — nunca lanza si no existe.          |
| `list(path)`  | `readdir`, `stat` de cada `<child>/index.json`, ordena por mtime DESC, corta. |
| `count(path)` | Cuenta hijos directos que tengan un `index.json` válido.                 |
| `clear()`     | `rm -rf <base>`.                                                         |

---

## `unset()` en cascada

`unset(path)` elimina el documento **y todo el subárbol debajo de él**. Esto
es intencional y se usa a lo largo del orquestador para limpieza masiva barata:

| Llamador                                 | Ruta pasada a `unset()`           | Qué se elimina                                        |
| ---------------------------------------- | --------------------------------- | ----------------------------------------------------- |
| `Chat.remove(cid)` / `chat.remove()`     | `/chat/<cid>`                     | El documento del chat + cada `/message/<mid>` y su `/content`. |
| `Message.delete()` / `Message.remove()`  | `/chat/<cid>/message/<mid>`       | El documento del mensaje + su sub-documento `/content`. |
| Eliminación de `Contact`                 | `/contact/<jid>`                  | Solo el documento del contacto (sin hijos).           |
| Logout con `autoclean: false`            | `/session/creds`                  | Solo credenciales; el historial se preserva.          |

!!! warning "Advertencia: no hay unset por hoja"
    `unset` siempre cascada. Para eliminar solo una sub-hoja, apúntala directamente
    (p. ej. `unset('/chat/<cid>/message/<mid>/content')` para descartar solo el
    payload manteniendo los metadatos del mensaje).

---

## Helpers de serialización

Los motores nunca ven objetos tipados — solo strings. Los helpers `serialize`/`deserialize`
manejan la frontera JSON ↔ objeto y preservan las instancias de `Buffer`
a través de `BufferJSON`:

```ts
import { serialize, deserialize } from '@arcaelas/whatsapp';

await wa.engine.set('/chat/abc', serialize({ id: 'abc', name: 'demo' }));

const raw = await wa.engine.get('/chat/abc');
const doc = deserialize<IChatRaw>(raw);  // → { id, name, ... } o null
```

Usa los mismos helpers en cualquier llamador de `Engine` personalizado si quieres
compatibilidad bit a bit con lo que escribe el orquestador.
