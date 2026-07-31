/**
 * @file store/engine/lib/sqlite/index.ts
 * @description Driver de persistencia con SQLite.
 * SQLite persistence driver.
 */

import type { Engine } from '~/lib/store/engine';
import { normalize_path, split_path } from '~/lib/store/engine/lib';

/**
 * Sentencia preparada, con la forma que exponen `better-sqlite3` y `node:sqlite`.
 * Prepared statement, shaped as `better-sqlite3` and `node:sqlite` expose it.
 */
interface SQLiteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/**
 * Interface mínima de la base SQLite. La cumplen `better-sqlite3` (`new Database(file)`) y
 * el `node:sqlite` nativo (`new DatabaseSync(file)`), así que el driver no agrega ninguna
 * dependencia: la base se inyecta ya abierta, igual que el cliente de `RedisEngine`.
 * Minimal SQLite database interface. Both `better-sqlite3` (`new Database(file)`) and the
 * native `node:sqlite` (`new DatabaseSync(file)`) satisfy it, so this driver adds no
 * dependency: the database is injected already open, just like `RedisEngine`'s client.
 */
export interface SQLiteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SQLiteStatement;
}

/**
 * Driver de persistencia con SQLite: una tabla `(path, parent, score, value)` con índice
 * `(parent, score DESC)`.
 *
 * Es el driver más eficiente de los integrados porque delega en el motor lo que los demás
 * resuelven a mano: `list` es un `ORDER BY score DESC LIMIT/OFFSET` sobre el índice (sin
 * índice en memoria ni archivo de orden), `count` un `COUNT(*)` y el `unset` en cascada una
 * sola sentencia por rango de `path`. Medido sobre un chat real de 55.146 mensajes frente al
 * filesystem: 220 MB → 111 MB en disco, primer `list` 115 ms → 0,7 ms y dos inodes en total.
 *
 * SQLite persistence driver: a single `(path, parent, score, value)` table with a
 * `(parent, score DESC)` index. The most efficient built-in driver, since it delegates to the
 * engine what the others hand-roll: `list` is an indexed `ORDER BY score DESC LIMIT/OFFSET`
 * (no in-memory index, no order file), `count` a `COUNT(*)` and cascading `unset` a single
 * range statement. Measured on a real 55,146-message chat against the filesystem: 220 MB →
 * 111 MB on disk, first `list` 115 ms → 0.7 ms and two inodes in total.
 *
 * @example
 * import Database from 'better-sqlite3';
 * const engine = new SQLiteEngine(new Database('.sessions/584144709840.db'));
 *
 * @example
 * import { DatabaseSync } from 'node:sqlite';
 * const engine = new SQLiteEngine(new DatabaseSync('.sessions/584144709840.db'));
 */
export class SQLiteEngine implements Engine {
  private readonly _read: SQLiteStatement;
  private readonly _write: SQLiteStatement;
  private readonly _remove: SQLiteStatement;
  private readonly _page: SQLiteStatement;
  private readonly _total: SQLiteStatement;
  private readonly _wipe: SQLiteStatement;
  private readonly _read_blob: SQLiteStatement;
  private readonly _write_blob: SQLiteStatement;

  /**
   * @param _db - Base SQLite ya abierta / Already open SQLite database
   * @param table - Tabla donde viven los documentos / Table holding the documents
   */
  constructor(private readonly _db: SQLiteDatabase, table = 'documents') {
    // WAL y synchronous NORMAL multiplican el rendimiento de escritura; se aplican con
    // tolerancia porque un driver puede exponerlos como no-op o rechazarlos en :memory:.
    // WAL and synchronous NORMAL greatly speed up writes; applied leniently since a driver
    // may expose them as no-ops or reject them on :memory:.
    try {
      _db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    } catch {
      /* optional tuning */
    }
    _db.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (path TEXT PRIMARY KEY, parent TEXT NOT NULL, score INTEGER NOT NULL, value TEXT NOT NULL DEFAULT '', binary BLOB);
       CREATE INDEX IF NOT EXISTS ${table}_order ON ${table} (parent, score DESC);`
    );
    this._read = _db.prepare(`SELECT value FROM ${table} WHERE path = ?`);
    this._write = _db.prepare(`INSERT INTO ${table} (path, parent, score, value) VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET value = excluded.value, score = excluded.score`);
    // El sub-árbol se borra por rango en vez de con LIKE: '0' es el carácter siguiente a '/',
    // así el rango cubre exactamente los descendientes y se resuelve con el índice de `path`.
    // The subtree is deleted by range instead of LIKE: '0' is the character right after '/',
    // so the range covers exactly the descendants and is served by the `path` index.
    this._remove = _db.prepare(`DELETE FROM ${table} WHERE path = ? OR (path >= ? AND path < ?)`);
    this._page = _db.prepare(`SELECT value FROM ${table} WHERE parent = ? ORDER BY score DESC LIMIT ? OFFSET ?`);
    this._total = _db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE parent = ?`);
    this._wipe = _db.prepare(`DELETE FROM ${table}`);
    this._read_blob = _db.prepare(`SELECT binary FROM ${table} WHERE path = ?`);
    this._write_blob = _db.prepare(`INSERT INTO ${table} (path, parent, score, value, binary) VALUES (?, ?, ?, '', ?)
       ON CONFLICT(path) DO UPDATE SET binary = excluded.binary, score = excluded.score`);
  }

  /**
   * Lee el valor de un documento.
   * Reads a document's value.
   */
  async get(path: string): Promise<string | null> {
    return (this._read.get(normalize_path(path)) as { value: string } | undefined)?.value ?? null;
  }

  /**
   * Escribe el valor del documento; `score` fija el orden de `list` (por defecto, la hora
   * de escritura).
   * Writes the document value; `score` drives `list` ordering (write time by default).
   */
  async set(path: string, value: string, score?: number): Promise<void> {
    const { parent } = split_path(path);
    this._write.run(normalize_path(path), parent, score ?? Date.now(), value);
  }

  /**
   * Elimina el documento y todos sus descendientes. Idempotente.
   * Deletes the document and every descendant. Idempotent.
   */
  async unset(path: string): Promise<boolean> {
    const full = normalize_path(path);
    this._remove.run(full, `${full}/`, `${full}0`);
    return true;
  }

  /**
   * Lista los valores de los hijos directos, ordenados por score DESC.
   * Lists direct children values ordered by score DESC.
   */
  async list(path: string, offset = 0, limit = 50): Promise<string[]> {
    return (this._page.all(normalize_path(path), limit, offset) as { value: string }[]).map((row) => row.value);
  }

  /**
   * Cuenta los hijos directos.
   * Counts direct children.
   */
  async count(path: string): Promise<number> {
    return Number((this._total.get(normalize_path(path)) as { total: number }).total);
  }

  /**
   * Lee el binario del documento, o null si la fila no lo tiene.
   * Reads the document binary, or null when the row has none.
   */
  async get_buffer(path: string): Promise<Buffer | null> {
    const row = this._read_blob.get(normalize_path(path)) as { binary: Buffer | Uint8Array | null } | undefined;
    return row?.binary ? Buffer.from(row.binary) : null;
  }

  /**
   * Escribe el binario del documento como BLOB, sin JSON ni base64.
   * Writes the document binary as a BLOB, with no JSON nor base64.
   */
  async set_buffer(path: string, data: Buffer, score?: number): Promise<void> {
    const { parent } = split_path(path);
    this._write_blob.run(normalize_path(path), parent, score ?? Date.now(), data);
  }

  /**
   * Vacía la tabla completa.
   * Clears the entire table.
   */
  async clear(): Promise<void> {
    this._wipe.run();
  }
}
