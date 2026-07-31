/**
 * @file store/engine/index.ts
 * @description Contrato del motor de persistencia (string-based), utilidades compartidas
 * por los drivers y barrel de implementaciones.
 * Engine contract (string-based), shared driver utilities and implementations barrel.
 */

/**
 * Contrato de persistencia key-value de strings. El engine no conoce JSON; la serialización
 * ocurre en la capa superior (ver `store/serialize` y `store/deserialize`).
 *
 * Key-value string persistence contract. The engine is unaware of JSON; serialization happens
 * in the upper layer.
 *
 * Reglas / Rules:
 * - Paths se normalizan quitando slashes redundantes. / Paths strip redundant slashes.
 * - `set` fija el score de orden: el `score` explícito cuando llega, o la hora de escritura.
 *   / `set` fixes the ordering score: the explicit `score` when given, else write time.
 * - `unset` hace cascade sobre el sub-árbol. / `unset` cascades the subtree.
 * - `list` solo devuelve hijos directos ordenados por score DESC. / `list` yields direct children, score DESC.
 * - `list` y `count` cuestan O(limit) amortizado: los drivers mantienen un índice ordenado
 *   por directorio en vez de recorrer y re-ordenar el padre en cada página (ver `SortedIndex`).
 *   / `list` and `count` cost O(limit) amortized: drivers keep a per-directory sorted index
 *   instead of scanning and re-sorting the parent on every page.
 */
export interface Engine {
  /** Lee un valor por path. Retorna null si no existe. / Reads a value by path; null if missing. */
  get(path: string): Promise<string | null>;

  /**
   * Escribe un valor. `score` fija el orden de `list` (epoch ms del documento, ej. `created_at`);
   * sin él se usa la hora de escritura — los re-syncs que reescriben documentos históricos DEBEN
   * pasar el score para no destruir la cronología.
   * Writes a value. `score` drives `list` ordering (document epoch ms, e.g. `created_at`);
   * without it write time is used — re-syncs rewriting historical documents MUST pass the
   * score to preserve chronology.
   */
  set(path: string, value: string, score?: number): Promise<void>;

  /** Elimina el valor y todos sus descendientes. Idempotente. / Cascade delete. Idempotent. */
  unset(path: string): Promise<boolean>;

  /** Lista valores de los hijos directos, paginados por score DESC. / Lists direct children values, score DESC. */
  list(path: string, offset?: number, limit?: number): Promise<string[]>;

  /** Cuenta hijos directos sin leer los valores. / Counts direct children without loading values. */
  count(path: string): Promise<number>;

  /** Vacía completamente el almacén. / Clears the entire store. */
  clear(): Promise<void>;
}

export { FileSystemEngine } from '~/lib/store/engine/lib/file_system';
export { RedisEngine, type RedisClient } from '~/lib/store/engine/lib/redis';
export { S3Engine } from '~/lib/store/engine/lib/s3';
export { SQLiteEngine, type SQLiteDatabase } from '~/lib/store/engine/lib/sqlite';
