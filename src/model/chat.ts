import * as Baileys from 'baileys';
import Base from './base';
import Message, { MessageOptions } from './message';

/**
 * @module Chat
 * @description
 * Represents a chat in WhatsApp.
 */
export default class Chat extends Base<Baileys.Chat> {
    /**
     * @description
     * Sends a text message to this chat.
     * @param text The text to send.
     * @param options Additional options for the message.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async send(text: string, options?: { once: boolean }): Promise<boolean>;
    /**
     * @description
     * Sends a media message to this chat.
     * @param media The media to send.
     * @param options Additional options for the message.
     * @returns Promise that resolves to a boolean indicating success.
     */
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
            } catch {}
            return false;
        });
    }

    /**
     * @description
     * Returns the messages in this chat.
     * @returns Promise that resolves to an array of messages.
     */
    async messages(): Promise<Message[]> {
        return await this.$.tick(async (_, store) => {
            const messages: Message[] = [];
            const keys = await store.engine.match(`chat/${this._.id}/message/*/index`);
            for (const key of keys) {
                const [, , id] = key.match(/chat\/[^/]+\/message\/([^/]+)/)!;
                messages.push(new Message(this.$, (await store.message.get(id))!));
            }
            return messages;
        });
    }

    /**
     * @description
     * Pins this chat.
     * @returns Promise that resolves to a boolean indicating success.
     */
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

    /**
     * @description
     * Marks this chat as seen.
     * @returns Promise that resolves to a boolean indicating success.
     */
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

    /**
     * @description
     * Mutes this chat.
     * @param time The time to mute for.
     * @returns Promise that resolves to a boolean indicating success.
     */
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

    /**
     * @description
     * Updates the presence of this chat.
     * @param status The status to update to.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async presence(status: Baileys.WAPresence): Promise<boolean> {
        return await this.$.tick(async (socket) => {
            await socket.sendPresenceUpdate(status, this._.id);
            return true;
        });
    }

    /**
     * @description
     * Deletes this chat.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async delete(): Promise<boolean> {
        return this.$.tick(async (socket) => {
            await socket.chatModify(
                {
                    delete: true,
                    lastMessages: [this._.messages![this._.messages!.length - 1].message!],
                },
                this._.id
            );
            return true;
        });
    }
}
