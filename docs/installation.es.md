# Instalación

Instala `@arcaelas/whatsapp` en cualquier proyecto de Node.js. El paquete se publica en npm como una compilación dual ESM/CJS con las declaraciones de TypeScript incluidas.

---

## 1. Requisitos

- **Node.js >= 20**. La librería incluye un polyfill de `Symbol.metadata` para que la sub-entrada `/decorators` funcione también en Node 20 y 21; en Node 22+ se usa el símbolo nativo.
- Un **gestor de paquetes**. `yarn` es la opción recomendada; `npm` y `pnpm` también funcionan.

!!! note "Nota"
    No se requieren claves de API externas. El emparejamiento sucede localmente a través de baileys, ya sea por PIN telefónico o escaneando un código QR.

---

## 2. Instala el paquete

=== "yarn"

    ```bash
    yarn add @arcaelas/whatsapp
    ```

=== "npm"

    ```bash
    npm install @arcaelas/whatsapp
    ```

=== "pnpm"

    ```bash
    pnpm add @arcaelas/whatsapp
    ```

Esto incorpora las únicas dependencias en tiempo de ejecución que la librería necesita: `baileys@7.0.0-rc.9`, `pino` y `qrcode`.

---

## 3. Dependencias peer opcionales

El motor Redis depende de [`ioredis`](https://github.com/redis/ioredis) pero no te obliga a instalarlo a menos que realmente lo uses.

```bash
yarn add ioredis
```

Si solo usas `FileSystemEngine` o tu propia implementación personalizada de `Engine`, puedes omitir este paso por completo.

---

## 4. Exports del paquete

El paquete expone dos puntos de entrada a través de su mapa `exports`:

```typescript title="entrada principal"
import { WhatsApp, FileSystemEngine, RedisEngine } from "@arcaelas/whatsapp";
```

```typescript title="DSL de decoradores"
import { Bot, on, guard, command, pair } from "@arcaelas/whatsapp/decorators";
```

Ambas entradas entregan compilaciones ESM y CJS — tu bundler o cargador de Node elegirá la correcta automáticamente.

---

## 5. Configuración de TypeScript

La entrada principal no necesita flags especiales del compilador. Para la sub-entrada de decoradores tampoco hay nada que configurar: la librería apunta a **decoradores Stage 3** (la forma estándar soportada nativamente por TypeScript 5+), por lo que **no** necesitas `experimentalDecorators` ni `emitDecoratorMetadata` en tu `tsconfig.json`.

Un `tsconfig.json` mínimo es suficiente:

```json title="tsconfig.json"
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "NodeNext",
        "moduleResolution": "NodeNext",
        "strict": true,
        "esModuleInterop": true
    }
}
```

!!! tip "Consejo"
    Para ejecutar TypeScript directamente sin un paso de compilación explícito, usa [`tsx`](https://github.com/privatenumber/tsx): `npx tsx index.ts`.

---

## 6. Entorno

No se requiere configuración de `.env` para comenzar. baileys maneja el protocolo de WhatsApp Web localmente y persiste los datos de sesión a través del `Engine` que proporciones. Si eliges `RedisEngine`, configura tu conexión a Redis mediante `ioredis` como lo harías normalmente.

---

Una vez instalado, dirígete a [Primeros pasos](getting-started.es.md) para configurar tu primera sesión.
