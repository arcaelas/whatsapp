# WhatsApp

La clase `WhatsApp` es el orquestador del cliente v3. Posee el motor de almacenamiento, expone los
delegados `Chat`, `Contact` y `Message`, y emite el mapa completo de eventos. Instanciar la clase
**no** abre una conexión; debes llamar a `connect(callback)` explícitamente.

---

## Importación

```typescript title="ESM / TypeScript"
import { WhatsApp, FileSystemEngine, RedisEngine } from '@arcaelas/whatsapp';
```

---

## Constructor

```typescript
new WhatsApp(options: IWhatsApp)
```

La opción `engine` es **obligatoria**. Todos los demás campos son opcionales.

| Opción      | Tipo                                                    | Por defecto | Descripción                                                                                                            |
| ----------- | ------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `engine`    | `Engine`                                                | —           | Motor de almacenamiento que implementa el contrato `Engine`. Ver [Engines](engines.es.md).                             |
| `phone`     | `number \| string`                                      | —           | Número de teléfono para emparejamiento por PIN. Si se omite, el callback recibe un buffer PNG con QR en su lugar.      |
| `autoclean` | `boolean`                                               | `true`      | En un `loggedOut` remoto, limpia todo el motor. Con `false` solo se elimina `/session/creds` (se conserva el historial). |
| `reconnect` | `boolean \| number \| { max?: number; interval?: number }` | `true`   | Política de autoreconexión para cierres no-`loggedOut`. `interval` está en segundos. `true` reintenta por siempre cada 60s. |
| `sync`      | `boolean`                                               | `false`     | Habilita `syncFullHistory` de baileys; los chats, contactos y mensajes importados se persisten vía `messaging-history.set`. |

!!! info "Atajos de reconnect"
    - `true` — reintenta por siempre cada 60 segundos.
    - `false` — nunca reconecta.
    - `5` — reintenta hasta 5 veces, con 60 segundos entre intentos.
    - `{ max: 3, interval: 10 }` — reintenta 3 veces, con 10 segundos entre intentos.

---

## Ciclo de vida

### `connect(callback?)`

```typescript
connect(callback: (auth: string | Buffer) => void | Promise<void>): Promise<void>
```

Abre la conexión. El callback se invoca cada vez que baileys produce un nuevo artefacto
de autenticación:

- Si se proporcionó `phone` → el callback recibe el **string del PIN** (p. ej. `"ABCD-1234"`).
- En caso contrario → el callback recibe un **`Buffer` PNG** con el código QR.

La promesa se resuelve cuando la sesión se ha sincronizado completamente y `connection === 'open'`. Se rechaza si
el servidor devuelve `loggedOut` o si se agota el presupuesto de reconexión.

```typescript title="Conectar con QR (FileSystemEngine)" hl_lines="6 7 8"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';
import { writeFileSync } from 'node:fs';

const wa = new WhatsApp({ engine: new FileSystemEngine('./data/wa') });

await wa.connect((auth) => {
    writeFileSync('./qr.png', auth as Buffer);
});
```

```typescript title="Conectar con PIN (RedisEngine)" hl_lines="7 8 9 10"
import IORedis from 'ioredis';
import { WhatsApp, RedisEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new RedisEngine(new IORedis(), 'wa:5491112345678'),
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

Cierra el socket limpiamente.

| Opción    | Tipo      | Por defecto | Descripción                                                                                          |
| --------- | --------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| `destroy` | `boolean` | `false`     | Si es `true`, se llama a `engine.clear()` después de cerrar: borra todo el store.                    |
| `silent`  | `boolean` | `false`     | Bandera reservada (actualmente consumida pero no cambia el comportamiento observable).               |

Internamente, `disconnect()` cancela cualquier temporizador de reconexión pendiente y termina el socket con
un error tipo Boom que lleva `statusCode = 428` (`connectionClosed`) para que el close handler vea una
señal explícita en lugar de `undefined`.

```typescript title="Apagado limpio"
process.on('SIGTERM', async () => {
    await wa.disconnect();
});
```

```typescript title="Logout + borrado"
await wa.disconnect({ destroy: true });
```

---

## Eventos

`WhatsApp` expone una API de eventos tipada. Los oyentes registrados con `on` y `once` devuelven una
**función de desuscripción** para una limpieza ergonómica. Ver [Events](events.es.md) para el mapa completo.

| Método          | Devuelve         | Descripción                                                              |
| --------------- | ---------------- | ------------------------------------------------------------------------ |
| `on(e, h)`      | `() => void`     | Registra un oyente; la función devuelta lo desconecta.                   |
| `once(e, h)`    | `() => void`     | Registra un oyente de un solo disparo; la función devuelta lo desconecta preventivamente. |
| `off(e, h)`     | `this`           | Elimina un oyente previamente registrado.                                |

```typescript title="Suscribirse y desuscribirse" hl_lines="5"
const off = wa.on('message:created', (msg, chat) => {
    console.log(`[${chat.id}] ${msg.caption}`);
});

off(); // desconectar luego
```

---

## Delegados

La instancia lleva tres constructores vinculados al `WhatsApp` y al `engine` actuales:

| Delegado     | Tipo                            | Propósito                                            |
| ------------ | ------------------------------- | ---------------------------------------------------- |
| `wa.Contact` | `ReturnType<typeof contact>`    | `new wa.Contact(raw, chat)` y estáticos de contacto. |
| `wa.Chat`    | `ReturnType<typeof chat>`       | `new wa.Chat(raw)` y estáticos de chat.              |
| `wa.Message` | `ReturnType<typeof message>`    | `new wa.Message({ wa, doc })` y estáticos de mensaje. |
| `wa.engine`  | `Engine`                        | Acceso directo al motor de almacenamiento.           |

```typescript title="Uso de delegados"
const chats = await wa.Chat.list({ limit: 20 });
const contact = await wa.Contact.get('5491112345678');
await wa.Message.text('5491112345678', 'Hello from v3');
```

---

## Semántica del ciclo de vida

!!! tip "Cierres transitorios (`restartRequired`, código `515`)"
    El reseteo obligatorio del protocolo que sigue a la sincronización inicial se trata como transitorio. **No**
    emite `disconnected` y **no** consume presupuesto de reintentos; la reconexión ocurre con
    cero delay.

!!! warning "`loggedOut` (código `401`)"
    En `loggedOut`, la limpieza del motor se completa **antes** de que se dispare el evento `disconnected`:

    - `autoclean: true` (por defecto) → `engine.clear()` se ejecuta primero.
    - `autoclean: false`           → solo se elimina `/session/creds`; el historial se preserva.

    La promesa devuelta por `connect()` se rechaza con `Error('Logged out')`.

!!! info "Desconexión manual (`statusCode = 428`)"
    `disconnect()` termina el socket con un error tipo Boom que lleva
    `output.statusCode = 428`. Esto hace que los cierres manuales sean distinguibles de los errores
    a nivel de red al inspeccionar `lastDisconnect.error` en tooling personalizado.

---

## Ejemplo completo

```typescript title="server.ts"
import IORedis from 'ioredis';
import { WhatsApp, RedisEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new RedisEngine(new IORedis(), 'wa:default'),
    phone: 5491112345678,
    reconnect: { max: 5, interval: 30 },
    autoclean: true,
});

wa.on('connected',    () => console.log('online'));
wa.on('disconnected', () => console.log('offline'));

wa.on('message:created', async (msg, chat) => {
    if (msg.caption === '/ping') {
        await chat.text('pong');
    }
});

await wa.connect((pin) => console.log('PIN:', pin));
```
