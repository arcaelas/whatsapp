import * as Baileys from 'baileys';
import Base from './base';

export default class Contact extends Base<Baileys.Contact> {
    get raw() {
        return this._;
    }
    get id() {
        return this.raw.id;
    }
    get name() {
        return this.raw.name || this.raw.verifiedName || this.raw.id.split('@')[0];
    }
    get phone() {
        return this.raw.id.split('@')[0];
    }
}
