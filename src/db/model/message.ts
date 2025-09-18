import { Default, Mutate, PrimaryKey, Table, Validate } from '@arcaelas/dynamite';
import { NonAttribute } from '@arcaelas/dynamite/build/core/wrapper';
import { Chat } from './chat';

export default class Message extends Table {
    @PrimaryKey()
    id: string;

    @Default('')
    id_chat: Chat['id'];

    @Validate((role) => (['user', 'assistant', 'system', 'tool'].includes(role as string) ? true : 'Invalid role'))
    role: 'user' | 'assistant' | 'system' | 'tool';

    @Mutate((value) => {
        if (typeof value === 'string') return value;
        else if (Buffer.isBuffer(value)) return { mime: 'application/octet-stream', data: value };
        else if (typeof value === 'object' && 'mime' in value && 'data' in value) return value;
        throw new Error('Invalid content');
    })
    @Validate((content) => {
        const _content = content as string | { mime: string; data: Buffer };
        if (typeof _content === 'string') return true;
        else if (typeof _content === 'object' && 'mime' in _content && 'data' in _content) {
            return (Buffer.isBuffer(_content.data) && typeof _content.mime === 'string') as true;
        }
        return 'Invalid content';
    })
    content: string | { mime: string; data: Buffer };

    @Default(() => Date.now())
    timestamp: number;

    @belongsTo(() => Chat, 'id_chat')
    chat: NonAttribute<Chat>;
}
