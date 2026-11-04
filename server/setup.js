import { randomUUID } from 'node:crypto';
import { createPool } from './db.js';
import { migrate,seedCatalog } from './catalog.js';
import { registration } from './validation.js';
import { hashPassword } from './security.js';
const db = createPool();
try {
  if (process.argv[2]==='migrate') { const c=await db.connect(); try { await migrate(c); await seedCatalog(c); } finally {c.release();} console.log('Esquema y tablero preparados.'); }
  else if (process.argv[2]==='admin') {
    const a = registration.parse({nombre:process.env.ADMIN_NAME,correo:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});
    const r=await db.query(`INSERT INTO usuarios(id,nombre,correo,password_hash,rol) VALUES($1,$2,$3,$4,'administrador') ON CONFLICT(correo) DO NOTHING RETURNING id`,
      [randomUUID(),a.nombre,a.correo,await hashPassword(a.password)]);
    console.log(r.rowCount?'Administrador creado.':'El correo ya existe; no se modificó su contraseña ni su rol.');
  } else throw new Error('Usa npm run db:migrate o npm run db:admin');
} catch(e) { console.error(e.message); process.exitCode=1; } finally { await db.end(); }
