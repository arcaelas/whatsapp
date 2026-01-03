/**
 * @file Contact.ts
 * @description Clase Contact para gestión de contactos de WhatsApp
 */

import { BufferJSON, jidNormalizedUser } from 'baileys';
import type { WhatsApp } from './WhatsApp';

/**
 * @description Datos persistidos de un contacto.
 */
export interface IContact {
    /** JID del contacto (ej: 123456@s.whatsapp.net) */
    id: string;
    /** true si es el usuario autenticado */
    me: boolean;
    /** Nombre del contacto */
    name: string;
    /** Número de teléfono sin formato */
    phone: string | null;
    /** URL de la foto de perfil o null */
    photo: string | null;
}

/**
 * @description
 * Clase base para representar un contacto de WhatsApp.
 * Usar Contact.get() para obtener instancias.
 */
export class Contact {
    readonly id: string;
    readonly me: boolean;
    name: string;
    phone: string | null;
    photo: string | null;

    constructor(data: IContact) {
        this.id = data.id;
        this.me = data.me;
        this.name = data.name;
        this.phone = data.phone;
        this.photo = data.photo;
    }

    /**
     * @description Cambia el nombre del contacto.
     * @param name Nuevo nombre.
     * @returns true si se guardó correctamente.
     */
    rename(name: string): Promise<boolean> {
        return Promise.resolve(false);
    }

    /**
     * @description Obtiene o crea el chat con este contacto.
     * @returns Chat asociado al contacto.
     */
    chat(): Promise<unknown> {
        return Promise.resolve(null);
    }
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
            const data: IContact = {
                id,
                me: id === (wa.socket.user?.id ? jidNormalizedUser(wa.socket.user.id) : null),
                name: jid.split('@')[0],
                phone: jid.split('@')[0],
                photo: null,
            };
            await wa.engine.set(`contact/${id}/index`, JSON.stringify(data, BufferJSON.replacer));
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
        static async paginate(offset: number, limit: number): Promise<_Contact[]> {
            const contacts: _Contact[] = [];
            for (const key of await wa.engine.list('contact/', offset, limit)) {
                if (!key.endsWith('/index')) continue;
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
            if (result) this.name = name;
            return result;
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
