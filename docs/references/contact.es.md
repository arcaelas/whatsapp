# Contact

Clase para gestionar contactos de WhatsApp.

---

## Importacion

La clase se accede desde la instancia de WhatsApp:

```typescript
const wa = new WhatsApp();
wa.Contact // Clase Contact enlazada
```

---

## Propiedades

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `id` | `string` | JID del contacto (ej: `5491112345678@s.whatsapp.net`) |
| `name` | `string` | Nombre del contacto (name, notify o numero) |
| `phone` | `string` | Numero de telefono sin formato (extraido del JID) |
| `photo` | `string \| null` | URL de la foto de perfil o `null` |
| `content` | `string` | Bio/estado del perfil del contacto (string vacio si no tiene) |

---

## Metodos estaticos

### `Contact.get(uid)`

Obtiene un contacto por su ID o numero de telefono. Si no existe en el engine, verifica con WhatsApp (`onWhatsApp`) y lo crea automaticamente.

Soporta LID: si `uid` termina en `@lid`, resuelve el JID real a traves de la key `lid/{uid}` en el engine antes de buscar el contacto.

```typescript
// Con JID completo
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");

// Solo con numero de telefono
const contact2 = await wa.Contact.get("5491112345678");

// Con LID (Linked ID)
const contact3 = await wa.Contact.get("some-lid@lid");

if (contact) {
  console.log(`Nombre: ${contact.name}`);
  console.log(`Telefono: ${contact.phone}`);
}
```

### `Contact.list(offset?, limit?)`

Obtiene contactos paginados.

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `offset` | `number` | `0` | Posicion inicial |
| `limit` | `number` | `50` | Cantidad maxima de resultados |

```typescript
const contacts = await wa.Contact.list(0, 50);
for (const contact of contacts) {
  console.log(`${contact.name}: ${contact.phone}`);
}
```

---

## Metodos de instancia

### `rename(name)`

Cambia el nombre del contacto (solo local en el engine).

```typescript
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");
if (contact) {
  await contact.rename("Mi mejor amigo");
  console.log(contact.name); // "Mi mejor amigo"
}
```

### `refresh()`

Actualiza la foto de perfil y el estado/bio del contacto desde WhatsApp. Persiste los cambios en el engine.

Retorna `this` si se actualizo correctamente, o `null` si no hay socket conectado.

```typescript
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");
if (contact) {
  await contact.refresh();
  console.log(`Foto actualizada: ${contact.photo}`);
  console.log(`Bio actualizada: ${contact.content}`);
}
```

### `chat()`

Obtiene o crea el chat 1-1 con este contacto.

```typescript
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");
if (contact) {
  const chat = await contact.chat();
  if (chat) {
    console.log(`Chat: ${chat.name} (${chat.type})`);
  }
}
```

---

## Eventos de Contact

Los eventos se escuchan a traves de `wa.event`:

### `contact:created`

Emitido cuando se crea un nuevo contacto.

```typescript
wa.event.on("contact:created", (contact) => {
  console.log(`Nuevo contacto: ${contact.name}`);
  console.log(`  Telefono: ${contact.phone}`);
});
```

### `contact:updated`

Emitido cuando se actualiza un contacto existente.

```typescript
wa.event.on("contact:updated", (contact) => {
  console.log(`Contacto actualizado: ${contact.name}`);
});
```

---

## Ejemplos

### Listar todos los contactos

```typescript
let offset = 0;
const limit = 50;
const all_contacts = [];

while (true) {
  const page = await wa.Contact.list(offset, limit);
  if (page.length === 0) break;
  all_contacts.push(...page);
  offset += limit;
}

console.log(`Total de contactos: ${all_contacts.length}`);
```

### Buscar contacto por nombre

```typescript
async function find_contact_by_name(wa: WhatsApp, name: string) {
  let offset = 0;
  const limit = 50;

  while (true) {
    const contacts = await wa.Contact.list(offset, limit);
    if (contacts.length === 0) break;

    const found = contacts.find(c =>
      c.name.toLowerCase().includes(name.toLowerCase())
    );

    if (found) return found;
    offset += limit;
  }

  return null;
}

const contact = await find_contact_by_name(wa, "Juan");
if (contact) {
  await wa.Message.text(contact.id, "Te encontre!");
}
```

### Mensaje de bienvenida a nuevos contactos

```typescript
wa.event.on("contact:created", async (contact) => {
  await wa.Message.text(
    contact.id,
    "Bienvenido! Soy un bot de asistencia. Escribe !ayuda para ver comandos."
  );
});
```

### Enviar mensaje desde contacto

```typescript
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");
if (contact) {
  // Opcion 1: Usando el chat del contacto
  const chat = await contact.chat();
  // Enviar al chat...

  // Opcion 2: Directamente con el ID del contacto
  await wa.Message.text(contact.id, "Hola desde tu contacto!");
}
```

---

## Interfaz IContactRaw

Objeto raw del contacto almacenado en el engine (protocolo).

```typescript
interface IContactRaw {
  id: string;
  lid?: string | null;
  name?: string | null;
  notify?: string | null;
  verifiedName?: string | null;
  imgUrl?: string | null;
  status?: string | null;
}
```

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `id` | `string` | JID unico del contacto |
| `lid` | `string \| null` | ID alternativo en formato LID |
| `name` | `string \| null` | Nombre guardado en la agenda del usuario |
| `notify` | `string \| null` | Nombre de perfil (pushName) |
| `verifiedName` | `string \| null` | Nombre de cuenta business verificada |
| `imgUrl` | `string \| null` | URL de la foto de perfil |
| `status` | `string \| null` | Bio/estado del perfil |

---

## Notas

> **JID de contacto:** El JID (Jabber ID) de un contacto tiene el formato `{numero}@s.whatsapp.net`. Ejemplo: `5491112345678@s.whatsapp.net`

> **Nombre local:** El nombre del contacto se almacena localmente en el engine. Los cambios con `rename()` solo afectan tu instancia, no lo que otros ven.

> **Verificacion de WhatsApp:** `Contact.get()` verifica con WhatsApp si el numero existe. Si el numero no tiene WhatsApp, retorna `null`.

> **Soporte LID:** `Contact.get()` acepta IDs en formato `@lid` (Linked ID). Estos se resuelven internamente a traves de la key `lid/{lid}` en el engine.
