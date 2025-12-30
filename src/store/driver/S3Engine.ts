import type { DeleteObjectsCommandInput } from '@aws-sdk/client-s3';
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { IChat } from '../../Chat';
import type { IContact } from '../../Contact';
import type { IMessage } from '../../Message';
import { Engine } from '../engine';

/**
 * @description Opciones de configuración para S3Engine.
 */
export interface S3EngineOptions {
    /** Nombre del bucket S3. */
    bucket: string;
    /** Prefijo para las keys (default: '.baileys/default'). */
    prefix?: string;
    /** Credenciales AWS. Si se omiten, usa variables de entorno o IAM roles. */
    credentials?: {
        region?: string;
        accessKeyId?: string;
        secretAccessKey?: string;
        sessionToken?: string;
    };
}

/**
 * @description
 * Engine de persistencia en Amazon S3.
 *
 * Estructura:
 * ```
 * {prefix}/
 *   session/{key}                              → JSON
 *   contact/{id}/index                         → JSON
 *   chat/{cid}/index                           → JSON
 *   chat/{cid}/message/{mid}/index             → JSON
 *   chat/{cid}/message/{mid}/content           → Binary
 *   chat/{cid}/timestamp/{inverted_ts}_{mid}   → Vacío (ordenamiento)
 * ```
 *
 * @example
 * // Usando variables de entorno (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION)
 * const engine = new S3Engine({ bucket: 'my-bucket' });
 *
 * // Con credenciales explícitas
 * const engine = new S3Engine({
 *   bucket: 'my-bucket',
 *   prefix: '.baileys/5491112345678',
 *   credentials: { region: 'us-east-1', accessKeyId: '...', secretAccessKey: '...' }
 * });
 *
 * const wa = new WhatsApp({ engine });
 */
export class S3Engine extends Engine {
    private _client: S3Client;
    private _bucket: string;
    private _prefix: string;
    private _max_timestamp = 9999999999999;

    constructor(options: S3EngineOptions) {
        super();
        this._bucket = options.bucket;
        this._prefix = options.prefix ?? '.baileys/default';
        this._client = new S3Client(
            options.credentials
                ? {
                      region: options.credentials.region,
                      credentials: options.credentials.accessKeyId
                          ? {
                                accessKeyId: options.credentials.accessKeyId,
                                secretAccessKey: options.credentials.secretAccessKey ?? '',
                                sessionToken: options.credentials.sessionToken,
                            }
                          : undefined,
                  }
                : {}
        );
    }

    /**
     * @description Limpia caracteres problemáticos para keys S3.
     */
    private _clean(key: string): string {
        return key.replace(/@/g, '_at_');
    }

    /**
     * @description Construye key S3 completo.
     */
    private _key(...parts: string[]): string {
        return [this._prefix, ...parts].join('/');
    }

    /**
     * @description Invierte timestamp para orden descendente.
     */
    private _invert_time(iso: string): string {
        return String(this._max_timestamp - new Date(iso).getTime()).padStart(13, '0');
    }

    /**
     * @description Lee un objeto como string.
     */
    private async _get_string(key: string): Promise<string | null> {
        try {
            const response = await this._client.send(new GetObjectCommand({ Bucket: this._bucket, Key: key }));
            return (await response.Body?.transformToString()) ?? null;
        } catch {
            return null;
        }
    }

    /**
     * @description Lee un objeto como Buffer.
     */
    private async _get_buffer(key: string): Promise<Buffer | null> {
        try {
            const response = await this._client.send(new GetObjectCommand({ Bucket: this._bucket, Key: key }));
            const bytes = await response.Body?.transformToByteArray();
            return bytes ? Buffer.from(bytes) : null;
        } catch {
            return null;
        }
    }

    /**
     * @description Escribe un objeto.
     */
    private async _put(key: string, body: string | Buffer, content_type: string): Promise<boolean> {
        try {
            await this._client.send(new PutObjectCommand({ Bucket: this._bucket, Key: key, Body: body, ContentType: content_type }));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * @description Elimina uno o más objetos.
     */
    private async _delete(...keys: string[]): Promise<boolean> {
        if (!keys.length) return true;
        try {
            const input: DeleteObjectsCommandInput = {
                Bucket: this._bucket,
                Delete: { Objects: keys.map((Key) => ({ Key })) },
            };
            await this._client.send(new DeleteObjectsCommand(input));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * @description Lista keys con prefix, ordenados lexicográficamente.
     */
    private async _list(prefix: string, offset: number, limit: number): Promise<string[]> {
        try {
            let keys: string[] = [];
            let start_after: string | undefined;
            let skipped = 0;

            while (keys.length < limit) {
                const response = await this._client.send(
                    new ListObjectsV2Command({
                        Bucket: this._bucket,
                        Prefix: prefix,
                        MaxKeys: Math.min(1000, offset - skipped + limit),
                        StartAfter: start_after,
                    })
                );
                const contents = response.Contents ?? [];
                if (!contents.length) break;

                for (const obj of contents) {
                    if (!obj.Key) continue;
                    if (skipped < offset) {
                        skipped++;
                    } else {
                        keys.push(obj.Key);
                        if (keys.length >= limit) break;
                    }
                }
                if (!response.IsTruncated) break;
                start_after = contents.at(-1)?.Key;
            }
            return keys;
        } catch {
            return [];
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Session
    // ─────────────────────────────────────────────────────────────────────────

    async session<T = unknown>(key: string): Promise<T | null>;
    async session<T = unknown>(key: string, data: T | null): Promise<boolean>;
    async session<T = unknown>(key: string, ...args: [T | null] | []): Promise<T | null | boolean> {
        const s3_key = this._key('session', this._clean(key));
        if (args.length === 0) {
            const content = await this._get_string(s3_key);
            return content ? JSON.parse(content) : null;
        }
        const [data] = args;
        if (data === null) return this._delete(s3_key);
        return this._put(s3_key, JSON.stringify(data), 'application/json');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Contact
    // ─────────────────────────────────────────────────────────────────────────

    async contact(id: string): Promise<IContact | null>;
    async contact(id: string, data: IContact | null): Promise<boolean>;
    async contact(id: string, ...args: [IContact | null] | []): Promise<IContact | null | boolean> {
        const s3_key = this._key('contact', this._clean(id), 'index');
        if (args.length === 0) {
            const content = await this._get_string(s3_key);
            return content ? JSON.parse(content) : null;
        }
        const [data] = args;
        if (data === null) return this._delete(s3_key);
        return this._put(s3_key, JSON.stringify(data), 'application/json');
    }

    async contacts(offset = 0, limit = 50): Promise<IContact[]> {
        const prefix = this._key('contact') + '/';
        const keys = await this._list(prefix, offset * 2, limit * 2); // Aproximación por /index
        const index_keys = keys.filter((k) => k.endsWith('/index')).slice(0, limit);
        const results = await Promise.all(index_keys.map((k) => this._get_string(k)));
        return results.filter((r): r is string => r !== null).map((r) => JSON.parse(r));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Chat
    // ─────────────────────────────────────────────────────────────────────────

    async chat(id: string): Promise<IChat | null>;
    async chat(id: string, data: IChat | null): Promise<boolean>;
    async chat(id: string, ...args: [IChat | null] | []): Promise<IChat | null | boolean> {
        const s3_key = this._key('chat', this._clean(id), 'index');
        if (args.length === 0) {
            const content = await this._get_string(s3_key);
            return content ? JSON.parse(content) : null;
        }
        const [data] = args;
        if (data === null) {
            // Eliminar chat y todos sus mensajes
            const chat_prefix = this._key('chat', this._clean(id)) + '/';
            const all_keys = await this._list(chat_prefix, 0, 10000);
            return this._delete(...all_keys);
        }
        return this._put(s3_key, JSON.stringify(data), 'application/json');
    }

    async chats(offset = 0, limit = 50): Promise<IChat[]> {
        const prefix = this._key('chat') + '/';
        const keys = await this._list(prefix, 0, 10000);
        const index_keys = keys.filter((k) => k.match(/\/chat\/[^/]+\/index$/)).slice(offset, offset + limit);
        const results = await Promise.all(index_keys.map((k) => this._get_string(k)));
        return results.filter((r): r is string => r !== null).map((r) => JSON.parse(r));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Message
    // ─────────────────────────────────────────────────────────────────────────

    async message(cid: string, mid: string): Promise<IMessage | null>;
    async message(cid: string, mid: string, data: IMessage | null): Promise<boolean>;
    async message(cid: string, mid: string, ...args: [IMessage | null] | []): Promise<IMessage | null | boolean> {
        const clean_cid = this._clean(cid);
        const clean_mid = this._clean(mid);
        const msg_key = this._key('chat', clean_cid, 'message', clean_mid, 'index');

        if (args.length === 0) {
            const content = await this._get_string(msg_key);
            return content ? JSON.parse(content) : null;
        }

        const [data] = args;
        if (data === null) {
            const content_key = this._key('chat', clean_cid, 'message', clean_mid, 'content');
            const ts_prefix = this._key('chat', clean_cid, 'timestamp') + '/';
            const ts_keys = await this._list(ts_prefix, 0, 10000);
            const ts_key = ts_keys.find((k) => k.endsWith('_' + clean_mid));
            return this._delete(msg_key, content_key, ...(ts_key ? [ts_key] : []));
        }

        const inverted = this._invert_time(data.created_at);
        const ts_key = this._key('chat', clean_cid, 'timestamp', `${inverted}_${clean_mid}`);
        const [msg_ok, ts_ok] = await Promise.all([
            this._put(msg_key, JSON.stringify(data), 'application/json'),
            this._put(ts_key, '', 'text/plain'),
        ]);
        return msg_ok && ts_ok;
    }

    async messages(cid: string, offset = 0, limit = 20): Promise<IMessage[]> {
        const clean_cid = this._clean(cid);
        const ts_prefix = this._key('chat', clean_cid, 'timestamp') + '/';
        const ts_keys = await this._list(ts_prefix, offset, limit);

        const mids = ts_keys.map((k) => {
            const filename = k.split('/').pop() ?? '';
            return filename.split('_').slice(1).join('_'); // Extraer mid después del timestamp
        });

        const results = await Promise.all(
            mids.map((mid) => this._get_string(this._key('chat', clean_cid, 'message', mid, 'index')))
        );
        return results.filter((r): r is string => r !== null).map((r) => JSON.parse(r));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Content
    // ─────────────────────────────────────────────────────────────────────────

    async content(cid: string, mid: string): Promise<Buffer | null>;
    async content(cid: string, mid: string, data: Buffer | null): Promise<boolean>;
    async content(cid: string, mid: string, ...args: [Buffer | null] | []): Promise<Buffer | null | boolean> {
        const s3_key = this._key('chat', this._clean(cid), 'message', this._clean(mid), 'content');

        if (args.length === 0) {
            return this._get_buffer(s3_key);
        }

        const [data] = args;
        if (data === null) return this._delete(s3_key);

        const msg = await this.message(cid, mid);
        const content_type = msg?.mime ?? 'application/octet-stream';
        return this._put(s3_key, data, content_type);
    }
}
