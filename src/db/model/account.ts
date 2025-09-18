import { Default, PrimaryKey, Table } from '@arcaelas/dynamite';
import { NonAttribute } from '@arcaelas/dynamite/build/core/wrapper';
import Chat from './chat';

export default class Account extends Table implements Account {
    @PrimaryKey()
    id: string;

    @Default('active')
    status: 'active' | 'inactive';

    @Default('')
    name: string;

    @Default('')
    phone: string;

    @hasMany(() => Chat, 'id_account')
    chats: NonAttribute<Chat[]>;
}
