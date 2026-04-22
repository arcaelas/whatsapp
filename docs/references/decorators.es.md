# Decorators

API de decoradores Stage 3 construida sobre el cliente de WhatsApp. Opt-in a través de la subentrada `@arcaelas/whatsapp/decorators`; el paquete principal (`@arcaelas/whatsapp`) permanece sin cambios.

La capa de decoradores cablea los métodos declarados en una clase contra el event emitter real en el momento de `connect()`. No reemplaza al cliente: vincula métodos decorados a eventos, timers, callbacks de emparejamiento y workflows secuenciales.

---

## Importación

```typescript title="bot.ts"
import {
  Bot,
  on,
  guard,
  once,
  connect,
  disconnect,
  every,
  pair,
  from,
  pipe,
  command,
  WhatsAppBot,
} from "@arcaelas/whatsapp/decorators";
```

---

## Requisitos

!!! info "Entorno"
    - **Node.js ≥ 20**. El paquete incluye un polyfill interno de `Symbol.metadata`, por lo que el runtime no necesita soporte nativo.
    - **TypeScript ≥ 5**. Usa decoradores Stage 3 nativos. **No** habilites `experimentalDecorators` ni `emitDecoratorMetadata` en `tsconfig.json`: apuntan a la propuesta legacy y son incompatibles.
    - No se requiere dependencia de Reflect-metadata.

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

## Visión general

| Decorador | Signatura | Resumen |
|-----------|-----------|---------|
| `@Bot` | `(options: IWhatsApp) => ClassDecorator` | Convierte una clase en una subclase de `WhatsAppBot` con opciones por defecto. |
| `@on` | `(event: string) => MethodDecorator` | Suscribe el método a un evento del cliente. Apilable. |
| `@guard` | `(pred: (...args) => boolean \| Promise<boolean>) => MethodDecorator` | Pre-verificación ejecutada antes del handler. Apilable (AND). |
| `@once` | `(event?: string) => MethodDecorator` | Ejecuta el handler una vez, luego se desuscribe. Acepta un atajo opcional de evento. |
| `@connect` | `() => MethodDecorator` | Alias de `@on('connected')`. |
| `@disconnect` | `() => MethodDecorator` | Alias de `@on('disconnected')`. |
| `@every` | `(ms: number) => MethodDecorator` | Timer periódico vinculado al ciclo de vida de la conexión. |
| `@pair` | `() => MethodDecorator` | Callback de emparejamiento (PIN/QR). Múltiples métodos se ejecutan en paralelo. |
| `@from` | `(src: string \| string[] \| (jid) => boolean) => MethodDecorator` | Filtra por autor del mensaje (JID, LID o teléfono). |
| `@command` | `(pattern: string \| RegExp) => MethodDecorator` | Comando textual sobre `message:created` con parsing de argumentos. |
| `@pipe` | `(workflow: string, index: number) => MethodDecorator` | Paso de pipeline secuencial compartiendo argumentos mutables. |

---

## `@Bot(options)`

Decorador de clase que convierte el target en una subclase de `WhatsAppBot`. El consumidor **no** necesita extender `WhatsAppBot` manualmente. En tiempo de construcción, el override parcial pasado a `new Bot(override?)` se fusiona sobre los `default_options` entregados al decorador.

**Signatura**

```typescript
function Bot(default_options: IWhatsApp): ClassDecorator;
```

**Comportamiento**

- La subclase producida hereda de `WhatsAppBot`, por lo que `connect()` es el punto de entrada del cableado.
- Los métodos y la metadata de la clase original se copian a la subclase generada.
- El constructor acepta un `Partial<IWhatsApp>` que sobreescribe los defaults del decorador.

```typescript title="minimal-bot.ts"
import Redis from "ioredis";
import { Bot, connect, RedisEngine } from "@arcaelas/whatsapp/decorators";

@Bot({
  engine: new RedisEngine(new Redis()),
  phone: "5491112345678",
})
class MyBot {
  @connect()
  on_open() {
    console.log("connected");
  }
}

const bot = new MyBot();
await bot.connect();
```

Pasando un override en tiempo de construcción:

```typescript
const staging = new MyBot({ phone: "5491199999999" });
```

---

## `@on(event)`

Suscribe el método a un evento del cliente. El decorador es **apilable**: múltiples entradas `@on` sobre el mismo método registran múltiples suscripciones sin duplicación dentro del mismo método.

```typescript
@on("message:created")
@on("message:updated")
log_message(msg: Message, chat: Chat, wa: WhatsApp) {
  console.log(msg.id);
}
```

Los nombres de eventos válidos están documentados en [References / Events](events.es.md). Valores comunes incluyen `connected`, `disconnected`, `message:created`, `message:updated`, `message:reacted`, `contact:created`, `contact:updated`, `chat:created`, `chat:updated`.

!!! tip "Payload del listener"
    Los argumentos del handler reflejan el payload del emisor. Para eventos de mensaje la signatura es `(msg, chat, wa)`; para eventos de contacto `(contact, chat, wa)`.

---

## `@guard(pred)`

Registra un predicado evaluado **antes** del handler. Múltiples guards se acumulan y se evalúan secuencialmente en orden de declaración con semántica **AND**: cualquier guard que devuelva falsy hace corto-circuito y el handler no se ejecuta.

```typescript
@on("message:created")
@guard((msg: Message) => !msg.me)
@guard((msg: Message) => msg.type === "text")
on_inbound_text(msg: Message) {
  /* ... */
}
```

**Auto-registro**: si el método no tiene un `@on` explícito pero tiene al menos un `@guard` (o `@from`, que añade un guard internamente), se registra implícitamente a `message:created`.

```typescript
// Equivalente a @on('message:created') + @guard(...)
@guard((msg: Message) => msg.type === "image")
on_image(msg: Message) {
  /* ... */
}
```

---

## `@once()` / `@once(event)`

Marca el handler para dispararse **una vez** y luego autodesuscribirse. Dos formas:

- `@once()` — modificador puro, combínalo con `@on` (o con un auto-registro implícito).
- `@once(event)` — atajo equivalente a `@on(event) + @once()`.

```typescript
@once("connected")
greet_once() {
  console.log("first connection");
}

@on("message:created")
@once()
first_message(msg: Message) {
  console.log("first inbound message");
}
```

---

## `@connect()` / `@disconnect()`

Alias semánticos de `@on('connected')` y `@on('disconnected')`. El método se ejecuta cuando la conexión de WhatsApp se abre o se cierra respectivamente.

```typescript
@connect()
on_open() {
  console.log("connected");
}

@disconnect()
on_close() {
  console.log("disconnected");
}
```

---

## `@every(ms)`

Instala un timer periódico. El intervalo comienza cuando se emite `connected` y se limpia en `disconnected`, por lo que el callback no se ejecuta mientras el cliente está offline.

```typescript
@every(30_000)
async heartbeat() {
  console.log("tick", Date.now());
}
```

!!! warning "Advertencia"
    Los callbacks de timer no reciben argumentos. Si necesitas acceso al cliente, captúralo vía `this` (el método está vinculado a la instancia del bot).

---

## `@pair()`

Marca el método como callback de emparejamiento. Cuando baileys entrega un PIN o QR, todos los métodos `@pair` son invocados en paralelo vía `Promise.all`. Un argumento `connect(callback?)` — si se pasa — se ejecuta junto a ellos.

```typescript
@pair()
async on_pin(code: string | Buffer) {
  if (Buffer.isBuffer(code)) {
    await writeFile("qr.png", code);
  } else {
    console.log("pair code:", code);
  }
}
```

Dado que `connect()` ya no necesita un callback explícito cuando `@pair` está presente:

```typescript
await bot.connect(); // pairing manejado por métodos @pair
```

---

## `@from(source)`

Filtra `message:created` por el autor del mensaje. La fuente es una de:

- `string` — JID (`5491112345678@s.whatsapp.net`), LID (`<digits>@lid`) o número de teléfono plano (`5491112345678`).
- `string[]` — cualquiera de las entradas coincide (OR).
- `(jid: string) => boolean` — predicado personalizado sobre `msg.from`.

Los strings se normalizan la primera vez que el guard se ejecuta, usando el resolver interno `wa._resolve_jid(uid)`. Los resultados se cachean en un `Set` del handler, por lo que las invocaciones subsecuentes son O(1).

```typescript
@command("/ban")
@from(["5491111111111", "5492222222222"])
ban_user(msg: Message, chat: Chat, args: string[]) {
  /* admin-only */
}

@from((jid) => jid.endsWith("@s.whatsapp.net"))
personal_only(msg: Message) {
  /* ... */
}
```

**Auto-registro**: como con `@guard`, un método decorado solo con `@from` (sin `@on`) se autoregistra a `message:created`.

---

## `@command(pattern)`

Atajo para un comando textual sobre `message:created`. Internamente aplica:

1. `@on('message:created')`.
2. Un guard que coincide `pattern` contra `msg.caption`:
   - patrón `string` → `startsWith`.
   - patrón `RegExp` → `test`.
3. Una transformación que reescribe los argumentos a `(msg, chat, args)`:
   - Para un patrón string, `args` es el texto restante dividido por whitespace.
   - Para un `RegExp`, `args` es `match.slice(1)` (capture groups).

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

!!! note "Forma del argumento"
    `@command` reescribe la signatura del handler de `(msg, chat, wa)` a `(msg, chat, args)`. La instancia `wa` sigue accesible vía `this`.

---

## `@pipe(workflow, index)`

Registra el método como un paso dentro de un **workflow** con nombre. Todos los pasos con el mismo nombre `workflow` se ejecutan secuencialmente en cada `message:created`, ordenados por `index` ascendente. Los pasos comparten los mismos argumentos (`msg`, `chat`, `wa`), por lo que las mutaciones sobre esos objetos se propagan a los pasos posteriores.

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

- Secuencial: cada paso es esperado antes del siguiente.
- Estado compartido: las mutaciones sobre `msg`/`chat` son visibles aguas abajo.
- No aplican guards / eventos — `@pipe` es autónomo.
- Múltiples workflows coexisten; cada uno se ejecuta independientemente sobre `message:created`.

!!! warning "No mezcles con `@on` en el mismo método"
    Un método decorado con `@pipe` está registrado únicamente como un paso. Añadir `@on` o `@guard` sobre el mismo método no tiene efecto sobre el workflow.

---

## Reglas de apilado

Leyenda: ✅ componer · ⚠️ componible, lee la nota · ❌ no soportado.

| Con → / Base ↓ | `@on` | `@guard` | `@once` | `@from` | `@command` | `@pipe` | `@every` | `@pair` |
|---|---|---|---|---|---|---|---|---|
| `@on` (apilable) | ✅ | ✅ | ✅ | ✅ | ⚠️ redundante | ❌ | ⚠️ | ❌ |
| `@guard` (apilable) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ⚠️ | ❌ |
| `@once` | ✅ | ✅ | — | ✅ | ✅ | ❌ | ❌ | ❌ |
| `@from` (único) | ✅ | ✅ | ✅ | ❌ dos `@from` | ✅ | ❌ | ❌ | ❌ |
| `@command` (único) | ⚠️ | ✅ | ✅ | ✅ | ❌ dos `@command` | ❌ | ❌ | ❌ |
| `@pipe` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ colisiona mismo index de paso | ❌ | ❌ |
| `@every` | ⚠️ emite evento `__every:*` — no combines con eventos reales | ⚠️ guards se ejecutan sin mensaje | ❌ | ❌ | ❌ | ❌ | ❌ ms duplicados crean dos timers | ❌ |
| `@pair` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ múltiples métodos se ejecutan en paralelo |

Notas clave:

- **`@command` + `@command`** sobre el mismo método es inválido — el segundo patrón reemplaza la primera transformación; declara dos métodos en su lugar.
- **`@from` + `@from`** sobre el mismo método: solo el **último** conjunto registrado se respeta en términos de resolución de fuente; para OR matching pasa un array a un único `@from`.
- **`@pipe` es terminal**: un método marcado como paso de pipe no debe llevar ningún otro decorador.
- **`@every` + `@on`** registra el método tanto al timer como a un evento — la invocación del timer no recibe args, lo que puede romper handlers que esperan `(msg, chat, wa)`.
- **`@pair` es su propio canal** (`__pair`); nunca combines con `@on`.

---

## Semántica de ejecución

### Despacho de listeners

Los listeners del mismo evento se ejecutan **concurrentemente** bajo el EventEmitter — el emitter subyacente llama a los listeners sincrónicamente sin esperarlos, por lo que dos handlers para `message:created` comienzan en paralelo.

Dentro de un handler único el flujo es **secuencial**:

1. Todos los `guards` se esperan en orden de declaración (AND con corto-circuito).
2. Todos los `transforms` se esperan en orden de declaración, produciendo la lista final de argumentos.
3. El cuerpo del handler se ejecuta con los argumentos transformados.

### Timers

Los handlers de `@every(ms)` arrancan con el evento `connected` vía `setInterval(run, ms)` y se cancelan en `disconnected`. Un ciclo de reconexión, por lo tanto, los rearma desde cero.

### Pairing

Los callbacks de `@pair` se recolectan en `connect()` e invocan en paralelo con `Promise.all`. Si el consumidor pasa un callback a `connect(callback)`, este se ejecuta en paralelo junto a los callbacks basados en decoradores.

### Workflows

Un grupo `@pipe(workflow, _)` se registra como un único listener sobre `message:created`. Cuando el evento se dispara, los pasos se ordenan por `index` y se esperan secuencialmente:

```typescript
for (const step of sorted_steps) {
  await step(msg, chat, wa);
}
```

Como los argumentos son compartidos, las mutaciones sobre `msg` o `chat` son observables por pasos subsecuentes.

---

## Avanzado: decoradores personalizados

La infraestructura expone una factory `decorator<P>()` para construir tus propios decoradores paramétricos sin tocar la capa de metadata directamente. El callback muta la entrada resuelta `HandlerMeta`: empuja eventos, guards, transforms o cambia `once`.

**Signatura**

```typescript
function decorator<P extends unknown[]>(
  callback: (
    metadata: Record<string | symbol, unknown>,
    handler: HandlerMeta,
    params: P,
  ) => void,
): (...params: P) => MethodDecorator;
```

**Ejemplo — `@onlyType('image')`**

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

La factory autoregistra a `message:created` en virtud del guard añadido sin un `@on`: comportamiento idéntico al de los `@guard` / `@from` incluidos.

!!! info "Primitivas expuestas"
    Para casos más complejos (timers, workflows, nuevos canales de eventos) los siguientes son públicos: `HANDLERS` (symbol), `HandlerMeta`, `BotSchema`, `WorkflowStep`, `register_workflow_step()`. Ver `src/lib/bot/decorator.ts` para el contrato de schema completo.

---

## Ver también

- [Examples / Decorator bot](../examples/decorator-bot.es.md) — ejemplo ejecutable completo.
- [References / Events](events.es.md) — nombres y payloads de eventos.
- [References / WhatsApp](whatsapp.es.md) — cliente subyacente.
