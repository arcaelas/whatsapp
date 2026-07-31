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

El `Engine` es la capa de persistencia de credenciales, chats, contactos y mensajes. La librería incluye cuatro implementaciones:

=== "SQLiteEngine (recomendado)"

    ```typescript title="index.ts"
    import { DatabaseSync } from "node:sqlite";   // Node 22+
    import { SQLiteEngine } from "@arcaelas/whatsapp";

    // Node 20-21: import Database from 'better-sqlite3' y usa new Database(file)
    const engine = new SQLiteEngine(new DatabaseSync(".sessions/bot.db"));
    ```

    Un solo archivo, paginación indexada y binarios crudos. Requiere Node 22+ para `node:sqlite`, o
    `better-sqlite3` en runtimes anteriores.

=== "FileSystemEngine (desarrollo local)"

    ```typescript title="index.ts"
    import { FileSystemEngine } from "@arcaelas/whatsapp";

    const engine = new FileSystemEngine(__dirname + "/.session");
    ```

    Guarda todo como archivos JSON legibles bajo el directorio que le indiques. Ideal mientras
    exploras y quieres inspeccionar lo que la librería escribe.

=== "RedisEngine (distribuido)"

    ```typescript title="index.ts"
    import Redis from "ioredis";
    import { RedisEngine } from "@arcaelas/whatsapp";

    const redis = new Redis(process.env.REDIS_URL!);
    const engine = new RedisEngine(redis, "bot:main");
    ```

    Respalda la sesión en Redis y agrupa las claves con el prefijo que pases. Te permite escalar
    horizontalmente y sobrevivir reinicios de contenedores.

=== "S3Engine (serverless)"

    ```typescript title="index.ts"
    import { S3Client } from "@aws-sdk/client-s3";
    import { S3Engine } from "@arcaelas/whatsapp";

    const engine = new S3Engine({
        s3: new S3Client({ region: "us-east-1" }),
        bucket: "sessions",
        basedir: "wa/bot",
    });
    ```

    Para despliegues sin estado donde no hay ni disco ni Redis.

!!! tip "Consejo"
    También puedes implementar tú mismo la interfaz `Engine` para apuntar a PostgreSQL, DynamoDB o lo que necesites. Ver [Engines](references/engines.es.md).

---

## 3. Instancia el cliente

`new WhatsApp(...)` no abre una conexión — solo cablea las entidades y el emisor de eventos.

```typescript title="index.ts" hl_lines="4 5 6 7"
import { DatabaseSync } from "node:sqlite";
import { WhatsApp, SQLiteEngine } from "@arcaelas/whatsapp";

const engine = new SQLiteEngine(new DatabaseSync(".sessions/bot.db"));
const wa = new WhatsApp({
    engine,
    phone: 584144709840, // omítelo para caer en emparejamiento por QR
});
```

El campo `phone` decide el flujo de emparejamiento: proporciónalo para recibir un PIN, u omítelo para
recibir un buffer PNG con el QR. Con `phone` puesto, todavía puedes forzar el QR con `method: 'qr'`.

---

## 4. Registra listeners antes de conectar

Engancha siempre los listeners **antes** de llamar a `connect()` para no perderte los primeros eventos. Cada listener recibe primero el payload principal y la instancia de `WhatsApp` al final; los eventos de mensaje y de contacto también reciben el `Chat` relacionado en el medio.

```typescript title="index.ts"
wa.on("connected", () => {
    console.log("sesión lista");
});

wa.on("disconnected", () => {
    console.log("sesión cerrada");
});

wa.on("message:created", async (msg, chat) => {
    if (!msg.me) {
        console.log(`[${chat.name}] ${msg.caption}`);
    }
});
```

El mapa completo de eventos (`chat:*`, `contact:*`, `message:*`, `feed:*`) está documentado en [Events](references/events.es.md).

---

## 5. Conecta y maneja el payload de emparejamiento

`connect(callback)` resuelve una vez que la sesión sincroniza. El callback se dispara cada vez que baileys te entrega un artefacto de emparejamiento nuevo: un `string` (PIN) cuando hay `phone`, o un `Buffer` (QR en PNG) si no. Puede dispararse más de una vez si el código anterior expira antes de completar el emparejamiento.

```typescript title="index.ts"
import { writeFileSync } from "node:fs";

await wa.connect(async (code) => {
    if (typeof code === "string") {
        console.log("Código de emparejamiento:", code);
    } else {
        writeFileSync("qr.png", code);
        console.log("QR escrito en qr.png — escanéalo con WhatsApp");
    }
});
```

!!! success "Éxito"
    Cuando `connect()` resuelve, el motor ya tiene las credenciales persistidas. Las ejecuciones siguientes las reutilizan automáticamente — no hace falta emparejar de nuevo.

---

## 6. Responde a los mensajes entrantes

Responder es un método del propio mensaje — cita el original automáticamente. Para enviar sin citar,
usa el delegado `wa.Message` con el id del chat.

```typescript title="index.ts" hl_lines="3 6"
wa.on("message:created", async (msg, chat) => {
    if (!msg.me && msg.caption.toLowerCase() === "ping") {
        await msg.text("pong");                        // respuesta citada
    }
    if (!msg.me && msg.caption.toLowerCase() === "hola") {
        await wa.Message.text(chat.id, "¡hola!");      // mensaje suelto
    }
});
```

`wa.Message` cubre los nueve tipos enviables: `text`, `image`, `video`, `audio`, `document`,
`location`, `poll`, `vcard` y `event` (los stickers se reciben, no se envían). Ver
[Messages](references/message.es.md).

---

## 7. Apagado ordenado

Cancela reconexiones pendientes y cierra el socket limpiamente ante SIGINT:

```typescript title="index.ts"
process.on("SIGINT", async () => {
    await wa.disconnect();
    process.exit(0);
});
```

Pasa `{ destroy: true }` para además vaciar el motor al salir — útil en pruebas o al rotar cuentas.

---

## 8. Ejecútalo

```bash
npx tsx index.ts
```

La primera ejecución imprime el PIN (o escribe `qr.png`); empareja el dispositivo, espera el log de `connected` y luego envía un mensaje a tu número para ver el listener dispararse.

---

## Yendo más allá

Algunas opciones del cliente que vale la pena conocer:

- **`method`** *(por defecto `'otp'`)* — solo tiene sentido junto con `phone`: cámbialo a `'qr'` para obtener el QR aunque haya un número configurado.
- **`autoclean`** *(por defecto `true`)* — ante un `loggedOut` remoto, limpia el motor completo para que el próximo `connect()` arranque de cero. Ponlo en `false` para conservar el historial de chats/mensajes y descartar solo las credenciales.
- **`reconnect`** *(por defecto `true`)* — acepta un booleano, un número de intentos máximos, o `{ max, interval }` (intervalo en segundos, por defecto 60). Los cierres transitorios que dispara el protocolo no consumen presupuesto de reintentos.
- **`sync`** *(por defecto `true`)* — descarga el historial completo de mensajes al vincular. Ponlo en `false` para un primer sync más liviano; los contactos, las credenciales y los LID mappings se sincronizan igual.

La lista completa de opciones, el mapa de eventos y las APIs de las entidades viven en [Referencias](references/whatsapp.es.md). Para recetas de punta a punta, revisa el ejemplo [Bot Básico](examples/basic-bot.es.md) o la muestra del [Bot con Decoradores](examples/decorator-bot.es.md).
