# @arcaelas/whatsapp

![Banner](assets/banner.png)

Una librería de TypeScript para automatización de WhatsApp construida sobre [baileys v7](https://github.com/WhiskeySockets/Baileys). Entrega un núcleo basado en clases, motores de persistencia intercambiables y una DSL de decoradores Stage 3 para construir bots — todo sin claves de API externas.

---

## Características

- **API basada en clases**: un único orquestador `WhatsApp` con delegados `Message`, `Chat` y `Contact`.
- **Motores intercambiables**: `FileSystemEngine` para desarrollo local, `RedisEngine` para producción, o implementa tu propio `Engine`.
- **DSL de decoradores**: sub-entrada opcional `@arcaelas/whatsapp/decorators` con `@Bot`, `@on`, `@guard`, `@command`, `@pipe`, `@every`, `@pair`.
- **Sistema de eventos completo**: `connected`, `disconnected`, `message:*`, `chat:*`, `contact:*` — cada listener recibe `(payload, chat, wa)`.
- **Resolución de identificadores**: normalización transparente entre números de teléfono, JID (`@s.whatsapp.net`) y LID (`@lid`).
- **Aislamiento multicuenta**: cada instancia `WhatsApp` posee su propio espacio de nombres en el motor, por lo que múltiples sesiones pueden coexistir en el mismo proceso.

---

## Hola mundo

```typescript title="index.ts"
import { WhatsApp, FileSystemEngine } from "@arcaelas/whatsapp";
import { writeFileSync } from "node:fs";

const wa = new WhatsApp({
    engine: new FileSystemEngine(__dirname + "/.session"),
    phone: 584144709840,
});

wa.on("connected", () => console.log("session ready"));
wa.on("message:created", (msg, chat) => console.log(chat.id, msg.caption));

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
