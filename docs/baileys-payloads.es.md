# Referencia de Payloads de Eventos en Baileys

Documentación completa de payloads capturados desde Baileys v6.7.18 para todos los tipos de mensajes:
- **Texto** - Mensajes de texto simple y extendido
- **Imágenes** - Con subtítulos, miniaturas y claves de media
- **Videos** - Con streaming sidecar y duración
- **Audio** - Notas de voz (PTT) y archivos de audio
- **Ubicaciones** - Estáticas y en vivo
- **Encuestas** - Creación y votos (E2E encriptados)

---

## 1. Mensaje de Texto (nuevo)

**Evento:** `messages.upsert` con `type: "notify"`

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC07DE0D18FA8254897A26C90B2FFD98"
  },
  "messageTimestamp": 1767366759,
  "pushName": "Miguel Alejandro Guevara",
  "broadcast": false,
  "message": {
    "extendedTextMessage": {
      "text": "Mensaje",
      "previewType": "NONE",
      "contextInfo": {
        "expiration": 7776000,
        "ephemeralSettingTimestamp": "1752995285",
        "disappearingMode": {
          "initiator": "INITIATED_BY_ME",
          "trigger": "ACCOUNT_SETTING",
          "initiatedByMe": true
        }
      },
      "inviteLinkGroupTypeV2": "DEFAULT"
    },
    "messageContextInfo": {
      "deviceListMetadata": {
        "senderKeyHash": "2tnQy4q7mzjMfw==",
        "senderTimestamp": "1767289397",
        "recipientKeyHash": "fbnE50/78FcqHw==",
        "recipientTimestamp": "1767366507"
      },
      "deviceListMetadataVersion": 2,
      "messageSecret": "wZda2AFu1tzmVVGYpMDBdevK4OmwFvyH1tJ30BnmSfA="
    }
  }
}
```

**Campos clave:**
- `key.remoteJid` - ID de la conversación (formato `@lid` o `@s.whatsapp.net`)
- `key.fromMe` - Si el mensaje fue enviado por nosotros
- `key.id` - ID único del mensaje
- `pushName` - Nombre del remitente
- `message.extendedTextMessage.text` - Contenido del texto

---

## 2. Edición de Mensaje

### 2.1 Vía `messages.upsert` (protocolMessage)

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC28854886802F1895A337C83F0EC211"
  },
  "messageTimestamp": 1767366766,
  "pushName": "Miguel Alejandro Guevara",
  "message": {
    "protocolMessage": {
      "key": {
        "remoteJid": "9698623357112@lid",
        "fromMe": true,
        "id": "AC07DE0D18FA8254897A26C90B2FFD98"
      },
      "type": "MESSAGE_EDIT",
      "editedMessage": {
        "extendedTextMessage": {
          "text": "Editado.",
          "previewType": "NONE",
          "contextInfo": { ... }
        }
      },
      "timestampMs": "1767366766505"
    }
  }
}
```

### 2.2 Vía `messages.update`

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC07DE0D18FA8254897A26C90B2FFD98"
  },
  "update": {
    "message": {
      "editedMessage": {
        "message": {
          "extendedTextMessage": {
            "text": "Editado.",
            "previewType": "NONE",
            "contextInfo": { ... }
          }
        }
      }
    },
    "messageTimestamp": 1767366766
  }
}
```

**Campos clave:**
- `protocolMessage.type` = `"MESSAGE_EDIT"` (o `14` como número)
- `protocolMessage.key.id` - ID del mensaje a editar
- `protocolMessage.editedMessage` - Nuevo contenido del mensaje

---

## 3. Reacción

### 3.1 Vía `messages.upsert` (reactionMessage)

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC4FAE3156F6766A5C19DE9896A728D1"
  },
  "messageTimestamp": 1767366771,
  "pushName": "Miguel Alejandro Guevara",
  "message": {
    "reactionMessage": {
      "key": {
        "remoteJid": "140913951141911@lid",
        "fromMe": false,
        "id": "AC07DE0D18FA8254897A26C90B2FFD98"
      },
      "text": "❤️",
      "senderTimestampMs": "1767366770998"
    }
  }
}
```

### 3.2 Vía `messages.reaction`

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC07DE0D18FA8254897A26C90B2FFD98"
  },
  "reaction": {
    "key": {
      "remoteJid": "140913951141911@lid",
      "fromMe": false,
      "id": "AC4FAE3156F6766A5C19DE9896A728D1"
    },
    "text": "❤️",
    "senderTimestampMs": { "low": 2135212342, "high": 411, "unsigned": false }
  }
}
```

**Campos clave:**
- `reactionMessage.key.id` - ID del mensaje siendo reaccionado
- `reactionMessage.text` - Emoji de reacción (vacío = eliminar reacción)

---

## 4. Eliminación (REVOKE)

### 4.1 Vía `messages.upsert` (protocolMessage)

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC654D7AA789E560FBD9E3EBD8200198"
  },
  "messageTimestamp": 1767366775,
  "pushName": "Miguel Alejandro Guevara",
  "message": {
    "protocolMessage": {
      "key": {
        "remoteJid": "9698623357112@lid",
        "fromMe": true,
        "id": "AC07DE0D18FA8254897A26C90B2FFD98"
      },
      "type": "REVOKE"
    }
  }
}
```

### 4.2 Vía `messages.update`

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC07DE0D18FA8254897A26C90B2FFD98"
  },
  "update": {
    "message": null,
    "messageStubType": 1,
    "key": {
      "remoteJid": "140913951141911@lid",
      "fromMe": false,
      "id": "AC654D7AA789E560FBD9E3EBD8200198"
    }
  }
}
```

**Campos clave:**
- `protocolMessage.type` = `"REVOKE"` (o `0` como número)
- `protocolMessage.key.id` - ID del mensaje a eliminar
- En `messages.update`: `message: null` y `messageStubType: 1`

---

## 5. Mensaje Reenviado

**Evento:** `messages.upsert` con `type: "notify"`

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "ACFDDB4A1F65398F52D238A78F4E761A"
  },
  "messageTimestamp": 1767366784,
  "pushName": "Miguel Alejandro Guevara",
  "message": {
    "extendedTextMessage": {
      "text": "se volvio a caer :(",
      "previewType": "NONE",
      "contextInfo": {
        "forwardingScore": 1,
        "isForwarded": true,
        "expiration": 7776000,
        "ephemeralSettingTimestamp": "1752995285",
        "disappearingMode": { ... }
      },
      "inviteLinkGroupTypeV2": "DEFAULT"
    }
  }
}
```

**Campos clave:**
- `contextInfo.isForwarded` = `true` - Indica que fue reenviado
- `contextInfo.forwardingScore` - Número de veces reenviado (1+)

---

## Resumen de Tipos de Mensaje de Protocolo

| Tipo | Valor Numérico | Descripción |
|------|---|---|
| `REVOKE` | 0 | Eliminar mensaje |
| `EPHEMERAL_SETTING` | 3 | Cambio de mensaje efímero |
| `EPHEMERAL_SYNC_RESPONSE` | 6 | Respuesta de sincronización |
| `HISTORY_SYNC_NOTIFICATION` | 7 | Notificación de sincronización de historial |
| `MESSAGE_EDIT` | 14 | Editar mensaje |

---

---

# Imágenes

## 1. Imagen Nueva

**Evento:** `messages.upsert` con `type: "notify"`

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC9BE0D81D965A3C240B6ACAA891C6FD"
  },
  "messageTimestamp": 1767366982,
  "pushName": "Miguel Alejandro Guevara",
  "message": {
    "imageMessage": {
      "url": "https://mmg.whatsapp.net/o1/v/t24/...",
      "mimetype": "image/jpeg",
      "caption": "Here is the caption.",
      "fileSha256": "AtQ/iIo7NRdmRP+aADjHBvsydhdvvL/hmnkX6e4OMUw=",
      "fileLength": "41161",
      "height": 340,
      "width": 1146,
      "mediaKey": "5j575mYpMIn/DWBitep/eVIkdTiES9QJ82C7CxHRH2Y=",
      "fileEncSha256": "xOZ8uqbEUswSlBv+nUb7lyIrwl/TlhqVb9bAmyg5sw8=",
      "directPath": "/o1/v/t24/f2/m233/...",
      "mediaKeyTimestamp": "1767361850",
      "jpegThumbnail": "/9j/4AAQSkZJRgABAQAAAQABAAD/...",
      "contextInfo": {
        "expiration": 7776000,
        "disappearingMode": { ... },
        "pairedMediaType": "NOT_PAIRED_MEDIA"
      }
    }
  }
}
```

**Campos clave:**
- `imageMessage.url` - URL de descarga (temporal)
- `imageMessage.mediaKey` - Clave de desencriptación de archivo
- `imageMessage.directPath` - Ruta directa del CDN
- `imageMessage.caption` - Texto del subtítulo
- `imageMessage.jpegThumbnail` - Miniatura en Base64
- `imageMessage.mimetype` - Tipo MIME
- `imageMessage.fileLength` - Tamaño en bytes

---

## 2. Edición de Subtítulo (Imagen)

### Vía `messages.upsert` (protocolMessage)

```json
{
  "message": {
    "protocolMessage": {
      "key": {
        "remoteJid": "9698623357112@lid",
        "fromMe": true,
        "id": "AC9BE0D81D965A3C240B6ACAA891C6FD"
      },
      "type": "MESSAGE_EDIT",
      "editedMessage": {
        "imageMessage": {
          "caption": "Here is the edited caption.",
          "contextInfo": { ... }
        }
      },
      "timestampMs": "1767366991341"
    }
  }
}
```

### Vía `messages.update`

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC9BE0D81D965A3C240B6ACAA891C6FD"
  },
  "update": {
    "message": {
      "editedMessage": {
        "message": {
          "imageMessage": {
            "caption": "Here is the edited caption.",
            "contextInfo": { ... }
          }
        }
      }
    },
    "messageTimestamp": 1767366991
  }
}
```

**Nota:** Solo se edita el `caption`, la imagen permanece igual.

---

## 3. Reacción en Imagen

Mismo formato que texto - usa `reactionMessage`:

```json
{
  "message": {
    "reactionMessage": {
      "key": {
        "remoteJid": "140913951141911@lid",
        "fromMe": false,
        "id": "AC9BE0D81D965A3C240B6ACAA891C6FD"
      },
      "text": "😂",
      "senderTimestampMs": "1767366995121"
    }
  }
}
```

---

## 4. Eliminación de Imagen

Mismo formato que texto - usa `protocolMessage.type: "REVOKE"`:

```json
{
  "message": {
    "protocolMessage": {
      "key": {
        "remoteJid": "9698623357112@lid",
        "fromMe": true,
        "id": "AC9BE0D81D965A3C240B6ACAA891C6FD"
      },
      "type": "REVOKE"
    }
  }
}
```

---

## 5. Imagen Reenviada

```json
{
  "message": {
    "imageMessage": {
      "url": "https://mmg.whatsapp.net/...",
      "mimetype": "image/jpeg",
      "fileSha256": "...",
      "fileLength": "41548",
      "height": 2048,
      "width": 1536,
      "mediaKey": "...",
      "jpegThumbnail": "...",
      "contextInfo": {
        "forwardingScore": 1,
        "isForwarded": true,
        "expiration": 7776000,
        "pairedMediaType": "NOT_PAIRED_MEDIA"
      },
      "scansSidecar": "...",
      "scanLengths": [5323, 21968, 6636, 7621],
      "midQualityFileSha256": "..."
    }
  }
}
```

**Campos clave:**
- `contextInfo.isForwarded` = `true`
- `contextInfo.forwardingScore` = número de reenvíos
- `scansSidecar` y `scanLengths` - datos de exploración de calidad

---

---

# Videos

## 1. Video Nuevo

**Evento:** `messages.upsert` con `type: "notify"`

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC8D9EBFC03C073E18073726AF79DD53"
  },
  "messageTimestamp": 1767367249,
  "pushName": "Miguel Alejandro Guevara",
  "message": {
    "videoMessage": {
      "url": "https://mmg.whatsapp.net/v/t62.7161-24/...",
      "mimetype": "video/mp4",
      "fileSha256": "UXexcGRALCBhv9oeaJLKmszTizTUxU6bEa5AdhY2syc=",
      "fileLength": "3927238",
      "seconds": 14,
      "mediaKey": "QMIVrONUp2pdFyJWtHmGyQmtqdmfEBpAJjMrdWjtCGo=",
      "caption": "Video 0:14, 5.4MB",
      "height": 1280,
      "width": 720,
      "fileEncSha256": "w+1YcO3NgNgWrHs/Gz9x0jD3jw1Bi7HSNknsFB8iT6s=",
      "directPath": "/v/t62.7161-24/...",
      "mediaKeyTimestamp": "1767364373",
      "jpegThumbnail": "/9j/4AAQSkZJRgABAQAAAQABAAD/...",
      "contextInfo": {
        "expiration": 7776000,
        "pairedMediaType": "SD_VIDEO_PARENT",
        "statusSourceType": "VIDEO"
      },
      "streamingSidecar": "b5UxJyraDyJip4GcDCh9SoifW+eArgvRDj5sk2zE...",
      "externalShareFullVideoDurationInSeconds": 0
    }
  }
}
```

**Campos clave (además de imagen):**
- `videoMessage.seconds` - Duración en segundos
- `videoMessage.streamingSidecar` - Datos de streaming progresivo
- `contextInfo.pairedMediaType` = `"SD_VIDEO_PARENT"` - Video SD con posible HD
- `contextInfo.statusSourceType` = `"VIDEO"`

---

## 2. Edición de Subtítulo (Video)

### Vía `messages.update`

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC8D9EBFC03C073E18073726AF79DD53"
  },
  "update": {
    "message": {
      "editedMessage": {
        "message": {
          "videoMessage": {
            "caption": "Video 0:14, 5.4MB edited.",
            "contextInfo": { ... }
          }
        }
      }
    },
    "messageTimestamp": 1767367259
  }
}
```

---

## 3. Reacción en Video

Mismo formato: `reactionMessage.text: "❤️"`

---

## 4. Eliminación de Video

Mismo formato: `protocolMessage.type: "REVOKE"`

```json
{
  "message": {
    "protocolMessage": {
      "key": {
        "remoteJid": "9698623357112@lid",
        "fromMe": true,
        "id": "AC8D9EBFC03C073E18073726AF79DD53"
      },
      "type": "REVOKE"
    }
  }
}
```

---

## 5. Video Reenviado

```json
{
  "message": {
    "videoMessage": {
      "url": "https://mmg.whatsapp.net/v/t62.7161-24/...",
      "mimetype": "video/mp4",
      "fileSha256": "ldamPu0rHgc2YP6RTLIzPDPwtdmxeLWe1MU7xgsWffk=",
      "fileLength": "1918799",
      "seconds": 12,
      "mediaKey": "mIbYpoPeMVLGk7k/AkgMFmJbs5B1YdJb1pslgPQwGvM=",
      "height": 832,
      "width": 464,
      "jpegThumbnail": "...",
      "contextInfo": {
        "forwardingScore": 1,
        "isForwarded": true,
        "expiration": 7776000,
        "pairedMediaType": "NOT_PAIRED_MEDIA"
      },
      "streamingSidecar": "..."
    }
  }
}
```

---

---

# Audio

## 1. Nota de Voz (PTT)

**Evento:** `messages.upsert` con `type: "notify"` o `"append"`

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC59EFFAD3590A7D97ECCB92690E904A"
  },
  "messageTimestamp": 1767367534,
  "pushName": "Miguel Alejandro Guevara",
  "message": {
    "audioMessage": {
      "url": "https://mmg.whatsapp.net/v/t62.7117-24/...",
      "mimetype": "audio/ogg; codecs=opus",
      "fileSha256": "EFYFoGCyrMKEZbpeXKdsnfQjcHF2oPF0dYxffk9di+s=",
      "fileLength": "10460",
      "seconds": 4,
      "ptt": true,
      "mediaKey": "8VKH8PT8AhNkt9SGanQwpInAEX4/VJDRmUYofxRPqgE=",
      "fileEncSha256": "3cNnNkhHEUEwWQIRKWbEXQ/xO0WQzEAyd5N/cF6et8c=",
      "directPath": "/v/t62.7117-24/...",
      "mediaKeyTimestamp": "1767367534",
      "contextInfo": {
        "expiration": 7776000,
        "disappearingMode": { ... }
      },
      "waveform": "AAAAEhITFhgQDAsQESooPk8/Kzw/PTsrJ0tJJBwkLCcrKhgfJigbDzA3UExAQjgyQEM/LT04Mzg5PykWJSESAA=="
    }
  }
}
```

**Campos clave:**
- `audioMessage.ptt` = `true` - Push-to-Talk (nota de voz)
- `audioMessage.seconds` - Duración en segundos
- `audioMessage.waveform` - Forma de onda en Base64 para visualización
- `audioMessage.mimetype` = `"audio/ogg; codecs=opus"` - Formato típico

---

## 2. Archivo de Audio (No PTT)

```json
{
  "message": {
    "audioMessage": {
      "url": "https://mmg.whatsapp.net/v/t62.7117-24/...",
      "mimetype": "audio/ogg; codecs=opus",
      "fileSha256": "frtdS0Pc++S6ywrX5MBURUFoEoaoqiyPeGMBl7pgbSw=",
      "fileLength": "90552",
      "seconds": 38,
      "ptt": false,
      "mediaKey": "f/2PVHe8caGXqpP7zVBxm8h88vyNXqTK2izyHmc+IKs=",
      "directPath": "/v/t62.7117-24/...",
      "contextInfo": {
        "forwardingScore": 1,
        "isForwarded": true,
        "expiration": 7776000
      },
      "waveform": "AFRSSh8GAABYUDkOQlk6NgAtDkY8KzUdTThNKAQlP1NKMkNJWAAzLABOVDFDOkAFUTNONy4wNyBFEwULAFMOAA=="
    }
  }
}
```

**Diferencia clave:**
- `audioMessage.ptt` = `false` - Archivo de audio (no nota de voz)
- Sin visualización especial de "grabación"

---

## 3. Reacción en Audio

Mismo formato: `reactionMessage.text: "😂"`

---

## 4. Eliminación de Audio

Mismo formato: `protocolMessage.type: "REVOKE"`

---

## 5. Audio Reenviado

El campo `contextInfo.isForwarded: true` indica reenvío (ver ejemplo de Archivo de Audio arriba).

---

---

---

# Ubicaciones

## 1. Ubicación Actual

**Evento:** `messages.upsert` con `type: "notify"`

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC11AAC400F14FC9E2AA671EEA6C8EB2"
  },
  "messageTimestamp": 1767367923,
  "pushName": "Miguel Alejandro Guevara",
  "message": {
    "locationMessage": {
      "degreesLatitude": 8.2570825,
      "degreesLongitude": -62.797469,
      "contextInfo": {
        "expiration": 7776000,
        "ephemeralSettingTimestamp": "1752995285",
        "disappearingMode": {
          "initiator": "INITIATED_BY_ME",
          "trigger": "ACCOUNT_SETTING",
          "initiatedByMe": true
        }
      }
    },
    "messageContextInfo": {
      "deviceListMetadata": { ... },
      "deviceListMetadataVersion": 2,
      "messageSecret": "..."
    }
  }
}
```

**Campos clave:**
- `locationMessage.degreesLatitude` - Latitud en grados decimales
- `locationMessage.degreesLongitude` - Longitud en grados decimales

---

## 2. Ubicación en Vivo

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC4E61B2CA235B020F9A1BE28017DF4C"
  },
  "messageTimestamp": 1767367935,
  "pushName": "Miguel Alejandro Guevara",
  "message": {
    "liveLocationMessage": {
      "degreesLatitude": 8.2570838,
      "degreesLongitude": -62.7974644,
      "caption": "Caption here",
      "sequenceNumber": "1767367934423001",
      "contextInfo": {
        "expiration": 7776000,
        "disappearingMode": { ... }
      }
    }
  }
}
```

**Campos clave adicionales:**
- `liveLocationMessage.caption` - Texto descriptivo opcional
- `liveLocationMessage.sequenceNumber` - Número de secuencia para actualizaciones

---

## 3. Reacción en Ubicación

Mismo formato: `reactionMessage.text: "❤️"`

---

## 4. Eliminación de Ubicación

Mismo formato: `protocolMessage.type: "REVOKE"`

```json
{
  "message": {
    "protocolMessage": {
      "key": {
        "remoteJid": "9698623357112@lid",
        "fromMe": true,
        "id": "AC11AAC400F14FC9E2AA671EEA6C8EB2"
      },
      "type": "REVOKE"
    }
  }
}
```

---

---

# Encuestas

## 1. Crear Encuesta

**Evento:** `messages.upsert` con `type: "notify"`

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC1AD49BBFFC4B9257052FB9FC788060"
  },
  "messageTimestamp": 1767367967,
  "pushName": "Miguel Alejandro Guevara",
  "message": {
    "messageContextInfo": {
      "deviceListMetadata": { ... },
      "deviceListMetadataVersion": 2,
      "messageSecret": "PRdzIZUGahJ6JTwa2mFOsasy1jjVGzQbaoaR6NAWZBE="
    },
    "pollCreationMessageV3": {
      "name": "Poll",
      "options": [
        { "optionName": "Option A" },
        { "optionName": "Option B" }
      ],
      "selectableOptionsCount": 0,
      "contextInfo": {
        "expiration": 7776000,
        "disappearingMode": { ... }
      }
    }
  }
}
```

**Campos clave:**
- `pollCreationMessageV3.name` - Pregunta de la encuesta
- `pollCreationMessageV3.options` - Arreglo de opciones
- `pollCreationMessageV3.options[].optionName` - Texto de la opción
- `pollCreationMessageV3.selectableOptionsCount` - Cantidad de opciones seleccionables (0 = todas)

**Nota:** También existen `pollCreationMessage` y `pollCreationMessageV2` (versiones anteriores).

---

## 2. Votar en Encuesta

**Evento:** `messages.upsert` con `type: "notify"`

```json
{
  "key": {
    "remoteJid": "140913951141911@lid",
    "fromMe": false,
    "id": "AC6710CD95104D348CC3DE9AF8AF642E"
  },
  "messageTimestamp": 1767367970,
  "pushName": "Miguel Alejandro Guevara",
  "message": {
    "messageContextInfo": {
      "deviceListMetadata": { ... },
      "deviceListMetadataVersion": 2
    },
    "pollUpdateMessage": {
      "pollCreationMessageKey": {
        "remoteJid": "140913951141911@lid",
        "fromMe": false,
        "id": "AC1AD49BBFFC4B9257052FB9FC788060"
      },
      "vote": {
        "encPayload": "mMqBgjeF/JOksgWLasDRH2iU3cOVjTxjcNyHW8/hWNnRCj9neeO7oJ5Twj1UpfQh4GY=",
        "encIv": "JfP8NerkiAgbbM1R"
      },
      "senderTimestampMs": "1767367970421"
    }
  }
}
```

**Campos clave:**
- `pollUpdateMessage.pollCreationMessageKey` - Referencia a la encuesta original
- `pollUpdateMessage.vote.encPayload` - Voto encriptado (end-to-end)
- `pollUpdateMessage.vote.encIv` - IV para desencriptar el voto

**Nota:** Los votos están encriptados E2E. Se necesita el `messageSecret` de la encuesta original para desencriptarlos.

---

## 3. Reacción en Encuesta

Mismo formato: `reactionMessage.text: "😂"`

```json
{
  "message": {
    "reactionMessage": {
      "key": {
        "remoteJid": "140913951141911@lid",
        "fromMe": false,
        "id": "AC1AD49BBFFC4B9257052FB9FC788060"
      },
      "text": "😂",
      "senderTimestampMs": "1767367973345"
    }
  }
}
```

---

## 4. Eliminación de Encuesta

Mismo formato: `protocolMessage.type: "REVOKE"`

```json
{
  "message": {
    "protocolMessage": {
      "key": {
        "remoteJid": "9698623357112@lid",
        "fromMe": true,
        "id": "AC1AD49BBFFC4B9257052FB9FC788060"
      },
      "type": "REVOKE"
    }
  }
}
```

---

---

## Formatos de remoteJid

| Formato | Descripción |
|---------|-------------|
| `NUMBER@s.whatsapp.net` | Chat individual (formato antiguo) |
| `NUMBER@lid` | Chat individual (formato nuevo) |
| `NUMBER-TIMESTAMP@g.us` | Grupo |
| `status@broadcast` | Estado/Historias |

---

---

# Eventos de Chat

## 1. Chat Fijado

**Evento:** `chats.update`

### Fijar chat
```json
[
  {
    "id": "140913951141911@lid",
    "pinned": 1767371367857,
    "archived": false
  }
]
```

### Desfijar chat
```json
[
  {
    "id": "140913951141911@lid",
    "pinned": null
  }
]
```

**Campos clave:**
- `pinned` - Marca de tiempo cuando se fijó (número) o `null` para desfijar

---

## 2. Chat Archivado

**Evento:** `chats.update`

### Archivar chat
```json
[
  {
    "id": "140913951141911@lid",
    "pinned": null,
    "archived": true
  }
]
```

### Desarchivar chat
```json
[
  {
    "id": "140913951141911@lid",
    "archived": false
  }
]
```

**Campos clave:**
- `archived` - `true` para archivar, `false` para desarchivar

---

## 3. Chat Silenciado

**Evento:** `chats.update`

### Silenciar chat
```json
[
  {
    "id": "140913951141911@lid",
    "muteEndTime": 1767400562932
  }
]
```

### Dessilenciar
```json
[
  {
    "id": "140913951141911@lid",
    "muteEndTime": null
  }
]
```

**Campos clave:**
- `muteEndTime` - Marca de tiempo de expiración del silencio (número) o `null` para dessilenciar

---

## 4. Chat Eliminado

**Evento:** `chats.delete`

```json
[
  "140913951141911@lid"
]
```

**Nota:** Es un arreglo de IDs de chats eliminados.

---

## 5. Mensaje Leído

**Evento:** `messages.update`

```json
[
  {
    "key": {
      "remoteJid": "140913951141911@lid",
      "id": "AC08701FBF0EEADEB4250A56C0B91BFB",
      "fromMe": false
    },
    "update": {
      "status": 4
    }
  }
]
```

**Valores de estado:**
| Estado | Descripción |
|--------|-------------|
| 1 | PENDING |
| 2 | SERVER_ACK |
| 3 | DELIVERY_ACK (entregado) |
| 4 | READ |
| 5 | PLAYED (para audio/video) |

---

## 6. Presencia (Escritura/En línea)

**Evento:** `presence.update`

```json
{
  "id": "140913951141911@lid",
  "presences": {
    "140913951141911@lid": {
      "lastKnownPresence": "composing"
    }
  }
}
```

**Valores de lastKnownPresence:**
| Valor | Descripción |
|-------|-------------|
| `composing` | Escribiendo |
| `recording` | Grabando audio |
| `paused` | Detuvo de escribir |
| `available` | En línea |
| `unavailable` | Desconectado |
