# Bot Basico

Ejemplo de un bot simple que responde a mensajes.

---

## Codigo completo

```typescript title="bot.ts"
import { WhatsApp } from "@arcaelas/whatsapp";

async function main() {
  const wa = new WhatsApp();

  // Eventos de conexion
  wa.event.on("open", () => console.log("Bot conectado!"));
  wa.event.on("close", () => console.log("Bot desconectado"));
  wa.event.on("error", (err) => console.error("Error:", err.message));

  // Escuchar mensajes
  wa.event.on("message:created", async (msg) => {
    // Ignorar mensajes propios
    if (msg.me) return;

    // Solo procesar texto
    if (msg.type !== "text") return;

    const text = (await msg.content()).toString().toLowerCase();

    // Respuestas simples
    if (text === "hola") {
      await wa.Message.text(msg.cid, "Hola! Soy un bot. Escribe 'ayuda' para ver opciones.");
    }

    if (text === "ayuda") {
      await wa.Message.text(
        msg.cid,
        "Comandos disponibles:\n" +
        "- hola: Saludo\n" +
        "- hora: Hora actual\n" +
        "- fecha: Fecha actual\n" +
        "- ping: Test de respuesta"
      );
    }

    if (text === "hora") {
      await wa.Message.text(msg.cid, `Son las ${new Date().toLocaleTimeString("es-AR")}`);
    }

    if (text === "fecha") {
      await wa.Message.text(msg.cid, `Hoy es ${new Date().toLocaleDateString("es-AR", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      })}`);
    }

    if (text === "ping") {
      const start = Date.now();
      await wa.Message.text(msg.cid, "pong!");
      console.log(`Latencia: ${Date.now() - start}ms`);
    }
  });

  // Conectar
  console.log("Iniciando bot...");
  await wa.pair(async (data) => {
    if (Buffer.isBuffer(data)) {
      require("fs").writeFileSync("qr.png", data);
      console.log("Escanea el QR en qr.png");
    } else {
      console.log("Codigo de emparejamiento:", data);
    }
  });

  console.log("Bot listo para recibir mensajes!");
}

main().catch(console.error);
```

---

## Ejecutar

```bash
npx tsx bot.ts
```

1. Escanea el QR que aparece en `qr.png`
2. Envia "hola" al bot desde otro telefono
3. El bot respondera automaticamente

---

## Mejoras opcionales

### Agregar reacciones

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "text") return;

  const text = (await msg.content()).toString().toLowerCase();

  // Reaccionar segun contenido
  if (text.includes("gracias")) {
    await wa.Message.react(msg.cid, msg.id, "❤️");
  } else if (text.includes("jaja")) {
    await wa.Message.react(msg.cid, msg.id, "😂");
  }
});
```

### Responder con cita

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "text") return;

  const text = (await msg.content()).toString().toLowerCase();

  if (text === "eco") {
    // Responder citando el mensaje original
    await wa.Message.text(msg.cid, "Esto es un eco!");
  }
});
```
