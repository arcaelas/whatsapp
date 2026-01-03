/**
 * @file store/driver/FileEngine.ts
 * @description Engine de persistencia en sistema de archivos local
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Engine } from '../engine';

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

    /**
     * @description Limpia caracteres problemáticos para paths.
     */
    private _sanitize(key: string): string {
        return key.replace(/@/g, '_at_');
    }

    /**
     * @description Restaura caracteres originales.
     */
    private _restore(key: string): string {
        return key.replace(/_at_/g, '@');
    }

    /**
     * @description Construye path completo.
     */
    private _path(key: string): string {
        return join(this._base, this._sanitize(key));
    }

    async get(key: string): Promise<string | null> {
        try {
            return await readFile(this._path(key), 'utf-8');
        } catch {
            return null;
        }
    }

    async set(key: string, value: string | null): Promise<void> {
        const path = this._path(key);
        if (value) {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, value, 'utf-8');
        } else {
            try {
                await rm(path, { force: true });
            } catch {}
        }
    }

    async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
        const base = this._path(prefix);
        try {
            const items: Array<{ key: string; mtime: number }> = [];
            for (const file of (await readdir(base, { withFileTypes: true, recursive: true })).filter((e) => e.isFile())) {
                try {
                    const path = join((file as { parentPath?: string }).parentPath ?? base, file.name);
                    items.push({
                        key: this._restore(path.slice(this._base.length + 1)),
                        mtime: (await stat(path)).mtimeMs,
                    });
                } catch {}
            }
            return items.sort((a, b) => b.mtime - a.mtime).slice(offset, offset + limit).map((f) => f.key);
        } catch {
            return [];
        }
    }
}
