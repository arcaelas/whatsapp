/**
 * @file store/engine/lib/redis/index.ts
 * @description Driver de persistencia con Redis.
 * Redis persistence driver.
 */

import type { Engine } from '~/lib/store/engine';
import { normalize_path, split_path } from '~/lib/store/engine/lib';

/**
 * Interface mínima del cliente Redis (compatible con ioredis). `pipeline` es opcional:
 * cuando existe, las escrituras que tocan documento e índice viajan en un solo round-trip.
 * Minimal Redis client interface (ioredis-compatible). `pipeline` is optional: when present,
 * writes touching document and index travel in a single round-trip.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(keys: string | string[]): Promise<unknown>;
  mget(keys: string[]): Promise<(string | null)[]>;
  scan(cursor: number | string, ...args: unknown[]): Promise<[string, string[]]>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrem(key: string, members: string | string[]): Promise<unknown>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  zcard(key: string): Promise<number>;
  pipeline?(): {
    set(key: string, value: string): unknown;
    del(keys: string | string[]): unknown;
    zadd(key: string, score: number, member: string): unknown;
    zrem(key: string, members: string | string[]): unknown;
    exec(): Promise<unknown>;
  };
}

/**
 * Driver de persistencia con Redis.
 *
 * Keyspaces:
 * - `<prefix>:doc:<path>` → string del documento.
 * - `<prefix>:idx:<parent>` → sorted set (score explícito o de escritura, member=path completo).
 *
 * El índice ordenado vive en Redis: `list` combina ZREVRANGE + MGET (dos round-trips, O(log N + M))
 * y `count` es un ZCARD O(1); las escrituras agrupan documento e índice en un pipeline para que
 * no queden documentos huérfanos del índice si el proceso muere entre ambas operaciones.
 *
 * Redis persistence driver. The sorted index lives in Redis: `list` combines ZREVRANGE + MGET
 * and `count` is an O(1) ZCARD; writes group document and index in a pipeline so no document
 * is left orphaned from the index when the process dies between both operations.
 *
 * @example
 * import IORedis from 'ioredis';
 * const engine = new RedisEngine(new IORedis(), 'wa:5491112345678');
 */
export class RedisEngine implements Engine {
  constructor(
    private readonly _client: RedisClient,
    private readonly _prefix: string = 'wa:default'
  ) { }

  /** @internal */
  private _doc_key(path: string): string {
    return `${this._prefix}:doc:${normalize_path(path)}`;
  }

  /** @internal */
  private _idx_key(parent: string): string {
    return `${this._prefix}:idx:${normalize_path(parent)}`;
  }

  /**
   * Lee el valor de un documento.
   * Reads a document's value.
   */
  async get(path: string): Promise<string | null> {
    return this._client.get(this._doc_key(path));
  }

  /**
   * Escribe el valor y su entrada de índice en una sola operación; `score` fija el orden
   * de `list` (por defecto, la hora de escritura).
   * Writes the value and its index entry in a single operation; `score` drives `list`
   * ordering (write time by default).
   */
  async set(path: string, value: string, score?: number): Promise<void> {
    const { parent } = split_path(path);
    const full = normalize_path(path);
    const doc_key = this._doc_key(full);
    const idx_key = this._idx_key(parent);
    const rank = score ?? Date.now();
    const pipeline = this._client.pipeline?.();
    if (pipeline) {
      pipeline.set(doc_key, value);
      pipeline.zadd(idx_key, rank, full);
      await pipeline.exec();
    } else {
      await this._client.set(doc_key, value);
      await this._client.zadd(idx_key, rank, full);
    }
  }

  /**
   * Elimina el doc, su entrada de índice y todo el sub-árbol.
   * Deletes the doc, its index entry, and the entire subtree.
   */
  async unset(path: string): Promise<boolean> {
    const { parent } = split_path(path);
    const full = normalize_path(path);
    const pipeline = this._client.pipeline?.();
    if (pipeline) {
      pipeline.del(this._doc_key(full));
      pipeline.zrem(this._idx_key(parent), full);
      await pipeline.exec();
    } else {
      await this._client.del(this._doc_key(full));
      await this._client.zrem(this._idx_key(parent), full);
    }
    await Promise.all([
      this._delete_pattern(`${this._prefix}:doc:${full}/*`),
      this._delete_pattern(`${this._prefix}:idx:${full}`),
      this._delete_pattern(`${this._prefix}:idx:${full}/*`),
    ]);
    return true;
  }

  /**
   * Lista valores de los hijos directos, ordenados por score DESC en dos round-trips.
   * Lists direct children values ordered by score DESC in two round-trips.
   */
  async list(path: string, offset = 0, limit = 50): Promise<string[]> {
    const members = await this._client.zrevrange(this._idx_key(path), offset, offset + limit - 1);
    if (members.length === 0) {
      return [];
    }
    const raws = await this._client.mget(members.map((member) => this._doc_key(member)));
    return raws.filter((raw): raw is string => raw !== null);
  }

  /**
   * Cuenta hijos directos en O(1) usando ZCARD.
   * Counts direct children in O(1) via ZCARD.
   */
  async count(path: string): Promise<number> {
    return this._client.zcard(this._idx_key(path));
  }

  /**
   * Vacía todo el prefix del cliente.
   * Clears the entire client prefix.
   */
  async clear(): Promise<void> {
    await this._delete_pattern(`${this._prefix}:*`);
  }

  /**
   * Borra todas las keys que coinciden con un patrón usando SCAN + DEL por lotes.
   * Deletes all keys matching a pattern via SCAN + DEL in batches.
   *
   * @internal
   */
  private async _delete_pattern(pattern: string): Promise<void> {
    let cursor: string | number = '0';
    do {
      const [next, batch] = await this._client.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      if (batch.length > 0) {
        await this._client.del(batch);
      }
    } while (cursor !== '0');
  }
}
