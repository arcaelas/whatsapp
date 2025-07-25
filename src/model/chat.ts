import * as Baileys from 'baileys';
import Base from './base';
import Message, { MessageOptions } from './message';

export default class Chat extends Base<Baileys.Chat> {

    async send(text: string, options?: { once: boolean }): Promise<boolean>;
    async send(media: Baileys.WAMediaUpload, options: MessageOptions): Promise<boolean>;
    async send(content: string | Baileys.WAMediaUpload, options?: any): Promise<boolean> {
        return this.$.tick(async (socket) => {
            try {
                const _options: MessageOptions = { type: 'text', ...options } as any;
                if (typeof content === 'string') {
                    await socket.sendMessage(this._.id, {
                        text: content,
                        viewOnce: _options.once || false,
                    });
                    return true;
                } else if (Buffer.isBuffer(content)) {
                    await socket.sendMessage(this._.id, {
                        viewOnce: _options.once || false,
                        ptv: !!(_options.type === 'video' && _options.ptv),
                        ptt: !!(_options.type === 'audio' && _options.ptt),
                        image: _options.type === 'image' ? content : undefined!,
                        audio: _options.type === 'audio' ? content : undefined!,
                        video: _options.type === 'video' ? content : undefined!,
                    });
                    return true;
                }
            } catch { }
            return false;
        });
    }

    async messages(): Promise<Message[]> {
        return await this.$.tick(async (_, store) => {
            const messages: Message[] = [];
            if (store.engine.scan!) {
                for (const key of await store.engine.scan!(`chat/${this._.id}/message/*`)) {
                    const id = key.slice(`chat/${this._.id}/message/`.length);
                    messages.push(new Message(this.$, (await store.message.get(id))!));
                }
            } else {
                for await (const key of store.engine.keys()) {
                    if (key.startsWith(`chat/${this._.id}/message/`)) {
                        const id = key.slice(`chat/${this._.id}/message/`.length);
                        messages.push(new Message(this.$, (await store.message.get(id))!));
                    }
                }
            }
            return messages;
        });
    }

    async pin(): Promise<boolean> {
        return await this.$.tick(async (socket) => {
            // prettier-ignore
            await socket.chatModify({
                pin: true,
                lastMessages: [this._.messages![this._.messages!.length - 1].message!],
            }, this._.id);
            return true;
        });
    }

    async seen(): Promise<boolean> {
        return await this.$.tick(async (socket) => {
            // prettier-ignore
            await socket.chatModify({
                markRead: true,
                lastMessages: [this._.messages![this._.messages!.length - 1].message!],
            }, this._.id);
            return true;
        });
    }

    async mute(time: number = 0): Promise<boolean> {
        return await this.$.tick(async (socket) => {
            // prettier-ignore
            await socket.chatModify({
                mute: time || null,
                lastMessages: [this._.messages![this._.messages!.length - 1].message!],
            }, this._.id);
            return true;
        });
    }

    async presence(status: Baileys.WAPresence): Promise<boolean> {
        return await this.$.tick(async (socket) => {
            await socket.sendPresenceUpdate(status, this._.id);
            return true;
        });
    }

    async delete(): Promise<boolean> {
        return this.$.tick(async (socket) => {
            await socket.chatModify({
                delete: true,
                lastMessages: [this._.messages![this._.messages!.length - 1].message!],
            }, this._.id);
            return true;
        });
    }
}
