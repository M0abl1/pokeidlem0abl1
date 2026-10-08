const grid=document.getElementById('grid'),accounts=document.getElementById('accounts');
const configs=[];
let expanded=null;
let screenMode=1,visiblePair=[0,1],singleAccount=0;
document.getElementById('screen-mode').add(new Option('1 tela · outras ativas','1'));
const singlePicker=document.createElement('label');singlePicker.id='single-picker';singlePicker.hidden=true;
singlePicker.textContent='Jogar na conta ';
const singleSelect=document.createElement('select');singleSelect.id='screen-single';
for(let i=0;i<4;i++)singleSelect.add(new Option(`Treinador ${i+1}`,String(i)));
singlePicker.appendChild(singleSelect);document.querySelector('.view-controls').appendChild(singlePicker);
try{const saved=JSON.parse(localStorage.getItem('launcher-view-mode') || 'null');
  if([1,2,4].includes(saved?.mode))screenMode=saved.mode;
  if(Number.isInteger(saved?.single)&&saved.single>=0&&saved.single<4)singleAccount=saved.single;
  if(Array.isArray(saved?.pair)&&saved.pair.length===2&&saved.pair.every(i=>Number.isInteger(i)&&i>=0&&i<4)&&saved.pair[0]!==saved.pair[1])visiblePair=saved.pair;
}catch{}
for(let i=0;i<4;i++){
  const card=document.createElement('section');card.className='account';
  card.innerHTML=`<div class="account-title"><b>Treinador ${i+1}</b><span class="connection">Login pendente</span></div><p class="active">Ativo não identificado</p><p class="hunt">Aguardando dados da hunt</p><div class="metrics"><span>XP/min <b data-metric="xpPerMin">—</b></span><span>Gold/min <b data-metric="goldPerMin">—</b></span><span>Abates/min <b data-metric="killsPerMin">—</b></span></div><div class="actions"><button class="brave">Login no Brave</button><button class="reload">Recarregar</button></div><details><summary>Ferramentas desta conta</summary><div class="tools"><label><input type="checkbox" data-setting="autoHunts"> Trocar hunts medidas</label><label>Prioridade XP / gold<input type="range" min="0" max="100" step="10" data-setting="xpPriority"></label><output class="weight"></output><label><input type="checkbox" data-setting="autoCollection"> Proteger melhores na Coleção</label><label><input type="checkbox" data-setting="farmAlerts"> Avisar farm melhor</label><label>Melhoria mínima (%)<input type="number" min="1" max="1000" data-setting="alertThreshold"></label><button class="panel">Abrir analisador desta conta</button><button class="pause-account">Pausar esta conta</button><div class="pending">Ainda indisponíveis: captura, compras e vendas automáticas.</div></div></details><p class="error" aria-live="polite"></p>`;
  accounts.appendChild(card);
  const sizeControls=document.createElement('div');sizeControls.className='size-controls';
  sizeControls.innerHTML='<b>Tamanho desta tela</b><label>Largura <input type="range" min="30" max="100" step="5" data-setting="screenWidth"></label><label>Altura <input type="range" min="30" max="100" step="5" data-setting="screenHeight"></label><output class="size-value"></output><button class="reset-size">Restaurar tamanho</button><button class="expand-screen">Ampliar / voltar às quatro</button>';
  card.querySelector('.tools').appendChild(sizeControls);
  sizeControls.querySelector('.reset-size').onclick=()=>{configs[i]={...configs[i],screenWidth:100,screenHeight:100};showConfig(i);window.launcher.set(i,{screenWidth:100,screenHeight:100});};
  sizeControls.querySelector('.expand-screen').onclick=()=>{expanded=expanded===i?null:i;applySizes();};
  const localLogin=document.createElement('button');localLogin.textContent='Login no launcher';
  localLogin.onclick=()=>window.launcher.localLogin(i);card.querySelector('.actions').prepend(localLogin);
  const captureLabel=document.createElement('label');captureLabel.innerHTML='<input type="checkbox" data-setting="autoCapture"> Capturar todos · sem automação VIP';
  card.querySelector('.tools').prepend(captureLabel);
  const profileLabel=document.createElement('label');profileLabel.className='profile-toggle';profileLabel.innerHTML='<input type="checkbox" data-setting="enabled"> Perfil ativo · desligado não abre o jogo desta conta';
  card.querySelector('.tools').prepend(profileLabel);
  for(const [key,label] of [['autoBuyBalls','Repor Ultra Ball: abaixo de 100 compra 100'],['autoBuyPotions','Repor Great Potion: abaixo de 200 compra 200']]){
    const buyLabel=document.createElement('label');buyLabel.innerHTML=`<input type="checkbox" data-setting="${key}"> ${label}`;card.querySelector('.tools').prepend(buyLabel);
  }
  card.querySelector('.pending').textContent='Compras: lotes fixos, sem teto de gasto. Erro/timeout desativa a rotina; reative somente após conferir o estoque. Vendas automáticas indisponíveis.';
  const pane=document.createElement('section');pane.className='game-pane';
  pane.innerHTML=`<div class="window-bar"><b>Treinador ${i+1}</b><span><button class="zoom-out" aria-label="Diminuir zoom da conta ${i+1}">−</button><button class="zoom-in" aria-label="Aumentar zoom da conta ${i+1}">+</button><button class="reload">Recarregar</button><button class="tools-button">Ferramentas</button></span></div><div class="viewport"></div>`;grid.appendChild(pane);
  for(const input of card.querySelectorAll('[data-setting]')){
    input.addEventListener(input.type==='range'?'input':'change',()=>{
      if(!configs[i])return;
      const key=input.dataset.setting;
      const value=input.type==='checkbox'?input.checked:Number(input.value);
      configs[i]={...configs[i],[key]:value};showConfig(i);window.launcher.set(i,{[key]:value});
    });
  }
  card.querySelector('.brave').textContent='Login Google · navegador';
  card.querySelector('.brave').onclick=()=>window.launcher.brave(i);
  for(const node of [card,pane])node.querySelector('.reload').onclick=()=>window.launcher.reload(i);
  card.querySelector('.panel').onclick=()=>window.launcher.panel(i);
  card.querySelector('.pause-account').onclick=()=>{
    const flags={autoHunts:false,autoCollection:false,farmAlerts:false,autoCapture:false,autoBuyBalls:false,autoBuyPotions:false};
    configs[i]={...configs[i],...flags};showConfig(i);window.launcher.set(i,flags);
  };
  pane.querySelector('.zoom-out').onclick=()=>window.launcher.zoom(i,-1);
  pane.querySelector('.zoom-in').onclick=()=>window.launcher.zoom(i,1);
  pane.querySelector('.tools-button').onclick=()=>{card.querySelector('details').open=true;card.scrollIntoView({block:'nearest'});};
}
function showConfig(i){
  const card=accounts.children[i],config=configs[i];
  for(const input of card.querySelectorAll('[data-setting]')){const value=config[input.dataset.setting];if(input.type==='checkbox')input.checked=value;else input.value=value;}
  card.classList.toggle('disabled',config.enabled===false);
  card.querySelector('.weight').textContent=`XP ${config.xpPriority}% / Gold ${100-config.xpPriority}%`;
  card.querySelector('.size-value').textContent=`Largura ${config.screenWidth}% · Altura ${config.screenHeight}%`;
  applySizes();
}
function applySizes(){
  document.body.classList.toggle('single-view',screenMode===1&&expanded===null);
  document.body.classList.toggle('two-view',screenMode===2&&expanded===null);
  grid.classList.toggle('expanded',expanded!==null);
  grid.classList.toggle('two',screenMode===2);
  grid.classList.toggle('single',screenMode===1);
  [...grid.children].forEach((pane,i)=>{
    pane.hidden=configs[i]?.enabled===false||(expanded!==null?expanded!==i:screenMode===1?singleAccount!==i:screenMode===2&&!visiblePair.includes(i));
    pane.style.width=`${expanded===i||screenMode===1?100:configs[i]?.screenWidth || 100}%`;
    pane.style.height=`${expanded===i||screenMode===1?100:configs[i]?.screenHeight || 100}%`;
  });
  requestAnimationFrame(layout);
}
function changeView(changed){
  const mode=Number(document.getElementById('screen-mode').value);
  screenMode=[1,2,4].includes(mode)?mode:4;
  singleAccount=Number(singleSelect.value);
  singlePicker.hidden=screenMode!==1;
  visiblePair=[Number(document.getElementById('screen-a').value),Number(document.getElementById('screen-b').value)];
  if(visiblePair[0]===visiblePair[1]){
    const replace=changed==='screen-b'?0:1;
    visiblePair[replace]=[0,1,2,3].find(i=>i!==visiblePair[1-replace]);
  }
  document.getElementById('screen-a').value=visiblePair[0];document.getElementById('screen-b').value=visiblePair[1];
  document.getElementById('pair-picker').hidden=screenMode!==2;
  expanded=null;
  try{localStorage.setItem('launcher-view-mode',JSON.stringify({mode:screenMode,pair:visiblePair,single:singleAccount}));}catch{}
  applySizes();
}
document.getElementById('screen-mode').value=screenMode;
singleSelect.value=singleAccount;singlePicker.hidden=screenMode!==1;
singleSelect.addEventListener('change',()=>changeView('screen-single'));
document.getElementById('screen-a').value=visiblePair[0];document.getElementById('screen-b').value=visiblePair[1];
document.getElementById('pair-picker').hidden=screenMode!==2;
for(const id of ['screen-mode','screen-a','screen-b'])document.getElementById(id).addEventListener('change',()=>changeView(id));
applySizes();
// Remote panel: show only the trainer selected in the web dashboard.
window.launcher.onFocus(i=>{if(!Number.isInteger(i)||i<0||i>3)return;document.getElementById('screen-mode').value='1';singleSelect.value=String(i);changeView('screen-single');});
function showSettings(values){if(!values)return;values.forEach((s,i)=>{configs[i]=s;showConfig(i);});}
window.launcher.get().then(showSettings);window.launcher.onRefresh(showSettings);
window.launcher.onError((i,message)=>{accounts.children[i].querySelector('.error').textContent=message;});
window.launcher.onStatus((i,value)=>{
  const card=accounts.children[i];
  if(value.diagnostic)card.querySelector('.error').textContent=value.diagnostic;
  for(const key of ['connection','active','hunt'])if(value[key])card.querySelector(`.${key}`).textContent=value[key];
  for(const key of ['xpPerMin','goldPerMin','killsPerMin'])card.querySelector(`[data-metric="${key}"]`).textContent=Number.isFinite(value[key])?value[key].toLocaleString('pt-BR',{maximumFractionDigits:1}):'—';
});
function layout(){window.launcher.bounds([...document.querySelectorAll('.viewport')].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,visible:r.width>0 && r.height>0};}));}
new ResizeObserver(layout).observe(grid);window.addEventListener('resize',layout);requestAnimationFrame(layout);
for(const pane of grid.children)new ResizeObserver(layout).observe(pane);
document.getElementById('pause').onclick=()=>window.launcher.pause();
