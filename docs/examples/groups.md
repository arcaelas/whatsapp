# Gestion de Grupos

Ejemplos de trabajo con grupos de WhatsApp.

---

## Obtener informacion de grupo

```typescript
const chat = await wa.Chat.get("123456789@g.us");

if (chat && chat.type === "group") {
  console.log(`Nombre: ${chat.name}`);
  console.log(`ID: ${chat.id}`);

  // Miembros
  const members = await wa.Chat.members(chat.id, 0, 1000);
  console.log(`Miembros: ${members.length}`);

  for (const member of members) {
    console.log(`  - ${member.name} (${member.phone})`);
  }
}
```

---

## Detectar grupos en eventos

```typescript
wa.event.on("chat:created", (chat) => {
  if (chat.type === "group") {
    console.log(`Grupo creado: ${chat.name}`);
  }
});

wa.event.on("message:created", async (msg) => {
  // Verificar si el mensaje es de un grupo
  const is_group = msg.cid.endsWith("@g.us");

  if (is_group) {
    console.log(`Mensaje en grupo: ${msg.cid}`);
  }
});
```

---

## Enviar mensajes a grupos

```typescript
// Enviar texto a un grupo
await wa.Message.text("123456789@g.us", "Hola grupo!");

// Enviar imagen a un grupo
import * as fs from "fs";
const img = fs.readFileSync("foto.jpg");
await wa.Message.image("123456789@g.us", img, "Foto para el grupo");

// Crear encuesta en grupo
await wa.Message.poll("123456789@g.us", {
  content: "Donde nos juntamos?",
  options: [
    { content: "En mi casa" },
    { content: "En el parque" },
    { content: "En el centro" }
  ]
});
```

---

## Responder en grupos

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me) return;

  // Solo procesar mensajes de grupos
  if (!msg.cid.endsWith("@g.us")) return;

  if (msg.type !== "text") return;

  const text = (await msg.content()).toString().toLowerCase();

  // Responder
  if (text.includes("hola")) {
    await wa.Message.text(msg.cid, "Hola! Bienvenido al grupo");
  }
});
```

---

## Obtener miembros de un grupo

```typescript
const group_id = "123456789@g.us";
const members = await wa.Chat.members(group_id, 0, 1000);

console.log(`Grupo tiene ${members.length} miembros:`);
for (const member of members) {
  console.log(`  - ${member.name}: ${member.phone}`);
}
```

---

## Exportar miembros a JSON

```typescript
import * as fs from "fs";

async function export_group_members(wa: WhatsApp, group_id: string) {
  const chat = await wa.Chat.get(group_id);
  if (!chat || chat.type !== "group") {
    throw new Error("Grupo no encontrado");
  }

  const members = await wa.Chat.members(group_id, 0, 10000);

  const data = {
    group: {
      id: chat.id,
      name: chat.name,
    },
    exported_at: new Date().toISOString(),
    members: members.map(m => ({
      id: m.id,
      phone: m.phone,
      name: m.name,
    })),
  };

  const filename = `grupo_${chat.name.replace(/[^a-z0-9]/gi, "_")}.json`;
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));

  console.log(`Exportados ${members.length} miembros a ${filename}`);
}
```

---

## Bot de comandos para grupos

```typescript
wa.event.on("message:created", async (msg) => {
  if (msg.me || msg.type !== "text") return;

  // Solo en grupos
  if (!msg.cid.endsWith("@g.us")) return;

  const text = (await msg.content()).toString();
  if (!text.startsWith("!")) return;

  const [cmd] = text.slice(1).split(" ");

  switch (cmd.toLowerCase()) {
    case "info":
      const chat = await wa.Chat.get(msg.cid);
      if (chat) {
        const members = await wa.Chat.members(msg.cid, 0, 1000);
        await wa.Message.text(
          msg.cid,
          `*${chat.name}*\n\n` +
          `ID: ${chat.id}\n` +
          `Miembros: ${members.length}`
        );
      }
      break;

    case "miembros":
      const group_members = await wa.Chat.members(msg.cid, 0, 50);
      const list = group_members.map(m => `- ${m.name}`).join("\n");
      await wa.Message.text(msg.cid, `*Miembros:*\n${list}`);
      break;
  }
});
```

---

## Notas

!!! info "JID de grupo"
    Los grupos tienen JID con formato `{id}@g.us`

!!! tip "Diferenciacion"
    Usa `chat.type === "group"` o `cid.endsWith("@g.us")` para detectar grupos
