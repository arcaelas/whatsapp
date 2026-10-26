/**
 * @file bot/decorators.ts
 * @description Decoradores públicos del bot.
 * Public bot decorators.
 */

import type { Message } from '~/lib/message';
import { jid_of } from '~/lib/store';
import type WhatsApp from '~/lib/whatsapp';
import { WhatsAppBot, decorator, register_workflow_step, resolve } from './decorator';

type IWhatsApp = ConstructorParameters<typeof WhatsApp>[0];

/**
 * Suscribe el método al evento; varios `@on` sobre el mismo método suman suscripciones.
 * Subscribes the method to the event; several `@on` on the same method add subscriptions.
 *
 * @param event - Nombre del evento del cliente / Client event name
 */
export const on = decorator<[event: string]>((_meta, handler, [event]) => {
    handler.events = [...new Set([...handler.events, event])];
});

/**
 * Pre-chequeo acumulable con semántica AND; sin `@on` explícito el método escucha `message:created`.
 * Stackable pre-check with AND semantics; without an explicit `@on` the method listens to `message:created`.
 *
 * @param check - Predicado que recibe los argumentos del evento / Predicate receiving the event arguments
 */
export const guard = decorator<[check: (...args: unknown[]) => boolean | Promise<boolean>]>((_meta, handler, [check]) => {
    handler.guards.push(check);
});

/**
 * El handler corre una vez y se desuscribe; con `event` equivale a `@on(event)` + `@once()`.
 * The handler runs once and unsubscribes; with `event` it equals `@on(event)` + `@once()`.
 *
 * @param event - Evento opcional / Optional event
 */
export function once(event?: string) {
    return decorator<[]>((_meta, handler) => {
        handler.once = true;
        handler.events = [...new Set([...handler.events, ...(event ? [event] : [])])];
    })();
}

/** Alias de `@on('connected')`. / Alias of `@on('connected')`. */
export function connect() {
    return on('connected');
}

/** Alias de `@on('disconnected')`. / Alias of `@on('disconnected')`. */
export function disconnect() {
    return on('disconnected');
}

/**
 * Corre el método cada `ms` mientras el bot esté conectado, con `setInterval`: las ejecuciones
 * pueden solaparse si el método tarda más que el intervalo.
 * Runs the method every `ms` while the bot is connected, with `setInterval`: executions may
 * overlap when the method takes longer than the interval.
 *
 * @param ms - Intervalo en milisegundos / Interval in milliseconds
 */
export function every(ms: number) {
    return decorator<[]>((_meta, handler) => {
        handler.events.push(`__every:${ms}`);
    })();
}

/**
 * Corre el método dejando `ms` entre el final de una ejecución y el inicio de la siguiente:
 * nunca se solapa.
 * Runs the method leaving `ms` between the end of one execution and the start of the next: it
 * never overlaps.
 *
 * @param ms - Retardo en milisegundos / Delay in milliseconds
 */
export function delay(ms: number) {
    return decorator<[]>((_meta, handler) => {
        handler.events.push(`__delay:${ms}`);
    })();
}

/** Callback de vinculación (PIN o QR); varios `@pair` corren en paralelo. / Linking callback (PIN or QR); several `@pair` run in parallel. */
export const pair = decorator<[]>((_meta, handler) => {
    handler.events = [...new Set([...handler.events, '__pair'])];
});

/**
 * Filtra por autor: JID, LID o teléfono, resueltos una vez y memorizados; una lista hace OR.
 * Filters by author: JID, LID or phone, resolved once and memoized; a list means OR.
 *
 * @param source - Identificador(es) permitidos o predicado sobre `msg.from` / Allowed identifier(s) or predicate on `msg.from`
 */
export function from(source: string | string[] | ((jid: string) => boolean)) {
    let allowed: Promise<Set<string>> | null = null;
    return decorator<[]>((_meta, handler) => {
        handler.guards.push(async (...args: unknown[]) => {
            const { from: author } = args[0] as Message;
            const { engine } = args[args.length - 1] as WhatsApp;
            return typeof source === 'function'
                ? source(author)
                : (await (allowed ??= Promise.all([source].flat().map((uid) => jid_of(engine, uid))).then((rows) => new Set(rows.filter((jid): jid is string => jid !== null))))).has(author);
        });
    })();
}

/**
 * Convierte la clase en un bot con opciones por defecto: produce una subclase de `WhatsAppBot`
 * con los métodos y la metadata del target, y el constructor fusiona las opciones que reciba.
 * Turns the class into a bot with default options: it produces a `WhatsAppBot` subclass with the
 * target's methods and metadata, and the constructor merges the options it receives.
 *
 * @param default_options - Opciones base de la instancia / Base instance options
 */
export function Bot(default_options: IWhatsApp) {
    return function <T extends abstract new (...args: never[]) => object>(target: T, _context: ClassDecoratorContext): new (override?: Partial<IWhatsApp>) => InstanceType<T> & WhatsAppBot {
        const Mixed = class extends WhatsAppBot {
            /** @param override - Opciones que pisan las de por defecto / Options overriding the defaults */
            constructor(override?: Partial<IWhatsApp>) {
                super({ ...default_options, ...override });
            }
        };
        Object.getOwnPropertyNames(target.prototype)
            .filter((key) => key !== 'constructor')
            .forEach((key) => Object.defineProperty(Mixed.prototype, key, Object.getOwnPropertyDescriptor(target.prototype, key)!));
        const meta = (target as unknown as Record<symbol, unknown>)[Symbol.metadata];
        if (meta !== undefined) Object.defineProperty(Mixed, Symbol.metadata, { value: meta, enumerable: true, configurable: true, writable: true });
        return Mixed as unknown as new (override?: Partial<IWhatsApp>) => InstanceType<T> & WhatsAppBot;
    };
}

/**
 * Paso de un workflow: los pasos del mismo `workflow` corren en orden de `index` con los mismos
 * argumentos, así las mutaciones de uno las ven los siguientes.
 * Workflow step: the steps of the same `workflow` run in `index` order with the same arguments,
 * so the mutations of one are seen by the next ones.
 *
 * @param workflow - Nombre del workflow / Workflow name
 * @param index - Posición dentro del workflow / Position within the workflow
 * @throws Error si se aplica a algo que no es un método / when applied to something other than a method
 */
export function pipe(workflow: string, index: number) {
    return (_value: unknown, context: ClassMethodDecoratorContext): void => {
        if (context.kind === 'method') register_workflow_step(context.metadata as Record<string | symbol, unknown>, workflow, { index, method: String(context.name) });
        else throw new Error('@pipe only applicable to methods');
    };
}

/**
 * Comando textual: escucha `message:created`, filtra por `pattern` contra `msg.caption` y entrega
 * `(msg, chat, args)` al método.
 * Text command: listens to `message:created`, filters by `pattern` against `msg.caption` and hands
 * `(msg, chat, args)` to the method.
 *
 * @param pattern - Prefijo o RegExp; con RegExp, `args` son sus grupos / Prefix or RegExp; with a RegExp, `args` are its groups
 */
export function command(pattern: string | RegExp) {
    return (value: unknown, context: ClassMethodDecoratorContext): void => {
        on('message:created')(value, context);
        guard((...args: unknown[]) => {
            const text = (args[0] as Message).caption();
            return typeof pattern === 'string' ? text.startsWith(pattern) : pattern.test(text);
        })(value, context);
        resolve(context.metadata as Record<string | symbol, unknown>, String(context.name))[1].transforms.push(([msg, chat]) => {
            const text = (msg as Message).caption();
            const rest = typeof pattern === 'string' ? text.slice(pattern.length).trim() : '';
            return [msg, chat, typeof pattern === 'string' ? (rest ? rest.split(/\s+/) : []) : (pattern.exec(text)?.slice(1) ?? [])];
        });
    };
}
