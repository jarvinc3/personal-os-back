# Seguridad

## Cómo reportar

No abras un issue con los detalles. Escribe a <jarvinct3@gmail.com>.

Incluye lo siguiente:

- qué componente falla: API, autenticación, base de datos, ingesta de correo o inferencia;
- pasos para reproducirlo;
- impacto que observas: datos de otro usuario, sesión tomada, dinero movido;
- versión o commit donde lo viste.

## Alcance

Interesan especialmente el bypass de JWT o de RLS, la exposición de tokens de Gmail o Supabase, la inyección en la API, los cruces entre usuarios y cualquier fallo del ledger que mueva dinero.

## Fuera de alcance

- Dependencias desactualizadas sin una ruta de explotación concreta.
- Reportes automáticos de escáneres sin pasos reproducibles.
- Fallos que solo aparecen con un entorno DEV manipulado a mano.
