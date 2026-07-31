/**
 * @file index.ts
 * @description Punto de entrada público de la librería @arcaelas/whatsapp.
 * Public entry point of the @arcaelas/whatsapp library.
 */

export { WhatsApp, default } from '~/lib/whatsapp';
export type { IWhatsApp, DisconnectOptions, ReconnectOption } from '~/lib/whatsapp';

export { FileSystemEngine, RedisEngine, S3Engine, SQLiteEngine, serialize, deserialize } from '~/lib/store';
export type { Engine, RedisClient, SQLiteDatabase } from '~/lib/store';

export { Contact, contact } from '~/lib/contact';
export { Chat, chat } from '~/lib/chat';
export { Message, message, Text, Image, Video, Audio, Sticker, Document, Location, Poll, VCard, Event } from '~/lib/message';
export { Feed, TTL_MS as FEED_TTL_MS } from '~/lib/status';
