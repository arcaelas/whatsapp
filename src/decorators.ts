/**
 * @file decorators.ts
 * @description Sub-entry `@arcaelas/whatsapp/decorators` — API declarativa basada
 * en decoradores Stage 3 para construir bots sobre el cliente WhatsApp.
 * Sub-entry `@arcaelas/whatsapp/decorators` — Stage 3 decorator-based declarative
 * API to build bots on top of the WhatsApp client.
 */

export {
    WhatsAppBot,
    Bot,
    on,
    guard,
    command,
    from,
    once,
    connect,
    disconnect,
    every,
    pipe,
    pair,
    HANDLERS,
    decorator,
} from '~/lib/bot';
export type { HandlerMeta, BotSchema, WorkflowStep } from '~/lib/bot';
