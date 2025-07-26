import { Noop } from '@arcaelas/utils';
import * as Baileys from 'baileys';
import WhatsApp from '..';

type Serialize<T> = { [K in keyof T as T[K] extends Noop ? never : K]: T[K] };

/**
 * @module Base
 * @description
 * Base class for WhatsApp entities.
 */
export default class Base<T> {
    constructor(protected readonly $: WhatsApp, protected readonly _: Serialize<T>) {}
    /**
     * @description
     * Returns a JSON representation of this entity.
     * @returns A JSON representation of this entity.
     */
    toJSON() {
        return this._;
    }
    /**
     * @description
     * Returns a string representation of this entity.
     * @returns A string representation of this entity.
     */
    toString() {
        return JSON.stringify(this.toJSON(), Baileys.BufferJSON.replacer);
    }
}
