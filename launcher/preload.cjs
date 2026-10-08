const {contextBridge,ipcRenderer}=require('electron');
// No filesystem API, passwords, tokens or general IPC are exposed to the game.
const selfTest=process.argv.includes('--launcher-self-test') && location.protocol==='file:';
if(selfTest || (location.origin==='https://pokeidle.io' && location.pathname.startsWith('/app'))){
  const boot=ipcRenderer.sendSync('launcher:boot');
  if(boot){
    contextBridge.exposeInMainWorld('pokeidleLauncher',{settings:boot.settings,huntReference:boot.reference,report:value=>ipcRenderer.send('launcher:status',value),captures:list=>ipcRenderer.send('launcher:captures',list)});
    if(typeof contextBridge.executeInMainWorld==='function'){
      contextBridge.executeInMainWorld({func:new Function(boot.script)});
      ipcRenderer.on('launcher:settings',(_event,settings)=>contextBridge.executeInMainWorld({
        func:(detail)=>window.dispatchEvent(new CustomEvent('pokeidle-launcher-settings',{detail})),args:[settings]
      }));
      ipcRenderer.on('launcher:action',(_event,action)=>contextBridge.executeInMainWorld({
        func:detail=>window.dispatchEvent(new CustomEvent('pokeidle-launcher-action',{detail})),args:[action]
      }));
    }else console.error('Electron precisa oferecer contextBridge.executeInMainWorld; atualize a dependência.');
  }
}
