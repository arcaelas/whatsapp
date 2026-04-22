# Primeros pasos

Este tutorial te guía a través de una sesión completa de `@arcaelas/whatsapp`: inicializar un proyecto, elegir un motor de almacenamiento, escuchar eventos, emparejar el dispositivo, responder a un mensaje y apagar limpiamente.

---

## 1. Inicializa el proyecto

Crea un directorio nuevo y agrega el paquete:

```bash
mkdir whatsapp-bot && cd whatsapp-bot
yarn init -y
yarn add @arcaelas/whatsapp
yarn add -D tsx typescript @types/node
```

Crea un archivo `index.ts` en la raíz del proyecto — ahí vivirá el resto de esta guía.

---

## 2. Elige un motor

El `Engine` es la capa de persistencia para credenciales, chats, contactos y mensajes. La librería entrega dos implementaciones:

=== "FileSystemEngine (desarrollo local)"

    ```typescript title="index.ts"
    import { FileSystemEngine } from "@arcaelas/whatsapp";

    const engine = new FileSystemEngine(__dirname + "/.session");
    ```

    Almacena todo como archivos bajo el directorio que proporciones. Ideal para desarrollo y despliegues de un solo proceso.

=== "RedisEngine (producción)"

    ```typescript title="index.ts"
    import { RedisEngine } from "@arcaelas/whatsapp";
    import Redis from "ioredis";

    const engine = new RedisEngine(new Redis(process.env.REDIS_URL!), "bot:main");
    ```

    Respalda la sesión con Redis y asigna un espacio de nombres a las claves con el prefijo que pasas. Te permite escalar horizontalmente y sobrevivir a reinicios de contenedor.

!!! tip "Consejo"
    También puedes implementar la interfaz `Engine` tú mismo para apuntar a SQLite, S3, DynamoDB o lo que sea. Consulta [Engines](references/engines.es.md).

---

## 3. Instancia el cliente

`new WhatsApp(...)` no abre una conexión — solo conecta los delegados y el emisor de eventos.

```typescript title="index.ts" hl_lines="4 5 6 7"
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";

const engine = new FileSystemEngine(__dirname + "/.session");
const wa = new WhatsApp({
    engine,
    phone: 584144709840, // omite para usar emparejamiento por QR
});
```

El campo `phone` decide el flujo de emparejamiento: provéelo para recibir un PIN de 8 caracteres, u omítelo para recibir un buffer PNG con el QR.

---

## 4. Registra listeners antes de conectar

Siempre adjunta los listeners **antes** de llamar a `connect()` para que nunca pierdas los primeros eventos. Cada listener recibe el payload principal primero y la instancia `WhatsApp` al final; los eventos de mensaje y chat también reciben el `Chat` relacionado en medio.

```typescript title="index.ts"
wa.on("connected", () => {
    console.log("session ready");
});

wa.on("disconnected", () => {
    console.log("session closed");
});

wa.on("message:created", async (msg, chat, wa) => {
    if (msg.me) return;
    console.log(`[${chat.id}] ${msg.caption}`);
});
```

El mapa completo de eventos (`chat:*`, `contact:*`, `message:updated`, `message:reacted`, `message:seen`, etc.) está documentado en [Referencias](references/whatsapp.es.md).

---

## 5. Conecta y maneja el payload de emparejamiento

`connect(callback)` resuelve una vez que la sesión está sincronizada. El callback se dispara cada vez que baileys te entrega un nuevo artefacto de emparejamiento: un `string` (PIN) cuando `phone` está definido, o un `Buffer` (PNG QR) en caso contrario. El callback puede dispararse más de una vez si el código anterior expira antes de que el usuario complete el emparejamiento.

```typescript title="index.ts"
import { writeFileSync } from "node:fs";

await wa.connect(async (code) => {
    if (typeof code === "string") {
        console.log("Pair code:", code);
    } else if (Buffer.isBuffer(code)) {
        writeFileSync("qr.png", code);
        console.log("QR written to qr.png — scan it with WhatsApp");
    }
});
```

!!! success "Éxito"
    Cuando `connect()` resuelve, el motor tiene las credenciales persistidas. Las ejecuciones subsiguientes las reutilizan automáticamente — no se requiere un segundo emparejamiento.

---

## 6. Responde a los mensajes entrantes

El delegado `wa.Message` expone `text`, `image`, `video`, `audio`, `location` y `poll`. Pasa el id del chat (o cualquier identificador — teléfono, JID o LID) y el cuerpo:

```typescript title="index.ts" hl_lines="3 4 5"
wa.on("message:created", async (msg, chat, wa) => {
    if (msg.me) return;
    if (msg.caption?.toLowerCase() === "ping") {
        await wa.Message.text(chat.id, "pong");
    }
});
```

Cada método también tiene una variante de instancia sobre el mensaje mismo (`msg.text("...")`) que cita el mensaje original en la respuesta.

---

## 7. Apagado limpio

Cancela reconexiones pendientes y cierra el socket limpiamente en SIGINT:

```typescript title="index.ts"
process.on("SIGINT", async () => {
    await wa.disconnect();
    process.exit(0);
});
```

Pasa `{ destroy: true }` para también limpiar el motor al salir — útil en pruebas o al rotar cuentas.

---

## 8. Ejecútalo

```bash
npx tsx index.ts
```

La primera ejecución imprime el PIN (o escribe `qr.png`); empareja el dispositivo, espera el log `connected`, luego envía un mensaje a tu número para ver al listener dispararse.

---

## Profundizando

Algunas opciones del cliente que vale la pena conocer:

- **`autoclean`** *(por defecto `true`)* — ante un `loggedOut` remoto, limpia todo el motor para que el próximo `connect()` comience con un estado limpio. Ponlo en `false` para preservar el historial de chat/mensajes y solo descartar las credenciales.
- **`reconnect`** *(por defecto `true`)* — acepta `boolean`, un número de intentos máximos, o `{ max, interval }` (intervalo en segundos, por defecto 60). Los cierres transitorios disparados por el protocolo no consumen presupuesto de reintentos.
- **`sync`** *(por defecto `false`)* — habilita la sincronización completa de historial de baileys; los chats, contactos y mensajes importados se persisten a través del motor.

La lista completa de opciones, el mapa de eventos y las APIs de los delegados viven en [Referencias](references/whatsapp.es.md). Para recetas de extremo a extremo (bots, webhooks, decoradores, configuraciones multicuenta) navega el ejemplo [Bot Básico](examples/basic-bot.es.md) o la demostración del [Bot con Decoradores](examples/decorator-bot.es.md).
