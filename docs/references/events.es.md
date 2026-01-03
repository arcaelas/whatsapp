# Eventos

Referencia completa de todos los eventos emitidos por WhatsApp.

---

## Escuchar eventos

WhatsApp expone un EventEmitter tipado a traves de `wa.event`:

```typescript
import { WhatsApp } from "@arcaelas/whatsapp";

const wa = new WhatsApp();

// Escuchar evento
wa.event.on("message:created", (msg) => {
  // msg esta tipado correctamente
});

// Escuchar una sola vez
wa.event.once("open", () => {
  console.log("Primera conexion exitosa");
});

// Remover listener
const handler = (msg) => console.log(msg);
wa.event.on("message:created", handler);
wa.event.off("message:created", handler);
```

---

## Eventos de conexion

### `open`

Emitido cuando la conexion es exitosa.

```typescript
wa.event.on("open", () => {
  console.log("Conectado a WhatsApp");
  // Aqui puedes empezar a enviar mensajes
});
```

**Payload:** ninguno

---

### `close`

Emitido cuando la conexion se cierra. La reconexion es automatica.

```typescript
wa.event.on("close", () => {
  console.log("Desconectado, reconectando...");
});
```

**Payload:** ninguno

---

### `error`

Emitido cuando ocurre un error fatal que no permite reconexion.

```typescript
wa.event.on("error", (error) => {
  console.error("Error fatal:", error.message);

  // Error comun:
  // - "Logged out" - Sesion cerrada desde telefono
});
```

**Payload:** `Error`

---

## Eventos de contacto

### `contact:created`

Emitido cuando se crea un nuevo contacto.

```typescript
wa.event.on("contact:created", (contact) => {
  console.log(`Nuevo contacto: ${contact.name}`);
  console.log(`  ID: ${contact.id}`);
  console.log(`  Telefono: ${contact.phone}`);
  console.log(`  Es yo: ${contact.me}`);
});
```

**Payload:** `Contact`

---

### `contact:updated`

Emitido cuando se actualiza un contacto existente.

```typescript
wa.event.on("contact:updated", (contact) => {
  console.log(`Contacto actualizado: ${contact.name}`);
});
```

**Payload:** `Contact`

---

## Eventos de chat

### `chat:created`

Emitido cuando se crea un nuevo chat.

```typescript
wa.event.on("chat:created", (chat) => {
  if (chat.type === "group") {
    console.log(`Nuevo grupo: ${chat.name}`);
  } else {
    console.log(`Nuevo chat: ${chat.name}`);
  }
});
```

**Payload:** `Chat`

---

### `chat:updated`

Emitido cuando se actualiza un chat existente.

```typescript
wa.event.on("chat:updated", (chat) => {
  console.log(`Chat actualizado: ${chat.name}`);
});
```

**Payload:** `Chat`

---

### `chat:pined`

Emitido cuando se fija o desfija un chat.

```typescript
wa.event.on("chat:pined", (cid, pined) => {
  if (pined) {
    console.log(`Chat ${cid} fijado en ${new Date(pined)}`);
  } else {
    console.log(`Chat ${cid} desfijado`);
  }
});
```

**Payload:** `(cid: string, pined: number | null)`

---

### `chat:archived`

Emitido cuando se archiva o desarchiva un chat.

```typescript
wa.event.on("chat:archived", (cid, archived) => {
  console.log(`Chat ${cid}: ${archived ? "archivado" : "desarchivado"}`);
});
```

**Payload:** `(cid: string, archived: boolean)`

---

### `chat:muted`

Emitido cuando se silencia o desilencia un chat.

```typescript
wa.event.on("chat:muted", (cid, muted) => {
  if (muted) {
    console.log(`Chat ${cid} silenciado hasta ${new Date(muted)}`);
  } else {
    console.log(`Chat ${cid} desilenciado`);
  }
});
```

**Payload:** `(cid: string, muted: number | null)`

---

### `chat:deleted`

Emitido cuando se elimina un chat.

```typescript
wa.event.on("chat:deleted", (cid) => {
  console.log(`Chat eliminado: ${cid}`);
});
```

**Payload:** `(cid: string)`

---

## Eventos de mensaje

### `message:created`

Emitido cuando se recibe un nuevo mensaje.

```typescript
wa.event.on("message:created", async (msg) => {
  console.log(`Nuevo mensaje:`);
  console.log(`  ID: ${msg.id}`);
  console.log(`  Chat: ${msg.cid}`);
  console.log(`  Tipo: ${msg.type}`);
  console.log(`  Mio: ${msg.me}`);
  console.log(`  Caption: ${msg.caption}`);

  // Obtener contenido
  if (msg.type === "text") {
    const text = (await msg.content()).toString();
    console.log(`  Texto: ${text}`);
  }
});
```

**Payload:** `Message`

**Propiedades disponibles:**

- `id` - ID del mensaje
- `cid` - JID del chat
- `me` - true si es mensaje propio
- `type` - Tipo de mensaje (text, image, video, audio, location, poll)
- `mime` - MIME type
- `caption` - Caption/texto
- `status` - Estado del mensaje (enum)
- `starred` - true si esta destacado
- `forwarded` - true si fue reenviado
- `edited` - true si fue editado

---

### `message:updated`

Emitido cuando se edita un mensaje.

```typescript
wa.event.on("message:updated", async (msg) => {
  console.log(`Mensaje editado: ${msg.id}`);
  console.log(`  edited: ${msg.edited}`); // true

  if (msg.type === "text") {
    const new_text = (await msg.content()).toString();
    console.log(`  Nuevo texto: ${new_text}`);
  }
});
```

**Payload:** `Message`

---

### `message:reacted`

Emitido cuando alguien reacciona a un mensaje.

```typescript
wa.event.on("message:reacted", (cid, mid, emoji) => {
  console.log(`Reaccion en mensaje:`);
  console.log(`  Chat: ${cid}`);
  console.log(`  Mensaje: ${mid}`);
  console.log(`  Emoji: ${emoji}`); // "" si se quito la reaccion
});
```

**Payload:** `(cid: string, mid: string, emoji: string)`

---

### `message:deleted`

Emitido cuando se elimina un mensaje.

```typescript
wa.event.on("message:deleted", (cid, mid) => {
  console.log(`Mensaje eliminado:`);
  console.log(`  Chat: ${cid}`);
  console.log(`  Mensaje: ${mid}`);
});
```

**Payload:** `(cid: string, mid: string)`

---

## Patrones de uso

### Logger completo

```typescript
function setup_logger(wa: WhatsApp) {
  // Conexion
  wa.event.on("open", () => console.log("[INFO] Conectado"));
  wa.event.on("close", () => console.log("[WARN] Desconectado"));
  wa.event.on("error", (e) => console.error("[ERROR]", e.message));

  // Contactos
  wa.event.on("contact:created", (c) =>
    console.log(`[CONTACT:NEW] ${c.name} (${c.phone})`)
  );
  wa.event.on("contact:updated", (c) =>
    console.log(`[CONTACT:UPD] ${c.name}`)
  );

  // Chats
  wa.event.on("chat:created", (c) =>
    console.log(`[CHAT:NEW] ${c.name} (${c.type})`)
  );
  wa.event.on("chat:updated", (c) =>
    console.log(`[CHAT:UPD] ${c.name}`)
  );
  wa.event.on("chat:pined", (cid, p) =>
    console.log(`[CHAT:PIN] ${cid}: ${p ? "fijado" : "desfijado"}`)
  );
  wa.event.on("chat:archived", (cid, a) =>
    console.log(`[CHAT:ARC] ${cid}: ${a ? "archivado" : "desarchivado"}`)
  );
  wa.event.on("chat:muted", (cid, m) =>
    console.log(`[CHAT:MUTE] ${cid}: ${m ? "silenciado" : "desilenciado"}`)
  );
  wa.event.on("chat:deleted", (cid) =>
    console.log(`[CHAT:DEL] ${cid}`)
  );

  // Mensajes
  wa.event.on("message:created", (m) =>
    console.log(`[MSG:NEW] ${m.cid} <- ${m.type}`)
  );
  wa.event.on("message:updated", (m) =>
    console.log(`[MSG:EDIT] ${m.id}`)
  );
  wa.event.on("message:reacted", (cid, mid, emoji) =>
    console.log(`[MSG:REACT] ${mid}: ${emoji}`)
  );
  wa.event.on("message:deleted", (cid, mid) =>
    console.log(`[MSG:DEL] ${mid} from ${cid}`)
  );
}
```

### Filtrar por chat

```typescript
const MONITORED_CHAT = "5491112345678@s.whatsapp.net";

wa.event.on("message:created", async (msg) => {
  if (msg.cid !== MONITORED_CHAT) return;
  // Solo procesar mensajes de este chat
});
```

### Filtrar por tipo

```typescript
wa.event.on("message:created", async (msg) => {
  // Solo imagenes
  if (msg.type !== "image") return;

  const buffer = await msg.content();
  console.log(`Imagen recibida: ${buffer.length} bytes`);
});
```

### Cola de procesamiento

```typescript
const queue: Message[] = [];
let processing = false;

wa.event.on("message:created", (msg) => {
  queue.push(msg);
  process_queue();
});

async function process_queue() {
  if (processing || queue.length === 0) return;

  processing = true;
  const msg = queue.shift()!;

  try {
    await handle_message(msg);
  } catch (error) {
    console.error("Error procesando mensaje:", error);
  }

  processing = false;
  process_queue();
}

async function handle_message(msg: Message) {
  // Procesar mensaje
}
```

### Estadisticas en tiempo real

```typescript
const stats = {
  messages: 0,
  text: 0,
  image: 0,
  video: 0,
  audio: 0,
  location: 0,
  poll: 0,
};

wa.event.on("message:created", (msg) => {
  stats.messages++;
  stats[msg.type as keyof typeof stats]++;

  console.log("Estadisticas:", stats);
});
```

---

## Interfaz WhatsAppEventMap

```typescript
interface WhatsAppEventMap {
  // Conexion
  open: [];
  close: [];
  error: [Error];

  // Contactos
  "contact:created": [Contact];
  "contact:updated": [Contact];

  // Chats
  "chat:created": [Chat];
  "chat:updated": [Chat];
  "chat:pined": [cid: string, pined: number | null];
  "chat:archived": [cid: string, archived: boolean];
  "chat:muted": [cid: string, muted: number | null];
  "chat:deleted": [cid: string];

  // Mensajes
  "message:created": [Message];
  "message:updated": [Message];
  "message:reacted": [cid: string, mid: string, emoji: string];
  "message:deleted": [cid: string, mid: string];
}
```
