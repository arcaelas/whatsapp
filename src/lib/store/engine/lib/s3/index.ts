/**
 * @file store/engine/lib/s3/index.ts
 * @description Driver de persistencia con AWS S3 (caché local opcional).
 * AWS S3 persistence driver (optional local cache).
 */

import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Engine } from '~/lib/store/engine';
import { IndexCache, normalize_path, SortedIndex, split_path } from '~/lib/store/engine/lib';

/** Objeto que guarda el orden de los hijos de un prefijo. / Object holding the ordering of a prefix children. */
const ORDER_KEY = '.order';

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
    /** Prefijos indexados simultáneamente en memoria. / Simultaneously in-memory indexed prefixes. */
    cached?: number;
}

/**
 * Driver de persistencia con AWS S3.
 *
 * Para que `list`/`count` no recorran todo el prefijo en cada página mantiene un índice
 * ordenado por prefijo (`SortedIndex`), acotado por LRU y respaldado en el objeto `.order`:
 * ahí viven los scores explícitos que S3 no puede representar (`LastModified` es de sólo
 * lectura), de modo que el orden cronológico sobrevive a los re-syncs igual que en los
 * demás drivers. Si el objeto `.order` falta, el índice se reconstruye listando el prefijo
 * una única vez y ordenando por `LastModified`.
 *
 * AWS S3 persistence driver. To keep `list`/`count` from walking the whole prefix on every
 * page it maintains a per-prefix sorted index (`SortedIndex`), LRU-bounded and backed by the
 * `.order` object: it holds the explicit scores S3 cannot represent (`LastModified` is
 * read-only), so chronological order survives re-syncs just like on the other drivers. When
 * `.order` is missing the index is rebuilt listing the prefix once and ordering by
 * `LastModified`.
 */
export class S3Engine implements Engine {
    private readonly _client: S3Client;
    private readonly _bucket: string;
    private readonly _prefix: string;
    private readonly _cache_opts: CacheOptions | false;
    /** @internal Caché local de documentos, con su timer de expiración. / Local cache of documents, with its expiration timer. */
    private readonly _cache = new Map<string, { value: string | null; timer: ReturnType<typeof setTimeout> }>();
    /** @internal Índices por prefijo, acotados por LRU. / Per-prefix indexes, LRU-bounded. */
    private readonly _indexes: IndexCache;

    constructor(options: S3EngineOptions) {
        this._client = options.s3;
        this._bucket = options.bucket;
        this._prefix = options.basedir.endsWith('/') ? options.basedir : `${options.basedir}/`;
        this._cache_opts = options.cache ?? false;
        this._indexes = new IndexCache(options.cached ?? 12);
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

    /**
     * @internal
     * Índice del prefijo: de la caché, del objeto `.order` o reconstruido listando el prefijo
     * una sola vez y ordenando por `LastModified`.
     * Prefix index: from the cache, from the `.order` object or rebuilt listing the prefix
     * once and ordering by `LastModified`.
     */
    private async _index(path: string): Promise<SortedIndex> {
        const key = normalize_path(path);
        const cached = this._indexes.get(key);
        if (cached) {
            return cached;
        }
        const parent = `${this._key(key)}/`;
        const index = new SortedIndex(async (entries) => {
            await this._client
                .send(
                    new PutObjectCommand({
                        Bucket: this._bucket,
                        Key: `${parent}${ORDER_KEY}`,
                        Body: entries.map(([name, score]) => `${score}\t${name}`).join('\n'),
                        ContentType: 'text/plain',
                    })
                )
                .catch(() => null);
        });
        const persisted = await this._client
            .send(new GetObjectCommand({ Bucket: this._bucket, Key: `${parent}${ORDER_KEY}` }))
            .then((res) => res.Body?.transformToString('utf-8') ?? null)
            .catch(() => null);
        if (persisted) {
            index.load(
                persisted
                    .split('\n')
                    .filter(Boolean)
                    .map((line) => {
                        const cut = line.indexOf('\t');
                        return [line.slice(cut + 1), Number(line.slice(0, cut))] as [string, number];
                    })
            );
        } else {
            const children = new Map<string, number>();
            let token: string | undefined;
            do {
                const res = await this._client.send(
                    new ListObjectsV2Command({ Bucket: this._bucket, Prefix: parent, ContinuationToken: token, MaxKeys: 1000 })
                );
                for (const object of res.Contents ?? []) {
                    const rest = object.Key?.slice(parent.length);
                    const name = rest?.split('/')[0];
                    if (name && name !== ORDER_KEY) {
                        children.set(name, Math.max(children.get(name) ?? 0, object.LastModified?.getTime() ?? 0));
                    }
                }
                token = res.NextContinuationToken;
            } while (token);
            index.load(children);
        }
        this._indexes.set(key, index);
        return index;
    }

    async get(key: string): Promise<string | null> {
        if (this._cacheable(key) && this._cache.has(key)) {
            return this._cache.get(key)!.value;
        }
        const value = await this._client
            .send(new GetObjectCommand({ Bucket: this._bucket, Key: this._key(key) }))
            .then((res) => res.Body?.transformToString('utf-8') ?? null)
            .catch(() => null);
        if (this._cacheable(key)) {
            this._cache_set(key, value);
        }
        return value;
    }

    /**
     * Escribe el valor y registra su score en el índice del prefijo, que S3 no puede
     * derivar por sí solo (`LastModified` es de sólo lectura).
     * Writes the value and records its score in the prefix index, which S3 cannot derive
     * on its own (`LastModified` is read-only).
     */
    async set(key: string, value: string, score?: number): Promise<void> {
        const remote = this._client.send(
            new PutObjectCommand({ Bucket: this._bucket, Key: this._key(key), Body: value, ContentType: 'application/json' })
        );
        if (this._cacheable(key)) {
            this._cache_set(key, value);
        }
        const { parent, name } = split_path(key);
        // A diferencia del filesystem, S3 no tiene dónde guardar el score fuera del índice
        // (`LastModified` es de sólo lectura), así que el índice se carga aunque nadie haya
        // paginado todavía; si no, el orden cronológico se perdería en la primera escritura.
        // Unlike the filesystem, S3 has nowhere to keep the score outside the index
        // (`LastModified` is read-only), so the index is loaded even when nobody paginated
        // yet; otherwise chronological order would be lost on the first write.
        (await this._index(parent)).set(name, score ?? Date.now());
        await remote;
    }

    /**
     * Lista los valores de los hijos directos, ordenados por score DESC.
     * Lists direct children values ordered by score DESC.
     */
    async list(path: string, offset = 0, limit = 50): Promise<string[]> {
        const parent = normalize_path(path);
        const page = (await this._index(parent)).page(offset, limit);
        const values = await Promise.all(page.map((name) => this.get(`${parent}/${name}`)));
        return values.filter((value): value is string => value !== null);
    }

    async delete_prefix(prefix: string): Promise<number> {
        const full_prefix = this._key(prefix);
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
        const { parent, name } = split_path(path);
        (await this._index(parent)).delete(name);
        this._indexes.drop(normalize_path(path));
        return (await this.delete_prefix(path)) > 0;
    }

    /**
     * Cuenta hijos directos desde el índice del prefijo.
     * Counts direct children from the prefix index.
     */
    async count(path: string): Promise<number> {
        return (await this._index(path)).size;
    }

    async clear(): Promise<void> {
        for (const { timer } of this._cache.values()) {
            clearTimeout(timer);
        }
        this._cache.clear();
        this._indexes.clear();
        await this.delete_prefix('');
    }
}
