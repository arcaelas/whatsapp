import { Default, PrimaryKey, Table } from '@arcaelas/dynamite';
import { NonAttribute } from '@arcaelas/dynamite/build/core/wrapper';
import Account from './account';
import Message from './message';

export default class Chat extends Table {
    @PrimaryKey()
    id: string;

    @Default(null)
    id_account: Account['id'];

    @Default('')
    name: string;

    @Default('')
    phone: string;

    @belongsTo(() => Account, 'id_account')
    account: NonAttribute<Account>;

    @hasMany(() => Message, 'id_chat')
    messages: NonAttribute<Message[]>;
}
