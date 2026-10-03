# Feed

`Feed` es una publicación de **estado** — lo que WhatsApp guarda bajo el chat `status@broadcast`. Es
una clase propia, separada de [`Message`](message.es.md), y extiende `Sender`: responder un estado
envía al chat 1:1 del autor citándolo, como hace WhatsApp.

Los estados viven 24 horas (`FEED_TTL_MS`), nunca emiten eventos `message:*` y viajan por su propio
canal: `feed:created`, `feed:updated` y `feed:deleted`.

---

## Importación

```typescript title="imports.ts"
import { WhatsApp, feed, FEED_TTL_MS, type Feed } from '@arcaelas/whatsapp';
```

`Feed` es un tipo; la clase vive en la sesión como `wa.Feed`, construida por la factory `feed` —el
export por defecto de `src/lib/feed.ts`—. Las instancias salen de:

- `wa.Feed.create({ … })` — el estado que publicas.
- `wa.Feed.get(id)` y `wa.Feed.list(offset, limit)` — los guardados.
- Los eventos `feed:created`, `feed:updated` y `feed:deleted`.
- `new wa.Feed(timeline)`, con un timeline guardado en `/status/<id>`.

---

## Publicar

```typescript
wa.Feed.create(input: { caption?: string; media?: { buffer: Buffer; mime: string }; audience?: (Contact | string | number)[] }): Promise<Feed>
```

Un estado de texto con sólo `caption`, o uno de imagen, video o audio con `media`, que se distinguen
por `media.mime` y llevan `caption` como pie. Sin `audience` se publica a todos los contactos
guardados en el motor; WhatsApp no lo reparte fuera de la audiencia. Rechaza con `ERR_FEED_EMPTY` sin
`caption` ni `media`.

```typescript title="publish.ts"
await wa.Feed.create({ caption: '¡Estamos en vivo!' });
await wa.Feed.create({
    caption: 'Nueva colección',
    media: { buffer: await readFile('./promo.jpg'), mime: 'image/jpeg' },
    audience: ['5491112345678'],
});
```

!!! info "Quién ve un estado"
    WhatsApp sólo muestra un estado a quien tiene al autor guardado en sus contactos, aunque esté en
    la audiencia.

---

## Propiedades

| Propiedad    | Tipo                                        | Notas                                                     |
| ------------ | ------------------------------------------- | --------------------------------------------------------- |
| `id`         | `string`                                    | Identificador del estado.                                 |
| `from`       | `string`                                    | JID del autor: el teléfono cuando se conoce; si no, el LID. |
| `me`         | `boolean`                                   | `true` si el estado es propio.                            |
| `type`       | `'text' \| 'image' \| 'video' \| 'audio'`   | Tipo de estado.                                           |
| `mime`       | `string`                                    | `text/plain` en texto, el MIME real en media.             |
| `caption`    | `string`                                    | El texto, o el pie del media.                             |
| `created_at` | `string`                                    | Fecha de publicación, ISO.                                |
| `expires_at` | `string`                                    | Vencimiento, ISO — 24 horas después de `created_at`.      |

---

## Métodos

### `seen()` / `seen(true)`

```typescript
seen(): boolean
seen(value: true): Promise<boolean>
```

Sin argumento, si ya lo viste —los propios siempre lo están—. Con `true` manda el recibo de lectura,
lo suma al timeline, emite `feed:updated` y pone la cuenta en línea; llamarlo de nuevo no manda nada.

### `delete()`

```typescript
delete(): Promise<boolean>
```

En un estado propio lo retira para todos, y el eco lo saca del motor y emite `feed:deleted`. En uno
ajeno sólo lo saca del motor y emite `feed:deleted`.

### `content()` / `stream()` / `author()`

```typescript
content(): Promise<Buffer>
stream(): Promise<Readable>
author(): Promise<Contact>
```

`content()` es el binario del media —el guardado o la descarga, que queda guardada; lanza si no se
puede descargar— o, en un estado de texto, el caption como Buffer. `author()` es el `Contact` que lo
publicó.

### Respuestas

`text()`, `image()`, `video()`, `audio()` y los demás [envíos](message.es.md#envios) heredados de
`Sender` responden el estado: van al chat 1:1 del autor y lo citan.

```typescript title="reply.ts"
wa.on('feed:created', async (post) => {
    await post.seen(true);
    await post.text('¡Lindo!');
});
```

### `sub(handler)` / `metadata()`

```typescript
sub(handler: (event: { name: 'updated' | 'deleted' | 'seen'; payload: Feed }) => void): () => void
```

`sub()` avisa lo que le pasa al estado: cambia, se retira o lo ven. `metadata()` guarda valores de
la integración bajo `/status/<id>/metadata`, igual que [`contact.metadata()`](contact.es.md#metadata).

---

## Estáticos (vía `wa.Feed`)

| Estático         | Firma                                                   | Notas                                     |
| ---------------- | ------------------------------------------------------- | ----------------------------------------- |
| `wa.Feed.get`    | `(id: string) => Promise<Feed \| null>`                 | El estado guardado.                       |
| `wa.Feed.list`   | `(offset?: number, limit?: number) => Promise<Feed[]>`  | Estados vigentes, del más nuevo al más viejo. |
| `wa.Feed.create` | `(input) => Promise<Feed>`                              | Ver [Publicar](#publicar).                |

---

## Eventos

| Evento         | Firma          | Se emite cuando…                                                      |
| -------------- | -------------- | ----------------------------------------------------------------------- |
| `feed:created` | `[feed, wa]`   | Llega un estado de un contacto, o publicas uno con `Feed.create()`.     |
| `feed:updated` | `[feed, wa]`   | El estado se ve, por `seen(true)` o por un recibo de lectura, o recibe una reacción. |
| `feed:deleted` | `[feed, wa]`   | El estado se retira, o `delete()` lo saca.                              |

A diferencia de `message:*`, el payload **no trae chat**: los estados no pertenecen a una conversación.

---

## Persistencia

| Ruta                     | Valor                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `/status/<id>`           | El timeline del estado: los raws tal como los emitió baileys, primero el `WAMessage`, después las reacciones, los recibos `{ key, receipt }` —`seen(true)` suma el propio con esa forma— y el mapeo `{ lid, pn }` cuando el autor llegó por LID. |
| `/status/<id>/content`   | El binario de un estado de imagen, video o audio. Uno de texto no tiene.  |
| `/status/<id>/metadata`  | Los valores escritos con `metadata()`.                                    |

!!! note "Nada vence solo"
    La librería no borra los estados a las 24 horas; `Feed.list()` deja fuera los vencidos y
    `expires_at` dice cuándo WhatsApp los da por terminados.
