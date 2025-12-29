import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Engine } from '../../types';

/**
 * @description
 * Implementacion de Engine que persiste datos en el sistema de archivos.
 * Los datos se guardan en `.baileys/` relativo al CWD.
 *
 * @example
 * const store = new FileStore()
 * // o con path personalizado
 * const store = new FileStore('.whatsapp-data')
 */
export class FileStore implements Engine {
    constructor(private base_path: string = '.baileys') {}

    /**
     * @description Limpia una clave para uso como path de archivo.
     * @param key Clave original.
     * @returns Path seguro para el sistema de archivos.
     */
    private _clean_key(key: string): string {
        return key.replace(/@/g, '_at_');
    }

    /**
     * @description Construye el path completo para una clave.
     * @param key Clave del documento.
     * @returns Path absoluto al archivo index.
     */
    private _build_path(key: string): string {
        const clean = this._clean_key(key);
        return join(this.base_path, clean, 'index');
    }

    async get(key: string, offset = 0, limit = 50): Promise<string[]> {
        const clean_key = this._clean_key(key);
        const base = join(this.base_path, clean_key);
        const index_path = join(base, 'index');

        try {
            const content = await readFile(index_path, 'utf-8');
            return [content];
        } catch {
            // No es documento, intentar como namespace
        }

        try {
            const entries = await readdir(base, { withFileTypes: true });
            const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

            const with_mtime: Array<{ name: string; mtime: number }> = [];
            for (const dir of dirs) {
                const file_path = join(base, dir, 'index');
                try {
                    const file_stat = await stat(file_path);
                    with_mtime.push({ name: dir, mtime: file_stat.mtimeMs });
                } catch {
                    // Archivo no existe
                }
            }

            with_mtime.sort((a, b) => b.mtime - a.mtime);
            const slice = with_mtime.slice(offset, offset + limit);

            const results: string[] = [];
            for (const { name } of slice) {
                const file_path = join(base, name, 'index');
                try {
                    const content = await readFile(file_path, 'utf-8');
                    results.push(content);
                } catch {
                    // Archivo no existe o error de lectura
                }
            }
            return results;
        } catch {
            return [];
        }
    }

    async set(key: string, value: string | null): Promise<boolean> {
        const file_path = this._build_path(key);

        if (value === null) {
            try {
                await rm(dirname(file_path), { recursive: true, force: true });
                return true;
            } catch {
                return false;
            }
        }

        try {
            await mkdir(dirname(file_path), { recursive: true });
            await writeFile(file_path, value, 'utf-8');
            return true;
        } catch {
            return false;
        }
    }
}
