import { PGlite } from '@electric-sql/pglite';
// Un único motor PostgreSQL WASM por fixture, con exclusión de conexiones.
// Producción utiliza pg.Pool; no se sustituye PostgreSQL por datos en memoria JS.
export async function testDatabase(path) {
  const pg=new PGlite(path);await pg.waitReady;
  let tail=Promise.resolve();
  const acquire=async()=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return release;};
  const raw=async(sql,params)=>{
    if(!params && sql.trim().includes(';')){const all=await pg.exec(sql);return all.at(-1)||{rows:[]};}
    const r=await pg.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};
  };
  return {query:async(sql,params)=>{const release=await acquire();try{return await raw(sql,params);}finally{release();}},
    connect:async()=>{const release=await acquire();return {query:raw,release};},end:()=>pg.close()};
}
