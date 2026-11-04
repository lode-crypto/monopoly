import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyAction,currentTurn,reports,elapsed } from '../server/engine.js';
import { rules } from '../server/validation.js';
function fixture(){
  const teacher={id:randomUUID(),rol:'docente'},users=[0,1].map(()=>({id:randomUUID(),rol:'estudiante'}));
  const id=randomUUID(),s={partida:{id,docente_id:teacher.id,estado:'espera',configuracion:rules.parse({}),tiempo_activo_ms:0},participantes:users.map((u,i)=>({id:randomUUID(),partida_id:id,usuario_id:u.id,nombre:'Estudiante '+i,orden_turno:i,posicion:0,saldo:0,estado:'espera',obligacion_pendiente:0})),casillas:[],turnos:[],activos_partida:[],movimientos:[],obligaciones:[],ofertas:[],auditoria:[]};
  for(let i=0;i<40;i++)s.casillas.push({id:randomUUID(),posicion:i,tipo:i===0?'salida':'activo',nombre:'Casilla '+i,valores_base:{precio:300,alquiler:60,rescate:150,costo_inversion:100,incremento_alquiler:20}});
  const act=(u,tipo,datos={},dice=[1,2])=>applyAction(s,u,{tipo,datos},{id:randomUUID(),dice:()=>dice});
  act(teacher,'iniciar');return {s,teacher,users,act};
}
test('inicio: capital separado, dos participantes, turno único y propiedades del banco',()=>{
  const {s,users}=fixture();assert.equal(s.turnos.length,1);assert.equal(s.participantes[0].saldo,1500);assert.equal(s.activos_partida.length,39);
  assert.equal(reports(s,users[0])[0].ingresos,0);assert.equal(reports(s,users[0])[0].capital_inicial,1500);
});
test('dados, compra y protección del turno',()=>{
  const {s,act,users}=fixture();assert.throws(()=>act(users[1],'lanzar'),/otro estudiante/);act(users[0],'lanzar');
  assert.equal(s.participantes[0].posicion,3);assert.throws(()=>act(users[0],'lanzar'),/Ya lanzaste/);
  const a=s.activos_partida[2];act(users[0],'comprar',{activo_id:a.id});assert.equal(s.participantes[0].saldo,1200);assert.equal(a.propietario_id,s.participantes[0].id);
  assert.throws(()=>act(users[0],'comprar',{activo_id:a.id}),/disponible/);
  act(users[0],'cerrar_turno');assert.equal(currentTurn(s).participante_id,s.participantes[1].id);
});
test('pagos completos de alquiler y salida una vez',()=>{
  const {s,act,users}=fixture();act(users[0],'lanzar');act(users[0],'comprar',{activo_id:s.activos_partida[2].id});act(users[0],'cerrar_turno');act(users[1],'lanzar');
  assert.equal(s.participantes[0].saldo,1260);assert.equal(s.participantes[1].saldo,1440);assert.equal(s.obligaciones[0].estado,'pagada');
  act(users[1],'cerrar_turno');s.participantes[0].posicion=39;act(users[0],'lanzar');assert.equal(s.participantes[0].saldo,1460);
});
test('obligación: solo venta, pago al reunir fondos y saldo nunca negativo',()=>{
  const {s,act,users}=fixture();act(users[0],'lanzar');const p=s.participantes[0],a=s.activos_partida[2];a.propietario_id=s.participantes[1].id;
  // Impuesto alto en el destino del siguiente lanzamiento, con un activo para rescatar.
  act(users[0],'cerrar_turno');act(users[1],'lanzar');act(users[1],'cerrar_turno');
  const own=s.activos_partida[0];own.propietario_id=p.id;p.saldo=10;
  s.casillas[6].tipo='impuesto';s.casillas[6].valores_base={importe:100};
  act(users[0],'lanzar');assert.equal(p.obligacion_pendiente,100);assert.equal(p.saldo,10);
  assert.throws(()=>act(users[0],'invertir',{activo_id:own.id}),/pendientes/);assert.throws(()=>act(users[0],'cerrar_turno'),/pendientes/);
  act(users[0],'vender',{activo_id:own.id});assert.equal(p.saldo,60);assert.equal(p.obligacion_pendiente,0);assert.equal(s.obligaciones.at(-1).estado,'pagada');
});
test('insolvencia: solo saldo real al acreedor e incobrable conservado',()=>{
  const {s,act,users}=fixture(),p=s.participantes[0],creditor=s.participantes[1],a=s.activos_partida[2];
  a.propietario_id=creditor.id;p.saldo=10;act(users[0],'lanzar');act(users[0],'insolvencia');
  assert.equal(p.saldo,0);assert.equal(creditor.saldo,1510);assert.equal(p.estado,'insolvente');assert.equal(s.obligaciones[0].importe_pagado,10);assert.equal(s.obligaciones[0].estado,'incobrable');assert.equal(s.partida.estado,'finalizada');
});
test('inversión respeta límites y rescate fijado; reporte PF-17',()=>{
  const {s,act,users}=fixture();act(users[0],'lanzar');const a=s.activos_partida[2];act(users[0],'comprar',{activo_id:a.id});
  for(let i=0;i<4;i++)act(users[0],'invertir',{activo_id:a.id});assert.throws(()=>act(users[0],'invertir',{activo_id:a.id}),/límite/);
  act(users[0],'vender',{activo_id:a.id});assert.equal(s.participantes[0].saldo,950);assert.equal(a.nivel_inversion,0);
  const p=s.participantes[0];p.saldo=1160;a.propietario_id=p.id;
  s.movimientos=[{tipo:'capital_inicial',destino_id:p.id,importe:1500},{tipo:'compra',origen_id:p.id,importe:300},{tipo:'alquiler',destino_id:p.id,importe:60},{tipo:'impuesto',origen_id:p.id,importe:100}];
  const r=reports(s,users[0])[0];assert.equal(r.resultado_operativo,-40);assert.equal(r.saldo,1160);assert.equal(r.patrimonio,1310);
});
test('ofertas: destinatario, precio, pago y dueño atómicos; caducidad',()=>{
  const {s,act,users}=fixture();act(users[0],'lanzar');const a=s.activos_partida[2];act(users[0],'comprar',{activo_id:a.id});
  act(users[0],'ofertar',{activo_id:a.id,comprador_id:s.participantes[1].id,precio:300});const o=s.ofertas[0];
  assert.throws(()=>act(users[0],'aceptar',{oferta_id:o.id}),/dirigida/);act(users[1],'aceptar',{oferta_id:o.id});
  assert.equal(s.participantes[0].saldo,1500);assert.equal(s.participantes[1].saldo,1200);assert.equal(a.propietario_id,s.participantes[1].id);
  assert.throws(()=>act(users[1],'aceptar',{oferta_id:o.id}),/atendida/);assert.throws(()=>act(users[1],'lanzar'),/otro/);
  const b=s.activos_partida[0];b.propietario_id=s.participantes[0].id;act(users[0],'ofertar',{activo_id:b.id,comprador_id:s.participantes[1].id,precio:50});act(users[0],'cerrar_turno');assert.equal(s.ofertas[1].estado,'caducada');
});
test('pausa conserva turno, reloj y fondos; cierre requiere motivo',()=>{
  const {s,act,users,teacher}=fixture(),turn=currentTurn(s).id;s.partida.tramo_activo_en=new Date(Date.now()-5000).toISOString();
  act(teacher,'pausar');const time=elapsed(s);assert.ok(time>=5000);assert.equal(elapsed(s,Date.now()+90000),time);assert.throws(()=>act(users[0],'lanzar'),/no está activa/);
  act(teacher,'reanudar');assert.equal(currentTurn(s).id,turn);assert.throws(()=>act(teacher,'finalizar'),/motivo/);act(teacher,'finalizar',{motivo:'Fin de actividad'});assert.equal(s.partida.estado,'finalizada');
});
test('sin turnos extra por dobles y finalización automática por rondas',()=>{
  const {s,act,users}=fixture();s.partida.configuracion.rondas=1;act(users[0],'lanzar',{},[2,2]);act(users[0],'cerrar_turno');assert.equal(currentTurn(s).participante_id,s.participantes[1].id);
  act(users[1],'lanzar');act(users[1],'cerrar_turno');assert.equal(s.partida.estado,'finalizada');assert.match(s.partida.motivo_cierre,/rondas/);
});
