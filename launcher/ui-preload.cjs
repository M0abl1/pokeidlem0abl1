const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('launcher',{
  get:()=>ipcRenderer.invoke('launcher:get'),
  set:(i,value)=>ipcRenderer.send('launcher:set',i,value),
  reload:i=>ipcRenderer.send('launcher:reload',i),
  brave:i=>ipcRenderer.send('launcher:brave',i),
  localLogin:i=>ipcRenderer.send('launcher:local-login',i),
  panel:i=>ipcRenderer.send('launcher:panel',i),
  zoom:(i,amount)=>ipcRenderer.send('launcher:zoom',i,amount),
  pause:()=>ipcRenderer.send('launcher:pause'),
  bounds:rects=>ipcRenderer.send('launcher:bounds',rects),
  onRefresh:fn=>ipcRenderer.on('launcher:refresh',(_e,value)=>fn(value)),
  onError:fn=>ipcRenderer.on('launcher:error',(_e,i,message)=>fn(i,message))
  ,onFocus:fn=>ipcRenderer.on('launcher:focus',(_e,i)=>fn(i))
  ,onStatus:fn=>ipcRenderer.on('launcher:status',(_e,i,value)=>fn(i,value))
});
