import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { digest } from './security.js';
import { requireThat, AppError, rules } from './validation.js';
import { applyAction, currentTurn, elapsed, finish, reports } from './engine.js';
const tables=['participantes','activos_partida','turnos','obligaciones','movimientos','ofertas','auditoria'];
const transient=new Set(['nombre','correo']);
export async function access(db,id,user,lock=false) {
  const {rows}=await db.query(`SELECT * FROM partidas WHERE id=$1 ${lock?'FOR UPDATE':''}`,[id]);
  const g=rows[0];requireThat(g,'No se encontró la partida.',404);
  const member=await db.query('SELECT id FROM participantes WHERE partida_id=$1 AND usuario_id=$2',[id,user.id]);
  requireThat(user.rol==='administrador'||(user.rol==='docente'&&g.docente_id===user.id)||(user.rol==='estudiante'&&member.rows.length),'No tienes acceso a esta partida.',403);
  return g;
}
export async function loadState(db,g) {
  const s={partida:g};
  for(const table of tables) s[table]=(await db.query(`SELECT * FROM ${table} WHERE partida_id=$1`,[g.id])).rows;
  s.casillas=(await db.query('SELECT * FROM casillas WHERE tablero_id=$1 ORDER BY posicion',[g.tablero_id])).rows;
  const names=(await db.query('SELECT id,nombre FROM usuarios WHERE id IN (SELECT usuario_id FROM participantes WHERE partida_id=$1)',[g.id])).rows;
  for(const p of s.participantes)p.nombre=names.find(u=>u.id===p.usuario_id)?.nombre||'Estudiante';
  for(const p of s.participantes){p.saldo=Number(p.saldo);p.obligacion_pendiente=Number(p.obligacion_pendiente);}
  for(const a of s.activos_partida){a.precio_base=Number(a.precio_base);a.valor_rescate=Number(a.valor_rescate);}
  for(const o of s.obligaciones){o.importe_original=Number(o.importe_original);o.importe_pagado=Number(o.importe_pagado);}
  for(const o of s.ofertas)o.precio=Number(o.precio);
  for(const m of s.movimientos)m.importe=Number(m.importe);
  g.version_estado=Number(g.version_estado);g.tiempo_activo_ms=Number(g.tiempo_activo_ms);
  return s;
}
async function upsert(db,table,row) {
  const keys=Object.keys(row).filter(k=>!transient.has(k)||table==='partidas');
  const values=keys.map(k=>row[k]===undefined?null:['configuracion','dados','detalle'].includes(k)&&row[k]!==null?JSON.stringify(row[k]):row[k]);
  await db.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(id) DO UPDATE SET ${keys.filter(k=>k!=='id').map(k=>`${k}=EXCLUDED.${k}`).join(',')}`,values);
}
export async function saveState(db,s,before) {
  await upsert(db,'partidas',s.partida);
  for(const table of tables) {
    // Cierra el turno anterior antes de insertar el nuevo (índice de turno único).
    for(const row of s[table]) if(JSON.stringify(row)!==before?.[table]?.get(row.id)) await upsert(db,table,row);
  }
}
const snapshot=s=>Object.fromEntries(tables.map(t=>[t,new Map(s[t].map(r=>[r.id,JSON.stringify(r)]))]));
export function publicState(s) {
  return {partida:s.partida,participantes:s.participantes,casillas:s.casillas,activos:s.activos_partida,
    turno:currentTurn(s)||null,ofertas:s.ofertas.filter(o=>o.estado==='pendiente'),obligaciones:s.obligaciones,
    tiempo_activo_ms:elapsed(s)};
}
export async function readState(db,id,user) {
  return transaction(db,async c=>{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');return publicState(await loadState(c,await access(c,id,user)));});
}
export async function execute(db,id,user,input) {
  return transaction(db,async c=>{
    const g=await access(c,id,user,true);
    const hash=digest(JSON.stringify({tipo:input.tipo,datos:input.datos}));
    const prev=(await c.query('SELECT * FROM acciones WHERE partida_id=$1 AND usuario_id=$2 AND clave_accion=$3',[id,user.id,input.clave_accion])).rows[0];
    if(prev){requireThat(prev.parametros_hash===hash,'La clave de acción ya se utilizó con otros datos.');return { ...prev.resultado,repetida:true };}
    requireThat(Number(g.version_estado)===input.version,'El estado cambió. Actualiza la partida antes de continuar.');
    const s=await loadState(c,g), before=snapshot(s), actionId=randomUUID(), oldTurn=currentTurn(s)?.id||null;
    // FK de movimientos: la acción se inserta dentro de la misma transacción antes de sus efectos.
    await c.query(`INSERT INTO acciones(id,partida_id,turno_id,usuario_id,clave_accion,tipo,parametros_hash,version_resultado,resultado) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'{}')`,
      [actionId,id,oldTurn,user.id,input.clave_accion,input.tipo,hash,input.version+1]);
    if(g.estado==='activa' && elapsed(s)>=g.configuracion.duracion_minutos*60000) finish(s,'Límite de duración alcanzado.');
    else applyAction(s,user,input,{id:actionId,dice:undefinedSafeDice});
    g.version_estado++;await saveState(c,s,before);
    const result={version:g.version_estado,accion_id:actionId,estado:g.estado};
    await c.query('UPDATE acciones SET resultado=$1 WHERE id=$2',[result,actionId]);return result;
  });
}
import { randomInt } from 'node:crypto';
const undefinedSafeDice=()=>[randomInt(1,7),randomInt(1,7)];
export async function joinGame(db,code,user) {
  requireThat(user.rol==='estudiante','Solo los estudiantes ingresan como jugadores.',403);
  return transaction(db,async c=>{
    const g=(await c.query('SELECT * FROM partidas WHERE codigo=$1 FOR UPDATE',[code])).rows[0];requireThat(g,'Código incorrecto.',404);
    const ps=(await c.query('SELECT * FROM participantes WHERE partida_id=$1 ORDER BY orden_turno',[g.id])).rows;
    if(ps.some(p=>p.usuario_id===user.id))return {id:g.id};
    requireThat(g.estado==='espera' && ps.length<g.configuracion.capacidad,'La partida ya comenzó o no tiene cupo.');
    await c.query(`INSERT INTO participantes(id,partida_id,usuario_id,orden_turno,estado,ultima_conexion) VALUES($1,$2,$3,$4,'espera',now())`,[randomUUID(),g.id,user.id,ps.length]);
    await c.query('UPDATE partidas SET version_estado=version_estado+1 WHERE id=$1',[g.id]);return {id:g.id};
  });
}
export async function validateCatalog(db,board,config) {
  const cells=(await db.query('SELECT * FROM casillas WHERE tablero_id=$1 ORDER BY posicion',[board])).rows;
  requireThat(cells.length>=12 && cells.every((c,i)=>c.posicion===i),'Tablero inválido.',400);
  for(const [id,v] of Object.entries(config.valores)) {
    requireThat(cells.some(c=>c.id===id && c.tipo==='activo'),'Valor de propiedad fuera del tablero.',400);
    requireThat(v.rescate<=v.precio,'El rescate no puede superar el precio.',400);
  }
}
export async function configure(db,id,user,data) {
  const config=rules.parse(data);
  return transaction(db,async c=>{
    const g=await access(c,id,user,true);
    requireThat(user.rol==='docente'&&g.docente_id===user.id,'Solo el docente responsable puede configurar.',403);
    requireThat(g.estado==='espera','Las reglas quedan bloqueadas al comenzar.');
    const count=Number((await c.query('SELECT count(*) AS n FROM participantes WHERE partida_id=$1',[id])).rows[0].n);
    requireThat(config.capacidad>=count,'La capacidad es menor que el número de inscritos.');
    await validateCatalog(c,g.tablero_id,config);
    await c.query('UPDATE partidas SET configuracion=$1, version_estado=version_estado+1 WHERE id=$2',[config,id]);
    await c.query('INSERT INTO auditoria(id,usuario_id,partida_id,evento,detalle) VALUES($1,$2,$3,$4,$5)',[randomUUID(),user.id,id,'configurar',{configuracion:config}]);return {ok:true};
  });
}
export async function gameReport(db,id,user) {
  return transaction(db,async c=>{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');const s=await loadState(c,await access(c,id,user));return {partida:s.partida,resultados:reports(s,user)};});
}
export async function expireGames(db) {
  const ids=(await db.query("SELECT id FROM partidas WHERE estado='activa' AND tiempo_activo_ms+EXTRACT(EPOCH FROM (now()-tramo_activo_en))*1000 >= (configuracion->>'duracion_minutos')::numeric*60000")).rows;
  const changed=[];
  for(const {id} of ids) await transaction(db,async c=>{
    const g=(await c.query('SELECT * FROM partidas WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(g.estado!=='activa')return;
    const s=await loadState(c,g);if(elapsed(s)<g.configuracion.duracion_minutos*60000)return;
    const before=snapshot(s);finish(s,'Límite de duración alcanzado.');g.version_estado++;
    s.auditoria.push({id:randomUUID(),usuario_id:g.docente_id,partida_id:id,evento:'limite_duracion',detalle:{automatico:true},creado_en:new Date().toISOString()});
    await saveState(c,s,before);changed.push(id);
  });
  return changed;
}
