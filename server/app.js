import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { sessionUser, hashPassword, verifyPassword, digest, cookieOptions } from './security.js';
import { AppError,requireThat,registration,credentials,userUpdate,createGame,actionInput,uuid } from './validation.js';
import { transaction } from './db.js';
import { access,readState,execute,joinGame,configure,validateCatalog,gameReport,expireGames } from './repository.js';
const safeUser=u=>({id:u.id,nombre:u.nombre,correo:u.correo,rol:u.rol,activo:u.activo});
export function errorBody(e) {
  if(e instanceof ZodError)return {status:400,error:'Revisa los datos del formulario.',detalles:e.issues.map(i=>({campo:i.path.join('.'),mensaje:i.message}))};
  if(e instanceof AppError)return {status:e.status,error:e.message};
  if(e.code==='23505')return {status:409,error:'El registro ya existe.'};
  if(e.code==='23514'||e.code==='23503'||e.code==='22P02')return {status:400,error:'Los datos no cumplen las restricciones del sistema.'};
  if(e.type==='entity.parse.failed')return {status:400,error:'JSON inválido.'};
  if(e.type==='entity.too.large')return {status:413,error:'Solicitud demasiado grande.'};
  console.error(e);return {status:500,error:'No se pudo completar la operación. Intenta nuevamente.'};
}
export function buildApp(db,{origin=process.env.APP_ORIGIN||'http://localhost:3000',additionalOrigins=[]}={}) {
  const app=express(), http=createServer(app);
  const trustedOrigins=new Set([origin,...additionalOrigins]);
  const permitsOrigin=value=>!value||trustedOrigins.has(value);
  const io=new Server(http,{maxHttpBufferSize:32768,allowRequest:(req,cb)=>cb(null,permitsOrigin(req.headers.origin)),cors:{origin:(value,cb)=>cb(null,permitsOrigin(value)),credentials:true}});
  app.disable('x-powered-by');
  app.use(helmet({contentSecurityPolicy:{directives:{'default-src':["'self'"],'script-src':["'self'"],'style-src':["'self'","'unsafe-inline'"],'img-src':["'self'",'data:'],'connect-src':["'self'"],upgradeInsecureRequests:process.env.NODE_ENV==='production'?[]:null}},crossOriginEmbedderPolicy:false}));
  app.use(express.json({limit:'32kb'}));
  app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)){
    if(!permitsOrigin(req.headers.origin))return next(new AppError(403,'Origen de solicitud no permitido.'));
    if(!req.is('application/json'))return next(new AppError(415,'Se requiere JSON.'));
    if(req.headers['sec-fetch-site']==='cross-site')return next(new AppError(403,'Solicitud externa rechazada.'));
  }next();});
  const loginLimit=rateLimit({windowMs:15*60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Demasiados intentos. Espera 15 minutos.'}});
  app.use('/api',rateLimit({windowMs:60000,limit:300,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Demasiadas solicitudes. Espera un minuto.'}}));
  const auth=async(req,res,next)=>{try{req.user=await sessionUser(db,req.headers.cookie);next();}catch(e){next(e);}};
  const only=role=>(req,res,next)=>req.user.rol===role?next():next(new AppError(403,'Tu rol no permite esta operación.'));
  const disconnectUser=id=>io.in(`user:${id}`).disconnectSockets(true);
  async function notify(id){io.to(`game:${id}`).emit('partida:actualizada',{id});}
  app.get('/api/salud',async(req,res)=>{await db.query('SELECT 1');res.json({ok:true});});
  app.post('/api/auth/registro',loginLimit,async(req,res)=>{
    const d=registration.parse(req.body);
    const r=await db.query(`INSERT INTO usuarios(id,nombre,correo,password_hash,rol) VALUES($1,$2,$3,$4,'estudiante') RETURNING id,nombre,correo,rol,activo`,[randomUUID(),d.nombre,d.correo,await hashPassword(d.password)]);
    res.status(201).json(r.rows[0]);
  });
  app.post('/api/auth/login',loginLimit,async(req,res)=>{
    const d=credentials.parse(req.body),u=(await db.query('SELECT * FROM usuarios WHERE correo=$1',[d.correo])).rows[0];
    // También ejecuta scrypt para cuentas inexistentes, reduciendo diferencias de tiempo.
    const valid=await verifyPassword(d.password,u?.password_hash||`scrypt$00000000000000000000000000000000$${'0'.repeat(128)}`);
    requireThat(u?.activo && valid,'Correo o contraseña incorrectos, o cuenta inactiva.',401);
    const token=randomBytes(32).toString('hex');
    await db.query("INSERT INTO sesiones_acceso(id,usuario_id,token_hash,expira_en) VALUES($1,$2,$3,now()+interval '8 hours')",[randomUUID(),u.id,digest(token)]);
    res.cookie('mono_session',token,cookieOptions()).json(safeUser(u));
  });
  app.get('/api/auth/yo',auth,(req,res)=>res.json(safeUser(req.user)));
  app.post('/api/auth/logout',auth,async(req,res)=>{
    await db.query('UPDATE sesiones_acceso SET revocada_en=now() WHERE id=$1',[req.user.sesion_id]);
    io.in(`session:${req.user.sesion_id}`).disconnectSockets(true);res.clearCookie('mono_session',cookieOptions()).json({ok:true});
  });
  app.get('/api/usuarios',auth,only('administrador'),async(req,res)=>res.json((await db.query('SELECT id,nombre,correo,rol,activo,creado_en FROM usuarios ORDER BY creado_en DESC')).rows));
  app.post('/api/usuarios',auth,only('administrador'),async(req,res)=>{
    const d=registration.extend({rol:userUpdate.shape.rol}).parse(req.body), hash=await hashPassword(d.password);
    const u=await transaction(db,async c=>{
      const r=await c.query('INSERT INTO usuarios(id,nombre,correo,password_hash,rol) VALUES($1,$2,$3,$4,$5) RETURNING id,nombre,correo,rol,activo',[randomUUID(),d.nombre,d.correo,hash,d.rol]);
      await c.query('INSERT INTO auditoria(id,usuario_id,evento,detalle) VALUES($1,$2,$3,$4)',[randomUUID(),req.user.id,'crear_usuario',{usuario_id:r.rows[0].id,rol:d.rol}]);return r.rows[0];
    });res.status(201).json(u);
  });
  app.patch('/api/usuarios/:id',auth,only('administrador'),async(req,res)=>{
    const id=uuid.parse(req.params.id),d=userUpdate.parse(req.body);
    requireThat(id!==req.user.id||(d.activo&&d.rol==='administrador'),'No puedes quitarte tu propio acceso administrativo.');
    const u=await transaction(db,async c=>{
      const r=await c.query('UPDATE usuarios SET nombre=$1,rol=$2,activo=$3 WHERE id=$4 RETURNING id,nombre,correo,rol,activo',[d.nombre,d.rol,d.activo,id]);requireThat(r.rows.length,'Usuario no encontrado.',404);
      await c.query('UPDATE sesiones_acceso SET revocada_en=now() WHERE usuario_id=$1',[id]);
      await c.query('INSERT INTO auditoria(id,usuario_id,evento,detalle) VALUES($1,$2,$3,$4)',[randomUUID(),req.user.id,'actualizar_usuario',{usuario_id:id,rol:d.rol,activo:d.activo}]);return r.rows[0];
    });disconnectUser(id);res.json(u);
  });
  app.get('/api/auditoria',auth,only('administrador'),async(req,res)=>res.json((await db.query('SELECT * FROM auditoria ORDER BY creado_en DESC LIMIT 200')).rows));
  app.get('/api/tableros',auth,async(req,res)=>res.json((await db.query('SELECT * FROM tableros ORDER BY nombre')).rows));
  app.get('/api/tableros/:id',auth,async(req,res)=>res.json((await db.query('SELECT * FROM casillas WHERE tablero_id=$1 ORDER BY posicion',[uuid.parse(req.params.id)])).rows));
  app.get('/api/partidas',auth,async(req,res)=>{
    const u=req.user;
    res.json((await db.query(`SELECT p.*, (SELECT count(*)::int FROM participantes m WHERE m.partida_id=p.id) AS participantes FROM partidas p
      WHERE ($1='administrador') OR ($1='docente' AND p.docente_id=$2) OR ($1='estudiante' AND EXISTS(SELECT 1 FROM participantes m WHERE m.partida_id=p.id AND m.usuario_id=$2)) ORDER BY p.creada_en DESC`,[u.rol,u.id])).rows);
  });
  app.post('/api/partidas',auth,only('docente'),async(req,res)=>{
    const d=createGame.parse(req.body),id=randomUUID(),code=randomBytes(6).toString('hex').toUpperCase();
    await transaction(db,async c=>{
      await validateCatalog(c,d.tablero_id,d.configuracion);
      await c.query("INSERT INTO partidas(id,docente_id,tablero_id,nombre,codigo,estado,configuracion) VALUES($1,$2,$3,$4,$5,'espera',$6)",[id,req.user.id,d.tablero_id,d.nombre,code,d.configuracion]);
      await c.query('INSERT INTO auditoria(id,usuario_id,partida_id,evento,detalle) VALUES($1,$2,$3,$4,$5)',[randomUUID(),req.user.id,id,'crear_partida',{}]);
    });res.status(201).json({id,codigo:code});
  });
  app.post('/api/partidas/ingresar',auth,async(req,res)=>{
    const code=String(req.body.codigo||'').trim().toUpperCase();requireThat(/^[A-F0-9]{12}$/.test(code),'Escribe el código de 12 caracteres.',400);
    const result=await joinGame(db,code,req.user);await notify(result.id);res.json(result);
  });
  app.get('/api/partidas/:id',auth,async(req,res)=>res.json(await readState(db,uuid.parse(req.params.id),req.user)));
  app.put('/api/partidas/:id/reglas',auth,async(req,res)=>{const id=uuid.parse(req.params.id);res.json(await configure(db,id,req.user,req.body));await notify(id);});
  app.post('/api/partidas/:id/acciones',auth,async(req,res)=>{
    const id=uuid.parse(req.params.id),r=await execute(db,id,req.user,actionInput.parse(req.body));res.json(r);await notify(id);
  });
  app.get('/api/partidas/:id/reporte',auth,async(req,res)=>res.json(await gameReport(db,uuid.parse(req.params.id),req.user)));
  app.get('/api/partidas/:id/historial',auth,async(req,res)=>{
    const id=uuid.parse(req.params.id);await access(db,id,req.user);
    const page=Math.max(0,Math.min(100000,Number.parseInt(req.query.pagina)||0));
    const acciones=(await db.query('SELECT id,tipo,turno_id,usuario_id,creada_en,version_resultado FROM acciones WHERE partida_id=$1 ORDER BY version_resultado DESC LIMIT 100 OFFSET $2',[id,page*100])).rows;
    const movimientos=(await db.query('SELECT m.* FROM movimientos m JOIN acciones a ON a.id=m.accion_id WHERE m.partida_id=$1 ORDER BY a.version_resultado DESC,m.creado_en DESC LIMIT 200 OFFSET $2',[id,page*200])).rows;
    res.json({pagina:page,acciones,movimientos});
  });
  io.use(async(socket,next)=>{try{socket.data.user=await sessionUser(db,socket.request.headers.cookie);next();}catch(e){next(new Error('Sesión inválida.'));}});
  io.on('connection',socket=>{
    const u=socket.data.user;socket.join(`user:${u.id}`);socket.join(`session:${u.sesion_id}`);
    let count=0,window=Date.now();
    socket.use(async(packet,next)=>{
      try {
        if(Date.now()-window>60000){window=Date.now();count=0;}requireThat(++count<=120,'Demasiadas acciones.',429);
        socket.data.user=await sessionUser(db,socket.request.headers.cookie);next();
      }catch(e){const ack=packet.at(-1);if(typeof ack==='function')ack({error:'Sesión inválida o límite de acciones.'});socket.disconnect(true);}
    });
    socket.on('partida:observar',async(payload,ack=()=>{})=>{
      if(typeof ack!=='function')ack=()=>{};
      try {
        const id=uuid.parse(payload.id),state=await readState(db,id,socket.data.user);
        for(const room of socket.rooms)if(room.startsWith('game:'))socket.leave(room);
        socket.join(`game:${id}`);
        await db.query('UPDATE participantes SET ultima_conexion=now() WHERE partida_id=$1 AND usuario_id=$2',[id,u.id]);ack({estado:state});
      }catch(e){ack(errorBody(e));}
    });
    socket.on('partida:accion',async(payload,ack=()=>{})=>{
      if(typeof ack!=='function')ack=()=>{};
      try{const id=uuid.parse(payload.id),r=await execute(db,id,socket.data.user,actionInput.parse(payload.accion));ack(r);await notify(id);}catch(e){ack(errorBody(e));}
    });
  });
  app.use('/api',(req,res)=>res.status(404).json({error:'Ruta no encontrada.'}));
  app.use(express.static(fileURLToPath(new URL('../public/',import.meta.url)),{dotfiles:'deny'}));
  app.use((err,req,res,next)=>{const d=errorBody(err);res.status(d.status).json(d);});
  let ticking=false;
  const timer=setInterval(async()=>{if(ticking)return;ticking=true;try{for(const id of await expireGames(db))await notify(id);}catch(e){console.error('Reloj de partidas:',e.message);}finally{ticking=false;}},5000);
  timer.unref();
  return {app,http,io,stop:()=>clearInterval(timer)};
}
