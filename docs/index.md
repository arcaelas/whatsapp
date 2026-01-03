# @arcaelas/whatsapp

> **Libreria TypeScript para automatizacion de WhatsApp**
> Basada en Baileys | Tipado completo | Multiples engines de persistencia | Facil de usar

---

## Caracteristicas

- **Conexion simplificada** - QR o codigo de emparejamiento en una sola llamada
- **Eventos tipados** - TypeScript completo con autocompletado
- **Persistencia flexible** - Memory, FileSystem o Amazon S3
- **Clases intuitivas** - Chat, Contact, Message con metodos encadenables
- **Mensajes tipados** - Text, Image, Video, Audio, Location, Poll
- **Gestion de grupos** - Listar miembros, archivar, silenciar, fijar
- **Soporte de encuestas** - Crear y votar en encuestas

---

## Inicio Rapido

```typescript
import { WhatsApp } from "@arcaelas/whatsapp";

// Crear instancia
const wa = new WhatsApp({
  phone: "5491112345678",  // Opcional: para codigo de emparejamiento
  sync: true,              // Sincronizar historial
  online: false,           // No mostrar "en linea"
});

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

// Esperar sincronizacion
await wa.sync((progress) => console.log(`Sincronizando: ${progress}%`));

// Escuchar mensajes
wa.on("message:created", async (msg) => {
  // Verificar tipo con instanceof
  if (msg instanceof wa.Message.Text) {
    const text = (await msg.content()).toString();
    console.log(`${msg.uid}: ${text}`);

    // Responder
    if (text === "hola") {
      await wa.Message.Message.text(msg.cid, "Hola! Como estas?");
    }
  }
});
```

---

## Tipos de Mensaje

La libreria soporta multiples tipos de mensaje, cada uno con metodos especificos:

| Tipo | Clase | Metodos especiales |
|------|-------|-------------------|
| Texto | `wa.Message.Text` | `edit()`, `forward()` |
| Imagen | `wa.Message.Image` | `forward()` |
| Video | `wa.Message.Video` | `forward()` |
| Audio | `wa.Message.Audio` | `forward()` |
| Ubicacion | `wa.Message.Location` | `coords()`, `forward()` |
| Encuesta | `wa.Message.Poll` | `count()` |

```typescript
wa.on("message:created", async (msg) => {
  if (msg instanceof wa.Message.Image) {
    const buffer = await msg.content();
    console.log(`Imagen recibida: ${buffer.length} bytes`);
    // Reenviar a otro chat
    await msg.forward("5491198765432@s.whatsapp.net");
  }

  if (msg instanceof wa.Message.Poll) {
    const poll = await msg.count();
    console.log(`Encuesta: ${poll?.content}`);
    poll?.items.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.content} (${item.count} votos)`);
    });
  }
});
```

---

## Engines de Persistencia

Elige donde almacenar sesion, contactos, chats y mensajes:

=== "FileEngine (default)"
    ```typescript
    import { WhatsApp, FileEngine } from "@arcaelas/whatsapp";

    const wa = new WhatsApp({
      engine: new FileEngine(".baileys/mi-bot"),
    });
    ```

=== "MemoryEngine"
    ```typescript
    import { WhatsApp, MemoryEngine } from "@arcaelas/whatsapp";

    // Ideal para testing - datos se pierden al cerrar
    const wa = new WhatsApp({
      engine: new MemoryEngine(),
    });
    ```

=== "S3Engine"
    ```typescript
    import { WhatsApp, S3Engine } from "@arcaelas/whatsapp";

    const wa = new WhatsApp({
      engine: new S3Engine({
        bucket: "mi-bucket",
        prefix: ".baileys/produccion",
        credentials: {
          region: "us-east-1",
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      }),
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
