/**
 * @file store/engine/lib/file_system/lib/file.ts
 * @description `read` y `write` asíncronos del FileSystemEngine, sin caché: cada lectura va al
 * disco y el consumo de memoria no depende del volumen guardado.
 * Asynchronous FileSystemEngine `read` and `write`, without cache: every read goes to disk and
 * memory use does not depend on the stored volume.
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @param pathname - Archivo a leer / File to read
 * @param fmt - Codificación del texto; sin ella devuelve el binario / Text encoding; without it, the binary
 * @returns Contenido, o undefined si no existe / Content, or undefined when missing
 */
export function read(pathname: string, fmt: BufferEncoding): Promise<string | undefined>;
export function read(pathname: string): Promise<Buffer | undefined>;
export function read(pathname: string, fmt?: BufferEncoding): Promise<string | Buffer | undefined> {
    return fs.readFile(pathname, fmt ? { encoding: fmt } : undefined).catch(() => undefined);
}

/**
 * Escribe de forma atómica —temporal y rename— creando los directorios que falten.
 * Writes atomically —temp file and rename— creating any missing directory.
 *
 * @param pathname - Archivo / File
 * @param content - Contenido / Content
 * @param mtime - Fecha a fijar en epoch ms: el score del documento / Date to set, epoch ms: the document score
 */
export async function write(pathname: string, content: string | Buffer, mtime?: number): Promise<void> {
    const tmp = `${pathname}.${randomBytes(6).toString('hex')}.tmp`;
    await fs.mkdir(path.dirname(pathname), { recursive: true });
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, pathname);
    if (mtime !== undefined) await fs.utimes(pathname, new Date(mtime), new Date(mtime));
}
