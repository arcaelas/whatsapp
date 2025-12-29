import { WhatsApp } from './_src/WhatsApp';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PHONE = '56962816490';
const STORE_PATH = `.baileys/${PHONE}`;

async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('FASE 1: Autenticación + Sincronización');
    console.log('═══════════════════════════════════════════');
    console.log(`Phone: ${PHONE}`);
    console.log(`Store: ${STORE_PATH}`);
    console.log('');

    const wa = new WhatsApp({ phone: PHONE });

    // Contadores para sync
    let sync_contacts = 0;
    let sync_chats = 0;
    let sync_messages = 0;

    // Eventos de conexión
    wa.on('open', () => {
        console.log('✓ CONECTADO');
        console.log('');
    });

    wa.on('close', () => {
        console.log('✗ DESCONECTADO');
    });

    wa.on('error', (e) => {
        console.log('✗ ERROR:', e.message);
    });

    // Contador de sync
    wa.on('sync', (payload) => {
        sync_contacts += payload.contacts;
        sync_chats += payload.chats;
        sync_messages += payload.messages;
    });

    // FASE 3: Logs de mensajes entrantes
    // FASE 4: Respuestas automáticas (!ping → pong)
    wa.on('message', async (msg) => {
        if (msg.me) return; // Ignorar mensajes propios
        const content = await msg.content();
        const preview = msg.type === 'text'
            ? content.toString().slice(0, 50)
            : `[${content.length} bytes]`;
        console.log(`[${msg.type.toUpperCase()}] ${msg.uid.split('@')[0]}: ${preview}`);

        // Fase 4: Responder a !ping
        if (msg.type === 'text' && content.toString().trim() === '!ping') {
            const sent = await wa.Chat.text(msg.cid, 'pong! 🏓', msg.id);
            if (sent) console.log('  → Respondido: pong! 🏓');
            else console.log('  ✗ Error al enviar respuesta');
        }
    });

    // Autenticación
    console.log('Iniciando autenticación...');
    console.log('');

    try {
        await wa.pair((code) => {
            console.log('┌─────────────────────────────────────────┐');
            console.log('│  CÓDIGO DE EMPAREJAMIENTO               │');
            console.log('├─────────────────────────────────────────┤');
            console.log(`│  ${code}                              │`);
            console.log('├─────────────────────────────────────────┤');
            console.log('│  WhatsApp > Dispositivos vinculados     │');
            console.log('│  > Vincular con número de teléfono      │');
            console.log('└─────────────────────────────────────────┘');
            console.log('');
        });
    } catch (e) {
        console.log('✗ Error en pair():', (e as Error).message);
        process.exit(1);
    }

    console.log('✓ Autenticación exitosa');
    console.log('');

    // Verificar que se guardaron las credenciales
    const creds_path = join(STORE_PATH, 'session', 'creds', 'index');
    if (existsSync(creds_path)) {
        console.log('✓ Credenciales guardadas en:', creds_path);
    } else {
        console.log('⚠ Credenciales NO encontradas en:', creds_path);
    }
    console.log('');

    // Sincronización (con timeout para reconexiones)
    console.log('Sincronizando historial...');
    console.log('');

    const sync_timeout = new Promise<void>((resolve) => setTimeout(() => {
        console.log('(Sync timeout - ya sincronizado o sin historial nuevo)');
        resolve();
    }, 10000));

    await Promise.race([
        wa.sync((progress) => {
            process.stdout.write(`\r  Progreso: ${progress}%   `);
        }),
        sync_timeout,
    ]);

    console.log('');
    console.log('');
    console.log('✓ Sincronización completa');
    console.log('');
    console.log('┌─────────────────────────────────────────┐');
    console.log('│  RESUMEN                                │');
    console.log('├─────────────────────────────────────────┤');
    console.log(`│  Contactos: ${sync_contacts.toString().padEnd(27)}│`);
    console.log(`│  Chats: ${sync_chats.toString().padEnd(31)}│`);
    console.log(`│  Mensajes: ${sync_messages.toString().padEnd(28)}│`);
    console.log('└─────────────────────────────────────────┘');
    console.log('');
    console.log('Presiona Ctrl+C para salir.');
    console.log('Luego ejecuta de nuevo para probar Fase 2 (reconexión).');
}

main().catch((e) => {
    console.error('Error fatal:', e);
    process.exit(1);
});
