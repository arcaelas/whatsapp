# Feed

`Feed` es una publicación de **estado** (status broadcast) — lo que WhatsApp guarda bajo el chat
`status@broadcast`. Extiende [`Message`](message.es.md), así que hereda los getters legibles,
`author()`, `content()` y `stream()`, y anula todo lo que un estado no admite.

Los estados viven 24 horas (`FEED_TTL_MS`), nunca emiten eventos `message:*` y viajan por su propio
canal: `feed:created`, `feed:updated` y `feed:deleted`.

---

## Importación

```typescript title="imports.ts"
import { WhatsApp, Feed, FEED_TTL_MS } from "@arcaelas/whatsapp";
```

Nunca construyes un `Feed` a mano. Las instancias llegan de:

- `(await wa.account()).post({ … })` — la publicación que tú creas.
- Los eventos `feed:created`, `feed:updated` y `feed:deleted`.

---

## Publicar

```typescript
account.post(input: { caption?: string; buffer?: Buffer; audience: (string | number | Contact)[] }): Promise<Feed | null>
```

```typescript title="publish.ts"
// Estado de texto
const cuenta = await wa.account();
await cuenta.post({
  caption: "¡Estamos en vivo!",
  audience: ["5491112345678", 584121234567],
});

// Estado de imagen o video — el tipo se deduce de la firma del binario
await cuenta.post({
  buffer: await readFile("./promo.jpg"),
  caption: "Nueva colección",
  audience: ["5491112345678"],
});
```

!!! warning "`audience` es la audiencia, y es obligatoria"
    WhatsApp no entrega el estado a nadie fuera de la lista que pases. No hay atajo de "todos mis
    contactos": arma la lista tú mismo, por ejemplo desde `wa.Contact.list()`.

| Error | Se lanza cuando |
| ----- | --------------- |
| `ERR_FEED_EMPTY` | No se pasó ni `content` ni `caption`. |
| `ERR_FEED_MEDIA` | `content` no es JPEG/PNG/WebP ni MP4. |

---

## Propiedades

Heredadas de `Message`, con los valores que un estado realmente lleva:

| Propiedad | Tipo | Notas |
| --------- | ---- | ----- |
| `id` | `string` | Identificador del estado. |
| `cid` | `string` | Siempre `'status@broadcast'`. |
| `type` | `'text' \| 'image' \| 'video' \| 'audio'` | Tipo de estado. |
| `caption` | `string` | El texto, o el pie del media. |
| `mime` | `string` | `text/plain` en texto, el MIME real en media. |
| `from` | `string` | JID del autor. |
| `created_at` | `string` | Fecha de publicación, ISO UTC. |
| `expires_at` | `string \| null` | Vencimiento, ISO UTC — 24 horas después de `created_at`. |
| `viewed` | `boolean` | `true` una vez que se envió el read receipt de ese estado. |

```typescript title="properties.ts"
wa.on("feed:created", async (post) => {
  const author = await post.author();
  console.log(`${author.name}: ${post.caption}`);
  console.log("vence el", post.expires_at, "¿visto?", post.viewed);
});
```

!!! info "La ventana de 24 horas está exportada"
    `FEED_TTL_MS` es la vida útil del estado en milisegundos (`86_400_000`), la misma constante con
    la que se calcula `expires_at`.

---

## Métodos

### `view()`

```typescript
view(): Promise<boolean>
```

Marca el estado como visto: envía el read receipt, persiste `viewed` y emite `feed:updated`.
Llamarlo dos veces es seguro — el receipt solo se envía la primera vez. Devuelve `false` cuando no
hay socket vivo.

```typescript title="view.ts"
wa.on("feed:created", async (post) => {
  await post.view();
});
```

`seen()` es un alias de `view()`, así que la costumbre de `Message` sigue funcionando.

### Heredados y utilizables

| Método | Comportamiento en un estado |
| ------ | --------------------------- |
| `author()` | El `Contact` que lo publicó. |
| `chat()` | Un `Chat` mínimo para `status@broadcast` (los estados no son una conversación real). |
| `content()` | El texto como UTF-8, o el binario del media descargado. |
| `stream()` | El contenido como `Readable`. |
| `reactions()` | Reacciones agrupadas por emoji; una reacción a un estado llega como `feed:updated`. |

### No soportados

```typescript title="unsupported.ts"
try {
  await post.delete();
} catch (error) {
  // Error: ERR_FEED_UNSUPPORTED
}
```

`message()`, `react()`, `star()`, `edit()`, `forward()`, `delete()` y todos los helpers de respuesta
(`text()`, `image()`, `video()`, `audio()`, `location()`, `poll()`, `document()`, `vcard()`,
`event()`) lanzan **`ERR_FEED_UNSUPPORTED`**.

!!! info "TypeScript te frena antes"
    Las sobrescrituras están declaradas **sin parámetros** y devolviendo `Promise<never>`, así que
    `post.react('❤️')` ni siquiera compila. El error en runtime es la segunda línea de defensa.

---

## Eventos

| Evento | Firma | Se dispara cuando… |
| ------ | ----- | ------------------ |
| `feed:created` | `[feed, wa]` | Llega un estado de un contacto, o publicas uno con `account.post()`. |
| `feed:updated` | `[feed, wa]` | El estado se marca como visto, o alguien reacciona a él. |
| `feed:deleted` | `[feed, wa]` | El autor revoca el estado. |

A diferencia de `message:*`, el payload **no lleva argumento de chat**: los estados no pertenecen a
una conversación.

```typescript title="events.ts"
wa.on("feed:created", async (post) => {
  if (post.type === "image") {
    await writeFile(`./statuses/${post.id}.jpg`, await post.content());
  }
  await post.view();
});

wa.on("feed:deleted", (post) => console.log("revocado:", post.id));
```

---

## Persistencia

| Ruta | Valor |
| ---- | ----- |
| `/status/<id>` | El documento del estado (`author_jid`, `type`, `caption`, `mime`, `created_at`, `expires_at`, `viewed`, `raw`). |
| `/status/<id>/content` | El contenido: binario crudo cuando el driver soporta buffers, JSON con base64 si no. |

!!! note "Nada vence por sí solo"
    La librería no recolecta los estados vencidos a las 24 horas; `expires_at` te dice cuándo
    WhatsApp los da por desaparecidos. Púrgalos tú con `wa.engine.unset('/status/<id>')` si el
    almacenamiento importa.
