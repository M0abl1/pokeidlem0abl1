const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('closed analyzer skips hidden cards and socket-backed DOM scans',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../pokeidle-party-depot-analyzer.user.js'),'utf8').replace('  installPassiveWebSocketReader();','  globalThis.testing={state,render,scanDOM};return;\n  installPassiveWebSocketReader();');
 let toggles=0;const host={classList:{toggle(){toggles++;}},querySelector(){assert.fail('closed panel must not construct hidden UI');}};
 const ctx={console,Date,localStorage:{setItem(){}},document:{body:{},getElementById(){return host;},querySelectorAll(){assert.fail('live combat must not scan DOM');}},requestAnimationFrame(){},setTimeout(){return 1;},clearTimeout(){}};
 vm.runInNewContext(src,ctx);const {state,render,scanDOM}=ctx.testing;
 state.open=false;state.ioComplete=true;render();scanDOM();assert.equal(toggles,1);
});
