import type { IChat } from '../Chat';
import type { IContact } from '../Contact';
import type { IMessage } from '../Message';

/**
 * @description
 * Clase abstracta que define el contrato para proveedores de persistencia.
 * Cada driver (Memory, FileStore, S3, PostgreSQL, Firebase) extiende esta clase
 * e implementa la lógica específica de almacenamiento.
 *
 * @example
 * class MemoryEngine extends Engine {
 *   private _contacts = new Map<string, IContact>();
 *
 *   async contact(id: string): Promise<IContact | null>;
 *   async contact(id: string, data: IContact | null): Promise<boolean>;
 *   async contact(id: string, data?: IContact | null): Promise<IContact | null | boolean> {
 *     if (arguments.length === 1) return this._contacts.get(id) ?? null;
 *     if (data === null) return this._contacts.delete(id), true;
 *     return this._contacts.set(id, data), true;
 *   }
 * }
 */
export abstract class Engine {
    // ─────────────────────────────────────────────────────────────────────────
    // Session
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @description Obtiene un documento de sesión.
     * @param key Clave del documento (ej: 'creds', 'signal/preKey/1').
     * @returns Documento o null si no existe.
     */
    abstract session<T = unknown>(key: string): Promise<T | null>;

    /**
     * @description Guarda o elimina un documento de sesión.
     * @param key Clave del documento.
     * @param data Datos a guardar o null para eliminar.
     * @returns true si la operación fue exitosa.
     */
    abstract session<T = unknown>(key: string, data: T | null): Promise<boolean>;

    // ─────────────────────────────────────────────────────────────────────────
    // Contact
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @description Obtiene un contacto por ID.
     * @param id JID del contacto (ej: '5491112345678@s.whatsapp.net').
     * @returns Contacto o null si no existe.
     */
    abstract contact(id: string): Promise<IContact | null>;

    /**
     * @description Guarda o elimina un contacto.
     * @param id JID del contacto.
     * @param data Contacto a guardar o null para eliminar.
     * @returns true si la operación fue exitosa.
     */
    abstract contact(id: string, data: IContact | null): Promise<boolean>;

    /**
     * @description Obtiene contactos paginados, ordenados por más reciente.
     * @param offset Inicio de paginación (default: 0).
     * @param limit Cantidad máxima (default: 50).
     * @returns Array de contactos.
     */
    abstract contacts(offset?: number, limit?: number): Promise<IContact[]>;

    // ─────────────────────────────────────────────────────────────────────────
    // Chat
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @description Obtiene un chat por ID.
     * @param id JID del chat (ej: '5491112345678@s.whatsapp.net' o 'group@g.us').
     * @returns Chat o null si no existe.
     */
    abstract chat(id: string): Promise<IChat | null>;

    /**
     * @description Guarda o elimina un chat.
     * @param id JID del chat.
     * @param data Chat a guardar o null para eliminar.
     * @returns true si la operación fue exitosa.
     */
    abstract chat(id: string, data: IChat | null): Promise<boolean>;

    /**
     * @description Obtiene chats paginados, ordenados por más reciente.
     * @param offset Inicio de paginación (default: 0).
     * @param limit Cantidad máxima (default: 50).
     * @returns Array de chats.
     */
    abstract chats(offset?: number, limit?: number): Promise<IChat[]>;

    // ─────────────────────────────────────────────────────────────────────────
    // Message
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @description Obtiene un mensaje por chat ID y message ID.
     * @param cid JID del chat.
     * @param mid ID del mensaje.
     * @returns Mensaje o null si no existe.
     */
    abstract message(cid: string, mid: string): Promise<IMessage | null>;

    /**
     * @description Guarda o elimina un mensaje.
     * @param cid JID del chat.
     * @param mid ID del mensaje.
     * @param data Mensaje a guardar o null para eliminar.
     * @returns true si la operación fue exitosa.
     */
    abstract message(cid: string, mid: string, data: IMessage | null): Promise<boolean>;

    /**
     * @description Obtiene mensajes de un chat, ordenados por más reciente.
     * @param cid JID del chat.
     * @param offset Inicio de paginación (default: 0).
     * @param limit Cantidad máxima (default: 20).
     * @returns Array de mensajes.
     */
    abstract messages(cid: string, offset?: number, limit?: number): Promise<IMessage[]>;

    // ─────────────────────────────────────────────────────────────────────────
    // Content
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @description Obtiene el contenido binario de un mensaje.
     * @param cid JID del chat.
     * @param mid ID del mensaje.
     * @returns Buffer con el contenido o null si no existe.
     */
    abstract content(cid: string, mid: string): Promise<Buffer | null>;

    /**
     * @description Guarda o elimina el contenido de un mensaje.
     * @param cid JID del chat.
     * @param mid ID del mensaje.
     * @param data Buffer a guardar o null para eliminar.
     * @returns true si la operación fue exitosa.
     */
    abstract content(cid: string, mid: string, data: Buffer | null): Promise<boolean>;
}
