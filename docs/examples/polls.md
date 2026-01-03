# Encuestas

Ejemplos de creacion y manejo de encuestas.

---

## Crear encuesta

```typescript
// Encuesta simple
await wa.Message.Message.poll("123456789@g.us", {
  content: "Cual es tu color favorito?",
  items: [
    { content: "Rojo" },
    { content: "Azul" },
    { content: "Verde" },
    { content: "Amarillo" }
  ]
});
```

---

## Leer resultados

```typescript
wa.on("message:created", async (msg) => {
  if (!(msg instanceof wa.Message.Poll)) return;

  const poll = await msg.count();
  if (!poll) return;

  console.log(`Encuesta: ${poll.content}`);
  console.log("Resultados:");

  let totalVotes = 0;
  poll.items.forEach((item, i) => {
    console.log(`  ${i + 1}. ${item.content}: ${item.count} votos`);
    totalVotes += item.count;
  });

  console.log(`Total: ${totalVotes} votos`);
});
```

---

## Bot de encuestas

```typescript
wa.on("message:created", async (msg) => {
  if (msg.me) return;
  if (!(msg instanceof wa.Message.Text)) return;

  const text = (await msg.content()).toString();

  // Comando: !encuesta Pregunta | Opcion1 | Opcion2 | ...
  if (text.startsWith("!encuesta ")) {
    const content = text.slice(10);
    const parts = content.split("|").map(s => s.trim());

    if (parts.length < 3) {
      await wa.Message.Message.text(
        msg.cid,
        "Uso: !encuesta Pregunta | Opcion1 | Opcion2 | ...\n\n" +
        "Ejemplo:\n" +
        "!encuesta Que comemos hoy? | Pizza | Sushi | Hamburguesa"
      );
      return;
    }

    const [question, ...options] = parts;

    if (options.length > 12) {
      await wa.Message.Message.text(msg.cid, "Maximo 12 opciones permitidas");
      return;
    }

    await wa.Message.Message.poll(msg.cid, {
      content: question,
      items: options.map(opt => ({ content: opt }))
    });
    await wa.Message.Message.text(msg.cid, `Encuesta creada: "${question}"`);
  }

  // Mostrar resultados de la ultima encuesta
  if (text === "!resultados") {
    const messages = await wa.Message.Message.paginate(msg.cid, 0, 50);
    const pollMsg = messages.find(m => m instanceof wa.Message.Poll);

    if (!pollMsg || !(pollMsg instanceof wa.Message.Poll)) {
      await wa.Message.Message.text(msg.cid, "No hay encuestas recientes");
      return;
    }

    const poll = await pollMsg.count();
    if (!poll) {
      await wa.Message.Message.text(msg.cid, "Error leyendo encuesta");
      return;
    }

    let result = `*${poll.content}*\n\n`;
    let totalVotes = poll.items.reduce((sum, item) => sum + item.count, 0);

    poll.items.forEach((item, i) => {
      const percent = totalVotes > 0
        ? Math.round((item.count / totalVotes) * 100)
        : 0;
      const bar = "█".repeat(Math.floor(percent / 10)) + "░".repeat(10 - Math.floor(percent / 10));
      result += `${i + 1}. ${item.content}\n`;
      result += `   ${bar} ${percent}% (${item.count})\n\n`;
    });

    result += `Total: ${totalVotes} votos`;
    await wa.Message.Message.text(msg.cid, result);
  }
});
```

---

## Encuesta con temporizador

```typescript
async function createTimedPoll(
  chatId: string,
  question: string,
  options: string[],
  durationMinutes: number
) {
  // Crear encuesta
  await wa.Message.Message.poll(chatId, {
    content: question,
    items: options.map(opt => ({ content: opt }))
  });
  await wa.Message.Message.text(chatId, `Encuesta activa por ${durationMinutes} minutos`);

  // Esperar duracion
  await new Promise(r => setTimeout(r, durationMinutes * 60 * 1000));

  // Obtener resultados
  const messages = await wa.Message.Message.paginate(chatId, 0, 50);
  const pollMsg = messages.find(m =>
    m instanceof wa.Message.Poll &&
    m.me // Solo encuestas creadas por nosotros
  );

  if (!pollMsg || !(pollMsg instanceof wa.Message.Poll)) return;

  const poll = await pollMsg.count();
  if (!poll) return;

  // Anunciar ganador
  const winner = poll.items.reduce((max, item) =>
    item.count > max.count ? item : max
  );

  await wa.Message.Message.text(
    chatId,
    `*Encuesta finalizada!*\n\n` +
    `Ganador: ${winner.content} con ${winner.count} votos`
  );
}

// Uso
await createTimedPoll(
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
