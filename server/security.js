import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError } from './validation.js';
const scrypt = promisify(scryptCallback);
export const digest = s => createHash('sha256').update(s).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [algorithm,salt,key] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !key) return false;
  const derived = await scrypt(password,salt,64);
  const expected = Buffer.from(key,'hex');
  return expected.length === derived.length && timingSafeEqual(expected,derived);
}
export function readToken(cookie = '') {
  return cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('mono_session='))?.slice(13);
}
export async function sessionUser(db, cookie) {
  const token = readToken(cookie);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new AppError(401,'Inicia sesión para continuar.');
  const { rows } = await db.query(`SELECT u.id,u.nombre,u.correo,u.rol,s.id AS sesion_id FROM sesiones_acceso s
    JOIN usuarios u ON u.id=s.usuario_id WHERE s.token_hash=$1 AND s.revocada_en IS NULL AND s.expira_en>now() AND u.activo=true`,[digest(token)]);
  if (!rows[0]) throw new AppError(401,'La sesión venció o fue cerrada.');
  return rows[0];
}
export function cookieOptions() { return { httpOnly:true, sameSite:'strict', secure:process.env.NODE_ENV==='production', path:'/', maxAge:8*60*60*1000 }; }
