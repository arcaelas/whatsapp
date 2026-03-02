# Esquemas de Datos

Esquemas estandarizados para almacenamiento en `@arcaelas/whatsapp`.

**Principios:**
- **Minimalista**: Solo campos esenciales
- **Plano**: Sin anidación innecesaria
- **Tipado**: Tipos explícitos
- **Temporal**: Marcas de tiempo en milisegundos UTC
- **Anulable**: `null` para ausencia, nunca `undefined`

---

# Esquemas Crudos

Las clases funcionan con objetos "crudos" que contienen propiedades del protocolo. Los getters/setters exponen una API simplificada.

---

## Contacto Crudo

Propiedades del objeto de contacto crudo (`IContactRaw`).

| Property | Type | Descripción |
|----------|------|-------------|
| `id` | `string` | JID de contacto único |
| `lid` | `string \| null` | ID alternativo en formato LID |
| `name` | `string \| null` | Nombre guardado en libreta de direcciones |
| `notify` | `string \| null` | Nombre enviado por push del perfil del contacto |
| `verifiedName` | `string \| null` | Nombre de cuenta comercial verificado |
| `imgUrl` | `string \| null` | URL de foto de perfil (puede vencer o ser `"changed"`) |
| `status` | `string \| null` | Bio/estado de perfil del contacto |

### Ejemplo Crudo

```json
{
    "id": "584144709840@s.whatsapp.net",
    "lid": "140913951141911@lid",
    "name": "Juan Perez",
    "notify": "Juanito",
    "verifiedName": null,
    "imgUrl": "https://pps.whatsapp.net/v/t61.24694-24/...",
    "status": "Available 24/7"
}
```

---

## Chat Crudo

Propiedades del objeto de conversación crudo (`IChatRaw`).

| Property | Type | Descripción |
|----------|------|-------------|
| `id` | `string` | JID de chat único |
| `name` | `string \| null` | Nombre del chat o grupo |
| `displayName` | `string \| null` | Nombre alternativo para mostrar |
| `description` | `string \| null` | Descripción del grupo |
| `unreadCount` | `number \| null` | Número de mensajes no leídos |
| `readOnly` | `boolean \| null` | Si el chat es de solo lectura |
| `archived` | `boolean \| null` | Si el chat está archivado |
| `pinned` | `number \| null` | Marca de tiempo de fijación |
| `muteEndTime` | `number \| null` | Marca de tiempo de expiración de silencio |
| `markedAsUnread` | `boolean \| null` | Si fue marcado manualmente como no leído |
| `participant` | `IGroupParticipant[] \| null` | Lista de participantes del grupo |
| `createdBy` | `string \| null` | JID del creador del grupo |
| `createdAt` | `number \| null` | Marca de tiempo de creación |
| `ephemeralExpiration` | `number \| null` | Duración del mensaje efímero (segundos) |

### IGroupParticipant

| Property | Type | Descripción |
|----------|------|-------------|
| `id` | `string` | JID del participante |
| `admin` | `string \| null` | Rol de administrador: `null`, `"admin"`, `"superadmin"` |

### Ejemplo Crudo

```json
{
    "id": "120363123456789@g.us",
    "name": "Development Team",
    "displayName": null,
    "description": "Project coordination group",
    "unreadCount": 5,
    "readOnly": false,
    "archived": false,
    "pinned": 1767371367857,
    "muteEndTime": null,
    "markedAsUnread": false,
    "createdAt": 1700000000,
    "createdBy": "584144709840@s.whatsapp.net",
    "participant": [
        { "id": "584144709840@s.whatsapp.net", "admin": "superadmin" },
        { "id": "584121234567@s.whatsapp.net", "admin": null }
    ],
    "ephemeralExpiration": 604800
}
```

---

## Mensaje Crudo

Propiedades del objeto de mensaje crudo. La librería almacena dos partes: `IMessageIndex` (metadatos) y `WAMessage` (crudo Baileys completo).

### MessageKey (key)

| Property | Type | Descripción |
|----------|------|-------------|
| `key.remoteJid` | `string \| null` | JID del chat |
| `key.fromMe` | `boolean \| null` | Si el mensaje es propio |
| `key.id` | `string \| null` | ID de mensaje único |
| `key.participant` | `string \| null` | JID del remitente (en grupos) |

### Propiedades Principales

| Property | Type | Descripción |
|----------|------|-------------|
| `message` | `Message \| null` | Contenido del mensaje (ver Contenido del Mensaje) |
| `messageTimestamp` | `number \| null` | Marca de tiempo de creación |
| `status` | `MessageStatus \| null` | Estado de entrega (0-5) |
| `pushName` | `string \| null` | Nombre del remitente |
| `broadcast` | `boolean \| null` | Si es un mensaje broadcast |
| `starred` | `boolean \| null` | Si está marcado con estrella |
| `duration` | `number \| null` | Duración en segundos (audio/vídeo) |
| `labels` | `string[] \| null` | Etiquetas del mensaje |

### Estados de Mensaje (status)

| Value | Constant | Descripción |
|-------|----------|-------------|
| `0` | `ERROR` | Error en envío |
| `1` | `PENDING` | Envío pendiente |
| `2` | `SERVER_ACK` | Servidor confirmó |
| `3` | `DELIVERED` | Entregado al receptor |
| `4` | `READ` | Leído por el receptor |
| `5` | `PLAYED` | Reproducido (audio/vídeo) |

### Propiedades de Medios

| Property | Type | Descripción |
|----------|------|-------------|
| `mediaCiphertextSha256` | `Uint8Array \| null` | Hash SHA256 de medios encriptados |
| `mediaData` | `MediaData \| null` | Datos de medios |
| `quotedStickerData` | `MediaData \| null` | Datos de sticker citado |

### Propiedades Temporales

| Property | Type | Descripción |
|----------|------|-------------|
| `ephemeralStartTimestamp` | `number \| null` | Inicio del temporizador de expiración |
| `ephemeralDuration` | `number \| null` | Duración hasta expiración (segundos) |
| `ephemeralOffToOn` | `boolean \| null` | Si cambió de apagado a encendido |
| `ephemeralOutOfSync` | `boolean \| null` | Si está desincronizado |
| `revokeMessageTimestamp` | `number \| null` | Marca de tiempo de revocación |

### Propiedades de Reacción y Encuesta

| Property | Type | Descripción |
|----------|------|-------------|
| `reactions` | `Reaction[] \| null` | Reacciones del mensaje |
| `pollUpdates` | `PollUpdate[] \| null` | Actualizaciones de encuesta |
| `pollAdditionalMetadata` | `PollAdditionalMetadata \| null` | Metadatos adicionales de encuesta |
| `messageSecret` | `Uint8Array \| null` | Secreto para desencriptar votos |

### Propiedades de Recibos

| Property | Type | Descripción |
|----------|------|-------------|
| `userReceipt` | `UserReceipt[] \| null` | Recibos de lectura por usuario |
| `messageC2STimestamp` | `number \| null` | Marca de tiempo de cliente a servidor |

### Propiedades de Stub (Mensajes de Sistema)

| Property | Type | Descripción |
|----------|------|-------------|
| `messageStubType` | `StubType \| null` | Tipo de mensaje de sistema |
| `messageStubParameters` | `string[] \| null` | Parámetros del stub |

### Propiedades Comerciales

| Property | Type | Descripción |
|----------|------|-------------|
| `bizPrivacyStatus` | `BizPrivacyStatus \| null` | Estado de privacidad comercial |
| `verifiedBizName` | `string \| null` | Nombre comercial verificado |

### Propiedades de Estado/Historial

| Property | Type | Descripción |
|----------|------|-------------|
| `statusPsa` | `StatusPSA \| null` | PSA de estado |
| `statusAlreadyViewed` | `boolean \| null` | Si el estado ya fue visto |
| `isMentionedInStatus` | `boolean \| null` | Si fue mencionado en estado |
| `statusMentions` | `string[] \| null` | JIDs mencionados en estado |
| `statusMentionMessageInfo` | `StatusMentionMessage \| null` | Información de mensaje de mención |
| `statusMentionSources` | `string[] \| null` | Fuentes de mención |

### Propiedades de Fijación

| Property | Type | Descripción |
|----------|------|-------------|
| `pinInChat` | `PinInChat \| null` | Información de mensaje fijado |
| `keepInChat` | `KeepInChat \| null` | Mantener en chat |

### Propiedades de Bot/IA

| Property | Type | Descripción |
|----------|------|-------------|
| `is1PBizBotMessage` | `boolean \| null` | Si es un mensaje de bot comercial 1P |
| `botMessageInvokerJid` | `string \| null` | JID que invocó el bot |
| `botTargetId` | `string \| null` | ID de destino del bot |
| `isSupportAiMessage` | `boolean \| null` | Si es un mensaje de soporte IA |
| `supportAiCitations` | `Citation[] \| null` | Citas de IA |
| `agentId` | `string \| null` | ID del agente |

### Propiedades Internas

| Property | Type | Descripción |
|----------|------|-------------|
| `ignore` | `boolean \| null` | Si se debe ignorar |
| `multicast` | `boolean \| null` | Si es multicast |
| `urlText` | `boolean \| null` | Si contiene URL de texto |
| `urlNumber` | `boolean \| null` | Si contiene URL numérica |
| `clearMedia` | `boolean \| null` | Si se deben limpiar medios |
| `photoChange` | `PhotoChange \| null` | Cambio de foto |
| `futureproofData` | `Uint8Array \| null` | Datos de compatibilidad futura |
| `isGroupHistoryMessage` | `boolean \| null` | Si es mensaje de historial de grupo |
| `originalSelfAuthorUserJidString` | `string \| null` | JID del autor original |
| `premiumMessageInfo` | `PremiumMessageInfo \| null` | Información de mensaje premium |
| `commentMetadata` | `CommentMetadata \| null` | Metadatos de comentario |
| `eventResponses` | `EventResponse[] \| null` | Respuestas de evento |
| `eventAdditionalMetadata` | `EventAdditionalMetadata \| null` | Metadatos adicionales de evento |
| `reportingTokenInfo` | `ReportingTokenInfo \| null` | Información del token de reporte |
| `newsletterServerId` | `number \| null` | ID de servidor de boletín |
| `targetMessageId` | `MessageKey \| null` | ID de mensaje de destino |
| `messageAddOns` | `MessageAddOn[] \| null` | Complementos de mensaje |
| `paymentInfo` | `PaymentInfo \| null` | Información de pago |
| `quotedPaymentInfo` | `PaymentInfo \| null` | Información de pago citada |
| `finalLiveLocation` | `LiveLocationMessage \| null` | Ubicación en vivo final |

### Ejemplo Crudo

```json
{
    "key": {
        "remoteJid": "584144709840@s.whatsapp.net",
        "fromMe": false,
        "id": "AC07DE0D18FA8254897A26C90B2FFD98",
        "participant": null
    },
    "message": {
        "extendedTextMessage": {
            "text": "Hello world",
            "contextInfo": {
                "stanzaId": "AC9BE0D81D965A3C240B6ACAA891C6FD",
                "participant": "584121234567@s.whatsapp.net",
                "isForwarded": false,
                "forwardingScore": 0,
                "expiration": 604800
            }
        }
    },
    "messageTimestamp": 1767366759,
    "status": 4,
    "pushName": "Juan Perez",
    "broadcast": false,
    "starred": false,
    "duration": null,
    "labels": [],
    "ephemeralStartTimestamp": 1767366759,
    "ephemeralDuration": 604800,
    "reactions": [
        { "text": "❤️", "groupingKey": "❤️", "senderTimestampMs": 1767366800000 }
    ],
    "userReceipt": [
        { "userJid": "584144709840@s.whatsapp.net", "readTimestamp": 1767366800 }
    ]
}
```

---

## Contenido del Mensaje

Tipos de contenido dentro de `message`.

### Texto

| Property | Type | Descripción |
|----------|------|-------------|
| `conversation` | `string` | Texto simple |
| `extendedTextMessage.text` | `string` | Texto con metadatos |
| `extendedTextMessage.contextInfo` | `ContextInfo` | Información de contexto |

### Medios

| Property | Type | Descripción |
|----------|------|-------------|
| `imageMessage` | `ImageMessage` | Mensaje de imagen |
| `videoMessage` | `VideoMessage` | Mensaje de vídeo |
| `audioMessage` | `AudioMessage` | Mensaje de audio |
| `documentMessage` | `DocumentMessage` | Mensaje de documento |
| `stickerMessage` | `StickerMessage` | Mensaje de sticker |

### Propiedades de Medios (común)

| Property | Type | Descripción |
|----------|------|-------------|
| `url` | `string` | URL de descarga (temporal) |
| `directPath` | `string` | Ruta de CDN directo |
| `mediaKey` | `Uint8Array` | Clave de desencriptación |
| `mimetype` | `string` | Tipo MIME |
| `fileLength` | `number` | Tamaño en bytes |
| `fileSha256` | `Uint8Array` | Hash SHA256 del archivo |
| `fileEncSha256` | `Uint8Array` | Hash SHA256 encriptado |
| `mediaKeyTimestamp` | `number` | Marca de tiempo de clave |
| `jpegThumbnail` | `Uint8Array` | Miniatura JPEG en base64 |
| `caption` | `string` | Leyenda de medios |
| `width` | `number` | Ancho en píxeles |
| `height` | `number` | Alto en píxeles |
| `seconds` | `number` | Duración (audio/vídeo) |
| `ptt` | `boolean` | Push-to-talk (nota de voz) |
| `waveform` | `Uint8Array` | Forma de onda de audio |
| `streamingSidecar` | `Uint8Array` | Datos de transmisión |

### Ubicación

| Property | Type | Descripción |
|----------|------|-------------|
| `locationMessage.degreesLatitude` | `number` | Latitud |
| `locationMessage.degreesLongitude` | `number` | Longitud |
| `liveLocationMessage.degreesLatitude` | `number` | Latitud en vivo |
| `liveLocationMessage.degreesLongitude` | `number` | Longitud en vivo |
| `liveLocationMessage.sequenceNumber` | `number` | Número de secuencia |
| `liveLocationMessage.caption` | `string` | Leyenda de ubicación |

### Encuesta

| Property | Type | Descripción |
|----------|------|-------------|
| `pollCreationMessage.name` | `string` | Pregunta de encuesta |
| `pollCreationMessage.options` | `Option[]` | Opciones de respuesta |
| `pollCreationMessage.selectableOptionsCount` | `number` | Número seleccionable |
| `pollUpdateMessage.pollCreationMessageKey` | `MessageKey` | Referencia de encuesta |
| `pollUpdateMessage.vote` | `PollEncValue` | Voto encriptado |

### Reacción

| Property | Type | Descripción |
|----------|------|-------------|
| `reactionMessage.key` | `MessageKey` | Mensaje siendo reaccionado |
| `reactionMessage.text` | `string` | Emoji de reacción |
| `reactionMessage.senderTimestampMs` | `number` | Marca de tiempo del remitente |

### Protocolo

| Property | Type | Descripción |
|----------|------|-------------|
| `protocolMessage.type` | `ProtocolMessageType` | Tipo de protocolo |
| `protocolMessage.key` | `MessageKey` | Mensaje de destino |
| `protocolMessage.editedMessage` | `Message` | Mensaje editado |
| `protocolMessage.timestampMs` | `number` | Marca de tiempo de acción |

### Tipos de ProtocolMessage

| Value | Constant | Descripción |
|-------|----------|-------------|
| `0` | `REVOKE` | Eliminar mensaje |
| `3` | `EPHEMERAL_SETTING` | Configurar mensajes efímeros |
| `6` | `EPHEMERAL_SYNC_RESPONSE` | Respuesta de sincronización |
| `7` | `HISTORY_SYNC_NOTIFICATION` | Notificación de historial |
| `14` | `MESSAGE_EDIT` | Editar mensaje |

### ContextInfo

| Property | Type | Descripción |
|----------|------|-------------|
| `stanzaId` | `string` | ID de mensaje citado |
| `participant` | `string` | Autor de mensaje citado |
| `quotedMessage` | `Message` | Contenido de mensaje citado |
| `isForwarded` | `boolean` | Si fue reenviado |
| `forwardingScore` | `number` | Veces reenviado |
| `expiration` | `number` | Segundos hasta expiración |
| `ephemeralSettingTimestamp` | `number` | Marca de tiempo de configuración |
| `mentionedJid` | `string[]` | JIDs mencionados |

---

# Esquemas de API

Esquemas simplificados expuestos por las clases.

---

## Contacto

| Property | Type | Raw Source | Descripción |
|----------|------|------------|-------------|
| `id` | `string` | `id` | JID de contacto único |
| `name` | `string` | `name \|\| notify \|\| id.split("@")[0]` | Nombre del contacto |
| `photo` | `string \| null` | `imgUrl` | URL de foto de perfil |
| `phone` | `string` | `id.split("@")[0]` | Número de teléfono |
| `content` | `string` | `status \|\| ""` | Bio del contacto |

### Clave de Almacenamiento

```
contact/{id}/index
```

**Formato almacenado**: JSON `IContactRaw` (id, lid, name, notify, verifiedName, imgUrl, status).

---

## Chat

| Property | Type | Raw Source | Descripción |
|----------|------|------------|-------------|
| `id` | `string` | `id` | JID de chat único |
| `type` | `"contact" \| "group"` | Derivado de `id` | Tipo de chat |
| `name` | `string` | `name \|\| displayName \|\| id.split("@")[0]` | Nombre del chat |
| `content` | `string` | `description \|\| ""` | Descripción |
| `pined` | `boolean` | `pinned !== null` | Si está fijado |
| `archived` | `boolean` | `archived \|\| false` | Si está archivado |
| `muted` | `number \| false` | `muteEndTime \|\| false` | Marca de tiempo de fin de silencio |
| `readed` | `boolean` | `unreadCount === 0 && !markedAsUnread` | Si fue leído |
| `readonly` | `boolean` | `readOnly \|\| false` | Si es de solo lectura |

### Clave de Almacenamiento

```
chat/{id}/index
```

**Formato almacenado**: JSON `IChatRaw` (id, name, displayName, description, unreadCount, readOnly, archived, pinned, muteEndTime, markedAsUnread, participant, createdBy, createdAt, ephemeralExpiration).

---

## Mensaje

### IMessageIndex (almacenado en `chat/{cid}/message/{id}/index`)

| Property | Type | Raw Source | Descripción |
|----------|------|------------|-------------|
| `id` | `string` | `key.id` | ID único |
| `cid` | `string` | `key.remoteJid` | ID del chat |
| `mid` | `string \| null` | `contextInfo.stanzaId` | Mensaje padre |
| `me` | `boolean` | `key.fromMe` | Si es mensaje propio |
| `type` | `MessageType` | Derivado de `message` | Tipo de mensaje |
| `author` | `string` | `key.participant \|\| key.remoteJid` | Autor |
| `status` | `MESSAGE_STATUS` | `status` | Estado de entrega |
| `starred` | `boolean` | `starred` | Si está marcado con estrella |
| `forwarded` | `boolean` | `contextInfo.isForwarded` | Si fue reenviado |
| `created_at` | `number` | `messageTimestamp * 1000` | Creación (ms) |
| `deleted_at` | `number \| null` | `ephemeralStartTimestamp + ephemeralDuration` | Expiración |
| `mime` | `string` | Derivado de `message` | Tipo MIME |
| `caption` | `string` | `*.caption \|\| ""` | Leyenda |
| `edited` | `boolean` | Set on edit | Si fue editado |

### Métodos de Instancia

| Method | Return Type | Descripción |
|--------|-------------|-------------|
| `content()` | `Promise<Buffer>` | Obtiene contenido del mensaje como Buffer (async) |
| `stream()` | `Promise<Readable>` | Obtiene contenido como Readable stream (async) |
| `react(emoji)` | `Promise<boolean>` | Reacciona al mensaje |
| `edit(text)` | `Promise<boolean>` | Edita el mensaje (solo mensajes propios) |
| `remove()` | `Promise<boolean>` | Elimina el mensaje para todos |
| `forward(to_cid)` | `Promise<boolean>` | Reenvía a otro chat |
| `text(content)` | `Promise<Message \| null>` | Responde con texto |
| `image(buffer, caption?)` | `Promise<Message \| null>` | Responde con imagen |
| `video(buffer, caption?)` | `Promise<Message \| null>` | Responde con vídeo |
| `audio(buffer, ptt?)` | `Promise<Message \| null>` | Responde con audio |
| `location(opts)` | `Promise<Message \| null>` | Responde con ubicación |
| `poll(opts)` | `Promise<Message \| null>` | Responde con encuesta |

### Almacenamiento

| Key | Contenido |
|-----|---------|
| `chat/{cid}/message/{id}/index` | JSON con metadatos IMessageIndex |
| `chat/{cid}/message/{id}/content` | Buffer base64 |
| `chat/{cid}/message/{id}/raw` | WAMessage crudo completo (para reenvío, descarga) |

---

## Resumen de Campos

| Entity | Getters de API | Campos Crudos (IChatRaw/IContactRaw) |
|--------|-------------|-----------------------------------|
| **Contact** | 5 (id, name, photo, phone, content) | 7 (id, lid, name, notify, verifiedName, imgUrl, status) |
| **Chat** | 9 (id, type, name, content, pined, archived, muted, readed, readonly) | 14 |
| **Message** | 14 campos de índice + métodos async | WAMessage (50+) |

---

# Directrices de Almacenamiento

Estrategias de almacenamiento para diferentes backends.

---

## Campos Primarios (Columnas/Índices)

Campos escalares utilizados para filtros/búsquedas:

| Entity | Campos Primarios |
|--------|----------------|
| **Contact** | `id` |
| **Chat** | `id`, `archived`, `pinned`, `muteEndTime` |
| **Message** | `id`, `cid`, `me`, `author`, `status`, `created_at`, `starred` |

---

## Estrategia NoSQL (Key-Value)

Para FileEngine, RedisEngine u otros almacenes de key-value.

### Estructura de Claves

```
contact/{id}/index          -> IContactRaw JSON
lid/{lid}                   -> JID string
chat/{id}/index             -> IChatRaw JSON
chat/{cid}/messages         -> Archivo de índice de mensajes
chat/{cid}/message/{id}/index   -> IMessageIndex JSON
chat/{cid}/message/{id}/content -> Buffer base64
chat/{cid}/message/{id}/raw     -> WAMessage JSON
```

### Formato de Almacenamiento

```json
// contact/{id}/index -- almacena IContactRaw
{
    "id": "584144709840@s.whatsapp.net",
    "lid": "140913951141911@lid",
    "name": "Juan Perez",
    "notify": "Juanito",
    "verifiedName": null,
    "imgUrl": "https://...",
    "status": "Available"
}

// chat/{id}/index -- almacena IChatRaw
{
    "id": "120363123456789@g.us",
    "name": "Dev Team",
    "displayName": null,
    "description": "Group description",
    "unreadCount": 5,
    "readOnly": false,
    "archived": false,
    "pinned": 1767371367857,
    "muteEndTime": null,
    "markedAsUnread": false,
    "participant": [
        { "id": "584144709840@s.whatsapp.net", "admin": "superadmin" }
    ],
    "createdBy": "584144709840@s.whatsapp.net",
    "createdAt": 1700000000,
    "ephemeralExpiration": 604800
}

// chat/{cid}/message/{id}/index -- almacena IMessageIndex
{
    "id": "AC07DE0D18FA8254897A26C90B2FFD98",
    "cid": "584144709840@s.whatsapp.net",
    "mid": null,
    "me": false,
    "type": "text",
    "author": "584144709840@s.whatsapp.net",
    "status": 4,
    "starred": false,
    "forwarded": false,
    "created_at": 1767366759000,
    "deleted_at": null,
    "mime": "text/plain",
    "caption": "",
    "edited": false
}
```

### Ventajas

- **Simplicidad**: Todo es JSON, sin migraciones
- **Atomicidad**: Un registro = una clave
- **Flexibilidad**: Agregar campos sin alterar estructura

### Consideraciones

**Listados y Filtros:**
```
# Listar contactos
engine.list("contact/")

# Listar mensajes de un chat
Leer chat/{cid}/messages index, luego obtener cada mensaje

# Filtrar mensajes marcados con estrella
Requiere iterar y filtrar en memoria
```

**Limpieza (cascade delete):**
```
# Eliminar chat y todos sus mensajes
engine.set("chat/{cid}", null)
# El engine elimina cascadingly todas las subclaves: chat/{cid}/*
```

**Datos Huérfanos:**
- Al eliminar chat: `set("chat/{cid}", null)` elimina todas las claves con prefijo `chat/{cid}/`
- Al eliminar contacto: `set("contact/{id}/index", null)` (sin dependencias)

---

## Estrategia SQL (Relacional)

Para PostgreSQL, MySQL, SQLite.

### Esquema de Tabla

```sql
-- Contactos (almacena campos IContactRaw)
CREATE TABLE contacts (
    id VARCHAR(50) PRIMARY KEY,
    lid VARCHAR(50),
    name VARCHAR(255),
    notify VARCHAR(255),
    verified_name VARCHAR(255),
    img_url TEXT,
    status TEXT
);

-- Chats (almacena campos IChatRaw)
CREATE TABLE chats (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255),
    display_name VARCHAR(255),
    description TEXT,
    unread_count INTEGER,
    read_only BOOLEAN DEFAULT FALSE,
    archived BOOLEAN DEFAULT FALSE,
    pinned BIGINT,  -- timestamp o NULL
    mute_end_time BIGINT,  -- timestamp o NULL
    marked_as_unread BOOLEAN DEFAULT FALSE,
    created_by VARCHAR(50),
    created_at BIGINT,
    ephemeral_expiration INTEGER
);

-- Participantes del grupo
CREATE TABLE chat_participants (
    chat_id VARCHAR(50) REFERENCES chats(id) ON DELETE CASCADE,
    contact_id VARCHAR(50),
    admin VARCHAR(20),  -- NULL, 'admin', 'superadmin'
    PRIMARY KEY (chat_id, contact_id)
);

-- Mensajes (almacena campos IMessageIndex)
CREATE TABLE messages (
    id VARCHAR(50),
    cid VARCHAR(50) REFERENCES chats(id) ON DELETE CASCADE,
    mid VARCHAR(50),  -- mensaje padre (respuesta)
    me BOOLEAN NOT NULL,
    type VARCHAR(20) NOT NULL,
    author VARCHAR(50) NOT NULL,
    status SMALLINT DEFAULT 1,
    starred BOOLEAN DEFAULT FALSE,
    forwarded BOOLEAN DEFAULT FALSE,
    created_at BIGINT NOT NULL,
    deleted_at BIGINT,
    mime VARCHAR(100),
    caption TEXT,
    edited BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (cid, id)
);

-- Contenido del mensaje (separado para eficiencia)
CREATE TABLE message_contents (
    cid VARCHAR(50),
    message_id VARCHAR(50),
    content BYTEA,
    raw JSONB,
    PRIMARY KEY (cid, message_id),
    FOREIGN KEY (cid, message_id) REFERENCES messages(cid, id) ON DELETE CASCADE
);

-- Reacciones
CREATE TABLE message_reactions (
    cid VARCHAR(50),
    message_id VARCHAR(50),
    reactor_id VARCHAR(50),
    emoji VARCHAR(10),
    timestamp BIGINT,
    PRIMARY KEY (cid, message_id, reactor_id),
    FOREIGN KEY (cid, message_id) REFERENCES messages(cid, id) ON DELETE CASCADE
);
```

### Índices Recomendados

```sql
-- Búsquedas frecuentes
CREATE INDEX idx_messages_chat ON messages(cid);
CREATE INDEX idx_messages_created ON messages(cid, created_at DESC);
CREATE INDEX idx_messages_author ON messages(author);
CREATE INDEX idx_messages_starred ON messages(cid, starred) WHERE starred = TRUE;

-- Filtros de chat
CREATE INDEX idx_chats_archived ON chats(archived) WHERE archived = TRUE;
CREATE INDEX idx_chats_pinned ON chats(pinned) WHERE pinned IS NOT NULL;
```

### Ventajas

- **Integridad**: Las foreign keys garantizan consistencia
- **cascade delete**: `ON DELETE CASCADE` limpia automáticamente
- **Filtros Eficientes**: Índices en campos de búsqueda
- **Joins**: Relacionar datos sin múltiples consultas

### Consultas Comunes

```sql
-- Mensajes del chat ordenados
SELECT * FROM messages WHERE cid = ? ORDER BY created_at DESC LIMIT 50;

-- Mensajes propios marcados con estrella
SELECT * FROM messages WHERE me = TRUE AND starred = TRUE;

-- Chats con mensajes no leídos
SELECT * FROM chats WHERE unread_count > 0 OR marked_as_unread = TRUE;

-- Eliminar chat (cascade elimina mensajes, reacciones, etc.)
DELETE FROM chats WHERE id = ?;
```

---

## Comparación

| Aspect | NoSQL (Key-Value) | SQL (Relacional) |
|--------|-------------------|------------------|
| **Configuración** | Mínima | Requiere migraciones |
| **Filtros** | En memoria | Índices nativos |
| **Joins** | N consultas | 1 consulta |
| **cascade delete** | Vía `set(key, null)` | Automático |
| **Flexibilidad de Esquema** | Alta | Requiere ALTER |
| **Datos Huérfanos** | Posible si contrato no se sigue | Imposible |
| **Escalabilidad** | Horizontal | Vertical |

---

## Recomendaciones por Caso de Uso

### Bot Simple / Prototipo
- **Backend**: FileEngine (archivos JSON)
- **Razón**: Cero configuración, fácil depuración

### Bot de Producción (< 100k mensajes)
- **Backend**: SQLite + FileEngine (contenido)
- **Razón**: Balance entre rendimiento y simplicidad

### Bot de Producción (> 100k mensajes)
- **Backend**: PostgreSQL + Redis (cache)
- **Razón**: Índices, cascade delete, consultas complejas

### Multi-tenant / SaaS
- **Backend**: PostgreSQL con particionamiento por `cid`
- **Razón**: Aislamiento de datos, limpieza por-tenant

---

## Prevención de Datos Huérfanos

### Principio

> Al eliminar una entidad padre, SIEMPRE elimina sus dependencias.

### Cascada de Eliminación

```
Eliminar Contacto:
+-- contact/{id}/index

Eliminar Chat (vía set("chat/{cid}", null)):
|-- chat/{id}/index
|-- chat/{id}/messages
|-- chat/{id}/message/*/index
|-- chat/{id}/message/*/content
|-- chat/{id}/message/*/raw
+-- (SQL) chat_participants, messages, message_contents, message_reactions

Eliminar Mensaje (vía set("chat/{cid}/message/{mid}", null)):
|-- chat/{cid}/message/{id}/index
|-- chat/{cid}/message/{id}/content
+-- chat/{cid}/message/{id}/raw
    (SQL) message_contents, message_reactions
```

### Implementación

El cascade delete es manejado por el contrato `set(key, null)` del Engine. La librería llama:

```typescript
// Eliminar chat y todo su contenido
await wa.Chat.remove(cid);
// o
const chat = await wa.Chat.get(cid);
await chat.remove();

// Internamente llama:
// await wa.engine.set("chat/{cid}", null);
// que cascade-deleta todas las subclaves
```
