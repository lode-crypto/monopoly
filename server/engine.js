import { randomUUID, randomInt } from 'node:crypto';
import { requireThat, cents, amount } from './validation.js';
const now = () => new Date().toISOString();
export const currentTurn = s => s.turnos.find(t=>t.estado!=='cerrado');
const pending = (s,p) => s.obligaciones.find(o=>o.deudor_id===p.id && o.estado==='pendiente');
const assetValues = (s,a) => s.partida.configuracion.valores[a.casilla_id] || s.casillas.find(c=>c.id===a.casilla_id).valores_base;
export function elapsed(s, time=Date.now()) {
  const p=s.partida;
  return Number(p.tiempo_activo_ms)+(p.estado==='activa'&&p.tramo_activo_en?Math.max(0,time-new Date(p.tramo_activo_en).getTime()):0);
}
function audit(s,u,evento,detalle={}) { s.auditoria.push({id:randomUUID(),usuario_id:u.id,partida_id:s.partida.id,evento,detalle,creado_en:now()}); }
function move(s,ctx,origen,destino,importe,tipo,activo=null,obligacion=null) {
  const n=cents(importe); if(n===0)return;
  requireThat(n>0 && (!origen || cents(origen.saldo)>=n),'Fondos insuficientes.');
  if(origen)origen.saldo=amount(cents(origen.saldo)-n);
  if(destino)destino.saldo=amount(cents(destino.saldo)+n);
  s.movimientos.push({id:randomUUID(),partida_id:s.partida.id,accion_id:ctx.id,origen_id:origen?.id||null,
    destino_id:destino?.id||null,activo_id:activo?.id||null,obligacion_id:obligacion?.id||null,tipo,importe:amount(n),creado_en:now()});
}
function expireOffers(s) { s.ofertas.filter(o=>o.estado==='pendiente').forEach(o=>o.estado='caducada'); }
export function finish(s,motivo,time=Date.now()) {
  s.partida.tiempo_activo_ms=elapsed(s,time); s.partida.tramo_activo_en=null;
  s.partida.estado='finalizada'; s.partida.finalizada_en=new Date(time).toISOString(); s.partida.motivo_cierre=motivo;
  const t=currentTurn(s); if(t){t.estado='cerrado';t.cerrado_en=new Date(time).toISOString();} expireOffers(s);
}
function nextTurn(s,previous) {
  expireOffers(s);
  if(previous){previous.estado='cerrado';previous.cerrado_en=now();}
  const alive=s.participantes.filter(p=>p.estado==='activo').sort((a,b)=>a.orden_turno-b.orden_turno);
  if(alive.length<=1){finish(s,'Solo queda un participante habilitado.');return;}
  const number=(previous?.numero||0)+1;
  if(previous && Math.floor((number-1)/s.participantes.length)>=s.partida.configuracion.rondas){finish(s,'Límite de rondas alcanzado.');return;}
  const player=alive.find(p=>p.orden_turno>(previous?s.participantes.find(p=>p.id===previous.participante_id).orden_turno:-1))||alive[0];
  s.turnos.push({id:randomUUID(),partida_id:s.partida.id,participante_id:player.id,numero:number,estado:'pendiente',dados:null,abierto_en:now(),cerrado_en:null});
}
function settle(s,ctx,p) {
  const o=pending(s,p); if(!o)return;
  const due=cents(o.importe_original)-cents(o.importe_pagado);
  if(cents(p.saldo)>=due) {
    move(s,ctx,p,s.participantes.find(x=>x.id===o.acreedor_id),amount(due),o.tipo,s.activos_partida.find(a=>a.id===o.activo_id),o);
    o.importe_pagado=o.importe_original;o.estado='pagada';o.cerrada_en=now();p.obligacion_pendiente=0;currentTurn(s).estado='decision';
  } else { p.obligacion_pendiente=amount(due);currentTurn(s).estado='venta_banco'; }
}
function charge(s,ctx,p,creditor,value,type,asset=null) {
  if(cents(value)<=0)return;
  const o={id:randomUUID(),partida_id:s.partida.id,turno_id:currentTurn(s).id,deudor_id:p.id,acreedor_id:creditor?.id||null,
    importe_original:value,importe_pagado:0,estado:'pendiente',creada_en:now(),cerrada_en:null,tipo:type,activo_id:asset?.id||null};
  s.obligaciones.push(o);settle(s,ctx,p);
}
export function applyAction(s,user,input,ctx={id:randomUUID(),dice:()=>[randomInt(1,7),randomInt(1,7)]}) {
  const {tipo,datos={}}=input, g=s.partida, t=currentTurn(s), config=g.configuracion;
  if(['iniciar','pausar','reanudar','finalizar','cancelar'].includes(tipo)) {
    requireThat(user.rol==='docente' && user.id===g.docente_id,'Solo el docente responsable puede supervisar esta partida.',403);
    if(tipo==='iniciar') {
      requireThat(g.estado==='espera' && s.participantes.length>=2,'Se necesitan al menos dos estudiantes y una partida en espera.');
      g.estado='activa';g.iniciada_en=now();g.tramo_activo_en=g.iniciada_en;
      for(const p of s.participantes){p.estado='activo';move(s,ctx,null,p,config.capital_inicial,'capital_inicial');}
      for(const c of s.casillas.filter(c=>c.tipo==='activo')) {
        const v=config.valores[c.id]||c.valores_base;
        s.activos_partida.push({id:randomUUID(),partida_id:g.id,casilla_id:c.id,propietario_id:null,precio_base:v.precio,nivel_inversion:0,valor_rescate:v.rescate});
      }
      nextTurn(s);
    } else if(tipo==='pausar') {
      requireThat(g.estado==='activa','Solo se puede pausar una partida activa.');
      g.tiempo_activo_ms=elapsed(s);g.tramo_activo_en=null;g.estado='pausada';
    } else if(tipo==='reanudar') {
      requireThat(g.estado==='pausada','La partida no está pausada.');g.estado='activa';g.tramo_activo_en=now();
    } else if(tipo==='cancelar') {
      requireThat(g.estado==='espera' && datos.motivo,'Indica un motivo para cancelar una partida en espera.');
      g.estado='cancelada';g.motivo_cierre=datos.motivo;g.finalizada_en=now();
    } else {
      requireThat(['activa','pausada'].includes(g.estado) && datos.motivo,'Indica un motivo para finalizar una partida activa o pausada.');finish(s,datos.motivo);
    }
    audit(s,user,tipo,{motivo:datos.motivo||null});return;
  }
  requireThat(g.estado==='activa','La partida no está activa.');
  const p=s.participantes.find(p=>p.usuario_id===user.id);
  requireThat(user.rol==='estudiante' && p?.estado==='activo','No eres un participante habilitado.',403);
  requireThat(t,'No hay turno abierto.');
  if(['aceptar','rechazar'].includes(tipo)) {
    const o=s.ofertas.find(o=>o.id===datos.oferta_id);
    requireThat(o && o.comprador_id===p.id,'La oferta no está dirigida a ti.',403);
    requireThat(o.estado==='pendiente' && o.turno_id===t.id && o.turno_limite===t.numero,'La oferta venció o ya fue atendida.');
    const seller=s.participantes.find(p=>p.id===o.vendedor_id), a=s.activos_partida.find(a=>a.id===o.activo_id);
    requireThat(seller.estado==='activo' && a.propietario_id===seller.id && !pending(s,seller) && !pending(s,p),'La oferta ya no es válida.');
    if(tipo==='aceptar'){move(s,ctx,p,seller,o.precio,'transferencia',a);a.propietario_id=p.id;o.estado='aceptada';}
    else o.estado='rechazada';return;
  }
  requireThat(t.participante_id===p.id,'Es el turno de otro estudiante.',403);
  if(tipo==='lanzar') {
    requireThat(t.estado==='pendiente','Ya lanzaste los dados en este turno.');
    const dice=ctx.dice();requireThat(dice.length===2 && dice.every(n=>Number.isInteger(n)&&n>=1&&n<=6),'Dados inválidos.');
    t.dados=dice;t.estado='decision';
    const position=p.posicion+dice[0]+dice[1];
    if(position>=s.casillas.length)move(s,ctx,null,p,config.premio_salida,'salida');
    p.posicion=position%s.casillas.length;
    const c=s.casillas.find(c=>c.posicion===p.posicion), a=s.activos_partida.find(a=>a.casilla_id===c.id);
    if(a?.propietario_id && a.propietario_id!==p.id){
      const v=assetValues(s,a);charge(s,ctx,p,s.participantes.find(p=>p.id===a.propietario_id),amount(cents(v.alquiler)+a.nivel_inversion*cents(v.incremento_alquiler)),'alquiler',a);
    } else if(c.tipo==='impuesto') charge(s,ctx,p,null,c.valores_base.importe,'impuesto');
    else if(c.tipo==='evento' && c.valores_base.efecto==='gasto')charge(s,ctx,p,null,c.valores_base.importe,'evento_gasto');
    else if(c.tipo==='evento' && c.valores_base.efecto==='ingreso')move(s,ctx,null,p,c.valores_base.importe,'evento_ingreso');
    return;
  }
  requireThat(['decision','venta_banco'].includes(t.estado),'Primero debes lanzar los dados.');
  if(tipo==='insolvencia') {
    const o=pending(s,p);requireThat(o,'No tienes una obligación pendiente.');
    requireThat(!s.activos_partida.some(a=>a.propietario_id===p.id),'Primero vende tus propiedades al banco.');
    const pay=amount(Math.min(cents(p.saldo),cents(o.importe_original)-cents(o.importe_pagado)));
    move(s,ctx,p,s.participantes.find(x=>x.id===o.acreedor_id),pay,o.tipo,s.activos_partida.find(a=>a.id===o.activo_id),o);
    o.importe_pagado=amount(cents(o.importe_pagado)+cents(pay));o.estado='incobrable';o.cerrada_en=now();
    p.estado='insolvente';p.obligacion_pendiente=0;nextTurn(s,t);return;
  }
  requireThat(!pending(s,p)||tipo==='vender','Con obligaciones pendientes solo puedes vender al banco o resolver la insolvencia.');
  if(tipo==='cerrar_turno'){nextTurn(s,t);return;}
  const a=s.activos_partida.find(a=>a.id===datos.activo_id);
  requireThat(a,'Selecciona una propiedad válida.',400);
  if(tipo==='comprar') {
    requireThat(!a.propietario_id && s.casillas.find(c=>c.id===a.casilla_id).posicion===p.posicion,'Solo puedes comprar la propiedad disponible donde estás.');
    move(s,ctx,p,null,a.precio_base,'compra',a);a.propietario_id=p.id;return;
  }
  requireThat(a.propietario_id===p.id,'La propiedad no te pertenece.',403);
  requireThat(!s.ofertas.some(o=>o.activo_id===a.id && o.estado==='pendiente'),'Resuelve la oferta pendiente antes de modificar esta propiedad.');
  if(tipo==='vender') {
    move(s,ctx,null,p,a.valor_rescate,'venta_banco',a);a.propietario_id=null;a.nivel_inversion=0;settle(s,ctx,p);
  } else if(tipo==='invertir') {
    requireThat(a.nivel_inversion<config.max_inversion,'Se alcanzó el límite de inversión.');
    move(s,ctx,p,null,assetValues(s,a).costo_inversion,'inversion',a);a.nivel_inversion++;
  } else if(tipo==='ofertar') {
    const buyer=s.participantes.find(x=>x.id===datos.comprador_id);
    requireThat(buyer && buyer.id!==p.id && buyer.estado==='activo' && !pending(s,buyer),'El comprador debe ser otro participante activo de esta partida.');
    requireThat(Number.isFinite(datos.precio) && datos.precio>0,'Indica un precio positivo.',400);
    s.ofertas.push({id:randomUUID(),partida_id:g.id,vendedor_id:p.id,comprador_id:buyer.id,activo_id:a.id,precio:datos.precio,
      estado:'pendiente',turno_limite:t.numero,creada_en:now(),turno_id:t.id});
  }
}
export function reports(s,user) {
  return s.participantes.filter(p=>user.rol!=='estudiante'||p.usuario_id===user.id).map(p=>{
    const moves=s.movimientos.filter(m=>m.origen_id===p.id || m.destino_id===p.id);
    const sum=(fn)=>amount(moves.filter(fn).reduce((a,m)=>a+cents(m.importe),0));
    const ingresos=sum(m=>m.destino_id===p.id && ['alquiler','salida','evento_ingreso'].includes(m.tipo));
    const gastos=sum(m=>m.origen_id===p.id && ['alquiler','impuesto','evento_gasto'].includes(m.tipo));
    const owned=s.activos_partida.filter(a=>a.propietario_id===p.id), activos=amount(owned.reduce((a,x)=>a+cents(x.valor_rescate),0));
    return {participante_id:p.id,nombre:p.nombre,estado:p.estado,capital_inicial:sum(m=>m.tipo==='capital_inicial'),saldo:Number(p.saldo),liquidez:Number(p.saldo),
      ingresos,gastos,resultado_operativo:amount(cents(ingresos)-cents(gastos)),activos,propiedades:owned.length,
      patrimonio:amount(cents(p.saldo)+cents(activos)),obligaciones:Number(p.obligacion_pendiente),
      incobrable:amount(s.obligaciones.filter(o=>o.deudor_id===p.id && o.estado==='incobrable').reduce((n,o)=>n+cents(o.importe_original)-cents(o.importe_pagado),0)),
      compras:sum(m=>m.origen_id===p.id && m.tipo==='compra'),inversiones:sum(m=>m.origen_id===p.id && m.tipo==='inversion'),
      ventas:sum(m=>m.destino_id===p.id && m.tipo==='venta_banco'),
      transferencias_recibidas:sum(m=>m.destino_id===p.id && m.tipo==='transferencia'),transferencias_pagadas:sum(m=>m.origen_id===p.id && m.tipo==='transferencia')};
  });
}
