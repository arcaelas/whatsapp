/**
 * @file store/driver/RedisEngine.ts
 * @description Engine de persistencia con Redis
 */

import type { Engine } from '~/store/engine';

/**
 * @description Interface mínima del cliente Redis (compatible con ioredis y redis).
 */
export interface RedisClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
    del(key: string): Promise<unknown>;
    scan(cursor: number | string, ...args: unknown[]): Promise<[string, string[]]>;
}

/**
 * @description
 * Engine de persistencia con Redis.
 * Recibe una conexión existente de ioredis o redis.
 *
 * @example
 * import Redis from 'ioredis';
 * const client = new Redis();
 * const engine = new RedisEngine(client, 'wa:5491112345678');
 * await engine.set('contact/123', '{"name":"John"}');
 */
export class RedisEngine implements Engine {
    constructor(private readonly _client: RedisClient, private readonly _prefix: string = 'wa:default') {}

    async get(key: string): Promise<string | null> {
        return this._client.get(`${this._prefix}:${key}`);
    }

    async set(key: string, value: string | null): Promise<void> {
        if (value) {
            await this._client.set(`${this._prefix}:${key}`, value);
        } else {
            await this._client.del(`${this._prefix}:${key}`);
        }
    }

    /**
     * @description Lista keys bajo un prefijo.
     * @note Redis SCAN no garantiza orden. Los resultados no están ordenados por timestamp.
     */
    async list(prefix: string, offset = 0, limit = 50, suffix?: string): Promise<string[]> {
        // Si hay suffix, usamos pattern más específico
        const pattern = suffix ? `${this._prefix}:${prefix}*${suffix}` : `${this._prefix}:${prefix}*`;
        const keys: string[] = [];
        let cursor = '0';

        do {
            const [next, batch] = await this._client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = next;
            keys.push(...batch);
        } while (cursor !== '0' && keys.length < offset + limit + 100);

        return keys.map((k) => k.slice(this._prefix.length + 1)).slice(offset, offset + limit);
    }

    async delete_prefix(prefix: string): Promise<number> {
        const pattern = `${this._prefix}:${prefix}*`;
        const keys: string[] = [];
        let cursor = '0';

        do {
            const [next, batch] = await this._client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = next;
            keys.push(...batch);
        } while (cursor !== '0');

        if (!keys.length) return 0;

        for (const key of keys) {
            await this._client.del(key);
        }
        return keys.length;
    }
}
