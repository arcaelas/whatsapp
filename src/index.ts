/**
 * @file index.ts
 * @description Punto de entrada público de la librería @arcaelas/whatsapp.
 * Public entry point of the @arcaelas/whatsapp library.
 */

export { WhatsApp, default } from '~/lib/whatsapp';
export type { IWhatsApp, DisconnectOptions, ReconnectOption } from '~/lib/whatsapp';

export { FileSystemEngine, RedisEngine } from '~/lib/store';
export type { Engine, RedisClient } from '~/lib/store';
