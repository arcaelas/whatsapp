/**
 * @file internal.ts
 * @description Canal privado entre el cliente y sus entidades. Vive en un `WeakMap` fuera de
 * la instancia, así el socket de baileys y la resolución de JIDs quedan disponibles para
 * `Contact`, `Chat`, `Message` y `Feed` sin exponerse en la superficie pública de `WhatsApp`:
 * el consumidor sólo ve `on`/`once`/`off`/`emit` y los métodos documentados.
 * Private channel between the client and its entities. It lives in a `WeakMap` outside the
 * instance, so the baileys socket and JID resolution stay available to `Contact`, `Chat`,
 * `Message` and `Feed` without surfacing on `WhatsApp`'s public API: consumers only see
 * `on`/`once`/`off`/`emit` and the documented methods.
 */

import type { WASocket } from 'baileys';

/**
 * Estado que el cliente comparte con sus entidades.
 * State the client shares with its entities.
 */
export interface Internals {
    /** Socket vivo de baileys, o null mientras no hay conexión. / Live baileys socket, or null while disconnected. */
    socket: WASocket | null;
    /** Normaliza cualquier identificador (JID, LID o teléfono) a JID canónico. / Normalizes any identifier (JID, LID or phone) into a canonical JID. */
    resolve_jid(uid: string): Promise<string | null>;
}

const channel = new WeakMap<object, Internals>();

/**
 * Publica el estado interno de un cliente para las entidades de la librería.
 * Publishes a client's internal state for the library entities.
 *
 * @param owner - Cliente dueño del estado / Client owning the state
 * @param state - Estado compartido, mutable por el cliente / Shared state, mutated by the client
 */
export function bind(owner: object, state: Internals): void {
    channel.set(owner, state);
}

/**
 * Estado interno del cliente. Sólo lo resuelven los módulos de la librería: el objeto
 * nunca se expone al consumidor.
 * A client's internal state. Only library modules resolve it: the object is never exposed
 * to the consumer.
 *
 * @param owner - Cliente construido por la librería / Client built by the library
 * @returns Estado compartido / Shared state
 */
export function internals(owner: object): Internals {
    return channel.get(owner)!;
}
