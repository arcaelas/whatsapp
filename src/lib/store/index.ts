/**
 * @file store/index.ts
 * @description Barrel del módulo store — reexporta Engine + drivers y expone helpers de serialización.
 * Store module barrel — re-exports Engine + drivers and provides serialization helpers.
 */

import { BufferJSON } from 'baileys';

export { FileSystemEngine, RedisEngine, type Engine, type RedisClient } from '~/lib/store/engine';

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
 * Deserializa un string JSON a documento aplicando BufferJSON. Retorna null si la entrada es null.
 * Deserializes a JSON string to document using BufferJSON. Returns null if input is null.
 *
 * @param raw - String JSON o null / JSON string or null
 * @returns Documento parseado o null / Parsed document or null
 */
export function deserialize<T>(raw: string | null): T | null {
  if (raw === null) {
    return null;
  }
  return JSON.parse(raw, BufferJSON.reviver) as T;
}
