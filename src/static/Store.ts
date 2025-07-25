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
     * @param key Key to delete.
     * @returns `true` if removed; `false` if it did not exist.
     *
     * @example
     * await store.delete('cache:config');
     */
    delete(key: string): Promise<boolean>;

    /**
     * Iterate over all keys.
     *
     * @returns `AsyncGenerator` yielding each key.
     *
     * @example
     * for await (const key of store.keys()) console.log(key);
     */
    keys(): AsyncGenerator<string>;

    /**
     * Iterate over all values (`string | null`).
     *
     * @returns `AsyncGenerator` yielding each value.
     *
     * @example
     * for await (const value of store.values()) console.log(value);
     */
    values(): AsyncGenerator<string | null>;

    /**
     * Iterate over `[key, value]` pairs.
     *
     * @returns `AsyncGenerator<[string, string | null]>`.
     *
     * @example
     * for await (const [k, v] of store.entries()) console.log(k, v);
     */
    entries(): AsyncGenerator<[string, string | null]>;

    /**
     * Remove **all** keys.
     *
     * @returns `true` when the store is empty; `false` if an error occurred.
     *
     * @example
     * await store.clear();
     */
    clear(): Promise<boolean>;

    /**
     * (Optional) Filter keys using a **glob pattern** (`*` as wildcard).
     *
     * - `user:*`        → everything starting with `user:`
     * - `log:*:error`   → simultaneous prefix and suffix
     *
     * @param pattern Glob pattern.
     * @returns Array of matching keys.
     *
     * @example
     * const keys = await store.scan?.('user:*:active');
     */
    scan?(pattern: string): Promise<string[]>;
}

export default class Store {
    constructor(readonly engine: Engine) { }

    document = {
        set: async (filename: string, content: any): Promise<boolean> => {
            // prettier-ignore
            return await this.engine.set(
                `document/${filename}`,
                JSON.stringify(content, Baileys.BufferJSON.replacer)
            );
        },
        get: async <T>(filename: string): Promise<T | null> => {
            // prettier-ignore
            return JSON.parse(
                await this.engine.get(`document/${filename}`) ?? 'null',
                Baileys.BufferJSON.reviver
            );
        },
        has: async (filename: string): Promise<boolean> => {
            return this.engine.has(`document/${filename}`);
        },
        delete: async (filename: string): Promise<boolean> => {
            return this.engine.delete(`document/${filename}`);
        },
        keys: () => {
            const _this = this;
            return {
                async *[Symbol.asyncIterator]() {
                    if (_this.engine.scan) {
                        for (const key of await _this.engine.scan!('document/*')) {
                            yield key.slice('document/'.length);
                        }
                    } else
                        for await (const key of _this.engine.keys()) {
                            if (key.startsWith('document/')) {
                                yield key.slice('document/'.length);
                            }
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
        get: async (id: string): Promise<Baileys.Chat | null> => {
            // prettier-ignore
            return JSON.parse(
                await this.engine.get(`chat/${id}/index`) ?? 'null',
                Baileys.BufferJSON.reviver
            );
        },
        has: async (id: string): Promise<boolean> => {
            return this.engine.has(`chat/${id}/index`)
        },
        delete: async (id: string): Promise<boolean> => {
            if (this.engine.scan)
                for (const key of await this.engine.scan!(`chat/${id}/*`)) {
                    await this.engine.delete(key);
                }
            else
                for await (const key of this.engine.keys()) {
                    if (key.startsWith(`chat/${id}/`))
                        await this.engine.delete(key);
                }
            return true;
        },
        keys: () => {
            const _this = this;
            return {
                async *[Symbol.asyncIterator]() {
                    if (_this.engine.scan) {
                        for (const key of await _this.engine.scan!('chat/*/index')) {
                            const [, id] = key.split('/');
                            yield id;
                        }
                    } else
                        for await (const key of _this.engine.keys()) {
                            if (key.startsWith('chat/')) {
                                const [, id] = key.split('/');
                                yield id;
                            }
                        }
                },
            };
        },
        values: () => {
            const _this = this;
            return {
                // prettier-ignore
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
                // prettier-ignore
                async *[Symbol.asyncIterator]() {
                    for await (const id of _this.chat.keys()) {
                        yield [id as string, (await _this.chat.get(id))!] as const;
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
            // prettier-ignore
            if (this.engine.scan) {
                const [key] = await this.engine.scan!(`chat/*/${id}/index`);
                return JSON.parse(
                    (await this.engine.get(key))!,
                    Baileys.BufferJSON.reviver
                );
            } else {
                for await (const key of this.engine.keys()) {
                    const [chat, mid] = key.match(/chat\/([^/]+)\/message\/([^/]+)\/index/) ?? []
                    if (chat && mid === id) {
                        return JSON.parse(
                            (await this.engine.get(`chat/${chat}/message/${id}/index`))!,
                            Baileys.BufferJSON.reviver
                        );
                    }
                }
            }
            return null;
        },
        has: async (id: string): Promise<boolean> => {
            if (this.engine.scan) {
                const [key] = await this.engine.scan!(`chat/*/message/${id}/index`);
                return !!key
            }
            for await (const key of this.engine.keys()) {
                const [chat, mid] = key.match(/chat\/([^/]+)\/message\/([^/]+)\/index/) ?? []
                if (chat && mid === id) return true;
            }
            return false;
        },
        delete: async (id: string): Promise<boolean> => {
            if (this.engine.scan) {
                for (const key of await this.engine.scan!(`chat/*/message/${id}/*`)) {
                    await this.engine.delete(key);
                }
                return true;
            } else {
                for await (const key of this.engine.keys()) {
                    const [chat, mid] = key.match(/chat\/([^/]+)\/message\/([^/]+)\/index/) ?? [];
                    if (chat && mid === id) await this.engine.delete(key);
                }
                return true;
            }
        },
        keys: () => {
            const _this = this;
            return {
                async *[Symbol.asyncIterator]() {
                    if (_this.engine.scan) {
                        for (const key of await _this.engine.scan!('chat/*/message/*')) {
                            const [, , , m] = key.split('/');
                            yield m;
                        }
                    } else
                        for await (const key of _this.engine.keys()) {
                            if (key.startsWith('chat/')) {
                                const [, , , m] = key.split('/');
                                yield m;
                            }
                        }
                },
            };
        },
        values: () => {
            const _this = this;
            return {
                // prettier-ignore
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
                // prettier-ignore
                async *[Symbol.asyncIterator]() {
                    for await (const key of _this.message.keys()) {
                        yield [key, (await _this.message.get(key))!] as const;
                    }
                },
            };
        },
    };
}
