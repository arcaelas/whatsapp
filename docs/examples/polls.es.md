# Encuestas

Ejemplos de creacion y manejo de encuestas.

---

## Crear encuesta

```typescript
// Encuesta simple
await wa.Message.poll("123456789@g.us", {
  content: "Cual es tu color favorito?",
  options: [
    { content: "Rojo" },
    { content: "Azul" },
    { content: "Verde" },
    { content: "Amarillo" }
  ]
});
```

---

## Leer datos de encuesta

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.type !== "poll") return;

  // El contenido de una encuesta es JSON
  const buffer = await msg.content();
  const poll = JSON.parse(buffer.toString()) as {
    content: string;
    options: Array<{ content: string }>;
  };

  console.log(`Encuesta: ${poll.content}`);
  console.log("Opciones:");
  poll.options.forEach((opt, i) => {
    console.log(`  ${i + 1}. ${opt.content}`);
  });
});
```

---

## Bot de encuestas

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "text") return;

  const text = (await msg.content()).toString();

  // Comando: !encuesta Pregunta | Opcion1 | Opcion2 | ...
  if (text.startsWith("!encuesta ")) {
    const content = text.slice(10);
    const parts = content.split("|").map(s => s.trim());

    if (parts.length < 3) {
      await wa.Message.text(
        msg.cid,
        "Uso: !encuesta Pregunta | Opcion1 | Opcion2 | ...\n\n" +
        "Ejemplo:\n" +
        "!encuesta Que comemos hoy? | Pizza | Sushi | Hamburguesa"
      );
      return;
    }

    const [question, ...options] = parts;

    if (options.length > 12) {
      await wa.Message.text(msg.cid, "Maximo 12 opciones permitidas");
      return;
    }

    await wa.Message.poll(msg.cid, {
      content: question,
      options: options.map(opt => ({ content: opt }))
    });

    await wa.Message.text(msg.cid, `Encuesta creada: "${question}"`);
  }
});
```

---

## Encuesta con temporizador

```typescript
async function create_timed_poll(
  wa: WhatsApp,
  chat_id: string,
  question: string,
  options: string[],
  duration_minutes: number
) {
  // Crear encuesta
  const poll_msg = await wa.Message.poll(chat_id, {
    content: question,
    options: options.map(opt => ({ content: opt }))
  });

  if (!poll_msg) return;

  await wa.Message.text(chat_id, `Encuesta activa por ${duration_minutes} minutos`);

  // Esperar duracion
  await new Promise(r => setTimeout(r, duration_minutes * 60 * 1000));

  // Anunciar que termino
  await wa.Message.text(chat_id, `*Encuesta finalizada!*\n\nVer resultados en la encuesta.`);
}

// Uso
await create_timed_poll(
  wa,
  "123456789@g.us",
  "Que pelicula vemos?",
  ["Accion", "Comedia", "Terror", "Drama"],
  5 // 5 minutos
);
```

---

## Notas importantes

!!! info "Limite de opciones"
    WhatsApp permite maximo 12 opciones por encuesta.

!!! warning "Visibilidad de votos"
    Los votos en WhatsApp son anonimos. Solo puedes ver el conteo total, no quien voto.

!!! tip "Encuestas en grupos"
    Las encuestas funcionan mejor en grupos donde hay mas participantes.
