/**
 * @file chat/index.ts
 * @description Entidad Chat — conversaciones individuales y grupales.
 * Chat entity — individual and group conversations.
 */

import type { WASocket } from 'baileys';
import type Contact from '~/lib/contact';
import type Message from '~/lib/message';
import { deserialize, jid_of, serialize, type Engine } from '~/lib/store';
import type WhatsApp from '~/lib/whatsapp';

/**
 * Chat: recibe el raw y deriva todo con getters.
 * Chat: receives the raw and derives everything via getters.
 */
export default class Chat {
    /**
     * @internal Documento crudo. `id` es el identificador del engine (JID, LID o `@g.us`);
     * `pinned`, `mute_end_time` y `activity` son epoch ms.
     * Raw document. `id` is the engine identifier (JID, LID or `@g.us`); `pinned`,
     * `mute_end_time` and `activity` are epoch ms.
     */
    constructor(
        readonly _raw: {
            id: string;
            name?: string | null;
            archived?: boolean | null;
            pinned?: number | null;
            mute_end_time?: number | null;
            unread_count?: number | null;
            /** Epoch ms del último mensaje: ordena la lista y sobrevive a las escrituras de flags. / Last message epoch ms: orders the list and survives flag writes. */
            activity?: number | null;
        }
    ) { }

    /** Teléfono del contacto, o el identificador crudo en grupos y LIDs. / Contact phone, or the raw identifier for groups and LIDs. */
    get id(): string {
        return this._raw.id.endsWith('@s.whatsapp.net') ? this._raw.id.split('@')[0].split(':')[0] : this._raw.id;
    }

    /** Nombre del grupo o del contacto. / Group or contact name. */
    get name(): string {
        return this._raw.name ?? this.id;
    }

    /** Tipo de conversación. / Conversation type. */
    get type(): 'group' | 'contact' {
        return this._raw.id.endsWith('@g.us') ? 'group' : 'contact';
    }

    /** true si el chat está archivado. / true when the chat is archived. */
    get archived(): boolean {
        return this._raw.archived ?? false;
    }

    /** true si el chat está fijado. / true when the chat is pinned. */
    get pinned(): boolean {
        return this._raw.pinned != null;
    }

    /** Mensajes sin leer del chat. / Chat's unread messages. */
    get count(): number {
        return this._raw.unread_count ?? 0;
    }

    /** Fecha ISO UTC hasta la que el chat está silenciado, o null. / ISO UTC date until the chat stays muted, or null. */
    get muted(): string | null {
        const end = this._raw.mute_end_time;
        return end != null && end > Date.now() ? new Date(end).toISOString() : null;
    }
}

/**
 * Chat ligado a la sesión viva: el socket y el engine llegan resueltos, así que sus métodos
 * no vuelven a comprobarlos.
 * Chat bound to the live session: socket and engine arrive resolved, so its methods do not
 * check them again.
 *
 * @param init - Sesión activa: cliente, motor y socket / Active session: client, engine and socket
 * @returns Clase `Chat` con acceso a la sesión / `Chat` class with session access
 */
export function chat(init: { wa: WhatsApp; engine: Engine; socket: WASocket }) {
    // WhatsApp acepta 3 chats fijados y descarta el cuarto sin avisar.
    // WhatsApp accepts 3 pinned chats and silently drops the fourth.
    const MAX_PINNED = 3;

    /**
     * Último mensaje del chat, en las dos formas que hacen falta: la marca de actividad que
     * ordena la lista y el `lastMessages` que exige `chatModify`.
     * The chat's last message, in the two shapes needed: the activity stamp that orders the
     * list and the `lastMessages` shape `chatModify` requires.
     */
    const tail = async (cid: string) => {
        const doc = deserialize<{ id: string; me: boolean; created_at: number }>((await init.engine.list(`/chat/${cid}/message`, 0, 1))[0] ?? null);
        return {
            at: doc?.created_at ?? 0,
            messages: doc ? [{ key: { remoteJid: cid, id: doc.id, fromMe: doc.me }, messageTimestamp: Math.floor(doc.created_at / 1_000) }] : [],
        };
    };

    /**
     * Metadatos del grupo memoizados 15s: `members` y `content` los piden por cada chat de
     * una página y sin caché sería un round-trip por fila.
     * Group metadata memoized for 15s: `members` and `content` ask for them on every chat of
     * a page, and without a cache that is one round-trip per row.
     */
    const groups = new Map<string, Promise<{ participants: { id: string }[]; desc?: string | null }>>();
    const meta = (jid: string) => {
        if (!groups.has(jid)) {
            groups.set(jid, init.socket.groupMetadata(jid).catch(() => ({ participants: [] })));
            setTimeout(() => groups.delete(jid), 15_000);
        }
        return groups.get(jid)!;
    };

    class _Chat extends Chat {
        /**
         * Participantes: los integrantes en grupos, el contacto y yo en 1:1.
         * Participants: members for groups, the contact and myself for 1:1.
         *
         * @param offset - Desplazamiento / Offset
         * @param limit - Tamaño de página / Page size
         * @returns Página de contactos / Contact page
         */
        async members(offset = 0, limit = 50): Promise<Contact[]> {
            const ids = this.type === 'group'
                ? (await meta(this._raw.id)).participants.map((participant) => participant.id)
                : [this._raw.id, init.socket.user?.id].filter((id): id is string => Boolean(id));
            return Promise.all(ids.slice(offset, offset + limit).map(async (id) =>
                new init.wa.Contact(deserialize<Contact['_raw']>(await init.engine.get(`/contact/${id}`)) ?? { id })
            ));
        }

        /**
         * Descripción: el asunto del grupo o, en un 1:1, la bio del contacto. Es asíncrono
         * porque ninguna de las dos vive en el documento del chat.
         * Description: the group's subject or, on a 1:1, the contact's bio. It is async because
         * neither of them lives in the chat document.
         *
         * @returns Descripción, o cadena vacía / Description, or an empty string
         */
        async content(): Promise<string> {
            return this.type === 'group'
                ? (await meta(this._raw.id)).desc ?? ''
                : deserialize<Contact['_raw']>(await init.engine.get(`/contact/${this._raw.id}`))?.status ?? '';
        }

        /**
         * Mensajes del chat, del más reciente al más antiguo.
         * Chat messages, from the most recent to the oldest.
         *
         * @param offset - Desplazamiento / Offset
         * @param limit - Tamaño de página / Page size
         * @returns Página de mensajes / Message page
         */
        async messages(offset = 0, limit = 50): Promise<Message[]> {
            return init.wa.Message.list(this._raw.id, offset, limit);
        }

        /**
         * Publica el indicador «escribiendo…».
         * Publishes the "typing…" indicator.
         *
         * @param value - true escribe, false vuelve a pausa / true types, false returns to paused
         */
        async typing(value: boolean): Promise<boolean> {
            await init.socket.sendPresenceUpdate(value ? 'composing' : 'paused', this._raw.id);
            return true;
        }

        /**
         * Publica el indicador «grabando audio…».
         * Publishes the "recording audio…" indicator.
         *
         * @param value - true graba, false vuelve a pausa / true records, false returns to paused
         */
        async recording(value: boolean): Promise<boolean> {
            await init.socket.sendPresenceUpdate(value ? 'recording' : 'paused', this._raw.id);
            return true;
        }

        /**
         * Archiva o desarchiva el chat en la cuenta.
         * Archives or unarchives the chat on the account.
         *
         * @param value - true archiva, false desarchiva / true archives, false unarchives
         */
        async archive(value: boolean): Promise<boolean> {
            const last = await tail(this._raw.id);
            await init.socket.chatModify({ archive: value, lastMessages: last.messages }, this._raw.id);
            this._raw.archived = value;
            // Archivar no es actividad: el chat conserva su posición en la lista.
            // Archiving is not activity: the chat keeps its position in the list.
            await init.engine.set(`/chat/${this._raw.id}`, serialize(this._raw), this._raw.activity ?? last.at);
            return true;
        }

        /**
         * Fija o desfija el chat. Al fijar comprueba el límite, porque WhatsApp descarta el
         * cuarto chat fijado sin avisar.
         * Pins or unpins the chat. When pinning it checks the limit, since WhatsApp silently
         * drops the fourth pinned chat.
         *
         * @param value - true fija, false desfija / true pins, false unpins
         * @returns false si ya hay 3 chats fijados / false when 3 chats are already pinned
         */
        async pin(value: boolean): Promise<boolean> {
            let pinned = 0;
            for (let offset = 0; value && pinned < MAX_PINNED; offset += 200) {
                const page = await init.engine.list('/chat', offset, 200);
                if (page.length === 0) {
                    break;
                }
                pinned += page.filter((raw) => {
                    const doc = deserialize<Chat['_raw']>(raw);
                    return doc?.pinned != null && doc.id !== this._raw.id;
                }).length;
            }
            if (pinned >= MAX_PINNED) {
                return false;
            }
            await init.socket.chatModify({ pin: value }, this._raw.id);
            this._raw.pinned = value ? Date.now() : null;
            await init.engine.set(`/chat/${this._raw.id}`, serialize(this._raw), this._raw.activity ?? (await tail(this._raw.id)).at);
            return true;
        }

        /**
         * Silencia el chat hasta la fecha indicada; `false` o una fecha pasada lo reactivan.
         * Mutes the chat until the given date; `false` or a past date unmutes it.
         *
         * @param until - Fecha límite (ISO, epoch ms o Date), o false / Deadline (ISO, epoch ms or Date), or false
         */
        async mute(until: string | number | Date | false): Promise<boolean> {
            const end = until === false ? 0 : new Date(until).getTime();
            const muted = end > Date.now();
            await init.socket.chatModify({ mute: muted ? end : null }, this._raw.id);
            this._raw.mute_end_time = muted ? end : null;
            await init.engine.set(`/chat/${this._raw.id}`, serialize(this._raw), this._raw.activity ?? (await tail(this._raw.id)).at);
            return true;
        }

        /**
         * Marca el chat completo como leído en la cuenta.
         * Marks the whole chat as read on the account.
         */
        async seen(): Promise<boolean> {
            const last = await tail(this._raw.id);
            // Marcar leído se acusa con recibos, no con una mutación del estado de la app.
            // `chatModify({ markRead })` emite un app patch, y cuando el estado local va por
            // detrás del servidor —lo normal en un dispositivo recién vinculado, que arranca en
            // v0— WhatsApp responde al patch expulsando el dispositivo: `conflict
            // (device_removed)`. Abrir un chat basta para provocarlo, así que la línea se caía
            // sola al primer chat que se mirara. Los recibos no tocan el estado de la app.
            // Marking read is acknowledged with receipts, not with an app-state mutation.
            // `chatModify({ markRead })` emits an app patch, and when the local state trails the
            // server —the norm on a freshly linked device, which starts at v0— WhatsApp answers
            // that patch by dropping the device: `conflict (device_removed)`. Opening a chat was
            // enough to trigger it, so the line died on the first chat anyone looked at.
            // Receipts leave the app state alone.
            const keys = last.messages.map(({ key }) => ({ remoteJid: key.remoteJid, id: key.id, participant: undefined }));
            if (keys.length) {
                await init.socket.readMessages(keys);
            }
            this._raw.unread_count = 0;
            await init.engine.set(`/chat/${this._raw.id}`, serialize(this._raw), this._raw.activity ?? last.at);
            return true;
        }

        /**
         * Vacía los mensajes del chat en la cuenta y en el engine, conservando el chat.
         * Clears the chat messages on the account and in the engine, keeping the chat.
         */
        async clear(): Promise<boolean> {
            await init.socket.chatModify({ clear: true, lastMessages: (await tail(this._raw.id)).messages }, this._raw.id).catch(() => null);
            await init.engine.unset(`/chat/${this._raw.id}/message`);
            return true;
        }

        /**
         * Elimina el chat y sus mensajes en la cuenta y en el engine; en grupos, además sale
         * del grupo.
         * Deletes the chat and its messages on the account and in the engine; for groups it
         * also leaves the group.
         */
        async delete(): Promise<boolean> {
            await (this.type === 'group'
                ? init.socket.groupLeave(this._raw.id)
                : init.socket.chatModify({ delete: true, lastMessages: (await tail(this._raw.id)).messages }, this._raw.id)
            ).catch(() => null);
            await init.engine.unset(`/chat/${this._raw.id}`);
            return true;
        }

        /**
         * Chat por teléfono, JID, LID o id de grupo: el persistido o, si no existe todavía,
         * una instancia mínima lista para usar que no se persiste.
         * Chat by phone, JID, LID or group id: the persisted one or, when it does not exist
         * yet, a minimal ready-to-use instance that is not persisted.
         *
         * @param cid - Teléfono, JID, LID o id de grupo / Phone, JID, LID or group id
         * @returns Chat, o null si el identificador es irresoluble / Chat, or null when the identifier cannot be resolved
         */
        static async get(cid: string | number): Promise<_Chat | null> {
            const id = await jid_of(init.engine, String(cid), init.socket);
            return id ? new this(deserialize<Chat['_raw']>(await init.engine.get(`/chat/${id}`)) ?? { id }) : null;
        }

        /**
         * Pagina los chats persistidos, del más activo al más antiguo.
         * Paginates persisted chats, from the most active to the oldest.
         *
         * @param offset - Desplazamiento / Offset
         * @param limit - Tamaño de página / Page size
         * @returns Página de chats / Chat page
         */
        static async list(offset = 0, limit = 50): Promise<_Chat[]> {
            return (await init.engine.list('/chat', offset, limit))
                .map((raw) => deserialize<Chat['_raw']>(raw))
                .filter((doc): doc is Chat['_raw'] => doc !== null)
                .map((doc) => new this(doc));
        }
    }

    return _Chat;
}
