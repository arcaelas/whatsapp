import { Inmutables } from '@arcaelas/utils';
import { jidNormalizedUser } from 'baileys';
import type { Context } from './types';

/**
 * @description
 * Clase base para validacion con instanceof.
 * La implementacion real se genera con contact().
 */
export class Contact {
    readonly id!: string;
    readonly name!: string;
    readonly phone!: string;
    readonly photo!: string | null;
    public custom_name!: string;
}
export type IContact = {
    [K in keyof Contact as Contact[K] extends Exclude<Inmutables | null, object> ? K : never]: Contact[K];
};

/**
 * @description Factory que retorna la clase Contact enlazada al contexto.
 * @param wa Instancia de WhatsApp.
 * @returns Clase _Contact que extiende Contact.
 */
export function contact(wa: Context) {
    return class _Contact extends Contact {
        constructor(data: IContact) {
            super();
            Object.assign(this, data);
        }

        /**
         * @description Obtiene el contacto propio (yo).
         * @returns Contacto propio o null si no hay conexion.
         */
        static async me(): Promise<_Contact | null> {
            if (!wa._socket?.user) return null;
            const jid = jidNormalizedUser(wa._socket.user.id);
            const existing = await _Contact.get(jid);
            if (existing) return existing;
            const data: IContact = {
                id: jid,
                name: wa._socket.user.name ?? jid.split('@')[0],
                phone: jid.split('@')[0],
                photo: null,
                custom_name: wa._socket.user.name ?? jid.split('@')[0],
            };
            await wa._store.contact.set(data);
            return new _Contact(data);
        }

        /**
         * @description Obtiene un contacto por su ID.
         * @param uid JID del contacto (@s.whatsapp.net).
         * @returns Contacto o null si no existe.
         */
        static async get(uid: string): Promise<_Contact | null> {
            const data = await wa._store.contact.get(uid);
            return data ? new _Contact(data) : null;
        }

        /**
         * @description Obtiene contactos paginados.
         * @param offset Inicio de paginacion.
         * @param limit Cantidad maxima de resultados.
         * @returns Array de contactos.
         */
        static async find(offset: number, limit: number): Promise<_Contact[]> {
            const items = await wa._store.contact.find(offset, limit);
            return items.map((data) => new _Contact(data));
        }

        /**
         * @description Obtiene o crea el chat 1-1 con este contacto.
         * El chat se crea localmente y se sincroniza con WhatsApp automaticamente
         * al enviar el primer mensaje.
         * @returns Chat asociado al contacto.
         */
        async chat() {
            const existing = await wa.Chat.get(this.id);
            if (existing) return existing;
            const data = {
                id: this.id,
                name: this.custom_name || this.name,
                photo: this.photo,
                phone: this.phone,
                type: 'contact' as const,
            };
            await wa._store.chat.set(data);
            return new wa.Chat(data);
        }

        /**
         * @description Cambia el nombre personalizado del contacto (local).
         * @param name Nuevo nombre.
         * @returns true si se guardo correctamente.
         */
        async rename(name: string): Promise<boolean> {
            this.custom_name = name;
            return await wa._store.contact.set(this as IContact);
        }
    };
}
