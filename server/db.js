import pg from 'pg';
export function createPool() {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL. Copia .env.example a .env y configura PostgreSQL.');
  return new pg.Pool({ connectionString:process.env.DATABASE_URL, max:10, connectionTimeoutMillis:5000 });
}
export async function transaction(db, fn) {
  const client = await db.connect();
  try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
