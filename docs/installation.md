# Instalacion

## Requisitos

- **Node.js** 18 o superior
- **npm**, **yarn** o **pnpm**
- Cuenta de WhatsApp activa

---

## Instalacion del paquete

=== "npm"
    ```bash
    npm install @arcaelas/whatsapp
    ```

=== "yarn"
    ```bash
    yarn add @arcaelas/whatsapp
    ```

=== "pnpm"
    ```bash
    pnpm add @arcaelas/whatsapp
    ```

---

## Dependencias opcionales

### Amazon S3 (para S3Engine)

Si planeas usar persistencia en S3, instala el cliente de AWS:

```bash
npm install @aws-sdk/client-s3
```

---

## Configuracion de TypeScript

La libreria esta escrita en TypeScript y proporciona tipos completos. Asegurate de tener una configuracion compatible:

```json title="tsconfig.json"
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  }
}
```

---

## Estructura de archivos

Cuando uses `FileEngine` (default), la libreria crea la siguiente estructura:

```
.baileys/
  default/                    # o el nombre que especifiques
    session/
      {key}/index             # Datos de sesion (creds, keys, etc.)
    contact/
      {jid}/index             # Datos de contacto
    chat/
      {jid}/
        index                 # Datos del chat
        message/
          index               # Indice "MID TIMESTAMP" por linea
          {mid}/
            index             # Metadata del mensaje (JSON)
            content           # Contenido binario (media)
```

!!! note "Normalizacion de IDs"
    Los caracteres `@` en JIDs se reemplazan por `_at_` en los nombres de directorios.
    Ejemplo: `5491112345678@s.whatsapp.net` → `5491112345678_at_s.whatsapp.net`

!!! tip "Consejo"
    Agrega `.baileys/` a tu `.gitignore` para no subir credenciales al repositorio.

---

## Variables de entorno

Para S3Engine, configura las credenciales de AWS:

```bash title=".env"
AWS_ACCESS_KEY_ID=tu_access_key
AWS_SECRET_ACCESS_KEY=tu_secret_key
AWS_REGION=us-east-1
```

Si usas IAM roles (EC2, Lambda, ECS), no necesitas credenciales explicitas.

---

## Verificar instalacion

Crea un archivo de prueba:

```typescript title="test.ts"
import { WhatsApp, MemoryEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({ engine: new MemoryEngine() });
console.log("Instalacion correcta!");
console.log("Clases disponibles:", {
  Chat: wa.Chat,
  Contact: wa.Contact,
  Message: wa.Message,
});
```

Ejecuta:

```bash
npx tsx test.ts
```

Si ves el mensaje de exito, la instalacion esta completa.

---

## Problemas comunes

### Error: Cannot find module 'baileys'

Asegurate de que baileys este instalado como dependencia:

```bash
npm install baileys
```

### Error: libffi.so.7 not found (Linux)

Instala las dependencias del sistema:

```bash
# Debian/Ubuntu
sudo apt-get install libffi-dev

# CentOS/RHEL
sudo yum install libffi-devel
```

### Error: ENOENT .baileys/default

El directorio se crea automaticamente en la primera conexion. Si persiste, verifica permisos de escritura.

---

## Siguiente paso

[:octicons-arrow-right-24: Primeros pasos](getting-started.md)
