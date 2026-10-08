const {app,BrowserWindow,WebContentsView,ipcMain,session,dialog,clipboard}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {localMode,startLocalPanel}=require('./local.cjs');
// Local version: separate app data and game sessions, never the remote server's accounts.
if(localMode){app.setName('PokeIdle Local');app.setPath('userData',path.join(app.getPath('appData'),'PokeIdle Local'));}
// Xvfb has no physical GPU: avoid GPU/decoder initialization failures in the remote runtime.
if(process.env.POKEIDLE_SERVER_RUNTIME==='1'){
  app.disableHardwareAcceleration();
  // Hidden trainer views must keep servicing capture timers and socket messages.
  for(const flag of ['disable-background-timer-throttling','disable-renderer-backgrounding','disable-backgrounding-occluded-windows'])app.commandLine.appendSwitch(flag);
}
const {openBraveLogin}=require('./brave.cjs');
const {createLoginBridge}=require('./login-bridge.cjs');
const {normalizeSettings:normalizeCore,defaults:coreDefaults}=require('../common/settings.cjs');
const {startServerAgent}=require('./server-agent.cjs');
const {attachDiagnostics}=require('./diagnostics.cjs');
let loginBridge;
let serverAgent;
let win,settingsPath;
const selfTest=process.argv.includes('--self-test');
const defaults={...coreDefaults,screenWidth:100,screenHeight:100};
function normalizeSettings(value={}){return {...normalizeCore(value),
  screenWidth:Number.isFinite(Number(value.screenWidth))?Math.max(30,Math.min(100,Number(value.screenWidth))):100,
  screenHeight:Number.isFinite(Number(value.screenHeight))?Math.max(30,Math.min(100,Number(value.screenHeight))):100
};}
const views=[],settings=Array.from({length:4},()=>({...defaults}));
const loginWindows=new Map();
// 'on' | 'off' per view; a disabled profile keeps its saved login but its game page is unloaded.
const profileState=[];
function applyProfile(i){
  const view=views[i];if(selfTest||!view||view.webContents.isDestroyed())return;
  const next=settings[i].enabled===false?'off':'on';if(profileState[i]===next)return;profileState[i]=next;
  if(next==='on'){view.webContents.loadURL('https://pokeidle.io/app').catch(()=>{});return;}
  view.webContents.loadURL('about:blank').catch(()=>{});
  const status={connection:'Perfil desativado',automationStatus:'',captureStatus:''};
  if(win&&!win.isDestroyed())win.webContents.send('launcher:status',i,status);
  serverAgent?.report(i,status);
}
const updateRecovery=Array.from({length:4},()=>({checking:false,lastAttempt:0}));
function reportDiagnostic(i,diagnostic){
  if(win&&!win.isDestroyed())win.webContents.send('launcher:status',i,{diagnostic});
  serverAgent?.report(i,{diagnostic});
}
function checkGameUpdate(i,wc){
  const recovery=updateRecovery[i];
  if(!recovery||recovery.checking||wc.isDestroyed())return;
  recovery.checking=true;
  setTimeout(async()=>{
    try{
      if(wc.isDestroyed()||!wc.getURL().startsWith('https://pokeidle.io/app'))return;
      const updatePending=await wc.executeJavaScript(`(()=>{
        const text=document.body?.innerText||'';
        return /new version available|nova vers[aã]o dispon[ií]vel/i.test(text)&&/reloading|recarregando/i.test(text);
      })()`);
      if(!updatePending){recovery.lastAttempt=0;return;}
      const now=Date.now();
      if(now-recovery.lastAttempt<120000){
        reportDiagnostic(i,'Atualização do jogo ainda pendente; recuperação automática limitada para evitar loop.');
        return;
      }
      recovery.lastAttempt=now;
      reportDiagnostic(i,'Atualização do jogo detectada: limpando cache desta conta e recarregando uma vez.');
      await wc.session.clearCache();
      if(!wc.isDestroyed())wc.reloadIgnoringCache();
    }catch{/* A página pode estar navegando; a próxima carga será verificada. */}
    finally{recovery.checking=false;}
  },1500);
}
async function loginInside(i){
  if(loginWindows.has(i)){loginWindows.get(i).focus();return;}
  const wc=views[i].webContents;
  const existing=await wc.executeJavaScript("!!localStorage.getItem('sessao')");
  if(existing){
    const choice=await dialog.showMessageBox(win,{type:'question',buttons:['Manter login atual','Trocar conta','Cancelar'],defaultId:0,cancelId:2,message:`Treinador ${i+1} já tem uma sessão salva.`,detail:'Trocar conta encerra somente o login desta tela. Pokémon, itens e as demais contas não são apagados.'});
    if(choice.response!==1){if(choice.response===0)wc.reload();return;}
  }
  settings[i]={...settings[i],autoHunts:false,autoCapture:false,autoBuyBalls:false,autoBuyPotions:false};persist();pushSettings(i);win.webContents.send('launcher:refresh',settings);
  if(existing)await wc.executeJavaScript("localStorage.removeItem('sessao')");
  await wc.loadURL('https://pokeidle.io/app');
  const auth=new BrowserWindow({parent:win,width:850,height:800,title:`Login PokeIdle — Treinador ${i+1}`,webPreferences:{session:wc.session,contextIsolation:true,nodeIntegration:false,sandbox:true}});
  loginWindows.set(i,auth);auth.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  let done=false;
  const timer=setInterval(async()=>{
    if(done||auth.isDestroyed()||!auth.webContents.getURL().startsWith('https://pokeidle.io/app'))return;
    try{
      const ready=await auth.webContents.executeJavaScript("!!localStorage.getItem('sessao') && document.querySelector('#login')?.classList.contains('hidden') === true");
      if(ready){done=true;auth.close();}
    }catch{/* Navigation in progress: no credentials are read or logged. */}
  },1000);
  auth.on('closed',()=>{clearInterval(timer);loginWindows.delete(i);if(!wc.isDestroyed())wc.reload();if(win&&!win.isDestroyed()){win.show();win.focus();win.webContents.send('launcher:error',i,done?'Login concluído no launcher. Confira a conta antes de reativar automações.':'Janela de login fechada.');}});
  await auth.loadURL('https://pokeidle.io/app');
}
ipcMain.on('launcher:local-login',(e,i)=>{if(isUI(e)&&Number.isInteger(i)&&i>=0&&i<4)loginInside(i).catch(()=>win&&!win.isDestroyed()&&win.webContents.send('launcher:error',i,'Não foi possível abrir o login. Tente novamente.'));});
const uiFile=path.join(__dirname,'index.html');
function isUI(e){return win && e.sender===win.webContents && e.senderFrame===win.webContents.mainFrame;}
function gameIndex(e){return views.findIndex(v=>v.webContents===e.sender && e.senderFrame===v.webContents.mainFrame);}
function persist(){if(!selfTest)fs.writeFileSync(settingsPath,JSON.stringify(settings,null,2));}
function pushSettings(i){
  const wc=views[i]?.webContents;
  if(wc && !wc.isDestroyed() && (selfTest || wc.getURL().startsWith('https://pokeidle.io/app'))) wc.send('launcher:settings',settings[i]);
}
ipcMain.on('launcher:boot',(e)=>{
  const i=gameIndex(e);
  if(i<0){e.returnValue=null;return;}
  const script=fs.readFileSync(path.join(__dirname,'..','common','hunt-model.cjs'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'..','pokeidle-party-depot-analyzer.user.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'..','common','auto-buy.cjs'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'buy-adapter.js'),'utf8');
  e.returnValue={settings:settings[i],reference:null,script};
});
ipcMain.handle('launcher:get',(e)=>isUI(e)?settings:null);
ipcMain.on('launcher:set',(e,i,value)=>{
  if(!isUI(e)||!Number.isInteger(i)||i<0||i>=4||!value) return;
  if(process.env.POKEIDLE_CONTROL_URL){serverAgent?.update(i,value).catch(()=>win.webContents.send('launcher:error',i,'Servidor não confirmou a alteração. Confira a conexão do painel.'));return;}
  settings[i]=normalizeSettings({...settings[i],...value});
  persist();pushSettings(i);applyProfile(i);
});
ipcMain.on('launcher:reload',(e,i)=>{if(isUI(e)&&Number.isInteger(i)&&i>=0&&i<4)views[i].webContents.reload();});
ipcMain.on('launcher:panel',(e,i)=>{if(isUI(e)&&Number.isInteger(i)&&i>=0&&i<4)views[i].webContents.send('launcher:action','open');});
ipcMain.on('launcher:zoom',(e,i,amount)=>{if(isUI(e)&&Number.isInteger(i)&&i>=0&&i<4&&[-1,1].includes(amount)){const wc=views[i].webContents;wc.setZoomFactor(Math.max(.4,Math.min(1.5,wc.getZoomFactor()+amount*.1)));}});
ipcMain.on('launcher:status',(e,value)=>{
  const i=gameIndex(e);if(i<0||!value||!win||win.isDestroyed())return;
  const clean={};
  for(const key of ['active','hunt','connection','automationStatus','captureStatus'])if(typeof value[key]==='string')clean[key]=value[key].slice(0,160);
  for(const key of ['buyBlocked','buyAvailable','buyConfirmed'])if(typeof value[key]==='boolean')clean[key]=value[key];
  for(const key of ['ultraBallStock','greatPotionStock','captureTargets'])if(Number.isSafeInteger(value[key])&&value[key]>=0)clean[key]=value[key];
  if(clean.buyBlocked){settings[i].autoBuyBalls=false;settings[i].autoBuyPotions=false;persist();pushSettings(i);}
  for(const key of ['xpPerMin','goldPerMin','killsPerMin'])if(Number.isFinite(value[key])&&value[key]>=0)clean[key]=value[key];
  win.webContents.send('launcher:status',i,clean);
  serverAgent?.report(i,clean);
});
ipcMain.on('launcher:captures',(e,list)=>{
  const i=gameIndex(e);if(i<0||!Array.isArray(list))return;
  // Server sanitizes every field; only forward a bounded batch of plain objects.
  serverAgent?.captures(i,list.slice(0,50).filter(p=>p&&typeof p==='object'));
});
function loginInBrave(i){
  if(localMode){win.webContents.send('launcher:error',i,'Na versão local use "Login no launcher".');return;}
  try{
    const pair=loginBridge.authorize(i);
    settings[i]={...settings[i],autoHunts:false,autoCapture:false,autoBuyBalls:false,autoBuyPotions:false};persist();pushSettings(i);
    win.webContents.send('launcher:refresh',settings);
    if(process.env.POKEIDLE_SERVER_RUNTIME!=='1')openBraveLogin(i,app.getPath('userData'),{pair});
    win.webContents.send('launcher:error',i,'No navegador externo, entre com Google no PokeIdle e confirme na extensão “Login para Launcher”. Autorização válida por cinco minutos; automações pausadas.');
    if(process.env.POKEIDLE_LOGIN_PORT){
      dialog.showMessageBox(win,{type:'info',buttons:['Fechar','Copiar autorização para notebook'],defaultId:0,message:'Login Google externo autorizado',detail:'Com o túnel SSH ativo no notebook, copie a autorização e abra no navegador que possui a extensão. Ela expira em cinco minutos.'}).then(({response})=>{
        if(response===1)clipboard.writeText(`https://pokeidle.io/app#launcher-bridge=${pair.port}.${pair.nonce}.${i}`);
      });
    }
  }catch(error){win.webContents.send('launcher:error',i,error.message);}
}
ipcMain.on('launcher:brave',(e,i)=>{if(isUI(e)&&Number.isInteger(i)&&i>=0&&i<4)loginInBrave(i);});
ipcMain.on('launcher:pause',(e)=>{if(!isUI(e))return;settings.forEach((s,i)=>{s.autoHunts=false;s.autoCapture=false;s.autoBuyBalls=false;s.autoBuyPotions=false;pushSettings(i);});persist();win.webContents.send('launcher:refresh',settings);});
ipcMain.on('launcher:bounds',(e,bounds)=>{
  if(!isUI(e)||!Array.isArray(bounds)||bounds.length!==4)return;
  const [width,height]=win.getContentSize();
  bounds.forEach((b,i)=>{
    if(!['x','y','width','height'].every(k=>Number.isFinite(b[k])))return;
    views[i].setVisible(b.visible!==false);
    const x=Math.max(0,Math.min(width,Math.round(b.x))),y=Math.max(0,Math.min(height,Math.round(b.y)));
    views[i].setBounds({x,y,width:Math.max(1,Math.min(width-x,Math.round(b.width))),height:Math.max(1,Math.min(height-y,Math.round(b.height)))});
  });
});
app.whenReady().then(async()=>{
  settingsPath=path.join(app.getPath('userData'),'priorities.json');
  try{if(!selfTest){const saved=JSON.parse(fs.readFileSync(settingsPath,'utf8'));saved.slice(0,4).forEach((s,i)=>{settings[i]=normalizeSettings(s);});}}catch{}
  const remoteHD=process.env.POKEIDLE_SERVER_RUNTIME==='1';
  win=new BrowserWindow({show:!selfTest,width:remoteHD?1920:1500,height:remoteHD?1080:1000,autoHideMenuBar:remoteHD,minWidth:900,minHeight:650,backgroundColor:'#101b26',webPreferences:{preload:path.join(__dirname,'ui-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  if(remoteHD&&!selfTest)win.maximize();
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  for(let i=0;i<4;i++){
    const ses=session.fromPartition(`persist:${localMode?'pokeidle-local':'pokeidle'}-account-${i+1}`);
    ses.setPermissionRequestHandler((_wc,permission,callback)=>callback(permission==='notifications'));
    const view=new WebContentsView({webPreferences:{session:ses,preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,additionalArguments:selfTest?['--launcher-self-test']:[]}});
    views.push(view);win.contentView.addChildView(view);
    view.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    view.webContents.on('will-navigate',(event,url)=>{
      try{
        const destination=new URL(url);
        if(destination.origin!=='https://pokeidle.io')event.preventDefault();
      }catch{event.preventDefault();}
    });
    view.webContents.on('did-finish-load',()=>{pushSettings(i);checkGameUpdate(i,view.webContents);});
    attachDiagnostics(view.webContents,status=>{
      if(profileState[i]==='off')return;
      if(win&&!win.isDestroyed())win.webContents.send('launcher:status',i,status);
      serverAgent?.report(i,status);
      if(!selfTest)console.log(`Treinador ${i+1}: ${status.diagnostic}`);
    },{onStalled:()=>{
      if(selfTest||profileState[i]==='off'||view.webContents.isDestroyed())return;
      serverAgent?.report(i,{diagnostic:'Tela sem resposta em 3 verificações: recuperando apenas esta conta.'});
      // End the stuck renderer only, preserving the persistent session and other trainers.
      view.webContents.once('render-process-gone',()=>setTimeout(()=>{
        if(!view.webContents.isDestroyed())view.webContents.reload();
      },250));
      view.webContents.forcefullyCrashRenderer();
    }});
  }
  await win.loadFile(uiFile);
  // Must run before the agent starts: it sets POKEIDLE_CONTROL_URL to the in-process panel.
  const localPanel=localMode&&!selfTest?await startLocalPanel(path.join(app.getPath('userData'),'panel-data')):null;
  if(localPanel)win.setTitle('PokeIdle Local — Jogos');
  // Opt-in migration bridge. Keep this secret in the service environment, never in UI settings.
  serverAgent=startServerAgent({baseUrl:process.env.POKEIDLE_CONTROL_URL,token:process.env.POKEIDLE_AGENT_TOKEN,accountCount:4,onLogin:i=>{if(!loginBridge)throw Error('Login por extensão indisponível');return loginBridge.authorize(i);},onFocus:(i,raise)=>{if(Number.isInteger(i)&&i>=0&&i<4&&win&&!win.isDestroyed()){win.webContents.send('launcher:focus',i);if(raise){win.show();win.focus();}}},
    onLocalLogin:i=>{if(Number.isInteger(i)&&i>=0&&i<4&&settings[i].enabled!==false)loginInside(i).catch(()=>win&&!win.isDestroyed()&&win.webContents.send('launcher:error',i,'Não foi possível abrir o login. Tente novamente.'));},
    onSettings:(i,value)=>{
    if(Number.isInteger(i)&&i>=0&&i<4){settings[i]=normalizeSettings({...settings[i],...value});persist();pushSettings(i);applyProfile(i);win.webContents.send('launcher:refresh',settings);}
  }});
  if(localPanel){
    const panelSession=session.fromPartition('pokeidle-local-panel');
    await panelSession.cookies.set({url:localPanel.url,name:'pi_session',value:localPanel.cookie,httpOnly:true,sameSite:'strict'});
    const panelWin=new BrowserWindow({width:1500,height:950,minWidth:900,minHeight:650,title:'PokeIdle Local',backgroundColor:'#070d1a',autoHideMenuBar:true,webPreferences:{session:panelSession,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    panelWin.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    panelWin.webContents.on('will-navigate',(event,url)=>{try{if(new URL(url).origin!==new URL(localPanel.url).origin)event.preventDefault();}catch{event.preventDefault();}});
    panelWin.on('closed',()=>app.quit());win.on('closed',()=>app.quit());
    await panelWin.loadURL(localPanel.url+'/');
  }
  if(!selfTest&&!localMode){
    loginBridge=createLoginBridge(async(i,credential)=>{
      const wc=views[i].webContents;
      if(wc.isDestroyed())throw Error('Destino fechado');
      if(!wc.getURL().startsWith('https://pokeidle.io/app'))await wc.loadURL('https://pokeidle.io/app');
      const code=`(async (session)=>{
        const response=await fetch('/auth/conta',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:session.token}),credentials:'omit',signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw new Error('Sessão não aceita pelo jogo');
        const account=await response.json();
        if(account.precisaNick)throw new Error('Conclua o cadastro no Brave antes de enviar');
        const value={nick:account.nick || session.nick,token:account.tokenNovo || session.token};
        localStorage.setItem('sessao',JSON.stringify(value));localStorage.setItem('nick',value.nick);
        return true;
      })(${JSON.stringify(credential)})`;
      await wc.executeJavaScript(code);
      await wc.loadURL('https://pokeidle.io/app');
      win.webContents.send('launcher:error',i,'Sessão validada e importada. Automações permanecem pausadas; ative-as quando desejar.');
      win.show();win.focus();
    },{listenPort:Number(process.env.POKEIDLE_LOGIN_PORT||0),listenHost:process.env.POKEIDLE_SERVER_RUNTIME==='1'?'0.0.0.0':'127.0.0.1'});
    await loginBridge.start();
  }
  if(selfTest){
    try{
      await Promise.all(views.map(v=>v.webContents.loadFile(path.join(__dirname,'test.html'))));
      const results=await Promise.all(views.map(v=>v.webContents.executeJavaScript("({panel:!!document.querySelector('[data-role=auto-hunts]'),priority:document.querySelector('[data-role=xp-priority]')?.value,node:typeof require})")));
      if(results.some(r=>!r.panel||r.priority!=='100'||r.node!=='undefined'))throw new Error(JSON.stringify(results));
      const sessions=new Set(views.map(v=>v.webContents.session));
      if(sessions.size!==4)throw new Error('Sessions not isolated');
      await Promise.all(views.map((v,i)=>v.webContents.executeJavaScript(`localStorage.setItem('launcher-self-test', '${i}')`)));
      const storage=await Promise.all(views.map(v=>v.webContents.executeJavaScript("localStorage.getItem('launcher-self-test')")));
      if(storage.some((s,i)=>s!==String(i)))throw new Error('Storage leaked across sessions');
      await views[0].webContents.executeJavaScript("window.__settingTest=new Promise(resolve => window.addEventListener('pokeidle-launcher-settings', e => setTimeout(() => resolve(document.querySelector('[data-role=xp-priority]').value), 0), {once:true})); true");
      settings[0]=normalizeSettings({autoHunts:false});pushSettings(0);
      if(await views[0].webContents.executeJavaScript('window.__settingTest')!=='100')throw new Error('XP priority was not kept fixed');
      await win.webContents.executeJavaScript("document.getElementById('screen-mode').value='4';document.getElementById('screen-mode').dispatchEvent(new Event('change'));layout(); true");
      await new Promise(resolve=>setTimeout(resolve,100));
      const boundsBefore=views.map(v=>v.getBounds());
      await win.webContents.executeJavaScript("const widthControl=document.querySelector('#accounts [data-setting=screenWidth]');widthControl.value='50';widthControl.dispatchEvent(new Event('input'));layout(); true");
      await new Promise(resolve=>setTimeout(resolve,100));
      if(!(views[0].getBounds().width<boundsBefore[0].width)||views[1].getBounds().width!==boundsBefore[1].width||settings[0].screenWidth!==50)throw new Error('Individual size controls failed');
      await win.webContents.executeJavaScript("document.querySelector('#accounts .expand-screen').click();layout();true");
      await new Promise(resolve=>setTimeout(resolve,100));
      if(!(views[0].getBounds().width>boundsBefore[0].width))throw new Error('Expand screen failed');
      await win.webContents.executeJavaScript("document.querySelector('#accounts .expand-screen').click();document.querySelector('#accounts .reset-size').click();layout();true");
      await win.webContents.executeJavaScript("const mode=document.getElementById('screen-mode');mode.value='2';mode.dispatchEvent(new Event('change'));layout();true");
      await new Promise(resolve=>setTimeout(resolve,100));
      const two=await win.webContents.executeJavaScript("[...document.querySelectorAll('.game-pane')].filter(p=>!p.hidden).length");
      if(two!==2)throw new Error('Two-screen mode failed');
      if(!await win.webContents.executeJavaScript("document.body.classList.contains('two-view') && getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns.startsWith('220px')"))throw new Error('Two-screen compact layout failed');
      await win.webContents.executeJavaScript("const a=document.getElementById('screen-a'),b=document.getElementById('screen-b');a.value='2';a.dispatchEvent(new Event('change'));b.value='3';b.dispatchEvent(new Event('change'));layout();true");
      const pair=await win.webContents.executeJavaScript("[...document.querySelectorAll('.game-pane')].map((p,i)=>p.hidden?null:i).filter(i=>i!==null)");
      if(JSON.stringify(pair)!=='[2,3]')throw new Error('Visible pair selection failed');
      const settingsBeforeSingle=JSON.stringify(settings);
      await win.webContents.executeJavaScript("document.getElementById('screen-mode').value='1';document.getElementById('screen-mode').dispatchEvent(new Event('change'));document.getElementById('screen-single').value='1';document.getElementById('screen-single').dispatchEvent(new Event('change'));layout();true");
      await new Promise(resolve=>setTimeout(resolve,100));
      const single=await win.webContents.executeJavaScript("[...document.querySelectorAll('.game-pane')].map((p,i)=>p.hidden?null:i).filter(i=>i!==null)");
      if(JSON.stringify(single)!=='[1]')throw new Error('Single-screen selection failed');
      if(JSON.stringify(settings)!==settingsBeforeSingle)throw new Error('View selection changed automation settings');
      for(const view of views){
        if(view.webContents.isDestroyed()||view.webContents.getBackgroundThrottling())throw new Error('Background account inactive');
        if(await view.webContents.executeJavaScript('1+1')!==2)throw new Error('Hidden account stopped');
      }
      await win.webContents.executeJavaScript("document.getElementById('screen-mode').value='4';document.getElementById('screen-mode').dispatchEvent(new Event('change'));layout();true");
      if(await win.webContents.executeJavaScript("[...document.querySelectorAll('.game-pane')].filter(p=>!p.hidden).length")!==4)throw new Error('Four-screen restore failed');
      if(process.argv.includes('--preview')){
        await win.webContents.executeJavaScript("document.querySelector('#accounts details').open=true");
        await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const capture=await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname,'..','..','..','work','launcher-tools-preview.png'),capture.toPNG());
      }
      console.log('OK: four isolated sessions, sandbox preloads, main-world injection, farm controls and no Node in game.');
      app.exit(0);
    }catch(error){console.error(error);app.exit(1);}
    return;
  }
  views.forEach((_view,i)=>applyProfile(i));
  win.on('closed',()=>{views.forEach(v=>{if(!v.webContents.isDestroyed())v.webContents.close();});win=null;});
});
app.on('window-all-closed',()=>{if(loginBridge)loginBridge.close();serverAgent?.close();app.quit();});
