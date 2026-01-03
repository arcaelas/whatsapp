/**
 * @file store/engine.ts
 * @description Interface Engine - contrato para proveedores de persistencia key-value
 */

/**
 * @description
 * Interface que define el contrato para proveedores de persistencia.
 * Almacena texto (JSON stringified con BufferJSON para binarios).
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
     * @param key Ruta del documento (ej: 'creds', 'contact/123@s.whatsapp.net').
     * @returns Texto JSON o null si no existe.
     */
    get(key: string): Promise<string | null>;

    /**
     * @description Guarda o elimina un valor.
     * @param key Ruta del documento.
     * @param value Texto a guardar o null para eliminar.
     */
    set(key: string, value: string | null): Promise<void>;

    /**
     * @description Lista keys bajo un prefijo, ordenados por más reciente.
     * @param prefix Prefijo de búsqueda (ej: 'contact/', 'chat/123/message/').
     * @param offset Inicio de paginación (default: 0).
     * @param limit Cantidad máxima (default: 50).
     * @returns Array de keys.
     */
    list(prefix: string, offset?: number, limit?: number): Promise<string[]>;
}
