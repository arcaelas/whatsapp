# @arcaelas/whatsapp

![Banner](assets/banner.png)

Una librería de TypeScript para automatización de WhatsApp construida sobre [baileys v7](https://github.com/WhiskeySockets/Baileys). Entrega un núcleo basado en clases, motores de persistencia intercambiables y una DSL de decoradores Stage 3 para construir bots — todo sin claves de API externas.

---

## Características

- **API basada en clases**: un único orquestador `WhatsApp` con las entidades `Contact`, `Chat` y `Message` ligadas a la sesión. El socket y las credenciales quedan privados: interactúas por métodos y eventos.
- **Motores intercambiables**: `SQLiteEngine` (el más rápido de los integrados), `FileSystemEngine` para desarrollo local, `RedisEngine` y `S3Engine` para despliegues distribuidos, o implementa tu propio `Engine`.
- **Diez tipos de mensaje**: texto, imagen, video, audio, sticker, documento, ubicación, encuesta, vCard y evento de calendario — cada uno una subclase con sus propios getters (`width`, `duration`, `waveform`, `options`, …).
- **Estados**: publica y consume estados a través de la entidad `Feed` y los eventos `feed:*`.
- **DSL de decoradores**: sub-entrada opcional `@arcaelas/whatsapp/decorators` con `@Bot`, `@on`, `@once`, `@guard`, `@from`, `@command`, `@pipe`, `@every`, `@delay`, `@pair`.
- **Sistema de eventos completo**: `connected`, `disconnected`, `message:*`, `chat:*`, `contact:*`, `feed:*` — cada listener recibe el artefacto primero y el cliente al final.
- **Resolución de identificadores**: normalización transparente entre números de teléfono, JID (`@s.whatsapp.net`) y LID (`@lid`).
- **Aislamiento multicuenta**: cada instancia `WhatsApp` posee su propio espacio de nombres en el motor, por lo que múltiples sesiones pueden coexistir en el mismo proceso.

---

## Hola mundo

```typescript title="index.ts"
import WhatsApp, { FileSystemEngine } from "@arcaelas/whatsapp";
import { writeFileSync } from "node:fs";

const wa = new WhatsApp({
    engine: new FileSystemEngine(__dirname + "/.session"),
    phone: 5491112345678,
});

wa.on("connected", () => console.log("sesión lista"));

wa.on("message:created", async (msg, chat) => {
    if (!msg.me && msg.caption === "ping") {
        await msg.text("pong 🏓");
    }
});

// Con `phone` el callback recibe un PIN; sin él, el QR como Buffer PNG.
await wa.connect((code) => {
    if (typeof code === "string") console.log("PIN:", code);
    else writeFileSync("qr.png", code);
});
```

---

## Próximos pasos

- [Instalación](installation.es.md) — instala el paquete y configura el entorno de ejecución.
- [Primeros pasos](getting-started.es.md) — un tutorial guiado desde cero hasta un bot en funcionamiento.
- [Referencias](references/whatsapp.es.md) — la superficie completa de la API de cada clase y opción.
