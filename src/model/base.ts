import { Noop } from '@arcaelas/utils';
import * as Baileys from 'baileys';
import WhatsApp from 'src';

type Serialize<T> = { [K in keyof T as T[K] extends Noop ? never : K]: T[K] };

export default class Base<T> {
    constructor(protected readonly $: WhatsApp<'code' | 'qr'>, protected readonly _: Serialize<T>) { }
    toJSON() {
        const o: any = {};
        for (const k in this) {
            if (typeof this[k] === 'function') continue;
            o[k] = this[k];
        }
        return o;
    }
    toString() {
        return JSON.stringify(this.toJSON(), Baileys.BufferJSON.replacer);
    }
}
