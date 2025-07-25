import * as Baileys from 'baileys';

/**
 * @module Store
 * @description
 * Minimal contract that any persistence backend used by **@arcaelas/whatsapp**
 * must implement.
 *
 * - **Strict key–value model** &rarr; **all keys are `string`**.
 * - **Values can only be `string` or `null`**.
 * - **The interface itself does *not* handle serialization**.
 *   Implementations decide whether to apply `JSON.stringify`/`JSON.parse`,
 *   BSON, Base64, etc. — as long as they expose/consume `string | null`.
 *
 * This design works from an in‑memory `Map` up to Redis, SQLite, or even S3,
 * while keeping a uniform, fully‑asynchronous API.
 */
export interface Engine {
    /**
     * Check whether a key exists.
     *
     * @param key Key to test.
     * @returns `true` if present; `false` otherwise.
     *
     * @example
     * const logged = await store.has('session');
     */
    has(key: string): Promise<boolean>;

    /**
     * Retrieve the value associated with a key.
     *
     * @param key      Key to read.
     * @param fallback Default value if the key is missing (`null` if omitted).
     * @returns Stored `string` or `fallback`.
     *
     * @example
     * const raw = await store.get('user:123'); // '{"name":"Miguel"}'
     */
    get(key: string, fallback?: string | null): Promise<string | null>;

    /**
     * Store a **string value**.
     *
     * > Passing `null` or `undefined` deletes the key (same as `delete()`).
     *
     * @param key   Destination key.
     * @param value String to save, or `null` to remove.
     * @returns `true` on success; `false` on failure.
     *
     * @example
     * await store.set('token', 'abc123');
     */
    set(key: string, value: string | null): Promise<boolean>;

    /**
     * Remove a key.
     *
     * @param key Key to unset.
     * @returns `true` if removed; `false` if it did not exist.
     *
     * @example
     * await store.unset('cache:config');
     */
    unset(key: string): Promise<boolean>;

    /**
     * @description
     * Filter keys using a **glob pattern** (`*` as wildcard).
     * - `user:*`        → everything starting with `user:`
     * - `log:*:error`   → simultaneous prefix and suffix
     * @param pattern Glob pattern.
     * @returns Array of matching keys.
     * @example
     * const keys = await store.match('user:*:active');
     */
    match(pattern: string): Promise<string[]>;
}

export default class Store {
    constructor(readonly engine: Engine) {}

    document = {
        set: async (pathname: string, content: any): Promise<boolean> => {
            // prettier-ignore
            return await this.engine.set(
                `document/${pathname}`,
                JSON.stringify(content, Baileys.BufferJSON.replacer)
            );
        },
        get: async <T>(pathname: string): Promise<T | null> => {
            // prettier-ignore
            return JSON.parse(
                await this.engine.get(`document/${pathname}`) ?? 'null',
                Baileys.BufferJSON.reviver
            );
        },
        has: async (pathname: string): Promise<boolean> => {
            return await this.engine.has(`document/${pathname}`);
        },
        unset: async (pathname: string): Promise<boolean> => {
            return await this.engine.unset(`document/${pathname}`);
        },
        keys: () => {
            const _this = this;
            return {
                async *[Symbol.asyncIterator]() {
                    for (const key of await _this.engine.match('document/*')) {
                        const [, _key] = key.match(/document\/(.*)/) ?? [];
                        yield _key;
                    }
                },
            };
        },
        values: () => {
            const _this = this;
            return {
                async *[Symbol.asyncIterator]() {
                    for await (const key of _this.document.keys()) {
                        yield await _this.document.get<any>(key);
                    }
                },
            };
        },
        entries: () => {
            const _this = this;
            return {
                async *[Symbol.asyncIterator]() {
                    for await (const key of _this.document.keys()) {
                        yield [key, await _this.document.get<any>(key)] as const;
                    }
                },
            };
        },
    };

    chat = {
        set: async (chat: Baileys.Chat): Promise<boolean> => {
            // prettier-ignore
            return this.engine.set(
                `chat/${chat.id}/index`,
                JSON.stringify(chat, Baileys.BufferJSON.replacer)
            );
        },
        get: async (id: Baileys.Chat['id']): Promise<Baileys.Chat | null> => {
            // prettier-ignore
            return JSON.parse(
                await this.engine.get(`chat/${id}/index`) ?? 'null',
                Baileys.BufferJSON.reviver
            );
        },
        has: async (id: Baileys.Chat['id']): Promise<boolean> => {
            return await this.engine.has(`chat/${id}/index`);
        },
        unset: async (id: Baileys.Chat['id']): Promise<boolean> => {
            for (const key of await this.engine.match(`chat/${id}/*`)) {
                await this.engine.unset(key);
            }
            return true;
        },
        keys: () => {
            const _this = this;
            return {
                async *[Symbol.asyncIterator]() {
                    for await (const key of await _this.engine.match('chat/*/index')) {
                        const [, id] = key.match(/chat\/([^/]+)\/index/) ?? [];
                        yield id as Baileys.Chat['id'];
                    }
                },
            };
        },
        values: () => {
            const _this = this;
            return {
                async *[Symbol.asyncIterator]() {
                    for await (const id of _this.chat.keys()) {
                        yield (await _this.chat.get(id))!;
                    }
                },
            };
        },
        entries: () => {
            const _this = this;
            return {
                async *[Symbol.asyncIterator]() {
                    for await (const id of _this.chat.keys()) {
                        yield [id as Baileys.Chat['id'], (await _this.chat.get(id))!] as const;
                    }
                },
            };
        },
    };

    message = {
        set: async (message: Baileys.WAProto.IWebMessageInfo): Promise<boolean> => {
            // prettier-ignore
            return await this.engine.set(
                `chat/${message.key.remoteJid}/message/${message.key.id}/index`,
                JSON.stringify(message, Baileys.BufferJSON.replacer)
            );
        },
        get: async (id: string): Promise<Baileys.WAProto.IWebMessageInfo | null> => {
            const [key] = await this.engine.match(`chat/*/${id}/index`);
            // prettier-ignore
            return JSON.parse(
                (await this.engine.get(key))!,
                Baileys.BufferJSON.reviver
            );
        },
        has: async (id: string): Promise<boolean> => {
            const [key] = await this.engine.match(`chat/*/${id}/index`);
            return !!key;
        },
        unset: async (id: string): Promise<boolean> => {
            const [key] = await this.engine.match(`chat/*/${id}/index`);
            return await this.engine.unset(key);
        },
        keys: () => {
            const _this = this;
            return {
                async *[Symbol.asyncIterator]() {
                    const keys = await _this.engine.match('chat/*/message/*/index');
                    for (const key of keys) {
                        const [, , id] = key.match(/chat\/([^/]+)\/message\/([^/]+)\/index/) ?? [];
                        yield id;
                    }
                },
            };
        },
        values: () => {
            const _this = this;
            return {
                async *[Symbol.asyncIterator]() {
                    for await (const key of _this.message.keys()) {
                        yield (await _this.message.get(key))!;
                    }
                },
            };
        },
        entries: () => {
            const _this = this;
            return {
                async *[Symbol.asyncIterator]() {
                    for await (const key of _this.message.keys()) {
                        yield [key, (await _this.message.get(key))!] as const;
                    }
                },
            };
        },
    };
}
