# Catalog

`Catalog` es una colección del catálogo de productos de una cuenta WhatsApp Business — el propio o
el de cualquier contacto Business — y `Product` es un producto en sus dos formas: el artículo de un
catálogo y la tarjeta de producto que llega a un chat. Cada colección se persiste como el timeline de
sus descargas bajo `/catalog/<jid>/collection/<id>`: la primera lectura la descarga y las siguientes
salen del motor.

Es **de solo lectura**: crear, editar y borrar productos se queda en el teléfono o en el Commerce
Manager de Meta. WhatsApp no respondió esas peticiones desde un dispositivo vinculado durante la
verificación, así que la librería no las ofrece.

---

## Importación

```typescript title="imports.ts"
import { WhatsApp, type Catalog, type Product } from '@arcaelas/whatsapp';
```

`Catalog` y `Product` se exportan como tipos. Las clases están ligadas a la sesión y se publican al
conectar como `wa.Catalog` y `wa.Product`. El tipo `Product` cubre las dos formas: el producto del
catálogo y la tarjeta del chat.

---

## De dónde salen las instancias

- `contact.catalog()` — resuelve los catálogos del negocio, uno por colección.
- `(await wa.me())?.catalog()` — los catálogos de la propia cuenta.
- `catalog.products(offset, limit)` — los productos de una colección, como `wa.Product`.
- `wa.Catalog.product(uid, pid)` — un producto de un negocio, por id o por `sku`.
- El evento `catalog:updated` — un catálogo que cambió en una descarga posterior.
- `new wa.Catalog(timeline, jid, updated_at)` — un catálogo construido con el timeline de una
  colección leído del motor, su dueño y la hora de su última descarga, y `new wa.Product([node], jid)` un producto construido con uno de sus nodos:
  el raw de baileys no nombra al dueño. La forma está en [Schemas de Datos](../schema.es.md#catalogo-catalogjidcollectionid).
- Una tarjeta de producto recibida en un chat llega como mensaje, `wa.Message.Product`, que también
  responde a `instanceof wa.Product` (ver [Product](#product)).

```typescript title="bootstrap.ts"
const business = await wa.Contact.get('5491112345678');
const catalogs = (await business?.catalog()) ?? [];

for (const catalog of catalogs) {
    const products = await catalog.products(0, 5);
    console.log(catalog.id, catalog.name, products.map((product) => product.name));
}
```

---

## Descargas y refresco

Cada lectura de `contact.catalog()` sigue el mismo flujo:

1. Sin nada guardado, descarga en paralelo las colecciones (`getCollections`) y el catálogo completo
   (`getCatalog`, en páginas de 100). Cada petición se corta a los 20 segundos, y una petición que
   falla o no responde se toma como vacía.
2. Un negocio con colecciones recibe un `Catalog` por colección, en el orden en que WhatsApp las
   devuelve, cada uno con los productos de su colección. Sin colecciones — o cuando esa petición no
   respondió y no hay guardado más que ese catálogo — recibe un único `Catalog` con todos los
   productos de `getCatalog`, el teléfono del negocio como `id` y `''` como `name`. Cada descarga
   escribe su hora en la metadata de la colección como `updated_at`.
3. Con catálogos guardados, los devuelve desde el motor. Cuando alguno se descargó hace más de 24
   horas, los devuelve sin esperar y vuelve a descargar de fondo: cada colección que cambió emite
   `catalog:updated`, y una colección que WhatsApp ya no devuelve se borra del motor — sólo cuando
   WhatsApp respondió la petición de colecciones. Si ninguna de las dos peticiones responde, lo
   guardado queda intacto y la próxima lectura vuelve a intentarlo.

Nada refresca un catálogo con un temporizador: las descargas solo ocurren al leer `contact.catalog()`.
`contact.catalog()` resuelve `[]` cuando el contacto no tiene un teléfono conocido, como un contacto
del que solo se sabe su LID. Un Business sin catálogo, una cuenta que no es Business o una consulta
sin respuesta también resuelven `[]` sin guardar nada, y la siguiente lectura vuelve a preguntar.

!!! note "Límites de las colecciones"
    Las colecciones se piden con los valores por defecto de baileys: hasta 51 colecciones con hasta
    51 productos cada una. El catálogo sin colecciones no tiene ese límite: sus páginas se siguen
    hasta que WhatsApp deja de enviar un cursor.

---

## Propiedades de Catalog

Un `Catalog` lee la última descarga de su timeline, así que sus getters nunca salen a la red.

| Propiedad    | Tipo     | Descripción                                                                    |
| ------------ | -------- | ------------------------------------------------------------------------------ |
| `id`         | `string` | Identificador de la colección; el teléfono del negocio en el catálogo sin colecciones. |
| `name`       | `string` | Nombre de la colección; `''` en el catálogo sin colecciones.                   |
| `updated_at` | `string` | Última descarga de la colección, en ISO, leída de su metadata al construir la instancia: el raw de baileys no trae hora. Si la integración la borra, la siguiente lectura vuelve a descargar. |

---

## Métodos de Catalog

### `contact()`

```typescript
contact(): Promise<Contact>
```

El negocio dueño del catálogo: el contacto persistido o el que descubre `wa.Contact.get`, y un
contacto mínimo con su JID cuando no existe ninguno de los dos.

### `products(offset?, limit?)`

```typescript
products(offset = 0, limit = 50): Promise<Product[]>
```

Una página de productos de la última descarga, en el orden del catálogo, como
[`wa.Product`](#product). Lee el timeline guardado y nunca sale a la red.

```typescript title="products.ts"
for (const product of await catalog.products(0, 20)) {
    console.log(`${product.name} — ${product.price} ${product.currency}`, (await product.photo()).length);
}
```

### `product(pid)`

```typescript
product(pid: string): Promise<Product | null>
```

Un producto de esta colección por id o por `sku`, o `null`.

### `sub(handler)`

```typescript
sub(handler: (event: WatchEvent<'updated', Catalog>) => void): () => void
```

Se suscribe a las descargas que traen algo distinto para esta colección de este negocio. El handler
recibe `{ name: 'updated', payload }` con el catálogo nuevo, y la función devuelta cancela la
suscripción. Escucha `catalog:updated`, así que solo se dispara cuando una lectura posterior de
`contact.catalog()` refresca la colección.

```typescript title="sub.ts"
const off = catalog.sub(({ payload }) => {
    console.log('catalog changed', payload.name, payload.updated_at);
});

off();
```

### `metadata()`

Valores de la integración bajo `/catalog/<jid>/collection/<id>/metadata`, polimórficos como
[`contact.metadata()`](contact.es.md#metadata). La librería guarda aquí su propia clave, `updated_at`,
que lee `catalog.updated_at`. Ver [Schemas de Datos](../schema.es.md#metadatos-pathmetadata).

---

## Estáticos (vía `wa.Catalog`)

| Estático             | Firma                                                                          | Notas                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `wa.Catalog.product` | `(uid: string \| number \| Contact, pid: string) => Promise<Product \| null>` | Busca un producto en los catálogos del negocio por id o por `sku`; `null` cuando no está publicado. Lee `contact.catalog()`, así que la primera llamada descarga. |

```typescript title="lookup.ts"
const product = await wa.Catalog.product('5491112345678', 'SHIRT-001');
console.log(product?.name, product?.price, product?.currency);
```

---

## Product

Un producto tiene dos formas con los mismos getters:

- `wa.Product` — el producto de un catálogo, construido con el nodo que descarga baileys.
- `wa.Message.Product` — la tarjeta de producto que llega a un chat. Es un
  [`Message`](message.es.md#productos): su `id` es el del mensaje, y conserva todos los getters y
  métodos de un mensaje.

`instanceof wa.Product` es `true` para las dos formas; `instanceof wa.Message.Product`, solo para la
tarjeta del chat.

```typescript title="instanceof.ts"
wa.on('message:created', (msg) => {
    if (msg instanceof wa.Product) {
        console.log(msg.pid, msg.name, msg.price, msg.currency);
    }
});

const business = await wa.Contact.get('5491112345678');
const [catalog] = (await business?.catalog()) ?? [];
const [first] = (await catalog?.products(0, 1)) ?? [];
console.log(first instanceof wa.Product, first instanceof wa.Message.Product); // true false
```

| Propiedad  | Tipo             | Catálogo (`wa.Product`)                                   | Tarjeta del chat (`wa.Message.Product`)                                          |
| ---------- | ---------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `id`       | `string`         | Id del producto.                                          | Id del mensaje.                                                                  |
| `pid`      | `string`         | Id del producto, el mismo que `id`.                       | Id del producto; `''` cuando la tarjeta no lo trae.                              |
| `name`     | `string`         | Nombre del producto.                                      | Nombre del producto; `''` cuando la tarjeta no lo trae.                          |
| `price`    | `number`         | Precio en unidades: WhatsApp lo manda en milésimas.       | Precio en unidades, desde el `priceAmount1000` de la tarjeta.                    |
| `currency` | `string`         | Moneda ISO 4217.                                          | Moneda ISO 4217; `''` cuando la tarjeta no la trae.                              |
| `link`     | `string \| null` | Enlace del producto.                                      | Enlace del producto.                                                             |
| `sku`      | `string \| null` | Identificador del vendedor (`retailerId`).                | Identificador del vendedor (`retailerId`).                                       |
| `hidden`   | `boolean`        | `true` cuando está oculto a los clientes.                 | Siempre `false`: una tarjeta solo viaja mientras el producto es visible.         |
| `status`   | ver las columnas | `string \| null`: el veredicto de la revisión de Meta.     | El estado de entrega heredado de `Message`.                                      |

---

## Métodos de Product

### `catalog()`

```typescript
catalog(): Promise<Catalog | null>
```

El catálogo del negocio que publica el producto, leído con el
[`contact.catalog()`](#descargas-y-refresco) del negocio, o `null` si el producto ya no está publicado.
La tarjeta del chat encuentra al negocio por el `businessOwnerJid` de la tarjeta, o por su autor
cuando la tarjeta no lo trae.

```typescript title="product-catalog.ts"
wa.on('message:created', async (msg) => {
    if (msg instanceof wa.Message.Product) {
        const catalog = await msg.catalog();
        console.log(catalog?.name ?? 'no longer published');
    }
});
```

### `photo()` / `thumb()`

```typescript
photo(): Promise<Buffer>
thumb(): Promise<Buffer>
```

La portada original y la miniatura de 100×100, descargadas una vez y guardadas en el motor bajo el
producto; un Buffer vacío si no hay. En la tarjeta del chat, `thumb()` es la miniatura embebida en la
tarjeta y `photo()` la portada del producto en el catálogo del negocio.

### `content()` / `metadata()`

`content()` devuelve la descripción del producto en UTF-8 en las dos formas. `metadata()` es
polimórfico como el del catálogo: el producto del catálogo la guarda bajo
`/catalog/<jid>/product/<pid>/metadata`, y la tarjeta del chat bajo su mensaje,
`/chat/<cid>/message/<mid>/metadata`.

```typescript title="product.ts"
const product = await wa.Catalog.product('5491112345678', 'SHIRT-001');

if (product) {
    console.log(product.sku, product.link, (await product.thumb()).length, product.status);
    console.log((await product.content()).toString('utf-8'));
    await product.metadata('synced_at', Date.now());
}
```

---

## Persistencia

| Ruta                                      | Valor                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/catalog/<jid>/collection/<id>`          | Timeline de las descargas distintas de la colección, tal como las devolvió baileys; el score es su posición en la descarga. |
| `/catalog/<jid>/collection/<id>/metadata` | `catalog.metadata()`, con el `updated_at` de la librería.                                                         |
| `/catalog/<jid>/product/<pid>/metadata`   | `product.metadata()` de un producto del catálogo.                                                                 |

`<jid>` es el JID de teléfono del negocio (`@s.whatsapp.net`). Una descarga idéntica al último
elemento solo refresca `updated_at`. Ver
[Schemas de Datos](../schema.es.md#catalogo-catalogjidcollectionid) para la forma completa.
