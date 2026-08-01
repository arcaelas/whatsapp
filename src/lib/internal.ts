/**
 * @file internal.ts
 * @description Canal privado entre el cliente y sus entidades: guarda el socket vivo fuera de
 * la instancia y resuelve identificadores contra el engine, sin exponer nada en la superficie
 * pública de `WhatsApp`.
 * Private channel between the client and its entities: keeps the live socket outside the
 * instance and resolves identifiers against the engine, exposing nothing on `WhatsApp`'s
 * public API.
 */

import { jidNormalizedUser, type WASocket } from 'baileys';
import { deserialize, type Engine } from '~/lib/store';

const channel = new WeakMap<object, WASocket | null>();

/**
 * Publica el socket vivo del cliente, o `null` al cerrarlo.
 * Publishes the client's live socket, or `null` when it closes.
 *
 * @param owner - Cliente dueño de la sesión / Client owning the session
 * @param socket - Socket abierto, o null / Open socket, or null
 */
export function bind(owner: object, socket: WASocket | null): void {
    channel.set(owner, socket);
}

/**
 * Socket vivo del cliente, o `null` mientras no hay conexión.
 * The client's live socket, or `null` while disconnected.
 *
 * @param owner - Cliente construido por la librería / Client built by the library
 * @returns Socket abierto, o null / Open socket, or null
 */
export function session(owner: object): WASocket | null {
    return channel.get(owner) ?? null;
}

/**
 * Normaliza cualquier identificador (JID, LID o teléfono) a JID canónico. Los receipts
 * direccionan por dispositivo (`…:9@lid`) y el índice se guarda sin él; cuando el mapping falta
 * en el engine lo aporta baileys, que es la única vía para un chat que sólo se conoce por LID.
 * Normalizes any identifier (JID, LID or phone) into a canonical JID. Receipts address per
 * device (`…:9@lid`) and the index is stored without it; when the mapping is missing from the
 * engine baileys provides it, the only way to reach a chat known only by its LID.
 *
 * @param owner - Cliente dueño del engine / Client owning the engine
 * @param uid - Identificador crudo / Raw identifier
 * @returns JID canónico, o null si no es determinable / Canonical JID, or null when undeterminable
 */
export async function resolve_jid(owner: { engine: Engine }, uid: string): Promise<string | null> {
    if (uid.endsWith('@g.us') || uid.endsWith('@s.whatsapp.net')) {
        return uid;
    }
    if (!uid.endsWith('@lid')) {
        const digits = uid.replace(/\D/g, '');
        return digits ? `${digits}@s.whatsapp.net` : null;
    }
    const lid = jidNormalizedUser(uid);
    const direct = deserialize<string>(await owner.engine.get(`/lid/${lid}`));
    if (direct) {
        return direct.includes('@') ? direct : `${direct}@s.whatsapp.net`;
    }
    const reverse = deserialize<string | number>(await owner.engine.get(`/lid/${lid.split('@')[0]}_reverse`));
    if (reverse != null) {
        return `${reverse}@s.whatsapp.net`;
    }
    const pn = await (session(owner) as unknown as {
        signalRepository?: { lidMapping?: { getPNForLID(lid: string): Promise<string | null | undefined> } };
    } | null)?.signalRepository?.lidMapping?.getPNForLID(lid).catch(() => null);
    return pn ? jidNormalizedUser(pn.includes('@') ? pn : `${pn}@s.whatsapp.net`) : null;
}
