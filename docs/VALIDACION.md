# Validación de la entrega

Fecha: 4 de noviembre de 2026.

## Resultado ejecutado

`npm test`: **23 pruebas, 23 aprobadas, 0 fallidas** (incluye el grupo de integración). Node.js 25.6.0 sobre Windows. La aplicación admite Node 22 o superior.

- Dominio: capital inicial separado, dados, turno ajeno, compra, alquiler, paso por salida, obligaciones, venta para pagar, insolvencia, rescate, límite de inversión, resultado operativo y patrimonio del ejemplo PF-17.
- Negociación: comprador designado, pago y propiedad, aceptación duplicada, vigencia de ofertas y prohibición de tiradas fuera de turno.
- Supervisión: pausas, reloj activo, motivo de cierre, rondas y duración.
- API: registro sin elevación de rol, duplicidad de correo, credenciales incorrectas, capacidad de sala, reglas bloqueadas después de empezar, aislamiento de docentes y privacidad de reportes.
- Integridad SQL: restricciones reales del esquema, clave compuesta que rechaza propietarios de otra partida, compra duplicada e idempotencia de lanzamiento. Una falla SQL provocada durante el registro de una transferencia confirmó que saldos, dueño, oferta, acción y versión se revierten juntos.
- Sesiones y Socket.IO: rechazo sin autenticación, observación autorizada, reconexión, logout que desconecta sockets, acceso posterior denegado y reingreso sin perder datos.
- Persistencia: cierre del motor, reapertura de sus archivos y recuperación de participantes, propiedades, turno y resultado idempotente de una solicitud anterior.
- Entradas: origen externo y JSON inválido rechazados.

`npm run test:ui`: **aprobado** en Chrome sin ventana. Comprueba creación y configuración por docente, ingreso de dos estudiantes, inicio, lanzamiento, sincronización entre dos navegadores, prohibición de turno ajeno, cambio de turno, pausa/reanudación, reporte estudiantil, descarga CSV, render móvil y creación administrativa de un docente. Sin errores JavaScript de página en el recorrido. Se inspeccionaron capturas del tablero en escritorio (1440 px) y móvil (390 px); en móvil el tablero conserva el desplazamiento horizontal del diseño original.

## Alcance y pendientes de aceptación

Las pruebas SQL se ejecutaron con PGlite, que usa PostgreSQL compilado a WASM, y no con un servidor PostgreSQL externo. Su adaptador de pruebas serializa conexiones; permite verificar las transacciones y restricciones, pero **no acredita la contención de bloqueos entre múltiples conexiones PostgreSQL reales**. Producción utiliza `pg.Pool`, transacciones y `FOR UPDATE` sobre cada partida.

No se ejecutaron instalación contra PostgreSQL externo, restauración con pg_dump/pg_restore, pruebas de carga, HTTPS, firewall institucional ni evaluación académica. Antes de usarlo en clases se debe:

1. Instalar siguiendo README y comprobar el flujo con PostgreSQL 17.
2. Ejecutar dos solicitudes concurrentes reales de compra/transferencia y confirmar un único efecto.
3. Respaldar y restaurar una base de prueba; comparar saldos, activos e historial.
4. Acordar cantidad de alumnos concurrentes y tiempos máximos; medir acceso, ingreso, acción y sincronización.
5. Revisar navegación por teclado y uso en los equipos/navegadores de la institución con docentes y estudiantes.

Los valores económicos no fijados en el informe son parámetros iniciales propuestos, descritos en README. Deben ser revisados por el docente antes de la primera actividad. La entrega no afirma resultados de aprendizaje ni da por aprobadas las pruebas de aceptación del informe.
