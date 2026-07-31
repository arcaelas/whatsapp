/**
 * @file store/engine/lib/index.ts
 * @description Utilidades compartidas por los drivers: índice ordenado por directorio,
 * caché LRU de índices y normalización de rutas.
 * Shared driver utilities: per-directory sorted index, LRU index cache and path normalization.
 */

/**
 * @internal
 * Índice ordenado por score DESC de los hijos de un directorio, mantenido incrementalmente:
 * `page()` recorta sin re-ordenar y `set`/`delete` reubican una sola entrada por búsqueda
 * binaria. Persiste su contenido con el callback `_flush`, agrupando ráfagas de escritura.
 *
 * Score-DESC sorted index of a directory's children, kept incrementally: `page()` slices
 * without re-sorting and `set`/`delete` relocate a single entry via binary search. Persists
 * through the `_flush` callback, coalescing write bursts.
 */
export class SortedIndex {
  /** @internal Nombres ordenados por score DESC. / Names ordered by score DESC. */
  private _order: string[] = [];
  /** @internal Score vigente de cada nombre. / Current score per name. */
  private _scores = new Map<string, number>();
  private _dirty = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param _flush - Persiste el índice; recibe los pares ordenados / Persists the index; receives the ordered pairs
   * @param _delay - Espera antes de persistir, agrupando ráfagas / Wait before persisting, coalescing bursts
   */
  constructor(
    private readonly _flush: (entries: [string, number][]) => Promise<void>,
    private readonly _delay = 1_000
  ) { }

  /** Cantidad de hijos indexados. / Indexed children count. */
  get size(): number {
    return this._order.length;
  }

  /** Pares `[nombre, score]` en orden DESC. / `[name, score]` pairs in DESC order. */
  get entries(): [string, number][] {
    return this._order.map((name) => [name, this._scores.get(name) ?? 0]);
  }

  /**
   * Reemplaza el índice completo con las entradas dadas, ordenándolas una sola vez.
   * Replaces the whole index with the given entries, sorting them once.
   */
  load(entries: Iterable<[string, number]>): void {
    const pairs = [...entries].sort((a, b) => b[1] - a[1]);
    this._order = pairs.map(([name]) => name);
    this._scores = new Map(pairs);
  }

  /** Página de nombres en orden DESC, sin re-ordenar. / Page of names in DESC order, no re-sorting. */
  page(offset: number, limit: number): string[] {
    return this._order.slice(offset, offset + limit);
  }

  /**
   * Inserta o reubica un hijo con su score, manteniendo el orden.
   * Inserts or relocates a child with its score, keeping the order.
   */
  set(name: string, score: number): void {
    this._detach(name);
    this._order.splice(this._locate(score), 0, name);
    this._scores.set(name, score);
    this._schedule();
  }

  /**
   * Quita un hijo del índice.
   * Removes a child from the index.
   */
  delete(name: string): void {
    if (this._scores.has(name)) {
      this._detach(name);
      this._schedule();
    }
  }

  /**
   * Cancela la persistencia pendiente; se usa al descartar el índice de la caché.
   * Cancels the pending persistence; used when dropping the index from the cache.
   */
  dispose(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /** @internal Saca el nombre de la lista ordenada si estaba presente. / Detaches the name from the ordered list when present. */
  private _detach(name: string): void {
    const previous = this._scores.get(name);
    if (previous !== undefined) {
      let position = this._locate(previous);
      while (position < this._order.length && this._order[position] !== name) {
        position++;
      }
      if (position < this._order.length) {
        this._order.splice(position, 1);
      }
      this._scores.delete(name);
    }
  }

  /** @internal Primera posición cuyo score es menor o igual al dado (orden DESC). / First position whose score is lower or equal to the given one (DESC order). */
  private _locate(score: number): number {
    let low = 0;
    let high = this._order.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this._scores.get(this._order[middle]) ?? 0) > score) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  /** @internal Programa la persistencia diferida. / Schedules the deferred persistence. */
  private _schedule(): void {
    this._dirty = true;
    if (!this._timer) {
      this._timer = setTimeout(() => {
        this._timer = null;
        if (this._dirty) {
          this._dirty = false;
          void this._flush(this.entries).catch(() => { });
        }
      }, this._delay);
      this._timer.unref?.();
    }
  }
}

/**
 * @internal
 * Caché LRU de índices por directorio: mantiene acotada la memoria del driver descartando
 * el directorio menos usado cuando se supera el límite.
 * Per-directory LRU cache of indexes: keeps driver memory bounded by dropping the
 * least-recently-used directory once the limit is exceeded.
 */
export class IndexCache {
  private readonly _cache = new Map<string, SortedIndex>();

  /** @param _limit - Directorios indexados simultáneamente / Simultaneously indexed directories */
  constructor(private readonly _limit = 12) { }

  /**
   * Índice ya cargado del directorio, marcándolo como recién usado.
   * Already loaded index for the directory, marking it as recently used.
   */
  get(key: string): SortedIndex | undefined {
    const index = this._cache.get(key);
    if (index) {
      this._cache.delete(key);
      this._cache.set(key, index);
    }
    return index;
  }

  /**
   * Registra el índice del directorio, descartando el menos usado si se supera el límite.
   * Registers the directory index, dropping the least used one when over the limit.
   */
  set(key: string, index: SortedIndex): void {
    this._cache.set(key, index);
    while (this._cache.size > this._limit) {
      const oldest = this._cache.keys().next().value!;
      this._cache.get(oldest)?.dispose();
      this._cache.delete(oldest);
    }
  }

  /**
   * Descarta el índice del directorio y de todo su sub-árbol.
   * Drops the directory index and its whole subtree.
   */
  drop(key: string): void {
    for (const cached of [...this._cache.keys()]) {
      if (cached === key || cached.startsWith(`${key}/`)) {
        this._cache.get(cached)?.dispose();
        this._cache.delete(cached);
      }
    }
  }

  /** Vacía la caché completa. / Clears the whole cache. */
  clear(): void {
    for (const index of this._cache.values()) {
      index.dispose();
    }
    this._cache.clear();
  }
}

/**
 * Normaliza un path colapsando slashes redundantes y recortando los extremos.
 * Normalizes a path collapsing redundant slashes and trimming both ends.
 *
 * @param path - Ruta cruda / Raw path
 * @returns Ruta normalizada / Normalized path
 */
export function normalize_path(path: string): string {
  return path.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

/**
 * Separa una ruta normalizada en directorio padre y nombre del hijo.
 * Splits a normalized path into parent directory and child name.
 *
 * @param path - Ruta a separar / Path to split
 * @returns `{ parent, name }` / `{ parent, name }`
 */
export function split_path(path: string): { parent: string; name: string } {
  const full = normalize_path(path);
  const cut = full.lastIndexOf('/');
  return cut === -1 ? { parent: '', name: full } : { parent: full.slice(0, cut), name: full.slice(cut + 1) };
}
