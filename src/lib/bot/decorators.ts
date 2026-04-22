/**
 * @file playground/bot/decorators.ts
 * @description Decoradores públicos del bot.
 * Public bot decorators.
 */

import type { Message } from '~/lib/message';
import type { IWhatsApp } from '~/lib/whatsapp';
import {
    WhatsAppBot,
    decorator,
    HANDLERS,
    register_workflow_step,
    type BotSchema,
    type HandlerMeta,
} from './decorator';

/**
 * Registra el método como listener del evento indicado. Apilable: varios `@on`
 * sobre el mismo método crean múltiples suscripciones.
 * Registers the method as a listener of the given event. Stackable: several
 * `@on` on the same method produce multiple subscriptions.
 *
 * @param event - Nombre del evento del cliente / Client event name
 */
export const on = decorator<[event: string]>((_meta, h, [event]) => {
    if (!h.events.includes(event)) {
        h.events.push(event);
    }
});

/**
 * Pre-chequeo del handler. Los guards se acumulan y se evalúan en orden con AND.
 * Si el método no tiene `@on` explícito, se auto-registra a `message:created`.
 * Handler pre-check. Guards accumulate and run in order with AND semantics.
 * If the method has no explicit `@on`, it auto-registers to `message:created`.
 *
 * @param pred - Predicate que recibe los argumentos del evento / Predicate receiving the event arguments
 */
export const guard = decorator<[pred: (...args: unknown[]) => boolean | Promise<boolean>]>(
    (_meta, h, [pred]) => {
        h.guards.push(pred);
    },
);

/**
 * Marca el handler para ejecutarse una sola vez y luego auto-desuscribirse.
 * Con `event` actúa como shortcut de `@on(event) + @once()`.
 * Marks the handler to run once and then auto-unsubscribe. With `event` it acts
 * as a shortcut of `@on(event) + @once()`.
 *
 * @param event - Evento opcional para combinar `@on + @once` en un solo decorador / Optional event to combine `@on + @once` in a single decorator
 */
export function once(event?: string) {
    return (_value: unknown, context: ClassMethodDecoratorContext): void => {
        if (context.kind !== 'method') {
            throw new Error('@once only applicable to methods');
        }
        const metadata = context.metadata as Record<string | symbol, unknown>;
        if (!metadata[HANDLERS]) {
            metadata[HANDLERS] = { handlers: {}, workflows: {} };
        }
        const schema = metadata[HANDLERS] as BotSchema;
        const method_name = String(context.name);
        schema.handlers[method_name] ||= {
            method: method_name,
            events: [],
            guards: [],
            transforms: [],
            once: false,
        };
        schema.handlers[method_name].once = true;
        if (event && !schema.handlers[method_name].events.includes(event)) {
            schema.handlers[method_name].events.push(event);
        }
    };
}

/**
 * Alias semántico de `@on('connected')`. El método se invoca al establecerse
 * la conexión con WhatsApp.
 * Semantic alias of `@on('connected')`. The method runs when the WhatsApp
 * connection opens.
 */
export function connect() {
    return on('connected');
}

/**
 * Alias semántico de `@on('disconnected')`. El método se invoca al cerrarse
 * la conexión con WhatsApp.
 * Semantic alias of `@on('disconnected')`. The method runs when the WhatsApp
 * connection closes.
 */
export function disconnect() {
    return on('disconnected');
}

/**
 * Ejecuta el método cada `ms` milisegundos mientras el bot esté conectado.
 * Los timers arrancan en `connected` y se cancelan en `disconnected`.
 * Runs the method every `ms` milliseconds while the bot is connected. Timers
 * start on `connected` and are cancelled on `disconnected`.
 *
 * @param ms - Intervalo en milisegundos / Interval in milliseconds
 */
export function every(ms: number) {
    return decorator<[]>((_meta, h) => {
        h.events.push(`__every:${ms}`);
    })();
}

/**
 * Marca el método como callback de pairing (PIN/QR). Múltiples métodos `@pair`
 * se invocan en paralelo cuando baileys entrega el código.
 * Marks the method as a pairing (PIN/QR) callback. Multiple `@pair` methods run
 * in parallel when baileys delivers the code.
 */
export const pair = decorator<[]>((_meta, h) => {
    if (!h.events.includes('__pair')) {
        h.events.push('__pair');
    }
});

/**
 * Filtra por autor del mensaje. Acepta JID, LID o teléfono numérico; el string
 * se normaliza vía `wa._resolve_jid` con cache lazy. Un array produce match OR.
 * Filters by message author. Accepts JID, LID or numeric phone; the string is
 * normalized via `wa._resolve_jid` with lazy cache. An array yields OR matching.
 *
 * @param source - Identificador(es) permitidos o predicate sobre `msg.from` / Allowed identifier(s) or predicate on `msg.from`
 */
export function from(source: string | string[] | ((jid: string) => boolean)) {
    return decorator<[]>((_meta, h) => {
        if (typeof source === 'function') {
            h.guards.push((...args: unknown[]) => source((args[0] as Message).from));
        } else {
            const list = Array.isArray(source) ? source : [source];
            let resolved: Set<string> | null = null;
            h.guards.push(async (...args: unknown[]) => {
                const msg = args[0] as Message;
                const wa = args[args.length - 1] as {
                    _resolve_jid: (uid: string) => Promise<string | null>;
                };
                if (resolved === null) {
                    resolved = new Set();
                    for (const raw of list) {
                        const r = await wa._resolve_jid(raw);
                        if (r) {
                            resolved.add(r);
                        }
                    }
                }
                return resolved.has(msg.from);
            });
        }
    })();
}

/**
 * Class decorator que convierte la clase en un bot WhatsApp con opciones default.
 * La clase no necesita extender `WhatsAppBot` manualmente; el decorador produce
 * una subclase que hereda de `WhatsAppBot` y copia los métodos + metadata del
 * target. El constructor acepta un override parcial que se fusiona con las opts
 * por default.
 * Class decorator that turns the class into a WhatsApp bot with default options.
 * The class does not need to extend `WhatsAppBot` manually; the decorator
 * produces a subclass that inherits from `WhatsAppBot` and copies the target's
 * methods and metadata. The constructor accepts a partial override that is
 * merged with the default options.
 *
 * @param default_options - Opciones base para la instancia / Default options for the instance
 */
export function Bot(default_options: IWhatsApp) {
    return function <T extends abstract new (...args: never[]) => object>(
        target: T,
        _context: ClassDecoratorContext,
    ): new (override?: Partial<IWhatsApp>) => InstanceType<T> & WhatsAppBot {
        const Mixed = class extends WhatsAppBot {
            constructor(override?: Partial<IWhatsApp>) {
                super({ ...default_options, ...(override ?? {}) });
            }
        };
        for (const key of Object.getOwnPropertyNames(target.prototype)) {
            if (key !== 'constructor') {
                const desc = Object.getOwnPropertyDescriptor(target.prototype, key);
                if (desc) {
                    Object.defineProperty(Mixed.prototype, key, desc);
                }
            }
        }
        const meta = (target as unknown as Record<symbol, unknown>)[Symbol.metadata];
        if (meta !== undefined) {
            Object.defineProperty(Mixed, Symbol.metadata, {
                value: meta,
                enumerable: true,
                configurable: true,
                writable: true,
            });
        }
        return Mixed as unknown as new (override?: Partial<IWhatsApp>) => InstanceType<T> & WhatsAppBot;
    };
}

/**
 * Registra el método como paso de un workflow. Todos los steps del mismo
 * `workflow` se ejecutan secuencialmente al recibir `message:created`, ordenados
 * por `index`. Comparten los mismos argumentos (msg, chat, wa), por lo que las
 * mutaciones sobre esos objetos son visibles en los steps posteriores.
 * Registers the method as a step of a workflow. All steps of the same
 * `workflow` run sequentially on `message:created`, ordered by `index`. They
 * share the same arguments (msg, chat, wa), so mutations on those objects are
 * visible to later steps.
 *
 * @param workflow - Nombre del workflow / Workflow name
 * @param index - Posición dentro del workflow (ASC) / Position within the workflow (ASC)
 */
export function pipe(workflow: string, index: number) {
    return (_value: unknown, context: ClassMethodDecoratorContext): void => {
        if (context.kind !== 'method') {
            throw new Error('@pipe only applicable to methods');
        }
        const metadata = context.metadata as Record<string | symbol, unknown>;
        register_workflow_step(metadata, workflow, {
            index,
            method: String(context.name),
        });
    };
}

/**
 * Registra el método como comando textual. Internamente aplica
 * `@on('message:created')`, un guard que matchea el `pattern` y un transform
 * que pasa `(msg, chat, args)` al método.
 * Registers the method as a textual command. Internally applies
 * `@on('message:created')`, a guard matching the `pattern` and a transform that
 * passes `(msg, chat, args)` to the method.
 *
 * @param pattern - Prefijo textual o RegExp a matchear contra `msg.caption` / Text prefix or RegExp matched against `msg.caption`
 */
export function command(pattern: string | RegExp) {
    return (value: unknown, context: ClassMethodDecoratorContext): void => {
        on('message:created')(value, context);
        guard((...args: unknown[]) => {
            const msg = args[0] as Message;
            const text = msg.caption ?? '';
            if (typeof pattern === 'string') {
                return text.startsWith(pattern);
            }
            return pattern.test(text);
        })(value, context);

        const metadata = context.metadata as Record<string | symbol, unknown>;
        const schema = metadata[HANDLERS] as BotSchema;
        const handler = schema.handlers[String(context.name)] as HandlerMeta;
        handler.transforms.push((args) => {
            const msg = args[0] as Message;
            const chat = args[1];
            const text = msg.caption ?? '';
            if (typeof pattern === 'string') {
                const rest = text.slice(pattern.length).trim();
                const parsed = rest.length > 0 ? rest.split(/\s+/) : [];
                return [msg, chat, parsed];
            }
            const match = pattern.exec(text);
            return [msg, chat, match ? match.slice(1) : []];
        });
    };
}
