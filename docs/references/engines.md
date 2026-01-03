# Engines de Persistencia

Los engines determinan donde se almacenan la sesion, contactos, chats y mensajes.

---

## Importacion

```typescript
import {
  Engine,       // Clase abstracta base (generica)
  Store,        // Wrapper tipado sobre Engine
  FileEngine,   // Persistencia en archivos
  MemoryEngine, // Persistencia en memoria
  S3Engine,     // Persistencia en Amazon S3
} from "@arcaelas/whatsapp";
```

---

## Arquitectura

El sistema de persistencia tiene dos capas:

1. **Engine** (abstracta): Define una API generica de `get/set/list` para almacenamiento de datos.
2. **Store** (wrapper): Provee metodos tipados (`contact()`, `chat()`, `message()`) sobre el Engine.

```
WhatsApp -> Store -> Engine (FileEngine/MemoryEngine/S3Engine)
```

---

## Engine (clase abstracta)

Define el contrato generico que deben implementar todos los engines.

### Metodos abstractos

```typescript
// Obtener un valor por su path
abstract get<T>(path: string): Promise<T | null>;

// Guardar o eliminar un valor (null = eliminar)
abstract set<T>(path: string, data: T | null): Promise<boolean>;

// Listar paths bajo un prefijo
abstract list(prefix: string, offset?: number, limit?: number): Promise<string[]>;
```

### Estructura de paths

Los paths siguen una convencion de directorios:

| Tipo | Patron | Ejemplo |
|------|--------|---------|
| Session | `session/{key}` | `session/creds` |
| Contact | `contact/{jid}` | `contact/5491112345678@s.whatsapp.net` |
| Chat | `chat/{jid}` | `chat/5491112345678@s.whatsapp.net` |
| Message | `chat/{cid}/message/{mid}` | `chat/5491112345678@s.whatsapp.net/message/ABC123` |
| Content | `chat/{cid}/message/{mid}.bin` | `chat/5491112345678@s.whatsapp.net/message/ABC123.bin` |

---

## FileEngine

Almacena datos en el sistema de archivos local. Es el engine por defecto.

### Constructor

```typescript
new FileEngine(basePath?: string)
```

| Parametro | Tipo | Default | Descripcion |
|-----------|------|---------|-------------|
| `basePath` | `string` | `.baileys/default` | Directorio base |

### Estructura de archivos

```
{basePath}/
  session/
    creds/index           # Credenciales JSON
    signal/
      {type}/{id}/index   # Claves de cifrado
  contact/
    {jid}/index           # Contacto JSON
  chat/
    {jid}/
      index               # Chat JSON
      message/
        index             # Indice: "MID TIMESTAMP\n"
        {mid}/
          index           # Mensaje JSON
          content         # Buffer binario
```

### Ejemplo

```typescript
import { WhatsApp, FileEngine } from "@arcaelas/whatsapp";

// Ruta por defecto
const wa1 = new WhatsApp();
// Equivalente a: new FileEngine(".baileys/default")

// Ruta personalizada
const wa2 = new WhatsApp({
  engine: new FileEngine(".baileys/mi-bot"),
});

// Multiples instancias con diferentes sesiones
const wa_produccion = new WhatsApp({
  engine: new FileEngine(".baileys/produccion"),
});

const wa_desarrollo = new WhatsApp({
  engine: new FileEngine(".baileys/desarrollo"),
});
```

### Notas

!!! tip "Backup"
    Puedes hacer backup copiando el directorio completo.

!!! warning "Permisos"
    Asegurate de tener permisos de escritura en el directorio.

---

## MemoryEngine

Almacena datos en memoria. Los datos se pierden al cerrar la aplicacion.

### Constructor

```typescript
new MemoryEngine()
```

No requiere parametros.

### Ejemplo

```typescript
import { WhatsApp, MemoryEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new MemoryEngine(),
});
```

### Casos de uso

- **Testing**: Pruebas unitarias sin archivos residuales
- **Bots efimeros**: Bots que no necesitan persistir mensajes
- **Desarrollo**: Probar sin afectar datos de produccion

### Notas

!!! warning "Perdida de datos"
    Al reiniciar, deberas escanear el QR nuevamente.

!!! info "Rendimiento"
    Es el engine mas rapido al no tener I/O de disco.

---

## S3Engine

Almacena datos en Amazon S3. Ideal para produccion y escalabilidad.

### Constructor

```typescript
new S3Engine(options: S3EngineOptions)
```

### Opciones

```typescript
interface S3EngineOptions {
  bucket: string;          // Nombre del bucket (requerido)
  prefix?: string;         // Prefijo de keys (default: ".baileys/default")
  credentials?: {
    region?: string;       // Region AWS
    accessKeyId?: string;  // Access key
    secretAccessKey?: string;
    sessionToken?: string; // Para credenciales temporales
  };
}
```

### Estructura S3

```
{prefix}/
  session/{key}                           # JSON
  contact/{id}/index                      # JSON
  chat/{cid}/index                        # JSON
  chat/{cid}/message/{mid}/index          # JSON
  chat/{cid}/message/{mid}/content        # Binary
  chat/{cid}/timestamp/{inverted}_{mid}   # Vacio (ordenamiento)
```

### Ejemplos

#### Con credenciales explicitas

```typescript
import { WhatsApp, S3Engine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new S3Engine({
    bucket: "mi-bucket-whatsapp",
    prefix: ".baileys/produccion",
    credentials: {
      region: "us-east-1",
      accessKeyId: "AKIAXXXXXXXXXXXXXXXX",
      secretAccessKey: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    },
  }),
});
```

#### Con variables de entorno

```typescript
// Usa AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
const wa = new WhatsApp({
  engine: new S3Engine({
    bucket: "mi-bucket-whatsapp",
  }),
});
```

#### Con IAM roles (EC2, Lambda, ECS)

```typescript
// Las credenciales se obtienen automaticamente del metadata service
const wa = new WhatsApp({
  engine: new S3Engine({
    bucket: "mi-bucket-whatsapp",
    prefix: `.baileys/${process.env.INSTANCE_ID}`,
  }),
});
```

### Configuracion del bucket

```json title="bucket-policy.json"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:user/mi-usuario"
      },
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::mi-bucket-whatsapp",
        "arn:aws:s3:::mi-bucket-whatsapp/*"
      ]
    }
  ]
}
```

### Notas

!!! tip "Costos"
    S3 cobra por almacenamiento y operaciones. Considera:
    - Usar S3 Intelligent-Tiering para archivos antiguos
    - Configurar lifecycle rules para eliminar mensajes viejos

!!! warning "Latencia"
    Las operaciones S3 tienen mayor latencia que archivos locales.

---

## Crear un Engine personalizado

Puedes crear tu propio engine para usar con PostgreSQL, MongoDB, Redis, etc.

### Ejemplo: PostgreSQL Engine

```typescript
import { Engine } from "@arcaelas/whatsapp";
import { Pool } from "pg";

export class PostgresEngine extends Engine {
  private pool: Pool;

  constructor(connectionString: string) {
    super();
    this.pool = new Pool({ connectionString });
  }

  async get<T>(path: string): Promise<T | null> {
    const result = await this.pool.query(
      "SELECT data FROM storage WHERE path = $1",
      [path]
    );
    return result.rows[0]?.data ?? null;
  }

  async set<T>(path: string, data: T | null): Promise<boolean> {
    if (data === null) {
      await this.pool.query("DELETE FROM storage WHERE path = $1", [path]);
    } else {
      await this.pool.query(
        "INSERT INTO storage (path, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (path) DO UPDATE SET data = $2, updated_at = NOW()",
        [path, data]
      );
    }
    return true;
  }

  async list(prefix: string, offset = 0, limit = 50): Promise<string[]> {
    const result = await this.pool.query(
      "SELECT path FROM storage WHERE path LIKE $1 ORDER BY updated_at DESC OFFSET $2 LIMIT $3",
      [`${prefix}%`, offset, limit]
    );
    return result.rows.map(r => r.path);
  }
}
```

### Uso

```typescript
import { WhatsApp } from "@arcaelas/whatsapp";
import { PostgresEngine } from "./PostgresEngine";

const wa = new WhatsApp({
  engine: new PostgresEngine(process.env.DATABASE_URL!),
});
```

---

## Comparacion de Engines

| Caracteristica | FileEngine | MemoryEngine | S3Engine |
|---------------|------------|--------------|----------|
| Persistencia | Si | No | Si |
| Escalabilidad | Baja | N/A | Alta |
| Latencia | Baja | Muy baja | Media |
| Costo | Disco local | RAM | Por uso |
| Backup | Manual | N/A | Automatico |
| Multi-instancia | No | No | Si |
| Ideal para | Desarrollo | Testing | Produccion |

---

## Migracion entre Engines

No hay migracion automatica. Para cambiar de engine:

1. Exporta datos del engine actual
2. Importa al nuevo engine
3. O simplemente reconecta (perderas historial local)

```typescript
import { Store } from "@arcaelas/whatsapp";

// Ejemplo: Migrar de File a S3 usando Store
async function migrate(from: Store, to: Store) {
  // Migrar contactos
  const contacts = await from.contacts(0, 10000);
  for (const contact of contacts) {
    await to.contact(contact.id, contact);
  }

  // Migrar chats
  const chats = await from.chats(0, 10000);
  for (const chat of chats) {
    await to.chat(chat.id, chat);

    // Migrar mensajes del chat
    const messages = await from.messages(chat.id, 0, 100000);
    for (const msg of messages) {
      await to.message(chat.id, msg.id, msg);

      // Migrar contenido
      const content = await from.content(chat.id, msg.id);
      if (content) {
        await to.content(chat.id, msg.id, content);
      }
    }
  }
}

// Uso:
const fromStore = new Store(new FileEngine(".baileys/old"));
const toStore = new Store(new S3Engine({ bucket: "my-bucket" }));
await migrate(fromStore, toStore);
```
