import type { WhatsApp } from './WhatsApp';

/**
 * @description
 * Contexto compartido entre todas las clases generadas.
 * Pasado a las factories contact(), chat(), message().
 * Es la instancia de WhatsApp directamente.
 */
export type Context = WhatsApp;

/**
 * @description
 * Contrato minimo para cualquier proveedor de persistencia.
 *
 * La estructura de claves sigue el patron `{namespace}/{id}/{...}`:
 * - `contact/123` → documento especifico
 * - `contact` → todos los documentos del namespace
 * - `chat/123/message` → mensajes de un chat especifico
 *
 * **Orden**: Los resultados deben ordenarse con indice 0 = mas reciente.
 * Por ejemplo, `get('chat/123/message', 0, 10)` debe retornar los 10 mensajes mas recientes.
 *
 * @example
 * class RedisEngine implements Engine {
 *   async get(key: string, offset = 0, limit = 50) {
 *     const keys = await this.redis.zrevrange(`idx:${key}`, offset, offset + limit - 1)
 *     return keys.length ? await this.redis.mget(...keys) : []
 *   }
 * }
 */
export interface Engine {
    /**
     * @description
     * Obtiene documentos por clave o namespace.
     *
     * @param key Clave especifica o namespace.
     * @param offset Inicio de paginacion (default: 0).
     * @param limit Cantidad maxima de resultados (default: 50).
     * @returns Array de strings (JSON). Vacio si no hay resultados.
     *
     * @example
     * await engine.get('contact/123')        // ['{"id":"123",...}']
     * await engine.get('contact', 0, 50)     // ['{"id":"1",...}', '{"id":"2",...}', ...]
     * await engine.get('chat/abc/message', 0, 20)  // mensajes del chat
     */
    get(key: string, offset?: number, limit?: number): Promise<string[]>;

    /**
     * @description Almacena un string. Pasar `null` elimina la clave.
     * @param key Clave destino (siempre especifica, ej: `contact/123`).
     * @param value String a guardar o `null` para eliminar.
     * @returns `true` si la operacion fue exitosa.
     */
    set(key: string, value: string | null): Promise<boolean>;
}
