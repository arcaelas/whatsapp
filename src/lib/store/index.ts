/**
 * @file store/index.ts
 * @description Barrel del módulo store: el contrato Engine con sus drivers y las operaciones que
 * toda entidad hace contra él.
 * Store module barrel: the Engine contract with its drivers and the operations every entity runs
 * against it.
 */

import { BufferJSON, jidNormalizedUser, proto, toNumber, type MessageUserReceiptUpdate, type WAMessageUpdate, type WASocket } from 'baileys';
import type { Engine } from '~/lib/store/engine';

export { FileSystemEngine, RedisEngine, S3Engine, SQLiteEngine, type Engine, type RedisClient, type SQLiteDatabase } from '~/lib/store/engine';

/**
 * Serializa con los valores reales del proto: su `toJSON` convierte enums en nombres, longs en
 * texto y bytes en base64, y el raw que se relee dejaría de compararse con los enums de baileys.
 * Serializes with the proto's real values: its `toJSON` turns enums into names, longs into text
 * and bytes into base64, and the raw read back would no longer compare against baileys' enums.
 *
 * @param doc - Documento a serializar / Document to serialize
 * @returns JSON del documento, con los Buffers en BufferJSON / Document JSON, with Buffers in BufferJSON
 */
export function serialize<T>(doc: T): string {
    return JSON.stringify(doc, function (this: Record<string, unknown>, key: string, value: unknown) {
        const original = this[key] as { constructor?: { toObject?: (message: unknown, options: object) => unknown }; low?: unknown; high?: unknown; unsigned?: unknown } | null | undefined;
        return BufferJSON.replacer(key, typeof original?.constructor?.toObject === 'function' ? original.constructor.toObject(original, { longs: Number })
            : typeof original?.low === 'number' && typeof original.high === 'number' && typeof original.unsigned === 'boolean' ? toNumber(original as Parameters<typeof toNumber>[0])
                : value);
    });
}

/**
 * @param raw - JSON guardado, o null / Stored JSON, or null
 * @returns Documento, o null si no existe o está truncado / Document, or null when missing or truncated
 */
export function deserialize<T>(raw: string | null): T | null {
    try {
        return raw === null ? null : (JSON.parse(raw, BufferJSON.reviver) as T);
    } catch {
        return null;
    }
}

/**
 * JID canónico de un teléfono, JID o LID: grupos y JIDs pasan tal cual, el LID se traduce con el
 * índice `/lid` del engine o con el mapping de baileys, y el resto se toma como teléfono.
 * Canonical JID of a phone, JID or LID: groups and JIDs pass through, the LID is translated with
 * the engine `/lid` index or the baileys mapping, and anything else is taken as a phone.
 *
 * @param engine - Motor con el índice `/lid` / Engine holding the `/lid` index
 * @param uid - Identificador crudo / Raw identifier
 * @param socket - Socket vivo para el mapping de baileys / Live socket for the baileys mapping
 * @returns JID canónico, o null si es irresoluble / Canonical JID, or null when unresolvable
 */
export const jid_of = async (engine: Engine, uid: string, socket?: WASocket): Promise<string | null> => {
    const phone_like = (value: string | number | null | undefined) => (value != null && !String(value).endsWith('@lid') ? String(value) : null);
    const lid = uid.endsWith('@lid') ? jidNormalizedUser(uid) : '';
    const mapped = uid.endsWith('@g.us') || uid.endsWith('@s.whatsapp.net') ? uid
        : lid ? (phone_like(deserialize<string>(await engine.get(`/lid/${lid}`)))
            ?? phone_like(deserialize<string | number>(await engine.get(`/lid/${lid.split('@')[0]}_reverse`)))
            ?? phone_like(await socket?.signalRepository?.lidMapping?.getPNForLID(lid).catch(() => null)))
            : uid.replace(/\D/g, '');
    return mapped ? (mapped.includes('@') ? jidNormalizedUser(mapped) : `${mapped}@s.whatsapp.net`) : null;
};

/**
 * Suma raws al timeline guardado en la ruta, tal como llegaron. Si el primero es idéntico al último
 * guardado es su eco y se ignora, así que repetir la llamada no duplica nada; el mismo raw después de
 * otro sí se suma, porque destacar, quitar y volver a destacar son tres cambios.
 * Appends raws to the timeline stored at the path, exactly as they arrived. When the first one is
 * identical to the last stored one it is its echo and is ignored, so repeating the call duplicates
 * nothing; the same raw after another one is appended, since starring, unstarring and starring again
 * are three changes.
 *
 * @param engine - Motor de la sesión / Session engine
 * @param path - Ruta del timeline / Timeline path
 * @param raws - Raws tal como los emitió baileys / Raws exactly as baileys emitted them
 * @param score - Orden del documento en su directorio / Document order in its directory
 * @returns Timeline con los raws sumados, o null si no había timeline o repetían al último / Timeline with the raws appended, or null when there was no timeline or they repeated the last one
 */
export const append = async <T>(engine: Engine, path: string, raws: T[], score?: number): Promise<T[] | null> => {
    const timeline = deserialize<T[]>(await engine.get(path));
    const fresh = timeline && serialize(timeline.at(-1)) !== serialize(raws[0]) ? [...timeline, ...raws] : null;
    if (fresh) await engine.set(path, serialize(fresh), score);
    return fresh;
};

/**
 * Acuse o cambio de estado de entrega: no se suma al timeline, reemplaza su único registro de entrega
 * `{ key, update: { status } }` por uno con el estado más alto alcanzado; un error manda hasta que
 * llega un avance. Así el documento no crece con cada acuse de cada participante.
 * Delivery receipt or status change: it is not appended to the timeline, it replaces its single
 * delivery record `{ key, update: { status } }` with one holding the highest state reached; an error
 * rules until a progress arrives. So the document does not grow with every receipt of every participant.
 *
 * @param engine - Motor de la sesión / Session engine
 * @param path - Ruta del timeline / Timeline path
 * @param raw - `messages.update` de sólo estado, o `message-receipt.update` / Status-only `messages.update`, or `message-receipt.update`
 * @param score - Orden del documento en su directorio / Document order in its directory
 * @returns Timeline con el registro, o null si no había timeline o el estado no cambió / Timeline with the record, or null when there was no timeline or the state did not change
 */
export const deliver = async <T>(engine: Engine, path: string, raw: WAMessageUpdate | MessageUserReceiptUpdate, score?: number): Promise<T[] | null> => {
    const { Status } = proto.WebMessageInfo;
    const timeline = deserialize<T[]>(await engine.get(path));
    const previous = (timeline?.findLast(delivery) as WAMessageUpdate | undefined)?.update;
    const incoming = 'receipt' in raw ? (raw.receipt.playedTimestamp ? Status.PLAYED : raw.receipt.readTimestamp ? Status.READ : Status.DELIVERY_ACK) : (raw.update.status ?? null);
    const status = incoming === Status.ERROR ? Status.ERROR : Math.max(previous?.status === Status.ERROR ? 0 : (previous?.status ?? 0), incoming ?? 0);
    const record: WAMessageUpdate = { key: raw.key, update: { status, ...(status === Status.ERROR && 'update' in raw && raw.update.messageStubParameters && { messageStubParameters: raw.update.messageStubParameters }) } };
    if (timeline === null || incoming === null || serialize(previous) === serialize(record.update)) return null;
    const fresh = [...timeline.filter((entry) => delivery(entry) === false), record as T];
    await engine.set(path, serialize(fresh), score);
    return fresh;
};

/** @param entry - Raw del timeline / Timeline raw */
export const delivery = (entry: unknown): entry is WAMessageUpdate => typeof entry === 'object' && entry !== null && 'update' in entry && Object.keys((entry as WAMessageUpdate).update).every((key) => key === 'status' || key === 'messageStubParameters');
