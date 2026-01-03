# Gestion de Grupos

Ejemplos de trabajo con grupos de WhatsApp.

---

## Listar grupos

```typescript
// Obtener todos los chats
const chats = await wa.Chat.paginate(0, 100);

// Filtrar solo grupos
const groups = chats.filter(c => c.type === "group");

for (const group of groups) {
  console.log(`${group.name} (${group.id})`);
}
```

---

## Informacion del grupo

```typescript
const chat = await wa.Chat.get("123456789@g.us");

if (chat && chat.type === "group") {
  console.log(`Nombre: ${chat.name}`);
  console.log(`ID: ${chat.id}`);
  console.log(`Foto: ${chat.photo ?? "Sin foto"}`);

  // Miembros
  const members = await chat.members(0, 1000);
  console.log(`Miembros: ${members.length}`);

  for (const member of members) {
    console.log(`  - ${member.name} (${member.phone})`);
  }
}
```

---

## Detectar grupos en eventos

```typescript
wa.on("chat:upsert", (chat) => {
  if (chat.type === "group") {
    console.log(`Grupo actualizado: ${chat.name}`);
    console.log(`  Foto: ${chat.photo ?? "Sin foto"}`);
  }
});

wa.on("message:created", async (msg) => {
  // Verificar si el mensaje es de un grupo
  const isGroup = msg.cid.endsWith("@g.us");

  if (isGroup) {
    console.log(`Mensaje en grupo: ${msg.cid}`);
    console.log(`Autor: ${msg.uid}`);
  }
});
```

---

## Enviar mensajes a grupos

```typescript
// Enviar texto a un grupo
await wa.Message.Message.text("123456789@g.us", "Hola grupo!");

// Enviar imagen a un grupo
import * as fs from "fs";
const img = fs.readFileSync("foto.jpg");
await wa.Message.Message.image("123456789@g.us", img, "Foto para el grupo");

// Crear encuesta en grupo
await wa.Message.Message.poll("123456789@g.us", {
  content: "Donde nos juntamos?",
  items: [
    { content: "En mi casa" },
    { content: "En el parque" },
    { content: "En el centro" }
  ]
});
```

---

## Responder en grupos

```typescript
wa.on("message:created", async (msg) => {
  if (msg.me) return;

  // Solo procesar mensajes de grupos
  if (!msg.cid.endsWith("@g.us")) return;

  if (!(msg instanceof wa.Message.Text)) return;

  const text = (await msg.content()).toString().toLowerCase();

  // Responder mencionando el mensaje original
  if (text.includes("hola")) {
    await wa.Message.Message.text(msg.cid, "Hola! Bienvenido al grupo", msg.id);
  }
});
```

---

## Broadcast a grupos

```typescript
async function broadcastToGroups(message: string) {
  const chats = await wa.Chat.paginate(0, 100);
  const groups = chats.filter(c => c.type === "group");

  for (const group of groups) {
    try {
      await wa.Message.Message.text(group.id, message);
      console.log(`Enviado a: ${group.name}`);

      // Esperar entre mensajes para evitar ban
      await new Promise(r => setTimeout(r, 2000));
    } catch (error) {
      console.error(`Error en ${group.name}:`, error);
    }
  }
}

// Uso
await broadcastToGroups("Mensaje importante para todos los grupos");
```

---

## Obtener miembros de un grupo

```typescript
const chat = await wa.Chat.get("123456789@g.us");

if (chat && chat.type === "group") {
  const members = await chat.members(0, 1000);

  console.log(`Grupo: ${chat.name}`);
  console.log(`Total miembros: ${members.length}`);

  for (const member of members) {
    console.log(`  - ${member.name}: ${member.phone}`);
  }
}
```

---

## Exportar miembros a JSON

```typescript
import * as fs from "fs";

async function exportGroupMembers(groupId: string) {
  const chat = await wa.Chat.get(groupId);
  if (!chat || chat.type !== "group") {
    throw new Error("Grupo no encontrado");
  }

  const members = await chat.members(0, 10000);

  const data = {
    group: {
      id: chat.id,
      name: chat.name,
      photo: chat.photo,
    },
    exportedAt: new Date().toISOString(),
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
wa.on("message:created", async (msg) => {
  if (msg.me) return;
  if (!(msg instanceof wa.Message.Text)) return;

  // Solo en grupos
  if (!msg.cid.endsWith("@g.us")) return;

  const text = (await msg.content()).toString();
  if (!text.startsWith("!")) return;

  const [cmd] = text.slice(1).split(" ");

  switch (cmd.toLowerCase()) {
    case "info":
      const chat = await wa.Chat.get(msg.cid);
      if (chat) {
        const members = await chat.members(0, 1000);
        await wa.Message.Message.text(
          msg.cid,
          `*${chat.name}*\n\n` +
          `ID: ${chat.id}\n` +
          `Miembros: ${members.length}`
        );
      }
      break;

    case "miembros":
      const group = await wa.Chat.get(msg.cid);
      if (group) {
        const members = await group.members(0, 50);
        const list = members.map(m => `- ${m.name}`).join("\n");
        await wa.Message.Message.text(msg.cid, `*Miembros:*\n${list}`);
      }
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
