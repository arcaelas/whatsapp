# Bot Basico

Ejemplo de un bot simple que responde a mensajes.

---

## Codigo completo

```typescript title="bot.ts"
import { WhatsApp } from "@arcaelas/whatsapp";

async function main() {
  const wa = new WhatsApp({
    sync: true,
    online: false,
  });

  // Eventos de conexion
  wa.on("open", () => console.log("Bot conectado!"));
  wa.on("close", () => console.log("Bot desconectado"));
  wa.on("error", (err) => console.error("Error:", err.message));

  // Escuchar mensajes
  wa.on("message:created", async (msg) => {
    // Ignorar mensajes propios
    if (msg.me) return;

    // Solo procesar texto
    if (!(msg instanceof wa.Message.Text)) return;

    const text = (await msg.content()).toString().toLowerCase();

    // Respuestas simples
    if (text === "hola") {
      await wa.Message.Message.text(msg.cid, "Hola! Soy un bot. Escribe 'ayuda' para ver opciones.");
    }

    if (text === "ayuda") {
      await wa.Message.Message.text(
        msg.cid,
        "Comandos disponibles:\n" +
        "- hola: Saludo\n" +
        "- hora: Hora actual\n" +
        "- fecha: Fecha actual\n" +
        "- ping: Test de respuesta"
      );
    }

    if (text === "hora") {
      await wa.Message.Message.text(msg.cid, `Son las ${new Date().toLocaleTimeString("es-AR")}`);
    }

    if (text === "fecha") {
      await wa.Message.Message.text(msg.cid, `Hoy es ${new Date().toLocaleDateString("es-AR", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      })}`);
    }

    if (text === "ping") {
      const start = Date.now();
      await wa.Message.Message.text(msg.cid, "pong!");
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

  // Esperar sincronizacion
  await wa.sync((p) => console.log(`Sincronizando: ${p}%`));
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

### Agregar typing indicator

```typescript
wa.on("message:created", async (msg) => {
  if (msg.me) return;

  // Mostrar "escribiendo..."
  await wa.Chat.typing(msg.cid, true);

  // Simular tiempo de respuesta
  await new Promise(r => setTimeout(r, 1000));

  // Responder
  await wa.Message.Message.text(msg.cid, "Respuesta!");

  // Ocultar typing
  await wa.Chat.typing(msg.cid, false);
});
```

### Marcar mensajes como leidos

```typescript
wa.on("message:created", async (msg) => {
  if (msg.me) return;

  // Marcar como leido
  await msg.seen();

  // Procesar mensaje...
});
```

### Agregar reacciones

```typescript
wa.on("message:created", async (msg) => {
  if (msg.me) return;

  const text = (await msg.content()).toString().toLowerCase();

  // Reaccionar segun contenido
  if (text.includes("gracias")) {
    await msg.react("❤️");
  } else if (text.includes("jaja")) {
    await msg.react("😂");
  }
});
```
