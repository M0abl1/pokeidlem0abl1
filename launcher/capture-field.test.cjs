const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('capture keeps field packets available in Eco without changing gameplay flags',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../pokeidle-party-depot-analyzer.user.js'),'utf8').replace('  installPassiveWebSocketReader();','  globalThis.testing={state,installPassiveWebSocketReader,requireCaptureField,acknowledgeCapture};return;\n  installPassiveWebSocketReader();');
  const sent=[];class Socket{constructor(){this.readyState=1;}send(s){sent.push(JSON.parse(s));}addEventListener(){}}
  const ctx={console,window:{WebSocket:Socket},location:{href:'https://pokeidle.io/app',host:'pokeidle.io'},URL,localStorage:{getItem(){return null},setItem(){}},requestAnimationFrame(){},clearTimeout(){},setTimeout(){return 1;}};
  vm.runInNewContext(src,ctx);const {state,installPassiveWebSocketReader,requireCaptureField}=ctx.testing;
  installPassiveWebSocketReader();const ws=new ctx.window.WebSocket('wss://pokeidle.io/ws');state.autoCapture=true;
  ws.send(JSON.stringify({t:'cliente.economia',ativo:true}));assert.equal(sent[0].ativo,false);
  state.ioComplete=true;requireCaptureField();assert.equal(sent[1].t,'cliente.economia');assert.equal(sent[1].ativo,false);
  state.autoCapture=false;ws.send(JSON.stringify({t:'cliente.economia',ativo:true}));assert.equal(sent[2].ativo,true);
  assert.ok(sent.every(p=>p.t==='cliente.economia'),'no VIP or combat mutations');
  state.capturePending={slot:5,ballId:2,timer:1};state.captureMobs.set(5,{slot:5});
  ctx.testing.acknowledgeCapture({slot:'5',ballId:'2',sucesso:true});assert.equal(state.capturePending,null);assert.equal(state.captureMobs.get(5).done,true);
});
