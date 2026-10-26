/**
 * @file store/engine/lib/s3/index.ts
 * @description Driver de persistencia con AWS S3 (caché local opcional).
 * AWS S3 persistence driver (optional local cache).
 */

import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Engine } from '~/lib/store/engine';
import { IndexCache, normalize_path, SortedIndex, split_path } from '~/lib/store/engine/lib';

/**
 * Caché local: cada entrada se limpia con un `setTimeout` y `when` decide qué rutas se cachean.
 * Local cache: every entry is cleared with a `setTimeout` and `when` decides which paths are cached.
 */
interface CacheOptions {
    /** Vida de cada entrada en ms. / Lifetime of every entry in ms. */
    ttl: number;
    /** Decide si una ruta se cachea. / Decides whether a path is cached. */
    when(key: string): boolean;
}

interface S3EngineOptions {
    /** Cliente S3 ya configurado. / Pre-configured S3 client. */
    s3: S3Client;
    /** Nombre del bucket. / Bucket name. */
    bucket: string;
    /** Prefijo base de las keys dentro del bucket. / Base key prefix inside the bucket. */
    basedir: string;
    /** Caché local; `false` por defecto. / Local cache; `false` by default. */
    cache?: false | CacheOptions;
    /** Prefijos indexados a la vez en memoria. / Prefixes indexed in memory at once. */
    cached?: number;
}

/**
 * Driver S3: el orden de cada prefijo vive en su objeto `.order`, porque `LastModified` es de sólo
 * lectura y no puede guardar el score; sin `.order`, el índice se reconstruye listando el prefijo.
 * S3 driver: every prefix's order lives in its `.order` object, since `LastModified` is read-only
 * and cannot hold the score; without `.order`, the index is rebuilt listing the prefix.
 */
export class S3Engine implements Engine {
    /** Prefijo de las keys, terminado en `/`. / Key prefix, ending in `/`. */
    readonly #prefix: string;
    /** Documentos cacheados con su timer de expiración. / Cached documents with their expiration timer. */
    readonly #cache = new Map<string, { value: string | null; timer: ReturnType<typeof setTimeout> }>();
    /** Índices por prefijo, acotados por LRU. / Per-prefix indexes, LRU-bounded. */
    readonly #indexes: IndexCache;

    /** @param options - Cliente, bucket, prefijo y caché / Client, bucket, prefix and cache */
    constructor(private readonly options: S3EngineOptions) {
        this.#prefix = options.basedir.endsWith('/') ? options.basedir : `${options.basedir}/`;
        this.#indexes = new IndexCache(options.cached ?? 12);
    }

    /** @param path - Ruta del documento / Document path */
    #key(path: string): string {
        return `${this.#prefix}${normalize_path(path).replace(/@/g, '_at_')}`;
    }

    /** @param path - Ruta a cachear según `when` / Path to cache per `when` */
    #cacheable(path: string): boolean {
        return this.options.cache ? this.options.cache.when(path) : false;
    }

    /**
     * @param path - Ruta cacheada / Cached path
     * @param value - Valor a recordar; reemplaza el timer anterior / Value to remember; replaces the previous timer
     */
    #remember(path: string, value: string | null): void {
        clearTimeout(this.#cache.get(path)?.timer);
        this.#cache.set(path, { value, timer: setTimeout(() => this.#cache.delete(path), this.options.cache ? this.options.cache.ttl : 0) });
    }

    /**
     * Índice del prefijo: el de la caché, el del objeto `.order`, o uno reconstruido listando el
     * prefijo una vez y ordenando por `LastModified`.
     * Prefix index: the cached one, the `.order` object's, or one rebuilt listing the prefix once
     * and ordering by `LastModified`.
     *
     * @param path - Directorio / Directory
     */
    async #index(path: string): Promise<SortedIndex> {
        const key = normalize_path(path);
        const parent = `${this.#key(key)}/`;
        const cached = this.#indexes.get(key);
        const index = cached ?? new SortedIndex(async (entries) => {
            await this.options.s3
                .send(new PutObjectCommand({ Bucket: this.options.bucket, Key: `${parent}.order`, Body: entries.map(([name, score]) => `${score}\t${name}`).join('\n'), ContentType: 'text/plain' }))
                .catch(() => null);
        });
        if (cached === undefined) {
            const persisted = await this.options.s3
                .send(new GetObjectCommand({ Bucket: this.options.bucket, Key: `${parent}.order` }))
                .then((res) => res.Body?.transformToString('utf-8') ?? null)
                .catch(() => null);
            const scan = async (token?: string): Promise<[string, number][]> => {
                const res = await this.options.s3.send(new ListObjectsV2Command({ Bucket: this.options.bucket, Prefix: parent, ContinuationToken: token, MaxKeys: 1000 }));
                const rows = (res.Contents ?? [])
                    .map((object) => [object.Key?.slice(parent.length).split('/')[0] ?? '', object.LastModified?.getTime() ?? 0] as [string, number])
                    .filter(([name]) => name && name !== '.order');
                return [...rows, ...(res.NextContinuationToken ? await scan(res.NextContinuationToken) : [])];
            };
            index.load(persisted
                ? persisted.split('\n').filter(Boolean).map((line) => line.split('\t')).map(([score, name]) => [name, Number(score)] as [string, number])
                : (await scan()).reduce((children, [name, at]) => children.set(name, Math.max(children.get(name) ?? 0, at)), new Map<string, number>()));
            this.#indexes.set(key, index);
        }
        return index;
    }

    /** @param prefix - Prefijo cuyos objetos se borran por lotes de mil / Prefix whose objects are deleted in batches of a thousand */
    async #purge(prefix: string): Promise<void> {
        const sweep = async (token?: string): Promise<void> => {
            const res = await this.options.s3.send(new ListObjectsV2Command({ Bucket: this.options.bucket, Prefix: this.#key(prefix), ContinuationToken: token, MaxKeys: 1000 }));
            const keys = (res.Contents ?? []).filter((object) => object.Key).map((object) => ({ Key: object.Key! }));
            if (keys.length) await this.options.s3.send(new DeleteObjectsCommand({ Bucket: this.options.bucket, Delete: { Objects: keys } }));
            if (res.NextContinuationToken) await sweep(res.NextContinuationToken);
        };
        await sweep();
    }

    /** @param key - Ruta del documento / Document path */
    async get(key: string): Promise<string | null> {
        const path = normalize_path(key);
        const hit = this.#cacheable(path) ? this.#cache.get(path) : undefined;
        const value = hit
            ? hit.value
            : await this.options.s3
                .send(new GetObjectCommand({ Bucket: this.options.bucket, Key: this.#key(key) }))
                .then((res) => res.Body?.transformToString('utf-8') ?? null)
                .catch(() => null);
        if (hit === undefined && this.#cacheable(path)) this.#remember(path, value);
        return value;
    }

    /**
     * El índice del prefijo se carga aunque nadie haya paginado: es el único lugar donde S3 puede
     * guardar el score.
     * The prefix index is loaded even when nobody paginated: it is the only place S3 can keep the
     * score in.
     *
     * @param key - Ruta del documento / Document path
     * @param value - Contenido / Content
     * @param score - Orden en `list`; sin él, la hora de escritura / `list` order; without it, write time
     */
    async set(key: string, value: string, score?: number): Promise<void> {
        const { parent, name } = split_path(key);
        const remote = this.options.s3.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: this.#key(key), Body: value, ContentType: 'application/json' }));
        if (this.#cacheable(normalize_path(key))) this.#remember(normalize_path(key), value);
        (await this.#index(parent)).set(name, score ?? Date.now());
        await remote;
    }

    /**
     * @param path - Directorio / Directory
     * @param offset - Desplazamiento / Offset
     * @param limit - Tamaño de página / Page size
     */
    async list(path: string, offset = 0, limit = 50): Promise<string[]> {
        const parent = normalize_path(path);
        return (await Promise.all((await this.#index(parent)).page(offset, limit).map((name) => this.get(`${parent}/${name}`)))).filter((value): value is string => value !== null);
    }

    /** @param path - Ruta que se borra con todo su sub-árbol / Path deleted with its whole subtree */
    async unset(path: string): Promise<boolean> {
        const { parent, name } = split_path(path);
        const full = normalize_path(path);
        [...this.#cache.keys()].filter((key) => key === full || key.startsWith(`${full}/`)).forEach((key) => {
            clearTimeout(this.#cache.get(key)!.timer);
            this.#cache.delete(key);
        });
        (await this.#index(parent)).delete(name);
        this.#indexes.drop(normalize_path(path));
        await this.#purge(path);
        return true;
    }

    /** @param path - Directorio / Directory */
    async count(path: string): Promise<number> {
        return (await this.#index(path)).size;
    }

    async clear(): Promise<void> {
        this.#cache.forEach(({ timer }) => clearTimeout(timer));
        this.#cache.clear();
        this.#indexes.clear();
        await this.#purge('');
    }
}
