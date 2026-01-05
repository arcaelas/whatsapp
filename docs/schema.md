# Schemas de Datos

Schemas estandarizados para almacenamiento en `@arcaelas/whatsapp`.

**Principios:**
- **Minimal**: Solo campos esenciales
- **Flat**: Sin anidación innecesaria
- **Typed**: Tipos explícitos
- **Temporal**: Timestamps en milisegundos UTC
- **Nullable**: `null` para ausencia, nunca `undefined`

---

# Raw Schemas

Las clases trabajan con objetos "raw" que contienen todas las propiedades del protocolo. Los getters/setters exponen una API simplificada.

---

## Contact Raw

Propiedades del objeto raw de contacto.

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `id` | `string` | JID único del contacto |
| `lid` | `string \| null` | ID alternativo en formato LID |
| `name` | `string \| null` | Nombre guardado en la agenda del usuario |
| `notify` | `string \| null` | Nombre que el contacto configuró en su perfil (pushName) |
| `verifiedName` | `string \| null` | Nombre de cuenta business verificada |
| `imgUrl` | `string \| null` | URL de la foto de perfil (puede expirar o ser `"changed"`) |
| `status` | `string \| null` | Bio/estado del perfil del contacto |

### Ejemplo Raw

```json
{
    "id": "584144709840@s.whatsapp.net",
    "lid": "140913951141911@lid",
    "name": "Juan Pérez",
    "notify": "Juanito",
    "verifiedName": null,
    "imgUrl": "https://pps.whatsapp.net/v/t61.24694-24/...",
    "status": "Disponible 24/7"
}
```

---

## Chat Raw

Propiedades del objeto raw de conversación.

### Propiedades Principales

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `id` | `string` | JID único del chat |
| `name` | `string \| null` | Nombre del chat o grupo |
| `displayName` | `string \| null` | Nombre alternativo para mostrar |
| `description` | `string \| null` | Descripción del grupo |
| `unreadCount` | `number \| null` | Cantidad de mensajes no leídos |
| `readOnly` | `boolean \| null` | Si el chat es de solo lectura |
| `archived` | `boolean \| null` | Si el chat está archivado |
| `pinned` | `number \| null` | Timestamp cuando se fijó el chat |
| `muteEndTime` | `number \| null` | Timestamp cuando expira el silencio |
| `markedAsUnread` | `boolean \| null` | Si fue marcado manualmente como no leído |
| `notSpam` | `boolean \| null` | Si fue marcado como no spam |

### Propiedades Temporales

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `lastMsgTimestamp` | `number \| null` | Timestamp del último mensaje recibido |
| `conversationTimestamp` | `number \| null` | Timestamp de la última actividad |
| `ephemeralExpiration` | `number \| null` | Duración de mensajes temporales (segundos) |
| `ephemeralSettingTimestamp` | `number \| null` | Cuando se configuró mensajes temporales |
| `createdAt` | `number \| null` | Timestamp de creación del chat/grupo |

### Propiedades de Grupo

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `participant` | `GroupParticipant[] \| null` | Lista de participantes del grupo |
| `createdBy` | `string \| null` | JID del creador del grupo |
| `isParentGroup` | `boolean \| null` | Si es grupo padre (comunidad) |
| `parentGroupId` | `string \| null` | JID del grupo padre |
| `isDefaultSubgroup` | `boolean \| null` | Si es subgrupo por defecto |
| `locked` | `boolean \| null` | Si el grupo está bloqueado |
| `suspended` | `boolean \| null` | Si el chat está suspendido |
| `terminated` | `boolean \| null` | Si el chat fue terminado |
| `support` | `boolean \| null` | Si es chat de soporte |
| `commentsCount` | `number \| null` | Cantidad de comentarios |

### Propiedades de Identidad

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `newJid` | `string \| null` | Nuevo JID (si migró) |
| `oldJid` | `string \| null` | JID anterior (si migró) |
| `lidJid` | `string \| null` | JID en formato LID |
| `pnJid` | `string \| null` | JID de número de teléfono |
| `username` | `string \| null` | Username del chat |
| `pHash` | `string \| null` | Hash de participantes |

### Propiedades de Configuración

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `wallpaper` | `WallpaperSettings \| null` | Configuración de fondo de pantalla |
| `mediaVisibility` | `MediaVisibility \| null` | Visibilidad de media en galería |
| `disappearingMode` | `DisappearingMode \| null` | Modo de mensajes temporales |
| `shareOwnPn` | `boolean \| null` | Si comparte número propio |
| `limitSharing` | `boolean \| null` | Si limita compartir |

### Propiedades Internas

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `messages` | `HistorySyncMsg[] \| null` | Mensajes de sincronización |
| `tcToken` | `Uint8Array \| null` | Token de términos y condiciones |
| `tcTokenTimestamp` | `number \| null` | Timestamp del token TC |
| `tcTokenSenderTimestamp` | `number \| null` | Timestamp del remitente TC |
| `contactPrimaryIdentityKey` | `Uint8Array \| null` | Clave de identidad del contacto |
| `endOfHistoryTransfer` | `boolean \| null` | Si terminó transferencia de historial |
| `endOfHistoryTransferType` | `EndOfHistoryTransferType \| null` | Tipo de fin de transferencia |
| `pnhDuplicateLidThread` | `boolean \| null` | Si es hilo duplicado PNH/LID |
| `lidOriginType` | `string \| null` | Tipo de origen LID |
| `accountLid` | `string \| null` | LID de la cuenta |
| `capiCreatedGroup` | `boolean \| null` | Si fue creado por CAPI |
| `systemMessageToInsert` | `PrivacySystemMessage \| null` | Mensaje de sistema a insertar |

### Ejemplo Raw

```json
{
    "id": "120363123456789@g.us",
    "name": "Equipo de Desarrollo",
    "displayName": null,
    "description": "Grupo para coordinación del proyecto",
    "unreadCount": 5,
    "readOnly": false,
    "archived": false,
    "pinned": 1767371367857,
    "muteEndTime": null,
    "markedAsUnread": false,
    "notSpam": true,
    "lastMsgTimestamp": 1767366759,
    "conversationTimestamp": 1767366759,
    "ephemeralExpiration": 604800,
    "ephemeralSettingTimestamp": 1752995285,
    "createdAt": 1700000000,
    "createdBy": "584144709840@s.whatsapp.net",
    "participant": [
        { "id": "584144709840@s.whatsapp.net", "admin": "superadmin" },
        { "id": "584121234567@s.whatsapp.net", "admin": null }
    ],
    "isParentGroup": false,
    "parentGroupId": null,
    "locked": false,
    "suspended": false,
    "terminated": false
}
```

---

## Message Raw

Propiedades del objeto raw de mensaje.

### MessageKey (key)

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `key.remoteJid` | `string \| null` | JID del chat |
| `key.fromMe` | `boolean \| null` | Si el mensaje es propio |
| `key.id` | `string \| null` | ID único del mensaje |
| `key.participant` | `string \| null` | JID del remitente (en grupos) |

### Propiedades Principales

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `message` | `Message \| null` | Contenido del mensaje (ver Message Content) |
| `messageTimestamp` | `number \| null` | Timestamp de creación |
| `status` | `MessageStatus \| null` | Estado de entrega (0-5) |
| `pushName` | `string \| null` | Nombre del remitente |
| `broadcast` | `boolean \| null` | Si es mensaje de broadcast |
| `starred` | `boolean \| null` | Si está destacado |
| `duration` | `number \| null` | Duración en segundos (audio/video) |
| `labels` | `string[] \| null` | Etiquetas del mensaje |

### Estados de Mensaje (status)

| Valor | Constante | Descripción |
|-------|-----------|-------------|
| `0` | `ERROR` | Error al enviar |
| `1` | `PENDING` | Pendiente de envío |
| `2` | `SERVER_ACK` | Confirmado por servidor |
| `3` | `DELIVERED` | Entregado al destinatario |
| `4` | `READ` | Leído por el destinatario |
| `5` | `PLAYED` | Reproducido (audio/video) |

### Propiedades de Media

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `mediaCiphertextSha256` | `Uint8Array \| null` | Hash SHA256 del media cifrado |
| `mediaData` | `MediaData \| null` | Datos del media |
| `quotedStickerData` | `MediaData \| null` | Datos del sticker citado |

### Propiedades Temporales

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `ephemeralStartTimestamp` | `number \| null` | Inicio del temporizador de expiración |
| `ephemeralDuration` | `number \| null` | Duración hasta expiración (segundos) |
| `ephemeralOffToOn` | `boolean \| null` | Si cambió de off a on |
| `ephemeralOutOfSync` | `boolean \| null` | Si está desincronizado |
| `revokeMessageTimestamp` | `number \| null` | Timestamp de revocación |

### Propiedades de Reacciones y Encuestas

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `reactions` | `Reaction[] \| null` | Reacciones al mensaje |
| `pollUpdates` | `PollUpdate[] \| null` | Actualizaciones de encuesta |
| `pollAdditionalMetadata` | `PollAdditionalMetadata \| null` | Metadata adicional de encuesta |
| `messageSecret` | `Uint8Array \| null` | Secreto para descifrar votos |

### Propiedades de Recibos

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `userReceipt` | `UserReceipt[] \| null` | Recibos de lectura por usuario |
| `messageC2STimestamp` | `number \| null` | Timestamp cliente-a-servidor |

### Propiedades de Stub (Mensajes de Sistema)

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `messageStubType` | `StubType \| null` | Tipo de mensaje de sistema |
| `messageStubParameters` | `string[] \| null` | Parámetros del stub |

### Propiedades de Business

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `bizPrivacyStatus` | `BizPrivacyStatus \| null` | Estado de privacidad business |
| `verifiedBizName` | `string \| null` | Nombre de negocio verificado |

### Propiedades de Estado/Historia

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `statusPsa` | `StatusPSA \| null` | PSA de estado |
| `statusAlreadyViewed` | `boolean \| null` | Si el estado ya fue visto |
| `isMentionedInStatus` | `boolean \| null` | Si fui mencionado en estado |
| `statusMentions` | `string[] \| null` | JIDs mencionados en estado |
| `statusMentionMessageInfo` | `StatusMentionMessage \| null` | Info de mención en estado |
| `statusMentionSources` | `string[] \| null` | Fuentes de mención |

### Propiedades de Pin

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `pinInChat` | `PinInChat \| null` | Información de mensaje fijado |
| `keepInChat` | `KeepInChat \| null` | Mantener en chat |

### Propiedades de Bot/AI

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `is1PBizBotMessage` | `boolean \| null` | Si es mensaje de bot 1P business |
| `botMessageInvokerJid` | `string \| null` | JID que invocó al bot |
| `botTargetId` | `string \| null` | ID objetivo del bot |
| `isSupportAiMessage` | `boolean \| null` | Si es mensaje de AI de soporte |
| `supportAiCitations` | `Citation[] \| null` | Citas del AI |
| `agentId` | `string \| null` | ID del agente |

### Propiedades Internas

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `ignore` | `boolean \| null` | Si debe ignorarse |
| `multicast` | `boolean \| null` | Si es multicast |
| `urlText` | `boolean \| null` | Si contiene URL de texto |
| `urlNumber` | `boolean \| null` | Si contiene URL de número |
| `clearMedia` | `boolean \| null` | Si debe limpiar media |
| `photoChange` | `PhotoChange \| null` | Cambio de foto |
| `futureproofData` | `Uint8Array \| null` | Datos para compatibilidad futura |
| `isGroupHistoryMessage` | `boolean \| null` | Si es mensaje de historial de grupo |
| `originalSelfAuthorUserJidString` | `string \| null` | JID original del autor |
| `premiumMessageInfo` | `PremiumMessageInfo \| null` | Info de mensaje premium |
| `commentMetadata` | `CommentMetadata \| null` | Metadata de comentario |
| `eventResponses` | `EventResponse[] \| null` | Respuestas a evento |
| `eventAdditionalMetadata` | `EventAdditionalMetadata \| null` | Metadata adicional de evento |
| `reportingTokenInfo` | `ReportingTokenInfo \| null` | Info de token de reporte |
| `newsletterServerId` | `number \| null` | ID de servidor de newsletter |
| `targetMessageId` | `MessageKey \| null` | ID del mensaje objetivo |
| `messageAddOns` | `MessageAddOn[] \| null` | Add-ons del mensaje |
| `paymentInfo` | `PaymentInfo \| null` | Información de pago |
| `quotedPaymentInfo` | `PaymentInfo \| null` | Info de pago citado |
| `finalLiveLocation` | `LiveLocationMessage \| null` | Ubicación en vivo final |

### Ejemplo Raw

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
            "text": "Hola mundo",
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
    "pushName": "Juan Pérez",
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

## Message Content

Tipos de contenido dentro de `message`.

### Texto

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `conversation` | `string` | Texto simple |
| `extendedTextMessage.text` | `string` | Texto con metadata |
| `extendedTextMessage.contextInfo` | `ContextInfo` | Información de contexto |

### Media

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `imageMessage` | `ImageMessage` | Mensaje de imagen |
| `videoMessage` | `VideoMessage` | Mensaje de video |
| `audioMessage` | `AudioMessage` | Mensaje de audio |
| `documentMessage` | `DocumentMessage` | Mensaje de documento |
| `stickerMessage` | `StickerMessage` | Mensaje de sticker |

### Media Properties (común)

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `url` | `string` | URL de descarga (temporal) |
| `directPath` | `string` | Path directo en CDN |
| `mediaKey` | `Uint8Array` | Clave para descifrar |
| `mimetype` | `string` | Tipo MIME |
| `fileLength` | `number` | Tamaño en bytes |
| `fileSha256` | `Uint8Array` | Hash SHA256 del archivo |
| `fileEncSha256` | `Uint8Array` | Hash SHA256 cifrado |
| `mediaKeyTimestamp` | `number` | Timestamp de la clave |
| `jpegThumbnail` | `Uint8Array` | Miniatura JPEG en base64 |
| `caption` | `string` | Caption del media |
| `width` | `number` | Ancho en pixels |
| `height` | `number` | Alto en pixels |
| `seconds` | `number` | Duración (audio/video) |
| `ptt` | `boolean` | Push-to-talk (nota de voz) |
| `waveform` | `Uint8Array` | Forma de onda (audio) |
| `streamingSidecar` | `Uint8Array` | Datos de streaming |

### Ubicación

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `locationMessage.degreesLatitude` | `number` | Latitud |
| `locationMessage.degreesLongitude` | `number` | Longitud |
| `liveLocationMessage.degreesLatitude` | `number` | Latitud en vivo |
| `liveLocationMessage.degreesLongitude` | `number` | Longitud en vivo |
| `liveLocationMessage.sequenceNumber` | `number` | Número de secuencia |
| `liveLocationMessage.caption` | `string` | Caption de ubicación |

### Encuesta

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `pollCreationMessage.name` | `string` | Pregunta de la encuesta |
| `pollCreationMessage.options` | `Option[]` | Opciones de respuesta |
| `pollCreationMessage.selectableOptionsCount` | `number` | Cantidad seleccionable |
| `pollUpdateMessage.pollCreationMessageKey` | `MessageKey` | Referencia a la encuesta |
| `pollUpdateMessage.vote` | `PollEncValue` | Voto cifrado |

### Reacción

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `reactionMessage.key` | `MessageKey` | Mensaje al que reacciona |
| `reactionMessage.text` | `string` | Emoji de reacción |
| `reactionMessage.senderTimestampMs` | `number` | Timestamp del remitente |

### Protocolo

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `protocolMessage.type` | `ProtocolMessageType` | Tipo de protocolo |
| `protocolMessage.key` | `MessageKey` | Mensaje objetivo |
| `protocolMessage.editedMessage` | `Message` | Mensaje editado |
| `protocolMessage.timestampMs` | `number` | Timestamp de la acción |

### ProtocolMessage Types

| Valor | Constante | Descripción |
|-------|-----------|-------------|
| `0` | `REVOKE` | Eliminar mensaje |
| `3` | `EPHEMERAL_SETTING` | Configurar mensajes temporales |
| `6` | `EPHEMERAL_SYNC_RESPONSE` | Respuesta de sincronización |
| `7` | `HISTORY_SYNC_NOTIFICATION` | Notificación de historial |
| `14` | `MESSAGE_EDIT` | Editar mensaje |

### ContextInfo

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `stanzaId` | `string` | ID del mensaje citado |
| `participant` | `string` | Autor del mensaje citado |
| `quotedMessage` | `Message` | Contenido del mensaje citado |
| `isForwarded` | `boolean` | Si fue reenviado |
| `forwardingScore` | `number` | Veces reenviado |
| `expiration` | `number` | Segundos hasta expiración |
| `ephemeralSettingTimestamp` | `number` | Timestamp de configuración |
| `mentionedJid` | `string[]` | JIDs mencionados |

---

# API Schemas

Schemas simplificados expuestos por las clases.

---

## Contact

| Propiedad | Tipo | Raw Source | Descripción |
|-----------|------|------------|-------------|
| `id` | `string` | `id` | JID único del contacto |
| `name` | `string` | `name \|\| notify \|\| ""` | Nombre del contacto |
| `photo` | `string \| null` | `imgUrl` | URL de foto de perfil |
| `phone` | `string` | `id.split("@")[0]` | Número telefónico |
| `content` | `string` | `status \|\| ""` | Bio del contacto |

### Storage Key

```
contact/{id}/index
```

---

## Chat

| Propiedad | Tipo | Raw Source | Descripción |
|-----------|------|------------|-------------|
| `id` | `string` | `id` | JID único del chat |
| `type` | `"contact" \| "group"` | Derivado de `id` | Tipo de chat |
| `name` | `string` | `name \|\| displayName` | Nombre del chat |
| `content` | `string` | `description \|\| ""` | Descripción |
| `pined` | `boolean` | `pinned !== null` | Si está fijado |
| `archived` | `boolean` | `archived` | Si está archivado |
| `muted` | `number \| false` | `muteEndTime \|\| false` | Silencio |
| `readed` | `boolean` | `unreadCount === 0 && !markedAsUnread` | Si está leído |
| `readonly` | `boolean` | `readOnly` | Si es solo lectura |
| `labels` | `string[]` | Labels del chat | Etiquetas |

### Storage Key

```
chat/{id}/index
```

---

## Message

| Propiedad | Tipo | Raw Source | Descripción |
|-----------|------|------------|-------------|
| `id` | `string` | `key.id` | ID único |
| `cid` | `string` | `key.remoteJid` | ID del chat |
| `mid` | `string \| null` | `contextInfo.stanzaId` | Mensaje padre |
| `me` | `boolean` | `key.fromMe` | Si soy el autor |
| `type` | `MessageType` | Derivado de `message` | Tipo de mensaje |
| `author` | `string` | `key.participant \|\| key.remoteJid` | Autor |
| `status` | `MessageStatus` | `status` | Estado de entrega |
| `starred` | `boolean` | `starred` | Destacado |
| `forwarded` | `boolean` | `contextInfo.isForwarded` | Reenviado |
| `created_at` | `number` | `messageTimestamp * 1000` | Creación (ms) |
| `deleted_at` | `number \| null` | `ephemeralStartTimestamp + ephemeralDuration` | Expiración |
| `mime` | `string` | Derivado de `message` | Tipo MIME |
| `content` | `Buffer` | Descargado/extraído | Contenido binario |
| `caption` | `string` | `*.caption \|\| ""` | Caption |

### Storage

| Key | Contenido |
|-----|-----------|
| `chat/{cid}/message/{id}/index` | JSON con metadata (sin content) |
| `chat/{cid}/message/{id}/content` | Buffer base64 |
| `chat/{cid}/message/{id}/raw` | Raw completo (para forward, re-descarga) |

---

## Resumen de Campos

| Entidad | API Fields | Raw Fields |
|---------|------------|------------|
| **Contact** | 5 | 7 |
| **Chat** | 10 | 40+ |
| **Message** | 14 | 50+ |

---

# Storage Guidelines

Estrategias de almacenamiento para diferentes backends.

---

## Clasificación de Campos

### Campos Primarios (Columnas/Índices)

Campos escalares que:
- Se usan en filtros/búsquedas
- Son identificadores o foreign keys
- Determinan ordenamiento

| Entidad | Campos Primarios |
|---------|------------------|
| **Contact** | `id` |
| **Chat** | `id`, `archived`, `pined`, `muted` |
| **Message** | `id`, `cid`, `me`, `author`, `status`, `created_at`, `starred` |

### Campos Anidados (JSON/Relaciones)

Objetos o arrays que requieren decisión de almacenamiento:

| Entidad | Campo | Tipo | Recomendación |
|---------|-------|------|---------------|
| **Chat** | `participant` | `Array<{id, admin}>` | Relación separada (SQL) o JSON (NoSQL) |
| **Chat** | `wallpaper` | `Object` | JSON inline |
| **Chat** | `disappearingMode` | `Object` | JSON inline |
| **Message** | `key` | `Object` | Desnormalizar a campos |
| **Message** | `message` | `Object` | Separar en `/raw` |
| **Message** | `reactions` | `Array` | Relación separada (SQL) o JSON (NoSQL) |
| **Message** | `userReceipt` | `Array` | Relación separada (SQL) o JSON (NoSQL) |
| **Message** | `contextInfo` | `Object` | Extraer `stanzaId` a `mid`, resto en `/raw` |

---

## Estrategia NoSQL (Key-Value)

Para FileEngine, RedisEngine u otros key-value stores.

### Estructura de Keys

```
contact/{id}/index          → JSON con todos los campos
chat/{id}/index             → JSON con campos API + raw
chat/{cid}/message/{id}/index   → JSON metadata (sin content)
chat/{cid}/message/{id}/content → Buffer base64
chat/{cid}/message/{id}/raw     → JSON raw completo
```

### Ventajas

- **Simplicidad**: Todo es JSON, sin migraciones
- **Atomicidad**: Un registro = una key
- **Flexibilidad**: Agregar campos sin alterar estructura

### Consideraciones

**Listados y Filtros:**
```
# Listar contactos
SCAN contact/*/index

# Listar mensajes de un chat
SCAN chat/{cid}/message/*/index

# Filtrar mensajes starred
Requiere iterar y filtrar en memoria
```

**Limpieza (Cascade Delete):**
```
# Eliminar chat y todos sus mensajes
1. SCAN chat/{cid}/message/*
2. DEL cada key encontrada
3. DEL chat/{cid}/index
```

**Datos Huérfanos:**
- Al eliminar chat: eliminar todas las keys con prefijo `chat/{cid}/`
- Al eliminar contacto: solo `contact/{id}/index` (no hay dependencias)

### Formato de Almacenamiento

```json
// contact/{id}/index
{
    "id": "584144709840@s.whatsapp.net",
    "name": "Juan Pérez",
    "photo": "https://...",
    "phone": "584144709840",
    "content": "Disponible"
}

// chat/{id}/index
{
    "id": "120363123456789@g.us",
    "type": "group",
    "name": "Equipo Dev",
    "content": "Descripción del grupo",
    "pined": true,
    "archived": false,
    "muted": false,
    "readed": true,
    "readonly": false,
    "labels": ["trabajo"],
    "raw": { /* objeto raw completo */ }
}

// chat/{cid}/message/{id}/index
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
    "caption": ""
}
```

---

## Estrategia SQL (Relacional)

Para PostgreSQL, MySQL, SQLite.

### Esquema de Tablas

```sql
-- Contactos
CREATE TABLE contacts (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255),
    photo TEXT,
    phone VARCHAR(20),
    content TEXT,
    raw JSONB
);

-- Chats
CREATE TABLE chats (
    id VARCHAR(50) PRIMARY KEY,
    type VARCHAR(10) NOT NULL CHECK (type IN ('contact', 'group')),
    name VARCHAR(255),
    content TEXT,
    pined BOOLEAN DEFAULT FALSE,
    archived BOOLEAN DEFAULT FALSE,
    muted BIGINT,  -- timestamp o NULL
    readed BOOLEAN DEFAULT TRUE,
    readonly BOOLEAN DEFAULT FALSE,
    raw JSONB
);

-- Labels de chat (relación N:M)
CREATE TABLE chat_labels (
    chat_id VARCHAR(50) REFERENCES chats(id) ON DELETE CASCADE,
    label VARCHAR(100),
    PRIMARY KEY (chat_id, label)
);

-- Participantes de grupo
CREATE TABLE chat_participants (
    chat_id VARCHAR(50) REFERENCES chats(id) ON DELETE CASCADE,
    contact_id VARCHAR(50),
    admin VARCHAR(20),  -- NULL, 'admin', 'superadmin'
    PRIMARY KEY (chat_id, contact_id)
);

-- Mensajes
CREATE TABLE messages (
    id VARCHAR(50),
    cid VARCHAR(50) REFERENCES chats(id) ON DELETE CASCADE,
    mid VARCHAR(50),  -- mensaje padre (reply)
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
    PRIMARY KEY (cid, id)
);

-- Contenido de mensajes (separado para eficiencia)
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
CREATE INDEX idx_chats_pined ON chats(pined) WHERE pined = TRUE;
```

### Ventajas

- **Integridad**: Foreign keys garantizan consistencia
- **Cascade Delete**: `ON DELETE CASCADE` limpia automáticamente
- **Filtros Eficientes**: Índices en campos de búsqueda
- **Joins**: Relacionar datos sin múltiples queries

### Consultas Comunes

```sql
-- Mensajes de un chat ordenados
SELECT * FROM messages WHERE cid = ? ORDER BY created_at DESC LIMIT 50;

-- Mensajes starred del usuario
SELECT * FROM messages WHERE me = TRUE AND starred = TRUE;

-- Chats con mensajes no leídos
SELECT * FROM chats WHERE readed = FALSE ORDER BY pined DESC;

-- Eliminar chat (cascade elimina mensajes, reacciones, etc.)
DELETE FROM chats WHERE id = ?;
```

---

## Comparativa

| Aspecto | NoSQL (Key-Value) | SQL (Relacional) |
|---------|-------------------|------------------|
| **Setup** | Mínimo | Requiere migraciones |
| **Filtros** | En memoria | Índices nativos |
| **Joins** | N queries | 1 query |
| **Cascade Delete** | Manual | Automático |
| **Flexibilidad Schema** | Alta | Requiere ALTER |
| **Datos Huérfanos** | Posibles | Imposibles |
| **Escalabilidad** | Horizontal | Vertical |

---

## Recomendaciones por Caso de Uso

### Bot Simple / Prototipo
- **Backend**: FileEngine (JSON files)
- **Razón**: Zero setup, fácil debugging

### Bot en Producción (< 100k mensajes)
- **Backend**: SQLite + FileEngine (content)
- **Razón**: Balance entre performance y simplicidad

### Bot en Producción (> 100k mensajes)
- **Backend**: PostgreSQL + Redis (cache)
- **Razón**: Índices, cascade delete, queries complejas

### Multi-tenant / SaaS
- **Backend**: PostgreSQL con partitioning por `cid`
- **Razón**: Aislamiento de datos, limpieza por tenant

---

## Prevención de Datos Huérfanos

### Principio

> Al eliminar una entidad padre, SIEMPRE eliminar sus dependencias.

### Cascada de Eliminación

```
Eliminar Contact:
└── contact/{id}/index

Eliminar Chat:
├── chat/{id}/index
├── chat/{id}/message/*/index
├── chat/{id}/message/*/content
├── chat/{id}/message/*/raw
└── (SQL) chat_labels, chat_participants, messages, message_contents, message_reactions

Eliminar Message:
├── chat/{cid}/message/{id}/index
├── chat/{cid}/message/{id}/content
├── chat/{cid}/message/{id}/raw
└── (SQL) message_contents, message_reactions
```

### Implementación

El cascade delete está implementado en `Chat.cascade_delete()`:

```typescript
// Eliminar chat y todo su contenido
await Chat.cascade_delete(chat_id);

// Internamente ejecuta:
// 1. Lee chat/{cid}/messages para obtener IDs
// 2. Elimina chat/{cid}/message/{mid}/index, /content, /raw para cada mensaje
// 3. Elimina chat/{cid}/messages
// 4. Elimina chat/{cid}/index
```
