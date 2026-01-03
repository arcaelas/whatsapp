# Primeros Pasos

Este tutorial te guiara paso a paso para crear tu primer bot de WhatsApp.

---

## 1. Crear el proyecto

```bash
mkdir mi-bot-whatsapp
cd mi-bot-whatsapp
npm init -y
npm install @arcaelas/whatsapp typescript tsx
```

---

## 2. Estructura basica

Crea el archivo principal:

```typescript title="index.ts"
import { WhatsApp } from "@arcaelas/whatsapp";

async function main() {
  // Crear instancia de WhatsApp
  const wa = new WhatsApp({
    sync: true,    // Sincronizar historial existente
    online: false, // No mostrar "en linea" al conectar
  });

  // Escuchar eventos antes de conectar
  wa.on("open", () => console.log("Conectado!"));
  wa.on("close", () => console.log("Desconectado"));
  wa.on("error", (err) => console.error("Error:", err.message));

  // Conectar mostrando QR en consola
  console.log("Esperando QR...");
  await wa.pair(async (data) => {
    if (Buffer.isBuffer(data)) {
      // Guardar QR como imagen
      const fs = await import("fs");
      fs.writeFileSync("qr.png", data);
      console.log("QR guardado en qr.png - Escanea con tu telefono");
    } else {
      // Codigo de 8 digitos (si usas phone)
      console.log("Codigo de emparejamiento:", data);
    }
  });

  console.log("Bot iniciado!");
}

main().catch(console.error);
```

---

## 3. Ejecutar

```bash
npx tsx index.ts
```

1. Aparecera el archivo `qr.png`
2. Abrelo y escanea con WhatsApp > Dispositivos vinculados
3. El bot se conectara automaticamente

!!! success "Listo!"
    Una vez conectado, la sesion se guarda en `.baileys/default/` y no necesitaras escanear de nuevo.

---

## 4. Escuchar mensajes

Agrega un listener para mensajes entrantes:

```typescript title="index.ts" hl_lines="20-35"
import { WhatsApp } from "@arcaelas/whatsapp";

async function main() {
  const wa = new WhatsApp({ sync: true, online: false });

  // Escuchar nuevos mensajes
  wa.on("message:created", async (msg) => {
    // Ignorar mensajes propios
    if (msg.me) return;

    // Obtener contenido como texto
    const content = (await msg.content()).toString();
    console.log(`[${msg.type}] ${msg.uid}: ${content}`);

    // Responder a mensajes de texto
    if (msg instanceof wa.Message.Text) {
      const text = content.toLowerCase();

      if (text === "hola") {
        await wa.Message.Message.text(msg.cid, "Hola! Soy un bot. Escribe 'ayuda' para ver comandos.");
      }

      if (text === "ayuda") {
        await wa.Message.Message.text(
          msg.cid,
          "Comandos disponibles:\n" +
          "- hola: Saludo\n" +
          "- hora: Hora actual\n" +
          "- ping: Test de respuesta"
        );
      }

      if (text === "hora") {
        await wa.Message.Message.text(msg.cid, `Son las ${new Date().toLocaleTimeString()}`);
      }

      if (text === "ping") {
        await wa.Message.Message.text(msg.cid, "pong!");
      }
    }
  });

  // Conectar
  await wa.pair(async (data) => {
    if (Buffer.isBuffer(data)) {
      require("fs").writeFileSync("qr.png", data);
      console.log("Escanea qr.png");
    }
  });

  // Esperar sincronizacion inicial
  await wa.sync((p) => console.log(`Sincronizando: ${p}%`));
  console.log("Bot listo!");
}

main().catch(console.error);
```

---

## 5. Conexion con codigo de emparejamiento

Si prefieres no escanear QR, usa el numero de telefono:

```typescript
const wa = new WhatsApp({
  phone: "5491112345678", // Sin + ni espacios
  sync: true,
});

await wa.pair(async (data) => {
  if (typeof data === "string") {
    console.log("Ingresa este codigo en tu telefono:", data);
    // Ir a WhatsApp > Dispositivos vinculados > Vincular dispositivo
    // Seleccionar "Vincular con numero de telefono"
  }
});
```

---

## 6. Usar diferentes tipos de mensaje

```typescript
wa.on("message:created", async (msg) => {
  if (msg.me) return;

  // Mensaje de texto
  if (msg instanceof wa.Message.Text) {
    const text = (await msg.content()).toString();
    console.log("Texto:", text);

    // Editar mensaje propio (solo funciona con mensajes enviados por ti)
    // await msg.edit("Texto editado");
  }

  // Imagen
  if (msg instanceof wa.Message.Image) {
    const buffer = await msg.content();
    console.log(`Imagen: ${buffer.length} bytes, caption: ${msg.caption}`);
    // Guardar imagen
    require("fs").writeFileSync("imagen.jpg", buffer);
  }

  // Video
  if (msg instanceof wa.Message.Video) {
    const buffer = await msg.content();
    console.log(`Video: ${buffer.length} bytes`);
  }

  // Audio (nota de voz)
  if (msg instanceof wa.Message.Audio) {
    const buffer = await msg.content();
    console.log(`Audio: ${buffer.length} bytes`);
  }

  // Ubicacion
  if (msg instanceof wa.Message.Location) {
    const coords = await msg.coords();
    if (coords) {
      console.log(`Ubicacion: ${coords.lat}, ${coords.lng}`);
    }
  }

  // Encuesta
  if (msg instanceof wa.Message.Poll) {
    const poll = await msg.count();
    if (poll) {
      console.log(`Encuesta: ${poll.content}`);
      poll.items.forEach((item, i) => {
        console.log(`  ${i + 1}. ${item.content} (${item.count} votos)`);
      });
    }
  }
});
```

---

## 7. Enviar mensajes

```typescript
const cid = "5491198765432@s.whatsapp.net";

// Texto
await wa.Message.Message.text(cid, "Hola!");

// Texto citando mensaje
await wa.Message.Message.text(cid, "Respuesta", "MESSAGE_ID_TO_QUOTE");

// Imagen con caption
const img = require("fs").readFileSync("foto.jpg");
await wa.Message.Message.image(cid, img, "Mira esta foto!");

// Video
const vid = require("fs").readFileSync("video.mp4");
await wa.Message.Message.video(cid, vid, "Video interesante");

// Audio (nota de voz)
const aud = require("fs").readFileSync("audio.ogg");
await wa.Message.Message.audio(cid, aud);

// Ubicacion
await wa.Message.Message.location(cid, {
  lat: -34.6037,
  lng: -58.3816
});

// Encuesta
await wa.Message.Message.poll(cid, {
  content: "Cual prefieres?",
  items: [
    { content: "Opcion A" },
    { content: "Opcion B" },
    { content: "Opcion C" }
  ]
});
```

---

## 8. Reaccionar a mensajes

```typescript
wa.on("message:created", async (msg) => {
  if (msg.me) return;

  const text = (await msg.content()).toString().toLowerCase();

  // Reaccionar con emoji
  if (text.includes("gracias")) {
    await msg.react("❤️");
  }

  if (text.includes("jaja")) {
    await msg.react("😂");
  }

  // Quitar reaccion
  // await msg.react("");
});
```

---

## 9. Marcar como leido

```typescript
wa.on("message:created", async (msg) => {
  // Marcar mensaje individual como leido
  await msg.seen();

  // O marcar todo el chat como leido
  const chat = await msg.chat();
  await chat?.seen();
});
```

---

## Siguiente paso

Ahora que tienes un bot basico funcionando, explora la documentacion detallada:

- [Referencia de WhatsApp](references/whatsapp.md) - Configuracion y eventos
- [Referencia de Chat](references/chat.md) - Gestion de conversaciones
- [Referencia de Message](references/message.md) - Tipos de mensaje
- [Ejemplos avanzados](examples/basic-bot.md) - Patrones recomendados
