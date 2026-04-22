/**
 * @file store/engine/lib/redis/index.ts
 * @description Driver de persistencia con Redis.
 * Redis persistence driver.
 */

import type { Engine } from '~/lib/store/engine';

/**
 * Normaliza un path colapsando slashes redundantes.
 * Normalizes a path by collapsing redundant slashes.
 */
function normalize_path(path: string): string {
  return path.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

/**
 * Interface mínima del cliente Redis (compatible con ioredis).
 * Minimal Redis client interface (ioredis-compatible).
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
}

/**
 * Driver de persistencia con Redis.
 *
 * Keyspaces:
 * - `<prefix>:doc:<path>` → string del documento.
 * - `<prefix>:idx:<parent>` → sorted set (score=mtime, member=path completo).
 *
 * `list` combina ZREVRANGE + MGET → O(log N + M) en una sola round-trip.
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
  private _split(path: string): { parent: string; full: string } {
    const full = normalize_path(path);
    const i = full.lastIndexOf('/');
    if (i === -1) {
      return { parent: '', full };
    }
    return { parent: full.slice(0, i), full };
  }

  /**
   * Lee el valor de un documento.
   * Reads a document's value.
   */
  async get(path: string): Promise<string | null> {
    return this._client.get(this._doc_key(path));
  }

  /**
   * Escribe el valor y actualiza el índice del padre con el timestamp actual.
   * Writes the value and updates the parent's index with current timestamp.
   */
  async set(path: string, value: string): Promise<void> {
    const { parent, full } = this._split(path);
    await this._client.set(this._doc_key(full), value);
    await this._client.zadd(this._idx_key(parent), Date.now(), full);
  }

  /**
   * Elimina el doc, su índice y todo el sub-árbol.
   * Deletes the doc, its index, and the entire subtree.
   */
  async unset(path: string): Promise<boolean> {
    const { parent, full } = this._split(path);

    await this._client.del(this._doc_key(full));
    await this._client.zrem(this._idx_key(parent), full);

    await this._delete_pattern(`${this._prefix}:doc:${full}/*`);
    await this._delete_pattern(`${this._prefix}:idx:${full}`);
    await this._delete_pattern(`${this._prefix}:idx:${full}/*`);

    return true;
  }

  /**
   * Lista valores de los hijos directos, ordenados por mtime DESC en una round-trip.
   * Lists direct children values ordered by mtime DESC in a single round-trip.
   */
  async list(path: string, offset = 0, limit = 50): Promise<string[]> {
    const { full } = this._split(path);
    const members = await this._client.zrevrange(this._idx_key(full), offset, offset + limit - 1);
    if (members.length === 0) {
      return [];
    }

    const raws = await this._client.mget(members.map((m) => this._doc_key(m)));
    const result: string[] = [];
    for (const raw of raws) {
      if (raw !== null) {
        result.push(raw);
      }
    }
    return result;
  }

  /**
   * Cuenta hijos directos en O(1) usando ZCARD.
   * Counts direct children in O(1) via ZCARD.
   */
  async count(path: string): Promise<number> {
    const { full } = this._split(path);
    return this._client.zcard(this._idx_key(full));
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
      const [next, batch] = await this._client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (batch.length > 0) {
        await this._client.del(batch);
      }
    } while (cursor !== '0');
  }
}
