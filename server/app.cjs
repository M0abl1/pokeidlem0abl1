'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {WebSocketServer}=require('ws');const {Store}=require('./lib/store.cjs');const {Sprites}=require('./lib/sprites.cjs');
const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1',token=process.env.PANEL_AUTH_TOKEN||'';
if(host!=='127.0.0.1'&&!token)throw Error('PANEL_AUTH_TOKEN é obrigatório fora de 127.0.0.1.');
const dataDir=process.env.DATA_DIR||path.join(__dirname,'data'),store=new Store(dataDir,Number(process.env.ACCOUNT_COUNT||4)),sprites=new Sprites(path.join(dataDir,'sprites')),sessions=new Map(),webClients=new Set(),agents=new Map();
if(process.env.SPRITE_SYNC!=='0')sprites.sync().then(r=>console.log(`Sprites: ${r.total} espécies, ${r.downloaded} baixados, ${r.failed} falhas.`)).catch(error=>console.warn(`Sprites: sincronização falhou (${error.message}); download sob demanda continua.`));
const pendingLogins=new Map(),local=process.env.POKEIDLE_LOCAL==='1';
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cookie=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2)).pi_session;
const auth=req=>{const id=cookie(req),expiry=sessions.get(id);return expiry&&expiry>Date.now();};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const body=req=>new Promise((resolve,reject)=>{let text='';req.on('data',c=>{text+=c;if(text.length>65536)req.destroy();});req.on('end',()=>{try{resolve(text?JSON.parse(text):{});}catch{reject(Error('JSON inválido'));}});});
function broadcast(){const accounts=store.publicAccounts(),state=JSON.stringify({type:'state',accounts,logs:store.data.logs.slice(0,100)});for(const ws of webClients)if(ws.readyState===1)ws.send(state);for(const [id,ws] of agents)if(ws.readyState===1)ws.send(JSON.stringify({type:'settings',accountId:id,settings:accounts[id].settings}));}
function sendWeb(message){const text=JSON.stringify(message);for(const ws of webClients)if(ws.readyState===1)ws.send(text);}
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://local');
  if(url.pathname==='/health')return json(res,200,{ok:true});
  if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return fs.createReadStream(path.join(__dirname,'public','index.html')).pipe(res);}
  if(url.pathname==='/api/session'&&req.method==='POST'){const data=await body(req);if(!token||!equal(data.token,token))return json(res,401,{error:'Credencial inválida'});const id=crypto.randomBytes(32).toString('hex');sessions.set(id,Date.now()+86400000);res.writeHead(204,{'Set-Cookie':`pi_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,'Cache-Control':'no-store'});return res.end();}
  if(!auth(req))return json(res,401,{error:'Autenticação necessária'});
  if(url.pathname==='/api/access'&&req.method==='GET')return json(res,204,{});
  if(url.pathname==='/extension.zip'&&req.method==='GET'){
    if(!fs.existsSync(path.join(__dirname,'public/login-extension.zip'))){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="pokeidle-login-extension.zip"','Cache-Control':'no-store'});
    return fs.createReadStream(path.join(__dirname,'public/login-extension.zip')).pipe(res);
  }
  const spriteMatch=url.pathname.match(/^\/sprites\/(normal|shiny)\/([a-z0-9-]{1,40})\.png$/);
  if(spriteMatch&&req.method==='GET'){const image=await sprites.load(spriteMatch[1],spriteMatch[2]);if(!image){res.writeHead(404,{'Cache-Control':'private, max-age=3600'});return res.end();}res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, max-age=604800','X-Content-Type-Options':'nosniff'});return res.end(image);}
  if(url.pathname==='/api/captures'&&req.method==='GET')return json(res,200,store.publicCaptures());
  if(url.pathname==='/api/captures/clear'&&req.method==='POST'){store.clearCaptures();sendWeb({type:'captures',...store.publicCaptures()});broadcast();return json(res,204,{});}
  if(url.pathname==='/api/accounts'&&req.method==='GET')return json(res,200,{accounts:store.publicAccounts(),logs:store.data.logs.slice(0,100),local});
  if(url.pathname==='/api/pause'&&req.method==='POST'){store.pause();broadcast();return json(res,204,{});}
  const loginMatch=url.pathname.match(/^\/api\/accounts\/(\d+)\/login$/);
  if(loginMatch&&req.method==='POST'){
    const id=Number(loginMatch[1]),agent=agents.get(id);
    if(!agent||agent.readyState!==1)return json(res,503,{error:'Runtime indisponível'});
    store.pause(id);broadcast();
    const requestId=crypto.randomBytes(16).toString('hex');
    const pair=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pendingLogins.delete(requestId);reject(Error('Autorização de login expirou'));},10000);
      pendingLogins.set(requestId,{id,resolve,reject,timer});
      agent.send(JSON.stringify({type:'authorize-login',requestId}));
    });
    return json(res,200,pair);
  }
  const focusMatch=url.pathname.match(/^\/api\/accounts\/(\d+)\/focus$/);
  if(focusMatch&&req.method==='POST'){
    const id=Number(focusMatch[1]),agent=agents.get(id);
    if(!store.data.accounts[id])return json(res,404,{error:'Conta inválida'});
    if(!agent||agent.readyState!==1)return json(res,503,{error:'Runtime indisponível'});
    agent.send(JSON.stringify(url.searchParams.get('raise')==='1'?{type:'focus',accountId:id,raise:true}:{type:'focus',accountId:id}));return json(res,204,{});
  }
  // Local desktop mode: the game login happens in an Electron window, not through the Brave extension.
  const localLoginMatch=url.pathname.match(/^\/api\/accounts\/(\d+)\/local-login$/);
  if(localLoginMatch&&req.method==='POST'){
    const id=Number(localLoginMatch[1]),agent=agents.get(id);
    if(!local)return json(res,404,{error:'Disponível apenas na versão local'});
    if(!store.data.accounts[id])return json(res,404,{error:'Conta inválida'});
    if(!agent||agent.readyState!==1)return json(res,503,{error:'Launcher indisponível'});
    store.pause(id);broadcast();agent.send(JSON.stringify({type:'local-login',accountId:id}));return json(res,204,{});
  }
  const match=url.pathname.match(/^\/api\/accounts\/(\d+)\/(settings|pause|status)$/);if(match){const id=Number(match[1]),action=match[2];if(action==='settings'&&req.method==='PUT'){store.settings(id,await body(req));broadcast();return json(res,200,store.publicAccounts()[id]);}if(action==='pause'&&req.method==='POST'){store.pause(id);broadcast();return json(res,204,{});}if(action==='status'&&req.method==='POST'){store.status(id,await body(req));broadcast();return json(res,204,{});}}
  res.writeHead(404);res.end();
}catch(error){json(res,400,{error:error.message});}});
const wss=new WebSocketServer({noServer:true});server.on('upgrade',(req,socket,head)=>{if(!auth(req))return socket.destroy();wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));});
wss.on('connection',(ws,req)=>{if(new URL(req.url,'http://local').searchParams.get('mode')!=='agent'){webClients.add(ws);ws.send(JSON.stringify({type:'state',accounts:store.publicAccounts()}));ws.send(JSON.stringify({type:'captures',...store.publicCaptures()}));return ws.on('close',()=>webClients.delete(ws));}let id;ws.once('message',raw=>{try{id=Number(JSON.parse(raw).accountId);if(!Number.isInteger(id)||!store.data.accounts[id])return ws.close();agents.set(id,ws);store.status(id,{connection:'Agente Electron conectado'});broadcast();}catch{ws.close();}});ws.on('message',raw=>{try{const msg=JSON.parse(raw);if(msg.type==='login-pair'){const pending=pendingLogins.get(msg.requestId);if(pending&&pending.id===id){clearTimeout(pending.timer);pendingLogins.delete(msg.requestId);if(msg.pair&&/^[a-f0-9]{64}$/.test(msg.pair.nonce)&&msg.pair.account===id)pending.resolve({account:id,nonce:msg.pair.nonce});else pending.reject(Error('Não foi possível autorizar login'));}}if(msg.type==='status'&&id!=null){store.status(id,msg.status);broadcast();}if(msg.type==='log'&&id!=null)store.log(id,msg.message);if(msg.type==='captures'&&id!=null){const added=store.addCaptures(id,msg.captures);if(added.length){sendWeb({type:'captures-add',captures:added});broadcast();}}}catch{}});ws.on('close',()=>{if(agents.get(id)===ws){agents.delete(id);if(id!=null)store.status(id,{connection:'Agente Electron desconectado'});broadcast();}});});
server.listen(port,host,()=>console.log(`Painel em http://${host}:${server.address().port}`));
// The local desktop app embeds this server in-process and needs the chosen port.
const listening=new Promise((resolve,reject)=>{server.once('listening',()=>resolve(server.address().port));server.once('error',reject);});
module.exports={server,listening};
