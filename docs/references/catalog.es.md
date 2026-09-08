# Catalog

`Catalog` es el catálogo de productos de una cuenta WhatsApp Business — el propio o el de cualquier
contacto Business — tal como WhatsApp lo publica. El documento se persiste bajo `/catalog/<jid>` la
primera vez que se descarga, así las lecturas siguientes no cuestan nada y `sync()` lo refresca a
demanda.

Es **de solo lectura**: crear, editar y borrar productos se queda en el teléfono o en el Commerce
Manager de Meta. WhatsApp no respondió esas peticiones desde un dispositivo vinculado durante la
verificación, así que la librería no las ofrece.

---

## Importación

```typescript title="imports.ts"
import { WhatsApp, Catalog } from '@arcaelas/whatsapp';
```

La clase `Catalog` exportada lleva los getters; el constructor que realmente usas es `wa.Catalog`,
la subclase ligada a la sesión con `get()`, `sync()` y `me`.

---

## De dónde salen las instancias

- `wa.Catalog.get()` — el catálogo propio.
- `wa.Catalog.get(uid)` — el catálogo de un negocio por teléfono, JID, LID o `Contact`.
- `contact.catalog()` / `account.catalog()` — lo mismo, desde la entidad.
- `product.item()` — la ficha completa detrás de un mensaje [`Product`](message.es.md#productos) recibido.

```typescript title="bootstrap.ts"
const mine = await wa.Catalog.get();
const theirs = await wa.Catalog.get('5491112345678');

console.log(mine?.size, theirs?.products(0, 5));
```

`get` devuelve `null` cuando el identificador no se puede resolver o nombra un grupo. Un Business sin
catálogo — o una cuenta que no es Business — devuelve un catálogo **vacío**: WhatsApp nunca responde
la consulta, así que la descarga se corta a los 20 segundos por página y se toma como vacía.

---

## Propiedades

| Propiedad    | Tipo      | Descripción                                                   |
| ------------ | --------- | ------------------------------------------------------------- |
| `id`         | `string`  | Teléfono del negocio dueño del catálogo.                      |
| `jid`        | `string`  | JID del negocio (`@s.whatsapp.net`).                          |
| `size`       | `number`  | Cantidad de productos.                                        |
| `fetched_at` | `string`  | Fecha de la última descarga en **ISO UTC**.                   |
| `me`         | `boolean` | `true` cuando el catálogo es el de la propia cuenta.          |

---

## Métodos

### `products(offset?, limit?)`

```typescript
products(offset = 0, limit = 50): Product[]
```

Una página de productos en el orden del catálogo, síncrona sobre el documento persistido. Cada
producto es:

```ts
{
    id: string;               // id del producto en WhatsApp
    owner: string;            // el JID del negocio
    name: string;
    description: string;
    price: number;            // en unidades, como lo muestra WhatsApp
    currency: string;         // ISO 4217
    retailer_id: string | null;
    url: string | null;
    hidden: boolean;
    images: string[];         // URLs del CDN
    availability: string | null;
    status: string | null;    // estado de revisión
}
```

El tipo se deriva de la clase: `Catalog['_raw']['products'][number]`.

```typescript title="products.ts"
for (const item of catalog.products(0, 20)) {
    console.log(`${item.name} — ${item.price} ${item.currency}`, item.images[0]);
}
```

### `product(id)`

```typescript
product(id: string): Product | null
```

Un producto por su id de WhatsApp o por su `retailer_id`, o `null`.

### `sync()`

```typescript
sync(): Promise<this>
```

Vuelve a bajar el catálogo completo y lo persiste. Llámalo cuando los productos puedan haber cambiado
desde `fetched_at`.

```typescript title="sync.ts"
const fresh = await (await wa.Catalog.get('5491112345678'))?.sync();
console.log(fresh?.size, fresh?.fetched_at);
```

---

## Estáticos (vía `wa.Catalog`)

| Estático         | Firma                                                              | Notas                                                                    |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `wa.Catalog.get` | `(uid?: string \| number \| Contact) => Promise<Catalog \| null>`  | Sin argumento, el propio. Primero el motor; si no está, se baja y se persiste. |

---

## Persistencia

| Ruta             | Valor                                                              |
| ---------------- | ------------------------------------------------------------------ |
| `/catalog/<jid>` | `{ id, products, fetched_at }`; el score es `fetched_at`.          |

Ver [Schemas de Datos](../schema.es.md#catalogo-catalogjid) para la forma completa.
