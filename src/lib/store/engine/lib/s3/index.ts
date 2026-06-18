/**
 * @file store/engine/lib/s3/index.ts
 * @description Driver de persistencia con AWS S3 (caché local opcional).
 * AWS S3 persistence driver (optional local cache).
 */

import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Engine } from '~/lib/store/engine';

/**
 * Normaliza un path colapsando slashes redundantes.
 * Normalizes a path by collapsing redundant slashes.
 */
function normalize_path(path: string): string {
    return path.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

/**
 * Configuración de la caché local. Cada entrada se limpia con un `setTimeout`
 * (no hay campo de expiración en la lectura). `when` decide qué keys se cachean;
 * el resto va directo a S3.
 * Local cache configuration. Each entry is cleared with a `setTimeout` (no
 * expiration field on read). `when` decides which keys get cached; everything
 * else goes straight to S3.
 */
interface CacheOptions {
    /** Tiempo de vida de cada entrada en ms. / Time-to-live of each entry in ms. */
    ttl: number;
    /** Predicado que decide si un path se cachea. / Predicate deciding whether a path is cached. */
    when(key: string): boolean;
}

interface S3EngineOptions {
    /** Cliente S3 ya configurado. / Pre-configured S3 client. */
    s3: S3Client;
    /** Nombre del bucket. / Bucket name. */
    bucket: string;
    /** Prefijo base de las keys dentro del bucket. / Base key prefix inside the bucket. */
    basedir: string;
    /**
     * Caché local: `false` la desactiva; un objeto `{ ttl, when }` la configura.
     * Default: `false` (sin caché).
     * Local cache: `false` disables it; an object `{ ttl, when }` configures it.
     * Default: `false` (no cache).
     */
    cache?: false | CacheOptions;
}

export class S3Engine implements Engine {
    private readonly _client: S3Client;
    private readonly _bucket: string;
    private readonly _prefix: string;
    private readonly _cache_opts: CacheOptions | false;
    /** @internal Caché local de documentos, con su timer de expiración. / Local cache of documents, with its expiration timer. */
    private readonly _cache = new Map<string, { value: string | null; timer: ReturnType<typeof setTimeout> }>();

    constructor(options: S3EngineOptions) {
        this._client = options.s3;
        this._bucket = options.bucket;
        this._prefix = options.basedir.endsWith('/') ? options.basedir : `${options.basedir}/`;
        this._cache_opts = options.cache ?? false;
    }

    private _key(key: string): string {
        return `${this._prefix}${normalize_path(key).replace(/@/g, '_at_')}`;
    }

    /**
     * Indica si un path es elegible para caché según la configuración `when`.
     * Reports whether a path is eligible for caching per the `when` config.
     */
    private _cacheable(path: string): boolean {
        return this._cache_opts !== false && this._cache_opts.when(path);
    }

    /**
     * Guarda un valor en la caché local y programa su limpieza con un `setTimeout`.
     * Reemplaza el timer previo si la key ya estaba cacheada para no acumular timers.
     * Stores a value in the local cache and schedules its cleanup with a `setTimeout`.
     * Replaces the previous timer when the key was already cached so timers don't pile up.
     */
    private _cache_set(path: string, value: string | null): void {
        if (this._cache_opts === false) {
            return;
        }
        clearTimeout(this._cache.get(path)?.timer);
        this._cache.set(path, {
            value,
            timer: setTimeout(() => this._cache.delete(path), this._cache_opts.ttl),
        });
    }

    async get(key: string): Promise<string | null> {
        if (this._cacheable(key) && this._cache.has(key)) {
            return this._cache.get(key)!.value;
        }
        const value = await (async (): Promise<string | null> => {
            try {
                const res = await this._client.send(new GetObjectCommand({ Bucket: this._bucket, Key: this._key(key) }));
                return (await res.Body?.transformToString('utf-8')) ?? null;
            } catch {
                return null;
            }
        })();
        if (this._cacheable(key)) {
            this._cache_set(key, value);
        }
        return value;
    }

    async set(key: string, value: string): Promise<void> {
        const remote = this._client.send(new PutObjectCommand({ Bucket: this._bucket, Key: this._key(key), Body: value, ContentType: 'application/json' }));
        if (this._cacheable(key)) {
            this._cache_set(key, value);
        }
        await remote;
    }

    async list(path: string, offset = 0, limit = 50): Promise<string[]> {
        const parent = `${this._prefix}${normalize_path(path).replace(/@/g, '_at_')}/`;
        const children = new Map<string, number>();
        let token: string | undefined;

        do {
            const res = await this._client.send(
                new ListObjectsV2Command({
                    Bucket: this._bucket,
                    Prefix: parent,
                    ContinuationToken: token,
                    MaxKeys: 1000,
                })
            );
            for (const obj of res.Contents ?? []) {
                if (!obj.Key) continue;
                const rest = obj.Key.slice(parent.length);
                const child_key = `${parent}${rest.split('/')[0]}`;
                const mtime = obj.LastModified?.getTime() ?? 0;
                children.set(child_key, Math.max(children.get(child_key) ?? 0, mtime));
            }
            token = res.NextContinuationToken;
        } while (token);

        const ordered = [...children.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(offset, offset + limit)
            .map(([key]) => key);

        const values = await Promise.all(
            ordered.map(async (key) => {
                try {
                    const res = await this._client.send(new GetObjectCommand({ Bucket: this._bucket, Key: key }));
                    return (await res.Body?.transformToString('utf-8')) ?? null;
                } catch {
                    return null;
                }
            })
        );
        return values.filter((value): value is string => value !== null);
    }

    async delete_prefix(prefix: string): Promise<number> {
        const full_prefix = `${this._prefix}${normalize_path(prefix).replace(/@/g, '_at_')}`;
        let deleted = 0;
        let token: string | undefined;

        do {
            const res = await this._client.send(
                new ListObjectsV2Command({
                    Bucket: this._bucket,
                    Prefix: full_prefix,
                    ContinuationToken: token,
                    MaxKeys: 1000,
                })
            );
            const keys = (res.Contents ?? []).filter((o) => o.Key).map((o) => ({ Key: o.Key! }));
            if (keys.length) {
                await this._client.send(new DeleteObjectsCommand({ Bucket: this._bucket, Delete: { Objects: keys } }));
                deleted += keys.length;
            }
            token = res.NextContinuationToken;
        } while (token);

        return deleted;
    }

    async unset(path: string): Promise<boolean> {
        if (this._cacheable(path)) {
            for (const key of this._cache.keys()) {
                if (key === path || key.startsWith(`${path}/`)) {
                    clearTimeout(this._cache.get(key)!.timer);
                    this._cache.delete(key);
                }
            }
        }
        return (await this.delete_prefix(path)) > 0;
    }

    async count(path: string): Promise<number> {
        const full_prefix = `${this._prefix}${normalize_path(path).replace(/@/g, '_at_')}`;
        let total = 0;
        let token: string | undefined;
        do {
            const res = await this._client.send(
                new ListObjectsV2Command({
                    Bucket: this._bucket,
                    Prefix: full_prefix,
                    ContinuationToken: token,
                    MaxKeys: 1000,
                })
            );
            total += res.Contents?.length ?? 0;
            token = res.NextContinuationToken;
        } while (token);
        return total;
    }

    async clear(): Promise<void> {
        for (const { timer } of this._cache.values()) {
            clearTimeout(timer);
        }
        this._cache.clear();
        await this.delete_prefix('');
    }
}
