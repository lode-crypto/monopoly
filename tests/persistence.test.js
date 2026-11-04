import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './database.js';
import { migrate,seedCatalog,BOARD_ID } from '../server/catalog.js';
import { rules } from '../server/validation.js';
import { joinGame,execute,readState } from '../server/repository.js';
test('reiniciar el motor recupera partida y resultado idempotente del disco',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'monopoly-persistencia-'));
  let db=await testDatabase(directory),c=await db.connect();await migrate(c);await seedCatalog(c);c.release();
  const teacher={id:randomUUID(),rol:'docente'},student={id:randomUUID(),rol:'estudiante'},other={id:randomUUID(),rol:'estudiante'},id=randomUUID();
  for(const u of [teacher,student,other])await db.query('INSERT INTO usuarios(id,nombre,correo,password_hash,rol) VALUES($1,$2,$3,$4,$5)',[u.id,'Usuario',u.id+'@ceicom.test','no-utilizado-por-autenticacion',u.rol]);
  await db.query("INSERT INTO partidas(id,docente_id,tablero_id,nombre,codigo,estado,configuracion) VALUES($1,$2,$3,'Persistente','ABCDEF123456','espera',$4)",[id,teacher.id,BOARD_ID,rules.parse({})]);
  await joinGame(db,'ABCDEF123456',student);await joinGame(db,'ABCDEF123456',other);
  await execute(db,id,teacher,{clave_accion:randomUUID(),version:2,tipo:'iniciar',datos:{}});
  const input={clave_accion:randomUUID(),version:3,tipo:'lanzar',datos:{}};
  const result=await execute(db,id,student,input),before=await readState(db,id,student);await db.end();
  db=await testDatabase(directory);
  try{const restored=await readState(db,id,student);assert.deepEqual(restored.participantes,before.participantes);assert.deepEqual(restored.activos,before.activos);assert.deepEqual(restored.turno,before.turno);
    const retry=await execute(db,id,student,input);assert.equal(retry.repetida,true);assert.equal(retry.accion_id,result.accion_id);assert.equal(retry.version,result.version);
  }finally{await db.end();}
});
