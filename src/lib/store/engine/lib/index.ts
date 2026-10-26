/**
 * @file store/engine/lib/index.ts
 * @description Utilidades compartidas por los drivers: índice ordenado por directorio, caché LRU
 * de índices y normalización de rutas.
 * Shared driver utilities: per-directory sorted index, LRU index cache and path normalization.
 */

/**
 * Hijos de un directorio ordenados por score DESC y mantenidos de a uno: `page()` recorta sin
 * reordenar y cada cambio se persiste con `flush`, agrupando las ráfagas.
 * A directory's children ordered by score DESC and kept one at a time: `page()` slices without
 * re-sorting and every change is persisted with `flush`, coalescing bursts.
 */
export class SortedIndex {
  /** Nombres en orden DESC. / Names in DESC order. */
  #order: string[] = [];
  /** Score vigente de cada nombre. / Current score of every name. */
  #scores = new Map<string, number>();
  /** Hay cambios sin persistir. / There are unpersisted changes. */
  #dirty = false;
  /** Persistencia diferida pendiente. / Pending deferred persistence. */
  #timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param flush - Persiste los pares ordenados / Persists the ordered pairs
   * @param delay - Espera antes de persistir, agrupando ráfagas / Wait before persisting, coalescing bursts
   */
  constructor(
    private readonly flush: (entries: [string, number][]) => Promise<void>,
    private readonly delay = 1_000
  ) { }

  /** Cantidad de hijos. / Children count. */
  get size(): number {
    return this.#order.length;
  }

  /** Pares `[nombre, score]` en orden DESC. / `[name, score]` pairs in DESC order. */
  get entries(): [string, number][] {
    return this.#order.map((name) => [name, this.#scores.get(name) ?? 0]);
  }

  /** @param entries - Pares que reemplazan el índice, ordenados una sola vez / Pairs replacing the index, sorted once */
  load(entries: Iterable<[string, number]>): void {
    const pairs = [...entries].sort((a, b) => b[1] - a[1]);
    this.#order = pairs.map(([name]) => name);
    this.#scores = new Map(pairs);
  }

  /**
   * @param offset - Desplazamiento / Offset
   * @param limit - Tamaño de página / Page size
   */
  page(offset: number, limit: number): string[] {
    return this.#order.slice(offset, offset + limit);
  }

  /**
   * @param name - Hijo a insertar o reubicar / Child to insert or relocate
   * @param score - Su score / Its score
   */
  set(name: string, score: number): void {
    this.#detach(name);
    this.#order.splice(this.#locate(score), 0, name);
    this.#scores.set(name, score);
    this.#schedule();
  }

  /** @param name - Hijo a quitar / Child to remove */
  delete(name: string): void {
    if (this.#scores.has(name)) {
      this.#detach(name);
      this.#schedule();
    }
  }

  /** Suelta el índice persistiendo lo pendiente ya: al salir del LRU la escritura diferida se perdería. / Releases the index persisting what is pending right away: leaving the LRU would lose the deferred write. */
  dispose(): void {
    this.discard();
    if (this.#dirty) {
      this.#dirty = false;
      void this.flush(this.entries).catch(() => null);
    }
  }

  /** Cancela la persistencia pendiente sin escribir, para un directorio que ya no existe. / Cancels the pending persistence without writing, for a directory that no longer exists. */
  discard(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** @param name - Hijo a sacar de la lista ordenada / Child to take out of the ordered list */
  #detach(name: string): void {
    const previous = this.#scores.get(name);
    if (previous !== undefined) {
      const start = this.#locate(previous);
      const position = this.#order.indexOf(name, start);
      if (position >= 0) this.#order.splice(position, 1);
      this.#scores.delete(name);
    }
  }

  /** @param score - Score a ubicar; devuelve la primera posición con score menor o igual / Score to place; returns the first position with a lower or equal score */
  #locate(score: number): number {
    let [low, high] = [0, this.#order.length];
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.#scores.get(this.#order[middle]!) ?? 0) > score) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /** Programa la persistencia diferida una sola vez por ráfaga. / Schedules the deferred persistence once per burst. */
  #schedule(): void {
    this.#dirty = true;
    this.#timer ??= setTimeout(() => {
      this.#timer = null;
      this.dispose();
    }, this.delay);
    this.#timer.unref?.();
  }
}

/**
 * Índices por directorio con tope LRU: al superarlo, el menos usado se suelta persistiendo lo pendiente.
 * Per-directory indexes with an LRU cap: past it, the least used one is released persisting what is pending.
 */
export class IndexCache {
  /** Índices por directorio en orden de uso. / Indexes per directory in order of use. */
  readonly #cache = new Map<string, SortedIndex>();

  /** @param limit - Directorios indexados a la vez / Directories indexed at once */
  constructor(private readonly limit = 12) { }

  /** @param key - Directorio; lo marca como recién usado / Directory; marks it as recently used */
  get(key: string): SortedIndex | undefined {
    const index = this.#cache.get(key);
    if (index) {
      this.#cache.delete(key);
      this.#cache.set(key, index);
    }
    return index;
  }

  /**
   * @param key - Directorio / Directory
   * @param index - Su índice / Its index
   */
  set(key: string, index: SortedIndex): void {
    this.#cache.set(key, index);
    while (this.#cache.size > this.limit) {
      const oldest = this.#cache.keys().next().value!;
      this.#cache.get(oldest)?.dispose();
      this.#cache.delete(oldest);
    }
  }

  /** @param key - Directorio cuyo índice y sub-árbol se descartan / Directory whose index and subtree are dropped */
  drop(key: string): void {
    [...this.#cache.keys()].filter((cached) => cached === key || cached.startsWith(`${key}/`)).forEach((cached) => {
      this.#cache.get(cached)?.discard();
      this.#cache.delete(cached);
    });
  }

  /** Vacía la caché sin persistir: el almacén ya no existe. / Clears the cache without persisting: the store is gone. */
  clear(): void {
    this.#cache.forEach((index) => index.discard());
    this.#cache.clear();
  }
}

/**
 * @param path - Ruta cruda / Raw path
 * @returns Ruta sin slashes redundantes ni en los extremos / Path without redundant or edge slashes
 */
export function normalize_path(path: string): string {
  return path.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

/**
 * @param path - Ruta a separar / Path to split
 * @returns Directorio padre y nombre del hijo / Parent directory and child name
 */
export function split_path(path: string): { parent: string; name: string } {
  const full = normalize_path(path);
  const cut = full.lastIndexOf('/');
  return cut === -1 ? { parent: '', name: full } : { parent: full.slice(0, cut), name: full.slice(cut + 1) };
}
