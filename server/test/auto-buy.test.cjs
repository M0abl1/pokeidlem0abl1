'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {AutoBuy}=require('../../common/auto-buy.cjs');
function fixture(saved=null){let time=20000;const orders=[],reports=[],writes=[];
 const engine=new AutoBuy({settings:{autoBuyBalls:true,autoBuyPotions:true},saved,now:()=>time,
 send:x=>{assert.ok(writes.at(-1));orders.push(x);},checkpoint:x=>writes.push(x),report:x=>reports.push(x)});
 engine.catalog=[{kind:'ball',id:4,name:'Ultra Ball',price:100},{kind:'item',id:201,name:'Great Potion',price:150}];
 const state={cheio:true,balls:{4:99},items:{201:199},gold:1000000,huntSlug:'example',noCentro:false};
 engine.observe({t:'welcome',estado:state});
 return {engine,orders,reports,writes,state,advance:n=>time+=n};
}
test('compra lotes fixos, um pedido por vez e confirma estoque',()=>{
 const f=fixture();f.engine.tick();assert.deepEqual(f.orders,[{t:'shop.buy',kind:'ball',id:4,qty:100}]);
 f.engine.tick();assert.equal(f.orders.length,1);
 f.engine.observe({t:'estado',estado:{balls:{4:199}}});assert.equal(f.engine.pending,null);
 f.advance(3000);f.engine.observe({t:'estado',estado:{gold:990000}});f.engine.tick();
 assert.deepEqual(f.orders[1],{t:'shop.buy',kind:'item',id:201,qty:200});
 f.engine.observe({t:'estado',estado:{items:{201:399}}});assert.equal(f.engine.pending,null);
});
test('limiar exato não compra; gold insuficiente não envia',()=>{
 const f=fixture();f.engine.observe({t:'estado',estado:{balls:{4:100},items:{201:200}}});f.engine.tick();assert.equal(f.orders.length,0);
 f.engine.observe({t:'estado',estado:{balls:{4:0},items:{201:0},gold:0}});f.engine.tick();assert.equal(f.orders.length,0);
});
test('timeout, resposta ambígua, erro e desconexão bloqueiam sem repetir',()=>{
 for(const mode of ['timeout','erro','disconnect']){const f=fixture();f.engine.tick();
  if(mode==='erro')f.engine.observe({t:'erro'});else if(mode==='disconnect')f.engine.disconnect();else {f.engine.observe({t:'estado',estado:{balls:{4:198}}});f.advance(10000);f.engine.tick();}
  assert.equal(f.engine.blocked,true);assert.equal(f.orders.length,1);assert.deepEqual(f.writes.at(-1),{blocked:true});
  f.engine.configure({autoBuyBalls:true,autoBuyPotions:true});f.engine.tick();assert.equal(f.orders.length,1);
 }
});
test('pedido persistido bloqueia ao reiniciar até reativação explícita',()=>{
 const f=fixture({kind:'ball'});f.engine.tick();assert.equal(f.orders.length,0);
 f.engine.configure({autoBuyBalls:false,autoBuyPotions:false});f.engine.configure({autoBuyBalls:true});f.engine.tick();assert.equal(f.orders.length,1);
});
test('bloqueia contextos especiais, dados antigos e catálogo ambíguo',()=>{
 for(const flag of ['boss','pvp','campeonato','mistico','casa']){const f=fixture();f.engine.observe({t:'estado',estado:{[flag]:flag==='casa'?{dentro:true}:flag==='mistico'?true:{arena:true}}});f.engine.tick();assert.equal(f.orders.length,0);}
 const f=fixture();f.advance(6000);f.engine.tick();assert.equal(f.orders.length,0);
 const a=fixture();a.engine.settings={autoBuyBalls:true};a.engine.catalog.push(a.engine.catalog[0]);a.engine.tick();assert.equal(a.orders.length,0);
});
test('falha na persistência impede envio',()=>{
 const f=fixture();f.engine.checkpoint=()=>{throw Error('disk');};f.engine.tick();assert.equal(f.orders.length,0);assert.equal(f.engine.blocked,true);
});
test('fail-safe do agente desativa compras persistidas no backend',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {Store}=require('../lib/store.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-buy-'));
 const store=new Store(dir,1);store.settings(0,{autoBuyBalls:true,autoBuyPotions:true});
 store.status(0,{buyBlocked:true,automationStatus:'Compras desativadas: timeout.'});
 const reload=new Store(dir,1);assert.equal(reload.data.accounts[0].settings.autoBuyBalls,false);assert.equal(reload.data.accounts[0].settings.autoBuyPotions,false);
 assert.equal(reload.data.accounts[0].status.buyBlocked,true);
});
