import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
export const BOARD_ID = 'c6d8537e-5f11-4c15-a135-cb0af01715c0';
export async function migrate(db) {
  const { rows } = await db.query("SELECT to_regclass('public.usuarios') AS tabla");
  if (!rows[0].tabla) await db.query(await readFile(new URL('../db/001_schema.sql',import.meta.url),'utf8'));
}
export async function seedCatalog(db) {
  await db.query('BEGIN');
  try {
    await db.query(`INSERT INTO tableros(id,nombre,version,descripcion) VALUES($1,$2,1,$3) ON CONFLICT DO NOTHING`,
      [BOARD_ID,'Ciudades del mundo · CEICOM','Variante educativa: 2 dados, sin turnos extra; compras, inversiones y obligaciones con UMV.']);
    const { rows } = await db.query('SELECT id FROM casillas WHERE tablero_id=$1',[BOARD_ID]);
    if (!rows.length) {
      const cells = JSON.parse(await readFile(new URL('../db/catalogo.json',import.meta.url),'utf8'));
      for (const c of cells) await db.query(`INSERT INTO casillas(id,tablero_id,posicion,nombre,tipo,valores_base) VALUES($1,$2,$3,$4,$5,$6)`,
        [randomUUID(),BOARD_ID,c.posicion,c.nombre,c.tipo,c.valores_base]);
    }
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK'); throw e; }
}
