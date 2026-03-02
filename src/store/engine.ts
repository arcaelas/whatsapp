/**
 * @file store/engine.ts
 * @description Interface Engine - contrato para proveedores de persistencia key-value
 */

/**
 * @description
 * Interface que define el contrato para proveedores de persistencia.
 * Almacena texto (JSON stringified con BufferJSON para binarios).
 *
 * Interface that defines the contract for persistence providers.
 * Stores plain text (JSON stringified with BufferJSON for binaries).
 *
 * @example
 * class CustomEngine implements Engine {
 *   async get(key: string): Promise<string | null> {
 *     return localStorage.getItem(key);
 *   }
 *
 *   async set(key: string, value: string | null): Promise<void> {
 *     if (value === null) localStorage.removeItem(key);
 *     else localStorage.setItem(key, value);
 *   }
 *
 *   async list(prefix: string, offset?: number, limit?: number): Promise<string[]> {
 *     return Object.keys(localStorage).filter(k => k.startsWith(prefix));
 *   }
 * }
 */
export interface Engine {
    /**
     * @description Obtiene un valor por su key.
     * Retrieves a value by its key.
     * @param key Ruta del documento (ej: 'creds', 'contact/123@s.whatsapp.net').
     * @returns Texto JSON o null si no existe.
     */
    get(key: string): Promise<string | null>;

    /**
     * @description Guarda o elimina un valor. Si value es null, elimina la key y todas las sub-keys recursivamente.
     * Saves or deletes a value. If value is null, deletes the key and all sub-keys recursively.
     * @param key Ruta del documento.
     * @param value Texto a guardar o null para eliminar recursivamente.
     */
    set(key: string, value: string | null): Promise<void>;

    /**
     * @description Lista keys bajo un prefijo, ordenados por más reciente.
     * Lists keys under a prefix, ordered by most recent.
     * @param prefix Prefijo de búsqueda (ej: 'contact/', 'chat/123/message/').
     * @param offset Inicio de paginación (default: 0).
     * @param limit Cantidad máxima (default: 50).
     * @returns Array de keys.
     */
    list(prefix: string, offset?: number, limit?: number): Promise<string[]>;
}
