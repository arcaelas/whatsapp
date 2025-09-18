import { Default, PrimaryKey, Table } from '@arcaelas/dynamite';
import { CreationOptional } from '@arcaelas/dynamite/build/core/wrapper';

export default class Tag extends Table {
    @PrimaryKey()
    id: CreationOptional<string>;

    @Default('')
    name: string;
}
