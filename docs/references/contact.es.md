# Contact

La entidad `Contact` es una **ficha mínima** derivada del documento crudo del contacto: quién es la
persona (`name`), cómo dirigirse a ella (`phone`, `jid`, `lid`) y qué aspecto tiene (`photo`). Cada
valor es un getter síncrono sobre `_raw`; nada se busca de forma perezosa a tus espaldas.

`Contact.get(uid)` es el único punto de entrada y despacha según la forma del identificador:

- Teléfono plano (solo dígitos, sin `@`) → se normaliza a `<dígitos>@s.whatsapp.net`.
- JID (`<number>@s.whatsapp.net`) → se resuelve y se lee del motor.
- LID (`<number>@lid`) → se resuelve por el índice LID↔JID persistido, o por el mapeo de LID de
  baileys cuando el índice todavía no tiene la entrada.

Los JID de grupo (`@g.us`) se descartan — para esos usa [`wa.Chat.get(groupId)`](chat.es.md).

---

## Importación

```typescript title="imports.ts"
import { WhatsApp, Contact, FileSystemEngine } from "@arcaelas/whatsapp";
```

Rara vez construyes contactos a mano: usa `wa.Contact`, la subclase vinculada a la sesión que
produce la factory interna `contact(wa)`. La clase `Contact` exportada lleva solo los getters.

!!! warning "Tipar tus propios helpers"
    `chat()` vive en la subclase vinculada, así que un parámetro anotado con el `Contact` exportado
    no lo verá. Deriva el tipo correcto en su lugar:

    ```typescript
    import type { WhatsApp } from '@arcaelas/whatsapp';

    type Person = InstanceType<WhatsApp['Contact']>;

    async function open(person: Person) {
      const chat = await person.chat(); // disponible
    }
    ```

---

## De dónde salen las instancias

- `wa.Contact.get(uid)` — despacho por teléfono, JID o LID.
- `wa.Contact.list(offset, limit)` — lecturas paginadas.
- `chat.members(offset, limit)` — participantes de un chat.
- `msg.author()` — el remitente de un mensaje.
- `wa.contact` — la propia cuenta autenticada.
- Payloads de los eventos `contact:created` / `contact:updated`.

```typescript title="bootstrap.ts"
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({ engine: new FileSystemEngine("./.whatsapp") });

await wa.connect((auth) => console.log(auth));

// Número de teléfono (solo dígitos)
const by_phone = await wa.Contact.get("5215555555555");

// JID
const by_jid = await wa.Contact.get("5215555555555@s.whatsapp.net");

// LID (identificador oculto asignado por WhatsApp)
const by_lid = await wa.Contact.get("192837465@lid");

console.log(by_phone?.name, by_jid?.phone, by_lid?.lid);
```

!!! info "¿Por qué el despacho?"
    WhatsApp expone varios sabores de identificador para el mismo usuario. `Contact.get` los
    normaliza a través del resolver interno del cliente, de modo que tu código solo pasa strings (o
    números) y recibe siempre un `Contact` normalizado.

---

## Propiedades

Todas las propiedades son getters síncronos sobre el documento interno `_raw`.

| Propiedad | Tipo | Descripción |
| --------- | ---- | ----------- |
| `name` | `string` | Nombre de agenda → nombre público → nombre verificado → teléfono → el id sin su dominio. |
| `phone` | `string \| null` | Dígitos del **JID PN únicamente**, nunca derivados del LID. `null` si no hay JID determinable. |
| `jid` | `string \| null` | JID legado (`@s.whatsapp.net`) reportado por baileys o derivado del id. `null` si no se puede deducir. |
| `lid` | `string \| null` | LID (`@lid`) cuando es definible, `null` si no. |
| `photo` | `string \| null` | URL de la foto de perfil; `null` si falta o no es una URL `http` (baileys reporta `changed` al rotarla). |

!!! warning "No existen los getters `id`, `me` ni `content`"
    Un contacto expone exactamente las cinco propiedades de arriba más `chat()`. El documento
    persistido está en `_raw` (`id`, `lid`, `phone_number`, `name`, `notify`, `verified_name`,
    `img_url`, `status`), pero es interno: prefiere los getters. La bio (`status`) se alcanza con
    [`chat.content()`](chat.es.md#content) sobre el chat 1:1.

```typescript title="properties.ts"
const person = await wa.Contact.get("5215555555555");

if (person) {
  console.log(person.name);   // 'Alice' | '5215555555555'
  console.log(person.phone);  // '5215555555555' | null
  console.log(person.jid);    // '5215555555555@s.whatsapp.net' | null
  console.log(person.lid);    // '192837465@lid' | null
  console.log(person.photo);  // 'https://pps.whatsapp.net/…' | null
}
```

---

## Métodos

### `chat()`

```typescript
chat(): Promise<Chat>
```

Resuelve el `Chat` 1:1 del contacto: el documento persistido en el motor, o una instancia mínima
construida al vuelo cuando la conversación todavía no existe. Es asíncrono porque la búsqueda pasa
por el motor.

```typescript title="contact-chat.ts"
const person = await wa.Contact.get("5215555555555");

if (person) {
  const chat = await person.chat();
  await chat.typing(true);
  await wa.Message.text(chat.id, "¡Listo!");
  await chat.typing(false);
}
```

!!! tip "Los grupos no son contactos"
    `Contact.get` filtra los identificadores `@g.us`. Para llegar a un grupo, llama a
    `wa.Chat.get(groupId)` y usa `chat.members()` para hidratar sus participantes como contactos.

---

## Estáticos (vía `wa.Contact`)

| Estático | Firma | Notas |
| -------- | ----- | ----- |
| `wa.Contact.get` | `(uid: string \| number) => Promise<Contact \| null>` | Primero el motor; si no está persistido, lo descubre por red y materializa el documento. |
| `wa.Contact.list` | `(offset?: number, limit?: number) => Promise<Contact[]>` | Contactos persistidos paginados, del más reciente al más antiguo. Por defecto: `0, 50`. |

### Descubrimiento en `get`

Cuando el motor no tiene el documento `/contact/<jid>` y el socket está arriba, `get` consulta la
red:

1. `onWhatsApp(phone)` — verifica que la cuenta existe y devuelve su JID canónico (y el LID).
2. `profilePictureUrl(jid)` — completa `img_url`.
3. `fetchStatus(jid)` — completa la bio.
4. Escribe `/contact/<jid>` y, si vino un LID, la entrada de índice `/lid/<lid>`.

Devuelve `null` cuando el identificador no se puede resolver o el número no está en WhatsApp.

```typescript title="statics.ts"
// Recorre todos los contactos persistidos
let offset = 0;

while (true) {
  const batch = await wa.Contact.list(offset, 100);
  if (batch.length === 0) {
    break;
  }
  for (const person of batch) {
    console.log(person.phone, person.name, person.photo ?? "(sin foto)");
  }
  offset += batch.length;
}
```

---

## Rutas de persistencia

Los registros relacionados con contactos viven bajo estas claves en el motor configurado:

| Ruta | Valor | Escrito por |
| ---- | ----- | ----------- |
| `/contact/<id>` | Documento del contacto serializado. | `contacts.upsert` / `contacts.update`, mensajes entrantes, `Contact.get`. |
| `/lid/<lid>` | String JID serializado — índice directo para resolver LIDs. | `Contact.get`, upserts de contacto, `lid-mapping.update`. |
| `/lid/<pn>` | String LID serializado — índice inverso. | `lid-mapping.update`. |
| `/chat/<id>` | Documento del chat; `chat()` se hidrata desde aquí. | Eventos `chats.*`, mensajes entrantes. |

!!! warning "Consistencia del motor"
    Cuando `autoclean` es `true` (por defecto) y llega un `loggedOut` remoto, el motor completo se
    vacía para forzar un sync limpio en el próximo login. Configura `autoclean: false` en el
    constructor de `WhatsApp` si quieres conservar contactos, chats y mensajes entre
    reautenticaciones.

```typescript title="preserve-data.ts"
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new FileSystemEngine("./.whatsapp"),
  autoclean: false, // conserva /contact/*, /lid/*, /chat/* entre relogins
});
```
