/**
 * @file store/index.ts
 * @description Barrel del módulo store — reexporta Engine + drivers y expone helpers de serialización.
 * Store module barrel — re-exports Engine + drivers and provides serialization helpers.
 */

import { jidNormalizedUser, type WASocket } from 'baileys';
import type { Engine } from '~/lib/store/engine';
import { BufferJSON } from 'baileys';

export { FileSystemEngine, RedisEngine, S3Engine, SQLiteEngine, type Engine, type RedisClient, type SQLiteDatabase } from '~/lib/store/engine';

/**
 * Serializa un documento a string preservando Buffers con BufferJSON de baileys.
 * Serializes a document to string preserving Buffers via baileys BufferJSON.
 *
 * @param doc - Documento a serializar / Document to serialize
 * @returns String JSON / JSON string
 */
export function serialize<T>(doc: T): string {
  return JSON.stringify(doc, BufferJSON.replacer);
}

/**
 * Deserializa un string JSON a documento aplicando BufferJSON. Retorna null si la entrada es
 * null o no es JSON válido: un documento corrupto (escritura interrumpida, truncado) se
 * comporta como inexistente en vez de propagar el parse error a toda la página.
 * Deserializes a JSON string to document using BufferJSON. Returns null when the input is
 * null or invalid JSON: a corrupt document (interrupted write, truncation) behaves as
 * missing instead of poisoning the whole page with a parse error.
 *
 * @param raw - String JSON o null / JSON string or null
 * @returns Documento parseado o null / Parsed document or null
 */
export function deserialize<T>(raw: string | null): T | null {
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw, BufferJSON.reviver) as T;
  } catch {
    return null;
  }
}

/**
 * JID canónico de un teléfono, JID o LID: los grupos y JIDs pasan tal cual, el LID se mapea
 * contra los índices `/lid` del engine (o contra baileys cuando hay socket) y el resto se
 * trata como teléfono.
 * Canonical JID for a phone, JID or LID: groups and JIDs pass through, the LID is mapped
 * against the engine `/lid` indexes (or against baileys when a socket is given) and the rest
 * is treated as a phone.
 *
 * @param engine - Motor con los índices `/lid` / Engine holding the `/lid` indexes
 * @param uid - Identificador crudo / Raw identifier
 * @param socket - Socket vivo para el mapping de baileys, si hay / Live socket for the baileys mapping, if any
 * @returns JID canónico, o null si es irresoluble / Canonical JID, or null when unresolvable
 */
export const jid_of = async (engine: Engine, uid: string, socket?: WASocket): Promise<string | null> => {
    if (uid.endsWith('@g.us') || uid.endsWith('@s.whatsapp.net')) return uid;
    const lid = uid.endsWith('@lid') ? jidNormalizedUser(uid) : '';
    const mapped = lid
        ? deserialize<string>(await engine.get(`/lid/${lid}`))
        ?? deserialize<string | number>(await engine.get(`/lid/${lid.split('@')[0]}_reverse`))
        ?? await socket?.signalRepository?.lidMapping?.getPNForLID(lid).catch(() => null)
        : uid.replace(/\D/g, '');
    return mapped ? (String(mapped).includes('@') ? jidNormalizedUser(String(mapped)) : `${mapped}@s.whatsapp.net`) : null;
};
