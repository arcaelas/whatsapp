/**
 * @file index.ts
 * @description Punto de entrada público de la librería @arcaelas/whatsapp.
 * Public entry point of the @arcaelas/whatsapp library.
 */

import type { Product as CatalogProduct } from '~/lib/catalog';
import type { Product as MessageProduct } from '~/lib/message';
import WhatsApp from '~/lib/whatsapp';

export { WhatsApp };
export default WhatsApp;
export type IWhatsApp = ConstructorParameters<typeof WhatsApp>[0];
export type { Farewell, Instance, Presence, WatchEvent } from '~/lib/whatsapp';
export type DisconnectOptions = NonNullable<Parameters<WhatsApp['disconnect']>[0]>;
export type ReconnectOption = NonNullable<IWhatsApp['reconnect']>;

export { FileSystemEngine, RedisEngine, S3Engine, SQLiteEngine, serialize, deserialize } from '~/lib/store';
export type { Engine, RedisClient, SQLiteDatabase } from '~/lib/store';

export { default as contact, type Contact, type ContactEvent } from '~/lib/contact';
export { default as chat, type Chat, type ChatEvent } from '~/lib/chat';
export { default as message, type Message, type MessageEvent, type Text, type Image, type Video, type Audio, type Sticker, type Document, type Location, type Poll, type VCard, type Event } from '~/lib/message';
export { default as sender, type Sender, type Extra, type Route, type Who } from '~/lib/sender';
export { default as feed, type Feed, type FeedEvent, TTL_MS as FEED_TTL_MS } from '~/lib/feed';
export { default as catalog, product, type Catalog } from '~/lib/catalog';

/** El producto del catálogo o la tarjeta de un chat: los dos responden a `instanceof wa.Product`. / The catalog product or a chat card: both answer to `instanceof wa.Product`. */
export type Product = CatalogProduct | MessageProduct;
