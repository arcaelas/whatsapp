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
 * @example
 * const engine = new FileEngine('.baileys/5491112345678');
 * await engine.set('contact/123', '{"name":"John"}');
 * const data = await engine.get('contact/123');
 */
export class FileEngine implements Engine {
    constructor(private readonly _base: string = '.baileys/default') {}

    async get(key: string): Promise<string | null> {
        try {
            return await readFile(join(this._base, key.replace(/@/g, '_at_')), 'utf-8');
        } catch {
            return null;
        }
    }

    async set(key: string, value: string | null): Promise<void> {
        const path = join(this._base, key.replace(/@/g, '_at_'));
        if (value) {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, value, 'utf-8');
        } else {
            try {
                await rm(path, { force: true });
            } catch { /* file may already be deleted */ }
        }
    }

    async list(prefix: string, offset = 0, limit = 50, suffix?: string): Promise<string[]> {
        const base = join(this._base, prefix.replace(/@/g, '_at_'));
        const suffix_escaped = suffix?.replace(/@/g, '_at_');
        try {
            const items: Array<{ key: string; mtime: number }> = [];
            const entries = await readdir(base, { withFileTypes: true, recursive: true });
            for (const file of entries) {
                if (!file.isFile()) continue;
                // Compatibilidad Node < 20: parentPath puede no existir
                const parent = (file as { parentPath?: string }).parentPath || (file as { path?: string }).path || base;
                const path = join(parent, file.name);
                // Filtrar por sufijo ANTES de stat() para mejor performance
                if (suffix_escaped && !path.endsWith(suffix_escaped)) continue;
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

    async delete_prefix(prefix: string): Promise<number> {
        const base = join(this._base, prefix.replace(/@/g, '_at_'));
        try {
            await rm(base, { recursive: true, force: true });
            // Contar archivos eliminados no es posible con rm -rf, estimamos
            return 1;
        } catch {
            return 0;
        }
    }
}
