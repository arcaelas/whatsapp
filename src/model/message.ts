import * as Baileys from 'baileys';
import Base from './base';
import Chat from './chat';

type LikeEmoji = '👍' | '❤️' | '😂' | '😮' | '😢' | '👎' | '👌' | '🙏' | '👏' | '👏';

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
    get raw() {
        return this._;
    }
    get isMe() {
        return !!this.raw.key.fromMe;
    }

    get role() {
        return this.isMe ? 'assistant' : 'user';
    }

    get author() {
        const phone = this.raw.key.remoteJid?.split('@')[0] ?? null;
        return {
            id: this.raw.key.remoteJid!,
            name: this.raw.key.fromMe ? 'me' : this.raw.key.participant! || this.raw.pushName || phone,
            phone,
        };
    }

    get type() {
        switch (Baileys.getContentType(this.raw.message!)) {
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
        return this.type === 'text' ? this.raw.message!.extendedTextMessage!.text! : this.$.tick(async (release, socket)=>{
            return await Baileys.downloadMediaMessage(this.raw, 'buffer', {}, {
                logger: socket.logger,
                reuploadRequest: socket.updateMediaMessage,
            }).finally(() => release());
        });
    }

    /**
     * @description
     * Returns the chat associated with this message.
     * @returns Promise that resolves to the chat.
     */
    async chat() {
        // prettier-ignore
        return this.$.tick(async (release, _, store) => {
            return new Chat(
                this.$,
                (await store.chat.get(this.raw.key.remoteJid!).finally(() => release()))!
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
    async reply(text: string, options?: { once: boolean }): Promise<Message | null>;
    async reply(media: Baileys.WAMediaUpload, options: MessageOptions): Promise<Message | null>;
    async reply(content: any, options?: any): Promise<Message | null> {
        return this.$.tick(async (release, socket) => {
            let m: Baileys.WAProto.IWebMessageInfo | undefined;
            const _options: MessageOptions = { type: 'text', ...options } as any;
            // prettier-ignore
            if (typeof content === 'string') {
                m = await socket.sendMessage(
                    this.raw.key.remoteJid!,
                    {
                        text: content,
                        viewOnce: _options.once || false,
                    },
                    { quoted: this.raw }
                );
            } else if (Buffer.isBuffer(content)) {
                m = await socket.sendMessage(
                    this.raw.key.remoteJid!,
                    {
                        viewOnce: _options.once || false,
                        ptv: !!(_options.type === 'video' && _options.ptv),
                        ptt: !!(_options.type === 'audio' && _options.ptt),
                        image: _options.type === 'image' ? content : undefined!,
                        audio: _options.type === 'audio' ? content : undefined!,
                        video: _options.type === 'video' ? content : undefined!,
                    },
                    { quoted: this.raw }
                );
            }
            release();
            return m ? new Message(this.$, m!) : null;
        });
    }

    /**
     * @description
     * Deletes this message.
     * @param forall Whether to delete for all participants.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async delete(forall: boolean = false): Promise<boolean> {
        return this.$.tick(async (release, socket) => {
            if (forall) {
                await socket.sendMessage(this.raw.key.remoteJid!, {
                    delete: this.raw.key,
                });
            } else {
                // prettier-ignore
                await socket.chatModify({
                    deleteForMe: {
                        key: this.raw.key,
                        deleteMedia: this.type !== 'text',
                        timestamp: this.raw.messageTimestamp! as number,
                    },
                }, this.raw.key.remoteJid!);
            }
            release();
            return true;
        });
    }

    /**
     * @description
     * Likes this message.
     * @param emoji The emoji to use for the like.
     * @returns Promise that resolves to a boolean indicating success.
     */
    async like(emoji: LikeEmoji): Promise<boolean> {
        return this.$.tick(async (release, socket) => {
            await socket.sendMessage(this.raw.key.remoteJid!, {
                react: { text: emoji, key: this.raw.key },
            });
            release();
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
        return this.$.tick(async (release, socket) => {
            await socket.sendMessage(chat_id!, {
                forward: { key: this.raw.key },
            });
            release();
            return true;
        });
    }
}
