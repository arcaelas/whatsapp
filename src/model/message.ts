import * as Baileys from 'baileys';
import Base from './base';
import Chat from './chat';

export interface MessageOptions {
    /**
     * @description
     * The type of the message.
     * @default 'text'
     */
    type?: 'audio' | 'video' | 'image' | 'location';
    /**
     * @description
     * The caption for the image.
     */
    caption?: string; // images
    /**
     * @description
     * Whether the audio is a voice note.
     */
    ptt?: boolean; // audio
    /**
     * @description
     * Whether the video is a video note.
     */
    ptv?: boolean; // video‑note
    /**
     * @description
     * Whether the message is a view once message.
     */
    once?: boolean; // view‑once
}

/**
 * @module Message
 * @description
 * Represents a message in WhatsApp.
 */
export default class Message extends Base<Baileys.WAProto.IWebMessageInfo> {
    get isMe() {
        return !!this._.key.fromMe;
    }

    get role() {
        return this.isMe ? 'assistant' : 'user';
    }

    get type() {
        switch (Baileys.getContentType(this._.message!)) {
            case 'extendedTextMessage':
                return 'text';
            case 'imageMessage':
                return 'image';
            case 'audioMessage':
                return 'audio';
            case 'videoMessage':
                return 'video';
            case 'locationMessage':
                return 'location';
            default:
                return 'unknown';
        }
    }

    async content(): Promise<string | Buffer> {
        // prettier-ignore
        return this.type === 'text' ? this._.message!.extendedTextMessage!.text! : this.$.tick(async (socket)=>{
            return await Baileys.downloadMediaMessage(this._, 'buffer', {}, {
                logger: socket.logger,
                reuploadRequest: socket.updateMediaMessage,
            })
        });
    }

    /**
     * @description
     * Returns the chat associated with this message.
     * @returns Promise that resolves to the chat.
     */
    async chat() {
        // prettier-ignore
        return this.$.tick(async (_, store) => {
            return new Chat(
                this.$,
                (await store.chat.get(this._.key.remoteJid!))!
            )
        });
    }

    /**
     * @description
     * Replies to this message.
     * @param content The content to reply with.
     * @param options Additional options for the reply.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async reply(text: string, options?: { once: boolean }): Promise<boolean>;
    async reply(media: Baileys.WAMediaUpload, options: MessageOptions): Promise<boolean>;
    async reply(content: any, options?: any): Promise<boolean> {
        return this.$.tick(async (socket) => {
            // prettier-ignore
            const _options: MessageOptions = { type: 'text', ...options } as any;
            if (typeof content === 'string') {
                await socket.sendMessage(
                    this._.key.remoteJid!,
                    {
                        text: content,
                        viewOnce: _options.once || false,
                    },
                    { quoted: this._ }
                );
                return true;
            } else if (Buffer.isBuffer(content)) {
                await socket.sendMessage(
                    this._.key.remoteJid!,
                    {
                        viewOnce: _options.once || false,
                        ptv: !!(_options.type === 'video' && _options.ptv),
                        ptt: !!(_options.type === 'audio' && _options.ptt),
                        image: _options.type === 'image' ? content : undefined!,
                        audio: _options.type === 'audio' ? content : undefined!,
                        video: _options.type === 'video' ? content : undefined!,
                    },
                    { quoted: this._ }
                );
                return true;
            }
            return false;
        });
    }

    /**
     * @description
     * Marks this message as seen.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async seen(): Promise<boolean> {
        return this.$.tick(async (socket) => {
            // prettier-ignore
            await socket.chatModify({
                markRead: true,
                lastMessages: [this._],
            }, this._.key.remoteJid!);
            return true;
        });
    }

    /**
     * @description
     * Deletes this message.
     * @param forall Whether to delete for all participants.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async delete(forall: boolean = false): Promise<boolean> {
        return this.$.tick(async (socket) => {
            if (forall) {
                await socket.sendMessage(this._.key.remoteJid!, {
                    delete: this._.key,
                });
            } else {
                // prettier-ignore
                await socket.chatModify({
                    deleteForMe: {
                        key: this._.key,
                        deleteMedia: true,
                        timestamp: this._.messageTimestamp! as number,
                    },
                }, this._.key.remoteJid!);
            }
            return true;
        });
    }

    /**
     * @description
     * Likes this message.
     * @param emoji The emoji to use for the like.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async like(emoji: string): Promise<boolean> {
        return this.$.tick(async (socket) => {
            await socket.sendMessage(this._.key.remoteJid!, {
                react: { text: emoji, key: this._.key },
            });
            return true;
        });
    }

    /**
     * @description
     * Forwards this message to another chat.
     * @param chat_id The ID of the chat to forward the message to.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async forward(chat_id: string): Promise<boolean> {
        return this.$.tick(async (socket) => {
            await socket.sendMessage(chat_id!, {
                forward: { key: this._.key },
            });
            return true;
        });
    }
}
