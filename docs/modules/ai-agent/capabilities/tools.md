# Registro de capacidades (AI-8)

Las capacidades pertenecen al módulo que las implementa. Ese módulo entrega al registry una definición con nombre, descripción, versión, efecto y esquemas JSON de entrada/salida, además de validadores ejecutables. El paquete neutral `@personal-os/contracts` define el contrato sin importar Nest, Prisma, SDKs ni paquetes de dominio.

`AiCapabilityRegistry` valida definiciones al registrarlas, rechaza IDs duplicados, publica descriptores sin callbacks internos y ejecuta proveedores sin conocer sus implementaciones. Antes de invocar el proveedor valida los argumentos; después valida el resultado. Los validadores y esquemas forman una sola definición propiedad del módulo.

`apps/api` compone los proveedores mediante `AI_CAPABILITY_PROVIDERS`. Cada proveedor recibe un `AiExecutionContext` creado por el host con usuario, invocación y correlación; esos campos nunca se aceptan desde argumentos generados por el modelo. Un proveedor puede declarar que no está disponible para ese contexto; el registry responde con `CAPABILITY_UNAVAILABLE` sin afectar otras capacidades.

El registry también delega la lectura de contexto al proveedor del módulo. La infraestructura de AI no importa Finance ni ejecuta una selección central por dominio. La conversación y el bucle que llamará a estas capacidades son AI-9.
