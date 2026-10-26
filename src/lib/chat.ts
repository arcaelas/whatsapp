/**
 * @file chat.ts
 * @description Entidad Chat — conversaciones 1:1 y grupales sobre el `Chat` de baileys. Hereda los
 * envíos de `Sender`, que desde un chat van a él.
 * Chat entity — 1:1 and group conversations over the baileys `Chat`. It inherits the sends of
 * `Sender`, which from a chat go to it.
 */

import { jidNormalizedUser, toNumber, type Chat as Raw, type GroupMetadata } from 'baileys';
import type { Contact } from '~/lib/contact';
import type { Message } from '~/lib/message';
import sender, { internal, route, type Route, type Who } from '~/lib/sender';
import { deserialize } from '~/lib/store';
import type { Instance, Presence, WatchEvent } from '~/lib/whatsapp';

/** Lo que le pasa a un chat, tal como lo avisa `sub()`. / What happens to a chat, as `sub()` reports it. */
export type ChatEvent = 'created' | 'updated' | 'deleted' | 'message' | 'joined' | 'left' | 'promoted' | 'demoted' | 'presence';

/**
 * Chat ligado a la sesión viva: el `Chat` de baileys se guarda íntegro y privado, y su
 * `conversationTimestamp` ordena la lista. Se construye con `new wa.Chat(raw)`.
 * Chat bound to the live session: the baileys `Chat` is kept whole and private, and its
 * `conversationTimestamp` orders the list. Built with `new wa.Chat(raw)`.
 *
 * @param instance - Sesión activa: cliente, motor y socket / Active session: client, engine and socket
 * @returns Clase `Chat` con acceso a la sesión / `Chat` class with session access
 */
export default function chat(instance: Instance) {
    const { wa, engine } = instance;
    const Sender = sender(instance);
    const { read, write, resolve, picture, awake, denied } = Sender[internal];
    const groups = new Map<string, Promise<GroupMetadata>>();
    const meta = (jid: string) => groups.get(jid) ?? groups.set(jid, instance.socket.groupMetadata(jid).catch(denied).finally(() => setTimeout(() => groups.delete(jid), 15_000))).get(jid)!;
    const tail = async (cid: string) => {
        const [last] = await wa.Message.list(cid, 0, 1);
        return last ? [{ key: { remoteJid: cid, id: last.id, fromMe: last.me, ...(cid.endsWith('@g.us') && last.me === false && { participant: last.from }) }, messageTimestamp: Math.floor(Date.parse(last.created_at) / 1_000) }] : [];
    };
    const link = (code: string | undefined) => {
        if (code === undefined) throw new Error('UNAUTHORIZED');
        return `https://chat.whatsapp.com/${code}`;
    };

    return class Chat extends Sender {
        /** `Chat` de baileys: `id` es el JID, el LID o el `@g.us`. / Baileys `Chat`: `id` is the JID, the LID or the `@g.us`. */
        readonly #raw: Raw & { id: string };

        /** @param raw - `Chat` de baileys / Baileys `Chat` */
        constructor(raw: Raw & { id: string }) {
            super();
            this.#raw = raw;
        }

        /** Un chat: los envíos, la presencia y los metadatos van a él. / A chat: sends, presence and metadata go to it. */
        [route](): Route {
            return { type: 'chat', cid: this.#id };
        }

        /** @param who - Participantes / Participants */
        static async #targets(who: Who[]): Promise<string[]> {
            return (await Promise.all(who.map((entry) => resolve(typeof entry === 'object' ? entry.id : String(entry))))).filter((jid): jid is string => jid !== null);
        }

        /** @param ids - JIDs o LIDs de los participantes / Participant JIDs or LIDs */
        static #people(ids: string[]): Promise<Contact[]> {
            return Promise.all(ids.map(async (raw) => {
                const id = (await resolve(raw)) ?? jidNormalizedUser(raw);
                return new wa.Contact((await read(`/contact/${id}`)) ?? { id, lid: raw.endsWith('@lid') ? raw : undefined });
            }));
        }

        /** JID canónico: el del teléfono cuando se conoce. / Canonical JID: the phone's when known. */
        get #id(): string {
            return jidNormalizedUser([this.#raw.id, this.#raw.pnJid].find((id) => id?.endsWith('@s.whatsapp.net')) ?? this.#raw.id);
        }

        /** Contacto del 1:1 desde su ficha guardada, sin consultar la red. / The 1:1 contact from its stored card, without querying the network. */
        async #person(): Promise<Contact> {
            return new wa.Contact((await read(`/contact/${this.#id}`)) ?? { id: this.#id });
        }

        /** Lanza en un 1:1: la operación sólo existe en grupos. / Throws on a 1:1: the operation only exists in groups. */
        get #group(): string {
            if (this.type === 'contact') throw new Error('UNAUTHORIZED');
            return this.#id;
        }

        /**
         * Aplica el cambio a la instancia y al documento guardado en cuanto WhatsApp lo acepta, y emite
         * el evento `chat:*` que corresponde; el eco que llega después ya no encuentra diferencia y no
         * lo repite. Un chat que no está guardado sólo cambia en la instancia.
         * Applies the change to the instance and to the stored document as soon as WhatsApp accepts
         * it, and emits the matching `chat:*` event; the echo arriving later finds no difference and
         * does not repeat it. A chat that is not stored only changes in the instance.
         *
         * @param patch - Campos del `Chat` de baileys / Fields of the baileys `Chat`
         */
        async #save(patch: Partial<Raw>): Promise<void> {
            Object.assign(this.#raw, patch);
            const current = await read<Raw & { id: string }>(`/chat/${this.#id}`);
            if (current === null) return;
            const doc = { ...current, ...patch, id: current.id };
            const muted = (raw: Partial<Raw>) => toNumber(raw.muteEndTime) > Date.now();
            await write(`/chat/${this.#id}`, doc, toNumber(current.conversationTimestamp) * 1_000 || undefined);
            [
                'pinned' in patch && Boolean(toNumber(patch.pinned)) !== Boolean(toNumber(current.pinned)) && (toNumber(patch.pinned) ? 'chat:pinned' : 'chat:unpinned'),
                'archived' in patch && Boolean(patch.archived) !== Boolean(current.archived) && (patch.archived ? 'chat:archived' : 'chat:unarchived'),
                'muteEndTime' in patch && muted(patch) !== muted(current) && (muted(patch) ? 'chat:muted' : 'chat:unmuted'),
                (['name', 'description', 'ephemeralExpiration'] as const).some((field) => field in patch && patch[field] !== current[field]) && 'chat:updated',
            ].filter((event): event is 'chat:pinned' => Boolean(event)).forEach((event) => wa.emit(event, new Chat(doc), wa));
        }

        /** JID completo: el del teléfono en un 1:1, `@g.us` en un grupo, el LID si no está mapeado; el mismo formato que `contact.id` y `msg.cid`. / Full JID: the phone's on a 1:1, `@g.us` on a group, the LID when unmapped; the same format as `contact.id` and `msg.cid`. */
        get id(): string {
            return this.#id;
        }

        /** Conversación 1:1 o grupo. / 1:1 conversation or group. */
        get type(): 'contact' | 'group' {
            return this.#id.endsWith('@g.us') ? 'group' : 'contact';
        }

        /** Mensajes sin leer. / Unread messages. */
        get count(): number {
            return Math.max(this.#raw.unreadCount ?? 0, 0);
        }

        /**
         * Sin argumento, el nombre del contacto o el asunto del grupo. Con texto, en un 1:1 cambia el
         * nombre con que la cuenta guarda al contacto en su agenda —en el chat y en la ficha, como
         * `contact.rename(value)`—; en un grupo, el asunto.
         * With no argument, the contact's name or the group subject. With text, on a 1:1 it changes
         * the name the account saves the contact with in its address book —on the chat and on the card,
         * like `contact.rename(value)`—; on a group, the subject.
         *
         * @param value - Nombre nuevo / New name
         * @throws UNAUTHORIZED sin permiso o fuera del grupo / without permission or outside the group
         */
        name(): string;
        name(value: string): Promise<string>;
        name(value?: string): string | Promise<string> {
            return value === undefined
                ? (this.#raw.name ?? this.#id.split('@')[0]!)
                : (this.type === 'group' ? instance.socket.groupUpdateSubject(this.#id, value) : instance.socket.addOrEditContact(this.#id, { fullName: value, saveOnPrimaryAddressbook: true }))
                    .catch(denied)
                    .then(() => Promise.all([this.#save({ name: value }), this.type === 'contact' && read<ConstructorParameters<Instance['wa']['Contact']>[0]>(`/contact/${this.#id}`).then(async (card) => {
                        if (card && card.name !== value) {
                            await write(`/contact/${this.#id}`, { ...card, name: value });
                            wa.emit('contact:updated', new wa.Contact({ ...card, name: value }), this, wa);
                        }
                    })]))
                    .then(() => value);
        }

        /**
         * Sin argumento, la descripción del grupo o, en un 1:1, la biografía del contacto. Con texto
         * cambia la descripción del grupo, y vacía la borra.
         * With no argument, the group description or, on a 1:1, the contact's bio. With text it
         * changes the group description, and an empty one removes it.
         *
         * @param value - Descripción nueva / New description
         * @throws UNAUTHORIZED en un 1:1, sin permiso o fuera del grupo / on a 1:1, without permission or outside the group
         */
        async content(value?: string): Promise<string> {
            if (value !== undefined) {
                await instance.socket.groupUpdateDescription(this.#group, value || undefined).catch(denied);
                await this.#save({ description: value || null });
                groups.delete(this.#id);
                return value;
            }
            return this.type === 'group'
                ? (this.#raw.description ?? (await meta(this.#id)).desc ?? '')
                : (await this.#person()).content();
        }

        /**
         * Sin argumento, la foto del grupo o, en un 1:1, la del contacto; Buffer vacío si no hay o la
         * privacidad la oculta. La del grupo se guarda bajo `/chat/<id>/photo` y sólo se descarga
         * cuando cambia. Con un Buffer cambia la del grupo, y null la quita.
         * With no argument, the group picture or, on a 1:1, the contact's; empty Buffer when there is
         * none or privacy hides it. The group's is stored under `/chat/<id>/photo` and only
         * downloaded when it changes. With a Buffer it changes the group's, and null removes it.
         *
         * @param value - Foto nueva, o null para quitarla / New picture, or null to remove it
         * @throws UNAUTHORIZED en un 1:1, sin permiso o fuera del grupo / on a 1:1, without permission or outside the group
         * @throws ERR_PROFILE_PICTURE_LIB si falta `sharp` o `jimp` / when `sharp` or `jimp` is missing
         */
        async photo(value?: Buffer | null): Promise<Buffer> {
            if (value !== undefined) {
                await (value === null ? instance.socket.removeProfilePicture(this.#group) : instance.socket.updateProfilePicture(this.#group, value)).catch((error: Error & { data?: unknown }) => {
                    throw /image processing library/i.test(error.message) ? new Error('ERR_PROFILE_PICTURE_LIB') : denied(error);
                });
            }
            if (this.type === 'contact') return (await this.#person()).photo();
            return picture(`/chat/${this.#id}/photo`, () => instance.socket.profilePictureUrl(this.#id, 'image').then((found) => found ?? null, (error: { data?: unknown }) => ([401, 404].includes(Number(error?.data)) ? null : undefined)), value !== undefined);
        }

        /** Sin argumento dice si está archivado; con él lo archiva o lo saca. / With no argument it says whether it is archived; with one it archives or unarchives it. */
        archived(): boolean;
        archived(value: boolean): Promise<boolean>;
        archived(value?: boolean): boolean | Promise<boolean> {
            return value === undefined
                ? Boolean(this.#raw.archived)
                : tail(this.#id).then((lastMessages) => instance.socket.chatModify({ archive: value, lastMessages }, this.#id)).then(() => this.#save({ archived: value })).then(() => value);
        }

        /**
         * Sin argumento dice si está fijado; con él lo fija o lo suelta. WhatsApp admite tres fijados:
         * se cuentan con el índice `/pinned`, una sola lectura.
         * With no argument it says whether it is pinned; with one it pins or unpins it. WhatsApp allows
         * three pinned: they are counted with the `/pinned` index, a single read.
         */
        pinned(): boolean;
        pinned(value: boolean): Promise<boolean>;
        pinned(value?: boolean): boolean | Promise<boolean> {
            return value === undefined
                ? Boolean(toNumber(this.#raw.pinned))
                : read<string[]>('/pinned').then(async (list) => {
                    const others = (list ?? []).filter((jid) => jid !== this.#id);
                    if (value && others.length >= 3) return this.pinned();
                    await instance.socket.chatModify({ pin: value }, this.#id);
                    await Promise.all([this.#save({ pinned: value ? Date.now() : null }), list && write('/pinned', value ? [...others, this.#id] : others)]);
                    return value;
                });
        }

        /** Sin argumento, la fecha ISO hasta la que está silenciado, o null; con ella lo silencia, y false lo reactiva. / With no argument, the ISO date it stays muted until, or null; with one it mutes it, and false unmutes it. */
        muted(): string | null;
        muted(until: string | number | Date | false): Promise<string | null>;
        muted(until?: string | number | Date | false): string | null | Promise<string | null> {
            if (until === undefined) {
                const end = toNumber(this.#raw.muteEndTime);
                return end > Date.now() ? new Date(end).toISOString() : null;
            }
            const end = until === false ? 0 : new Date(until).getTime();
            return instance.socket.chatModify({ mute: end > Date.now() ? end : null }, this.#id).then(() => this.#save({ muteEndTime: end > Date.now() ? end : null })).then(() => this.muted());
        }

        /**
         * Sin argumento dice si la cuenta tiene bloqueado al contacto, desde la lista que la sesión
         * guarda al conectar; con él lo bloquea o lo desbloquea y actualiza esa lista, porque WhatsApp
         * no avisa del cambio propio.
         * With no argument it says whether the account has the contact blocked, from the list the
         * session stores on connect; with one it blocks or unblocks it and updates that list, because
         * WhatsApp does not notify the own change.
         *
         * @param value - true bloquea, false desbloquea / true blocks, false unblocks
         * @throws UNAUTHORIZED en un grupo / on a group
         */
        async blocked(value?: boolean): Promise<boolean> {
            if (this.type === 'group') throw new Error('UNAUTHORIZED');
            const list = (await read<string[]>('/blocklist')) ?? (await instance.socket.fetchBlocklist().catch(() => [])).filter((entry): entry is string => Boolean(entry)).map((entry) => jidNormalizedUser(entry));
            if (value !== undefined) {
                await instance.socket.updateBlockStatus(this.#id, value ? 'block' : 'unblock');
                await write('/blocklist', value ? [...new Set([...list, this.#id])] : list.filter((jid) => jid !== this.#id));
            }
            return value ?? list.includes(this.#id);
        }

        /** Sin argumento, los segundos de los mensajes temporales o false; con ellos los fija. / With no argument, the disappearing-messages seconds or false; with them it sets them. */
        ephemeral(): number | false;
        ephemeral(value: 86_400 | 604_800 | 7_776_000 | false): Promise<number | false>;
        ephemeral(value?: 86_400 | 604_800 | 7_776_000 | false): number | false | Promise<number | false> {
            return value === undefined
                ? (this.#raw.ephemeralExpiration || false)
                : (this.type === 'group' ? instance.socket.groupToggleEphemeral(this.#id, value || 0) : instance.socket.sendMessage(this.#id, { disappearingMessagesInChat: value })).catch(denied).then(() => this.#save({ ephemeralExpiration: value || 0 })).then(() => value);
        }

        /**
         * Con true, o sin argumento, marca leídos los mensajes pendientes y deja `count` en cero; con
         * false marca el chat como no leído, como la opción de WhatsApp.
         * With true, or no argument, marks the pending messages as read and resets `count`; with
         * false it marks the chat as unread, like WhatsApp's option.
         *
         * @param value - false marca como no leído / false marks as unread
         */
        async seen(value = true): Promise<boolean> {
            const messages = await tail(this.#id);
            if (value) {
                await awake();
                if (messages.length) await instance.socket.readMessages(messages.map(({ key }) => key));
            }
            await instance.socket.chatModify({ markRead: value, lastMessages: messages }, this.#id).catch(() => null);
            await this.#save({ unreadCount: value ? 0 : -1 });
            return value;
        }

        /**
         * @param offset - Desplazamiento / Offset
         * @param limit - Tamaño de página / Page size
         * @returns Mensajes guardados, del más nuevo al más viejo / Stored messages, newest first
         */
        async messages(offset = 0, limit = 50): Promise<Message[]> {
            return wa.Message.list(this.#id, offset, limit);
        }

        /** Vacía los mensajes en la cuenta y en el engine, conservando el chat. / Clears the messages on the account and in the engine, keeping the chat. */
        async clear(): Promise<boolean> {
            await instance.socket.chatModify({ clear: true, lastMessages: await tail(this.#id) }, this.#id).catch(() => null);
            return engine.unset(`/chat/${this.#id}/message`);
        }

        /**
         * Elimina el chat de la cuenta y del engine. En un grupo, además sale de él —si todavía es
         * parte— y espera el aviso de salida, que baileys emite como un `chats.update` de sólo
         * lectura, para que no vuelva a crear el chat detrás del borrado.
         * Deletes the chat from the account and the engine. On a group it also leaves it —when still
         * a member— and waits for the leave notice, which baileys emits as a read-only
         * `chats.update`, so it does not create the chat again behind the deletion.
         */
        async delete(): Promise<boolean> {
            if (this.type === 'group') {
                const left = new Promise<void>((done) => {
                    const listen = (rows: Partial<Raw>[]) => {
                        if (rows.some((row) => row.id === this.#id && row.readOnly)) finish();
                    };
                    const timer = setTimeout(() => finish(), 10_000);
                    const finish = () => {
                        clearTimeout(timer);
                        instance.socket.ev.off('chats.update', listen);
                        done();
                    };
                    instance.socket.ev.on('chats.update', listen);
                });
                await instance.socket.groupLeave(this.#id).then(() => left, () => null);
            }
            await instance.socket.chatModify({ delete: true, lastMessages: await tail(this.#id) }, this.#id).catch(() => null);
            instance.socket.ev.emit('chats.delete', [this.#id]);
            return true;
        }

        /**
         * @param offset - Desplazamiento / Offset
         * @param limit - Tamaño de página / Page size
         * @returns Participantes del grupo, o el contacto y la cuenta en un 1:1 / Group participants, or the contact and the account on a 1:1
         * @throws UNAUTHORIZED fuera del grupo / outside the group
         */
        async members(offset = 0, limit = 50): Promise<Contact[]> {
            const ids = this.type === 'group'
                ? (await meta(this.#id)).participants.map((participant) => participant.phoneNumber ?? participant.id)
                : [this.#id, jidNormalizedUser(instance.socket.user?.id ?? '')];
            return Chat.#people(ids.slice(offset, offset + limit));
        }

        /**
         * @param offset - Desplazamiento / Offset
         * @param limit - Tamaño de página / Page size
         * @returns Administradores del grupo / Group admins
         * @throws UNAUTHORIZED en un 1:1 o fuera del grupo / on a 1:1 or outside the group
         */
        async admins(offset = 0, limit = 50): Promise<Contact[]> {
            const ids = (await meta(this.#group)).participants.filter((participant) => participant.admin).map((participant) => participant.phoneNumber ?? participant.id);
            return Chat.#people(ids.slice(offset, offset + limit));
        }

        /**
         * Sin argumentos dice si la cuenta administra el grupo; con un valor y participantes les da o
         * les quita el rango y devuelve a cuántos se aplicó.
         * With no arguments it says whether the account administers the group; with a value and
         * participants it grants or removes the rank and returns how many it applied to.
         *
         * @throws UNAUTHORIZED en un 1:1, sin permiso o fuera del grupo / on a 1:1, without permission or outside the group
         */
        admin(): Promise<boolean>;
        admin(value: boolean, ...who: Who[]): Promise<number>;
        async admin(value?: boolean, ...who: Who[]): Promise<boolean | number> {
            if (value !== undefined) return this.#participants(value ? 'promote' : 'demote', who);
            const mine = [instance.socket.user?.id, instance.socket.user?.lid].filter((id): id is string => Boolean(id)).map((id) => jidNormalizedUser(id));
            return (await meta(this.#group)).participants.some((participant) => Boolean(participant.admin) && mine.includes(jidNormalizedUser(participant.phoneNumber ?? participant.id)));
        }

        /** @returns Cuántos entraron; quien por privacidad no admite ser agregado necesita el enlace / How many joined; whoever's privacy forbids being added needs the link */
        async add(...who: Who[]): Promise<number> {
            return this.#participants('add', who);
        }

        /** @returns Cuántos salieron / How many left */
        async remove(...who: Who[]): Promise<number> {
            return this.#participants('remove', who);
        }

        /**
         * @param action - Operación sobre los participantes / Operation on the participants
         * @param who - Participantes / Participants
         */
        async #participants(action: 'add' | 'remove' | 'promote' | 'demote', who: Who[]): Promise<number> {
            const result = await instance.socket.groupParticipantsUpdate(this.#group, await Chat.#targets(who), action).catch(denied);
            groups.delete(this.#id);
            return result.filter((entry) => entry.status === '200').length;
        }

        /** Enlace de invitación vigente. / Current invite link. */
        async invite(): Promise<string> {
            return link(await instance.socket.groupInviteCode(this.#group).catch(denied));
        }

        /** Anula el enlace y devuelve el nuevo. / Revokes the link and returns the new one. */
        async revoke(): Promise<string> {
            return link(await instance.socket.groupRevokeInvite(this.#group).catch(denied));
        }

        /** Sin argumento dice si sólo los administradores envían; con él lo cambia. / With no argument it says whether only admins send; with one it changes it. */
        async announce(value?: boolean): Promise<boolean> {
            if (value === undefined) return Boolean((await meta(this.#group)).announce);
            await instance.socket.groupSettingUpdate(this.#group, value ? 'announcement' : 'not_announcement').catch(denied);
            groups.delete(this.#id);
            return value;
        }

        /** Sin argumento dice si sólo los administradores editan la info; con él lo cambia. / With no argument it says whether only admins edit the info; with one it changes it. */
        async restrict(value?: boolean): Promise<boolean> {
            if (value === undefined) return Boolean((await meta(this.#group)).restrict);
            await instance.socket.groupSettingUpdate(this.#group, value ? 'locked' : 'unlocked').catch(denied);
            groups.delete(this.#id);
            return value;
        }

        /**
         * Se suscribe a todo lo que le pasa al chat: se crea, cambia, se borra, llega un mensaje —en
         * `message`—, entran, salen, suben o bajan participantes —en `contacts`— o, en un 1:1, el
         * contacto cambia su presencia —en `presence`—. La presencia se pide a WhatsApp de fondo.
         * Subscribes to everything that happens to the chat: created, updated, deleted, a message
         * arrives —in `message`—, participants join, leave, are promoted or demoted —in `contacts`— or,
         * on a 1:1, the contact changes presence —in `presence`—. Presence is requested in the background.
         *
         * @param handler - Recibe cada cambio / Receives every change
         * @returns Función para desuscribirse / Function to unsubscribe
         */
        sub(handler: (event: WatchEvent<ChatEvent, Chat> & { message?: Message; contacts?: Contact[]; presence?: Presence }) => void): () => void {
            const mine = (room: Chat) => room.#id === this.#id;
            let presence: (() => void) | undefined;
            let active = true;
            if (this.type === 'contact') {
                void this.#person().then((person) => {
                    if (active) presence = person.sub((event) => ['online', 'offline', 'typing', 'recording'].includes(event.name) && handler({ name: 'presence', payload: this, presence: event.name as Presence }));
                }, () => null);
            }
            const off = [
                wa.on('chat:created', (room) => mine(room) && handler({ name: 'created', payload: room })),
                wa.on('chat:deleted', (room) => mine(room) && handler({ name: 'deleted', payload: room })),
                ...(['chat:updated', 'chat:pinned', 'chat:unpinned', 'chat:archived', 'chat:unarchived', 'chat:muted', 'chat:unmuted'] as const).map((name) => wa.on(name, (room) => mine(room) && handler({ name: 'updated', payload: room }))),
                ...(['joined', 'left', 'promoted', 'demoted'] as const).map((name) => wa.on(`chat:${name}`, (room, contacts) => mine(room) && handler({ name, payload: room, contacts }))),
                wa.on('message:created', (message, room) => mine(room) && handler({ name: 'message', payload: room, message })),
            ];
            return () => {
                active = false;
                presence?.();
                off.forEach((unsubscribe) => unsubscribe());
            };
        }

        /**
         * @param cid - Teléfono, JID, LID o id de grupo / Phone, JID, LID or group id
         * @returns El chat guardado, o null si no existe / The stored chat, or null when missing
         */
        static async get(cid: string | number): Promise<Chat | null> {
            const id = await resolve(String(cid));
            const raw = id ? await read<Raw & { id: string }>(`/chat/${id}`) : null;
            return raw ? new this(raw) : null;
        }

        /**
         * @param offset - Desplazamiento / Offset
         * @param limit - Tamaño de página / Page size
         * @returns Chats del más activo al más antiguo / Chats from the most active to the oldest
         */
        static async list(offset = 0, limit = 50): Promise<Chat[]> {
            return (await engine.list('/chat', offset, limit)).flatMap((raw) => {
                const doc = deserialize<Raw & { id: string }>(raw);
                return doc ? [new this(doc)] : [];
            });
        }

        /**
         * @param name - Asunto del grupo / Group subject
         * @param members - Participantes; quien por privacidad no admite ser agregado queda fuera / Participants; whoever's privacy forbids being added stays out
         * @returns El grupo, ya guardado, con la cuenta como administradora / The group, already stored, with the account as admin
         */
        static async create(name: string, members: Who[]): Promise<Chat> {
            const created = await instance.socket.groupCreate(name, await Chat.#targets(members));
            const raw: Raw & { id: string } = { ...(await read<Raw>(`/chat/${created.id}`)), id: created.id, name: created.subject || name, conversationTimestamp: Math.floor(Date.now() / 1_000) };
            await write(`/chat/${created.id}`, raw, Date.now());
            return new this(raw);
        }

        /**
         * @param invite - Enlace o código de invitación / Invite link or code
         * @returns El grupo, o null si el enlace no sirve / The group, or null when the link is invalid
         */
        static async join(invite: string): Promise<Chat | null> {
            const jid = await instance.socket.groupAcceptInvite(invite.split('/').pop()?.split('?')[0] ?? invite).catch(() => null);
            return jid ? new this((await read<Raw & { id: string }>(`/chat/${jid}`)) ?? { id: jid, conversationTimestamp: Math.floor(Date.now() / 1_000) }) : null;
        }
    };
}

/** El chat ligado a la sesión, para tipar sin instanciar. / The session-bound chat, to type without instantiating. */
export type Chat = InstanceType<ReturnType<typeof chat>>;
