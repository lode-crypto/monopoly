# Requisitos y estructura

Fuente: informe `proyecto de grado juan (1).docx`, sección de requisitos funcionales RF-01 a RF-16, casos CU01–CU16 y diccionario de 13 tablas. Algunas conclusiones del informe mencionan 17 requisitos y 20 pruebas; el detalle enumera 16 RF y PF-01 a PF-19. La implementación sigue los requisitos detallados, sin inventar un RF-17.

| Requisito | Implementación | Pantalla |
| --- | --- | --- |
| RF-01 Registro e ingreso | Registro estudiantil, scrypt, sesiones revocables | login.html |
| RF-02 Usuarios y roles | API administrativa, activación y auditoría | admin.html |
| RF-03 Crear partida | Docente responsable, código único, estado espera | salas.html |
| RF-04 Configuración | Validación, precios por propiedad, bloqueo al iniciar | sala.html |
| RF-05 Ingreso | Código, capacidad 2–6, unicidad, ingreso serializado | salas.html |
| RF-06 Ciclo de partida | Inicio, pausa, reanudación, cierre motivado y automático | sala.html y juego.html |
| RF-07 Turnos | Un turno abierto, etapas autorizadas, una sola transición | juego.html |
| RF-08 Dados y movimiento | Dados criptográficos en servidor, efectos persistidos | juego.html |
| RF-09 Compra | Posición, disponibilidad, saldo y dueño único | juego.html |
| RF-10 Pagos | Obligaciones, venta para reunir fondos, insolvencia e incobrables | juego.html |
| RF-11 Venta e inversión | Rescate fijado, límites y propiedad | juego.html |
| RF-12 Transferencia | Ofertas de vigencia por turno, pago y cambio de dueño juntos | juego.html |
| RF-13 Historial | Acciones y movimientos persistidos, consulta paginada | historial.html |
| RF-14 Reportes | Capital separado, ingresos, gastos, activos al rescate, liquidez y CSV | estadisticas.html |
| RF-15 Reconexión | Socket.IO, estado en PostgreSQL, UUID idempotente y versión | sala.html y juego.html |
| RF-16 Cerrar sesión | Revocación, rechazo posterior y desconexión de sockets | Cuenta / cabecera |

Las 13 tablas mantienen los nombres del informe: usuarios, tableros, casillas, partidas, participantes, activos_partida, turnos, acciones, movimientos, ofertas, auditoria, sesiones_acceso y obligaciones.

Se añaden campos auxiliares: `partidas.tramo_activo_en` para medir tiempo activo entre pausas y reinicios; `obligaciones.tipo` y `obligaciones.activo_id` para conservar el concepto y la propiedad del pago. Los estados de turno se normalizan a `pendiente`, `movimiento`, `decision`, `venta_banco`, `cerrado`, y los estados de partida a `espera`, `activa`, `pausada`, `finalizada`, `cancelada`. Se interpreta “Confirmada” en una fila de la matriz de transición como el comienzo del estado `activa`, coherente con el diccionario y el resto del texto.

Integridad adicional: claves foráneas compuestas por identificador y partida; índice de turno abierto único; unicidad por usuario y partida, casilla y partida, y clave de acción; restricciones de saldos no negativos; disparador que verifica que la propiedad pertenece al tablero correcto.

RNF-01/02/08: validación en servidor, permisos, cookies, scrypt, límites de solicitudes, transacciones, consultas parametrizadas y privacidad por rol. RNF-03/04/09: textos de estado, saldos legibles, controles con teclado, foco y comprobación en Chrome a 1440 y 390 px. RNF-06: persistencia, recuperación y guía de respaldo. RNF-07: separación de reglas, persistencia, seguridad e interfaz. RNF-05 y restauración externa de RNF-06 requieren medición y ejecución en el entorno institucional, sin asumir resultados de aceptación.
