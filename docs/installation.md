# Installation

## Requirements

- **Node.js** 18 or higher
- **npm**, **yarn** or **pnpm**
- Active WhatsApp account

---

## Package installation

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

## TypeScript configuration

The library is written in TypeScript and provides complete types. Make sure you have a compatible configuration:

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

## File structure

When using `FileEngine` (default), the library creates the following structure:

```
.baileys/
  default/                    # or the name you specify
    session/
      {key}/index             # Session data (creds, keys, etc.)
    contact/
      {jid}/index             # Contact data
    chat/
      {jid}/
        index                 # Chat data
        message/
          index               # Index "MID TIMESTAMP" per line
          {mid}/
            index             # Message metadata (JSON)
            content           # Binary content (media)
```

!!! note "ID normalization"
    The `@` characters in JIDs are replaced with `_at_` in directory names.
    Example: `5491112345678@s.whatsapp.net` → `5491112345678_at_s.whatsapp.net`

!!! tip "Tip"
    Add `.baileys/` to your `.gitignore` to avoid uploading credentials to the repository.

---

## Verify installation

Create a test file:

```typescript title="test.ts"
import { WhatsApp, FileEngine } from "@arcaelas/whatsapp";

const wa = new WhatsApp({
  engine: new FileEngine(".baileys/test"),
});

console.log("Installation successful!");
console.log("Available classes:", {
  Chat: wa.Chat,
  Contact: wa.Contact,
  Message: wa.Message,
});
```

Run:

```bash
npx tsx test.ts
```

If you see the success message, the installation is complete.

---

## Common issues

### Error: Cannot find module 'baileys'

Make sure baileys is installed as a dependency:

```bash
npm install baileys
```

### Error: libffi.so.7 not found (Linux)

Install system dependencies:

```bash
# Debian/Ubuntu
sudo apt-get install libffi-dev

# CentOS/RHEL
sudo yum install libffi-devel
```

### Error: ENOENT .baileys/default

The directory is created automatically on first connection. If it persists, check write permissions.

---

## Next step

[:octicons-arrow-right-24: Getting started](getting-started.md)
