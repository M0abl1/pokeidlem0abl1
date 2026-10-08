'use strict';
// Optional bridge: Electron remains the game session owner during migration.
// It authenticates server-side only; credentials never reach renderer/game code.
const http=require('node:http'),https=require('node:https');const {WebSocket}=require('ws');
function startServerAgent({baseUrl,token,accountCount,onSettings,onLogin,onFocus=()=>{},onLocalLogin=()=>{}}){
  if(!baseUrl||!token)return {report(){},captures(){},sync(){},close(){}};
  let closed=false;const clients=new Map(),target=new URL(baseUrl);
  const request=(url,options={})=>new Promise((resolve,reject)=>{const transport=url.protocol==='https:'?https:http;const req=transport.request(url,{method:options.method||'GET',headers:options.headers},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:raw}));});req.on('error',reject);if(options.body)req.end(options.body);else req.end();});
  function connect(accountId){const client=clients.get(accountId)||{};clients.set(accountId,client);(async()=>{try{const login=await request(new URL('/api/session',target),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});const cookie=String(login.headers['set-cookie']?.[0]||'').split(';')[0];if(login.status!==204||!cookie)throw Error('autenticação do agente recusada');const ws=client.ws=new WebSocket(new URL('/?mode=agent',target),{headers:{Cookie:cookie}});ws.on('open',()=>ws.send(JSON.stringify({accountId})));ws.on('message',raw=>{try{const msg=JSON.parse(raw);if(msg.type==='settings'&&msg.accountId===accountId)onSettings(accountId,msg.settings);if(msg.type==='focus'&&msg.accountId===accountId)onFocus(accountId,msg.raise===true);if(msg.type==='local-login'&&msg.accountId===accountId)onLocalLogin(accountId);if(msg.type==='authorize-login'){try{const pair=onLogin(accountId);ws.send(JSON.stringify({type:'login-pair',requestId:msg.requestId,pair}));}catch{ws.send(JSON.stringify({type:'login-pair',requestId:msg.requestId,error:true}));}}}catch{}});ws.on('close',()=>retry(accountId));ws.on('error',()=>{});}catch{retry(accountId);}})();}
  function retry(accountId){if(!closed){const client=clients.get(accountId)||{};clearTimeout(client.timer);client.timer=setTimeout(()=>connect(accountId),5000);clients.set(accountId,client);}}
  const update=async(accountId,settings)=>{
    if(!Number.isInteger(accountId)||accountId<0||accountId>=accountCount)throw Error('Conta inválida');
    const login=await request(new URL('/api/session',target),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    const cookie=String(login.headers['set-cookie']?.[0]||'').split(';')[0];
    if(login.status!==204||!cookie)throw Error('Não foi possível confirmar configuração');
    const result=await request(new URL(`/api/accounts/${accountId}/settings`,target),{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(settings)});
    if(result.status!==200)throw Error('Configuração não confirmada');
    onSettings(accountId,JSON.parse(result.body).settings);
  };
  for(let i=0;i<accountCount;i++)connect(i);return {update,report(accountId,status){const ws=clients.get(accountId)?.ws;if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'status',status}));},captures(accountId,list){const ws=clients.get(accountId)?.ws;if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'captures',captures:list}));},sync(){},close(){closed=true;for(const client of clients.values()){clearTimeout(client.timer);client.ws?.close();}}};
}
module.exports={startServerAgent};
