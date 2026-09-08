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
  // `del`, `zrem` y los de buffer se declaran variádicos porque ioredis los expone con
  // sobrecargas de callback: una firma fija no le resulta asignable bajo `strictFunctionTypes`
  // y obligaría al consumidor a castear su propio cliente.
  // `del`, `zrem` and the buffer ones are declared variadic because ioredis exposes them with
  // callback overloads: a fixed signature is not assignable to it under `strictFunctionTypes`
  // and would force consumers to cast their own client.
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
 * Driver de persistencia con Redis.
 *
 * Keyspaces:
 * - `<prefix>:doc:<path>` → string del documento.
 * - `<prefix>:idx:<parent>` → sorted set (score explícito o de escritura, member=path completo).
 * - `<prefix>:dir:<parent>` → set con los subdirectorios: `chat/a/message` no es un documento y
 *   sin esto `unset('/chat/a')` no sabría que existe.
 *   / set of subdirectories: `chat/a/message` is not a document and without this
 *   `unset('/chat/a')` would not know it exists.
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

  /** @internal */
  private _dir_key(parent: string): string {
    return `${this._prefix}:dir:${normalize_path(parent)}`;
  }

  /**
   * @internal
   * Pares `[directorio, hijo]` de cada nivel entre la raíz y el padre del documento.
   * `[directory, child]` pairs of every level between the root and the document's parent.
   */
  private _ancestors(parent: string): [string, string][] {
    const parts = parent ? parent.split('/') : [];
    return parts.map((_, index) => [parts.slice(0, index).join('/'), parts.slice(0, index + 1).join('/')]);
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
      for (const [dir, child] of this._ancestors(parent)) pipeline.sadd(this._dir_key(dir), child);
      await pipeline.exec();
    } else {
      await this._client.set(doc_key, value);
      await this._client.zadd(idx_key, rank, full);
      for (const [dir, child] of this._ancestors(parent)) await this._client.sadd(this._dir_key(dir), child);
    }
  }

  /**
   * Elimina el doc, su entrada de índice y todo el sub-árbol. Los descendientes se recorren por
   * los índices —cada zset nombra a sus hijos— en vez de con SCAN, que cuesta el keyspace
   * entero de Redis por cada borrado: baileys hace un `unset` por cada pre-key que consume.
   * Deletes the doc, its index entry, and the entire subtree. Descendants are walked through
   * the indexes —each zset names its children— instead of SCAN, which costs the whole Redis
   * keyspace per delete: baileys issues one `unset` per pre-key it consumes.
   */
  async unset(path: string): Promise<boolean> {
    const { parent } = split_path(path);
    const full = normalize_path(path);
    const nodes = new Set([full]);
    for (const node of nodes) {
      const [docs, dirs] = await Promise.all([this._client.zrevrange(this._idx_key(node), 0, -1), this._client.smembers(this._dir_key(node))]);
      for (const child of [...docs, ...dirs]) nodes.add(child);
    }
    const keys = [...nodes].flatMap((node) => [this._doc_key(node), `${this._doc_key(node)}:bin`, this._idx_key(node), this._dir_key(node)]);
    const pipeline = this._client.pipeline?.();
    if (pipeline) {
      for (let i = 0; i < keys.length; i += 500) pipeline.del(keys.slice(i, i + 500));
      pipeline.zrem(this._idx_key(parent), full);
      pipeline.srem(this._dir_key(parent), full);
      await pipeline.exec();
    } else {
      for (let i = 0; i < keys.length; i += 500) await this._client.del(keys.slice(i, i + 500));
      await this._client.zrem(this._idx_key(parent), full);
      await this._client.srem(this._dir_key(parent), full);
    }
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
   * Lee el binario del documento. Requiere un cliente con soporte de buffers (ioredis lo
   * trae con `getBuffer`); sin él la librería cae al documento serializado.
   * Reads the document binary. Requires a buffer-capable client (ioredis ships `getBuffer`);
   * without it the library falls back to the serialized document.
   */
  async get_buffer(path: string): Promise<Buffer | null> {
    return (await this._client.getBuffer?.(`${this._doc_key(path)}:bin`)) ?? null;
  }

  /**
   * Escribe el binario del documento en su propia key, sin JSON ni base64.
   * Writes the document binary in its own key, with no JSON nor base64.
   */
  async set_buffer(path: string, data: Buffer, score?: number): Promise<void> {
    const { parent } = split_path(path);
    const full = normalize_path(path);
    await this._client.setBuffer?.(`${this._doc_key(full)}:bin`, data);
    await this._client.zadd(this._idx_key(parent), score ?? Date.now(), full);
    for (const [dir, child] of this._ancestors(parent)) await this._client.sadd(this._dir_key(dir), child);
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
