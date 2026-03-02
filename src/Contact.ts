/**
 * @file Contact.ts
 * @description Clase Contact para gestión de contactos de WhatsApp
 */

import { BufferJSON, jidNormalizedUser } from 'baileys';
import type { WhatsApp } from '~/WhatsApp';

/**
 * @description Objeto raw del contacto (protocolo).
 * Raw contact object (protocol).
 */
export interface IContactRaw {
    /** JID único del contacto / Unique contact JID */
    id: string;
    /** ID alternativo en formato LID / Alternative ID in LID format */
    lid?: string | null;
    /** Nombre guardado en la agenda del usuario / Name saved in user's address book */
    name?: string | null;
    /** Nombre que el contacto configuró en su perfil (pushName) / Profile push name */
    notify?: string | null;
    /** Nombre de cuenta business verificada / Verified business account name */
    verifiedName?: string | null;
    /** URL de la foto de perfil / Profile picture URL */
    imgUrl?: string | null;
    /** Bio/estado del perfil del contacto / Contact profile bio/status */
    status?: string | null;
}

/**
 * @description Construye IContactRaw normalizado.
 * Builds a normalized IContactRaw.
 */
function build_contact(raw: IContactRaw): IContactRaw {
    return {
        id: raw.id,
        lid: raw.lid ?? null,
        name: raw.name ?? null,
        notify: raw.notify ?? null,
        verifiedName: raw.verifiedName ?? null,
        imgUrl: raw.imgUrl ?? null,
        status: raw.status ?? null,
    };
}

/**
 * @description
 * Clase base para representar un contacto de WhatsApp.
 * Base class representing a WhatsApp contact.
 */
export class Contact {
    constructor(readonly raw: IContactRaw) { }

    /** JID único del contacto / Unique contact JID */
    get id(): string { return this.raw.id; }
    /** Nombre del contacto / Contact name */
    get name(): string { return this.raw.name ?? this.raw.notify ?? this.raw.id.split('@')[0]; }
    /** URL de la foto de perfil o null / Profile picture URL or null */
    get photo(): string | null { return this.raw.imgUrl ?? null; }
    /** Número de teléfono sin formato / Phone number without format */
    get phone(): string { return this.raw.id.split('@')[0]; }
    /** Bio del contacto / Contact bio */
    get content(): string { return this.raw.status ?? ''; }
}

/**
 * @description Factory que retorna la clase Contact enlazada al contexto.
 * Factory that returns the Contact class bound to context.
 * @param wa Instancia de WhatsApp.
 */
export function contact(wa: WhatsApp) {
    return class _Contact extends Contact {
        /**
         * @description Obtiene un contacto por su ID.
         * Retrieves a contact by its ID.
         * @param uid JID del contacto o número de teléfono.
         */
        static async get(uid: string): Promise<_Contact | null> {
            let jid: string;
            if (uid.endsWith('@lid')) {
                const resolved = await wa.engine.get(`lid/${uid}`);
                if (!resolved) return null;
                jid = resolved;
            } else {
                jid = uid.includes('@') ? uid : `${uid}@s.whatsapp.net`;
            }
            const stored = await wa.engine.get(`contact/${jid}/index`);
            if (stored) return new _Contact(JSON.parse(stored, BufferJSON.reviver));
            if (!wa.socket) return null;
            const found = (await wa.socket.onWhatsApp(jid.split('@')[0]))?.[0];
            if (!found?.exists) return null;
            const id = jidNormalizedUser(found.jid);
            const raw: IContactRaw = { id, name: null, notify: null, imgUrl: null, status: null };
            try {
                raw.imgUrl = (await wa.socket.profilePictureUrl(id, 'image')) ?? null;
            } catch { /* profile picture may not exist */ }
            try {
                const result = await wa.socket.fetchStatus(id);
                const status_data = result?.[0] as { status?: { status?: string } } | undefined;
                raw.status = status_data?.status?.status ?? null;
            } catch { /* status fetch may fail */ }
            const data = build_contact(raw);
            await wa.engine.set(`contact/${id}/index`, JSON.stringify(data, BufferJSON.replacer));
            return new _Contact(data);
        }

        /**
         * @description Obtiene contactos paginados.
         * Retrieves paginated contacts.
         * @param offset Inicio de paginación.
         * @param limit Cantidad máxima de resultados.
         */
        static async list(offset = 0, limit = 50): Promise<_Contact[]> {
            const contacts: _Contact[] = [];
            for (const key of await wa.engine.list('contact/', offset, limit)) {
                const stored = await wa.engine.get(key);
                if (stored) contacts.push(new _Contact(JSON.parse(stored, BufferJSON.reviver)));
            }
            return contacts;
        }

        /**
         * @description Cambia el nombre del contacto.
         * Renames the contact.
         * @param name Nuevo nombre.
         */
        async rename(name: string): Promise<boolean> {
            const stored = await wa.engine.get(`contact/${this.id}/index`);
            if (stored) {
                this.raw.name = name;
                await wa.engine.set(`contact/${this.id}/index`, JSON.stringify(this.raw, BufferJSON.replacer));
                return true;
            }
            return false
        }

        /**
         * @description Actualiza los datos del perfil desde WhatsApp.
         * Refreshes profile data from WhatsApp.
         */
        async refresh(): Promise<this | null> {
            if (!wa.socket) return null;
            try {
                this.raw.imgUrl = (await wa.socket.profilePictureUrl(this.id, 'image')) ?? null;
            } catch { /* profile picture may not exist */ }
            try {
                const result = await wa.socket.fetchStatus(this.id);
                const status_data = result?.[0] as { status?: { status?: string } } | undefined;
                this.raw.status = status_data?.status?.status ?? null;
            } catch { /* status fetch may fail */ }
            await wa.engine.set(`contact/${this.id}/index`, JSON.stringify(this.raw, BufferJSON.replacer));
            return this;
        }

        /**
         * @description Obtiene o crea el chat con este contacto.
         * Gets or creates the chat with this contact.
         */
        async chat() {
            return wa.Chat.get(this.id);
        }
    };
}
