# Groups

Los chats grupales usan la misma API que las conversaciones 1:1 — la única diferencia es que el
identificador termina con `@g.us`. La instancia `Chat` expone los helpers específicos de grupo
`members()` y `content()`, y todos los métodos de acción funcionan igual.

!!! info "Detección"
    Usa `chat.type === 'group'` para ramificar entre chats de grupo y de contacto. La verificación se
    deriva del sufijo del identificador y siempre es síncrona.

---

## Configuración

```typescript title="client.ts"
import { WhatsApp, FileSystemEngine } from '@arcaelas/whatsapp';

export const wa = new WhatsApp({
    engine: new FileSystemEngine(__dirname + '/.session'),
    phone: 14155551234,
});

await wa.connect((auth) => {
    if (typeof auth === 'string') {
        console.log('Código de emparejamiento:', auth);
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

!!! warning "`chat.id` conserva la forma cruda en grupos"
    En un chat 1:1, `chat.id` se recorta al teléfono; en un grupo se queda el `120363…@g.us`
    completo. Ambos se aceptan en cualquier lugar donde la librería reciba un identificador.

---

## Listar miembros y leer el asunto

`chat.members(offset, limit)` devuelve instancias de `Contact` y está paginado; los metadatos del
grupo se memorizan 15 segundos, así que paginar no repite el round-trip. `chat.content()` resuelve la
descripción del grupo.

```typescript title="list-members.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

const chat = await wa.Chat.get(GROUP_CID);

if (chat && chat.type === 'group') {
    console.log(chat.name, '—', await chat.content());

    const members = await chat.members(0, 500);
    console.log(`${members.length} miembros:`);
    for (const member of members) {
        console.log(`- ${member.name} (${member.phone ?? member.lid})`);
    }
}
```

!!! info "Los contactos no tienen getter `id`"
    Un `Contact` expone `name`, `phone`, `jid`, `lid` y `photo`. En grupos direccionados por LID,
    `phone` puede ser `null` — cae en `lid` como en el fragmento de arriba.

---

## Enviar a un grupo

Idéntico a un chat 1:1 — solo apunta al identificador del grupo:

```typescript title="send-to-group.ts"
import { readFile } from 'node:fs/promises';
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

await wa.Message.text(GROUP_CID, 'El standup empieza en 5 minutos');

const banner = await readFile('./assets/standup.png');
await wa.Message.image(GROUP_CID, banner, { caption: '¡Nos vemos ahí!' });
```

!!! warning "Mencionar usuarios"
    La API de envío no expone un parámetro para `contextInfo.mentionedJid`, así que no se pueden
    adjuntar menciones `@usuario` a los mensajes salientes. La lista de menciones de un mensaje
    **entrante** sí es alcanzable desde el documento crudo si necesitas reaccionar a ella:

    ```typescript
    const mentioned = msg._raw.raw.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
    ```

---

## Comandos solo para administradores

No hay una verificación de roles integrada — compara `msg.from` contra tu propia lista blanca. El
siguiente bot escucha `!purge` y solo actúa si el remitente está en el conjunto de admins.

```typescript title="admin-commands.ts"
import { Text } from '@arcaelas/whatsapp';
import { wa } from './client';

const ADMINS = new Set([
    '14155550001@s.whatsapp.net',
    '14155550002@s.whatsapp.net',
]);

wa.on('message:created', async (msg, chat) => {
    if (chat.type !== 'group') {
        return;
    }
    if (!(msg instanceof Text)) {
        return;
    }
    if (msg.caption.trim() !== '!purge') {
        return;
    }
    if (!ADMINS.has(msg.from)) {
        await msg.text('Solo los administradores pueden ejecutar ese comando.');
        return;
    }
    await chat.clear();
    await msg.text('Historial limpiado.');
});
```

!!! warning "Listas blancas y direccionamiento por LID"
    `msg.from` es el identificador del autor tal como está almacenado: un JID `@s.whatsapp.net` en la
    mayoría de los grupos, pero un `@lid` en los grupos migrados al nuevo direccionamiento. Guarda
    ambas formas, o compara contra `(await msg.author()).phone`.

!!! tip "Alternativa con decoradores"
    Para bots más grandes prefiere el decorador `@from` de `@arcaelas/whatsapp/decorators` — resuelve
    teléfonos, JIDs y LIDs por ti y acepta arrays.

---

## Cambios de membresía

El mapa de eventos no tiene eventos dedicados `group:join` / `group:leave`. Baileys entrega los
cambios de membresía como mensajes de sistema, que llegan como `message:created` con caption vacío y
un `messageStubType` en el documento crudo:

```typescript title="membership.ts"
import { wa } from './client';

wa.on('message:created', (msg, chat) => {
    const stub = msg._raw.raw.messageStubType;
    if (chat.type === 'group' && stub) {
        console.log('[evento de grupo]', chat.name, stub, msg._raw.raw.messageStubParameters);
    }
});
```

La alternativa, que no depende de la forma cruda, es comparar la lista de miembros:

```typescript title="membership-poll.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';
const known = new Set<string>();

setInterval(async () => {
    const chat = await wa.Chat.get(GROUP_CID);
    if (!chat || chat.type !== 'group') {
        return;
    }
    const current = new Set(
        (await chat.members(0, 500)).map((member) => member.jid ?? member.lid ?? member.name),
    );

    for (const id of current) {
        if (!known.has(id)) {
            console.log(`Entró: ${id}`);
        }
    }
    for (const id of known) {
        if (!current.has(id)) {
            console.log(`Salió: ${id}`);
        }
    }
    known.clear();
    for (const id of current) {
        known.add(id);
    }
}, 30_000);
```

---

## Archivar, fijar, silenciar y salir

Las acciones sobre el chat viven en la instancia — no hay estáticos por acción.

```typescript title="manage-group.ts"
import { wa } from './client';

const GROUP_CID = '120363025912345678@g.us';

const chat = await wa.Chat.get(GROUP_CID);

if (chat) {
    await chat.archive(true);
    await chat.pin(true);                              // false si ya hay 3 chats fijados
    await chat.mute('2026-08-01T10:00:00Z');           // fecha ISO, epoch ms o Date

    // Revertirlos más tarde
    await chat.mute(false);
    await chat.archive(false);

    // Salir del grupo es `delete()`
    // await chat.delete();
}
```

!!! danger "`delete()` abandona el grupo"
    En un chat grupal, `delete()` llama a `groupLeave` y luego elimina el subárbol local. No hay una
    variante de "borrar solo localmente" — usa `clear()` si únicamente quieres liberar espacio.
