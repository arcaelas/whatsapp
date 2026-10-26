# Chat

La entidad `Chat` representa una conversación de WhatsApp — un chat 1:1 con un contacto o un grupo.
Lo que el chat es (`id`, `type`, `count`) son getters; cada valor que la cuenta también puede cambiar
es un único método que lee sin argumento y escribe con uno, y rechaza con `UNAUTHORIZED` cuando
la cuenta no tiene derecho a cambiarlo.

La clase es `wa.Chat`, que la sesión construye al conectar con la factory `chat` —el export por
defecto de `src/lib/chat.ts`, publicado como `chat`—, que sólo depende de la sesión y de baileys.

---

## Importación

```typescript title="imports.ts"
import { WhatsApp, FileSystemEngine, type Chat } from '@arcaelas/whatsapp';
```

`Chat` se exporta como tipo: la instancia de `wa.Chat`, con cada getter y método de abajo. La clase
es `wa.Chat`, publicada por la sesión: úsala para construir un chat (`new wa.Chat(raw)`), para los
estáticos y para `instanceof`.

---

## De dónde salen las instancias

- `wa.Chat.get(cid)` — el chat guardado por teléfono, JID, LID o id de grupo, o `null`.
- `wa.Chat.list(offset, limit)` — lectura paginada de los chats guardados.
- `wa.Chat.create(name, members)` — un grupo recién creado.
- `wa.Chat.join(invite)` — un grupo al que se acaba de entrar por enlace.
- `new wa.Chat(raw)` — desde un documento `Chat` de baileys.
- `contact.chat()` — el chat 1:1 de un `Contact`, guardado o armado en el momento.
- `msg.chat()` — el chat al que pertenece un mensaje.
- Los eventos (`message:*`, `chat:*`, `contact:*`) — el `Chat` viaja con ellos.

```typescript title="bootstrap.ts"
const chat = await wa.Chat.get('5215555555555');
if (chat) {
    console.log(chat.name(), chat.type, chat.count);
}
```

---

## Propiedades

| Propiedad | Tipo                   | Descripción                                                                          |
| --------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `id`      | `string`               | JID completo: el del teléfono en un 1:1, el `@g.us` en un grupo, el LID si no está mapeado. Mismo formato que `contact.id` y `msg.cid`. |
| `type`    | `'contact' \| 'group'` | Conversación 1:1 o grupo.                                                            |
| `count`   | `number`               | Mensajes sin leer; `seen()` lo deja en `0`.                                          |

---

## Métodos

Cada método sirve en un 1:1 y en un grupo salvo que diga lo contrario. Lo que cambia el estado
propio de la cuenta —archivar, fijar, silenciar, renombrar, describir, mensajes temporales— se
guarda en la instancia y en el motor en cuanto WhatsApp lo acepta, y emite el evento `chat:*` que
corresponde; el eco de WhatsApp que llega después ya no encuentra diferencia y no lo repite. Una operación de grupo
rechaza con `UNAUTHORIZED` cuando la cuenta no tiene el permiso o no está en el grupo, y en un
1:1 cuando sólo existe en grupos.

### `name()` / `name(value)`

```typescript
name(): string
name(value: string): Promise<string>
```

En un 1:1, el nombre del contacto (agenda, nombre público o teléfono); en un grupo, el asunto. Con
texto, en un 1:1 cambia el nombre con que la cuenta guarda al contacto en su agenda —en el chat y en
la ficha, lo mismo que [`contact.rename(value)`](contact.es.md#rename-name)—, y en un grupo intenta
cambiar el asunto, que exige permiso.

### `content()` / `content(value)`

```typescript
content(value?: string): Promise<string>
```

En un 1:1, la biografía del contacto tal como la lee
[`contact.content()`](contact.es.md#content-contentvalue) —de WhatsApp, o la guardada sin red—; en un
grupo, la descripción. Con texto intenta cambiar la descripción del grupo (`''` la borra); en un 1:1
rechaza, porque la biografía es de la otra persona.

### `photo()` / `photo(value)`

```typescript
photo(value?: Buffer | null): Promise<Buffer>
```

En un 1:1, la foto del contacto; en un grupo, la del grupo, guardada bajo `/chat/<id>/photo` y,
como la del contacto, consultada de nuevo pasadas 24 horas y descargada sólo si cambió. Un Buffer vacío si no hay o la privacidad la oculta. Con un
Buffer intenta cambiar la foto del grupo (`null` la quita) y devuelve el resultado; en un 1:1
rechaza. Rechaza con `ERR_PROFILE_PICTURE_LIB` cuando no está instalado ni `sharp` ni `jimp`.

### `archived()` / `pinned()` / `muted()`

```typescript
archived(): boolean
archived(value: boolean): Promise<boolean>
pinned(): boolean
pinned(value: boolean): Promise<boolean>
muted(): string | null
muted(until: string | number | Date | false): Promise<string | null>
```

Leen o cambian si el chat está archivado, fijado —WhatsApp admite tres, así que `pinned(true)`
devuelve `false` cuando no hay lugar, contados con el índice `/pinned` en una sola lectura— o silenciado hasta una fecha ISO (`false` lo reactiva). Sólo
afectan a la cuenta.

```typescript title="state.ts"
await chat.archived(true);
await chat.muted(Date.now() + 8 * 3_600_000);
console.log(chat.pinned(), chat.muted());
```

### `blocked()` / `blocked(value)`

```typescript
blocked(value?: boolean): Promise<boolean>
```

En un 1:1, lee o cambia si la cuenta tiene bloqueado al contacto; la `/blocklist` guardada se
actualiza al instante, porque WhatsApp no avisa del cambio propio. En un grupo rechaza.

### `ephemeral()` / `ephemeral(value)`

```typescript
ephemeral(): number | false
ephemeral(value: 86_400 | 604_800 | 7_776_000 | false): Promise<number | false>
```

Lee o fija la duración de los mensajes temporales: 24 horas, 7 días o 90 días, o `false` para
desactivarlos. En un 1:1 lo puede cambiar cualquiera de los dos; en un grupo lo intenta y rechaza
sin permiso.

### `seen()` / `seen(false)`

```typescript
seen(value?: boolean): Promise<boolean>
```

Con `true` o sin argumento, marca como leídos los mensajes pendientes —el otro lado ve los checks
azules— y deja `count` en `0`. Con `false` marca el chat como no leído, como la opción de WhatsApp;
WhatsApp no tiene estado de no leído por mensaje.

### `typing(value)` / `recording(value)`

```typescript
typing(value: boolean): Promise<boolean>
recording(value: boolean): Promise<boolean>
```

Muestran u ocultan el «escribiendo…» o el «grabando audio…» a los demás participantes.

!!! info "La cuenta se pone en línea sola"
    `typing(true)`, `recording(true)` y `seen()` anuncian la cuenta en línea, como WhatsApp Web, y a
    los 30 segundos sin ninguno de ellos se anuncia no disponible: eso es lo que actualiza la última
    conexión que ven los demás. Enviar mensajes no la anuncia; `(await wa.me())?.online(value)` la fuerza.

### `messages(offset?, limit?)`

```typescript
messages(offset?: number, limit?: number): Promise<Message[]>
```

Los mensajes guardados del chat, del más nuevo al más viejo. Por defecto: `0, 50`.

### `clear()` / `delete()`

```typescript
clear(): Promise<boolean>
delete(): Promise<boolean>
```

`clear()` vacía los mensajes en la cuenta y en el motor, conservando el chat. `delete()` elimina el
chat de la cuenta y del motor; en un grupo, además sale de él —si todavía es parte— y espera el
aviso de salida, para que no vuelva como chat de sólo lectura.

### `members(offset?, limit?)`

```typescript
members(offset?: number, limit?: number): Promise<Contact[]>
```

En un grupo, los participantes; en un 1:1, el contacto y la propia cuenta. En un grupo rechaza
cuando la cuenta no está en él.

### `admins(offset?, limit?)` / `admin()` / `admin(value, ...who)`

```typescript
admins(offset?: number, limit?: number): Promise<Contact[]>
admin(): Promise<boolean>
admin(value: boolean, ...who: (Contact | string | number)[]): Promise<number>
```

Sólo grupos. `admins()` lista los administradores; `admin()` dice si la cuenta lo es;
`admin(true, ...who)` da el rango y `admin(false, ...who)` lo quita, y devuelven a cuántos se aplicó.

### `add(...who)` / `remove(...who)`

```typescript
add(...who: (Contact | string | number)[]): Promise<number>
remove(...who: (Contact | string | number)[]): Promise<number>
```

Sólo grupos. Intentan agregar o sacar participantes por `Contact`, JID, LID o teléfono y devuelven a
cuántos se aplicó. Quien por privacidad sólo deja que lo agreguen sus contactos no entra: necesita el
enlace de [`invite()`](#invite-revoke).

### `invite()` / `revoke()`

```typescript
invite(): Promise<string>
revoke(): Promise<string>
```

Sólo grupos. El enlace de invitación vigente, o uno nuevo tras anular el actual.

### `announce()` / `restrict()`

```typescript
announce(value?: boolean): Promise<boolean>
restrict(value?: boolean): Promise<boolean>
```

Sólo grupos. Leen o cambian si sólo los administradores envían mensajes (`announce`) o editan el
asunto, la descripción y la foto (`restrict`).

### `sub(handler)`

```typescript
sub(handler: (event: { name: ChatEvent; payload: Chat; message?: Message; contacts?: Contact[]; presence?: Presence }) => void): () => void
```

Se suscribe a todo lo que le pasa al chat: `created`, `updated` —nombre, descripción, archivado,
fijado, silenciado— y `deleted`; `message` con el mensaje nuevo en `message`; en un grupo, `joined`,
`left`, `promoted` y `demoted` con los participantes en `contacts`; en un 1:1, `presence` con la
acción del contacto en `presence`, que necesita la cuenta en línea. Devuelve la función que
desuscribe.

```typescript title="sub.ts"
const stop = chat.sub(({ name, message, contacts }) => console.log(name, message?.caption() ?? '', contacts?.length ?? ''));
```

### `metadata()`

```typescript
metadata(): Promise<Record<string, unknown>>
metadata(key: string): Promise<unknown>
metadata(key: string, value: unknown): Promise<Record<string, unknown>>
metadata(patch: Record<string, unknown>): Promise<Record<string, unknown>>
```

Valores de tu integración ligados al chat bajo `/chat/<id>/metadata`, igual que
[`contact.metadata()`](contact.es.md#metadata): todos, una clave, o una fusión donde `null` borra.

---

## Envíos

`Chat` extiende `Sender`, la base de todo envío: `chat.text('hola')` envía a este chat y
`wa.Chat.text(cid, 'hola')` a cualquier chat, que queda creado si no existía. Los métodos, sus
opciones —`mid`, `once`, `expiration`, `mentions`— y los stickers están en
[Message › Envíos](message.es.md#envios).

```typescript title="send.ts"
const chat = await wa.Chat.get('5215555555555');
await chat?.text('¡Listo!');
await wa.Chat.image('5215555555555', buffer, { caption: 'mira', once: true });
```

---

## Estáticos (vía `wa.Chat`)

| Estático         | Firma                                                                       | Notas                                                                                  |
| ---------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `wa.Chat.get`    | `(cid: string \| number) => Promise<Chat \| null>`                          | El chat guardado por teléfono, JID, LID o id de grupo; `null` si no está guardado.     |
| `wa.Chat.list`   | `(offset?: number, limit?: number) => Promise<Chat[]>`                      | Chats guardados, del más activo al más antiguo. Por defecto: `0, 50`.                  |
| `wa.Chat.create` | `(name: string, members: (Contact \| string \| number)[]) => Promise<Chat>` | Crea un grupo con la cuenta como administradora y lo guarda. Quien WhatsApp no pudo agregar no está. |
| `wa.Chat.join`   | `(invite: string) => Promise<Chat \| null>`                                 | Entra a un grupo por su enlace o código; `null` si el enlace no sirve.                 |

```typescript title="groups.ts"
const team = await wa.Chat.create('Dev Team', ['5491112345678']);
await team.content('Daily standup a las 9:30');
await team.admin(true, '5491112345678');
await team.restrict(true);
console.log(await team.invite());
```
