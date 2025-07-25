import * as Baileys from 'baileys';
import { initAuthCreds, proto } from 'baileys';
import Store from './Store';

export default async function useCache(store: Store) {
    const creds = await store
        .document.get<Baileys.AuthenticationCreds>('creds.json')
        .then((e) => e ?? initAuthCreds());
    return {
        save: () => store.document.set('creds.json', creds),
        state: {
            creds,
            keys: {
                async get(type: string, ids: string[]) {
                    const data: any = {};
                    for (const id of ids) {
                        let value = await store.document.get<Baileys.proto.Message.AppStateSyncKeyData>(`${type}/${id}`);
                        if (value && type === 'app-state-sync-key') {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }
                    return data;
                },
                async set(data: Record<string, Record<string, any>>) {
                    const tasks: Promise<boolean>[] = [];
                    // prettier-ignore
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            tasks.push(value
                                ? store.document.set(`${category}/${id}.json`, value)
                                : store.document.delete(`${category}/${id}.json`)
                            );
                        }
                    }
                    await Promise.all(tasks);
                },
            },
        },
    };
}
