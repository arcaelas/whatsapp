/**
 * @file store/engine/lib/file_system/index.ts
 * @description Driver de persistencia en sistema de archivos local.
 * Local filesystem persistence driver.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Engine } from '~/lib/store/engine';
import { IndexCache, normalize_path, SortedIndex, split_path } from '~/lib/store/engine/lib';

const INDEX_FILE = 'index.json';

/** Índice de orden persistido junto a los hijos del directorio. / Ordering index persisted next to the directory children. */
const ORDER_FILE = '.order';

/** Binario del documento, guardado crudo junto a su JSON. / Document binary, stored raw next to its JSON. */
const BINARY_FILE = 'content.bin';

/**
 * Driver de persistencia en sistema de archivos.
 * Cada documento se almacena como `<base>/<path>/index.json` de modo que un recurso pueda
 * coexistir con sub-recursos anidados. Las escrituras son atómicas (tmp + rename) y el score
 * de orden viaja en el mtime del archivo.
 *
 * Para que `list`/`count` cuesten O(limit) mantiene un índice ordenado por directorio
 * (`SortedIndex`), acotado por LRU y respaldado en `<dir>/.order`: al abrir un directorio
 * carga ese archivo y sólo reconstruye con `readdir` + `stat` cuando el conteo no coincide.
 * Asume un único proceso escritor sobre el directorio base.
 *
 * Filesystem persistence driver. Each document lives at `<base>/<path>/index.json` so a
 * resource can coexist with nested sub-resources. Writes are atomic (tmp + rename) and the
 * ordering score travels in the file mtime.
 *
 * To keep `list`/`count` at O(limit) it maintains a per-directory sorted index
 * (`SortedIndex`), LRU-bounded and backed by `<dir>/.order`: opening a directory loads that
 * file and only rebuilds via `readdir` + `stat` when the count does not match. Assumes a
 * single writer process over the base directory.
 *
 * @example
 * const engine = new FileSystemEngine('/tmp/wa');
 * await engine.set('/chat/123', JSON.stringify({ name: 'John' }));
 */
export class FileSystemEngine implements Engine {
  /** @internal Índices por directorio, acotados por LRU. / Per-directory indexes, LRU-bounded. */
  private readonly _indexes: IndexCache;

  /**
   * @param _base - Directorio raíz del almacén / Store root directory
   * @param cached - Directorios indexados simultáneamente en memoria / Simultaneously in-memory indexed directories
   */
  constructor(private readonly _base: string, cached = 12) {
    this._indexes = new IndexCache(cached);
  }

  /** @internal */
  private _dir(path: string): string {
    return join(this._base, normalize_path(path));
  }

  /** @internal */
  private _file(path: string): string {
    return join(this._dir(path), INDEX_FILE);
  }

  /**
   * @internal
   * Índice del directorio: lo toma de la caché, del `.order` persistido (validando el conteo
   * contra `readdir`) o lo reconstruye leyendo el mtime de cada hijo.
   * Directory index: taken from the cache, from the persisted `.order` (validating the count
   * against `readdir`) or rebuilt reading each child's mtime.
   */
  private async _index(path: string): Promise<SortedIndex> {
    const key = normalize_path(path);
    const cached = this._indexes.get(key);
    if (cached) {
      return cached;
    }
    const dir = join(this._base, key);
    const index = new SortedIndex(async (entries) => {
      await this._write(join(dir, ORDER_FILE), entries.map(([name, score]) => `${score}\t${name}`).join('\n')).catch(() => { });
    });
    const children = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory());
    const persisted = (await readFile(join(dir, ORDER_FILE), 'utf-8').catch(() => null))
      ?.split('\n')
      .filter(Boolean)
      .map((line) => {
        const cut = line.indexOf('\t');
        return [line.slice(cut + 1), Number(line.slice(0, cut))] as [string, number];
      });
    if (persisted?.length === children.length) {
      index.load(persisted);
    } else {
      const scanned = await Promise.all(
        children.map(async (entry) => {
          const found = await stat(join(dir, entry.name, INDEX_FILE)).catch(() => null);
          return found ? ([entry.name, found.mtimeMs] as [string, number]) : null;
        })
      );
      index.load(scanned.filter((entry): entry is [string, number] => entry !== null));
    }
    this._indexes.set(key, index);
    return index;
  }

  /** @internal Escritura atómica: archivo temporal y rename sobre el destino. / Atomic write: temp file plus rename onto the target. */
  private async _write(file: string, value: string): Promise<void> {
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tmp, value, 'utf-8');
    await rename(tmp, file);
  }

  /**
   * Lee el valor de un documento.
   * Reads a document's value.
   */
  async get(path: string): Promise<string | null> {
    try {
      return await readFile(this._file(path), 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Escribe el valor de un documento de forma atómica creando los directorios necesarios;
   * con `score` fija el mtime del archivo (y por tanto el orden de `list`).
   * Atomically writes a document's value creating directories as needed; `score` fixes the
   * file mtime (and therefore `list` ordering).
   */
  async set(path: string, value: string, score?: number): Promise<void> {
    const dir = this._dir(path);
    await mkdir(dir, { recursive: true });
    const file = join(dir, INDEX_FILE);
    await this._write(file, value);
    const when = score ?? Date.now();
    if (score !== undefined) {
      await utimes(file, new Date(score), new Date(score)).catch(() => { });
    }
    const { parent, name } = split_path(path);
    this._indexes.get(parent)?.set(name, when);
  }

  /**
   * Elimina el documento y todos sus descendientes. Idempotente.
   * Deletes the document and every descendant. Idempotent.
   */
  async unset(path: string): Promise<boolean> {
    try {
      await rm(this._dir(path), { recursive: true, force: true });
    } catch {
      /* idempotent */
    }
    const { parent, name } = split_path(path);
    this._indexes.get(parent)?.delete(name);
    this._indexes.drop(normalize_path(path));
    return true;
  }

  /**
   * Lista los valores de los hijos directos, ordenados por score DESC.
   * Lists direct children values ordered by score DESC.
   */
  async list(path: string, offset = 0, limit = 50): Promise<string[]> {
    const dir = this._dir(path);
    const page = (await this._index(path)).page(offset, limit);
    const values = await Promise.all(
      page.map((name) => readFile(join(dir, name, INDEX_FILE), 'utf-8').catch(() => null))
    );
    return values.filter((value): value is string => value !== null);
  }

  /**
   * Cuenta los hijos directos que tienen un documento válido.
   * Counts direct children with a valid document.
   */
  async count(path: string): Promise<number> {
    return (await this._index(path)).size;
  }

  /**
   * Lee el binario del documento, o null si no existe.
   * Reads the document binary, or null when missing.
   */
  async get_buffer(path: string): Promise<Buffer | null> {
    return readFile(join(this._dir(path), BINARY_FILE)).catch(() => null);
  }

  /**
   * Escribe el binario del documento como archivo crudo, sin JSON ni base64.
   * Writes the document binary as a raw file, with no JSON nor base64.
   */
  async set_buffer(path: string, data: Buffer, score?: number): Promise<void> {
    const dir = this._dir(path);
    await mkdir(dir, { recursive: true });
    const file = join(dir, BINARY_FILE);
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, file);
    const when = score ?? Date.now();
    if (score !== undefined) {
      await utimes(file, new Date(score), new Date(score)).catch(() => { });
    }
    const { parent, name } = split_path(path);
    this._indexes.get(parent)?.set(name, when);
  }

  /**
   * Vacía completamente el almacén.
   * Clears the entire store.
   */
  async clear(): Promise<void> {
    try {
      await rm(this._base, { recursive: true, force: true });
    } catch {
      /* idempotent */
    }
    this._indexes.clear();
  }
}
