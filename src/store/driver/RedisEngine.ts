/**
 * @file store/driver/RedisEngine.ts
 * @description Engine de persistencia con Redis
 */

import type { Engine } from '~/store/engine';

/**
 * @description Interface mínima del cliente Redis (compatible con ioredis y redis).
 * Minimal Redis client interface (compatible with ioredis and redis).
 */
export interface RedisClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
    del(key: string | string[]): Promise<unknown>;
    scan(cursor: number | string, ...args: unknown[]): Promise<[string, string[]]>;
}

/**
 * @description
 * Engine de persistencia con Redis.
 * Recibe una conexión existente de ioredis o redis.
 *
 * Redis persistence engine.
 * Receives an existing ioredis or redis connection.
 *
 * @example
 * import Redis from 'ioredis';
 * const client = new Redis();
 * const engine = new RedisEngine(client, 'wa:5491112345678');
 * await engine.set('contact/123', '{"name":"John"}');
 */
export class RedisEngine implements Engine {
    constructor(private readonly _client: RedisClient, private readonly _prefix: string = 'wa:default') { }

    /** @description Obtiene un valor por su key. / Retrieves a value by its key. */
    async get(key: string): Promise<string | null> {
        return this._client.get(`${this._prefix}:${key}`);
    }

    /**
     * @description Guarda o elimina un valor. Si value es null, elimina la key y todas las sub-keys con ese prefijo.
     * Saves or deletes a value. If value is null, deletes the key and all sub-keys matching the prefix.
     */
    async set(key: string, value: string | null): Promise<void> {
        const full_key = `${this._prefix}:${key}`;
        if (value) {
            await this._client.set(full_key, value);
        } else {
            await this._client.del(full_key);
            const pattern = `${full_key}/*`;
            let cursor = '0';
            do {
                const [next, batch] = await this._client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                cursor = next;
                if (batch.length) await this._client.del(batch);
            } while (cursor !== '0');
        }
    }

    /**
     * @description Lista keys bajo un prefijo.
     * Lists keys under a prefix.
     * @note Redis SCAN no garantiza orden. / Redis SCAN does not guarantee order.
     */
    async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
        const pattern = `${this._prefix}:${prefix}*`;
        const keys: string[] = [];
        let cursor = '0';
        do {
            const [next, batch] = await this._client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = next;
            keys.push(...batch);
        } while (cursor !== '0' && keys.length < offset + limit + 100);
        return keys.map((k) => k.slice(this._prefix.length + 1)).slice(offset, offset + limit);
    }
}
