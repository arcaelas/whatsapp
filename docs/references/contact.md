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
| `me` | `boolean` | `true` si es el usuario autenticado |
| `name` | `string` | Nombre del contacto |
| `phone` | `string \| null` | Numero de telefono |
| `photo` | `string \| null` | URL de la foto de perfil o `null` |

---

## Metodos estaticos

### `Contact.get(uid)`

Obtiene un contacto por su ID o numero de telefono. Si no existe en el engine, verifica con WhatsApp (`onWhatsApp`) y lo crea automaticamente.

```typescript
// Con JID completo
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");

// O solo con numero de telefono
const contact2 = await wa.Contact.get("5491112345678");

if (contact) {
  console.log(`Nombre: ${contact.name}`);
  console.log(`Telefono: ${contact.phone}`);
  console.log(`Es yo: ${contact.me}`);
}
```

### `Contact.rename(uid, name)`

Cambia el nombre de un contacto (solo local).

```typescript
await wa.Contact.rename("5491112345678@s.whatsapp.net", "Cliente VIP");
```

### `Contact.paginate(offset, limit)`

Obtiene contactos paginados.

```typescript
const contacts = await wa.Contact.paginate(0, 50);
for (const contact of contacts) {
  console.log(`${contact.name}: ${contact.phone}`);
}
```

---

## Metodos de instancia

### `rename(name)`

Cambia el nombre del contacto (solo local).

```typescript
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");
if (contact) {
  await contact.rename("Mi mejor amigo");
  console.log(contact.name); // "Mi mejor amigo"
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
  const page = await wa.Contact.paginate(offset, limit);
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
    const contacts = await wa.Contact.paginate(offset, limit);
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
  // Evitar enviarse mensaje a si mismo
  if (contact.me) return;

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

## Interfaz IContact

```typescript
interface IContact {
  id: string;
  me: boolean;
  name: string;
  phone: string | null;
  photo: string | null;
}
```

---

## Notas

!!! info "JID de contacto"
    El JID (Jabber ID) de un contacto tiene el formato `{numero}@s.whatsapp.net`.
    Ejemplo: `5491112345678@s.whatsapp.net`

!!! warning "Nombre local"
    El nombre del contacto se almacena localmente en el engine.
    Los cambios con `rename()` solo afectan tu instancia, no lo que otros ven.

!!! tip "Verificacion de WhatsApp"
    `Contact.get()` verifica con WhatsApp si el numero existe.
    Si el numero no tiene WhatsApp, retorna `null`.
