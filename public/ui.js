/* API y controles del frontend original MONOpoly. */
(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=x=>Number(x||0).toLocaleString('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2})+' UMV';
  const newId=()=>{
    if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
    const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  };
  const page=location.pathname.split('/').pop()||'index.html';
  let user,state,socket,busy=false,lastFocus;
  let gameId=new URLSearchParams(location.search).get('partida')||sessionStorage.getItem('partida');
  const colors=['#8b62d7','#4a9ee8','#e2676f','#45bd8c','#d4b333','#df80ca'];
  function toast(message){const t=$('#toast');if(!t)return;t.textContent=message;t.classList.add('visible');setTimeout(()=>t.classList.remove('visible'),5000);}
  async function api(path,method='GET',body){
    const r=await fetch('/api'+path,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const d=await r.json();if(!r.ok){const e=new Error(d.error||'No se pudo completar la solicitud.');e.status=r.status;e.detalles=d.detalles;throw e;}return d;
  }
  function close(){if($('#demo-modal'))$('#demo-modal').hidden=true;document.body.style.overflow='';lastFocus?.focus();}
  function modal(title,html,onSubmit,ok='Confirmar'){
    lastFocus=document.activeElement;
    $('#modal-body').innerHTML=`<h2 id="modal-title">${esc(title)}</h2><form id="live-form">${html}<p id="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="btn outline" data-close>Cancelar</button>${onSubmit?`<button class="btn primary" type="submit">${esc(ok)}</button>`:''}</div></form>`;
    $('#demo-modal').hidden=false;document.body.style.overflow='hidden';$('#live-form input, #live-form select, .modal-close')?.focus();
    $('#live-form').onsubmit=async e=>{e.preventDefault();const b=$('button[type=submit]',e.target);if(b.disabled)return;b.disabled=true;try{await onSubmit(Object.fromEntries(new FormData(e.target)));close();}catch(err){$('#form-error').textContent=err.message+(err.detalles?' '+err.detalles.map(x=>x.campo+': '+x.mensaje).join('; '):'');}finally{b.disabled=false;}};
  }
  const field=(name,label,value='',type='text',attrs='')=>`<label class="form-label">${esc(label)}<input class="input" name="${name}" type="${type}" value="${esc(value)}" required ${attrs}></label>`;
  const select=(name,label,items)=>`<label class="form-label">${esc(label)}<select class="input" name="${name}">${items.map(x=>`<option value="${esc(x[0])}">${esc(x[1])}</option>`).join('')}</select></label>`;
  const btn=(label,action,id='',disabled=false)=>`<button class="btn sm primary" data-live="${action}" data-id="${esc(id)}" ${disabled?'disabled':''}>${esc(label)}</button>`;
  function remember(id){gameId=id;sessionStorage.setItem('partida',id);}
  async function sendAction(payload){
    try{const result=await api(`/partidas/${gameId}/acciones`,'POST',payload);sessionStorage.removeItem('pendiente:'+gameId);return result;}
    catch(e){if(e.status)sessionStorage.removeItem('pendiente:'+gameId);else toast('Conexión interrumpida. Se recuperará la solicitud al reconectar.');throw e;}
  }
  async function act(tipo,datos={}){
    if(busy)return;busy=true;
    const previous=sessionStorage.getItem('pendiente:'+gameId);
    if(previous){try{await sendAction(JSON.parse(previous));await refresh();toast('Solicitud anterior recuperada. Revisa el estado antes de continuar.');}finally{busy=false;}return;}
    const payload={clave_accion:newId(),version:Number(state.partida.version_estado),tipo,datos};
    sessionStorage.setItem('pendiente:'+gameId,JSON.stringify(payload));
    try{await sendAction(payload);await refresh();}catch(e){await refresh().catch(()=>{});throw e;}finally{busy=false;}
  }
  async function refresh(){
    if(!gameId)return;const fresh=await api('/partidas/'+gameId);
    if(state&&Number(fresh.partida.version_estado)<Number(state.partida.version_estado))return;
    state=fresh;if(page==='sala.html')renderLobby();if(page==='juego.html')await renderGame();
  }
  function connect(){
    if(!window.io)return;socket=io({withCredentials:true});
    socket.on('connect',async()=>{
      try{const saved=sessionStorage.getItem('pendiente:'+gameId);if(saved)await sendAction(JSON.parse(saved));}
      catch(e){toast(e.message);}
      socket.emit('partida:observar',{id:gameId},r=>{if(r.error)toast(r.error);else refresh().catch(e=>toast(e.message));});
    });
    socket.on('partida:actualizada',()=>refresh().catch(e=>toast(e.message)));
    socket.on('disconnect',()=>{if($('.center-note'))$('.center-note').textContent='Reconectando con la partida…';});
    socket.on('connect_error',()=>toast('Reconectando con el servidor…'));
    setInterval(()=>refresh().catch(e=>{if(e.status===401)location.href='login.html';}),10000);
  }
  function rulesFields(c={}){
    return field('capital_inicial','Capital inicial (UMV)',c.capital_inicial??1500,'number','min="100" max="1000000" step="0.01"')+
      field('capacidad','Estudiantes (2 a 6)',c.capacidad??6,'number','min="2" max="6"')+
      field('rondas','Límite de rondas',c.rondas??20,'number','min="1" max="1000"')+
      field('duracion_minutos','Duración activa en minutos',c.duracion_minutos??60,'number','min="1" max="480"')+
      field('premio_salida','Premio por vuelta (UMV)',c.premio_salida??200,'number','min="0" max="1000000" step="0.01"')+
      field('max_inversion','Límite de inversiones',c.max_inversion??4,'number','min="0" max="5"');
  }
  async function createRoom(){const boards=await api('/tableros');modal('Crear actividad',field('nombre','Nombre','Gestión empresarial')+select('tablero_id','Tablero',boards.map(b=>[b.id,b.nombre]))+rulesFields(),async d=>{
    const {nombre,tablero_id,...r}=d;const g=await api('/partidas','POST',{nombre,tablero_id,configuracion:Object.fromEntries(Object.entries(r).map(([k,v])=>[k,Number(v)]))});remember(g.id);location.href='sala.html?partida='+g.id;
  },'Crear partida');}
  function editRules(){const cfg=state.partida.configuracion;
    modal('Configurar reglas',rulesFields(cfg)+'<h3>Valores por propiedad (UMV)</h3>'+state.casillas.filter(c=>c.tipo==='activo').map(c=>{
      const v=cfg.valores[c.id]||c.valores_base;
      return `<details><summary>${esc(c.nombre)}</summary>`+['precio','alquiler','rescate','costo_inversion','incremento_alquiler'].map(k=>field(c.id+':'+k,k.replaceAll('_',' '),v[k],'number','min="0" max="1000000" step="0.01"')).join('')+'</details>';
    }).join(''),async d=>{const valores={},base={};for(const [k,v]of Object.entries(d)){if(k.includes(':')){const [id,key]=k.split(':');(valores[id]??={})[key]=Number(v);}else base[k]=Number(v);}await api('/partidas/'+gameId+'/reglas','PUT',{...base,valores});await refresh();},'Guardar reglas');
  }
  async function rooms(){const games=await api('/partidas');
    $('.page-title p').textContent=user.rol==='docente'?'Crea y supervisa tus actividades.':'Ingresa con el código de tu docente.';
    $('.stats-row').innerHTML=`<div class="mini-stat"><b>${games.length}</b><small>Mis partidas</small></div><div class="mini-stat"><b>2–6</b><small>Estudiantes por actividad</small></div>`;
    $('.inline-controls').innerHTML=user.rol==='docente'?btn('＋ Crear partida','crear'):user.rol==='estudiante'?`<input class="input" id="join-code" placeholder="Código de 12 caracteres" aria-label="Código de partida" maxlength="12">${btn('Ingresar','ingresar')}`:'';
    $('.room-grid').innerHTML=games.map(g=>`<div class="room-card"><div class="room-emoji">🎲</div><h3>${esc(g.nombre)}</h3><p>${g.participantes} / ${g.configuracion.capacidad} estudiantes</p><div class="room-bottom"><span class="tag">${esc(g.estado)}</span><a class="btn sm primary" href="sala.html?partida=${g.id}">Abrir →</a></div></div>`).join('')||'<p>Aún no tienes partidas.</p>';
  }
  function supervision(g){return (g.estado==='espera'?btn('Iniciar','iniciar','',state.participantes.length<2)+btn('Cancelar','cancelar'):g.estado==='activa'?btn('Pausar','pausar')+btn('Finalizar','finalizar'):g.estado==='pausada'?btn('Reanudar','reanudar')+btn('Finalizar','finalizar'):'<p>Actividad cerrada. Solo consulta.</p>')+`<a class="btn sm" href="estadisticas.html?partida=${g.id}">Reportes</a>`;}
  function renderLobby(){const {partida:g,participantes:ps}=state,teacher=user.id===g.docente_id&&user.rol==='docente';
    $('.share-input input').value=location.origin+'/sala.html?codigo='+g.codigo;
    $('.players').innerHTML=`<h3>${esc(g.nombre)}</h3><p>Código: <b>${esc(g.codigo)}</b> · ${esc(g.estado)}</p>`+ps.map(p=>`<div class="row"><span class="avatar" style="--avatar:${colors[p.orden_turno]}">${p.orden_turno+1}</span><b>${esc(p.nombre)}</b><span class="tag">${esc(p.estado)}</span></div>`).join('');
    $('.appearance').innerHTML=`<h2>${esc(g.nombre)}</h2><p>Código: <strong>${esc(g.codigo)}</strong></p><p>${ps.length}/${g.configuracion.capacidad} estudiantes · ${esc(g.estado)}</p><a class="btn primary" href="juego.html?partida=${g.id}">Ver tablero →</a>`;
    $('.settings').innerHTML='<h3>Reglas de la actividad</h3>'+Object.entries(g.configuracion).filter(([k])=>k!=='valores').map(([k,v])=>`<div class="settings-item"><b>${esc(k.replaceAll('_',' '))}</b><span>${esc(v)}</span></div>`).join('')+'<p>Dos dados · Sin turnos extra · Dinero virtual</p>'+(teacher&&g.estado==='espera'?btn('Configurar reglas','reglas'):'');
    $('.lobby-right > a')?.remove();let controls=$('#teacher-controls');if(!controls){controls=document.createElement('div');controls.id='teacher-controls';controls.className='card';$('.lobby-right').append(controls);}controls.innerHTML=teacher?supervision(g):'<p>El docente controla el inicio y las pausas.</p>';
    $('.ad-placeholder').textContent='Simulación empresarial · CEICOM';$('.empty-chat').textContent='Consulta las operaciones en el historial.';$('.chat-bottom').textContent='Los movimientos se guardan en el servidor.';
  }
  async function renderGame(){
    const {partida:g,turno:t,participantes:ps,activos,casillas}=state;
    const me=ps.find(p=>p.usuario_id===user.id),active=ps.find(p=>p.id===t?.participante_id),mine=!!me&&t?.participante_id===me.id&&g.estado==='activa'&&me.estado==='activo';
    const decision=mine&&t.estado==='decision',debt=mine&&t.estado==='venta_banco';
    const landed=activos.find(a=>a.casilla_id===casillas.find(c=>c.posicion===me?.posicion)?.id);
    $('.game-shortcuts').innerHTML=`<a href="salas.html">♟ Partidas</a><a href="sala.html?partida=${g.id}">⚙ Sala</a><a href="historial.html?partida=${g.id}">Historial</a><a href="estadisticas.html?partida=${g.id}">Reportes</a>${btn('Reglas','ver-reglas')}${btn('Lanzar dados','lanzar','',!mine||t.estado!=='pendiente')}${btn('Comprar','comprar',landed?.id||'',!decision||!landed||!!landed.propietario_id)}${btn('Terminar turno','cerrar_turno','',!decision)}`;
    $('.players-panel').innerHTML=ps.map(p=>`<div class="player-row ${p.id===t?.participante_id?'selected':''}"><span class="avatar" style="--avatar:${colors[p.orden_turno]}">${p.orden_turno+1}</span><span class="player-label">${esc(p.nombre)} ${p.id===me?.id?'(tú)':''}<small> · ${esc(p.estado)} · Casilla ${p.posicion}</small></span><span class="player-cash">${fmt(p.saldo)}</span></div>`).join('');
    $('.current-player').textContent=`${active?.nombre||'Sin turno'} · ${t?.estado||g.estado}`;$('.round-timer').textContent=`Turno ${t?.numero||0} · ${g.estado}`;
    $('.dice-pair').innerHTML=t?.dados?`<strong class="live-dice">🎲 ${t.dados[0]} + ${t.dados[1]} = ${t.dados[0]+t.dados[1]}</strong>`:'<span>Dados pendientes</span>';
    $('.center-note').textContent=`${g.nombre} · ${me?'Tu saldo: '+fmt(me.saldo):'Supervisión docente'} · ${Math.floor(state.tiempo_activo_ms/60000)} min activos`;
    $$('.prop-tile').forEach((node,i)=>{
      const c=casillas[i],a=activos.find(a=>a.casilla_id===c?.id),owner=ps.find(p=>p.id===a?.propietario_id);
      if(c&&$('.prop-label',node))$('.prop-label',node).textContent=c.nombre;
      $$('.prop-label',node).slice(1).forEach(n=>n.textContent='');
      node.dataset.live='casilla';node.dataset.id=c?.id;node.removeAttribute('data-modal');node.classList.remove('owner-cyan','owner-purple','owner-blue','player-on-tile');$$('.piece,.live-token',node).forEach(n=>n.remove());
      if(a&&$('.prop-price',node))$('.prop-price',node).textContent=Number(a.precio_base)+'$';
      node.title=`${c?.nombre} · ${owner?'Dueño: '+owner.nombre:'Banco'}`;node.setAttribute('aria-label',node.title);
      if($('.prop-stripe',node))$('.prop-stripe',node).style.backgroundColor=owner?colors[owner.orden_turno]:'';
      for(const p of ps.filter(p=>p.posicion===i)){const token=document.createElement('span');token.className='live-token';token.style.backgroundColor=colors[p.orden_turno];token.textContent=p.orden_turno+1;token.title=p.nombre;token.style.left=(4+p.orden_turno*15)+'px';node.append(token);}
    });
    $('.bankrupt-bar').innerHTML=debt?`<p>Obligación: ${fmt(me.obligacion_pendiente)}. Vende tus propiedades al banco.</p>${btn('Resolver insolvencia','insolvencia','',activos.some(a=>a.propietario_id===me.id))}`:'';
    const owned=activos.filter(a=>a.propietario_id===me?.id);
    $('.properties-module').innerHTML='<div class="module-header"><h3>Mis propiedades</h3></div>'+owned.map(a=>`<div class="property-entry live-property"><strong>${esc(casillas.find(c=>c.id===a.casilla_id)?.nombre)}</strong><small>Nivel: ${a.nivel_inversion} · Rescate: ${fmt(a.valor_rescate)}</small><div>${btn('Invertir','invertir',a.id,!decision||a.nivel_inversion>=g.configuracion.max_inversion)}${btn('Vender al banco','vender',a.id,!decision&&!debt)}${btn('Ofrecer','ofertar',a.id,!decision)}</div></div>`).join('')+(owned.length?'':'<p>No tienes propiedades.</p>');
    $('.trades-module').innerHTML='<div class="module-header"><h3>Ofertas vigentes</h3></div>'+state.ofertas.filter(o=>o.comprador_id===me?.id||o.vendedor_id===me?.id||user.rol!=='estudiante').map(o=>`<div class="property-entry live-property"><b>${esc(casillas.find(c=>c.id===activos.find(a=>a.id===o.activo_id)?.casilla_id)?.nombre)}</b><p>${fmt(o.precio)} · ${esc(ps.find(p=>p.id===o.vendedor_id)?.nombre)} → ${esc(ps.find(p=>p.id===o.comprador_id)?.nombre)}</p>${o.comprador_id===me?.id?btn('Aceptar','aceptar',o.id,g.estado!=='activa')+btn('Rechazar','rechazar',o.id,g.estado!=='activa'):''}</div>`).join('');
    if(user.rol==='docente')$('.bankrupt-bar').innerHTML=supervision(g);
    $('.share-input input').value=location.origin+'/sala.html?codigo='+g.codigo;$('.empty-chat').textContent='Decisiones guardadas en el historial.';$('.chat-input')?.remove();
    const h=await api('/partidas/'+gameId+'/historial');$('.activity-feed').innerHTML=h.acciones.slice(0,12).map(a=>`<p>✓ ${esc(a.tipo.replaceAll('_',' '))} · ${esc(ps.find(p=>p.usuario_id===a.usuario_id)?.nombre||'Docente')} · v${a.version_resultado}</p>`).join('')||'<p>Aún no hay operaciones.</p>';
  }
  async function reportPage(history=false){const games=await api('/partidas');
    $('main.page-container').innerHTML=`<div class="page-title"><h1>${history?'Historial de operaciones':'Reportes y resultados'}</h1></div><section class="surface"><label class="form-label">Actividad<select class="input" id="report-game"><option value="">Selecciona una partida</option>${games.map(g=>`<option value="${g.id}">${esc(g.nombre)} · ${esc(g.estado)}</option>`).join('')}</select></label><div id="report-content"></div></section>`;
    $('#report-game').value=games.some(g=>g.id===gameId)?gameId:'';$('#report-game').onchange=()=>{remember($('#report-game').value);showReport(history).catch(e=>toast(e.message));};if($('#report-game').value)await showReport(history);
  }
  async function showReport(history,hPage=0){if(!gameId){$('#report-content').textContent='Selecciona una partida.';return;}
    if(history){const [h,s]=await Promise.all([api('/partidas/'+gameId+'/historial?pagina='+hPage),api('/partidas/'+gameId)]),name=id=>s.participantes.find(p=>p.id===id)?.nombre||'Banco';
      $('#report-content').innerHTML=`<h3>${esc(s.partida.nombre)} · ${esc(s.partida.estado)}</h3><p>Últimas 100 acciones y 200 movimientos.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Fecha</th><th>Concepto</th><th>Origen</th><th>Destino</th><th>Importe</th></tr></thead><tbody>${h.movimientos.map(m=>`<tr><td>${esc(new Date(m.creado_en).toLocaleString('es-BO'))}</td><td>${esc(m.tipo)}</td><td>${esc(name(m.origen_id))}</td><td>${esc(name(m.destino_id))}</td><td>${fmt(m.importe)}</td></tr>`).join('')}</tbody></table></div><h3>Decisiones confirmadas</h3>${h.acciones.map(a=>`<p>v${a.version_resultado} · ${esc(a.tipo)} · ${esc(new Date(a.creada_en).toLocaleString('es-BO'))}</p>`).join('')}`;
      $('#report-content').insertAdjacentHTML('beforeend',`<div class="row"><button class="btn" id="history-prev" ${hPage===0?'disabled':''}>Anterior</button><span>Página ${hPage+1}</span><button class="btn" id="history-next" ${h.acciones.length<100&&h.movimientos.length<200?'disabled':''}>Siguiente</button></div>`);
      $('#history-prev').onclick=()=>showReport(true,hPage-1).catch(e=>toast(e.message));$('#history-next').onclick=()=>showReport(true,hPage+1).catch(e=>toast(e.message));
    }else{const r=await api('/partidas/'+gameId+'/reporte'),cols=['nombre','capital_inicial','saldo','ingresos','gastos','resultado_operativo','activos','patrimonio','obligaciones','incobrable'];
      $('#report-content').innerHTML=`<h3>${esc(r.partida.nombre)} · ${esc(r.partida.estado)}</h3><p>Activos valorados al rescate. Capital, compras, inversiones y transferencias se separan del resultado operativo.</p><div class="table-scroll"><table class="data-table"><thead><tr>${cols.map(c=>`<th>${esc(c.replaceAll('_',' '))}</th>`).join('')}</tr></thead><tbody>${r.resultados.map(p=>`<tr>${cols.map(c=>`<td>${c==='nombre'?esc(p[c]):fmt(p[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><button class="btn" id="download-csv">Descargar CSV</button><a class="btn" href="historial.html?partida=${gameId}">Consultar movimientos</a>`;
      $('#download-csv').onclick=()=>{const cell=x=>'"'+String(x??'').replaceAll('"','""').replace(/^[=+@\-]/,"'$&")+'"';const data='\uFEFF'+[cols,...r.resultados.map(p=>cols.map(c=>p[c]))].map(row=>row.map(cell).join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8;'})),a=document.createElement('a');a.href=url;a.download='reporte-ceicom.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    }
  }
  async function admin(){if(user.rol!=='administrador'){$('main').innerHTML='<section class="card"><h2>Acceso reservado al administrador</h2><a href="salas.html">Mis partidas</a></section>';return;}
    const [users,audit,games]=await Promise.all([api('/usuarios'),api('/auditoria'),api('/partidas')]);const area=$('.dashboard-grid')?.parentElement||$('main');
    area.innerHTML=`<div class="page-title"><h1>Administración</h1>${btn('Crear usuario','usuario-nuevo')}</div><div class="stats-row"><div class="mini-stat"><b>${users.length}</b><small>Usuarios</small></div><div class="mini-stat"><b>${games.length}</b><small>Partidas</small></div></div><section class="card"><h2>Usuarios y roles</h2><div class="table-scroll"><table class="data-table"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${users.map(u=>`<tr><td>${esc(u.nombre)}</td><td>${esc(u.correo)}</td><td>${esc(u.rol)}</td><td>${u.activo?'Activo':'Inactivo'}</td><td>${btn('Editar','usuario-editar',u.id)}</td></tr>`).join('')}</tbody></table></div></section><section class="card"><h2>Auditoría</h2>${audit.map(a=>`<p>${esc(a.evento)} · ${esc(new Date(a.creado_en).toLocaleString('es-BO'))}</p>`).join('')}</section>`;area.dataset.users=JSON.stringify(users);
  }
  function userForm(id){const u=JSON.parse($('[data-users]')?.dataset.users||'[]').find(x=>x.id===id);
    modal(u?'Editar cuenta':'Crear cuenta',field('nombre','Nombre',u?.nombre||'')+(!u?field('correo','Correo','','email')+field('password','Contraseña','','password','minlength="10" maxlength="128"'):'')+select('rol','Rol',['estudiante','docente','administrador'].map(r=>[r,r]))+(u?select('activo','Acceso',[['true','Activo'],['false','Inactivo']]):''),async d=>{if(u)await api('/usuarios/'+id,'PATCH',{nombre:d.nombre,rol:d.rol,activo:d.activo==='true'});else await api('/usuarios','POST',d);await admin();},'Guardar');if(u){$('[name=rol]').value=u.rol;$('[name=activo]').value=String(u.activo);}
  }
  async function boot(){
    try{user=await api('/auth/yo');}catch(e){if(e.status!==401){toast('No se pudo conectar con el servidor.');return;}}
    if(!user&&!['index.html','login.html','ayuda.html'].includes(page)){location.href='login.html';return;}
    $$('.eyebrow').forEach(n=>n.textContent='CEICOM · SIMULACIÓN EMPRESARIAL');$$('.demo-footer').forEach(n=>n.textContent='MONOpoly · Simulación empresarial educativa · Dinero virtual');
    $$('.top-user').forEach(n=>n.innerHTML=user?`<span>${esc(user.nombre)} · ${esc(user.rol)}</span>${btn('Salir','logout')}`:'<a class="mini-link" href="login.html">Ingresar</a>');$$('a[href="admin.html"]').forEach(n=>n.hidden=user?.rol!=='administrador');
    if(page==='login.html'){
      $('.page-title p').textContent='Ingresa con tu cuenta o regístrate como estudiante.';
      $$('.auth-grid .surface').forEach((section,index)=>{
        section.innerHTML=`<h2>${index?'Crear cuenta de estudiante':'Iniciar sesión'}</h2><form id="${index?'register':'login'}">${index?field('nombre','Nombre completo'):''}${field('correo','Correo electrónico','','email')}${field('password','Contraseña (mínimo 10 caracteres)','','password','minlength="10" maxlength="128"')}<button class="btn primary wide">${index?'Registrarme':'Ingresar'}</button><p role="alert" class="auth-message"></p></form>`;
        $('form',section).onsubmit=async e=>{e.preventDefault();const b=$('button',e.target);b.disabled=true;try{await api('/auth/'+(index?'registro':'login'),'POST',Object.fromEntries(new FormData(e.target)));if(index){$('.auth-message',e.target).textContent='Cuenta creada. Ya puedes iniciar sesión.';e.target.reset();}else location.href='salas.html';}catch(err){$('.auth-message',e.target).textContent=err.message;}finally{b.disabled=false;}};
      });
    }else if(page==='salas.html')await rooms();
    else if(['sala.html','juego.html'].includes(page)){
      const code=new URLSearchParams(location.search).get('codigo');if(code){const r=await api('/partidas/ingresar','POST',{codigo:code});remember(r.id);history.replaceState({},'',page+'?partida='+r.id);}
      if(!gameId){location.href='salas.html';return;}remember(gameId);await refresh();connect();
    }else if(['historial.html','estadisticas.html','clasificacion.html'].includes(page))await reportPage(page==='historial.html');
    else if(page==='admin.html')await admin();
    else if(['perfil.html','usuario.html','configuracion.html'].includes(page))$('main').innerHTML=`<div class="page-title"><h1>Mi cuenta</h1></div><section class="surface"><h2>${esc(user.nombre)}</h2><p>${esc(user.correo)}</p><span class="tag">${esc(user.rol)}</span><p>La institución administra las cuentas y sus permisos.</p><a class="btn" href="salas.html">Mis partidas</a><a class="btn" href="historial.html">Historial</a>${btn('Cerrar sesión','logout')}</section>`;
    else if(page==='index.html'){$('.home-form').innerHTML=`<a class="btn primary lg" href="${user?'salas.html':'login.html'}">${user?'Mis actividades':'Ingresar o registrarme'} →</a>`;$('.home-shortcuts').innerHTML='<a class="btn" href="salas.html">♟ Partidas educativas</a><a class="btn" href="ayuda.html">Cómo participar</a>';$('.home-center > .helper').textContent='CEICOM · Gestión empresarial con recursos virtuales';}
  }
  document.addEventListener('click',async e=>{
    const target=e.target.closest('button,a,[role=button],.fake-button');if(!target)return;
    if(target.matches('[data-close]')){close();return;}if(target.matches('[data-menu]')){$('.app-links')?.classList.toggle('open');return;}
    if(target.closest('.share-input')&&!target.getAttribute('href')?.includes('sala.html')){e.preventDefault();try{await navigator.clipboard.writeText($('.share-input input').value);toast('Enlace copiado.');}catch{toast('Selecciona y copia el enlace de la sala.');}return;}
    const action=target.dataset.live;if(!action||target.disabled)return;e.preventDefault();const id=target.dataset.id;
    try{
      if(action==='logout'){await api('/auth/logout','POST',{});sessionStorage.clear();location.href='login.html';}
      else if(action==='crear')await createRoom();
      else if(action==='ingresar'){const r=await api('/partidas/ingresar','POST',{codigo:$('#join-code').value});remember(r.id);location.href='sala.html?partida='+r.id;}
      else if(action==='reglas')editRules();
      else if(action==='ver-reglas')modal('Reglas',`<p>Capital: ${fmt(state.partida.configuracion.capital_inicial)} · Premio por vuelta: ${fmt(state.partida.configuracion.premio_salida)}</p><p>Dos dados sin turnos extra. Eventos económicos del catálogo. El docente configura los valores antes de iniciar.</p>`);
      else if(action==='usuario-nuevo'||action==='usuario-editar')userForm(id);
      else if(['finalizar','cancelar'].includes(action))modal('Cerrar actividad',field('motivo','Motivo','','text','minlength="5" maxlength="500"'),async d=>act(action,d),'Confirmar cierre');
      else if(action==='ofertar'){const me=state.participantes.find(p=>p.usuario_id===user.id);modal('Ofrecer propiedad',select('comprador_id','Comprador',state.participantes.filter(p=>p.id!==me.id&&p.estado==='activo').map(p=>[p.id,p.nombre]))+field('precio','Precio (UMV)',100,'number','min="0.01" max="1000000" step="0.01"'),async d=>act('ofertar',{activo_id:id,comprador_id:d.comprador_id,precio:Number(d.precio)}),'Enviar oferta');}
      else if(action==='casilla'){const c=state.casillas.find(c=>c.id===id),a=state.activos.find(a=>a.casilla_id===id),v=state.partida.configuracion.valores[id]||c.valores_base;modal(c.nombre,a?`<p>Precio: ${fmt(a.precio_base)}</p><p>Alquiler: ${fmt(Number(v.alquiler)+a.nivel_inversion*Number(v.incremento_alquiler))}</p><p>Rescate: ${fmt(a.valor_rescate)} · Inversión: ${a.nivel_inversion}</p><p>Dueño: ${esc(state.participantes.find(p=>p.id===a.propietario_id)?.nombre||'Banco')}</p>`:`<p>${esc(c.tipo)} · ${v.importe?fmt(v.importe):'Premio al completar una vuelta.'}</p>`);}
      else if(['comprar','invertir','vender','aceptar','rechazar','insolvencia'].includes(action)){const data=['aceptar','rechazar'].includes(action)?{oferta_id:id}:action==='insolvencia'?{}:{activo_id:id};modal('Confirmar '+action,'<p>Se aplicará esta operación con recursos virtuales según las reglas vigentes.</p>',async()=>act(action,data));}
      else await act(action);
    }catch(err){toast(err.message);}
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape')close();if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role=button]')){e.preventDefault();e.target.click();}
    if(e.key==='Tab'&&!$('#demo-modal')?.hidden){const nodes=$$('button,input,select,a[href]',$('#demo-modal')).filter(n=>!n.disabled),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
  });
  document.addEventListener('click',e=>{if(e.target===$('#demo-modal'))close();});
  boot().catch(e=>{toast(e.message);if([403,404].includes(e.status)&&$('main'))$('main').innerHTML=`<section class="card"><h2>${esc(e.message)}</h2><a href="salas.html">Mis partidas</a></section>`;});
})();
