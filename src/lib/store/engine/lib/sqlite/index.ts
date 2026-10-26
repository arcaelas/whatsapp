/**
 * @file store/engine/lib/sqlite/index.ts
 * @description Driver de persistencia con SQLite.
 * SQLite persistence driver.
 */

import type { Engine } from '~/lib/store/engine';
import { normalize_path, split_path } from '~/lib/store/engine/lib';

/** Sentencia preparada, con la forma de `better-sqlite3` y `node:sqlite`. / Prepared statement, shaped as `better-sqlite3` and `node:sqlite` expose it. */
interface SQLiteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/**
 * Base SQLite mínima: la cumplen `better-sqlite3` y el `node:sqlite` nativo, así que el driver no
 * agrega dependencias y recibe la base ya abierta.
 * Minimal SQLite database: both `better-sqlite3` and the native `node:sqlite` satisfy it, so the
 * driver adds no dependency and receives the database already open.
 */
export interface SQLiteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SQLiteStatement;
}

/**
 * Driver SQLite: una tabla `(path, parent, score, value, binary)` con índice `(parent, score DESC)`;
 * `list` es un `ORDER BY` sobre el índice y `count` un `COUNT(*)`, sin índice en memoria.
 * SQLite driver: a `(path, parent, score, value, binary)` table with a `(parent, score DESC)`
 * index; `list` is an `ORDER BY` over the index and `count` a `COUNT(*)`, with no in-memory index.
 *
 * @example
 * import { DatabaseSync } from 'node:sqlite';
 * const engine = new SQLiteEngine(new DatabaseSync('.sessions/5491112345678.db'));
 */
export class SQLiteEngine implements Engine {
  readonly #read: SQLiteStatement;
  readonly #write: SQLiteStatement;
  /** Borra el sub-árbol por rango: '0' es el carácter siguiente a '/', así el índice de `path` lo resuelve. / Deletes the subtree by range: '0' is the character right after '/', so the `path` index serves it. */
  readonly #remove: SQLiteStatement;
  readonly #page: SQLiteStatement;
  readonly #total: SQLiteStatement;
  readonly #wipe: SQLiteStatement;
  readonly #read_blob: SQLiteStatement;
  readonly #write_blob: SQLiteStatement;

  /**
   * @param db - Base SQLite ya abierta; WAL y `synchronous = NORMAL` se piden sin exigirlos / Already open SQLite database; WAL and `synchronous = NORMAL` are requested without requiring them
   * @param table - Tabla donde viven los documentos / Table holding the documents
   */
  constructor(db: SQLiteDatabase, table = 'documents') {
    void Promise.resolve().then(() => db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')).catch(() => null);
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (path TEXT PRIMARY KEY, parent TEXT NOT NULL, score INTEGER NOT NULL, value TEXT NOT NULL DEFAULT '', binary BLOB);
       CREATE INDEX IF NOT EXISTS ${table}_order ON ${table} (parent, score DESC);`
    );
    this.#read = db.prepare(`SELECT value FROM ${table} WHERE path = ?`);
    this.#write = db.prepare(`INSERT INTO ${table} (path, parent, score, value) VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET value = excluded.value, score = excluded.score`);
    this.#remove = db.prepare(`DELETE FROM ${table} WHERE path = ? OR (path >= ? AND path < ?)`);
    this.#page = db.prepare(`SELECT value FROM ${table} WHERE parent = ? ORDER BY score DESC LIMIT ? OFFSET ?`);
    this.#total = db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE parent = ?`);
    this.#wipe = db.prepare(`DELETE FROM ${table}`);
    this.#read_blob = db.prepare(`SELECT binary FROM ${table} WHERE path = ?`);
    this.#write_blob = db.prepare(`INSERT INTO ${table} (path, parent, score, value, binary) VALUES (?, ?, ?, '', ?)
       ON CONFLICT(path) DO UPDATE SET binary = excluded.binary, score = excluded.score`);
  }

  /** @param path - Ruta del documento / Document path */
  async get(path: string): Promise<string | null> {
    return (this.#read.get(normalize_path(path)) as { value: string } | undefined)?.value ?? null;
  }

  /**
   * @param path - Ruta del documento / Document path
   * @param value - Contenido / Content
   * @param score - Orden en `list`; sin él, la hora de escritura / `list` order; without it, write time
   */
  async set(path: string, value: string, score?: number): Promise<void> {
    this.#write.run(normalize_path(path), split_path(path).parent, score ?? Date.now(), value);
  }

  /** @param path - Ruta que se borra con todo su sub-árbol / Path deleted with its whole subtree */
  async unset(path: string): Promise<boolean> {
    const full = normalize_path(path);
    this.#remove.run(full, `${full}/`, `${full}0`);
    return true;
  }

  /**
   * @param path - Directorio / Directory
   * @param offset - Desplazamiento / Offset
   * @param limit - Tamaño de página / Page size
   */
  async list(path: string, offset = 0, limit = 50): Promise<string[]> {
    return (this.#page.all(normalize_path(path), limit, offset) as { value: string }[]).map((row) => row.value);
  }

  /** @param path - Directorio / Directory */
  async count(path: string): Promise<number> {
    return Number((this.#total.get(normalize_path(path)) as { total: number }).total);
  }

  /** @param path - Ruta del documento / Document path */
  async get_buffer(path: string): Promise<Buffer | null> {
    const row = this.#read_blob.get(normalize_path(path)) as { binary: Buffer | Uint8Array | null } | undefined;
    return row?.binary ? Buffer.from(row.binary) : null;
  }

  /**
   * @param path - Ruta del documento / Document path
   * @param data - Binario crudo, sin JSON ni base64 / Raw binary, no JSON nor base64
   * @param score - Orden en `list` / `list` order
   */
  async set_buffer(path: string, data: Buffer, score?: number): Promise<void> {
    this.#write_blob.run(normalize_path(path), split_path(path).parent, score ?? Date.now(), data);
  }

  async clear(): Promise<void> {
    this.#wipe.run();
  }
}
