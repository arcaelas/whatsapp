/**
 * @file store/driver/FileEngine.ts
 * @description Engine de persistencia en sistema de archivos local
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Engine } from '~/store/engine';

/**
 * @description
 * Engine de persistencia en sistema de archivos.
 * Almacena texto plano (JSON stringified).
 *
 * Filesystem persistence engine.
 * Stores plain text (JSON stringified).
 *
 * @example
 * const engine = new FileEngine('.baileys/5491112345678');
 * await engine.set('contact/123', '{"name":"John"}');
 * const data = await engine.get('contact/123');
 */
export class FileEngine implements Engine {
    constructor(private readonly _base: string = '.baileys/default') {}

    /** @description Obtiene un valor por su key. / Retrieves a value by its key. */
    async get(key: string): Promise<string | null> {
        try {
            return await readFile(join(this._base, key.replace(/@/g, '_at_')), 'utf-8');
        } catch {
            return null;
        }
    }

    /**
     * @description Guarda o elimina un valor. Si value es null, elimina la key como archivo y como directorio recursivamente.
     * Saves or deletes a value. If value is null, removes the key as file and as directory recursively.
     */
    async set(key: string, value: string | null): Promise<void> {
        const path = join(this._base, key.replace(/@/g, '_at_'));
        if (value) {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, value, 'utf-8');
        } else {
            try {
                await rm(path, { recursive: true, force: true });
            } catch { /* already deleted */ }
        }
    }

    /**
     * @description Lista keys bajo un prefijo, ordenados por más reciente.
     * Lists keys under a prefix, ordered by most recent.
     */
    async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
        const base = join(this._base, prefix.replace(/@/g, '_at_'));
        try {
            const items: Array<{ key: string; mtime: number }> = [];
            const entries = await readdir(base, { withFileTypes: true, recursive: true });
            for (const file of entries) {
                if (!file.isFile()) continue;
                const parent = (file as { parentPath?: string }).parentPath || (file as { path?: string }).path || base;
                const path = join(parent, file.name);
                try {
                    items.push({
                        key: path.slice(this._base.length + 1).replace(/_at_/g, '@'),
                        mtime: (await stat(path)).mtimeMs,
                    });
                } catch { /* stat may fail for transient files */ }
            }
            return items
                .sort((a, b) => b.mtime - a.mtime)
                .slice(offset, offset + limit)
                .map((f) => f.key);
        } catch {
            return [];
        }
    }
}
