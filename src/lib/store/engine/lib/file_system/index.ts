/**
 * @file store/engine/lib/file_system/index.ts
 * @description Driver de persistencia en sistema de archivos local.
 * Local filesystem persistence driver.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Engine } from '~/lib/store/engine';
import { IndexCache, normalize_path, SortedIndex, split_path } from '~/lib/store/engine/lib';
import * as file from './lib/file';

/**
 * Cada documento vive en `<base>/<path>/index.json` con su score en el mtime; asume un único
 * proceso escritor sobre la base.
 * Every document lives at `<base>/<path>/index.json` with its score in the mtime; assumes a
 * single writer process over the base.
 *
 * @example
 * const engine = new FileSystemEngine('/tmp/wa');
 * await engine.set('/chat/123', JSON.stringify({ name: 'John' }));
 */
export class FileSystemEngine implements Engine {
  /** Índices ordenados por directorio, acotados por LRU. / Per-directory sorted indexes, LRU-bounded. */
  readonly #indexes: IndexCache;

  /**
   * @param base - Directorio raíz del almacén / Store root directory
   * @param cached - Directorios indexados a la vez en memoria / Directories indexed in memory at once
   */
  constructor(private readonly base: string, cached = 12) {
    this.#indexes = new IndexCache(cached);
  }

  /** @param pathname - Ruta del documento / Document path */
  #dir(pathname: string): string {
    return path.join(this.base, normalize_path(pathname));
  }

  /**
   * Índice del directorio: el de la caché, el `.order` persistido cuando su conteo coincide con
   * los hijos, o uno reconstruido con la fecha de cada hijo.
   * Directory index: the cached one, the persisted `.order` when its count matches the children,
   * or one rebuilt from each child's date.
   *
   * @param pathname - Directorio / Directory
   */
  async #index(pathname: string): Promise<SortedIndex> {
    const key = normalize_path(pathname);
    const dir = path.join(this.base, key);
    const cached = this.#indexes.get(key);
    const index = cached ?? new SortedIndex((entries) => file.write(path.join(dir, '.order'), entries.map(([name, score]) => `${score}\t${name}`).join('\n')));
    if (cached === undefined) {
      const children = (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory());
      const persisted = (await file.read(path.join(dir, '.order'), 'utf-8'))
        ?.split('\n')
        .filter(Boolean)
        .map((line) => line.split('\t'))
        .map(([score, name]) => [name, Number(score)] as [string, number]);
      index.load(persisted?.length === children.length ? persisted : (await Promise.all(
        children.map((entry) => fs.stat(path.join(dir, entry.name, 'index.json')).then((found) => [entry.name, found.mtimeMs] as [string, number], () => null))
      )).filter((entry): entry is [string, number] => entry !== null));
      this.#indexes.set(key, index);
    }
    return index;
  }

  /** @param pathname - Ruta del documento / Document path */
  async get(pathname: string): Promise<string | null> {
    return (await file.read(path.join(this.#dir(pathname), 'index.json'), 'utf-8')) ?? null;
  }

  /**
   * @param pathname - Ruta del documento / Document path
   * @param value - Contenido / Content
   * @param score - Orden en `list`; sin él, la hora de escritura / `list` order; without it, write time
   */
  async set(pathname: string, value: string, score?: number): Promise<void> {
    const { parent, name } = split_path(pathname);
    await file.write(path.join(this.#dir(pathname), 'index.json'), value, score);
    this.#indexes.get(parent)?.set(name, score ?? Date.now());
  }

  /** @param pathname - Ruta que se borra con todo su sub-árbol / Path deleted with its whole subtree */
  async unset(pathname: string): Promise<boolean> {
    const { parent, name } = split_path(pathname);
    await fs.rm(this.#dir(pathname), { recursive: true, force: true }).catch(() => null);
    this.#indexes.get(parent)?.delete(name);
    this.#indexes.drop(normalize_path(pathname));
    return true;
  }

  /**
   * @param pathname - Directorio / Directory
   * @param offset - Desplazamiento / Offset
   * @param limit - Tamaño de página / Page size
   */
  async list(pathname: string, offset = 0, limit = 50): Promise<string[]> {
    const dir = this.#dir(pathname);
    return (await Promise.all((await this.#index(pathname)).page(offset, limit).map((name) => file.read(path.join(dir, name, 'index.json'), 'utf-8'))))
      .filter((value): value is string => value !== undefined);
  }

  /** @param pathname - Directorio / Directory */
  async count(pathname: string): Promise<number> {
    return (await this.#index(pathname)).size;
  }

  /** @param pathname - Ruta del documento / Document path */
  async get_buffer(pathname: string): Promise<Buffer | null> {
    return (await file.read(path.join(this.#dir(pathname), 'content.bin'))) ?? null;
  }

  /**
   * @param pathname - Ruta del documento / Document path
   * @param data - Binario crudo, sin JSON ni base64 / Raw binary, no JSON nor base64
   * @param score - Orden en `list` / `list` order
   */
  async set_buffer(pathname: string, data: Buffer, score?: number): Promise<void> {
    const { parent, name } = split_path(pathname);
    await file.write(path.join(this.#dir(pathname), 'content.bin'), data, score);
    this.#indexes.get(parent)?.set(name, score ?? Date.now());
  }

  async clear(): Promise<void> {
    await fs.rm(this.base, { recursive: true, force: true }).catch(() => null);
    this.#indexes.clear();
  }
}
