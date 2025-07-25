import * as Baileys from 'baileys';
import Base from './base';
import Chat from './chat';

export interface MessageOptions {
    type?: 'audio' | 'video' | 'image' | 'location';
    caption?: string; // images
    ptt?: boolean; // audio
    ptv?: boolean; // video‑note
    once?: boolean; // view‑once
}

export default class Message extends Base<Baileys.WAProto.IWebMessageInfo> {
    async chat() {
        // prettier-ignore
        return this.$.tick(async (_, store) => {
            return new Chat(
                this.$,
                (await store.chat.get(this._.key.remoteJid!))!
            )
        });
    }

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

    async like(emoji: string): Promise<boolean> {
        return this.$.tick(async (socket) => {
            await socket.sendMessage(this._.key.remoteJid!, {
                react: { text: emoji, key: this._.key },
            });
            return true;
        });
    }

    async forward(chat_id: string): Promise<boolean> {
        return this.$.tick(async (socket) => {
            await socket.sendMessage(chat_id!, {
                forward: { key: this._.key },
            });
            return true;
        });
    }
}
