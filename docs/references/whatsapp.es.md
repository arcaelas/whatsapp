# WhatsApp

La clase `WhatsApp` es el orquestador del cliente. Posee el motor de almacenamiento, expone las
entidades `Contact`, `Chat` y `Message` ligadas a la sesión, y emite el mapa completo de eventos.
Instanciar la clase **no** abre una conexión; debes llamar a `connect(callback)` explícitamente.

---

## Importación

```typescript title="ESM / TypeScript"
import { WhatsApp, FileSystemEngine, RedisEngine } from '@arcaelas/whatsapp';

// El export por defecto es la misma clase, así que esto es equivalente:
// import WhatsApp from '@arcaelas/whatsapp';
```

---

## Constructor

```typescript
new WhatsApp(options: IWhatsApp)
```

La opción `engine` es **obligatoria**. Todos los demás campos son opcionales.

| Opción      | Tipo                                                       | Por defecto | Descripción                                                                                                                        |
| ----------- | ---------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `engine`    | `Engine`                                                   | —           | Motor de almacenamiento que implementa el contrato `Engine`. Ver [Engines](engines.es.md).                                           |
| `phone`     | `number \| string`                                         | —           | Teléfono de la cuenta. Su presencia habilita el emparejamiento por PIN; **sin él la vinculación es siempre por QR**.                 |
| `method`    | `'qr' \| 'otp'`                                            | `'otp'`     | Elige el canal de vinculación **solo cuando hay `phone`**. Sin `phone` se ignora, porque el PIN no puede pedirse sin número.         |
| `autoclean` | `boolean`                                                  | `true`      | En un `loggedOut` remoto, limpia todo el motor. Con `false` solo se elimina `/session/creds` (se conserva el historial).             |
| `reconnect` | `boolean \| number \| { max?: number; interval?: number }` | `true`      | Política de autoreconexión para cierres no-`loggedOut`. `interval` está en segundos. `true` reintenta por siempre cada 60s.          |
| `sync`      | `boolean`                                                  | `true`      | Descarga el **historial de mensajes** al vincular. Contactos, credenciales, LID mappings y tctokens se sincronizan siempre, sin importar esta bandera. |

!!! info "Atajos de reconnect"
    - `true` — reintenta por siempre cada 60 segundos.
    - `false` — nunca reconecta.
    - `5` — reintenta hasta 5 veces, con 60 segundos entre intentos.
    - `{ max: 3, interval: 10 }` — reintenta 3 veces, con 10 segundos entre intentos.

!!! tip "Los tipos de las opciones están exportados"
    `IWhatsApp` (las opciones del constructor), `ReconnectOption` y `DisconnectOptions` se exportan
    desde el paquete, así que puedes anotar tus propias factories y wrappers:

    ```typescript
    import type { IWhatsApp, ReconnectOption, DisconnectOptions } from '@arcaelas/whatsapp';

    function build(engine: IWhatsApp['engine'], reconnect: ReconnectOption): IWhatsApp {
        return { engine, reconnect };
    }

    const shutdown: DisconnectOptions = { silent: true, destroy: false };
    ```

!!! warning "`sync` solo controla el historial de mensajes"
    Los syncs no-FULL cargan las LID mappings y los tctokens que baileys exige para *enviar*; por
    eso se procesan siempre. `sync: false` únicamente omite la descarga del historial FULL.

---

## Superficie

```typescript
wa.engine                            // el motor de almacenamiento que pasaste
wa.contact                           // Contact de la cuenta autenticada, o null sin sesión
wa.Contact / wa.Chat / wa.Message    // entidades ligadas a este cliente

await wa.connect(callback)           // el callback recibe el PIN (string) o el QR (Buffer PNG)
await wa.disconnect({ silent?, destroy? })

wa.on(event, handler)                // devuelve la función de desuscripción
wa.once(event, handler)              // devuelve la función de desuscripción
wa.off(event, handler)               // devuelve `this`
wa.emit(event, ...args)              // devuelve true si había listeners

await wa.profile({ name?, content?, photo? })
await wa.feed({ content?, caption?, contacts })
```

!!! danger "No hay estado privado al que llegar"
    El socket de baileys, el emisor de eventos, las opciones de vinculación y el resolutor de JIDs
    viven en campos privados `#` y en un `WeakMap` fuera de la instancia. `wa._socket`, `wa._event`
    y `wa._resolve_jid` **no existen**: todo pasa por los métodos de arriba.

---

## Ciclo de vida

### `connect(callback)`

```typescript
connect(callback: (auth: string | Buffer) => void | Promise<void>): Promise<void>
```

Abre la conexión. El callback se invoca cada vez que baileys produce un artefacto de autenticación
nuevo (se refresca cada ~20 segundos hasta que el dispositivo queda vinculado):

- Con `phone` y `method` en `'otp'` → el callback recibe el **PIN** (string).
- Con `phone` y `method: 'qr'`, o sin `phone` → el callback recibe un **`Buffer` PNG** con el QR.

La promesa resuelve cuando la sesión sincroniza y `connection === 'open'`. Rechaza con
`Error('Logged out')` ante `loggedOut`, o con `Error('Reconnect attempts exhausted (N)')` cuando se
agota el presupuesto de reintentos.

```typescript title="Conexión por QR (FileSystemEngine)" hl_lines="6 7 8"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';
import { writeFileSync } from 'node:fs';

const wa = new WhatsApp({ engine: new FileSystemEngine('./data/wa') });

await wa.connect((auth) => {
    writeFileSync('./qr.png', auth as Buffer);
});
```

```typescript title="Conexión por PIN (SQLiteEngine)" hl_lines="8 9 10 11"
import { DatabaseSync } from 'node:sqlite';
import { WhatsApp, SQLiteEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new SQLiteEngine(new DatabaseSync('./data/5491112345678.db')),
    phone: 5491112345678,
});

await wa.connect((auth) => {
    console.log('Empareja este código en tu teléfono:', auth);
});
```

### `disconnect(options?)`

```typescript
disconnect(options?: { silent?: boolean; destroy?: boolean }): Promise<void>
```

Cierra el socket limpiamente y cancela cualquier reintento pendiente.

| Opción    | Tipo      | Por defecto | Descripción                                                              |
| --------- | --------- | ----------- | ------------------------------------------------------------------------ |
| `silent`  | `boolean` | `false`     | Silencia el evento `disconnected` **de este cierre concreto**.           |
| `destroy` | `boolean` | `false`     | Llama a `engine.clear()` tras cerrar — vacía el almacén completo.        |

Internamente el socket se cierra con un error tipo Boom que lleva
`output.statusCode = 428` (`connectionClosed`), para que el handler de cierre vea una señal
explícita en lugar de `undefined`.

```typescript title="Apagado ordenado"
process.on('SIGTERM', async () => {
    await wa.disconnect();
});
```

```typescript title="Cierre silencioso + limpieza"
await wa.disconnect({ silent: true, destroy: true });
```

---

## Eventos

`WhatsApp` expone una API de eventos tipada. Los listeners registrados con `on` y `once` devuelven
una **función de desuscripción** para una limpieza ergonómica. Ver [Events](events.es.md) para el
mapa completo.

| Método             | Devuelve       | Descripción                                                                |
| ------------------ | -------------- | -------------------------------------------------------------------------- |
| `on(e, h)`         | `() => void`   | Registra un listener; la función devuelta lo desengancha.                  |
| `once(e, h)`       | `() => void`   | Registra un listener de un solo disparo; la función devuelta lo cancela.   |
| `off(e, h)`        | `this`         | Elimina un listener registrado previamente.                                |
| `emit(e, ...args)` | `boolean`      | Emite un evento del cliente; `true` si había listeners.                    |

```typescript title="Suscribir y desuscribir" hl_lines="5"
const off = wa.on('message:created', (msg, chat) => {
    console.log(`[${chat.id}] ${msg.caption}`);
});

off(); // desengancha más tarde
```

!!! tip "`emit` es público a propósito"
    Las entidades de la librería lo usan para propagar los cambios que provocan (`Feed.view()`
    emite `feed:updated`, `Poll.select()` emite `message:updated`). Puedes emitir tus propios
    payloads para ejercitar handlers en pruebas sin un socket vivo.

---

## Perfil

```typescript
profile(patch: { name?: string; content?: string; photo?: string | Buffer | null }): Promise<boolean>
```

Actualiza el perfil de la cuenta en WhatsApp. Solo se envía lo que llega en el parche;
`photo: null` elimina la foto actual. Devuelve `false` cuando no hay sesión abierta.

```typescript title="profile.ts"
await wa.profile({ name: 'Ventas', content: 'Atendemos 9-18h' });
await wa.profile({ photo: buffer });                 // un Buffer o una URL https
await wa.profile({ photo: null });                   // elimina la foto
```

!!! warning "`ERR_PROFILE_PICTURE_LIB`"
    baileys redimensiona la foto con `sharp` o `jimp`. Ninguna es dependencia de esta librería, así
    que si faltan ambas, `profile({ photo })` lanza `ERR_PROFILE_PICTURE_LIB`. Instala una de ellas
    para usar ese campo.

---

## Estados (status broadcast)

```typescript
feed(post: { content?: Buffer; caption?: string; contacts: (string | number)[] }): Promise<Feed | null>
```

Publica un estado y devuelve el [`Feed`](feed.es.md) creado, o `null` cuando no hay sesión abierta.

- Solo con `caption` → estado de texto.
- Con `content` → imagen o video; el tipo se deduce de la firma del binario y `caption` queda como
  pie.
- `contacts` es la **audiencia** y es obligatoria: WhatsApp no entrega el estado a nadie fuera de
  esa lista.

```typescript title="feed.ts"
const post = await wa.feed({
    caption: '¡Estamos en vivo!',
    contacts: ['584144709840', 56963091328],
});
```

| Error              | Se lanza cuando                                        |
| ------------------ | ------------------------------------------------------ |
| `ERR_FEED_EMPTY`   | No se pasó ni `content` ni `caption`.                  |
| `ERR_FEED_MEDIA`   | `content` no es JPEG/PNG/WebP ni MP4.                  |

---

## Entidades

La instancia lleva las tres entidades ligadas al cliente y al motor actuales:

| Propiedad    | Qué es                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `wa.Contact` | Subclase de `Contact` ligada a la sesión: `new wa.Contact(raw)`, `wa.Contact.get`, `wa.Contact.list`.  |
| `wa.Chat`    | Subclase de `Chat` ligada a la sesión: `new wa.Chat(raw)`, `wa.Chat.get`, `wa.Chat.list`.              |
| `wa.Message` | Objeto delegado: los estáticos de `Message` sin repetir el cliente, más las subclases.                 |
| `wa.engine`  | Acceso directo al motor de almacenamiento.                                                             |
| `wa.contact` | `Contact` de la cuenta autenticada, o `null` mientras no hay sesión abierta.                           |

```typescript title="Usando las entidades"
const chats  = await wa.Chat.list(0, 20);
const person = await wa.Contact.get('5491112345678');
await wa.Message.text('5491112345678', 'Hola');

console.log(wa.contact?.name, wa.contact?.phone);
```

### El delegado `wa.Message`

Cada método refleja el estático de `Message` del mismo nombre con el cliente ya aplicado:
`wa.Message.text(cid, …)` es `Message.text(wa, cid, …)`.

| Grupo   | Miembros                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------ |
| Lectura | `get(cid, mid)`, `list(cid, offset?, limit?)`, `reactions(cid, mid)`                             |
| Envío   | `text`, `image`, `video`, `audio`, `location`, `poll`, `document`, `vcard`, `event`              |
| Acción  | `react(cid, mid, emoji)`, `star(cid, mid, value)`, `seen(cid, mid)`, `edit(cid, mid, caption)`, `forward(cid, mid, target)`, `delete(cid, mid, all?)` |
| Clases  | `Text`, `Image`, `Video`, `Audio`, `Sticker`, `Document`, `Location`, `Poll`, `VCard`, `Event`   |

Las clases expuestas ahí son exactamente las que exporta el paquete, así que
`msg instanceof wa.Message.Poll` y `msg instanceof Poll` son equivalentes.

---

## Semántica del ciclo de vida

!!! tip "Cierres transitorios (`restartRequired`, código `515`)"
    El reinicio que exige el protocolo tras el sync inicial se trata como transitorio: **no** emite
    `disconnected` y **no** consume presupuesto de reintentos; la reconexión ocurre sin espera.

!!! warning "`loggedOut` (código `401`)"
    Ante `loggedOut`, la limpieza del motor termina **antes** de que se emita `disconnected`:

    - `autoclean: true` (por defecto) → primero corre `engine.clear()`.
    - `autoclean: false`              → solo se elimina `/session/creds`; el historial se conserva.

    La promesa devuelta por `connect()` rechaza con `Error('Logged out')`.

!!! info "Desconexión manual (`statusCode = 428`)"
    `disconnect()` cierra el socket con un error tipo Boom que lleva
    `output.statusCode = 428`. Eso hace distinguibles los cierres manuales de los errores de red
    cuando inspeccionas `lastDisconnect.error` en herramientas propias.

---

## Ejemplo completo

```typescript title="server.ts"
import IORedis from 'ioredis';
import { WhatsApp, RedisEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new RedisEngine(new IORedis(), 'wa:5491112345678'),
    phone: 5491112345678,
    reconnect: { max: 5, interval: 30 },
    autoclean: true,
});

wa.on('connected',    () => console.log('online'));
wa.on('disconnected', () => console.log('offline'));

wa.on('message:created', async (msg, chat) => {
    if (!msg.me && msg.caption === '/ping') {
        await msg.text(`pong desde ${chat.name}`);
    }
});

await wa.connect((pin) => console.log('PIN:', pin));
```
