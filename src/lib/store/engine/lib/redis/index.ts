/**
 * @file store/engine/lib/redis/index.ts
 * @description Driver de persistencia con Redis.
 * Redis persistence driver.
 */

import type { Engine } from '~/lib/store/engine';
import { normalize_path, split_path } from '~/lib/store/engine/lib';

/**
 * Interface mínima del cliente Redis, compatible con ioredis; `pipeline` agrupa documento e
 * índice en un solo round-trip cuando existe.
 * Minimal Redis client interface, ioredis-compatible; `pipeline` groups document and index in a
 * single round-trip when present.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  /** Variádico como los de buffer: ioredis los expone con sobrecargas de callback que una firma fija no acepta. / Variadic like the buffer ones: ioredis exposes them with callback overloads a fixed signature does not accept. */
  del(...keys: unknown[]): Promise<unknown>;
  mget(keys: string[]): Promise<(string | null)[]>;
  scan(cursor: number | string, ...args: unknown[]): Promise<[string, string[]]>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrem(...args: unknown[]): Promise<unknown>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  zcard(key: string): Promise<number>;
  sadd(...args: unknown[]): Promise<unknown>;
  srem(...args: unknown[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  getBuffer?(...args: unknown[]): Promise<Buffer | null>;
  setBuffer?(...args: unknown[]): Promise<unknown>;
  pipeline?(): {
    set(key: string, value: string): unknown;
    del(...keys: unknown[]): unknown;
    zadd(key: string, score: number, member: string): unknown;
    zrem(...args: unknown[]): unknown;
    sadd(...args: unknown[]): unknown;
    srem(...args: unknown[]): unknown;
    exec(): Promise<unknown>;
  };
}

/**
 * Driver Redis: `<prefix>:doc:<path>` guarda el documento, `<prefix>:idx:<parent>` ordena los
 * hijos por score y `<prefix>:dir:<parent>` nombra los subdirectorios que no son documentos.
 * Redis driver: `<prefix>:doc:<path>` holds the document, `<prefix>:idx:<parent>` orders the
 * children by score and `<prefix>:dir:<parent>` names the subdirectories that are not documents.
 *
 * @example
 * import IORedis from 'ioredis';
 * const engine = new RedisEngine(new IORedis(), 'wa:5491112345678');
 */
export class RedisEngine implements Engine {
  /**
   * @param client - Cliente Redis ya conectado / Already connected Redis client
   * @param prefix - Prefijo de todas las keys / Prefix of every key
   */
  constructor(
    private readonly client: RedisClient,
    private readonly prefix: string = 'wa:default'
  ) { }

  /** @param path - Ruta del documento / Document path */
  #doc(path: string): string {
    return `${this.prefix}:doc:${normalize_path(path)}`;
  }

  /** @param parent - Directorio / Directory */
  #idx(parent: string): string {
    return `${this.prefix}:idx:${normalize_path(parent)}`;
  }

  /** @param parent - Directorio / Directory */
  #dir(parent: string): string {
    return `${this.prefix}:dir:${normalize_path(parent)}`;
  }

  /** @param parent - Directorio del documento; devuelve los pares `[directorio, hijo]` hasta la raíz / Document directory; returns the `[directory, child]` pairs up to the root */
  #ancestors(parent: string): [string, string][] {
    const parts = parent ? parent.split('/') : [];
    return parts.map((_, index) => [parts.slice(0, index).join('/'), parts.slice(0, index + 1).join('/')]);
  }

  /** @param path - Ruta del documento / Document path */
  async get(path: string): Promise<string | null> {
    return this.client.get(this.#doc(path));
  }

  /**
   * @param path - Ruta del documento / Document path
   * @param value - Contenido / Content
   * @param score - Orden en `list`; sin él, la hora de escritura / `list` order; without it, write time
   */
  async set(path: string, value: string, score?: number): Promise<void> {
    const { parent } = split_path(path);
    const full = normalize_path(path);
    const pipeline = this.client.pipeline?.();
    if (pipeline) {
      pipeline.set(this.#doc(full), value);
      pipeline.zadd(this.#idx(parent), score ?? Date.now(), full);
      this.#ancestors(parent).forEach(([dir, child]) => pipeline.sadd(this.#dir(dir), child));
      await pipeline.exec();
    } else {
      await this.client.set(this.#doc(full), value);
      await this.client.zadd(this.#idx(parent), score ?? Date.now(), full);
      await Promise.all(this.#ancestors(parent).map(([dir, child]) => this.client.sadd(this.#dir(dir), child)));
    }
  }

  /**
   * Borra el documento y su sub-árbol recorriendo índices y directorios nivel por nivel, sin SCAN:
   * baileys hace un `unset` por cada pre-key que consume y SCAN costaría el keyspace entero cada
   * vez. Cada nivel se consulta de una vez, así los viajes son la profundidad del árbol.
   * Deletes the document and its subtree walking indexes and directories level by level, without
   * SCAN: baileys issues one `unset` per pre-key it consumes and SCAN would cost the whole keyspace
   * every time. Every level is queried at once, so the round trips are the depth of the tree.
   *
   * @param path - Ruta que se borra con todo su sub-árbol / Path deleted with its whole subtree
   */
  async unset(path: string): Promise<boolean> {
    const { parent } = split_path(path);
    const full = normalize_path(path);
    const nodes = new Set([full]);
    for (let level = [full]; level.length;) {
      const found = await Promise.all(level.flatMap((node) => [this.client.zrevrange(this.#idx(node), 0, -1), this.client.smembers(this.#dir(node))]));
      level = found.flat().filter((child) => nodes.has(child) === false);
      level.forEach((child) => nodes.add(child));
    }
    const keys = [...nodes].flatMap((node) => [this.#doc(node), `${this.#doc(node)}:bin`, this.#idx(node), this.#dir(node)]);
    const batches = Array.from({ length: Math.ceil(keys.length / 500) }, (_, index) => keys.slice(index * 500, index * 500 + 500));
    const pipeline = this.client.pipeline?.();
    if (pipeline) {
      batches.forEach((batch) => pipeline.del(batch));
      pipeline.zrem(this.#idx(parent), full);
      pipeline.srem(this.#dir(parent), full);
      await pipeline.exec();
    } else {
      await Promise.all([...batches.map((batch) => this.client.del(batch)), this.client.zrem(this.#idx(parent), full), this.client.srem(this.#dir(parent), full)]);
    }
    return true;
  }

  /**
   * @param path - Directorio / Directory
   * @param offset - Desplazamiento / Offset
   * @param limit - Tamaño de página / Page size
   */
  async list(path: string, offset = 0, limit = 50): Promise<string[]> {
    const members = await this.client.zrevrange(this.#idx(path), offset, offset + limit - 1);
    return members.length ? (await this.client.mget(members.map((member) => this.#doc(member)))).filter((raw): raw is string => raw !== null) : [];
  }

  /** @param path - Directorio / Directory */
  async count(path: string): Promise<number> {
    return this.client.zcard(this.#idx(path));
  }

  /** @param path - Ruta del documento; exige un cliente con `getBuffer` / Document path; requires a client with `getBuffer` */
  async get_buffer(path: string): Promise<Buffer | null> {
    return (await this.client.getBuffer?.(`${this.#doc(path)}:bin`)) ?? null;
  }

  /**
   * @param path - Ruta del documento / Document path
   * @param data - Binario crudo, sin JSON ni base64 / Raw binary, no JSON nor base64
   * @param score - Orden en `list` / `list` order
   */
  async set_buffer(path: string, data: Buffer, score?: number): Promise<void> {
    const { parent } = split_path(path);
    const full = normalize_path(path);
    await this.client.setBuffer?.(`${this.#doc(full)}:bin`, data);
    await this.client.zadd(this.#idx(parent), score ?? Date.now(), full);
    await Promise.all(this.#ancestors(parent).map(([dir, child]) => this.client.sadd(this.#dir(dir), child)));
  }

  /** Vacía todas las keys del prefijo con SCAN por lotes. / Clears every key of the prefix with batched SCAN. */
  async clear(): Promise<void> {
    const sweep = async (cursor: string | number): Promise<void> => {
      const [next, batch] = await this.client.scan(cursor, 'MATCH', `${this.prefix}:*`, 'COUNT', 500);
      if (batch.length) await this.client.del(batch);
      if (next !== '0') await sweep(next);
    };
    await sweep('0');
  }
}
