import { z } from 'zod';
export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireThat(condition, message, status = 409) {
  if (!condition) throw new AppError(status, message);
}
export const uuid = z.uuid();
export const money = z.number().finite().min(0).max(1000000).multipleOf(0.01);
export const credentials = z.object({ correo: z.email().max(150).transform(s => s.toLowerCase()), password: z.string().min(10).max(128) });
export const registration = credentials.extend({ nombre: z.string().trim().min(2).max(120) });
export const userUpdate = z.object({ nombre: z.string().trim().min(2).max(120), rol: z.enum(['administrador','docente','estudiante']), activo: z.boolean() });
export const rules = z.object({
  capital_inicial: money.min(100).default(1500), capacidad: z.number().int().min(2).max(6).default(6),
  rondas: z.number().int().min(1).max(1000).default(20), duracion_minutos: z.number().int().min(1).max(480).default(60),
  premio_salida: money.default(200), max_inversion: z.number().int().min(0).max(5).default(4),
  valores: z.record(uuid, z.object({ precio: money.positive(), alquiler: money, rescate: money,
    costo_inversion: money.positive(), incremento_alquiler: money }).strict()).default({})
}).strict();
export const createGame = z.object({ nombre: z.string().trim().min(2).max(120), tablero_id: uuid, configuracion: rules });
export const actionInput = z.object({
  clave_accion: uuid, version: z.number().int().nonnegative(),
  tipo: z.enum(['iniciar','pausar','reanudar','finalizar','cancelar','lanzar','comprar','invertir','vender','ofertar','aceptar','rechazar','cerrar_turno','insolvencia']),
  datos: z.object({ activo_id: uuid.optional(), comprador_id: uuid.optional(), oferta_id: uuid.optional(), precio: money.positive().optional(), motivo: z.string().trim().min(5).max(500).optional() }).strict().default({})
}).strict();
export const cents = x => Math.round(Number(x) * 100);
export const amount = c => c / 100;
