# WhatsApp

Clase principal que gestiona la conexion, eventos y entidades de WhatsApp.

---

## Importacion

```typescript
import { WhatsApp } from "@arcaelas/whatsapp";
```

---

## Constructor

### `new WhatsApp(options?)`

Crea una nueva instancia de WhatsApp.

**Parametros:**

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `options.engine` | `Engine` | `FileEngine` | Engine de persistencia |
| `options.phone` | `string \| number` | `undefined` | Numero para codigo de emparejamiento |

**Ejemplos:**

```typescript
// Configuracion minima (usa FileEngine en .baileys/default)
const wa = new WhatsApp();

// Con numero de telefono (emparejamiento por codigo)
const wa = new WhatsApp({
  phone: "5491112345678",
});

// Con engine personalizado
const wa = new WhatsApp({
  engine: new FileEngine(".baileys/mi-bot"),
  phone: "5491112345678",
});
```

---

## Propiedades

### `engine`

```typescript
readonly engine: Engine
```

Engine de persistencia activo.

### `socket`

```typescript
get socket(): WASocket | null
```

Socket de Baileys. `null` si no esta conectado.

### `event`

```typescript
readonly event: EventEmitter<WhatsAppEventMap>
```

EventEmitter tipado para escuchar eventos.

### `Chat`

```typescript
readonly Chat: ReturnType<typeof chat>
```

Clase Chat enlazada a esta instancia. Incluye metodos estaticos (`get`, `list`, `pin`, `archive`, `mute`, `seen`, `remove`) y metodos de instancia.

### `Contact`

```typescript
readonly Contact: ReturnType<typeof contact>
```

Clase Contact enlazada a esta instancia. Incluye metodos estaticos (`get`, `list`, `rename`, `refresh`) y metodos de instancia.

### `Message`

```typescript
readonly Message: ReturnType<typeof message>
```

Clase Message enlazada a esta instancia. Incluye metodos estaticos (`get`, `list`, `count`, `text`, `image`, `video`, `audio`, `location`, `poll`, `watch`, `edit`, `remove`, `react`, `forward`) y metodos de instancia.

### `resolveJID(uid)`

```typescript
async resolveJID(uid: string): Promise<string | null>
```

Resuelve cualquier identificador de usuario (JID, numero de telefono o LID) a un JID normalizado (`@s.whatsapp.net` o `@g.us`). Retorna `null` si el LID no se puede resolver.

| Input | Output |
|-------|--------|
| `123@g.us` | `123@g.us` (sin cambio) |
| `123@s.whatsapp.net` | `123@s.whatsapp.net` (sin cambio) |
| `123@lid` | Resuelto via keys `lid/` o `session/lid-mapping/` |
| `5491112345678` | `5491112345678@s.whatsapp.net` |

```typescript
const jid = await wa.resolveJID("5491112345678");
// "5491112345678@s.whatsapp.net"

const jid2 = await wa.resolveJID("123456@lid");
// "584144709840@s.whatsapp.net" (o null si no se puede resolver)
```

---

## Metodos

### `pair(callback)`

```typescript
pair(callback: (code: string | Buffer) => void | Promise<void>): Promise<void>
```

Conecta a WhatsApp. Muestra QR o codigo de emparejamiento segun configuracion.

**Parametros:**

- `callback` - Funcion llamada con el QR (Buffer PNG) o codigo (string de 8 digitos)

**Comportamiento:**

1. Si `options.phone` esta definido, envia codigo de emparejamiento (solo una vez)
2. Si no, genera QR code como imagen PNG (periodicamente hasta escanear)
3. Reintenta conexion automaticamente en caso de desconexion
4. Emite `open` cuando la conexion es exitosa

**Errores fatales (no reintenta):**

- `loggedOut` (401) - Sesion cerrada desde telefono

**Ejemplo:**

```typescript
await wa.pair(async (data) => {
  if (Buffer.isBuffer(data)) {
    // QR code - guardar o mostrar
    require("fs").writeFileSync("qr.png", data);
    console.log("Escanea el QR guardado en qr.png");
  } else {
    // Codigo de 8 digitos
    console.log("Ingresa este codigo en WhatsApp:", data);
  }
});
```

---

## Eventos

Los eventos se escuchan a traves de `wa.event`:

```typescript
wa.event.on("open", () => {
  console.log("Conectado");
});
```

### `open`

Emitido cuando la conexion es exitosa.

```typescript
wa.event.on("open", () => {
  console.log("Conectado a WhatsApp");
});
```

### `close`

Emitido cuando la conexion se cierra (se reconectara automaticamente).

```typescript
wa.event.on("close", () => {
  console.log("Desconectado de WhatsApp");
});
```

### `error`

Emitido cuando ocurre un error fatal (no se reconectara).

```typescript
wa.event.on("error", (error: Error) => {
  console.error("Error fatal:", error.message);
});
```

### `contact:created`

Emitido cuando se crea un nuevo contacto.

```typescript
wa.event.on("contact:created", (contact) => {
  console.log(`Nuevo contacto: ${contact.name} (${contact.phone})`);
});
```

### `contact:updated`

Emitido cuando se actualiza un contacto existente.

```typescript
wa.event.on("contact:updated", (contact) => {
  console.log(`Contacto actualizado: ${contact.name}`);
});
```

### `chat:created`

Emitido cuando se crea un nuevo chat.

```typescript
wa.event.on("chat:created", (chat) => {
  console.log(`Nuevo chat: ${chat.name} (${chat.type})`);
});
```

### `chat:updated`

Emitido cuando se actualiza un chat existente.

```typescript
wa.event.on("chat:updated", (chat) => {
  console.log(`Chat actualizado: ${chat.name}`);
});
```

### `chat:pinned`

Emitido cuando se fija o desfija un chat. El payload es la instancia de Chat actualizada.

```typescript
wa.event.on("chat:pinned", (chat) => {
  if (chat.pinned) {
    console.log(`Chat ${chat.name} fijado`);
  } else {
    console.log(`Chat ${chat.name} desfijado`);
  }
});
```

### `chat:archived`

Emitido cuando se archiva o desarchiva un chat. El payload es la instancia de Chat actualizada.

```typescript
wa.event.on("chat:archived", (chat) => {
  console.log(`Chat ${chat.name}: ${chat.archived ? "archivado" : "desarchivado"}`);
});
```

### `chat:muted`

Emitido cuando se silencia o desilencia un chat. El payload es la instancia de Chat actualizada.

```typescript
wa.event.on("chat:muted", (chat) => {
  if (chat.muted) {
    console.log(`Chat ${chat.name} silenciado hasta ${new Date(chat.muted)}`);
  } else {
    console.log(`Chat ${chat.name} desilenciado`);
  }
});
```

### `chat:deleted`

Emitido cuando se elimina un chat.

```typescript
wa.event.on("chat:deleted", (cid) => {
  console.log(`Chat eliminado: ${cid}`);
});
```

### `message:created`

Emitido cuando se recibe un nuevo mensaje.

```typescript
wa.event.on("message:created", async (msg) => {
  console.log(`Nuevo mensaje de tipo ${msg.type}`);
  console.log(`  Chat: ${msg.cid}`);
  console.log(`  Mio: ${msg.me}`);

  if (msg.type === "text") {
    const text = (await msg.content()).toString();
    console.log(`  Texto: ${text}`);
  }
});
```

### `message:updated`

Emitido cuando se edita un mensaje.

```typescript
wa.event.on("message:updated", async (msg) => {
  console.log(`Mensaje editado: ${msg.id}`);
  if (msg.type === "text") {
    const text = (await msg.content()).toString();
    console.log(`  Nuevo texto: ${text}`);
  }
});
```

### `message:reacted`

Emitido cuando alguien reacciona a un mensaje.

```typescript
wa.event.on("message:reacted", (cid, mid, emoji) => {
  console.log(`Reaccion ${emoji} en mensaje ${mid} del chat ${cid}`);
});
```

### `message:deleted`

Emitido cuando se elimina un mensaje.

```typescript
wa.event.on("message:deleted", (cid, mid) => {
  console.log(`Mensaje eliminado: ${mid} del chat ${cid}`);
});
```

---

## Patrones comunes

### Bot con comandos

```typescript
const wa = new WhatsApp();

wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "text") return;

  const text = (await msg.content()).toString();
  if (!text.startsWith("!")) return;

  const [cmd, ...args] = text.slice(1).split(" ");

  if (cmd === "ping") {
    await wa.Message.text(msg.cid, "pong!");
  } else if (cmd === "hora") {
    await wa.Message.text(msg.cid, new Date().toLocaleString());
  }
});

await wa.pair((data) => {
  if (Buffer.isBuffer(data)) {
    require("fs").writeFileSync("qr.png", data);
  } else {
    console.log("Codigo:", data);
  }
});
```

### Filtrar por chat

```typescript
const ALLOWED_CHATS = [
  "5491112345678@s.whatsapp.net",
  "123456789@g.us",
];

wa.event.on("message:created", async (msg) => {
  if (!ALLOWED_CHATS.includes(msg.cid)) return;
  // Procesar solo mensajes de chats permitidos
});
```

### Auto-respuesta cuando esta ausente

```typescript
const AWAY_MESSAGE = "Estoy ausente. Respondere pronto.";
const responded = new Set<string>();

wa.event.on("message:created", async (msg) => {
  if (msg.me) return;

  // Responder solo una vez por chat
  if (responded.has(msg.cid)) return;
  responded.add(msg.cid);

  await wa.Message.text(msg.cid, AWAY_MESSAGE);

  // Limpiar despues de 1 hora
  setTimeout(() => responded.delete(msg.cid), 60 * 60 * 1000);
});
```

---

## Interfaz IWhatsApp

```typescript
interface IWhatsApp {
  engine?: Engine;
  phone?: string | number;
}
```

---

## Interfaz WhatsAppEventMap

```typescript
interface WhatsAppEventMap {
  open: [];
  close: [];
  error: [Error];
  "contact:created": [Contact];
  "contact:updated": [Contact];
  "chat:created": [Chat];
  "chat:updated": [Chat];
  "chat:pinned": [chat: Chat];
  "chat:archived": [chat: Chat];
  "chat:muted": [chat: Chat];
  "chat:deleted": [cid: string];
  "message:created": [Message];
  "message:updated": [Message];
  "message:reacted": [cid: string, mid: string, emoji: string];
  "message:deleted": [cid: string, mid: string];
}
```
