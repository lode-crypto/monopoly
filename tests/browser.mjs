import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { testDatabase } from './database.js';
import { migrate,seedCatalog } from '../server/catalog.js';
import { hashPassword } from '../server/security.js';
import { buildApp } from '../server/app.js';
const db=await testDatabase(),conn=await db.connect();await migrate(conn);await seedCatalog(conn);conn.release();
const password='Navegador_2026!';
for(const [i,rol]of ['administrador','docente','estudiante','estudiante'].entries())await db.query('INSERT INTO usuarios(id,nombre,correo,password_hash,rol) VALUES($1,$2,$3,$4,$5)',[randomUUID(),'Participante '+i,`ui${i}@ceicom.test`,await hashPassword(password),rol]);
const server=buildApp(db,{origin:'http://127.0.0.1:3107'});await new Promise(r=>server.http.listen(3107,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const errors=[],contexts=[];const base='http://127.0.0.1:3107';
const output=new URL('../../../work/qa-ui/',import.meta.url);await mkdir(output,{recursive:true});
async function login(i){const ctx=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(ctx);const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/login.html');await page.locator('#login [name=correo]').fill(`ui${i}@ceicom.test`);await page.locator('#login [name=password]').fill(password);await page.locator('#login button').click();await page.waitForURL('**/salas.html');return page;}
try{
 const teacher=await login(1);await teacher.getByRole('button',{name:'＋ Crear partida'}).click();
 await teacher.locator('[name=nombre]').fill('Actividad verificada en navegador');await teacher.getByRole('button',{name:'Crear partida',exact:true}).click();
 await teacher.waitForURL('**/sala.html?partida=*');await teacher.getByRole('heading',{name:'Actividad verificada en navegador'}).first().waitFor();
 const id=new URL(teacher.url()).searchParams.get('partida');const g=(await db.query('SELECT codigo FROM partidas WHERE id=$1',[id])).rows[0];
 const students=[];for(const i of [2,3]){const p=await login(i);students.push(p);await p.locator('#join-code').fill(g.codigo);await p.getByRole('button',{name:'Ingresar',exact:true}).click();await p.waitForURL('**/sala.html?partida=*');}
 await teacher.getByRole('button',{name:'Iniciar',exact:true}).waitFor();await teacher.waitForFunction(()=>!document.querySelector('[data-live=iniciar]').disabled);
 await teacher.getByRole('button',{name:'Configurar reglas'}).click();await teacher.locator('[name=capital_inicial]').fill('1600');await teacher.getByRole('button',{name:'Guardar reglas'}).click();await teacher.locator('#demo-modal').waitFor({state:'hidden'});
 await teacher.getByRole('button',{name:'Iniciar',exact:true}).click();await teacher.waitForFunction(()=>document.querySelector('.players').textContent.includes('activa'));
 await teacher.goto(base+'/juego.html?partida='+id);await students[0].goto(base+'/juego.html?partida='+id);await students[1].goto(base+'/juego.html?partida='+id);
 await students[0].getByRole('button',{name:'Lanzar dados',exact:true}).waitFor();await students[0].getByRole('button',{name:'Lanzar dados',exact:true}).click();
 await students[0].waitForFunction(()=>!document.querySelector('[data-live=cerrar_turno]').disabled);
 await students[1].waitForFunction(()=>document.querySelector('.dice-pair').textContent.includes('+'));
 assert.equal(await students[1].getByRole('button',{name:'Lanzar dados',exact:true}).isDisabled(),true);
 await students[0].screenshot({path:new URL('tablero-escritorio.png',output).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
 await students[0].getByRole('button',{name:'Terminar turno',exact:true}).click();await students[1].waitForFunction(()=>!document.querySelector('[data-live=lanzar]').disabled);
 await teacher.getByRole('button',{name:'Pausar',exact:true}).click();await students[1].waitForFunction(()=>document.querySelector('[data-live=lanzar]').disabled);
 await teacher.getByRole('button',{name:'Reanudar',exact:true}).click();await students[1].waitForFunction(()=>!document.querySelector('[data-live=lanzar]').disabled);
 await students[0].goto(base+'/estadisticas.html?partida='+id);await students[0].locator('#download-csv').waitFor();assert.equal(await students[0].locator('#report-content tbody tr').count(),1);
 const download=students[0].waitForEvent('download');await students[0].locator('#download-csv').click();assert.equal((await download).suggestedFilename(),'reporte-ceicom.csv');
 await students[0].goto(base+'/historial.html?partida='+id);await students[0].locator('#history-prev').waitFor();assert.equal(await students[0].locator('#history-prev').isDisabled(),true);assert.ok(await students[0].locator('#report-content tbody tr').count()>=2);
 await students[0].setViewportSize({width:390,height:844});await students[0].goto(base+'/juego.html?partida='+id);await students[0].locator('[data-live=lanzar]').waitFor();
 await students[0].screenshot({path:new URL('tablero-movil.png',output).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
 const admin=await login(0);await admin.goto(base+'/admin.html');await admin.getByRole('button',{name:'Crear usuario',exact:true}).click();await admin.locator('[name=nombre]').fill('Docente de prueba');await admin.locator('[name=correo]').fill('nuevo.docente@ceicom.test');await admin.locator('[name=password]').fill(password);await admin.locator('[name=rol]').selectOption('docente');await admin.getByRole('button',{name:'Guardar',exact:true}).click();await admin.getByRole('cell',{name:'nuevo.docente@ceicom.test',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('UI OK: creación, configuración, ingreso, turno, sincronización, pausa, reanudación, reporte privado, CSV, móvil y administración.');
}finally{for(const c of contexts)await c.close();await browser.close();server.stop();await new Promise(r=>server.io.close(r));await db.end();}
