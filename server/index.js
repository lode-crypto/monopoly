import { createPool } from './db.js';
import { buildApp } from './app.js';
import { networkInterfaces } from 'node:os';
const db=createPool();
await db.query('SELECT id FROM tableros LIMIT 1');
const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
const additionalOrigins=[];
if(process.env.NODE_ENV!=='production'){
  additionalOrigins.push(`http://localhost:${port}`,`http://127.0.0.1:${port}`);
  if(host==='0.0.0.0')for(const entries of Object.values(networkInterfaces()))for(const address of entries||[]){
    if(address.family==='IPv4'&&!address.internal)additionalOrigins.push(`http://${address.address}:${port}`);
  }
}
const server=buildApp(db,{additionalOrigins});
server.http.listen(port,host,()=>console.log(`MONOpoly CEICOM: ${process.env.APP_ORIGIN||`http://localhost:${port}`} (${host}:${port})`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.stop();server.io.close();server.http.close(async()=>{await db.end();process.exit(0);});});
