import * as Baileys from 'baileys';
import Base from './base';
import Message, { MessageOptions } from './message';

/**
 * @module Chat
 * @description
 * Represents a chat in WhatsApp.
 */
export default class Chat extends Base<Baileys.Chat> {
    get raw() {
        return this._;
    }

    get id() {
        return this.raw.id!;
    }

    /**
     * @description
     * Returns the messages in this chat.
     * @returns Promise that resolves to an array of messages.
     */
    async messages(): Promise<Message[]> {
        return await this.$.tick(async (release, _, store) => {
            const messages: Message[] = [];
            const keys = await store.engine.match(`chat/${this.id}/message/*/index`);
            for (const key of keys) {
                const [, , id] = key.match(/chat\/[^/]+\/message\/([^/]+)/)!;
                messages.push(new Message(this.$, (await store.message.get(id))!));
            }
            release();
            return messages;
        });
    }

    /**
     * @description
     * Sends a text message to this chat.
     * @param text The text to send.
     * @param options Additional options for the message.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async send(text: string, options?: { once: boolean }): Promise<Message | null>;
    /**
     * @description
     * Sends a media message to this chat.
     * @param media The media to send.
     * @param options Additional options for the message.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async send(media: Baileys.WAMediaUpload, options: MessageOptions): Promise<Message | null>;
    async send(content: string | Baileys.WAMediaUpload, options?: any): Promise<Message | null> {
        return this.$.tick(async (release, socket) => {
            let m: Baileys.WAProto.IWebMessageInfo | undefined;
            const _options: MessageOptions = { type: 'text', ...options } as any;
            try {
                if (typeof content === 'string') {
                    m = await socket.sendMessage(this.id, {
                        text: content,
                        viewOnce: _options.once || false,
                    });
                } else if (Buffer.isBuffer(content)) {
                    m = await socket.sendMessage(this.id, {
                        viewOnce: _options.once || false,
                        ptv: !!(_options.type === 'video' && _options.ptv),
                        ptt: !!(_options.type === 'audio' && _options.ptt),
                        image: _options.type === 'image' ? content : undefined!,
                        audio: _options.type === 'audio' ? content : undefined!,
                        video: _options.type === 'video' ? content : undefined!,
                    });
                }
            } finally {
                release();
            }
            return m ? new Message(this.$, m!) : null;
        });
    }

    /**
     * @description
     * Updates the presence of this chat.
     * @param status The status to update to.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async presence(status: Baileys.WAPresence): Promise<boolean> {
        return await this.$.tick(async (release, socket) => {
            try {
                await socket.sendPresenceUpdate(status, this.id);
                return true;
            } catch {
                return false;
            } finally {
                release();
            }
        });
    }

    /**
     * @description
     * Updates the typing status of this chat.
     * @param on Whether to start or stop typing.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async typing(on: boolean = true) {
        return await this.presence(on ? 'composing' : 'available');
    }

    /**
     * @description
     * Updates the recording status of this chat.
     * @param on Whether to start or stop recording.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async recording(on: boolean = true) {
        return await this.presence(on ? 'recording' : 'available');
    }
}
