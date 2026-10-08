(() => {
  if(location.origin!=='https://pokeidle.io'||!window.pokeidleLauncher||!window.PokeIdleAutoBuy)return;
  const key='pokeidle-buy-checkpoint-v1';let socket,ownSend=false;
  const report=status=>window.pokeidleLauncher.report(status);
  let saved;
  try{saved=JSON.parse(localStorage.getItem(key)||'null');}catch{saved={blocked:true};}
  const engine=new window.PokeIdleAutoBuy({settings:window.pokeidleLauncher.settings,saved,
    checkpoint:value=>{if(value)localStorage.setItem(key,JSON.stringify(value));else localStorage.removeItem(key);},report,
    send:message=>{if(socket?.readyState!==1)throw Error('offline');ownSend=true;try{socket.send(JSON.stringify(message));}finally{ownSend=false;}}
  });
  window.addEventListener('pokeidle-launcher-settings',event=>engine.configure(event.detail));
  const Native=window.WebSocket;
  function Wrapped(url,protocols){
    const ws=protocols===undefined?new Native(url):new Native(url,protocols);
    const target=new URL(String(url),location.href);
    if(target.host!==location.host)return ws;
    const originalSend=ws.send.bind(ws);
    ws.send=data=>{if(!ownSend&&engine.pending&&typeof data==='string'){try{if(JSON.parse(data).t==='shop.buy')engine.fail('Compras desativadas: compra manual concorrente.');}catch{}}return originalSend(data);};
    ws.addEventListener('message',event=>{
      if(typeof event.data!=='string')return;
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message.t==='welcome'){
        if(socket&&socket!==ws)engine.disconnect();socket=ws;
        const balls=(message.catalogoBolas||[]).filter(x=>x.compravel===true).map(x=>({kind:'ball',id:x.id,name:x.nome||x.name||'',price:x.priceGold}));
        engine.catalog=[...engine.catalog.filter(x=>x.kind==='item'),...balls];
      }
      if(socket!==ws)return;
      engine.observe(message);engine.tick();
      if(engine.snapshot){
        const ball=engine.catalog.find(x=>x.kind==='ball'&&x.name.toLowerCase().replace(/\s/g,'')==='ultraball');
        const potion=engine.catalog.find(x=>x.kind==='item'&&x.name==='Great Potion');
        if(ball&&potion)report({buyAvailable:true,
          ultraBallStock:engine.snapshot.balls?.[ball.id]??0,
          greatPotionStock:engine.snapshot.items?.[potion.id]??0});
      }
    });
    ws.addEventListener('close',()=>{if(socket===ws){engine.disconnect();socket=null;}});
    return ws;
  }
  Wrapped.prototype=Native.prototype;Object.setPrototypeOf(Wrapped,Native);window.WebSocket=Wrapped;
  // The same public catalog and price adjustments used by the game's NPC Market.
  Promise.all([fetch('/assets/items.json').then(r=>{if(!r.ok)throw Error();return r.json();}),
    import('/shared/venda-npc-item.mjs'),import('/shared/ajuste-item-espelho.mjs')
  ]).then(([catalog,normalizer,adjuster])=>{
    const items=catalog.items.map(x=>adjuster.ajustarItemEspelho(normalizer.normalizarNpcPriceItem(x)))
      .filter(x=>x.category==='heal'&&x.name==='Great Potion'&&x.npcPrice>0)
      .map(x=>({kind:'item',id:x.id,name:x.name,price:x.npcPrice}));
    engine.catalog=[...engine.catalog.filter(x=>x.kind==='ball'),...items];
  }).catch(()=>report({buyAvailable:false,automationStatus:'Compra indisponível: catálogo oficial não carregou.'}));
  setInterval(()=>{try{engine.tick();}catch{engine.blocked=true;report({buyBlocked:true,automationStatus:'Compras desativadas: erro interno.'});}},1000);
})();
