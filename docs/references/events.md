# Eventos

Referencia completa de todos los eventos emitidos por WhatsApp.

---

## Escuchar eventos

WhatsApp extiende `EventEmitter` con tipado TypeScript:

```typescript
import { WhatsApp } from "@arcaelas/whatsapp";

const wa = new WhatsApp();

// Escuchar evento
wa.on("message:created", (msg) => {
  // msg esta tipado correctamente
});

// Escuchar una sola vez
wa.once("open", () => {
  console.log("Primera conexion exitosa");
});

// Remover listener
const handler = (msg) => console.log(msg);
wa.on("message:created", handler);
wa.off("message:created", handler);
```

---

## Eventos de conexion

### `open`

Emitido cuando la conexion es exitosa.

```typescript
wa.on("open", () => {
  console.log("Conectado a WhatsApp");
  // Aqui puedes empezar a enviar mensajes
});
```

**Payload:** `void`

---

### `close`

Emitido cuando la conexion se cierra.

```typescript
wa.on("close", () => {
  console.log("Desconectado");
  // La reconexion es automatica en la mayoria de casos
});
```

**Payload:** `void`

---

### `error`

Emitido cuando ocurre un error fatal que no permite reconexion.

```typescript
wa.on("error", (error: Error) => {
  console.error("Error fatal:", error.message);

  // Errores comunes:
  // - "Logged out" - Sesion cerrada desde telefono
  // - "Connection replaced" - Otra sesion tomo el control
  // - "Max retries exceeded" - Demasiados intentos de reconexion
});
```

**Payload:** `Error`

---

### `progress`

Emitido durante la sincronizacion del historial.

```typescript
wa.on("progress", (percent: number) => {
  console.log(`Sincronizando: ${percent}%`);

  if (percent === 100) {
    console.log("Sincronizacion completa");
  }
});
```

**Payload:** `number` (0-100)

---

## Eventos de contacto

### `contact:upsert`

Emitido cuando se crea o actualiza un contacto.

```typescript
wa.on("contact:upsert", (contact) => {
  console.log(`Contacto: ${contact.name}`);
  console.log(`  ID: ${contact.id}`);
  console.log(`  Telefono: ${contact.phone}`);
  console.log(`  Foto: ${contact.photo || "Sin foto"}`);
});
```

**Payload:** `Contact` (instancia de la clase Contact)

**Propiedades disponibles:**

- `id` - JID del contacto
- `name` - Nombre en WhatsApp
- `phone` - Numero de telefono
- `photo` - URL de foto o null
- `custom_name` - Nombre personalizado local

---

## Eventos de chat

### `chat:upsert`

Emitido cuando se crea o actualiza un chat.

```typescript
wa.on("chat:upsert", (chat) => {
  if (chat.type === "group") {
    console.log(`Grupo: ${chat.name}`);
  } else {
    console.log(`Chat: ${chat.name}`);
  }
});
```

**Payload:** `Chat`

**Propiedades disponibles:**

- `id` - JID del chat
- `name` - Nombre del chat/grupo
- `photo` - URL de foto o null
- `phone` - Numero (null en grupos)
- `type` - `"contact"` o `"group"`

---

### `chat:deleted`

Emitido cuando se elimina un chat.

```typescript
wa.on("chat:deleted", (chatId: string) => {
  console.log(`Chat eliminado: ${chatId}`);
});
```

**Payload:** `string` (JID del chat)

---

## Eventos de mensaje

### `message:created`

Emitido cuando se recibe un nuevo mensaje.

```typescript
wa.on("message:created", async (msg) => {
  console.log(`Nuevo mensaje:`);
  console.log(`  ID: ${msg.id}`);
  console.log(`  Chat: ${msg.cid}`);
  console.log(`  Autor: ${msg.uid}`);
  console.log(`  Tipo: ${msg.type}`);
  console.log(`  Mio: ${msg.me}`);
  console.log(`  Fecha: ${msg.created_at}`);

  // Verificar tipo
  if (msg instanceof wa.Message.Text) {
    const text = (await msg.content()).toString();
    console.log(`  Texto: ${text}`);
  }
});
```

**Payload:** `Message` (o subclases: Text, Image, Video, Audio, Location, Poll)

**Propiedades disponibles:**

- `id` - ID del mensaje
- `cid` - JID del chat
- `uid` - JID del autor
- `mid` - ID del mensaje citado (o null)
- `type` - Tipo de mensaje
- `mime` - MIME type
- `caption` - Caption/descripcion
- `me` - true si es mensaje propio
- `status` - Estado del mensaje
- `created_at` - Fecha ISO
- `edited` - true si fue editado

---

### `message:status`

Emitido cuando cambia el estado de un mensaje.

```typescript
wa.on("message:status", (msg) => {
  console.log(`Mensaje ${msg.id}: ${msg.status}`);
  // Estados: pending, sent, delivered, read
});
```

**Payload:** `Message`

**Estados posibles:**

| Estado | Descripcion |
|--------|-------------|
| `pending` | Enviando |
| `sent` | Enviado (un check) |
| `delivered` | Entregado (dos checks) |
| `read` | Leido (checks azules) |

---

### `message:updated`

Emitido cuando se edita un mensaje.

```typescript
wa.on("message:updated", async (msg) => {
  console.log(`Mensaje editado: ${msg.id}`);
  console.log(`  edited: ${msg.edited}`); // true

  if (msg instanceof wa.Message.Text) {
    const newText = (await msg.content()).toString();
    console.log(`  Nuevo texto: ${newText}`);
  }
});
```

**Payload:** `Message`

---

### `message:deleted`

Emitido cuando se elimina un mensaje.

```typescript
wa.on("message:deleted", ({ cid, mid }) => {
  console.log(`Mensaje eliminado:`);
  console.log(`  Chat: ${cid}`);
  console.log(`  Mensaje: ${mid}`);
});
```

**Payload:** `{ cid: string; mid: string }`

---

### `message:reaction`

Emitido cuando alguien reacciona a un mensaje.

```typescript
wa.on("message:reaction", async (msg) => {
  console.log(`Reaccion en mensaje ${msg.id}`);

  // El contenido del mensaje no cambia
  // pero puedes detectar que hubo actividad
});
```

**Payload:** `Message`

---

## Patrones de uso

### Logger completo

```typescript
function setupLogger(wa: WhatsApp) {
  wa.on("open", () => console.log("[INFO] Conectado"));
  wa.on("close", () => console.log("[WARN] Desconectado"));
  wa.on("error", (e) => console.error("[ERROR]", e.message));
  wa.on("progress", (p) => console.log(`[SYNC] ${p}%`));

  wa.on("contact:upsert", (c) =>
    console.log(`[CONTACT] ${c.name} (${c.phone})`)
  );

  wa.on("chat:upsert", (c) =>
    console.log(`[CHAT] ${c.name} (${c.type})`)
  );

  wa.on("chat:deleted", (id) =>
    console.log(`[CHAT] Eliminado: ${id}`)
  );

  wa.on("message:created", (m) =>
    console.log(`[MSG:NEW] ${m.uid} -> ${m.cid}: ${m.type}`)
  );

  wa.on("message:status", (m) =>
    console.log(`[MSG:STATUS] ${m.id}: ${m.status}`)
  );

  wa.on("message:updated", (m) =>
    console.log(`[MSG:EDIT] ${m.id}`)
  );

  wa.on("message:deleted", ({ cid, mid }) =>
    console.log(`[MSG:DEL] ${mid} from ${cid}`)
  );

  wa.on("message:reaction", (m) =>
    console.log(`[MSG:REACT] ${m.id}`)
  );
}
```

### Filtrar por chat

```typescript
const MONITORED_CHAT = "5491112345678@s.whatsapp.net";

wa.on("message:created", async (msg) => {
  if (msg.cid !== MONITORED_CHAT) return;
  // Solo procesar mensajes de este chat
});
```

### Filtrar por tipo

```typescript
wa.on("message:created", async (msg) => {
  // Solo imagenes
  if (!(msg instanceof wa.Message.Image)) return;

  const buffer = await msg.content();
  console.log(`Imagen recibida: ${buffer.length} bytes`);
});
```

### Cola de procesamiento

```typescript
const queue: Message[] = [];
let processing = false;

wa.on("message:created", (msg) => {
  queue.push(msg);
  processQueue();
});

async function processQueue() {
  if (processing || queue.length === 0) return;

  processing = true;
  const msg = queue.shift()!;

  try {
    // Procesar mensaje
    await handleMessage(msg);
  } catch (error) {
    console.error("Error procesando mensaje:", error);
  }

  processing = false;
  processQueue();
}
```

### Estadisticas en tiempo real

```typescript
const stats = {
  messages: 0,
  images: 0,
  videos: 0,
  audios: 0,
  locations: 0,
  polls: 0,
};

wa.on("message:created", (msg) => {
  stats.messages++;

  switch (msg.type) {
    case "image": stats.images++; break;
    case "video": stats.videos++; break;
    case "audio": stats.audios++; break;
    case "location": stats.locations++; break;
    case "poll": stats.polls++; break;
  }

  console.log(`Estadisticas:`, stats);
});
```

---

## Interfaz WhatsAppEventMap

```typescript
interface WhatsAppEventMap {
  open: void;
  close: void;
  error: Error;
  progress: number;
  "contact:upsert": Contact;
  "chat:upsert": Chat;
  "chat:deleted": string;
  "message:created": Message;
  "message:status": Message;
  "message:updated": Message;
  "message:deleted": { cid: string; mid: string };
  "message:reaction": Message;
}
```
