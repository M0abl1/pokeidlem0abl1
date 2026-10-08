const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {attachDiagnostics}=require('./diagnostics.cjs');
test('recuperação exige falhas consecutivas e respeita intervalo entre recargas',async()=>{
 const wc=new EventEmitter();let calls=0,recoveries=0;
 wc.isDestroyed=()=>false;wc.isLoading=()=>true;
 wc.executeJavaScript=async()=>{calls++;throw Error('busy');};
 const d=attachDiagnostics(wc,()=>{},{interval:2,now:()=>1000000,onStalled:()=>recoveries++});
 try{await new Promise(resolve=>setTimeout(resolve,40));assert.ok(calls>=3);assert.equal(recoveries,1);}finally{d.close();}
});
test('diagnóstico preserva códigos mas não mensagens ou URLs sensíveis',()=>{
 const wc=new EventEmitter(),output=[];const d=attachDiagnostics(wc,x=>output.push(x));
 wc.emit('did-fail-load',{},-105,'token=SECRET','https://example/?token=SECRET',true);
 assert.match(output.at(-1).diagnostic,/-105/);assert.ok(!JSON.stringify(output).includes('SECRET'));
 wc.emit('console-message',{},3,'cookie=SECRET');assert.match(output.at(-1).diagnostic,/erros JS: 1/);
 wc.emit('render-process-gone',{}, {reason:'SECRET'});assert.match(output.at(-1).diagnostic,/desconhecido/);
 assert.ok(!JSON.stringify(output).includes('SECRET'));d.close();
});
