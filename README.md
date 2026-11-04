# MONOpoly · Simulación empresarial CEICOM

Implementación del backend y conexión del frontend proporcionado por Juan Morales Montalvo, según los requisitos y el diccionario de datos de su informe de grado. Se conserva la paleta, el tablero, los estilos CSS y la composición de la maqueta; los controles y los datos académicos se conectan al servidor.

## Tecnologías

- Node.js 22 o superior, Express 5, Socket.IO 4 y PostgreSQL 17.
- JavaScript modular, validación con Zod y consultas parametrizadas con `pg`.
- Frontend HTML/CSS/JavaScript original. El informe propone React/TypeScript/Phaser para un frontend nuevo; esta entrega mantiene el frontend existente, de acuerdo con la solicitud de implementar su backend sin rehacer el diseño. No se presenta como una migración a esas tres tecnologías.
- Pruebas: Node Test Runner, Supertest, PGlite y Playwright.

## Instalación en Windows

1. Instala Node.js 22+ y PostgreSQL 17. También puedes iniciar PostgreSQL con Docker Compose (paso opcional).
2. Abre esta carpeta en Visual Studio Code y una terminal.
3. Ejecuta `npm ci`.
4. Copia `.env.example` a `.env` y configura `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_NAME` y `ADMIN_PASSWORD` (mínimo 10 caracteres). No publiques `.env`.
5. Crea una base vacía llamada `monopoly` y un usuario con permisos de creación en ella. Si usas Docker, añade `POSTGRES_PASSWORD=tu_clave` a `.env` y ejecuta `docker compose up -d db`. Usa esa misma clave en `DATABASE_URL`; codifica los caracteres especiales de la contraseña como parte de una URL.
6. Ejecuta `npm run db:migrate`. Crea las 13 tablas, índices, restricciones y el catálogo de 40 casillas. Se puede repetir sin recrear ni borrar los datos.
7. Ejecuta `npm run db:admin`. Crea el primer administrador. Si el correo ya existe no lo modifica ni lo eleva de rol. Retira `ADMIN_PASSWORD` de `.env` después del alta.
8. Ejecuta `npm start` y abre [MONOpoly local](http://localhost:3000).

No abras los HTML directamente con doble clic ni con Live Server: la aplicación necesita su servidor de API y Socket.IO.

El archivo SQL es la migración inicial; si ya existe un esquema diferente, utiliza una base nueva o prepara una migración adicional. El comando no adapta automáticamente esquemas antiguos.

## Primer recorrido

1. Inicia sesión como administrador y abre Administración. Crea una cuenta de docente; también puedes activar, desactivar o reasignar cuentas. Las contraseñas nunca se muestran en las respuestas.
2. El docente inicia sesión, abre Salas y crea una partida. Puede configurar capacidad, capital, duración activa, rondas, premio por vuelta, límite de inversión y precios/alquileres/rescates de cada propiedad.
3. Dos o más alumnos se registran por el formulario público. Este registro siempre crea estudiantes.
4. El docente comparte el código de 12 caracteres. Cada alumno ingresa desde Salas. Para probar varias cuentas usa perfiles o ventanas privadas diferentes: las pestañas de un mismo navegador comparten sesión.
5. El docente inicia con 2–6 estudiantes. Los jugadores lanzan, compran, invierten, negocian y terminan sus turnos desde el tablero. Las ofertas se responden en el panel lateral del comprador.
6. Historial conserva decisiones y movimientos. Reportes muestra capital, liquidez, ingresos, gastos, activos, patrimonio, obligaciones e incobrables. El estudiante obtiene su propio reporte; el docente consulta el de sus alumnos. Incluye descarga CSV.

El código de ingreso no hace pública la partida: los datos privados exigen autenticación y pertenencia. Un docente solo administra sus actividades. El administrador puede consultar datos generales y gestionar cuentas, pero no dispone de acciones para editar saldos.

## Reglas implementadas

- Dos dados generados en el servidor, sin turnos extra por dobles.
- Orden único y una sola tirada por turno. Compra únicamente en la propiedad de destino disponible.
- Alquiler = alquiler base + nivel × incremento configurado. Inversión con costo fijo y máximo por propiedad. Venta al banco al rescate definido, sin aumentar el rescate por mejoras.
- Eventos económicos fijos del catálogo; impuestos fijos. Las casillas de prisión del diseño se adaptan a eventos educativos; no existe encarcelamiento. No se implementan tienda, amigos, hipotecas, subastas, bots, equipos ni monedas comerciales, que no forman parte de los RF definidos.
- Fondos insuficientes: se conserva una obligación pendiente sin hacer el saldo negativo. Solo se permite vender al banco; al reunir fondos se liquida la deuda. Si se venden todos los activos y sigue faltando dinero, se declara insolvencia, se transfiere únicamente el efectivo disponible y se registra el resto como incobrable.
- La oferta se presenta durante el turno del vendedor; solo responde el comprador elegido. Vence al cerrar ese turno. Pago y cambio de propietario se confirman en una transacción.
- Reglas bloqueadas después del inicio. Pausa con conservación del mismo turno. El tiempo pausado no cuenta. Cierre por docente con motivo, límite de rondas, límite de tiempo activo o un único participante habilitado.
- Una desconexión no causa insolvencia ni elimina datos. Al volver se recupera el estado persistido. Las acciones llevan una clave UUID para evitar repeticiones y una versión para rechazar pantallas desactualizadas.

Los precios iniciales se tomaron de las etiquetas de tu tablero. Alquileres iniciales (10% del precio), rescates (50%), costo de inversión (100 UMV), incremento (25 UMV) y eventos económicos son valores de partida **propuestos**, porque el informe no fija todos sus números. Se documentan en `db/catalogo.json`; el docente puede cambiar los valores de propiedades antes del inicio. El impuesto empresarial inicial es de 200 UMV y el impuesto final de 75 UMV.

## Verificación

```powershell
npm test
npm run test:ui
```

`npm test` ejecuta las pruebas de dominio, API, restricciones SQL, idempotencia, permisos y Socket.IO contra PGlite (motor PostgreSQL compilado a WASM). No necesita instalar una base externa. La prueba de navegador usa Chrome en su ruta habitual de Windows; puedes definir `CHROME_PATH` si está instalado en otra ruta.

Lee `docs/VALIDACION.md` para los resultados y los límites de la verificación. El servidor de producción siempre usa `pg` y `DATABASE_URL`, sin recurrir a PGlite. La instalación, carga concurrente y restauración deben comprobarse también contra PostgreSQL externo antes de utilizarlo en clases.

## Estructura y contratos

- `server/app.js`: API REST, autenticación de solicitudes, Socket.IO y recursos estáticos.
- `server/engine.js`: reglas, operaciones económicas, turnos y reportes.
- `server/repository.js`: transacciones, permisos por partida, persistencia e idempotencia.
- `server/security.js`: contraseñas scrypt con sal y sesiones de acceso revocables.
- `server/validation.js`: límites y esquemas de entrada.
- `db/001_schema.sql`: las 13 tablas del informe, con claves compuestas que impiden mezclar partidas.
- `db/catalogo.json`: catálogo educativo sobre las 40 casillas visuales.
- `public/`: frontend integrado. Los CSS originales se conservan sin modificaciones; `integracion.css` adapta los controles funcionales.
- `docs/API.md`: rutas y eventos. `docs/TRAZABILIDAD.md`: relación con los requisitos.

## Respaldo, restauración y uso en red

En una terminal que tenga PostgreSQL en PATH, ejecuta:

```powershell
pg_dump --format=custom --file=monopoly.backup --dbname="postgresql://USUARIO:CLAVE@localhost:5432/monopoly"
createdb --host=localhost --username=USUARIO monopoly_restaurada
pg_restore --no-owner --dbname="postgresql://USUARIO:CLAVE@localhost:5432/monopoly_restaurada" monopoly.backup
```

Guarda respaldos fuera de `public/` y comprueba la restauración usando otra base, comparando saldos, propietarios y movimientos. No se ejecutó una restauración externa en esta sesión.

Por defecto el servidor escucha solo en `127.0.0.1`. Para una red institucional configura `HOST=0.0.0.0`, `APP_ORIGIN` con la URL exacta que abrirán los alumnos y un puerto permitido en el firewall. Para publicar usa HTTPS y `NODE_ENV=production` (cookies seguras). Esta versión utiliza un único proceso Node; no configures varias réplicas sin incorporar un adaptador compartido de Socket.IO y límites de acceso compartidos.

Referencias técnicas oficiales: [Express: seguridad](https://expressjs.com/en/advanced/best-practice-security.html), [Socket.IO: middleware](https://socket.io/docs/v4/middlewares/), [Socket.IO: salas](https://socket.io/docs/v4/rooms/), [node-postgres: transacciones](https://node-postgres.com/features/transactions).
# monopoly
