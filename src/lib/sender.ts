/**
 * @file sender.ts
 * @description Base de `Contact`, `Chat` y `Message`: cada una dice por `[route]` qué es y a qué
 * chat pertenece, y con eso la base resuelve los envíos —como estáticos que reciben el chat y en la
 * instancia, que en un mensaje lo citan—, la presencia al escribir o grabar, los metadatos y el
 * acceso al engine que comparten.
 * Base of `Contact`, `Chat` and `Message`: each one tells through `[route]` what it is and which
 * chat it belongs to, and with that the base resolves the sends —as statics that take the chat and
 * on the instance, which on a message quote it—, the presence when typing or recording, the
 * metadata and the engine access they share.
 */

import { generateWAMessage, jidNormalizedUser, toNumber, type AnyMessageContent, type WAMessage } from 'baileys';
import type { Contact } from '~/lib/contact';
import type { Message } from '~/lib/message';
import { deserialize, serialize } from '~/lib/store';
import type { Instance } from '~/lib/whatsapp';

export type Who = Contact | string | number;
export type Route = { type: 'contact' | 'chat' | 'message' | 'feed'; cid: string; mid?: string };
export type Extra = {
    /** Mensaje a citar. / Message to quote. */
    mid?: string;
    /** Una sola vista o reproducción. / View or play once. */
    once?: boolean;
    /** Segundos para que desaparezca. / Seconds until it disappears. */
    expiration?: 86_400 | 604_800 | 7_776_000;
    /** Contactos mencionados; en el texto se escriben como `@<teléfono>`. / Mentioned contacts; written in the text as `@<phone>`. */
    mentions?: Who[];
};

export const route = Symbol('route');
/** Llave de las capacidades compartidas; el paquete no la exporta. / Key of the shared capabilities; the package does not export it. */
export const internal = Symbol('internal');
const bases = new WeakMap<Instance, unknown>();

export default function sender(instance: Instance) {
    const { wa, engine } = instance;
    const read = async <T>(path: string): Promise<T | null> => deserialize<T>(await engine.get(path));
    const write = (path: string, doc: unknown, score?: number): Promise<void> => engine.set(path, serialize(doc), score);
    const resolve = async (uid: string): Promise<string | null> => {
        const lid = uid.endsWith('@lid') ? jidNormalizedUser(uid) : null;
        const found = lid ? ((await read<string>(`/lid/${lid}`)) ?? (await instance.socket.signalRepository?.lidMapping?.getPNForLID(lid).catch(() => null)) ?? lid) : uid.includes('@') ? uid : uid.replace(/\D/g, '');
        return found ? (found.includes('@') ? jidNormalizedUser(found) : `${found}@s.whatsapp.net`) : null;
    };
    const metadata = async (path: string, key?: string | Record<string, unknown>, value: unknown[] = []): Promise<unknown> => {
        const patch = typeof key === 'object' ? key : typeof key === 'string' && value.length ? { [key]: value[0] } : undefined;
        const next = Object.fromEntries(Object.entries({ ...(await read<Record<string, unknown>>(`${path}/metadata`)), ...patch }).filter(([, entry]) => entry != null));
        if (patch) await (Object.keys(next).length ? write(`${path}/metadata`, next) : engine.unset(`${path}/metadata`));
        return typeof key === 'string' && value.length === 0 ? (next[key] ?? null) : next;
    };
    /**
     * Imagen guardada bajo `path` con la URL de la que salió y la hora en que se consultó: durante 24 h
     * se devuelve la guardada sin salir a la red, salvo con `force`; después se pide la URL a `lookup` y
     * sólo se descarga si la imagen cambió. Una URL `null` es «sin imagen» y `undefined`, «sin red».
     * Image stored under `path` with the URL it came from and the time it was checked: for 24 h the
     * stored one is returned without going to the network, unless `force`; afterwards `lookup` gives
     * the URL and it is only downloaded when the image changed. A `null` URL means «no image» and
     * `undefined`, «no network».
     */
    const picture = async (path: string, lookup: () => Promise<string | null | undefined>, force = false): Promise<Buffer> => {
        const stored = await read<{ url: string | null; at?: number }>(path);
        const kept = (await engine.get_buffer?.(`${path}/content`)) ?? Buffer.from((await read<{ data: string }>(`${path}/content`))?.data ?? '', 'base64');
        if (stored && force === false && Date.now() - (stored.at ?? 0) < 86_400_000) return stored.url ? kept : Buffer.alloc(0);
        const url = await lookup();
        if (url === undefined) return kept;
        const same = Boolean(url && stored?.url && kept.length && new URL(stored.url).pathname === new URL(url).pathname);
        const fresh = url && same === false ? await fetch(url, { signal: AbortSignal.timeout(20_000) }).then(async (response) => (response.ok ? Buffer.from(await response.arrayBuffer()) : null), () => null) : null;
        if (url && same === false && fresh === null) return kept;
        if (url === null) await engine.unset(`${path}/content`);
        await Promise.all([write(path, { url, at: Date.now() }), fresh && (engine.set_buffer?.(`${path}/content`, fresh) ?? write(`${path}/content`, { data: fresh.toString('base64') }))]);
        return url === null ? Buffer.alloc(0) : (fresh ?? kept);
    };
    /** Traduce el rechazo de permiso de WhatsApp a `UNAUTHORIZED`; cualquier otro error sigue igual. / Translates a WhatsApp permission rejection into `UNAUTHORIZED`; any other error stays as is. */
    const denied = (error: { data?: unknown }): never => {
        throw [401, 403, 404, 406].includes(Number(error?.data)) ? new Error('UNAUTHORIZED') : error;
    };
    let idle: ReturnType<typeof setTimeout> | null = null;
    /**
     * Anuncia la cuenta en línea, como WhatsApp Web, y a los 30 s sin actividad la anuncia no
     * disponible: así se actualiza la última conexión que ven los demás.
     * Announces the account online, like WhatsApp Web, and after 30 s without activity announces it
     * unavailable: that updates the last seen others see.
     */
    const awake = async (): Promise<void> => {
        if (idle) clearTimeout(idle);
        else await instance.socket.sendPresenceUpdate('available').catch(() => null);
        idle = setTimeout(() => {
            idle = null;
            void instance.socket.sendPresenceUpdate('unavailable').catch(() => null);
        }, 30_000).unref();
    };
    class Sender {
        /** Qué es la instancia y a qué chat pertenece; cada entidad lo define. / What the instance is and which chat it belongs to; every entity defines it. */
        [route](): Route {
            throw new Error('ERR_NOT_IMPLEMENTED');
        }

        /**
         * Capacidades de la sesión que comparten las entidades —leer y escribir el engine, resolver
         * identificadores, metadatos, imágenes en caché, presencia y rechazos de permiso—; no forman
         * parte de la API.
         * Session capabilities shared by the entities —engine reads and writes, identifier
         * resolution, metadata, cached images, presence and permission rejections—; they are not part
         * of the API.
         *
         * @internal
         */
        static readonly [internal] = { read, write, resolve, metadata, picture, awake, denied };

        /**
         * Envío base: resuelve el chat, cita si hay `mid`, traduce las menciones al LID en los grupos
         * que lo usan, envía de una sola vista o con vencimiento, y guarda el mensaje, su binario y la
         * actividad del chat, que queda creado si no existía —con la ficha mínima del contacto, y en
         * `/unmapped` si es un LID sin teléfono—.
         * Base send: resolves the chat, quotes when `mid` is given, translates mentions to the LID in the
         * groups that use it, sends view-once or with expiration, and stores the message, its binary and
         * the chat activity, creating the chat when missing —with the contact's minimal card, and in
         * `/unmapped` when it is a LID without phone—.
         */
        static async #send(cid: string, content: Record<string, unknown>, extra: Extra = {}, binary?: Buffer): Promise<Message> {
            const { socket } = instance;
            const jid = await resolve(cid);
            if (jid === null) throw new Error('ERR_INVALID_CHAT');
            const quoted = extra.mid ? ((await read<WAMessage[]>(`/chat/${jid}/message/${extra.mid}`)) ?? (await read<WAMessage[]>(`/status/${extra.mid}`)))?.[0] : undefined;
            const lid = jid.endsWith('@g.us') && extra.mentions?.length ? (await socket.groupMetadata(jid).catch(() => null))?.addressingMode === 'lid' : false;
            const mentioned = await Promise.all((extra.mentions ?? []).map(async (who) => {
                const phone = (await resolve(typeof who === 'object' ? who.id : String(who))) ?? String(who);
                const alias = lid ? ((await read<string>(`/lid/${phone}`)) ?? (await socket.signalRepository?.lidMapping?.getLIDForPN(phone).catch(() => null))) : null;
                return { phone: phone.split('@')[0]!, target: jidNormalizedUser(alias ?? phone) };
            }));
            const rewrite = (text: string) => mentioned.reduce((body, entry) => body.split(`@${entry.phone}`).join(`@${entry.target.split('@')[0]}`), text);
            const payload = {
                ...content,
                ...(typeof content.text === 'string' && { text: rewrite(content.text) }),
                ...(typeof content.caption === 'string' && { caption: rewrite(content.caption) }),
                ...(mentioned.length && { mentions: mentioned.map((entry) => entry.target) }),
            } as AnyMessageContent;
            const options = { ...(quoted && { quoted }), ...(extra.expiration && { ephemeralExpiration: extra.expiration }) };
            const raw = extra.once
                ? await generateWAMessage(jid, payload, { ...options, logger: socket.logger, userJid: socket.user!.id, upload: socket.waUploadToServer }).then(async (full) => {
                    Object.values(full.message ?? {}).forEach((entry) => entry && typeof entry === 'object' && 'mimetype' in entry && Object.assign(entry, { viewOnce: true }));
                    full.key.isViewOnce = true;
                    await socket.relayMessage(jid, full.message!, { messageId: full.key.id! });
                    socket.ev.emit('messages.upsert', { messages: [full], type: 'append' });
                    return full;
                })
                : await socket.sendMessage(jid, payload, options);
            if (!raw?.key.id) throw new Error('ERR_SEND_FAILED');
            const at = toNumber(raw.messageTimestamp) * 1_000 || Date.now();
            const [room, unmapped, card] = await Promise.all([read<{ id: string; conversationTimestamp?: number }>(`/chat/${jid}`), jid.endsWith('@lid') ? read<string[]>('/unmapped') : null, jid.endsWith('@g.us') ? true : engine.get(`/contact/${jid}`)]);
            const doc = { ...room, id: room?.id ?? jid, ...(jid.endsWith('@s.whatsapp.net') && { pnJid: jid }), conversationTimestamp: Math.max(at / 1_000, toNumber(room?.conversationTimestamp)) };
            await Promise.all([
                room === null && unmapped && unmapped.includes(jid) === false && write('/unmapped', [...unmapped, jid]),
                card === null && write(`/contact/${jid}`, { id: jid, ...(jid.endsWith('@s.whatsapp.net') && { phoneNumber: jid }) }),
                write(`/chat/${jid}/message/${raw.key.id}`, [raw], at),
                binary && (engine.set_buffer?.(`/chat/${jid}/message/${raw.key.id}/content`, binary) ?? write(`/chat/${jid}/message/${raw.key.id}/content`, { data: binary.toString('base64') })),
                write(`/chat/${jid}`, doc, doc.conversationTimestamp * 1_000),
            ]);
            if (room === null) wa.emit('chat:created', new wa.Chat(doc), wa);
            return new wa.Message([raw]);
        }

        /** Envía texto. / Sends text. */
        static text(cid: string, caption: string, extra?: Extra): Promise<Message> {
            return Sender.#send(cid, { text: caption }, extra);
        }

        /** Envía una imagen; con `sticker`, un sticker en WebP convertido con `sharp` si hace falta. / Sends an image; with `sticker`, a WebP sticker converted with `sharp` when needed. */
        static async image(cid: string, buf: Buffer, extra: Extra & { caption?: string; sticker?: boolean } = {}): Promise<Message> {
            if (extra.sticker !== true) return Sender.#send(cid, { image: buf, caption: extra.caption }, extra, buf);
            const webp = buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
            const sharp = webp ? null : (await import('sharp').catch(() => {
                throw new Error('ERR_STICKER_LIB');
            })).default;
            return Sender.#send(cid, { sticker: sharp ? await sharp(buf).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp().toBuffer() : buf }, extra);
        }

        /** Envía un video; `gif` lo reproduce en bucle y sin sonido, y `ptv` lo envía como videonota redonda. / Sends a video; `gif` plays it looped and muted, and `ptv` sends it as a round video note. */
        static video(cid: string, buf: Buffer, extra: Extra & { caption?: string; gif?: boolean; ptv?: boolean } = {}): Promise<Message> {
            return Sender.#send(cid, { video: buf, caption: extra.caption, gifPlayback: extra.gif ?? false, ptv: extra.ptv ?? false }, extra, buf);
        }

        /** Envía audio; `ptt` lo envía como nota de voz. / Sends audio; `ptt` sends it as a voice note. */
        static audio(cid: string, buf: Buffer, extra: Extra & { ptt?: boolean } = {}): Promise<Message> {
            return Sender.#send(cid, { audio: buf, ptt: extra.ptt ?? true }, extra, buf);
        }

        /** Envía un documento. / Sends a document. */
        static document(cid: string, buf: Buffer, extra: Extra & { file_name: string; mimetype?: string; caption?: string }): Promise<Message> {
            return Sender.#send(cid, { document: buf, fileName: extra.file_name, mimetype: extra.mimetype ?? 'application/octet-stream', caption: extra.caption }, extra, buf);
        }

        /** Envía una ubicación, con el nombre y la dirección del lugar si se dan. / Sends a location, with the place name and address when given. */
        static location(cid: string, loc: { lat: number; lng: number; name?: string; address?: string }, extra?: Extra): Promise<Message> {
            return Sender.#send(cid, { location: { degreesLatitude: loc.lat, degreesLongitude: loc.lng, name: loc.name, address: loc.address } }, extra);
        }

        /** Envía una encuesta; `multiple` admite varias respuestas. / Sends a poll; `multiple` allows several answers. */
        static poll(cid: string, input: { content: string; options: { content: string }[] }, extra: Extra & { multiple?: boolean } = {}): Promise<Message> {
            return Sender.#send(cid, { poll: { name: input.content, values: input.options.map((option) => option.content), selectableCount: extra.multiple ? 0 : 1 } }, extra);
        }

        /** Envía tarjetas de contacto. / Sends contact cards. */
        static vcard(cid: string, contacts: { name: string; phone: string }[], extra?: Extra): Promise<Message> {
            return Sender.#send(cid, { contacts: { contacts: contacts.map((entry) => ({ displayName: entry.name, vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${entry.name}\nTEL;type=CELL;waid=${entry.phone.replace(/\D+/g, '')}:${entry.phone}\nEND:VCARD` })) } }, extra);
        }

        /** Envía un evento de calendario. / Sends a calendar event. */
        static event(cid: string, data: { name: string; caption?: string; start: Date; end?: Date; place?: { lat: number; lng: number; name?: string; address?: string } }, extra?: Extra): Promise<Message> {
            return Sender.#send(cid, { event: { name: data.name, description: data.caption, startDate: data.start, endDate: data.end, location: data.place && { degreesLatitude: data.place.lat, degreesLongitude: data.place.lng, name: data.place.name, address: data.place.address } } }, extra);
        }

        /** Chat destino y opciones: desde un mensaje, el envío lo cita. / Target chat and options: from a message, the send quotes it. */
        #to<T extends Extra>(extra: T): [string, T] {
            const { cid, mid } = this[route]();
            return [cid, mid ? { ...extra, mid } : extra];
        }

        /** Envía texto a este chat; desde un mensaje, lo cita. / Sends text to this chat; from a message, quotes it. */
        text(caption: string, extra: Extra = {}): Promise<Message> {
            const [cid, options] = this.#to(extra);
            return Sender.text(cid, caption, options);
        }

        /** Envía una imagen o un sticker. / Sends an image or a sticker. */
        image(buf: Buffer, extra: Extra & { caption?: string; sticker?: boolean } = {}): Promise<Message> {
            const [cid, options] = this.#to(extra);
            return Sender.image(cid, buf, options);
        }

        /** Envía un video. / Sends a video. */
        video(buf: Buffer, extra: Extra & { caption?: string; gif?: boolean; ptv?: boolean } = {}): Promise<Message> {
            const [cid, options] = this.#to(extra);
            return Sender.video(cid, buf, options);
        }

        /** Envía audio. / Sends audio. */
        audio(buf: Buffer, extra: Extra & { ptt?: boolean } = {}): Promise<Message> {
            const [cid, options] = this.#to(extra);
            return Sender.audio(cid, buf, options);
        }

        /** Envía un documento. / Sends a document. */
        document(buf: Buffer, extra: Extra & { file_name: string; mimetype?: string; caption?: string }): Promise<Message> {
            const [cid, options] = this.#to(extra);
            return Sender.document(cid, buf, options);
        }

        /** Envía una ubicación. / Sends a location. */
        location(loc: { lat: number; lng: number; name?: string; address?: string }, extra: Extra = {}): Promise<Message> {
            const [cid, options] = this.#to(extra);
            return Sender.location(cid, loc, options);
        }

        /** Envía una encuesta. / Sends a poll. */
        poll(input: { content: string; options: { content: string }[] }, extra: Extra & { multiple?: boolean } = {}): Promise<Message> {
            const [cid, options] = this.#to(extra);
            return Sender.poll(cid, input, options);
        }

        /** Envía tarjetas de contacto. / Sends contact cards. */
        vcard(contacts: { name: string; phone: string }[], extra: Extra = {}): Promise<Message> {
            const [cid, options] = this.#to(extra);
            return Sender.vcard(cid, contacts, options);
        }

        /** Envía un evento. / Sends an event. */
        event(data: { name: string; caption?: string; start: Date; end?: Date; place?: { lat: number; lng: number; name?: string; address?: string } }, extra: Extra = {}): Promise<Message> {
            const [cid, options] = this.#to(extra);
            return Sender.event(cid, data, options);
        }

        /** @param value - Muestra u oculta el «escribiendo…» y pone la cuenta en línea / Shows or hides the «typing…» and puts the account online */
        async typing(value: boolean): Promise<boolean> {
            if (value) await awake();
            await instance.socket.sendPresenceUpdate(value ? 'composing' : 'paused', this[route]().cid);
            return value;
        }

        /** @param value - Muestra u oculta el «grabando audio…» y pone la cuenta en línea / Shows or hides the «recording audio…» and puts the account online */
        async recording(value: boolean): Promise<boolean> {
            if (value) await awake();
            await instance.socket.sendPresenceUpdate(value ? 'recording' : 'paused', this[route]().cid);
            return value;
        }

        /**
         * Metadatos de la integración, ajenos a WhatsApp, bajo la ruta de la entidad: sin argumentos
         * todos; con una clave, su valor o null; con clave y valor, o con un objeto, los escribe, y un
         * valor null borra la clave.
         * Integration metadata, foreign to WhatsApp, under the entity path: with no arguments all of
         * it; with a key, its value or null; with a key and a value, or with an object, it writes them,
         * and a null value deletes the key.
         */
        metadata(): Promise<Record<string, unknown>>;
        metadata(key: string): Promise<unknown>;
        metadata(key: string, value: unknown): Promise<Record<string, unknown>>;
        metadata(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
        metadata(key?: string | Record<string, unknown>, ...value: unknown[]): Promise<unknown> {
            const { type, cid, mid } = this[route]();
            return metadata(type === 'contact' ? `/contact/${cid}` : type === 'feed' ? `/status/${mid}` : mid ? `/chat/${cid}/message/${mid}` : `/chat/${cid}`, key, value);
        }
    }
    if (bases.has(instance) === false) bases.set(instance, Sender);
    return bases.get(instance) as typeof Sender;
}

export type Sender = InstanceType<ReturnType<typeof sender>>;
