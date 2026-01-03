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
| `options.phone` | `string` | `undefined` | Numero para codigo de emparejamiento |
| `options.sync` | `boolean` | `false` | Sincronizar historial al conectar |
| `options.online` | `boolean` | `false` | Mostrar "en linea" al conectar |

**Ejemplos:**

```typescript
// Configuracion minima
const wa = new WhatsApp();

// Con todas las opciones
const wa = new WhatsApp({
  engine: new FileEngine(".baileys/mi-bot"),
  phone: "5491112345678",
  sync: true,
  online: false,
});
```

---

## Propiedades

### `options`

```typescript
readonly options: Readonly<IWhatsApp>
```

Opciones de configuracion (inmutables).

### `engine`

```typescript
engine: Engine
```

Engine de persistencia activo.

### `socket`

```typescript
socket: WASocket | null
```

Socket de Baileys. `null` si no esta conectado.

### `Chat`

```typescript
Chat: typeof Chat
```

Clase Chat enlazada a esta instancia. Representa tanto chats individuales como grupos (diferenciados por `type`).

### `Contact`

```typescript
Contact: typeof Contact
```

Clase Contact enlazada a esta instancia.

### `Message`

```typescript
Message: MessageFactory
```

Factory de mensajes con todas las clases de tipo.

---

## Metodos

### `pair(callback?)`

```typescript
async pair(callback?: (data: Buffer | string) => void | Promise<void>): Promise<void>
```

Conecta a WhatsApp. Muestra QR o codigo de emparejamiento segun configuracion.

**Parametros:**

- `callback` - Funcion llamada con el QR (Buffer PNG) o codigo (string de 8 digitos)

**Comportamiento:**

1. Si `options.phone` esta definido, envia codigo de emparejamiento
2. Si no, genera QR code como imagen PNG
3. Reintenta conexion automaticamente (hasta 5 veces con backoff exponencial)
4. Resuelve cuando la conexion es exitosa

**Errores fatales (no reintenta):**

- `loggedOut` (401) - Sesion cerrada desde telefono
- `badSession` (500) - Sesion corrupta
- `forbidden` (403) - Cuenta baneada
- `multideviceMismatch` (411) - Version incompatible

**Ejemplo:**

```typescript
await wa.pair(async (data) => {
  if (Buffer.isBuffer(data)) {
    // QR code - guardar o mostrar
    require("fs").writeFileSync("qr.png", data);
  } else {
    // Codigo de 8 digitos
    console.log("Ingresa este codigo:", data);
  }
});
```

---

### `sync(callback?, timeout?)`

```typescript
async sync(callback?: (progress: number) => void, timeout?: number): Promise<void>
```

Espera la sincronizacion del historial.

**Parametros:**

- `callback` - Funcion llamada con el progreso (0-100)
- `timeout` - Tiempo maximo de espera en ms (default: 30000)

**Ejemplo:**

```typescript
await wa.sync((progress) => {
  console.log(`Sincronizando: ${progress}%`);
}, 60000);
```

---

## Eventos

WhatsApp extiende `EventEmitter` con eventos tipados.

### `open`

Emitido cuando la conexion es exitosa.

```typescript
wa.on("open", () => {
  console.log("Conectado a WhatsApp");
});
```

### `close`

Emitido cuando la conexion se cierra.

```typescript
wa.on("close", () => {
  console.log("Desconectado de WhatsApp");
});
```

### `error`

Emitido cuando ocurre un error fatal.

```typescript
wa.on("error", (error: Error) => {
  console.error("Error:", error.message);
});
```

### `progress`

Emitido durante la sincronizacion del historial.

```typescript
wa.on("progress", (percent: number) => {
  console.log(`Progreso: ${percent}%`);
});
```

### `contact:upsert`

Emitido cuando se crea o actualiza un contacto.

```typescript
wa.on("contact:upsert", (contact) => {
  console.log(`Contacto: ${contact.name} (${contact.phone})`);
});
```

### `chat:upsert`

Emitido cuando se crea o actualiza un chat.

```typescript
wa.on("chat:upsert", (chat) => {
  if (chat.type === "group") {
    console.log(`Grupo: ${chat.name}`);
  } else {
    console.log(`Chat individual: ${chat.name}`);
  }
});
```

### `chat:deleted`

Emitido cuando se elimina un chat.

```typescript
wa.on("chat:deleted", (chatId: string) => {
  console.log(`Chat eliminado: ${chatId}`);
});
```

### `message:created`

Emitido cuando se recibe un nuevo mensaje.

```typescript
wa.on("message:created", async (msg) => {
  console.log(`Nuevo mensaje de ${msg.uid}`);

  // Verificar tipo
  if (msg instanceof wa.Message.Text) {
    const text = (await msg.content()).toString();
    console.log(`Texto: ${text}`);
  }
});
```

### `message:status`

Emitido cuando cambia el estado de un mensaje (sent, delivered, read).

```typescript
wa.on("message:status", (msg) => {
  console.log(`Mensaje ${msg.id}: ${msg.status}`);
});
```

### `message:updated`

Emitido cuando se edita un mensaje.

```typescript
wa.on("message:updated", async (msg) => {
  const content = (await msg.content()).toString();
  console.log(`Mensaje editado: ${content}`);
});
```

### `message:deleted`

Emitido cuando se elimina un mensaje.

```typescript
wa.on("message:deleted", ({ cid, mid }) => {
  console.log(`Mensaje eliminado: ${mid} del chat ${cid}`);
});
```

### `message:reaction`

Emitido cuando se reacciona a un mensaje.

```typescript
wa.on("message:reaction", (msg) => {
  console.log(`Reaccion en mensaje ${msg.id}`);
});
```

---

## Patrones comunes

### Bot con comandos

```typescript
const wa = new WhatsApp({ sync: true });

const commands: Record<string, (msg: Message, args: string[]) => Promise<void>> = {
  async ping(msg) {
    const chat = await msg.chat();
    await chat?.text("pong!");
  },
  async hora(msg) {
    const chat = await msg.chat();
    await chat?.text(new Date().toLocaleString());
  },
};

wa.on("message:created", async (msg) => {
  if (msg.me || !(msg instanceof wa.Message.Text)) return;

  const text = (await msg.content()).toString();
  if (!text.startsWith("!")) return;

  const [cmd, ...args] = text.slice(1).split(" ");
  const handler = commands[cmd.toLowerCase()];

  if (handler) {
    await handler(msg, args);
  }
});
```

### Filtrar por chat

```typescript
const ALLOWED_CHATS = [
  "5491112345678@s.whatsapp.net",
  "123456789@g.us",
];

wa.on("message:created", async (msg) => {
  if (!ALLOWED_CHATS.includes(msg.cid)) return;
  // Procesar solo mensajes de chats permitidos
});
```

### Auto-respuesta cuando esta ausente

```typescript
const AWAY_MESSAGE = "Estoy ausente. Respondere pronto.";
const responded = new Set<string>();

wa.on("message:created", async (msg) => {
  if (msg.me) return;

  // Responder solo una vez por chat
  if (responded.has(msg.cid)) return;
  responded.add(msg.cid);

  const chat = await msg.chat();
  await chat?.text(AWAY_MESSAGE);

  // Limpiar despues de 1 hora
  setTimeout(() => responded.delete(msg.cid), 60 * 60 * 1000);
});
```

---

## Interfaz IWhatsApp

```typescript
interface IWhatsApp {
  engine?: Engine;
  phone?: string;
  sync?: boolean;
  online?: boolean;
}
```
