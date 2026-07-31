/**
 * @file store/index.ts
 * @description Barrel del módulo store — reexporta Engine + drivers y expone helpers de serialización.
 * Store module barrel — re-exports Engine + drivers and provides serialization helpers.
 */

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
