# CHANGELOG

## 2025-07-26

### Features

-   Implementar modelo de contactos y mejorar gestión de eventos de mensajería (07272cd)
-   Modificar método reply() de mensajes para retornar instancia Message en lugar de boolean (07272cd)

### Refactor

-   Separar manejo de eventos de socket en handlers específicos para mejor organización (07272cd)
-   Optimizar gestión de eliminación de mensajes con deleteMedia condicional según tipo (07272cd)
-   Simplificar métodos de mensaje eliminando funcionalidad redundante (07272cd)

---

## Historial anterior

### Features

-   Permitir descripción personalizada del navegador en la inicialización del cliente WhatsApp (4ccad93)
-   Emitir eventos de socket al middleware de proceso con contexto de store (9f8a033)
-   Configurar agente de navegador macOS y agregar manejador de recuperación de mensajes (5f82eff)
-   Agregar retraso de 5 segundos antes de solicitar código de emparejamiento (180dcb1)
-   Implementar sistema de caché y reconexión automática para WhatsApp con node-cache (e458423)
-   Agregar métodos de detección de rol, tipo y recuperación de contenido de mensajes (5273d4c)
-   Agregar información de autor de mensaje y mejorar liberación de recursos en métodos de mensaje (b12da52)

### Fixes

-   Hacer condicional la opción de navegador en la configuración de WASocket (b7c7b48)
-   Mejorar manejo de conexión de socket con verificación explícita de estado y timeout más largo (a08e55f)
-   Esperar conexión de socket antes de solicitar código de emparejamiento (7bd91f4)
-   Mover inicialización del store después de configurar las opciones (9ed0bd0)
-   Deshabilitar solicitud de código de emparejamiento y devolver placeholder NO-CODE en su lugar (02b9c26)
-   Agregar llamadas de liberación a operaciones de socket y mejorar detalles de autor de mensaje (7f8a2dc)

### Refactor

-   Optimizar manejo de eventos y agregar emisión de eventos de proceso en cliente WhatsApp (57a77ec)
-   Simplificar login de WhatsApp para usar únicamente autenticación basada en código (c52fd97)
-   Optimizar flujo de conexión de WhatsApp y eliminar emisiones de eventos redundantes (616a989)
-   Simplificar manejo de conexión de WhatsApp y eliminar importaciones sin uso (ad6a158)
-   Introducir getter raw para acceder a datos de mensaje y actualizar referencias (157490f)
-   Agregar información de autor de mensaje y mejorar manejo de liberación de mutex (7fa54cc)
-   Implementar patrón de liberación de recursos en métodos de chat y mensaje (15be77f)

### Docs

-   Agregar comentarios JSDoc a métodos y propiedades de la clase Chat (0bd5cb0)
-   Agregar JSDoc a la clase Base y sus métodos de serialización (f51b081)
-   Agregar comentarios JSDoc a métodos e interfaces de la clase WhatsApp (c538750)
