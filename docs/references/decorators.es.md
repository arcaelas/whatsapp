# Decorators

API de decoradores Stage 3 construida sobre el cliente de WhatsApp. Opt-in a través de la subentrada `@arcaelas/whatsapp/decorators`; el paquete principal (`@arcaelas/whatsapp`) permanece sin cambios.

La capa de decoradores cablea los métodos declarados en una clase contra el event emitter real en el momento de `connect()`. No reemplaza al cliente: vincula métodos decorados a eventos, timers, callbacks de emparejamiento y workflows secuenciales.

---

## Importación

```typescript title="bot.ts"
import {
  WhatsAppBot,
  Bot,
  on,
  guard,
  once,
  connect,
  disconnect,
  every,
  delay,
  pair,
  from,
  pipe,
  command,
  decorator,
  HANDLERS,
} from "@arcaelas/whatsapp/decorators";
```

!!! warning "Los motores viven en la entrada principal"
    `@arcaelas/whatsapp/decorators` exporta **solo** la API de decoradores. `FileSystemEngine`,
    `SQLiteEngine`, `RedisEngine`, `S3Engine` y todas las entidades vienen de `@arcaelas/whatsapp`.

---

## Requisitos

!!! info "Entorno"
    - **Node.js ≥ 20**. El paquete hace polyfill de `Symbol.metadata` internamente, así que el runtime no necesita soporte nativo.
    - **TypeScript ≥ 5**. Usa decoradores Stage 3 nativos. **No** habilites `experimentalDecorators` ni `emitDecoratorMetadata` en `tsconfig.json` — apuntan a la propuesta legacy y son incompatibles.
    - No requiere la dependencia Reflect-metadata.

`tsconfig.json` mínimo:

```json title="tsconfig.json"
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true
  }
}
```

---

## La clase del bot

Un bot decorado es un `WhatsAppBot`, que **es** un cliente `WhatsApp`: mismas opciones de
constructor, mismos eventos, mismas entidades. Solo añade el cableado de los métodos decorados en
`connect()`.

```typescript title="extend.ts"
import { FileSystemEngine, type Message } from "@arcaelas/whatsapp";
import { WhatsAppBot, connect, command } from "@arcaelas/whatsapp/decorators";

class MyBot extends WhatsAppBot {
  @connect()
  on_open() {
    console.log("conectado");
  }

  @command("/ping")
  async ping(msg: Message) {
    await msg.text("pong");
  }
}

const bot = new MyBot({ engine: new FileSystemEngine(".sessions/bot"), phone: 584144709840 });
await bot.connect((auth) => console.log(auth));
```

Aquí `connect(callback?)` recibe un callback **opcional**: cuando la clase declara métodos `@pair`,
son ellos los que reciben el PIN/QR.

!!! info "Los handlers se cablean una sola vez"
    El cableado ocurre en el primer `connect()` y está protegido contra repeticiones, así que una
    reconexión no duplica cada listener.

---

## Resumen

| Decorador | Firma | Resumen |
|-----------|-------|---------|
| `@Bot` | `(options: IWhatsApp) => ClassDecorator` | Convierte una clase en una subclase de `WhatsAppBot` con opciones por defecto. |
| `@on` | `(event: string) => MethodDecorator` | Suscribe el método a un evento del cliente. Apilable. |
| `@guard` | `(pred: (...args) => boolean \| Promise<boolean>) => MethodDecorator` | Prechequeo que corre antes del handler. Apilable (AND). |
| `@once` | `(event?: string) => MethodDecorator` | Ejecuta el handler una vez y se desuscribe. Acepta un atajo de evento opcional. |
| `@connect` | `() => MethodDecorator` | Alias de `@on('connected')`. |
| `@disconnect` | `() => MethodDecorator` | Alias de `@on('disconnected')`. |
| `@every` | `(ms: number) => MethodDecorator` | Timer periódico (`setInterval`) ligado al ciclo de vida de la conexión. |
| `@delay` | `(ms: number) => MethodDecorator` | Bucle recursivo de `setTimeout`: las ejecuciones nunca se solapan. |
| `@pair` | `() => MethodDecorator` | Callback de emparejamiento (PIN/QR). Varios métodos corren en paralelo. |
| `@from` | `(src: string \| string[] \| (jid) => boolean) => MethodDecorator` | Filtra por autor del mensaje (JID, LID o teléfono). |
| `@command` | `(pattern: string \| RegExp) => MethodDecorator` | Comando textual sobre `message:created` con parseo de argumentos. |
| `@pipe` | `(workflow: string, index: number) => MethodDecorator` | Paso de una tubería secuencial que comparte argumentos mutables. |

---

## `@Bot(options)`

Decorador de clase que convierte el target en una subclase de `WhatsAppBot`, copiando en ella los
métodos y la metadata del original. En la construcción, el override parcial que pasas a
`new MyBot(override?)` se fusiona sobre las `default_options` entregadas al decorador.

**Firma**

```typescript
function Bot(default_options: IWhatsApp): ClassDecorator;
```

!!! warning "Extiende `WhatsAppBot` igualmente"
    Los decoradores Stage 3 **no pueden cambiar el tipo declarado de una clase**. En runtime `@Bot`
    devuelve una subclase de `WhatsAppBot`, pero TypeScript sigue tipando tu clase tal como la
    escribiste: sin `extends WhatsAppBot`, `bot.connect()` y `bot.disconnect()` no compilan. Combina
    ambos y todo encaja:

```typescript title="minimal-bot.ts" hl_lines="8"
import { FileSystemEngine } from "@arcaelas/whatsapp";
import { WhatsAppBot, Bot, connect } from "@arcaelas/whatsapp/decorators";

@Bot({
  engine: new FileSystemEngine(".sessions/bot"),
  phone: "5491112345678",
})
class MyBot extends WhatsAppBot {
  @connect()
  on_open() {
    console.log("conectado");
  }
}

const bot = new MyBot({ engine: new FileSystemEngine(".sessions/bot") });
await bot.connect();
```

Cualquier opción que pases en la construcción sobrescribe los valores por defecto del decorador para
esa instancia.

---

## `@on(event)`

Suscribe el método a un evento del cliente. El decorador es **apilable**: varios `@on` sobre el
mismo método registran múltiples suscripciones, y un evento repetido se registra una sola vez.

```typescript
@on("message:created")
@on("message:updated")
log_message(msg: Message, chat: Chat, wa: WhatsApp) {
  console.log(msg.id);
}
```

Los nombres de eventos válidos están documentados en [References / Events](events.es.md):
`connected`, `disconnected`, `message:created`, `message:updated`, `message:deleted`,
`message:reacted`, `message:starred`, `message:unstarred`, `message:forwarded`, `message:seen`,
`contact:created`, `contact:updated`, `chat:created`, `chat:deleted`, `chat:pinned`,
`chat:unpinned`, `chat:archived`, `chat:unarchived`, `chat:muted`, `chat:unmuted`, `feed:created`,
`feed:updated`, `feed:deleted`.

!!! tip "Payload del listener"
    Los argumentos del handler reflejan el payload del emisor. En eventos de mensaje la firma es
    `(msg, chat, wa)`; en eventos de contacto `(contact, chat, wa)`; en eventos de chat y de estado
    `(entidad, wa)`.

---

## `@guard(pred)`

Registra un predicado que se evalúa **antes** del handler. Varios guards se acumulan y se evalúan
secuencialmente en orden de declaración con semántica **AND** — cualquier guard que devuelva falsy
corta la cadena y el handler no se ejecuta.

El predicado recibe los argumentos crudos del evento como `unknown`, así que hay que estrecharlos
dentro:

```typescript
@on("message:created")
@guard((msg) => !(msg as Message).me)
@guard((msg) => (msg as Message).type === "text")
on_inbound_text(msg: Message) {
  /* ... */
}
```

!!! warning "Tipa el parámetro del predicado como `unknown`"
    `@guard` está tipado como `(...args: unknown[]) => boolean | Promise<boolean>`. Escribir
    `@guard((msg: Message) => !msg.me)` no compila con `strict`, porque `unknown` no es asignable a
    `Message`. Deja que el parámetro se infiera y castea dentro del cuerpo, como arriba.

**Autoregistro**: si el método no tiene un `@on` explícito pero sí al menos un `@guard` (o `@from`,
que añade un guard internamente), se registra implícitamente a `message:created`.

```typescript
// Equivalente a @on('message:created') + @guard(...)
@guard((msg) => (msg as Message).type === "image")
on_image(msg: Message) {
  /* ... */
}
```

---

## `@once()` / `@once(event)`

Marca el handler para dispararse **una sola vez** y luego autodesuscribirse. Dos formas:

- `@once()` — modificador puro, combínalo con `@on` (o con un autoregistro implícito).
- `@once(event)` — atajo equivalente a `@on(event) + @once()`.

```typescript
@once("connected")
greet_once() {
  console.log("primera conexión");
}

@on("message:created")
@once()
first_message(msg: Message) {
  console.log("primer mensaje entrante");
}
```

---

## `@connect()` / `@disconnect()`

Alias semánticos de `@on('connected')` y `@on('disconnected')`. El método se ejecuta cuando la
conexión con WhatsApp se abre o se cierra, respectivamente.

```typescript
@connect()
on_open() {
  console.log("conectado");
}

@disconnect()
on_close() {
  console.log("desconectado");
}
```

---

## `@every(ms)`

Instala un timer periódico (`setInterval`). El intervalo arranca cuando se emite `connected` y se
cancela en `disconnected`, así que el callback no corre mientras el cliente está offline.

```typescript
@every(30_000)
async heartbeat() {
  console.log("tick", Date.now());
}
```

!!! warning "Las ejecuciones pueden solaparse"
    `setInterval` no espera a la ejecución anterior: un método que tarde más de `ms` correrá
    concurrentemente consigo mismo. Usa `@delay` cuando eso importe. Los callbacks de timer tampoco
    reciben **ningún argumento** — accede al cliente a través de `this`.

---

## `@delay(ms)`

Mismo ciclo de vida que `@every`, pero implementado como un `setTimeout` recursivo: la siguiente
ejecución empieza solo cuando terminó la anterior, así que las corridas **nunca se solapan**. La
primera ejecución ocurre `ms` después de `connected`.

```typescript
@delay(5_000)
async poll_queue() {
  const jobs = await fetch_jobs();     // tarda lo que tenga que tardar
  for (const job of jobs) {
    await this.Message.text(job.cid, job.text);
  }
}
```

| Decorador     | Planificador             | Solapamiento   | Se detiene en    |
| ------------- | ------------------------ | -------------- | ---------------- |
| `@every(ms)`  | `setInterval`            | Posible        | `disconnected`   |
| `@delay(ms)`  | `setTimeout` recursivo   | Nunca          | `disconnected`   |

---

## `@pair()`

Marca el método como callback de emparejamiento. Cuando baileys entrega un PIN o un QR, todos los
métodos `@pair` se invocan en paralelo con `Promise.all`. Un argumento de `connect(callback?)` — si
se pasa — corre junto a ellos.

```typescript
@pair()
async on_pin(code: string | Buffer) {
  if (Buffer.isBuffer(code)) {
    await writeFile("qr.png", code);
  } else {
    console.log("código de emparejamiento:", code);
  }
}
```

Como el emparejamiento lo maneja el decorador, `connect()` ya no necesita un callback explícito:

```typescript
await bot.connect(); // emparejamiento manejado por los métodos @pair
```

---

## `@from(source)`

Filtra `message:created` por el autor del mensaje. El origen puede ser:

- `string` — JID (`5491112345678@s.whatsapp.net`), LID (`<dígitos>@lid`) o teléfono plano (`5491112345678`).
- `string[]` — coincide cualquiera de las entradas (OR).
- `(jid: string) => boolean` — predicado propio sobre `msg.from`.

Los strings se normalizan la primera vez que corre el guard, a través del resolver interno de JIDs
del cliente, y se cachean en un `Set` del handler para que las invocaciones siguientes sean O(1).

```typescript
@command("/ban")
@from(["5491111111111", "5492222222222"])
ban_user(msg: Message, chat: Chat, args: string[]) {
  /* solo administradores */
}

@from((jid) => jid.endsWith("@s.whatsapp.net"))
personal_only(msg: Message) {
  /* ... */
}
```

**Autoregistro**: igual que `@guard`, un método decorado solo con `@from` (sin `@on`) se registra
automáticamente a `message:created`.

!!! info "Compara contra `msg.from`"
    `from` es el JID del autor tal como está almacenado. Un número se normaliza a
    `<dígitos>@s.whatsapp.net`; si el chat direcciona al contacto por LID, pasa el LID (o un
    predicado) en su lugar.

---

## `@command(pattern)`

Atajo para un comando textual sobre `message:created`. Internamente aplica:

1. `@on('message:created')`.
2. Un guard que compara `pattern` contra `msg.caption`:
   - patrón `string` → `startsWith`.
   - patrón `RegExp` → `test`.
3. Un transform que reescribe los argumentos a `(msg, chat, args)`:
   - Con un patrón string, `args` es el texto restante partido por espacios.
   - Con un `RegExp`, `args` es `match.slice(1)` (los grupos de captura).

```typescript
@command("/help")
show_help(msg: Message, chat: Chat, args: string[]) {
  /* args = [] para "/help", ["topic"] para "/help topic" */
}

@command(/^\/echo\s+(.+)$/)
echo(msg: Message, chat: Chat, args: string[]) {
  const [text] = args;
  /* ... */
}
```

!!! note "Forma de los argumentos"
    `@command` reescribe la firma del handler de `(msg, chat, wa)` a `(msg, chat, args)`. El cliente
    sigue accesible vía `this` — el bot **es** el cliente.

!!! warning "También coincide con tus propios mensajes"
    El guard solo mira el texto, así que un mensaje saliente que empiece con el prefijo dispara el
    comando. Añade `@guard((msg) => !(msg as Message).me)` cuando eso importe.

---

## `@pipe(workflow, index)`

Registra el método como paso dentro de un **workflow** con nombre. Todos los pasos con el mismo
nombre de `workflow` se ejecutan secuencialmente en cada `message:created`, ordenados por `index`
ascendente. Los pasos comparten los mismos argumentos (`msg`, `chat`, `wa`), así que las mutaciones
sobre esos objetos se propagan a los pasos siguientes.

```typescript
@pipe("inbound", 0)
async step_1(msg: Message) {
  (msg as any).tags = ["fresh"];
}

@pipe("inbound", 1)
async step_2(msg: Message) {
  (msg as any).tags.push("audited");
}
```

Contrato:

- Secuencial: cada paso se espera antes del siguiente.
- Estado compartido: las mutaciones sobre `msg`/`chat` son visibles aguas abajo.
- No aplican guards ni eventos — `@pipe` es autocontenido.
- Varios workflows coexisten; cada uno corre de forma independiente en `message:created`.

!!! warning "No lo mezcles con `@on` en el mismo método"
    Un método decorado con `@pipe` se registra como paso del workflow. Añadir `@on` o `@guard` en el
    mismo método crea un **segundo registro independiente** — el workflow los ignora.

---

## Reglas de apilado

Leyenda: ✅ componen · ⚠️ componible, lee la nota · ❌ no soportado.

| Con → / Base ↓ | `@on` | `@guard` | `@once` | `@from` | `@command` | `@pipe` | `@every` / `@delay` | `@pair` |
|---|---|---|---|---|---|---|---|---|
| `@on` (apilable) | ✅ | ✅ | ✅ | ✅ | ⚠️ redundante | ❌ | ⚠️ | ❌ |
| `@guard` (apilable) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ⚠️ | ❌ |
| `@once` | ✅ | ✅ | — | ✅ | ✅ | ❌ | ❌ | ❌ |
| `@from` (único) | ✅ | ✅ | ✅ | ❌ dos `@from` | ✅ | ❌ | ❌ | ❌ |
| `@command` (único) | ⚠️ | ✅ | ✅ | ✅ | ❌ dos `@command` | ❌ | ❌ | ❌ |
| `@pipe` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ el mismo índice choca | ❌ | ❌ |
| `@every` / `@delay` | ⚠️ el canal del timer no es un evento real — no lo combines con uno | ⚠️ los guards corren sin mensaje | ❌ | ❌ | ❌ | ❌ | ⚠️ dos timers en un método disparan por separado | ❌ |
| `@pair` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ varios métodos corren en paralelo |

Notas clave:

- **`@command` + `@command`** en el mismo método es inválido: ambos transforms se acumulan y el segundo reemplaza el resultado del primero; declara dos métodos en su lugar.
- **`@from` + `@from`** en el mismo método produce dos guards independientes combinados con AND, así que un mensaje debe cumplir *ambos* conjuntos; para coincidencia OR pasa un array a un solo `@from`.
- **`@pipe` es terminal**: un método marcado como paso de tubería no debería llevar ningún otro decorador.
- **`@every` / `@delay` + `@on`** registra el método tanto en el timer como en un evento — la invocación del timer no recibe argumentos, lo que rompe handlers que esperan `(msg, chat, wa)`.
- **`@pair` es su propio canal**; nunca lo combines con `@on`.

---

## Semántica de ejecución

### Despacho de listeners

Los listeners del mismo evento corren **concurrentemente** bajo el EventEmitter — el emisor llama a
los listeners de forma síncrona sin esperarlos, así que dos handlers de `message:created` arrancan
en paralelo.

Dentro de un mismo handler el flujo es **secuencial**:

1. Todos los `guards` se esperan en orden de declaración (AND con cortocircuito).
2. Todos los `transforms` se esperan en orden de declaración, produciendo la lista final de argumentos.
3. El cuerpo del handler corre con los argumentos transformados.

### Timers

Los handlers de `@every(ms)` y `@delay(ms)` arrancan con el evento `connected` y se detienen en
`disconnected`. Un ciclo de reconexión, por tanto, los rearma desde cero.

### Emparejamiento

Los callbacks `@pair` se recolectan en `connect()` y se invocan en paralelo con `Promise.all`. Si el
consumidor pasa un callback a `connect(callback)`, corre en paralelo junto a ellos.

### Workflows

Un grupo `@pipe(workflow, _)` se registra como un único listener de `message:created`. Cuando el
evento se dispara, los pasos se ordenan por `index` y se esperan secuencialmente:

```typescript
for (const step of sorted_steps) {
  await step(msg, chat, wa);
}
```

Como los argumentos son compartidos, las mutaciones sobre `msg` o `chat` son observables por los
pasos siguientes.

---

## Avanzado: decoradores propios

La infraestructura expone una factory `decorator<P>()` para construir tus propios decoradores
paramétricos sin tocar la capa de metadata directamente. El callback muta la entrada `HandlerMeta`
resuelta — agrega eventos, guards, transforms o cambia `once`.

**Firma**

```typescript
function decorator<P extends unknown[]>(
  callback: (
    metadata: Record<string | symbol, unknown>,
    handler: HandlerMeta,
    params: P,
  ) => void,
): (...params: P) => MethodDecorator;
```

**Ejemplo — `@only_type('image')`**

```typescript title="custom-decorators.ts"
import { decorator } from "@arcaelas/whatsapp/decorators";
import type { Message } from "@arcaelas/whatsapp";

export const only_type = decorator<[type: Message["type"]]>(
  (_meta, handler, [type]) => {
    handler.guards.push((...args) => {
      const msg = args[0] as Message;
      return msg.type === type;
    });
  },
);
```

Uso:

```typescript
@only_type("image")
on_image(msg: Message) {
  /* ... */
}
```

La factory se autoregistra a `message:created` por el hecho de añadir un guard sin `@on` —
comportamiento idéntico a los `@guard` / `@from` integrados.

!!! info "Primitivas expuestas"
    La subentrada exporta `decorator()`, el símbolo `HANDLERS` y los tipos `HandlerMeta`,
    `BotSchema` y `WorkflowStep`. Leer el schema de una clase decorada es cuestión de
    `(MyBot as any)[Symbol.metadata]?.[HANDLERS]`. Todo lo demás (`resolve`,
    `register_workflow_step`, `ensure_schema`) es interno.

---

## Ver también

- [Examples / Decorator bot](../examples/decorator-bot.es.md) — ejemplo ejecutable completo.
- [References / Events](events.es.md) — nombres y payloads de eventos.
- [References / WhatsApp](whatsapp.es.md) — cliente subyacente.
