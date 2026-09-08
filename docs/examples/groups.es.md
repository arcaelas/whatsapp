# Groups

Los chats grupales usan la misma API que las conversaciones 1:1 — la única diferencia es que el
identificador termina con `@g.us`. La instancia `Chat` expone los helpers específicos de grupo
(`members()`, `admins()`, `admin()`, `content()`, `rename()`, `describe()`, `add()`, `remove()`,
`promote()`, `demote()`, `invite()`, `revoke()`, `announce()`, `restrict()`), y todos los demás
métodos de acción funcionan igual.

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
    Un `Contact` expone `name`, `phone`, `jid`, `lid`, `photo` y `me`. En grupos direccionados por
    LID, `phone` puede ser `null` — cae en `lid` como en el fragmento de arriba.

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

### Mencionar usuarios

Escribe `@<teléfono>` en el texto y nombra a las mismas personas en `mentions`. La librería resuelve
cada una al identificador que usa el grupo — un LID en los grupos migrados al nuevo direccionamiento
— y reescribe el `@` en consecuencia, así el receptor ve una mención real:

```typescript title="mention.ts"
await wa.Message.text(GROUP_CID, '@14155557777 ¿revisas el PR?', { mentions: ['14155557777'] });

wa.on('message:created', async (msg) => {
    if (msg.mentioned) {
        console.log('me mencionaron, junto con', (await msg.mentions()).map((who) => who.name));
    }
});
```

---

## Comandos solo para administradores

`chat.admins()` devuelve a los administradores del grupo, así que un comando puede comprobar el rol
del autor contra el propio grupo en vez de contra una lista blanca mantenida a mano. El siguiente
bot escucha `!purge` y solo actúa cuando el remitente administra el grupo.

```typescript title="admin-commands.ts"
import { Text } from '@arcaelas/whatsapp';
import { wa } from './client';

wa.on('message:created', async (msg, chat) => {
    if (chat.type === 'group' && msg instanceof Text && msg.caption.trim() === '!purge') {
        const author = await msg.author();
        const admins = await chat.admins();
        if (admins.some((who) => who.phone === author.phone)) {
            await chat.clear();
            await msg.text('Historial limpiado.');
        } else await msg.text('Solo los administradores pueden ejecutar ese comando.');
    }
});
```

!!! warning "Compara contactos resueltos, no `msg.from`"
    `msg.from` es el identificador del autor tal como está almacenado: un JID `@s.whatsapp.net` en la
    mayoría de los grupos, pero un `@lid` en los grupos migrados al nuevo direccionamiento.
    `msg.author()` lo canoniza, así que compara `phone` (o `lid`) entre contactos como arriba.

!!! tip "Alternativa con decoradores"
    Para una lista fija de operadores prefiere el decorador `@from` de `@arcaelas/whatsapp/decorators`
    — resuelve teléfonos, JIDs y LIDs por ti y acepta arrays.

---

## Cambios de membresía

La membresía viaja como eventos: `chat:joined`, `chat:left`, `chat:promoted` y `chat:demoted`
llevan el chat y los contactos afectados, y `chat:updated` se dispara cuando el grupo se renombra o
se describe.

```typescript title="membership.ts"
import { wa } from './client';

wa.on('chat:joined',   (chat, people) => console.log(`${people.map((who) => who.name)} entraron a ${chat.name}`));
wa.on('chat:left',     (chat, people) => console.log(`${people.map((who) => who.name)} salieron de ${chat.name}`));
wa.on('chat:promoted', (chat, people) => console.log(`${people.map((who) => who.name)} administran ${chat.name}`));
wa.on('chat:demoted',  (chat, people) => console.log(`${people.map((who) => who.name)} ya no administran ${chat.name}`));
wa.on('chat:updated',  (chat) => console.log(`${chat.name} se renombró o se describió`));
```

El aviso de sistema que WhatsApp muestra por cada cambio sigue llegando como un `message:created`
con caption vacío y un `messageStubType` en el documento crudo; los eventos de arriba son la forma de
reaccionar a él.

---

## Crear, entrar y moderar

`wa.Chat.create` abre un grupo con la cuenta como administradora y `wa.Chat.join` entra a uno por
enlace de invitación. Cada acción de moderación vive en la instancia y exige ser administrador.

```typescript title="moderate.ts"
import { wa } from './client';

const group = await wa.Chat.create('Equipo de release', ['14155557777', '14155558888']);
console.log(await group.invite());                   // https://chat.whatsapp.com/…

await group.describe('Coordinación del release 2.0');
await group.promote('14155557777');
await group.announce(true);                          // solo los administradores envían
await group.remove('14155558888');                   // 1 cuando WhatsApp lo aceptó

const joined = await wa.Chat.join('https://chat.whatsapp.com/AbCdEfGhIjK');
console.log(joined?.name, await joined?.admin());   // admin(): si la cuenta lo modera
```

!!! warning "WhatsApp decide a quién se puede agregar"
    `add()` devuelve cuántos entraron: una persona con la privacidad de *Grupos* en *Mis contactos*
    no puede ser agregada por una cuenta que no tiene guardada, y a quien fue expulsado no se le
    puede volver a agregar de inmediato. Compárteles `invite()` en su lugar.

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
