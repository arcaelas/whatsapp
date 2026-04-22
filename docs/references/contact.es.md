# Contact

La entidad `Contact` representa a cualquier usuario de WhatsApp del que tu sesión tenga conocimiento, ya sea que haya iniciado un chat, aparezca en un grupo o haya sido descubierto vía lookups `onWhatsApp`. Cada contacto incluye una propiedad eager `chat` apuntando a su instancia `Chat` 1:1, de modo que puedes saltar de "quién" a "dónde" sin lookups adicionales.

`Contact.get(uid)` es el único punto de entrada y despacha según la forma del identificador:

- Teléfono plano (solo dígitos, sin `@`) → resuelto a través de `socket.onWhatsApp(phone)`.
- JID (`<number>@s.whatsapp.net`) → buscado en el motor, refrescado desde el socket si falta.
- LID (`<number>@lid`) → resuelto vía el mapeo persistido LID↔JID.

---

## Importación

```typescript title="imports.ts"
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";
// o
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";
```

Usa el constructor vinculado vía `wa.Contact`. La factory `contact(wa)` (interna) produce una subclase `_Contact` vinculada al contexto de WhatsApp: sobre eso operan los delegados estáticos.

---

## Constructor

Como `Chat`, las instancias de `Contact` no están pensadas para construirse directamente. Provienen de:

- `wa.Contact.get(uid)` — despacho inteligente por teléfono, JID o LID.
- `wa.Contact.list(offset, limit)` — lecturas paginadas.
- `chat.members()` — participantes de grupos.
- Handlers de eventos para `contact:created`/`contact:updated`.
- `msg.author()` — el remitente de un mensaje.

```typescript title="bootstrap.ts"
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new RedisEngine({ url: "redis://127.0.0.1:6379" }),
});

await wa.connect();

// Número de teléfono (solo dígitos)
const byPhone = await wa.Contact.get("5215555555555");

// JID
const byJid = await wa.Contact.get("5215555555555@s.whatsapp.net");

// LID (identificador oculto asignado por WhatsApp)
const byLid = await wa.Contact.get("192837465@lid");

console.log(byPhone?.name, byJid?.phone, byLid?.id);
```

!!! info "¿Por qué el despacho inteligente?"
    WhatsApp expone tres sabores de identificador para el mismo usuario. `Contact.get` los normaliza a través de un resolver interno más una sonda `onWhatsApp` en vivo, de modo que tu código solo pasa strings y recibe un `Contact` normalizado (con un JID válido en `.id`).

---

## Propiedades

Todas las propiedades son getters síncronos sobre la forma interna `_raw: IContactRaw`, excepto `chat`, que se hidrata eagerly en la construcción.

| Propiedad | Tipo | Descripción |
| --------- | ---- | ----------- |
| `id` | `string` | JID canónico (p. ej. `5215555555555@s.whatsapp.net`). |
| `jid` | `string` | Alias de `id`. |
| `lid` | `string \| null` | Identificador de dispositivo vinculado (`@lid`) cuando está disponible. |
| `name` | `string` | Nombre local → push notify → fallback del teléfono. |
| `phone` | `string` | Dígitos antes del `@` en el JID. |
| `photo` | `string \| null` | URL de foto de perfil (cacheada después del primer `refresh`/`get`). |
| `content` | `string` | Texto de estado/bio. |
| `me` | `boolean` | `true` cuando la instancia representa la cuenta autenticada. |
| `chat` | `Chat` | Chat 1:1 eager vinculado a este contacto. |

### `IContactRaw`

```typescript title="IContactRaw.ts"
export interface IContactRaw {
  id: string;
  lid?: string | null;
  name?: string | null;
  notify?: string | null;
  verified_name?: string | null;
  img_url?: string | null;
  status?: string | null;
}
```

### Propiedad eager `chat`

`Contact.chat` no es una función, es una instancia `wa.Chat` completamente construida disponible sincrónicamente. Te permite encadenar llamadas como:

```typescript title="eager-chat.ts"
const contact = await wa.Contact.get("5215555555555");
if (contact) {
  await contact.chat.pin(true);
  await contact.chat.typing(true);
  await wa.Message.text(contact.chat.id, "Ready to go!");
  await contact.chat.typing(false);
}
```

!!! tip "`chat` para grupos"
    Solo los chats 1:1 son descubiertos por `Contact.get`. Los JIDs de grupo (`@g.us`) se filtran; usa `wa.Chat.get(groupJid)` cuando necesites la entidad del grupo.

---

## Métodos

### `rename(name: string)`

Renombra el contacto localmente (solo libreta de direcciones del dispositivo). No se propaga a los servidores de WhatsApp, pero el nuevo valor es visible inmediatamente a través de `.name` y se persiste vía el motor.

```typescript title="rename.ts"
const contact = await wa.Contact.get("5215555555555");
await contact?.rename("Alice Example");
```

Devuelve `true` en caso de éxito, `false` cuando el contacto no puede ser resuelto.

### `refresh()`

Re-hidrata `photo` y `content` (bio/estado) desde el socket en vivo y reescribe el documento del motor. Devuelve `this` en caso de éxito, `null` si no hay socket activo.

```typescript title="refresh.ts"
const contact = await wa.Contact.get("5215555555555@s.whatsapp.net");
await contact?.refresh();
console.log(contact?.photo, contact?.content);
```

!!! info "Hidratación automática"
    `wa.Contact.get(uid)` ya obtiene los datos de perfil la primera vez que se ve un JID. Llama a `refresh()` solo cuando necesites metadatos frescos (p. ej. el usuario actualizó su avatar).

---

## Estáticos (delegado vía `wa.Contact`)

| Delegado | Signatura | Notas |
| -------- | --------- | ----- |
| `wa.Contact.get` | `(uid: string) => Promise<Contact \| null>` | Despacho inteligente: teléfono / JID / LID. |
| `wa.Contact.list` | `(offset?: number, limit?: number) => Promise<Contact[]>` | Contactos persistidos paginados (mtime DESC). Por defecto: `0, 50`. Cada resultado tiene `chat` pre-cargado. |
| `wa.Contact.rename` | `(uid: string, name: string) => Promise<boolean>` | Delega en la instancia `rename`. |
| `wa.Contact.refresh` | `(uid: string) => Promise<Contact \| null>` | Delega en la instancia `refresh`. |

```typescript title="delegates.ts"
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new FileSystemEngine({ path: "./.whatsapp" }),
});

await wa.connect();

// Delegados de una línea
await wa.Contact.rename("5215555555555", "Alice");
await wa.Contact.refresh("5215555555555@s.whatsapp.net");

// Iterar cada contacto
let offset = 0;
while (true) {
  const batch = await wa.Contact.list(offset, 100);
  if (batch.length === 0) break;
  for (const c of batch) {
    console.log(c.phone, c.name, c.photo ?? "(no photo)");
  }
  offset += batch.length;
}
```

---

## Rutas de persistencia

Los registros relacionados con contactos viven bajo las siguientes claves en el motor configurado:

| Ruta | Valor | Escrito por |
| ---- | ----- | ----------- |
| `/contact/{jid}` | `IContactRaw` serializado. | `Contact.get`, `rename`, `refresh`, eventos `contact:*`. |
| `/lid/{lid}` | String JID serializado — índice inverso para resolución de LID. | `Contact.get` cuando se descubre un LID; evento `lid-mapping.update`. |
| `/chat/{jid}` | `IChatRaw` serializado — el `contact.chat` eager se carga desde aquí. | `Chat.get`, persistencia de mensajes, eventos `chats.*`. |

!!! warning "Consistencia del motor"
    Cuando `autoclean` es `true` (por defecto) y se recibe un `loggedOut` remoto, todo el motor se borra para forzar una sincronización fresca en el próximo login. Establece `autoclean: false` en las opciones del constructor de `WhatsApp` si deseas conservar contactos/chats/mensajes entre reautenticaciones.

```typescript title="preserve-data.ts"
import { WhatsApp, RedisEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new RedisEngine({ url: "redis://127.0.0.1:6379" }),
  autoclean: false, // conservar /contact/*, /lid/*, /chat/* entre relogins
});
```
