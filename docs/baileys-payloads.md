# Baileys Event Payloads Reference

Complete payload documentation captured from Baileys v6.7.18 for all message types:
- **Text** - Simple and extended text messages
- **Images** - With caption, thumbnails, and media keys
- **Videos** - With streaming sidecar and duration
- **Audio** - Voice notes (PTT) and audio files
- **Locations** - Static and live
- **Polls** - Creation and votes (E2E encrypted)

---

## 1. Text Message (new)

**Event:** `messages.upsert` with `type: "notify"`

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

**Key fields:**
- `key.remoteJid` - Chat ID (`@lid` or `@s.whatsapp.net` format)
- `key.fromMe` - Whether the message was sent by us
- `key.id` - Unique message ID
- `pushName` - Sender name
- `message.extendedTextMessage.text` - Text content

---

## 2. Message Edit

### 2.1 Via `messages.upsert` (protocolMessage)

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

### 2.2 Via `messages.update`

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

**Key fields:**
- `protocolMessage.type` = `"MESSAGE_EDIT"` (or `14` as number)
- `protocolMessage.key.id` - Target message ID to edit
- `protocolMessage.editedMessage` - New message content

---

## 3. Reaction

### 3.1 Via `messages.upsert` (reactionMessage)

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

### 3.2 Via `messages.reaction`

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

**Key fields:**
- `reactionMessage.key.id` - ID of the message being reacted to
- `reactionMessage.text` - Reaction emoji (empty = remove reaction)

---

## 4. Deletion (REVOKE)

### 4.1 Via `messages.upsert` (protocolMessage)

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

### 4.2 Via `messages.update`

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

**Key fields:**
- `protocolMessage.type` = `"REVOKE"` (or `0` as number)
- `protocolMessage.key.id` - ID of the message to delete
- In `messages.update`: `message: null` and `messageStubType: 1`

---

## 5. Forwarded Message

**Event:** `messages.upsert` with `type: "notify"`

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

**Key fields:**
- `contextInfo.isForwarded` = `true` - Indicates forwarded
- `contextInfo.forwardingScore` - Number of times forwarded (1+)

---

## Protocol Message Type Summary

| Type | Numeric Value | Description |
|------|---------------|-------------|
| `REVOKE` | 0 | Delete message |
| `EPHEMERAL_SETTING` | 3 | Ephemeral message change |
| `EPHEMERAL_SYNC_RESPONSE` | 6 | Sync response |
| `HISTORY_SYNC_NOTIFICATION` | 7 | History sync |
| `MESSAGE_EDIT` | 14 | Edit message |

---

---

# Images

## 1. New Image

**Event:** `messages.upsert` with `type: "notify"`

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

**Key fields:**
- `imageMessage.url` - Download URL (temporary)
- `imageMessage.mediaKey` - File decryption key
- `imageMessage.directPath` - Direct CDN path
- `imageMessage.caption` - Caption text
- `imageMessage.jpegThumbnail` - Base64 thumbnail
- `imageMessage.mimetype` - MIME type
- `imageMessage.fileLength` - Size in bytes

---

## 2. Caption Edit (Image)

### Via `messages.upsert` (protocolMessage)

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

### Via `messages.update`

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

**Note:** Only the `caption` is edited, the image remains the same.

---

## 3. Image Reaction

Same format as text - uses `reactionMessage`:

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

## 4. Image Deletion

Same format as text - uses `protocolMessage.type: "REVOKE"`:

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

## 5. Forwarded Image

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

**Key fields:**
- `contextInfo.isForwarded` = `true`
- `contextInfo.forwardingScore` = number of forwards
- `scansSidecar` and `scanLengths` - quality scan data

---

---

# Videos

## 1. New Video

**Event:** `messages.upsert` with `type: "notify"`

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

**Key fields (in addition to image):**
- `videoMessage.seconds` - Duration in seconds
- `videoMessage.streamingSidecar` - Progressive streaming data
- `contextInfo.pairedMediaType` = `"SD_VIDEO_PARENT"` - SD video with possible HD
- `contextInfo.statusSourceType` = `"VIDEO"`

---

## 2. Caption Edit (Video)

### Via `messages.update`

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

## 3. Video Reaction

Same format: `reactionMessage.text: "❤️"`

---

## 4. Video Deletion

Same format: `protocolMessage.type: "REVOKE"`

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

## 5. Forwarded Video

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

## 1. Voice Note (PTT)

**Event:** `messages.upsert` with `type: "notify"` or `"append"`

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

**Key fields:**
- `audioMessage.ptt` = `true` - Push-to-Talk (voice note)
- `audioMessage.seconds` - Duration in seconds
- `audioMessage.waveform` - Base64 waveform for visualization
- `audioMessage.mimetype` = `"audio/ogg; codecs=opus"` - Typical format

---

## 2. Audio File (Not PTT)

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

**Key difference:**
- `audioMessage.ptt` = `false` - Audio file (not voice note)
- No special "recording" visualization

---

## 3. Audio Reaction

Same format: `reactionMessage.text: "😂"`

---

## 4. Audio Deletion

Same format: `protocolMessage.type: "REVOKE"`

---

## 5. Forwarded Audio

The field `contextInfo.isForwarded: true` indicates forwarding (see Audio File example above).

---

---

---

# Locations

## 1. Current Location

**Event:** `messages.upsert` with `type: "notify"`

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

**Key fields:**
- `locationMessage.degreesLatitude` - Latitude in decimal degrees
- `locationMessage.degreesLongitude` - Longitude in decimal degrees

---

## 2. Live Location

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

**Additional key fields:**
- `liveLocationMessage.caption` - Optional descriptive text
- `liveLocationMessage.sequenceNumber` - Sequence number for updates

---

## 3. Location Reaction

Same format: `reactionMessage.text: "❤️"`

---

## 4. Location Deletion

Same format: `protocolMessage.type: "REVOKE"`

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

# Polls

## 1. Create Poll

**Event:** `messages.upsert` with `type: "notify"`

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

**Key fields:**
- `pollCreationMessageV3.name` - Poll question
- `pollCreationMessageV3.options` - Array of options
- `pollCreationMessageV3.options[].optionName` - Option text
- `pollCreationMessageV3.selectableOptionsCount` - Selectable options count (0 = all)

**Note:** `pollCreationMessage` and `pollCreationMessageV2` also exist (older versions).

---

## 2. Vote on Poll

**Event:** `messages.upsert` with `type: "notify"`

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

**Key fields:**
- `pollUpdateMessage.pollCreationMessageKey` - Reference to the original poll
- `pollUpdateMessage.vote.encPayload` - Encrypted vote (end-to-end)
- `pollUpdateMessage.vote.encIv` - IV for decrypting the vote

**Note:** Votes are E2E encrypted. The `messageSecret` from the original poll is needed to decrypt them.

---

## 3. Poll Reaction

Same format: `reactionMessage.text: "😂"`

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

## 4. Poll Deletion

Same format: `protocolMessage.type: "REVOKE"`

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

## remoteJid Formats

| Format | Description |
|--------|-------------|
| `NUMBER@s.whatsapp.net` | Individual chat (old format) |
| `NUMBER@lid` | Individual chat (new format) |
| `NUMBER-TIMESTAMP@g.us` | Group |
| `status@broadcast` | Status/Stories |

---

---

# Chat Events

## 1. Chat Pinned

**Event:** `chats.update`

### Pin chat
```json
[
  {
    "id": "140913951141911@lid",
    "pinned": 1767371367857,
    "archived": false
  }
]
```

### Unpin chat
```json
[
  {
    "id": "140913951141911@lid",
    "pinned": null
  }
]
```

**Key fields:**
- `pinned` - Timestamp when pinned (number) or `null` to unpin

---

## 2. Chat Archived

**Event:** `chats.update`

### Archive chat
```json
[
  {
    "id": "140913951141911@lid",
    "pinned": null,
    "archived": true
  }
]
```

### Unarchive chat
```json
[
  {
    "id": "140913951141911@lid",
    "archived": false
  }
]
```

**Key fields:**
- `archived` - `true` to archive, `false` to unarchive

---

## 3. Chat Muted

**Event:** `chats.update`

### Mute chat
```json
[
  {
    "id": "140913951141911@lid",
    "muteEndTime": 1767400562932
  }
]
```

### Unmute
```json
[
  {
    "id": "140913951141911@lid",
    "muteEndTime": null
  }
]
```

**Key fields:**
- `muteEndTime` - Mute expiration timestamp (number) or `null` to unmute

---

## 4. Chat Deleted

**Event:** `chats.delete`

```json
[
  "140913951141911@lid"
]
```

**Note:** It's an array of deleted chat IDs.

---

## 5. Message Read

**Event:** `messages.update`

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

**Status values:**
| Status | Description |
|--------|-------------|
| 1 | PENDING |
| 2 | SERVER_ACK |
| 3 | DELIVERY_ACK (delivered) |
| 4 | READ |
| 5 | PLAYED (for audio/video) |

---

## 6. Presence (Typing/Online)

**Event:** `presence.update`

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

**lastKnownPresence values:**
| Value | Description |
|-------|-------------|
| `composing` | Typing |
| `recording` | Recording audio |
| `paused` | Stopped typing |
| `available` | Online |
| `unavailable` | Disconnected |
