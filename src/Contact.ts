/**
 * @file Contact.ts
 * @description Clase Contact para gestión de contactos de WhatsApp
 */

import { BufferJSON, jidNormalizedUser } from 'baileys';
import type { WhatsApp } from '~/WhatsApp';

/**
 * @description Objeto raw del contacto (protocolo).
 */
export interface IContactRaw {
    /** JID único del contacto */
    id: string;
    /** ID alternativo en formato LID */
    lid?: string | null;
    /** Nombre guardado en la agenda del usuario */
    name?: string | null;
    /** Nombre que el contacto configuró en su perfil (pushName) */
    notify?: string | null;
    /** Nombre de cuenta business verificada */
    verifiedName?: string | null;
    /** URL de la foto de perfil */
    imgUrl?: string | null;
    /** Bio/estado del perfil del contacto */
    status?: string | null;
}

/**
 * @description Datos persistidos de un contacto.
 */
export interface IContact {
    /** JID del contacto (ej: 123456@s.whatsapp.net) */
    id: string;
    /** Nombre del contacto */
    name: string;
    /** URL de la foto de perfil o null */
    photo: string | null;
    /** Número de teléfono sin formato */
    phone: string;
    /** Bio del contacto */
    content: string;
    /** Objeto raw del protocolo */
    raw: IContactRaw;
}

/**
 * @description
 * Clase base para representar un contacto de WhatsApp.
 * Usar Contact.get() para obtener instancias.
 */
export class Contact {
    readonly raw: IContactRaw;

    constructor(data: IContact) {
        this.raw = data.raw;
    }

    /** JID único del contacto */
    get id(): string {
        return this.raw.id;
    }

    /** Nombre del contacto */
    get name(): string {
        return this.raw.name ?? this.raw.notify ?? this.raw.id.split('@')[0];
    }

    /** URL de la foto de perfil o null */
    get photo(): string | null {
        return this.raw.imgUrl ?? null;
    }

    /** Número de teléfono sin formato */
    get phone(): string {
        return this.raw.id.split('@')[0];
    }

    /** Bio del contacto */
    get content(): string {
        return this.raw.status ?? '';
    }
}

/**
 * @description Construye IContact desde raw.
 * @param raw Objeto raw del contacto.
 * @returns IContact normalizado.
 */
export function build_contact(raw: IContactRaw): IContact {
    return {
        id: raw.id,
        name: raw.name ?? raw.notify ?? raw.id.split('@')[0],
        photo: raw.imgUrl ?? null,
        phone: raw.id.split('@')[0],
        content: raw.status ?? '',
        raw,
    };
}

/**
 * @description Factory que retorna la clase Contact enlazada al contexto.
 * @param wa Instancia de WhatsApp.
 * @returns Clase _Contact que extiende Contact.
 */
export function contact(wa: WhatsApp) {
    return class _Contact extends Contact {
        /**
         * @description Obtiene un contacto por su ID.
         * @param uid JID del contacto (@s.whatsapp.net) o número de teléfono.
         * @returns Contacto o null si no existe.
         */
        static async get(uid: string): Promise<_Contact | null> {
            const jid = uid.includes('@') ? uid : `${uid}@s.whatsapp.net`;
            const stored = await wa.engine.get(`contact/${jid}/index`);
            if (stored) return new _Contact(JSON.parse(stored, BufferJSON.reviver));
            if (!wa.socket) return null;

            const found = (await wa.socket.onWhatsApp(jid.split('@')[0]))?.[0];
            if (!found?.exists) return null;

            const id = jidNormalizedUser(found.jid);
            const raw: IContactRaw = { id, name: null, notify: null, imgUrl: null, status: null };

            // Obtener foto de perfil
            try {
                raw.imgUrl = (await wa.socket.profilePictureUrl(id, 'image')) ?? null;
            } catch { /* profile picture may not exist */ }

            // Obtener estado/bio
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
         * @description Actualiza los datos del perfil desde WhatsApp.
         * @param uid JID del contacto.
         * @returns Contacto actualizado o null.
         */
        static async refresh(uid: string): Promise<_Contact | null> {
            const jid = uid.includes('@') ? uid : `${uid}@s.whatsapp.net`;
            if (!wa.socket) return null;

            const stored = await wa.engine.get(`contact/${jid}/index`);
            const data: IContact = stored ? JSON.parse(stored, BufferJSON.reviver) : build_contact({ id: jid });

            // Obtener foto de perfil
            try {
                data.raw.imgUrl = (await wa.socket.profilePictureUrl(jid, 'image')) ?? null;
                data.photo = data.raw.imgUrl;
            } catch { /* profile picture may not exist */ }

            // Obtener estado/bio
            try {
                const result = await wa.socket.fetchStatus(jid);
                const status_data = result?.[0] as { status?: { status?: string } } | undefined;
                data.raw.status = status_data?.status?.status ?? null;
                data.content = data.raw.status ?? '';
            } catch { /* status fetch may fail */ }

            await wa.engine.set(`contact/${jid}/index`, JSON.stringify(data, BufferJSON.replacer));
            return new _Contact(data);
        }

        /**
         * @description Cambia el nombre de un contacto.
         * @param uid JID del contacto.
         * @param name Nuevo nombre.
         * @returns true si se guardó correctamente.
         */
        static async rename(uid: string, name: string): Promise<boolean> {
            const jid = uid.includes('@') ? uid : `${uid}@s.whatsapp.net`;
            const stored = await wa.engine.get(`contact/${jid}/index`);
            if (!stored) return false;
            const data: IContact = JSON.parse(stored, BufferJSON.reviver);
            data.raw.name = name;
            data.name = name;
            await wa.engine.set(`contact/${jid}/index`, JSON.stringify(data, BufferJSON.replacer));
            return true;
        }

        /**
         * @description Obtiene contactos paginados.
         * @param offset Inicio de paginación.
         * @param limit Cantidad máxima de resultados.
         * @returns Array de contactos.
         */
        static async paginate(offset = 0, limit = 50): Promise<_Contact[]> {
            const contacts: _Contact[] = [];
            for (const key of await wa.engine.list('contact/', offset, limit, '/index')) {
                const stored = await wa.engine.get(key);
                if (stored) contacts.push(new _Contact(JSON.parse(stored, BufferJSON.reviver)));
            }
            return contacts;
        }

        /**
         * @description Cambia el nombre del contacto.
         * @param name Nuevo nombre.
         * @returns true si se guardó correctamente.
         */
        async rename(name: string): Promise<boolean> {
            const result = await _Contact.rename(this.id, name);
            if (result) this.raw.name = name;
            return result;
        }

        /**
         * @description Actualiza los datos del perfil desde WhatsApp.
         * @returns this con datos actualizados, o null si falla.
         */
        async refresh(): Promise<this | null> {
            const updated = await _Contact.refresh(this.id);
            if (!updated) return null;
            // Actualizar raw con los nuevos datos
            Object.assign(this.raw, updated.raw);
            return this;
        }

        /**
         * @description Obtiene o crea el chat con este contacto.
         * @returns Chat asociado al contacto.
         */
        async chat() {
            return wa.Chat.get(this.id);
        }
    };
}
