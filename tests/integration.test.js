import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { io as clientSocket } from 'socket.io-client';
import { testDatabase } from './database.js';
import { migrate,seedCatalog,BOARD_ID } from '../server/catalog.js';
import { hashPassword } from '../server/security.js';
import { buildApp } from '../server/app.js';
import { expireGames } from '../server/repository.js';
const password='PruebaSegura_2026';
test('API, esquema PostgreSQL y Socket.IO',async t=>{
  const db=await testDatabase(),c=await db.connect();await migrate(c);await seedCatalog(c);c.release();
  const server=buildApp(db),agents={},users={};
  await new Promise(r=>server.http.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.stop();await new Promise(r=>server.io.close(r));await db.end();});
  for(const [i,rol]of ['administrador','docente','estudiante','estudiante','docente','estudiante'].entries()){
    const id=randomUUID(),correo=`user${i}@ceicom.test`;users[i]={id,correo,rol};await db.query('INSERT INTO usuarios(id,nombre,correo,password_hash,rol) VALUES($1,$2,$3,$4,$5)',[id,'Usuario '+i,correo,await hashPassword(password),rol]);agents[i]=request.agent(server.http);const login=await agents[i].post('/api/auth/login').send({correo,password});assert.equal(login.status,200);users[i].cookie=login.headers['set-cookie'][0].split(';')[0];
  }
  let game;
  await t.test('registro siempre estudiante, duplicados y credenciales inválidas',async()=>{
    const r=await request(server.app).post('/api/auth/registro').send({nombre:'Alumno nuevo',correo:'NUEVO@ceicom.test',password,rol:'administrador'});assert.equal(r.status,201);assert.equal(r.body.rol,'estudiante');assert.equal(r.body.correo,'nuevo@ceicom.test');
    assert.equal((await request(server.app).post('/api/auth/registro').send({nombre:'Otro',correo:'nuevo@ceicom.test',password})).status,409);
    assert.equal((await request(server.app).post('/api/auth/login').send({correo:users[2].correo,password:'Incorrecta123'})).status,401);
    assert.equal((await request(server.app).get('/api/partidas')).status,401);
  });
  await t.test('roles, creación, ingreso repetido y límite de capacidad',async()=>{
    const data={nombre:'Actividad API',tablero_id:BOARD_ID,configuracion:{capacidad:2}};
    assert.equal((await agents[2].post('/api/partidas').send(data)).status,403);
    const r=await agents[1].post('/api/partidas').send(data);assert.equal(r.status,201);game=r.body;
    for(const i of [2,3,2])assert.equal((await agents[i].post('/api/partidas/ingresar').send({codigo:game.codigo})).status,200);
    assert.equal((await agents[5].post('/api/partidas/ingresar').send({codigo:game.codigo})).status,409);
    assert.equal((await agents[4].get('/api/partidas/'+game.id)).status,403);assert.equal((await agents[5].get('/api/partidas/'+game.id+'/historial')).status,403);
  });
  const state=async()=>{const r=await agents[1].get('/api/partidas/'+game.id);assert.equal(r.status,200);return r.body;};
  const action=async(i,tipo,datos={},extra={})=>agents[i].post('/api/partidas/'+game.id+'/acciones').send({clave_accion:randomUUID(),version:Number((await state()).partida.version_estado),tipo,datos,...extra});
  await t.test('inicio y configuración bloqueada después del comienzo',async()=>{
    assert.equal((await action(1,'iniciar')).status,200);assert.equal((await agents[1].put('/api/partidas/'+game.id+'/reglas').send({})).status,409);
    const s=await state();assert.equal(s.participantes.length,2);assert.equal(s.participantes[0].saldo,1500);assert.equal(s.activos.length,28);
    assert.equal((await action(3,'lanzar')).status,403);
  });
  await t.test('concurrencia e idempotencia: un lanzamiento para dos solicitudes',async()=>{
    const payload={clave_accion:randomUUID(),version:Number((await state()).partida.version_estado),tipo:'lanzar',datos:{}};
    const result=await Promise.all([agents[2].post('/api/partidas/'+game.id+'/acciones').send(payload),agents[2].post('/api/partidas/'+game.id+'/acciones').send(payload)]);
    assert.deepEqual(result.map(r=>r.status),[200,200]);assert.equal(result.filter(r=>r.body.repetida).length,1);
    assert.equal((await db.query("SELECT count(*) AS n FROM acciones WHERE partida_id=$1 AND tipo='lanzar'",[game.id])).rows[0].n,1);
    assert.equal((await agents[2].post('/api/partidas/'+game.id+'/acciones').send({...payload,datos:{motivo:'Diferente'}})).status,409);
    assert.equal((await action(2,'lanzar')).status,409);
  });
  await t.test('rollback: propiedad ajena o compra inválida no cambia saldos ni acciones',async()=>{
    const s=await state(),count=(await db.query('SELECT count(*) AS n FROM acciones')).rows[0].n;
    assert.equal((await action(2,'comprar',{activo_id:s.activos.find(a=>a.casilla_id!==s.casillas.find(c=>c.posicion===s.participantes.find(p=>p.usuario_id===users[2].id).posicion)?.id).id})).status,409);
    assert.equal((await db.query('SELECT count(*) AS n FROM acciones')).rows[0].n,count);assert.equal((await state()).partida.version_estado,s.partida.version_estado);
  });
  await t.test('FK compuestas impiden cruzar participantes entre partidas',async()=>{
    const other=await agents[1].post('/api/partidas').send({nombre:'Otra partida',tablero_id:BOARD_ID,configuracion:{}});await agents[5].post('/api/partidas/ingresar').send({codigo:other.body.codigo});
    const stranger=(await db.query('SELECT id FROM participantes WHERE partida_id=$1',[other.body.id])).rows[0].id;
    const assetId=(await state()).activos[0].id;
    await assert.rejects(()=>db.query('UPDATE activos_partida SET propietario_id=$1 WHERE id=$2',[stranger,assetId]),e=>e.code==='23503');
  });
  await t.test('compra duplicada y fallo de transferencia revierten toda la operación',async()=>{
    const s=await state(),seller=s.participantes.find(p=>p.usuario_id===users[2].id),buyer=s.participantes.find(p=>p.usuario_id===users[3].id),a=s.activos[0];
    const position=s.casillas.find(c=>c.id===a.casilla_id).posicion;
    await db.query('UPDATE participantes SET posicion=$1 WHERE id=$2',[position,seller.id]);
    const payload={clave_accion:randomUUID(),version:Number(s.partida.version_estado),tipo:'comprar',datos:{activo_id:a.id}};
    const rs=await Promise.all([agents[2].post('/api/partidas/'+game.id+'/acciones').send(payload),agents[2].post('/api/partidas/'+game.id+'/acciones').send(payload)]);
    assert.deepEqual(rs.map(r=>r.status),[200,200]);assert.equal(rs.filter(r=>r.body.repetida).length,1);
    assert.equal((await action(2,'ofertar',{activo_id:a.id,comprador_id:buyer.id,precio:300})).status,200);
    const before=await state(),offer=before.ofertas[0];
    // Provoca una falla SQL real después de actualizar los saldos y el propietario.
    await db.query(`CREATE FUNCTION prueba_fallo() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tipo='transferencia' THEN RAISE EXCEPTION 'Fallo controlado' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fallo_pago BEFORE INSERT ON movimientos FOR EACH ROW EXECUTE FUNCTION prueba_fallo();`);
    assert.equal((await action(3,'aceptar',{oferta_id:offer.id})).status,400);
    const failed=await state();assert.equal(failed.partida.version_estado,before.partida.version_estado);assert.equal(failed.activos.find(x=>x.id===a.id).propietario_id,seller.id);
    assert.deepEqual(failed.participantes.map(p=>p.saldo),before.participantes.map(p=>p.saldo));assert.equal(failed.ofertas[0].estado,'pendiente');
    await db.query('DROP TRIGGER fallo_pago ON movimientos; DROP FUNCTION prueba_fallo();');
    assert.equal((await action(3,'aceptar',{oferta_id:offer.id})).status,200);
    assert.equal((await state()).activos.find(x=>x.id===a.id).propietario_id,buyer.id);
    assert.equal((await action(3,'aceptar',{oferta_id:offer.id})).status,409);
  });
  await t.test('reporte del estudiante solo incluye su participación',async()=>{
    const r=await agents[2].get('/api/partidas/'+game.id+'/reporte');assert.equal(r.status,200);assert.equal(r.body.resultados.length,1);assert.equal(r.body.resultados[0].capital_inicial,1500);
    const all=await agents[1].get('/api/partidas/'+game.id+'/reporte');assert.equal(all.body.resultados.length,2);
  });
  await t.test('Socket.IO: autenticación, observación, reconexión y revocación',async()=>{
    const url='http://127.0.0.1:'+server.http.address().port;
    const bad=clientSocket(url,{transports:['websocket'],reconnection:false});await new Promise((resolve,reject)=>{bad.once('connect_error',()=>{bad.close();resolve();});bad.once('connect',()=>reject(new Error('Socket sin sesión aceptado')));});
    const socket=clientSocket(url,{transports:['websocket'],extraHeaders:{Cookie:users[2].cookie},reconnection:false});
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
    const observed=await socket.timeout(3000).emitWithAck('partida:observar',{id:game.id});assert.equal(observed.estado.partida.id,game.id);
    socket.disconnect();socket.connect();await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
    const restored=await socket.timeout(3000).emitWithAck('partida:observar',{id:game.id});assert.equal(restored.estado.partida.version_estado,observed.estado.partida.version_estado);
    const disconnected=new Promise(r=>socket.once('disconnect',r));assert.equal((await agents[2].post('/api/auth/logout').send({})).status,200);await disconnected;socket.close();
    assert.equal((await agents[2].get('/api/partidas/'+game.id)).status,401);
    const newLogin=await agents[2].post('/api/auth/login').send({correo:users[2].correo,password});assert.equal(newLogin.status,200);
    assert.equal((await agents[2].get('/api/partidas/'+game.id)).status,200);
  });
  await t.test('desactivar cuenta conserva historial e invalida acceso',async()=>{
    assert.equal((await agents[0].patch('/api/usuarios/'+users[3].id).send({nombre:'Cuenta desactivada',rol:'estudiante',activo:false})).status,200);
    assert.equal((await agents[3].get('/api/auth/yo')).status,401);
    assert.equal((await agents[3].post('/api/auth/login').send({correo:users[3].correo,password})).status,401);
    assert.equal((await db.query('SELECT count(*) AS n FROM participantes WHERE usuario_id=$1',[users[3].id])).rows[0].n,1);
  });
  await t.test('límite de duración cierra y conserva el historial',async()=>{
    const count=(await db.query('SELECT count(*) AS n FROM movimientos WHERE partida_id=$1',[game.id])).rows[0].n;
    await db.query("UPDATE partidas SET tramo_activo_en=now()-interval '2 hours' WHERE id=$1",[game.id]);
    assert.deepEqual(await expireGames(db),[game.id]);const s=await state();assert.equal(s.partida.estado,'finalizada');assert.equal(s.turno,null);
    assert.equal((await db.query('SELECT count(*) AS n FROM movimientos WHERE partida_id=$1',[game.id])).rows[0].n,count);
    assert.equal((await action(2,'lanzar')).status,409);
  });
  await t.test('origen externo y JSON incorrecto rechazados',async()=>{
    assert.equal((await agents[1].post('/api/partidas').set('Origin','https://externo.example').send({})).status,403);
    assert.equal((await agents[1].post('/api/partidas').set('Content-Type','application/json').send('{')).status,400);
  });
});
