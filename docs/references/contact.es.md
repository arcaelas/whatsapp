# Contact

La entidad `Contact` es una **ficha mínima** sobre el documento del contacto que entrega baileys.
Quién es la persona (`name`), cómo dirigirse a ella (`id`, `phone`) y qué dice su biografía
(`content()`) son lecturas síncronas de ese documento; la foto ([`photo()`](#photo-photovalue)) y los
catálogos ([`catalog()`](#catalog)) salen a la red. Las acciones de chat —bloquear, silenciar,
fijar, archivar, marcar leído— viven en [`Chat`](chat.es.md): `await person.chat()` lo abre.
`Contact` extiende `Sender`, así `person.text('hola')` y los demás [envíos](message.es.md#envios),
`typing()` y `recording()` van a su chat 1:1.

`Contact.get(uid)` es el único punto de entrada y despacha según la forma del identificador:

- Teléfono plano (solo dígitos, sin `@`) → se normaliza a `<dígitos>@s.whatsapp.net`.
- JID (`<number>@s.whatsapp.net`) → se resuelve y se lee del motor.
- LID (`<number>@lid`) → se resuelve por el índice LID↔JID persistido, o por el mapeo de LID de
  baileys cuando el índice todavía no tiene la entrada.

Los JID de grupo (`@g.us`) devuelven `null` — para esos usa [`wa.Chat.get(group_id)`](chat.es.md).

---

## Importación

```typescript title="imports.ts"
import { WhatsApp, FileSystemEngine, type Contact } from '@arcaelas/whatsapp';
```

`Contact` se exporta como tipo. La clase es `wa.Contact`, que la sesión construye con la factory
`contact` —el export por defecto de `src/lib/contact.ts`, publicado como `contact`— al conectar: úsala para construir un contacto (`new wa.Contact(raw)`) y para
`instanceof`.

!!! tip "Tipar tus propios helpers"
    El tipo `Contact` exportado es la instancia de `wa.Contact`, con todos sus getters y métodos, así
    que sirve para anotar tus propios parámetros:

    ```typescript
    import type { Contact } from '@arcaelas/whatsapp';

    async function open(person: Contact) {
        const chat = await person.chat();   // disponible
    }
    ```

---

## De dónde salen las instancias

- `wa.Contact.get(uid)` — despacho por teléfono, JID o LID.
- `wa.Contact.list(offset, limit)` — lecturas paginadas.
- `new wa.Contact(raw)` — a partir de un documento `Contact` de baileys.
- `chat.members(offset, limit)` — participantes de un chat.
- `msg.author()` — el remitente de un mensaje.
- `await wa.me()` — la propia cuenta.
- Payloads de los eventos `contact:created` / `contact:updated`.

```typescript title="bootstrap.ts"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({ engine: new FileSystemEngine('./.whatsapp') });

await wa.connect((auth) => console.log(auth));

// Número de teléfono (solo dígitos)
const by_phone = await wa.Contact.get('5215555555555');

// JID
const by_jid = await wa.Contact.get('5215555555555@s.whatsapp.net');

// LID (identificador oculto asignado por WhatsApp)
const by_lid = await wa.Contact.get('192837465@lid');

console.log(by_phone?.name, by_jid?.phone, by_lid?.id);
```

!!! info "¿Por qué el despacho?"
    WhatsApp expone varios sabores de identificador para el mismo usuario. `Contact.get` los
    normaliza a través del resolver interno del cliente, de modo que tu código solo pasa strings (o
    números) y recibe siempre un `Contact` normalizado.

---

## Propiedades

Todas las propiedades son getters síncronos sobre el documento guardado.

| Propiedad | Tipo             | Descripción                                                                              |
| --------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `id`      | `string`         | El LID (`@lid`) cuando se conoce; si no, el JID (`@s.whatsapp.net`).                     |
| `name`    | `string`         | Nombre de agenda → nombre público → nombre verificado → teléfono → el id sin su dominio. |
| `phone`   | `string \| null` | Dígitos del JID. `null` mientras el contacto sólo se conoce por un LID sin mapear.       |
| `me`      | `boolean`        | `true` cuando el contacto es la propia cuenta, comparando por JID y por LID.             |
| `seen`    | `string \| null` | Última conexión en ISO, tal como la entregó su presencia; `null` hasta que llega o si la privacidad la oculta. |

!!! info "El documento queda privado"
    El documento guardado es el `Contact` de baileys (`id`, `lid`, `phoneNumber`, `name`, `notify`,
    `verifiedName`, `imgUrl`, `status`) y la instancia lo guarda en un campo privado: los getters y
    los métodos son la forma de leerlo.

```typescript title="properties.ts"
const person = await wa.Contact.get('5215555555555');

if (person) {
    console.log(person.id);       // '192837465@lid' | '5215555555555@s.whatsapp.net'
    console.log(person.name);     // 'Alice' | '5215555555555'
    console.log(person.phone);    // '5215555555555' | null
}
```

---

## Métodos

### `content()` / `content(value)`

```typescript
content(): string
content(value: string): Promise<string>
```

Sin argumento, la biografía guardada, leída de forma síncrona. WhatsApp no avisa cuando alguien
cambia su biografía, así que la librería la lee al crear el contacto —de fondo, de a 100 por
consulta, y emite `contact:updated` cuando llega— y cuando `wa.Contact.get` lo descubre. Es `''`
tanto si el contacto no tiene como si su privacidad la oculta.

Con texto cambia la biografía de la cuenta misma, la guarda y la devuelve; en cualquier otro
contacto rechaza con `ERR_NOT_ALLOWED`.

```typescript title="content.ts"
console.log(person.content());         // 'Available' | ''

const me = await wa.me();
await me?.content('Abierto 9-18h');    // escribe la biografía propia
await person.content('Hola');          // rechaza con ERR_NOT_ALLOWED
```

### `photo()` / `photo(value)`

```typescript
photo(value?: Buffer | null): Promise<Buffer>
```

Sin argumento, la foto de perfil vigente. La URL se pide a WhatsApp en cada llamada —el aviso de
cambio no llega a todas las cuentas— y el binario se guarda bajo `/contact/<id>/photo`, así sólo se
descarga de nuevo cuando la foto cambia. Sin foto, o si la privacidad del contacto la oculta,
devuelve un Buffer vacío; sin red, la última guardada.

Con un Buffer cambia la foto de la cuenta misma, y `null` la quita; devuelve la foto resultante. En
cualquier otro contacto rechaza con `ERR_NOT_ALLOWED`, y rechaza con `ERR_PROFILE_PICTURE_LIB`
cuando no está instalado ni `sharp` ni `jimp`.

```typescript title="photo.ts"
const picture = await person.photo();
if (picture.length) await writeFile('./avatar.jpg', picture);

await me?.photo(await readFile('./logo.jpg'));   // la foto propia
await me?.photo(null);                           // la quita
```

### `catalog()`

```typescript
catalog(): Promise<Catalog[]>
```

Los catálogos de productos del negocio como instancias de [`Catalog`](catalog.es.md): uno por
colección o, si el negocio no tiene colecciones, uno solo con todos los productos, el teléfono como
`id` y `name` vacío, así siempre hay al menos uno. Un contacto sin catálogo devuelve ese único sin
productos, y un contacto sin teléfono conocido devuelve un arreglo vacío.

- La primera lectura descarga las colecciones y el catálogo completo en paralelo, cada consulta con
  un tope de 20 segundos, y los guarda en el motor.
- Las lecturas siguientes salen del motor. Cuando una descarga guardada tiene más de 24 horas, se
  devuelven los catálogos guardados y se refrescan de fondo; cada catálogo que cambió emite
  [`catalog:updated`](events.es.md#catalogos).

```typescript title="catalog.ts"
for (const catalog of await person.catalog()) {
    for (const item of await catalog.products(0, 10)) {
        console.log(catalog.name, item.name, item.price, item.currency);
    }
}
```

### `chat()`

```typescript
chat(): Promise<Chat>
```

Resuelve el `Chat` 1:1 del contacto: el documento persistido en el motor, o una instancia mínima
armada en el momento cuando la conversación todavía no existe. Bloquear, silenciar, fijar, archivar
y marcar leído se hacen sobre él.

```typescript title="contact-chat.ts"
const chat = await person.chat();
await chat.blocked(true);
await wa.Message.text(chat.id, '¡Listo!');
```

!!! tip "Los grupos no son contactos"
    `Contact.get` filtra los identificadores `@g.us`. Para llegar a un grupo, llama a
    `wa.Chat.get(group_id)` y usa `chat.members()` para hidratar a sus participantes como contactos.

### `sub(handler)`

```typescript
sub(handler: (event: { name: 'created' | 'updated' | 'deleted' | 'online' | 'offline' | 'typing' | 'recording'; payload: Contact }) => void): () => void
```

Se suscribe a todo lo que le pasa al contacto, ya filtrado a esta persona: `created`, `updated` y
`deleted` siguen a los eventos `contact:*`, y `online`, `offline`, `typing` y `recording` siguen a su
presencia. Cuando el contacto deja de escribir o de grabar, WhatsApp lo reporta como `online`. Con
`offline` llega su última conexión, en [`seen`](#propiedades). La suscripción a la presencia se pide
a WhatsApp de fondo; devuelve la función que desuscribe.

```typescript title="sub.ts"
const stop = person.sub(({ name, payload }) => console.log(payload.name, name, payload.seen ?? ''));
setTimeout(stop, 60_000);
```

!!! info "La presencia necesita la cuenta en línea"
    WhatsApp sólo envía la presencia a una cuenta que se anunció con
    `(await wa.me())?.online(true)`, y deja de enviarla al reconectar el socket, así que llama a
    `sub()` de nuevo en cada `connected`.

### `metadata()`

```typescript
metadata(): Promise<Record<string, unknown>>
metadata(key: string): Promise<unknown>
metadata(key: string, value: unknown): Promise<Record<string, unknown>>
metadata(patch: Record<string, unknown>): Promise<Record<string, unknown>>
```

Valores de tu integración ligados al contacto. Sin argumentos devuelve todos; con una clave, su
valor o `null`; con clave y valor, o con un objeto, los fusiona y devuelve el resultado, y un valor
`null` borra la clave. Viven en el motor bajo `/contact/<id>/metadata` y WhatsApp nunca los ve, así
que se pierden al cambiar de motor o al resincronizar; cuando no queda nada, el documento se borra.

```typescript title="metadata.ts"
await person.metadata('edad', 18);           // { edad: 18 }
await person.metadata({ ciudad: 'Lima' });   // { edad: 18, ciudad: 'Lima' }
await person.metadata('edad');               // 18
await person.metadata('año');                // null
await person.metadata('edad', null);         // { ciudad: 'Lima' }
```

---

## Estáticos (vía `wa.Contact`)

| Estático          | Firma                                                     | Notas                                                                                     |
| ----------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `wa.Contact.get`  | `(uid: string \| number) => Promise<Contact \| null>`     | Primero el motor; si no está persistido, lo descubre por red y materializa el documento.  |
| `wa.Contact.list` | `(offset?: number, limit?: number) => Promise<Contact[]>` | Contactos persistidos paginados, del más reciente al más antiguo. Por defecto: `0, 50`.   |

### Descubrimiento en `get`

Cuando el motor no tiene el documento `/contact/<jid>` y el socket está arriba, `get` consulta la
red:

1. `onWhatsApp(phone)` — verifica que la cuenta existe y devuelve su JID canónico (y el LID).
2. `fetchStatus(jid)` — lee la biografía.
3. Escribe `/contact/<jid>` y, si vino un LID, las entradas de índice `/lid/<lid>` y `/lid/<jid>`.

Devuelve `null` cuando el identificador no se puede resolver o el número no está en WhatsApp. El
descubrimiento también lee la biografía, así `content()` la tiene desde la primera instancia. Un
nombre público nuevo llega con el siguiente mensaje del contacto y emite `contact:updated`.

```typescript title="statics.ts"
// Recorre todos los contactos persistidos
let offset = 0;

while (true) {
    const batch = await wa.Contact.list(offset, 100);
    if (batch.length === 0) {
        break;
    }
    for (const person of batch) {
        console.log(person.phone, person.name);
    }
    offset += batch.length;
}
```

---

## El perfil propio

`await wa.me()` devuelve la propia cuenta como un `Contact` (`me` es `true`). Además de
`content(value)` y `photo(value)`, dos métodos sólo funcionan en él y rechazan con `ERR_NOT_ALLOWED`
en cualquier otro contacto:

| Método          | Qué hace                                                                     |
| --------------- | ---------------------------------------------------------------------------- |
| `rename(name)`  | Cambia el nombre público en WhatsApp y lo devuelve.                          |
| `online(value)` | Anuncia la cuenta en línea o desconectada; el socket arranca desconectado.   |

```typescript title="profile.ts"
const me = await wa.me();
await me?.rename('Ventas');
await me?.online(true);
```

Los estados se publican con [`wa.Feed.create()`](feed.es.md#publicar).

---

## Rutas de persistencia

Los registros relacionados con contactos viven bajo estas claves en el motor configurado:

| Ruta                             | Valor                                                                                                                                                                              | Escrito por                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/contact/<id>`                  | El `Contact` de baileys (`id`, `lid`, `phoneNumber`, `name`, `notify`, `verifiedName`, `imgUrl`, `status`), fusionado campo por campo, bajo el JID del teléfono cuando se conoce y el LID si no. | `contacts.upsert` / `contacts.update`, mensajes entrantes, `Contact.get`.    |
| `/contact/<id>/metadata`         | Los metadatos de integración del contacto.                                                                                                                                         | `contact.metadata(patch)`.                                                   |
| `/contact/<id>/photo`            | `{ url }` de la última foto descargada, y su binario bajo `/contact/<id>/photo/content`.                                                                                           | `contact.photo()`.                                                           |
| `/lid/<lid>`                     | String JID serializado — índice directo para resolver LIDs.                                                                                                                        | `Contact.get`, upserts y updates de contacto, `lid-mapping.update`.          |
| `/lid/<pn>`                      | String LID serializado — índice inverso.                                                                                                                                           | Los mismos que escriben `/lid/<lid>`.                                        |
| `/blocklist`                     | La lista de identificadores que la cuenta tiene bloqueados; `blocked()` la lee.                                                                                                    | Cada conexión, `blocklist.update`.                                           |
| `/chat/<id>`                     | Documento del chat; `chat()` se hidrata desde aquí.                                                                                                                                | Eventos `chats.*`, mensajes entrantes.                                       |
| `/catalog/<jid>/collection/<id>` | Timeline de cada colección del catálogo: cada descarga distinta tal como la devolvió baileys, con `updated_at` en su metadata; `catalog()` se hidrata desde aquí.                   | `contact.catalog()`.                                                           |

!!! warning "Consistencia del motor"
    Cuando `autoclean` es `true` (por defecto) y llega un `loggedOut` remoto, el motor completo se
    vacía para forzar un sync limpio en el próximo login. Configura `autoclean: false` en el
    constructor de `WhatsApp` si quieres conservar contactos, chats y mensajes entre
    reautenticaciones.

```typescript title="preserve-data.ts"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

const wa = new WhatsApp({
    engine: new FileSystemEngine('./.whatsapp'),
    autoclean: false, // conserva /contact/*, /lid/*, /chat/* entre relogins
});
```
