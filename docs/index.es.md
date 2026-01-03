# @arcaelas/whatsapp

![Banner](assets/banner.png)

> **Libreria TypeScript para automatizacion de WhatsApp**
> Basada en Baileys | Tipado completo | Engine de persistencia flexible | Facil de usar

---

## Caracteristicas

- **Conexion simplificada** - QR o codigo de emparejamiento en una sola llamada
- **Eventos tipados** - TypeScript completo con autocompletado
- **Persistencia flexible** - FileEngine por defecto, o implementa tu propio Engine
- **Clases intuitivas** - Chat, Contact, Message con metodos estaticos
- **Multiples tipos de mensaje** - text, image, video, audio, location, poll
- **Gestion de grupos** - Listar miembros, archivar, silenciar, fijar
- **Soporte de encuestas** - Crear encuestas con multiples opciones

---

## Inicio Rapido

```typescript
import { WhatsApp } from "@arcaelas/whatsapp";

// Crear instancia
const wa = new WhatsApp({
  phone: "5491112345678", // Opcional: para codigo de emparejamiento
});

// Escuchar eventos
wa.event.on("open", () => console.log("Conectado!"));
wa.event.on("close", () => console.log("Desconectado"));
wa.event.on("error", (err) => console.error("Error:", err.message));

// Conectar
await wa.pair(async (data) => {
  if (Buffer.isBuffer(data)) {
    // QR code como imagen PNG
    require("fs").writeFileSync("qr.png", data);
    console.log("Escanea el QR en qr.png");
  } else {
    // Codigo de emparejamiento (8 digitos)
    console.log("Codigo:", data);
  }
});

// Escuchar mensajes
wa.event.on("message:created", async (msg) => {
  if (msg.me) return; // Ignorar mensajes propios

  // Verificar tipo
  if (msg.type === "text") {
    const text = (await msg.content()).toString();
    console.log(`Mensaje: ${text}`);

    // Responder
    if (text.toLowerCase() === "hola") {
      await wa.Message.text(msg.cid, "Hola! Como estas?");
    }
  }
});
```

---

## Tipos de Mensaje

La libreria soporta multiples tipos de mensaje:

| Tipo | `msg.type` | Descripcion |
|------|------------|-------------|
| Texto | `"text"` | Mensaje de texto plano |
| Imagen | `"image"` | Imagen con caption opcional |
| Video | `"video"` | Video con caption opcional |
| Audio | `"audio"` | Nota de voz o audio |
| Ubicacion | `"location"` | Coordenadas geograficas |
| Encuesta | `"poll"` | Encuesta con opciones |

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me) return;

  if (msg.type === "image") {
    const buffer = await msg.content();
    console.log(`Imagen recibida: ${buffer.length} bytes`);
    if (msg.caption) {
      console.log(`Caption: ${msg.caption}`);
    }
  }

  if (msg.type === "poll") {
    const buffer = await msg.content();
    const poll = JSON.parse(buffer.toString());
    console.log(`Encuesta: ${poll.content}`);
    poll.options.forEach((opt: { content: string }, i: number) => {
      console.log(`  ${i + 1}. ${opt.content}`);
    });
  }
});
```

---

## Engine de Persistencia

Por defecto se usa `FileEngine`. Puedes implementar tu propio engine:

=== "FileEngine (default)"
    ```typescript
    import { WhatsApp, FileEngine } from "@arcaelas/whatsapp";

    const wa = new WhatsApp({
      engine: new FileEngine(".baileys/mi-bot"),
    });
    ```

=== "Engine personalizado"
    ```typescript
    import { WhatsApp } from "@arcaelas/whatsapp";
    import type { Engine } from "@arcaelas/whatsapp";

    // Implementa la interfaz Engine
    class RedisEngine implements Engine {
      async get(key: string): Promise<string | null> { /* ... */ }
      async set(key: string, value: string | null): Promise<void> { /* ... */ }
      async list(prefix: string, offset?: number, limit?: number): Promise<string[]> { /* ... */ }
    }

    const wa = new WhatsApp({
      engine: new RedisEngine(),
    });
    ```

---

## Siguiente Paso

<div class="grid cards" markdown>

-   :material-download:{ .lg .middle } **Instalacion**

    ---

    Instrucciones detalladas para instalar la libreria

    [:octicons-arrow-right-24: Ver guia](installation.md)

-   :material-rocket-launch:{ .lg .middle } **Primeros Pasos**

    ---

    Tutorial paso a paso para crear tu primer bot

    [:octicons-arrow-right-24: Comenzar](getting-started.md)

-   :material-api:{ .lg .middle } **Referencias API**

    ---

    Documentacion completa de todas las clases

    [:octicons-arrow-right-24: Ver API](references/whatsapp.md)

-   :material-code-tags:{ .lg .middle } **Ejemplos**

    ---

    Ejemplos practicos listos para usar

    [:octicons-arrow-right-24: Ver ejemplos](examples/basic-bot.md)

</div>

---

**Desarrollado por [Arcaelas Insiders](https://github.com/arcaelas)**
