/**
 * @file store/engine/lib/file_system/index.ts
 * @description Driver de persistencia en sistema de archivos local.
 * Local filesystem persistence driver.
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Engine } from '~/lib/store/engine';

const INDEX_FILE = 'index.json';

/**
 * Normaliza un path colapsando slashes redundantes.
 * Normalizes a path by collapsing redundant slashes.
 */
function normalize_path(path: string): string {
  return path.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

/**
 * Driver de persistencia en sistema de archivos.
 * Cada documento se almacena como `<base>/<path>/index.json` de modo que un recurso pueda
 * coexistir con sub-recursos anidados.
 *
 * Filesystem persistence driver. Each document lives at `<base>/<path>/index.json` so a
 * resource can coexist with nested sub-resources.
 *
 * @example
 * const engine = new FileSystemEngine('/tmp/wa');
 * await engine.set('/chat/123', JSON.stringify({ name: 'John' }));
 */
export class FileSystemEngine implements Engine {
  constructor(private readonly _base: string) { }

  /** @internal */
  private _dir(path: string): string {
    return join(this._base, normalize_path(path));
  }

  /** @internal */
  private _file(path: string): string {
    return join(this._dir(path), INDEX_FILE);
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
   * Escribe el valor de un documento, creando los directorios necesarios.
   * Writes a document's value, creating directories as needed.
   */
  async set(path: string, value: string): Promise<void> {
    const dir = this._dir(path);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, INDEX_FILE), value, 'utf-8');
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
    return true;
  }

  /**
   * Lista los valores de los hijos directos, ordenados por mtime DESC.
   * Lists direct children values ordered by mtime DESC.
   */
  async list(path: string, offset = 0, limit = 50): Promise<string[]> {
    const dir = this._dir(path);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const stats = await Promise.all(
        entries
          .filter((e) => e.isDirectory())
          .map(async (entry) => {
            const file = join(dir, entry.name, INDEX_FILE);
            try {
              const st = await stat(file);
              return { file, mtime: st.mtimeMs };
            } catch {
              return null;
            }
          })
      );

      const valid = stats.filter((x): x is { file: string; mtime: number } => x !== null);
      valid.sort((a, b) => b.mtime - a.mtime);
      const page = valid.slice(offset, offset + limit);

      const values = await Promise.all(
        page.map(async ({ file }) => {
          try {
            return await readFile(file, 'utf-8');
          } catch {
            return null;
          }
        })
      );

      const result: string[] = [];
      for (const value of values) {
        if (value !== null) {
          result.push(value);
        }
      }
      return result;
    } catch {
      return [];
    }
  }

  /**
   * Cuenta los hijos directos que tienen un documento válido.
   * Counts direct children with a valid document.
   */
  async count(path: string): Promise<number> {
    const dir = this._dir(path);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      let total = 0;
      await Promise.all(
        entries
          .filter((e) => e.isDirectory())
          .map(async (entry) => {
            try {
              await stat(join(dir, entry.name, INDEX_FILE));
              total++;
            } catch {
              /* not a valid child doc */
            }
          })
      );
      return total;
    } catch {
      return 0;
    }
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
  }
}
