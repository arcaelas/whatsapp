import type { WhatsApp } from './WhatsApp';

/**
 * @description
 * Contexto compartido entre todas las clases generadas.
 * Pasado a las factories contact(), chat(), message().
 * Es la instancia de WhatsApp directamente.
 */
export type Context = WhatsApp;
