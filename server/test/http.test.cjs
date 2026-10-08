'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {WebSocket}=require('ws');
test('painel exige autenticação, persiste configurações e pausa contas',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-http-'));
  const child=spawn(process.execPath,[path.join(__dirname,'../app.cjs')],{env:{...process.env,HOST:'127.0.0.1',PORT:'0',PANEL_AUTH_TOKEN:'synthetic-integration-token',DATA_DIR:dir,SPRITE_SYNC:'0'},stdio:['ignore','pipe','pipe']});
  try{
    const url=await new Promise((resolve,reject)=>{child.stdout.on('data',data=>{const m=String(data).match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m)resolve(`http://127.0.0.1:${m[1]}`);});child.once('error',reject);child.once('exit',()=>reject(Error('Servidor encerrou antes de iniciar')));});
    assert.equal((await fetch(url)).status,200);
    assert.equal((await fetch(url+'/api/accounts')).status,401);
    assert.equal((await fetch(url+'/api/accounts/0/focus',{method:'POST'})).status,401);
    assert.equal((await fetch(url+'/sprites/normal/pikachu.png')).status,401);
    assert.equal((await fetch(url+'/api/captures')).status,401);
    const login=await fetch(url+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'synthetic-integration-token'})});
    assert.equal(login.status,204);const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);
    const headers={Cookie:cookie.split(';')[0],'Content-Type':'application/json'};
    assert.equal((await fetch(url+'/api/accounts/0/settings',{method:'PUT',headers,body:JSON.stringify({autoHunts:true,token:'must-not-persist'})})).status,200);
    assert.equal((await fetch(url+'/api/pause',{method:'POST',headers})).status,204);
    const state=await (await fetch(url+'/api/accounts',{headers})).json();
    assert.ok(state.accounts.every(a=>!a.settings.autoHunts));
    assert.equal(fs.readFileSync(path.join(dir,'state.json'),'utf8').includes('must-not-persist'),false);
    assert.equal((await fetch(url+'/api/accounts/0/login',{method:'POST',headers})).status,503);
    assert.equal((await fetch(url+'/api/accounts/99/focus',{method:'POST',headers})).status,404);
    assert.equal((await fetch(url+'/api/accounts/0/local-login',{method:'POST',headers})).status,404);
    assert.equal(state.local,false);
    assert.equal((await fetch(url+'/api/accounts/0/focus',{method:'POST',headers})).status,503);
    const agent=new WebSocket(url.replace('http:','ws:')+'/?mode=agent',{headers});
    try{
      const focused=new Promise((resolve,reject)=>{agent.on('error',reject);agent.on('message',raw=>{const message=JSON.parse(raw);if(message.type==='focus')resolve(message);});});
      await new Promise((resolve,reject)=>{agent.on('error',reject);agent.on('open',()=>agent.send(JSON.stringify({accountId:0})));agent.on('message',raw=>{const message=JSON.parse(raw);if(message.type==='settings')resolve();if(message.type==='authorize-login')agent.send(JSON.stringify({type:'login-pair',requestId:message.requestId,pair:{account:0,nonce:'a'.repeat(64)}}));});});
      assert.equal((await fetch(url+'/api/accounts/0/focus',{method:'POST',headers})).status,204);
      assert.deepEqual(await focused,{type:'focus',accountId:0});
      const raised=new Promise(resolve=>agent.on('message',raw=>{const message=JSON.parse(raw);if(message.type==='focus'&&message.raise)resolve(message);}));
      assert.equal((await fetch(url+'/api/accounts/0/focus?raise=1',{method:'POST',headers})).status,204);
      assert.deepEqual(await raised,{type:'focus',accountId:0,raise:true});
      const web=new WebSocket(url.replace('http:','ws:')+'/?mode=web',{headers});
      const pushed=new Promise((resolve,reject)=>{web.on('error',reject);web.on('message',raw=>{const message=JSON.parse(raw);if(message.type==='captures-add')resolve(message);});});
      await new Promise((resolve,reject)=>{web.on('open',resolve);web.on('error',reject);});
      agent.send(JSON.stringify({type:'captures',captures:[{id:'99',species:'Eevee',level:3,p:'P2',ivTotal:120,ivs:{},score:60}]}));
      const message=await pushed;web.close();
      assert.equal(message.captures[0].species,'Eevee');assert.equal(message.captures[0].account,0);
      assert.equal((await(await fetch(url+'/api/captures',{headers})).json()).captures.length,1);
      assert.equal((await fetch(url+'/api/captures/clear',{method:'POST',headers})).status,204);
      assert.equal((await(await fetch(url+'/api/captures',{headers})).json()).captures.length,0);
      assert.equal((await fetch(url+'/sprites/normal/..%2Fstate.png',{headers})).status,404);
      const pair=await(await fetch(url+'/api/accounts/0/login',{method:'POST',headers})).json();
      assert.deepEqual(pair,{account:0,nonce:'a'.repeat(64)});
    }finally{agent.close();}
  }finally{child.kill();}
});
