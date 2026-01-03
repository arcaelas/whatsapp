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
| `name` | `string` | Nombre del contacto en WhatsApp |
| `phone` | `string` | Numero de telefono |
| `custom_name` | `string` | Nombre personalizado local |

---

## Metodos estaticos

### `Contact.me()`

Obtiene el contacto del usuario actual (yo).

```typescript
const me = await wa.Contact.me();
if (me) {
  console.log(`Mi numero: ${me.phone}`);
  console.log(`Mi nombre: ${me.name}`);
}
```

### `Contact.get(uid)`

Obtiene un contacto por su ID o numero de telefono. Si no existe en el engine, intenta verificar con WhatsApp (`onWhatsApp`) y lo crea automaticamente.

```typescript
// Con JID completo
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");

// O solo con numero de telefono
const contact2 = await wa.Contact.get("5491112345678");

if (contact) {
  console.log(`Nombre: ${contact.name}`);
  console.log(`Telefono: ${contact.phone}`);
}
```

### `Contact.paginate(offset, limit)`

Obtiene contactos paginados.

```typescript
const contacts = await wa.Contact.paginate(0, 50);
for (const contact of contacts) {
  console.log(`${contact.name}: ${contact.phone}`);
}
```

### `Contact.rename(uid, name)`

Cambia el nombre personalizado de un contacto (solo local).

```typescript
await wa.Contact.rename("5491112345678@s.whatsapp.net", "Cliente VIP");
```

---

## Metodos de instancia

### `rename(name)`

Cambia el nombre personalizado del contacto.

```typescript
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");
if (contact) {
  await contact.rename("Mi mejor amigo");
  console.log(contact.custom_name); // "Mi mejor amigo"
}
```

### `chat()`

Obtiene o crea el chat 1-1 con este contacto.

```typescript
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");
if (contact) {
  const chat = await contact.chat();
  if (chat) {
    await wa.Message.Message.text(chat.id, "Hola desde tu contacto!");
  }
}
```

### `photo(type?)`

Obtiene la URL de la foto de perfil del contacto desde WhatsApp.

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `type` | `'preview' \| 'image'` | `'preview'` | `'preview'` para miniatura, `'image'` para alta resolucion |

```typescript
const contact = await wa.Contact.get("5491112345678@s.whatsapp.net");
if (contact) {
  // Obtener miniatura
  const thumbnail = await contact.photo();
  console.log(`Miniatura: ${thumbnail}`);

  // Obtener imagen en alta resolucion
  const fullImage = await contact.photo("image");
  console.log(`Imagen HD: ${fullImage}`);
}
```

---

## Eventos

### `contact:upsert`

Emitido cuando se crea o actualiza un contacto.

```typescript
wa.on("contact:upsert", async (contact) => {
  console.log(`Contacto actualizado: ${contact.name}`);
  console.log(`  Telefono: ${contact.phone}`);
  const foto = await contact.photo();
  console.log(`  Foto: ${foto || "Sin foto"}`);
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
async function findContactByName(name: string) {
  let offset = 0;
  const limit = 50;

  while (true) {
    const contacts = await wa.Contact.paginate(offset, limit);
    if (contacts.length === 0) break;

    const found = contacts.find(c =>
      c.name.toLowerCase().includes(name.toLowerCase()) ||
      c.custom_name.toLowerCase().includes(name.toLowerCase())
    );

    if (found) return found;
    offset += limit;
  }

  return null;
}

const contact = await findContactByName("Juan");
if (contact) {
  await wa.Message.Message.text(contact.id, "Te encontre!");
}
```

### Enviar mensaje a contacto desde evento

```typescript
wa.on("contact:upsert", async (contact) => {
  // Solo nuevos contactos
  if (!contact.custom_name) {
    await wa.Message.Message.text(contact.id, "Bienvenido! Soy un bot de asistencia.");
  }
});
```

### Obtener autor de un mensaje

```typescript
wa.on("message:created", async (msg) => {
  if (msg.me) return;

  const author = await msg.author();
  if (author) {
    console.log(`Mensaje de ${author.name} (${author.phone})`);
  }
});
```

### Sincronizar contactos con base de datos externa

```typescript
interface ExternalContact {
  phone: string;
  name: string;
  tags: string[];
}

async function syncWithExternalDB(db: ExternalContact[]) {
  const contacts = await wa.Contact.paginate(0, 1000);

  for (const contact of contacts) {
    const external = db.find(c => c.phone === contact.phone);
    if (external) {
      // Actualizar nombre local con tags
      const newName = `${contact.name} [${external.tags.join(", ")}]`;
      await contact.rename(newName);
    }
  }
}
```

---

## Notas

!!! info "JID de contacto"
    El JID (Jabber ID) de un contacto tiene el formato `{numero}@s.whatsapp.net`.
    Ejemplo: `5491112345678@s.whatsapp.net`

!!! warning "Nombre personalizado"
    El `custom_name` es solo local y no afecta el nombre que otros ven.
    Se almacena en el engine de persistencia.

!!! tip "Foto de perfil"
    La URL retornada por `photo()` puede expirar. Si necesitas la imagen, descargala y almacenala.

---

## Interfaz IContact

```typescript
interface IContact {
  id: string;
  name: string;
  phone: string;
  custom_name: string;
}
```
