# API y eventos

Base: `/api`. JSON en las escrituras; cookies de sesión HttpOnly con SameSite Strict. Las respuestas privadas no se almacenan en caché. Origin debe coincidir con APP_ORIGIN para clientes de navegador. No hay autenticación mediante datos guardados en localStorage.

| Método y ruta | Permiso / contenido |
| --- | --- |
| GET /salud | Comprobación de acceso a base de datos |
| POST /auth/registro | Público; nombre, correo y password. Rol estudiante obligatorio |
| POST /auth/login | Público; correo, password; establece cookie de 8 horas |
| GET /auth/yo | Cuenta autenticada |
| POST /auth/logout | Invalida la sesión y desconecta sus sockets |
| GET /usuarios | Administrador |
| POST /usuarios | Administrador; nombre, correo, password, rol |
| PATCH /usuarios/:id | Administrador; nombre, rol, activo. Revoca sesiones existentes |
| GET /auditoria | Administrador; últimos 200 registros |
| GET /tableros | Autenticado |
| GET /tableros/:id | Autenticado; casillas y valores base |
| GET /partidas | Según rol, responsabilidad o pertenencia |
| POST /partidas | Docente; nombre, tablero_id, configuracion |
| POST /partidas/ingresar | Estudiante; codigo |
| GET /partidas/:id | Estado autorizado, participantes, activos, casillas, turno, ofertas y obligaciones |
| PUT /partidas/:id/reglas | Docente responsable, únicamente en espera; configuración completa |
| POST /partidas/:id/acciones | Acción idempotente autorizada según turno y rol |
| GET /partidas/:id/historial?pagina=0 | 100 acciones y 200 movimientos por página, usuario autorizado |
| GET /partidas/:id/reporte | Estudiante: propio; docente responsable y administrador: participantes de la partida |

Configuración de ejemplo:

```json
{
  "capital_inicial": 1500,
  "capacidad": 6,
  "rondas": 20,
  "duracion_minutos": 60,
  "premio_salida": 200,
  "max_inversion": 4,
  "valores": {}
}
```

`valores` puede contener por cada UUID de casilla de tipo activo: `precio`, `alquiler`, `rescate`, `costo_inversion`, `incremento_alquiler`. El rescate no puede superar el precio. La configuración de los valores de propiedades está disponible en la sala del docente.

Ejemplo de acción:

```json
{
  "clave_accion": "f2b7f99a-3116-4f99-bd43-c52ea841f901",
  "version": 5,
  "tipo": "comprar",
  "datos": { "activo_id": "7482d495-b2a8-4bf6-a72e-88d4e468aaef" }
}
```

Tipos: `iniciar`, `pausar`, `reanudar`, `finalizar`, `cancelar`, `lanzar`, `comprar`, `invertir`, `vender`, `ofertar`, `aceptar`, `rechazar`, `cerrar_turno`, `insolvencia`.

- Compra/inversión/venta: `activo_id`.
- Ofertar: `activo_id`, `comprador_id`, `precio`.
- Aceptar/rechazar: `oferta_id`.
- Finalizar/cancelar: `motivo`, mínimo cinco caracteres.
- Otras: `datos: {}`.

Una clave repetida con los mismos datos devuelve el resultado confirmado y `repetida: true`; no genera operaciones adicionales. Reutilizar la clave con otros datos produce 409. La versión obsoleta también produce 409; el cliente debe volver a consultar el estado. Se bloquea la fila de la partida con `SELECT ... FOR UPDATE` durante las operaciones y el ingreso a la sala.

Los importes se almacenan como NUMERIC(14,2). Los cálculos de la lógica usan centavos enteros. Los IDs de propiedades, participantes y ofertas son propios de cada partida.

## Socket.IO

Mismo host y cookie que REST. Se autentica al conectar y antes de procesar cada evento.

| Evento | Dirección | Contrato |
| --- | --- | --- |
| partida:observar | Cliente → servidor | `{id}`; ack `{estado}` o `{error,status}`; verifica pertenencia y suscribe a una sola partida |
| partida:accion | Cliente → servidor | `{id,accion}`; mismo cuerpo y servicio transaccional que REST |
| partida:actualizada | Servidor → cliente | `{id}`; señal para recuperar el estado autorizado mediante GET |

La notificación no transporta datos personales ni saldos; cada consulta exige autorización vigente. El cliente vuelve a suscribirse y consulta el estado al reconectar. Una acción cuyo resultado se perdió conserva su UUID en sessionStorage y se reintenta con esa misma clave. Nunca se recupera el estado económico desde el navegador.

Errores: 400 validación, 401 sesión inválida, 403 permiso, 404 recurso, 409 conflicto de reglas/versión/unicidad, 413 tamaño, 415 tipo de contenido y 429 límite de solicitudes. Los errores de infraestructura devuelven un mensaje genérico sin consultas SQL ni credenciales.
