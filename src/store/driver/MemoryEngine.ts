import type { IChat } from '../../Chat';
import type { IContact } from '../../Contact';
import type { IMessage } from '../../Message';
import { Engine } from '../engine';

/**
 * @description
 * Engine de memoria para almacenamiento temporal.
 * Ideal para testing y bots efímeros donde no se requiere persistencia.
 * Los datos se pierden al cerrar la aplicación.
 *
 * @example
 * const engine = new MemoryEngine();
 * const wa = new WhatsApp({ engine });
 */
export class MemoryEngine extends Engine {
    private _session = new Map<string, unknown>();
    private _contacts = new Map<string, IContact>();
    private _chats = new Map<string, {
        data: IChat;
        messages: Map<string, { data: IMessage; content: Buffer | null }>;
    }>();

    // ─────────────────────────────────────────────────────────────────────────
    // Session
    // ─────────────────────────────────────────────────────────────────────────

    async session<T = unknown>(key: string): Promise<T | null>;
    async session<T = unknown>(key: string, data: T | null): Promise<boolean>;
    async session<T = unknown>(key: string, ...args: [T | null] | []): Promise<T | null | boolean> {
        if (args.length === 0) return (this._session.get(key) as T) ?? null;
        const [data] = args;
        if (data === null) {
            this._session.delete(key);
        } else {
            this._session.set(key, data);
        }
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Contact
    // ─────────────────────────────────────────────────────────────────────────

    async contact(id: string): Promise<IContact | null>;
    async contact(id: string, data: IContact | null): Promise<boolean>;
    async contact(id: string, ...args: [IContact | null] | []): Promise<IContact | null | boolean> {
        if (args.length === 0) return this._contacts.get(id) ?? null;
        const [data] = args;
        if (data === null) {
            this._contacts.delete(id);
        } else {
            this._contacts.delete(id);
            this._contacts.set(id, data);
        }
        return true;
    }

    async contacts(offset = 0, limit = 50): Promise<IContact[]> {
        return [...this._contacts.values()].reverse().slice(offset, offset + limit);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Chat
    // ─────────────────────────────────────────────────────────────────────────

    async chat(id: string): Promise<IChat | null>;
    async chat(id: string, data: IChat | null): Promise<boolean>;
    async chat(id: string, ...args: [IChat | null] | []): Promise<IChat | null | boolean> {
        if (args.length === 0) return this._chats.get(id)?.data ?? null;
        const [data] = args;
        if (data === null) {
            this._chats.delete(id);
        } else if (this._chats.has(id)) {
            this._chats.get(id)!.data = data;
        } else {
            this._chats.set(id, { data, messages: new Map() });
        }
        return true;
    }

    async chats(offset = 0, limit = 50): Promise<IChat[]> {
        return [...this._chats.values()].map((c) => c.data).reverse().slice(offset, offset + limit);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Message
    // ─────────────────────────────────────────────────────────────────────────

    async message(cid: string, mid: string): Promise<IMessage | null>;
    async message(cid: string, mid: string, data: IMessage | null): Promise<boolean>;
    async message(cid: string, mid: string, ...args: [IMessage | null] | []): Promise<IMessage | null | boolean> {
        const chat = this._chats.get(cid);
        if (args.length === 0) return chat?.messages.get(mid)?.data ?? null;
        const [data] = args;
        if (data === null) {
            chat?.messages.delete(mid);
        } else if (chat) {
            const existing = chat.messages.get(mid);
            if (existing) {
                existing.data = data;
            } else {
                chat.messages.set(mid, { data, content: null });
            }
        } else {
            this._chats.set(cid, {
                data: { id: cid, name: cid.split('@')[0], photo: null, phone: cid.split('@')[0], type: cid.endsWith('@g.us') ? 'group' : 'contact' },
                messages: new Map([[mid, { data, content: null }]]),
            });
        }
        return true;
    }

    async messages(cid: string, offset = 0, limit = 20): Promise<IMessage[]> {
        const chat = this._chats.get(cid);
        if (!chat) return [];
        return [...chat.messages.values()]
            .map((m) => m.data)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(offset, offset + limit);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Content
    // ─────────────────────────────────────────────────────────────────────────

    async content(cid: string, mid: string): Promise<Buffer | null>;
    async content(cid: string, mid: string, data: Buffer | null): Promise<boolean>;
    async content(cid: string, mid: string, ...args: [Buffer | null] | []): Promise<Buffer | null | boolean> {
        const chat = this._chats.get(cid);
        const message = chat?.messages.get(mid);
        if (args.length === 0) return message?.content ?? null;
        const [data] = args;
        if (message) message.content = data;
        return true;
    }
}
