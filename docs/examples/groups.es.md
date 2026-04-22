# Groups

Los chats grupales usan la misma API que las conversaciones 1:1 — la única diferencia es que el
CID termina con `@g.us`. La instancia `Chat` expone helpers específicos de grupo como
`members()` y funciona con los delegados estáticos en `wa.Chat.*`.

!!! info "Detección"
    Usa `chat.type === 'group'` para ramificar entre chats de grupo y de contacto. La verificación se
    deriva del sufijo del JID y siempre es síncrona.

---

## Configuración

```typescript title="client.ts"
import { WhatsApp } from '@arcaelas/whatsapp';
import { FileSystemEngine } from '@arcaelas/whatsapp/engines';

export const wa = new WhatsApp({
    engine: new FileSystemEngine(__dirname),
    phone: 14155551234,
});

await wa.connect((auth) => {
    if (typeof auth === 'string') {
        console.log('Pair code:', auth);
    }
});
```

---

## Detectar un mensaje de grupo

```typescript title="detect-group.ts"
import { wa } from './client';

wa.on('message:created', async (msg, chat) => {
    if (chat.type === 'group') {
        const author = await msg.author();
        console.log(`[${chat.name}] ${author.name}: ${msg.caption}`);
    }
});
```

---

## Listar miembros

`chat.members(offset, limit)` devuelve instancias de `Contact` hidratadas y está paginado.
Para grupos típicos, traer los primeros 500 en una sola llamada es suficiente.

```typescript title="list-members.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

const chat = await wa.Chat.get(GROUP_CID);
if (chat && chat.type === 'group') {
    const members = await chat.members(0, 500);
    console.log(`${chat.name} has ${members.length} members:`);
    for (const member of members) {
        console.log(`- ${member.name} (${member.id})`);
    }
}
```

---

## Enviar a un grupo

Idéntico a un chat 1:1 — solo apunta al CID del grupo:

```typescript title="send-to-group.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

await wa.Message.text(GROUP_CID, 'Standup starts in 5 minutes');

const banner = await readFile('./assets/standup.png');
await wa.Message.image(GROUP_CID, banner, { caption: 'See you there!' });
```

!!! warning "Mencionar usuarios"
    La API de envío de v3 actualmente no expone un parámetro para `ContextInfo.mentionedJid`,
    por lo que las menciones `@user` no pueden adjuntarse a mensajes salientes desde esta librería. La
    lista de menciones cruda está disponible en mensajes **entrantes** vía `msg._doc.raw` si
    necesitas reaccionar a menciones entrantes.

---

## Comandos solo para admins

No hay verificación de roles incorporada — compara `msg.from` contra tu propia whitelist. El
siguiente bot escucha `!purge` y solo actúa si el remitente está en el conjunto de admins.

```typescript title="admin-commands.ts"
import { wa } from './client';

const ADMINS = new Set([
    '14155550001@s.whatsapp.net',
    '14155550002@s.whatsapp.net',
]);

wa.on('message:created', async (msg, chat) => {
    if (chat.type !== 'group') {
        return;
    }
    if (!(msg instanceof wa.Message.Text)) {
        return;
    }
    if (msg.caption.trim() !== '!purge') {
        return;
    }
    if (!ADMINS.has(msg.from)) {
        await msg.text('Only admins can run that command.');
        return;
    }
    await chat.clear();
    await msg.text('Local history cleared.');
});
```

!!! tip "Alternativa con decoradores"
    Para bots más grandes prefiere el decorador `@from` de
    `@arcaelas/whatsapp/decorators` — elimina el boilerplate de arriba y funciona
    tanto con JIDs individuales como con arrays.

---

## Eventos de unión / salida

El mapa de eventos de v3 (`connected`, `chat:*`, `contact:*`, `message:*`) **no**
incluye eventos dedicados `group:join` o `group:leave`. Para reaccionar a cambios de
membresía hoy tienes dos opciones:

- Escuchar el evento de sistema `message:created` e inspeccionar el
  `msg._doc.raw.messageStubType` subyacente para los stubs de grupo de Baileys (`GROUP_PARTICIPANT_ADD`,
  `GROUP_PARTICIPANT_REMOVE`, etc.).
- Hacer polling periódico de `chat.members()` y comparar contra un conjunto cacheado.

```typescript title="membership-poll.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';
const known = new Set<string>();

setInterval(async () => {
    const chat = await wa.Chat.get(GROUP_CID);
    if (!chat || chat.type !== 'group') {
        return;
    }
    const current = await chat.members(0, 500);
    const current_ids = new Set(current.map((c) => c.id));

    for (const id of current_ids) {
        if (!known.has(id)) {
            console.log(`Joined: ${id}`);
        }
    }
    for (const id of known) {
        if (!current_ids.has(id)) {
            console.log(`Left: ${id}`);
        }
    }
    known.clear();
    for (const id of current_ids) {
        known.add(id);
    }
}, 30_000);
```

---

## Archivar, fijar y silenciar

Los delegados estáticos en `wa.Chat` aceptan cualquier CID — incluyendo el de un grupo. Cada uno
devuelve `true` en caso de éxito.

```typescript title="manage-group.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

await wa.Chat.archive(GROUP_CID, true);
await wa.Chat.pin(GROUP_CID, true);
await wa.Chat.mute(GROUP_CID, true);

// Revertirlos luego
await wa.Chat.mute(GROUP_CID, false);
await wa.Chat.archive(GROUP_CID, false);
```

Los equivalentes a nivel de instancia (`chat.archive(true)`, `chat.pin(true)`,
`chat.mute(true)`) funcionan idénticamente una vez que has llamado a `wa.Chat.get(cid)`.
