/**
 * @file bot/decorator.ts
 * @description Base de los decoradores Stage 3: el schema de cada bot y la clase que lo cablea
 * contra el cliente.
 * Stage 3 decorators base: every bot's schema and the class that wires it against the client.
 */

import WhatsApp from '~/lib/whatsapp';

type Metadata = Record<string | symbol, unknown>;

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

/**
 * @param metadata - Metadata del contexto del decorador / Decorator context metadata
 * @param method_name - Nombre del método / Method name
 * @returns El schema del bot y la entrada del método, creados si faltaban / The bot schema and the method entry, created when missing
 */
export function resolve(metadata: Metadata, method_name: string): [BotSchema, HandlerMeta] {
    const schema = (metadata[HANDLERS] ??= { handlers: {}, workflows: {} }) as BotSchema;
    schema.handlers[method_name] ??= { method: method_name, events: [], guards: [], transforms: [], once: false };
    return [schema, schema.handlers[method_name]];
}

/**
 * @param metadata - Metadata del contexto del decorador / Decorator context metadata
 * @param workflow - Nombre del workflow / Workflow name
 * @param step - Índice y método del paso / Step index and method
 */
export function register_workflow_step(metadata: Metadata, workflow: string, step: WorkflowStep): void {
    const schema = (metadata[HANDLERS] ??= { handlers: {}, workflows: {} }) as BotSchema;
    (schema.workflows[workflow] ??= []).push(step);
}

/**
 * Fábrica de decoradores paramétricos de método: el callback muta la entrada del handler.
 * Parametric method decorator factory: the callback mutates the handler entry.
 *
 * @param callback - Mutador de la entrada del handler / Handler entry mutator
 * @throws Error si se aplica a algo que no es un método / when applied to something other than a method
 */
export function decorator<P extends unknown[]>(callback: (metadata: Metadata, handler: HandlerMeta, params: P) => void) {
    return (...params: P) => (_value: unknown, context: ClassMethodDecoratorContext): void => {
        if (context.kind === 'method') callback(context.metadata as Metadata, resolve(context.metadata as Metadata, String(context.name))[1], params);
        else throw new Error(`Decorator only applicable to methods; got ${context.kind}`);
    };
}

/**
 * Bot declarativo: al conectar cablea los métodos decorados —eventos, timers, workflows y
 * pairing— una sola vez, así una reconexión no duplica los listeners.
 * Declarative bot: on connect it wires the decorated methods —events, timers, workflows and
 * pairing— only once, so a reconnection does not duplicate the listeners.
 */
export class WhatsAppBot extends WhatsApp {
    /** Cableado pendiente; pasa a false en la primera conexión. / Wiring pending; turns false on the first connection. */
    #pending = true;

    /** @param callback - Callback del PIN o QR; opcional si hay métodos `@pair` / PIN or QR callback; optional when there are `@pair` methods */
    override async connect(callback?: (auth: string | Buffer) => void | Promise<void>): Promise<void> {
        const schema = (this.constructor as { [Symbol.metadata]?: Metadata })[Symbol.metadata]?.[HANDLERS] as BotSchema | undefined;
        const handlers = Object.values(schema?.handlers ?? {});
        const bind = (name: string) => {
            const fn = (this as unknown as Record<string, unknown>)[name];
            return typeof fn === 'function' ? (fn.bind(this) as (...args: unknown[]) => unknown) : null;
        };
        if (this.#pending) {
            this.#pending = false;
            const timers = handlers.flatMap((meta) => {
                const fn = bind(meta.method);
                const invoke = async (...args: unknown[]) => {
                    const allowed = await meta.guards.reduce<Promise<boolean>>(async (ok, check) => (await ok) && Boolean(await check(...args)), Promise.resolve(true));
                    const current = allowed ? await meta.transforms.reduce<Promise<unknown[]>>(async (acc, transform) => transform(await acc), Promise.resolve(args)) : [];
                    if (allowed) await fn?.(...current);
                };
                const events = meta.events.length === 0 && (meta.guards.length > 0 || meta.transforms.length > 0) ? ['message:created'] : meta.events;
                events.filter((event) => fn && !event.startsWith('__')).forEach((event) => (meta.once ? this.once(event as never, invoke as never) : this.on(event as never, invoke as never)));
                return fn
                    ? events
                        .map((event) => event.match(/^__(every|delay):(\d+)$/))
                        .filter((match): match is RegExpMatchArray => Boolean(match && Number(match[2]) > 0))
                        .map((match) => ({ kind: match[1] as 'every' | 'delay', ms: Number(match[2]), run: () => invoke() }))
                    : [];
            });
            let intervals: ReturnType<typeof setInterval>[] = [];
            let round = 0;
            const stop = () => {
                round++;
                intervals.forEach((id) => clearInterval(id));
                intervals = [];
            };
            this.on('connected', () => {
                stop();
                const current = round;
                intervals = timers.filter((timer) => timer.kind === 'every').map((timer) => setInterval(() => void timer.run(), timer.ms));
                timers.filter((timer) => timer.kind === 'delay').forEach((timer) => setTimeout(async function loop() {
                    if (round === current) {
                        await timer.run();
                        setTimeout(loop, timer.ms);
                    }
                }, timer.ms));
            });
            this.on('disconnected', stop);
            Object.values(schema?.workflows ?? {})
                .map((steps) => [...steps].sort((a, b) => a.index - b.index).map(({ method }) => bind(method)).filter((fn): fn is (...args: unknown[]) => unknown => fn !== null))
                .filter((steps) => steps.length > 0)
                .forEach((steps) => this.on('message:created', (async (...args: unknown[]) => {
                    for (const step of steps) await step(...args);
                }) as never));
        }
        return super.connect(async (code) => {
            await Promise.all(handlers.filter((meta) => meta.events.includes('__pair')).map((meta) => bind(meta.method)?.(code)));
            await callback?.(code);
        });
    }
}

export default WhatsAppBot;
