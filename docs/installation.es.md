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

Esto arrastra las únicas dependencias de runtime que la librería necesita: `baileys@7.0.0-rc14`, `pino` y `qrcode`.

---

## 3. Peers opcionales

No hace falta nada extra para `FileSystemEngine` ni para un `Engine` propio. El resto se instala solo
cuando usas la función correspondiente:

| Paquete                | Necesario para                                            |
| ---------------------- | ----------------------------------------------------------- |
| `@aws-sdk/client-s3`   | `S3Engine`                                                 |
| `sharp` **o** `jimp`   | `wa.profile({ photo })` — baileys redimensiona la foto     |
| `ioredis`              | El cliente que le pasas a `RedisEngine`                    |
| `better-sqlite3`       | La base que le pasas a `SQLiteEngine` en Node < 22         |

```bash
yarn add @aws-sdk/client-s3   # solo si usas S3Engine
yarn add sharp                # solo si vas a poner foto de perfil
yarn add ioredis              # solo si usas RedisEngine
```

!!! tip "SQLite sin dependencias"
    `SQLiteEngine` recibe una base ya abierta, así que en **Node 22+** basta el módulo nativo
    `node:sqlite`:

    ```typescript
    import { DatabaseSync } from 'node:sqlite';
    import { SQLiteEngine } from '@arcaelas/whatsapp';

    const engine = new SQLiteEngine(new DatabaseSync('.sessions/584144709840.db'));
    ```

    En Node 20 y 21, instala `better-sqlite3` y pasa `new Database(file)` en su lugar.

---

## 4. Exports del paquete

El paquete expone dos puntos de entrada a través de su mapa `exports`:

```typescript title="entrada principal"
import { WhatsApp, FileSystemEngine, SQLiteEngine, RedisEngine, S3Engine } from "@arcaelas/whatsapp";
```

```typescript title="DSL de decoradores"
import { WhatsAppBot, Bot, on, guard, command, pair } from "@arcaelas/whatsapp/decorators";
```

Ambas entradas incluyen compilaciones ESM y CJS — tu bundler o el loader de Node elegirá la correcta automáticamente.

!!! warning "Los motores no están en la entrada de decoradores"
    `@arcaelas/whatsapp/decorators` exporta solo la API de decoradores. Las entidades y los motores
    siempre vienen de `@arcaelas/whatsapp`.

---

## 5. Configuración de TypeScript

La entrada principal no necesita flags especiales del compilador. Para la sub-entrada de decoradores tampoco hay nada que configurar: la librería apunta a **decoradores Stage 3** (la forma estándar soportada nativamente por TypeScript 5+), así que **no** necesitas `experimentalDecorators` ni `emitDecoratorMetadata` en tu `tsconfig.json`.

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

No se requiere configuración de `.env` para empezar. baileys maneja el protocolo de WhatsApp Web localmente y persiste los datos de sesión a través del `Engine` que le proporciones. Si eliges `RedisEngine`, configura tu conexión de Redis mediante `ioredis` como lo harías normalmente.

---

Una vez instalado, dirígete a [Primeros pasos](getting-started.es.md) para montar tu primera sesión.
