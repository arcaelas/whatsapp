import { BufferJSON } from 'baileys';
import type { IChat } from '../Chat';
import type { IContact } from '../Contact';
import type { IMessage } from '../Message';
import type { Engine } from '../types';

export { FileStore } from './driver/FileStore';

/**
 * @description
 * Clase interna que envuelve el Engine y expone metodos tipados.
 * El usuario no interactua directamente con Store.
 */
export default class Store {
    constructor(private engine: Engine) {}

    document = {
        get: async <T>(key: string, offset?: number, limit?: number): Promise<T[]> => {
            const items = await this.engine.get(key, offset, limit);
            return items.map((raw) => JSON.parse(raw, BufferJSON.reviver));
        },
        set: async (key: string, value: unknown): Promise<boolean> => {
            const json = value === null ? null : JSON.stringify(value, BufferJSON.replacer);
            return await this.engine.set(key, json);
        },
    };

    contact = {
        get: async (id: string): Promise<IContact | null> => {
            const [item] = await this.document.get<IContact>(`contact/${id}`);
            return item ?? null;
        },
        find: async (offset: number, limit: number): Promise<IContact[]> => {
            return await this.document.get<IContact>('contact', offset, limit);
        },
        set: async (data: IContact): Promise<boolean> => {
            return await this.document.set(`contact/${data.id}`, data);
        },
    };

    chat = {
        get: async (id: string): Promise<IChat | null> => {
            const [item] = await this.document.get<IChat>(`chat/${id}`);
            return item ?? null;
        },
        find: async (offset: number, limit: number): Promise<IChat[]> => {
            return await this.document.get<IChat>('chat', offset, limit);
        },
        set: async (data: IChat): Promise<boolean> => {
            return await this.document.set(`chat/${data.id}`, data);
        },
        delete: async (id: string): Promise<boolean> => {
            return await this.document.set(`chat/${id}`, null);
        },
    };

    message = {
        get: async (cid: string, mid: string): Promise<IMessage | null> => {
            const [item] = await this.document.get<IMessage>(`chat/${cid}/message/${mid}`);
            return item ?? null;
        },
        find: async (cid: string, offset: number, limit: number): Promise<IMessage[]> => {
            return await this.document.get<IMessage>(`chat/${cid}/message`, offset, limit);
        },
        set: async (data: IMessage): Promise<boolean> => {
            return await this.document.set(`chat/${data.cid}/message/${data.id}`, data);
        },
        delete: async (cid: string, mid: string): Promise<boolean> => {
            await this.document.set(`chat/${cid}/message/${mid}/content`, null);
            return await this.document.set(`chat/${cid}/message/${mid}`, null);
        },
    };

    content = {
        get: async (cid: string, mid: string): Promise<Buffer | null> => {
            const [item] = await this.document.get<Buffer>(`chat/${cid}/message/${mid}/content`);
            return item ?? null;
        },
        set: async (cid: string, mid: string, value: Buffer): Promise<boolean> => {
            return await this.document.set(`chat/${cid}/message/${mid}/content`, value);
        },
    };
}
