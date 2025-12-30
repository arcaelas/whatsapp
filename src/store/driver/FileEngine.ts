import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BufferJSON } from 'baileys';
import type { IChat } from '../../Chat';
import type { IContact } from '../../Contact';
import type { IMessage } from '../../Message';
import { Engine } from '../engine';

/**
 * @description
 * Engine de persistencia en sistema de archivos.
 *
 * Estructura:
 * ```
 * {base}/
 *   session/{key}/index         → JSON (BufferJSON)
 *   contact/{id}/index          → JSON
 *   chat/{cid}/
 *     index                     → JSON del chat
 *     message/
 *       index                   → "MID TIMESTAMP\n" por línea
 *       {mid}/
 *         index                 → JSON del mensaje
 *         content               → Buffer binario
 * ```
 *
 * @example
 * const engine = new FileEngine('.baileys/5491112345678');
 * const wa = new WhatsApp({ engine });
 */
export class FileEngine extends Engine {
    constructor(private _base: string = '.baileys/default') {
        super();
    }

    /**
     * @description Limpia caracteres problemáticos para paths.
     */
    private _clean(key: string): string {
        return key.replace(/@/g, '_at_');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Session
    // ─────────────────────────────────────────────────────────────────────────

    async session<T = unknown>(key: string): Promise<T | null>;
    async session<T = unknown>(key: string, data: T | null): Promise<boolean>;
    async session<T = unknown>(key: string, ...args: [T | null] | []): Promise<T | null | boolean> {
        const path = join(this._base, 'session', this._clean(key), 'index');
        if (args.length === 0) {
            try {
                const content = await readFile(path, 'utf-8');
                return JSON.parse(content, BufferJSON.reviver);
            } catch {
                return null;
            }
        }
        const [data] = args;
        if (data === null) {
            try {
                await rm(dirname(path), { recursive: true, force: true });
            } catch {}
            return true;
        }
        try {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify(data, BufferJSON.replacer), 'utf-8');
            return true;
        } catch {
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Contact
    // ─────────────────────────────────────────────────────────────────────────

    async contact(id: string): Promise<IContact | null>;
    async contact(id: string, data: IContact | null): Promise<boolean>;
    async contact(id: string, ...args: [IContact | null] | []): Promise<IContact | null | boolean> {
        const path = join(this._base, 'contact', this._clean(id), 'index');
        if (args.length === 0) {
            try {
                const content = await readFile(path, 'utf-8');
                return JSON.parse(content);
            } catch {
                return null;
            }
        }
        const [data] = args;
        if (data === null) {
            try {
                await rm(dirname(path), { recursive: true, force: true });
            } catch {}
            return true;
        }
        try {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify(data), 'utf-8');
            return true;
        } catch {
            return false;
        }
    }

    async contacts(offset = 0, limit = 50): Promise<IContact[]> {
        const base = join(this._base, 'contact');
        try {
            const entries = await readdir(base, { withFileTypes: true });
            const dirs = entries.filter((e) => e.isDirectory());
            const with_mtime: Array<{ name: string; mtime: number }> = [];
            for (const dir of dirs) {
                try {
                    const file_stat = await stat(join(base, dir.name, 'index'));
                    with_mtime.push({ name: dir.name, mtime: file_stat.mtimeMs });
                } catch {}
            }
            with_mtime.sort((a, b) => b.mtime - a.mtime);
            const slice = with_mtime.slice(offset, offset + limit);
            const results: IContact[] = [];
            for (const { name } of slice) {
                try {
                    const content = await readFile(join(base, name, 'index'), 'utf-8');
                    results.push(JSON.parse(content));
                } catch {}
            }
            return results;
        } catch {
            return [];
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Chat
    // ─────────────────────────────────────────────────────────────────────────

    async chat(id: string): Promise<IChat | null>;
    async chat(id: string, data: IChat | null): Promise<boolean>;
    async chat(id: string, ...args: [IChat | null] | []): Promise<IChat | null | boolean> {
        const path = join(this._base, 'chat', this._clean(id), 'index');
        if (args.length === 0) {
            try {
                const content = await readFile(path, 'utf-8');
                return JSON.parse(content);
            } catch {
                return null;
            }
        }
        const [data] = args;
        if (data === null) {
            try {
                await rm(dirname(path), { recursive: true, force: true });
            } catch {}
            return true;
        }
        try {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify(data), 'utf-8');
            return true;
        } catch {
            return false;
        }
    }

    async chats(offset = 0, limit = 50): Promise<IChat[]> {
        const base = join(this._base, 'chat');
        try {
            const entries = await readdir(base, { withFileTypes: true });
            const dirs = entries.filter((e) => e.isDirectory());
            const with_mtime: Array<{ name: string; mtime: number }> = [];
            for (const dir of dirs) {
                try {
                    const file_stat = await stat(join(base, dir.name, 'index'));
                    with_mtime.push({ name: dir.name, mtime: file_stat.mtimeMs });
                } catch {}
            }
            with_mtime.sort((a, b) => b.mtime - a.mtime);
            const slice = with_mtime.slice(offset, offset + limit);
            const results: IChat[] = [];
            for (const { name } of slice) {
                try {
                    const content = await readFile(join(base, name, 'index'), 'utf-8');
                    results.push(JSON.parse(content));
                } catch {}
            }
            return results;
        } catch {
            return [];
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Message
    // ─────────────────────────────────────────────────────────────────────────

    async message(cid: string, mid: string): Promise<IMessage | null>;
    async message(cid: string, mid: string, data: IMessage | null): Promise<boolean>;
    async message(cid: string, mid: string, ...args: [IMessage | null] | []): Promise<IMessage | null | boolean> {
        const clean_cid = this._clean(cid);
        const clean_mid = this._clean(mid);
        const msg_path = join(this._base, 'chat', clean_cid, 'message', clean_mid, 'index');
        const idx_path = join(this._base, 'chat', clean_cid, 'message', 'index');

        if (args.length === 0) {
            try {
                const content = await readFile(msg_path, 'utf-8');
                return JSON.parse(content);
            } catch {
                return null;
            }
        }

        const [data] = args;
        if (data === null) {
            try {
                await rm(dirname(msg_path), { recursive: true, force: true });
                const idx = await this._read_message_index(idx_path);
                const filtered = idx.filter((e) => e.mid !== mid);
                await this._write_message_index(idx_path, filtered);
            } catch {}
            return true;
        }

        try {
            await mkdir(dirname(msg_path), { recursive: true });
            await writeFile(msg_path, JSON.stringify(data), 'utf-8');
            const idx = await this._read_message_index(idx_path);
            if (!idx.some((e) => e.mid === mid)) {
                idx.push({ mid, timestamp: data.created_at });
                idx.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
                await this._write_message_index(idx_path, idx);
            }
            return true;
        } catch {
            return false;
        }
    }

    async messages(cid: string, offset = 0, limit = 20): Promise<IMessage[]> {
        const clean_cid = this._clean(cid);
        const idx_path = join(this._base, 'chat', clean_cid, 'message', 'index');
        const base = join(this._base, 'chat', clean_cid, 'message');

        try {
            const idx = await this._read_message_index(idx_path);
            const slice = idx.slice(offset, offset + limit);
            const results: IMessage[] = [];
            for (const { mid } of slice) {
                try {
                    const content = await readFile(join(base, this._clean(mid), 'index'), 'utf-8');
                    results.push(JSON.parse(content));
                } catch {}
            }
            return results;
        } catch {
            return [];
        }
    }

    private async _read_message_index(path: string): Promise<Array<{ mid: string; timestamp: string }>> {
        try {
            const content = await readFile(path, 'utf-8');
            return content
                .split('\n')
                .filter((line) => line.trim())
                .map((line) => {
                    const [mid, timestamp] = line.split(' ');
                    return { mid, timestamp };
                });
        } catch {
            return [];
        }
    }

    private async _write_message_index(path: string, entries: Array<{ mid: string; timestamp: string }>): Promise<void> {
        await mkdir(dirname(path), { recursive: true });
        const content = entries.map((e) => `${e.mid} ${e.timestamp}`).join('\n');
        await writeFile(path, content, 'utf-8');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Content
    // ─────────────────────────────────────────────────────────────────────────

    async content(cid: string, mid: string): Promise<Buffer | null>;
    async content(cid: string, mid: string, data: Buffer | null): Promise<boolean>;
    async content(cid: string, mid: string, ...args: [Buffer | null] | []): Promise<Buffer | null | boolean> {
        const path = join(this._base, 'chat', this._clean(cid), 'message', this._clean(mid), 'content');

        if (args.length === 0) {
            try {
                return await readFile(path);
            } catch {
                return null;
            }
        }

        const [data] = args;
        if (data === null) {
            try {
                await rm(path, { force: true });
            } catch {}
            return true;
        }

        try {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, data);
            return true;
        } catch {
            return false;
        }
    }
}
