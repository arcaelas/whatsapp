/**
 * @file index.ts
 * @description Punto de entrada público de la librería @arcaelas/whatsapp.
 * Public entry point of the @arcaelas/whatsapp library.
 */

import WhatsApp from '~/lib/whatsapp';

export { WhatsApp };
export default WhatsApp;
export type IWhatsApp = ConstructorParameters<typeof WhatsApp>[0];
export type { Farewell } from '~/lib/whatsapp';
export type DisconnectOptions = NonNullable<Parameters<WhatsApp['disconnect']>[0]>;
export type ReconnectOption = NonNullable<IWhatsApp['reconnect']>;

export { FileSystemEngine, RedisEngine, S3Engine, SQLiteEngine, serialize, deserialize } from '~/lib/store';
export type { Engine, RedisClient, SQLiteDatabase } from '~/lib/store';

export { default as Contact, contact, Account } from '~/lib/contact';
export { default as Chat, chat } from '~/lib/chat';
export { default as Message, message, Text, Image, Video, Audio, Sticker, Document, Location, Poll, VCard, Event } from '~/lib/message';
export { Feed, TTL_MS as FEED_TTL_MS } from '~/lib/status';
