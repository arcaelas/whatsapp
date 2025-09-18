import Dynamite from '@arcaelas/dynamite';
import Account from './model/account';
import Chat from './model/chat';
import Message from './model/message';
import Tag from './model/tag';

export { default as Account } from './model/account';
export { default as Chat } from './model/chat';
export { default as Message } from './model/message';
export { default as Tag } from './model/tag';

export default new Dynamite({
    region: 'local',
    endpoint: 'http://localhost:8000',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    tables: [Account, Chat, Message, Tag],
});
