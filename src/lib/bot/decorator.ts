/**
 * @file playground/bot/decorator.ts
 * @description Infraestructura base de decoradores Stage 3 sobre WhatsApp.
 * Base infrastructure for Stage 3 decorators over WhatsApp.
 */

import WhatsApp, { type IWhatsApp } from '~/lib/whatsapp';

(Symbol as { metadata?: symbol }).metadata ??= Symbol.for('Symbol.metadata');

export const HANDLERS = Symbol('wa:handlers');

export interface HandlerMeta {
    method: string;
    events: string[];
    guards: Array<(...args: unknown[]) => boolean | Promise<boolean>>;
    transforms: Array<(args: unknown[]) => unknown[] | Promise<unknown[]>>;
    once: boolean;
}

export interface WorkflowStep {
    index: number;
    method: string;
}

export interface BotSchema {
    handlers: Record<string, HandlerMeta>;
    workflows: Record<string, WorkflowStep[]>;
}

type Metadata = Record<string | symbol, unknown>;

/**
 * Recupera o inicializa el schema del bot y la entrada del método indicado.
 * Retrieves or initializes the bot schema and the entry for the given method.
 *
 * @param metadata - Objeto metadata del contexto del decorador / Decorator context metadata object
 * @param method_name - Nombre del método / Method name
 * @returns Tupla `[schema, handler_meta]` para el método / Tuple `[schema, handler_meta]` for the method
 */
function resolve(metadata: Metadata, method_name: string): [BotSchema, HandlerMeta] {
    let schema = metadata[HANDLERS] as BotSchema | undefined;
    if (!schema) {
        schema = { handlers: {}, workflows: {} };
        metadata[HANDLERS] = schema;
    }
    if (!schema.workflows) {
        schema.workflows = {};
    }
    schema.handlers[method_name] ||= {
        method: method_name,
        events: [],
        guards: [],
        transforms: [],
        once: false,
    };
    return [schema, schema.handlers[method_name]];
}

/**
 * Registra un step dentro de un workflow. Uso interno del decorador `@pipe`.
 * Registers a step inside a workflow. Internal use of the `@pipe` decorator.
 *
 * @param metadata - Metadata del contexto del decorador / Decorator context metadata
 * @param workflow - Nombre del workflow / Workflow name
 * @param step - Step a registrar (índice + nombre del método) / Step to register (index + method name)
 */
export function register_workflow_step(
    metadata: Metadata,
    workflow: string,
    step: WorkflowStep,
): void {
    let schema = metadata[HANDLERS] as BotSchema | undefined;
    if (!schema) {
        schema = { handlers: {}, workflows: {} };
        metadata[HANDLERS] = schema;
    }
    if (!schema.workflows) {
        schema.workflows = {};
    }
    schema.workflows[workflow] ||= [];
    schema.workflows[workflow].push(step);
}

/**
 * Factory para crear decoradores paramétricos Stage 3. El callback muta la metadata
 * del handler mediante la entrada resuelta.
 * Factory to build Stage 3 parametric decorators. The callback mutates the handler
 * metadata via the resolved entry.
 *
 * @param callback - Mutador de la entrada del handler / Handler entry mutator
 * @returns Decorador paramétrico listo para aplicarse a un método / Parametric decorator ready to be applied to a method
 */
export function decorator<P extends unknown[]>(
    callback: (metadata: Metadata, handler: HandlerMeta, params: P) => void,
) {
    return (...params: P) =>
        (_value: unknown, context: ClassMethodDecoratorContext): void => {
            if (context.kind !== 'method') {
                throw new Error(`Decorator only applicable to methods; got ${context.kind}`);
            }
            const metadata = context.metadata as Metadata;
            const method_name = String(context.name);
            const [, handler] = resolve(metadata, method_name);
            callback(metadata, handler, params);
        };
}

/**
 * Clase base opcional para bots declarativos. El consumer extiende `WhatsAppBot`
 * (o usa `@WhatsApp` como class decorator), declara métodos decorados y al
 * `connect()` los listeners se cablean automáticamente contra el event emitter real.
 * Optional base class for declarative bots. The consumer extends `WhatsAppBot`
 * (or uses `@WhatsApp` as a class decorator), declares decorated methods and at
 * `connect()` listeners get wired against the real event emitter automatically.
 */
export class WhatsAppBot extends WhatsApp {
    constructor(options: IWhatsApp) {
        super(options);
    }

    /**
     * Inicia la conexión cableando previamente los handlers decorados. Los métodos
     * `@pair` se invocan en paralelo con el `callback` opcional.
     * Starts the connection wiring decorated handlers beforehand. `@pair` methods
     * run in parallel alongside the optional `callback`.
     *
     * @param callback - Callback tradicional del PIN/QR (opcional si hay `@pair`) / Traditional PIN/QR callback (optional when `@pair` exists)
     */
    override async connect(callback?: (auth: string | Buffer) => void | Promise<void>): Promise<void> {
        this._wire_handlers();
        const pair_methods = this._collect_pair_methods();
        const final_callback = async (code: string | Buffer): Promise<void> => {
            await Promise.all(pair_methods.map((fn) => fn(code)));
            if (callback) {
                await callback(code);
            }
        };
        return super.connect(final_callback);
    }

    /**
     * Recolecta los métodos marcados con `@pair` ligados a `this`.
     * Collects methods marked with `@pair` bound to `this`.
     *
     * @returns Lista de funciones ligadas listas para invocar con el code / List of bound functions ready to invoke with the code
     */
    private _collect_pair_methods(): Array<(code: string | Buffer) => unknown> {
        const out: Array<(code: string | Buffer) => unknown> = [];
        const metadata = (this.constructor as { [Symbol.metadata]?: Metadata })[Symbol.metadata];
        if (metadata) {
            const schema = metadata[HANDLERS] as BotSchema | undefined;
            if (schema) {
                for (const meta of Object.values(schema.handlers)) {
                    if (meta.events.includes('__pair')) {
                        const fn = (this as unknown as Record<string, unknown>)[meta.method];
                        if (typeof fn === 'function') {
                            out.push((fn as (code: string | Buffer) => unknown).bind(this));
                        }
                    }
                }
            }
        }
        return out;
    }

    /**
     * Cablea los handlers decorados contra el event emitter: registra listeners
     * (`@on`/`@once`), timers (`@every`) y workflows (`@pipe`).
     * Wires decorated handlers against the event emitter: registers listeners
     * (`@on`/`@once`), timers (`@every`) and workflows (`@pipe`).
     */
    private _wire_handlers(): void {
        const metadata = (this.constructor as { [Symbol.metadata]?: Metadata })[Symbol.metadata];
        if (metadata) {
            const schema = metadata[HANDLERS] as BotSchema | undefined;
            if (schema) {
                const intervals: Array<{ ms: number; run: () => Promise<void> }> = [];

                for (const meta of Object.values(schema.handlers)) {
                    const method = (this as unknown as Record<string, unknown>)[meta.method];
                    if (typeof method === 'function') {
                        const bound = method.bind(this);

                        const invoke = async (...args: unknown[]): Promise<void> => {
                            for (const g of meta.guards) {
                                if (!(await g(...args))) {
                                    return;
                                }
                            }
                            let current: unknown[] = args;
                            for (const t of meta.transforms) {
                                current = await t(current);
                            }
                            await bound(...current);
                        };

                        if (meta.events.length === 0 && (meta.guards.length > 0 || meta.transforms.length > 0)) {
                            meta.events.push('message:created');
                        }

                        for (const event of meta.events) {
                            if (event.startsWith('__every:')) {
                                const ms = parseInt(event.slice('__every:'.length), 10);
                                if (Number.isFinite(ms) && ms > 0) {
                                    intervals.push({ ms, run: () => invoke() });
                                }
                            } else if (event !== '__pair') {
                                const register = meta.once ? this.once.bind(this) : this.on.bind(this);
                                register(event as never, invoke as never);
                            }
                        }
                    }
                }

                if (intervals.length > 0) {
                    let timer_ids: ReturnType<typeof setInterval>[] = [];
                    this.on('connected', () => {
                        for (const { ms, run } of intervals) {
                            timer_ids.push(setInterval(() => void run(), ms));
                        }
                    });
                    this.on('disconnected', () => {
                        for (const id of timer_ids) {
                            clearInterval(id);
                        }
                        timer_ids = [];
                    });
                }

                for (const steps of Object.values(schema.workflows ?? {})) {
                    const sorted = [...steps].sort((a, b) => a.index - b.index);
                    const funcs = sorted
                        .map(({ method }) => {
                            const fn = (this as unknown as Record<string, unknown>)[method];
                            return typeof fn === 'function' ? fn.bind(this) : null;
                        })
                        .filter((f): f is (...args: unknown[]) => unknown => f !== null);
                    if (funcs.length > 0) {
                        this.on('message:created', (async (...args: unknown[]) => {
                            for (const fn of funcs) {
                                await fn(...args);
                            }
                        }) as never);
                    }
                }
            }
        }
    }
}

export default WhatsAppBot;
