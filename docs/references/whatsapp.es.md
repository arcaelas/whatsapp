# WhatsApp

La clase `WhatsApp` es el orquestador del cliente. Posee el motor de almacenamiento, expone las
entidades `Contact`, `Chat`, `Message`, `Feed`, `Catalog` y `Product` ligadas a la sesión, devuelve
el contacto propio con `me()` y emite el mapa completo de eventos.
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
| `sync`      | `boolean`                                                  | `false`     | Descarga el **historial de mensajes** al vincular. Contactos, credenciales, LID mappings y tctokens se sincronizan siempre, sin importar esta bandera. |
| `device`    | `string`                                                   | `'Chrome'`  | Nombre con el que esta sesión aparece en *Dispositivos vinculados* del teléfono. Con varias sesiones en una cuenta es lo único que permite distinguirlas. Evita `'Desktop'` junto con `sync: true`: baileys 7.0.0-rc14 anuncia entonces la plataforma `WIN32`, ya retirada, y WhatsApp cierra el handshake con 428 antes del QR. |
| `debug`     | `'silent' \| 'fatal' \| 'error' \| 'warn' \| 'info' \| 'debug' \| 'trace'` | `'silent'` | Nivel del log interno de baileys. `Farewell` da el código del cierre; el intercambio que llevó hasta él solo aparece en `debug` o `trace`. |

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
    eso se procesan siempre. `sync: true` agrega la descarga del historial FULL y, con él, cada
    media de ese historial: en una cuenta grande son minutos de descarga antes del primer
    `connected`, así que queda apagado salvo que lo pidas.

---

## Superficie

```typescript
wa.engine                            // el motor de persistencia que pasaste
wa.Contact / wa.Chat / wa.Message    // entidades, publicadas al conectar
wa.Feed / wa.Catalog / wa.Product    // estados, catálogos y productos, publicados al conectar
await wa.me()                        // el Contact propio, o null durante el pairing

await wa.connect(callback)           // el callback recibe el PIN (string) o el QR (Buffer PNG)
await wa.disconnect({ silent?, destroy? })   // desvincula el dispositivo del teléfono

wa.on(event, handler)                // devuelve la función para desuscribirse
wa.once(event, handler)              // devuelve la función para desuscribirse
wa.off(event, handler)               // devuelve `this`
wa.emit(event, ...args)              // true si había listeners
```

!!! danger "No hay estado privado que alcanzar"
    El socket de baileys, las credenciales y el estado de reintentos viven en el closure de
    `connect`, no en la instancia. `wa._socket` y compañía **no existen**: todo pasa por los
    métodos de arriba. Las entidades se publican en el primer `connect`, cuando el socket ya existe
    —antes no están definidas— y conservan su identidad entre reconexiones.

---

## Ciclo de vida

### `connect(callback)`

```typescript
connect(callback: (auth: string | Buffer) => void | Promise<void>): Promise<void>
```

Abre la conexión. El callback se invoca cada vez que hay un artefacto de autenticación nuevo, hasta
que el dispositivo queda vinculado:

- Con `phone` y `method` en `'otp'` → el callback recibe el **PIN** (string). Cada tres refrescos del
  QR (unos 100 segundos) la solicitud se renueva, reusando el mismo código.
- Con `phone` y `method: 'qr'`, o sin `phone` → el callback recibe un **`Buffer` PNG** con el QR, que
  se refresca cada ~20 segundos.

Mientras el dispositivo no está vinculado, la serie de QR que se agota abre otra al instante, y el PIN
conserva el mismo código, incluso si el proceso se reinicia.

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
    console.log('Pair this code on your phone:', auth);
});
```

### `disconnect(options?)`

```typescript
disconnect(options?: { silent?: boolean; destroy?: boolean }): Promise<void>
```

Cierra la sesión **de verdad**: desvincula el dispositivo del teléfono (`logout`), termina el
socket, cancela cualquier reintento pendiente y borra `/session` del motor. La promesa resuelve
cuando el teléfono acusó la desvinculación. Es una operación deliberada y definitiva: el próximo
`connect()` vuelve a vincular.

| Opción    | Tipo      | Por defecto | Descripción                                                                                   |
| --------- | --------- | ----------- | --------------------------------------------------------------------------------------------- |
| `silent`  | `boolean` | `false`     | Silencia el evento `disconnected` **de este cierre concreto**.                                |
| `destroy` | `boolean` | `false`     | Llama a `engine.clear()` en vez de `unset('/session')` — se van también chats, mensajes y contactos. |

Ninguna de las dos banderas decide si la sesión muere; solo modulan efectos secundarios. Las
credenciales se borran en los dos casos: el dispositivo ya no existe en el teléfono, así que
reconectar con ellas solo devolvería un `loggedOut`.

!!! danger "No lo llames para apagar un proceso"
    Un reinicio o un despliegue debe terminar el proceso y nada más: el socket muere con él y las
    credenciales sobreviven para el próximo `connect()`. Llamar a `disconnect()` ahí desvincula la
    línea en cada reinicio y gasta uno de los cuatro cupos de dispositivos vinculados cada vez que
    vuelves a vincular.

    ```typescript title="Apagado ordenado"
    process.on('SIGTERM', () => process.exit(0));   // sin disconnect(): la sesión sobrevive
    ```

```typescript title="Desvincular y conservar el historial para estudiarlo"
await wa.disconnect();
```

```typescript title="Desvincular en silencio y borrar todo"
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
    console.log(`[${chat.id}] ${msg.caption()}`);
});

off(); // desengancha más tarde
```

!!! tip "`emit` es público a propósito"
    Las entidades de la librería lo usan para propagar los cambios que provocan (`Feed.seen(true)`
    emite `feed:updated`, `Poll.select()` emite `message:updated`). Puedes emitir tus propios
    payloads para ejercitar handlers en pruebas sin un socket vivo.

---

## El contacto propio

```typescript
me(): Promise<Contact | null>
```

Devuelve la propia cuenta como un [`Contact`](contact.es.md) —`me` es `true`— con el nombre público
de la sesión, o `null` mientras no hay usuario (durante el pairing). El perfil se cambia sobre él:
`rename()`, `content(value)`, `photo(value)` y `online()` sólo funcionan en el contacto propio y
rechazan con `UNAUTHORIZED` en cualquier otro.

```typescript title="me.ts"
const me = await wa.me();

await me?.rename('Ventas');                 // nombre público
await me?.photo(buffer);                    // cambia la foto; null la elimina
await me?.content('Abierto 9-18h');         // escribe la biografía
await me?.online(true);                     // presencia: el socket arranca offline
await wa.Feed.create({ caption: '¡Estamos en vivo!' });   // los estados se publican con Feed
```

---

## Entidades

La instancia lleva las entidades ligadas a la sesión actual, publicadas al conectar. Cada clase la
construye su factory (`contact`, `chat`, `message`, `feed`, `catalog`, `product`) en la primera
conexión; el paquete exporta esas factories, y los nombres `Contact`, `Chat`, `Message`, `Feed`,
`Catalog` y `Product` solo como tipos.

| Propiedad    | Qué es                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `wa.Contact` | Clase `Contact` ligada a la sesión: `new wa.Contact(raw)`, `wa.Contact.get`, `wa.Contact.list`. Ver [Contact](contact.es.md). |
| `wa.Chat`    | Clase `Chat` ligada a la sesión: `new wa.Chat(raw)`, `wa.Chat.get`, `wa.Chat.list`, `wa.Chat.create`, `wa.Chat.join`. Ver [Chat](chat.es.md). |
| `wa.Message` | Clase `Message` ligada a la sesión: `new wa.Message(timeline)` devuelve la subclase de su tipo; lecturas, envíos, acciones por id y las subclases. |
| `wa.Feed`    | Clase `Feed` ligada a la sesión: `new wa.Feed(timeline)`, `wa.Feed.get`, `wa.Feed.list`, `wa.Feed.create`. Ver [Feed](feed.es.md). |
| `wa.Catalog` | Clase `Catalog` ligada a la sesión, una instancia por colección de un negocio: `new wa.Catalog(timeline, jid, updated_at)`, `wa.Catalog.product(uid, pid)`. Los catálogos se leen con `contact.catalog()`. Ver [Catalog](catalog.es.md). |
| `wa.Product` | Clase `Product` del catálogo ligada a la sesión: `new wa.Product(timeline, jid)`. `instanceof wa.Product` también reconoce las tarjetas de producto que llegan a los chats. |
| `wa.engine`  | Acceso directo al motor de almacenamiento.                                                             |
| `wa.me()`    | El `Contact` propio, o `null` durante el pairing.                                                     |

```typescript title="Usando las entidades"
const chats  = await wa.Chat.list(0, 20);
const person = await wa.Contact.get('5491112345678');
await wa.Message.text('5491112345678', 'Hello');

console.log((await wa.me())?.name);
```

### La clase `wa.Message`

La clase ligada lleva cada lectura, envío y acción por id con la sesión ya aplicada:

| Grupo   | Miembros                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------ |
| Lectura | `get(cid, mid)`, `list(cid, offset?, limit?)`, `reactions(cid, mid)`                             |
| Envío   | `text`, `image`, `video`, `audio`, `sticker`, `location`, `poll`, `document`, `vcard`, `event`   |
| Acción  | `react(cid, mid, emoji)`, `star(cid, mid, value)`, `seen(cid, mid)`, `edit(cid, mid, caption)`, `forward(cid, mid, target)`, `delete(cid, mid, all?)`, `pin(cid, mid, value, days?)` |
| Clases  | `Text`, `Image`, `Video`, `Audio`, `Sticker`, `Document`, `Location`, `Poll`, `VCard`, `Event`, `Product` |

Esas clases existen solo ahí: el paquete exporta `Text`, `Poll` y el resto como tipos, así que
`instanceof` pasa por la clase ligada, como en `msg instanceof wa.Message.Poll`.

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

!!! info "`disconnected` dice por qué"
    El evento lleva un segundo argumento, `Farewell`: `code` (código de estado de baileys o
    `null`), `reason` (`loggedOut`, `connectionReplaced`, `badSession`, … o `unknown`), `expired`
    (`true` cuando el teléfono desvinculó la sesión: no se reintenta y las credenciales ya no
    sirven) y `detail` (el mensaje del error subyacente). `wa.on('error', …)` reporta fallos que
    no tumban la conexión, como `ERR_OTP_EXPIRED` cuando se agota el presupuesto del PIN.

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
wa.on('disconnected', (_, farewell) => console.log('offline:', farewell.reason, farewell.code));

wa.on('message:created', async (msg, chat) => {
    if (!msg.me && msg.caption() === '/ping') {
        await msg.text(`pong from ${chat.name()}`);
    }
});

await wa.connect((pin) => console.log('PIN:', pin));
```
