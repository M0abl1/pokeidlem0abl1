'use strict';
// Protocol verified against pokeidle.io/app.js v1.230.1 (2026-10-05).
// No guessed item IDs; one in-flight order, confirmed only by authoritative stock.
class AutoBuy {
  constructor({send,checkpoint=()=>{},report=()=>{},now=Date.now,settings={},saved=null}) {
    this.send=send;this.checkpoint=checkpoint;this.report=report;this.now=now;
    this.settings=settings;this.blocked=!!saved;this.pending=null;this.snapshot=null;
    this.catalog=[];this.lastState=0;this.lastOrder=-Infinity;
    if(saved)this.report({buyBlocked:true,automationStatus:'Compras desativadas: pedido anterior não confirmado.'});
  }
  configure(settings) {
    const rearm=(settings.autoBuyBalls&&!this.settings.autoBuyBalls)||(settings.autoBuyPotions&&!this.settings.autoBuyPotions);
    this.settings=settings;
    if(rearm&&this.blocked){this.blocked=false;this.pending=null;this.checkpoint(null);}
  }
  fail(reason) {this.blocked=true;this.pending=null;try{this.checkpoint({blocked:true});}catch{}this.report({buyBlocked:true,automationStatus:reason});}
  disconnect(){if(this.pending)this.fail('Compras desativadas: conexão perdida durante pedido.');this.snapshot=null;this.lastState=0;}
  observe(message) {
    if(message.t==='erro'&&this.pending)return this.fail('Compras desativadas: servidor recusou ou retornou erro.');
    if(!['welcome','estado'].includes(message.t)||!message.estado)return;
    if(message.t==='welcome'){this.snapshot=null;this.lastState=0;}
    const delta=message.estado;
    if(delta.cheio)this.snapshot={};
    if(!this.snapshot)return;
    // Official estado-delta.mjs replaces these fields wholesale, not nested merging.
    for(const key of ['balls','items','gold','huntSlug','noCentro','boss','mistico','pvp','campeonato','casa'])
      if(Object.hasOwn(delta,key))this.snapshot[key]=delta[key];
    this.lastState=this.now();
    if(this.pending) {
      const p=this.pending,field=p.kind==='ball'?'balls':'items';
      if(Object.hasOwn(delta,field)) {
        const count=this.snapshot[field]?.[p.id]??0;
        if(!Number.isSafeInteger(count)||count<0)return this.fail('Compras desativadas: estoque inválido.');
        if(count>=p.before+p.qty){this.pending=null;this.checkpoint(null);this.report({buyBlocked:false,buyConfirmed:true,automationStatus:`Compra confirmada: ${p.qty} ${p.name}.`});}
        // Concurrent consumption can obscure confirmation: wait, then stop, never retry.
      }
    }
  }
  tick() {
    const time=this.now();
    if(this.blocked)return;
    if(this.pending){if(time-this.pending.at>=10000)this.fail('Compras desativadas: timeout ou confirmação ambígua.');return;}
    const s=this.snapshot;
    if(!s||time-this.lastState>5000||time-this.lastOrder<3000)return;
    // Ordinary hunts and the Pokémon Center only; never PvP/boss/special areas.
    if(!(s.noCentro===true||typeof s.huntSlug==='string'&&s.huntSlug.length)||s.boss?.arena||s.mistico||s.pvp?.arena||s.campeonato?.arena||s.casa?.dentro)return;
    if(!Number.isSafeInteger(s.gold)||s.gold<0)return;
    for(const [enabled,name,kind,threshold,qty] of [
      [this.settings.autoBuyBalls,'Ultra Ball','ball',100,100],
      [this.settings.autoBuyPotions,'Great Potion','item',200,200]
    ]) {
      if(!enabled)continue;
      const matches=this.catalog.filter(x=>x.kind===kind&&x.name.toLowerCase().replace(/\s/g,'')===name.toLowerCase().replace(/\s/g,''));
      if(matches.length!==1){this.report({buyAvailable:false,automationStatus:`Aguardando catálogo confirmado: ${name}.`});continue;}
      const item=matches[0],inventory=s[kind==='ball'?'balls':'items'];
      if(!inventory||typeof inventory!=='object'||Array.isArray(inventory))continue;
      const before=inventory[item.id]??0;
      if(!Number.isSafeInteger(before)||before<0||before>=threshold)continue;
      const cost=item.price*qty;
      if(!Number.isSafeInteger(item.id)||!Number.isSafeInteger(cost)||cost<=0)continue;
      if(s.gold<cost){this.report({automationStatus:`Gold insuficiente para ${qty} ${name}.`});continue;}
      const pending={kind,id:item.id,name,qty,before,at:time};
      // A durable checkpoint MUST precede send. Failure to persist means no purchase.
      try{this.checkpoint(pending);}catch{return this.fail('Compras desativadas: não foi possível persistir o pedido.');}
      this.pending=pending;this.lastOrder=time;
      try{this.send({t:'shop.buy',kind,id:item.id,qty});this.report({buyAvailable:true,buyBlocked:false,automationStatus:`Aguardando confirmação: ${qty} ${name}.`});}
      catch{this.fail('Compras desativadas: falha ao enviar pedido.');}
      return;
    }
  }
}
if(typeof module!=='undefined')module.exports={AutoBuy};
else globalThis.PokeIdleAutoBuy=AutoBuy;
