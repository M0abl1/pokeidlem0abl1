const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('three distinct targets without artificial cooldown, fair retries and out-of-order acknowledgements',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../pokeidle-party-depot-analyzer.user.js'),'utf8').replace('  installPassiveWebSocketReader();','  globalThis.testing={state,runCapture,acknowledgeCapture};return;\n  installPassiveWebSocketReader();');
  let now=1000000,next=0;const timers=new Map(),sent=[];class Clock extends Date{static now(){return now;}}
  const ctx={console,Date:Clock,localStorage:{setItem(){}},requestAnimationFrame(){},setTimeout(fn){timers.set(++next,fn);return next;},clearTimeout(i){timers.delete(i)}};
  vm.runInNewContext(src,ctx);const {state,runCapture,acknowledgeCapture}=ctx.testing;
  Object.assign(state,{autoCapture:true,ioComplete:true,captureScene:'hunt',ioFields:{huntSlug:'hunt',balls:{1:99},automation:{}},ballCatalog:[{id:1,catchRate:1}],ioSocket:{readyState:1,send:s=>sent.push(JSON.parse(s))}});
  for(let slot=1;slot<=4;slot++)state.captureMobs.set(slot,{slot,dead:true,shiny:false,expires:now+30000});
  runCapture();assert.equal(sent.length,3,'fills three distinct targets without waiting for timers');runCapture();assert.equal(sent.length,3);assert.equal(new Set(sent.map(s=>s.slot)).size,3);
  acknowledgeCapture({slot:2,ballId:1,sucesso:false});runCapture();assert.equal(sent.at(-1).slot,4,'untouched body before failed retry');
  acknowledgeCapture({slot:1,ballId:1,sucesso:true});acknowledgeCapture({slot:3,ballId:1,sucesso:true});now+=500;runCapture();assert.equal(sent.at(-1).slot,2,'failed attempt retries if body is still present');
  for(const pending of [...state.captureInflight.values()])timers.get(pending.timer)();assert.equal(state.autoCapture,true);assert.equal(state.captureInflight.size,0);assert.equal(state.captureMobs.get(4).done,true);const count=sent.length;runCapture();assert.equal(sent.length,count,'unknown result never causes repeat spending on same body');
});
test('field removal releases pending throw before delayed battle result',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../pokeidle-party-depot-analyzer.user.js'),'utf8').replace('  installPassiveWebSocketReader();','  globalThis.testing={state,runCapture,readCaptureField,acknowledgeCapture};return;\n  installPassiveWebSocketReader();');
 let next=0;const timers=new Map(),sent=[];const ctx={console,Date,localStorage:{setItem(){}},requestAnimationFrame(){},setTimeout(fn){timers.set(++next,fn);return next;},clearTimeout(i){timers.delete(i)}};
 vm.runInNewContext(src,ctx);const {state,runCapture,readCaptureField,acknowledgeCapture}=ctx.testing;
 Object.assign(state,{autoCapture:true,ioComplete:true,captureScene:'hunt',ioFields:{huntSlug:'hunt',balls:{1:99},automation:{}},ballCatalog:[{id:1,catchRate:1}],ioSocket:{readyState:1,send:s=>sent.push(JSON.parse(s))}});
 for(let slot=1;slot<=4;slot++)state.captureMobs.set(slot,{slot,dead:true,shiny:false,expires:Date.now()+30000});
 runCapture();runCapture();runCapture();const timeout=state.captureInflight.get(1).timer;
 readCaptureField({t:'campo',fora:[1]});assert.equal(timers.has(timeout),false);assert.equal(state.autoCapture,true);runCapture();assert.equal(sent.at(-1).slot,4);
 acknowledgeCapture({slot:1,ballId:1,sucesso:true});assert.equal(state.captureStatus,'Captura confirmada.');assert.equal(state.captureInflight.has(4),true);
 acknowledgeCapture({slot:2,ballId:1,sucesso:true});
 readCaptureField({t:'campo',mobs:[{s:5,x:true,xr:30000}]});assert.equal(state.captureMobs.get(5).shiny,false);assert.equal(sent.at(-1).slot,5,'omitted false shiny flag must not skip common bodies');
});
