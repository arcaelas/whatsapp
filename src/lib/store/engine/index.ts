/**
 * @file store/engine/index.ts
 * @description Contrato del motor de persistencia (string-based) y barrel de drivers.
 * Engine contract (string-based) and drivers barrel.
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
 * - `set` refresca el mtime (drives `list` order). / `set` refreshes mtime.
 * - `unset` hace cascade sobre el sub-árbol. / `unset` cascades the subtree.
 * - `list` solo devuelve hijos directos ordenados por mtime DESC. / `list` yields direct children, mtime DESC.
 */
export interface Engine {
  /** Lee un valor por path. Retorna null si no existe. / Reads a value by path; null if missing. */
  get(path: string): Promise<string | null>;

  /** Escribe un valor. Refresca el mtime. / Writes a value. Refreshes mtime. */
  set(path: string, value: string): Promise<void>;

  /** Elimina el valor y todos sus descendientes. Idempotente. / Cascade delete. Idempotent. */
  unset(path: string): Promise<boolean>;

  /** Lista valores de los hijos directos, paginados por mtime DESC. / Lists direct children values, mtime DESC. */
  list(path: string, offset?: number, limit?: number): Promise<string[]>;

  /** Cuenta hijos directos sin leer los valores. / Counts direct children without loading values. */
  count(path: string): Promise<number>;

  /** Vacía completamente el almacén. / Clears the entire store. */
  clear(): Promise<void>;
}

export { FileSystemEngine } from '~/lib/store/engine/lib/file_system';
export { RedisEngine, type RedisClient } from '~/lib/store/engine/lib/redis';
