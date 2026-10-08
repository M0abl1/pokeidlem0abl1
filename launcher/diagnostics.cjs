'use strict';
// No URL, console content, error description, DOM text or session data is retained.
const reasons=new Set(['clean-exit','abnormal-exit','killed','crashed','oom','launch-failed','integrity-failure']);
function attachDiagnostics(wc,publish,{interval=15000,onStalled=()=>{},now=Date.now}={}){
 let state={load:'iniciando',consoleErrors:0},busy=false,failures=0,lastRecovery=-Infinity;
 const emit=()=>publish({diagnostic:`Página: ${state.load}; erros JS: ${state.consoleErrors}${state.dom?`; DOM: ${state.dom}`:''}`});
 wc.on('did-start-loading',()=>{state.load='carregando';state.dom='';emit();});
 wc.on('did-finish-load',()=>{state.load='carregada';emit();});
 wc.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{
  if(code===-3||isMainFrame===false)return;
  state.load=`falha de rede (${Number.isInteger(code)?code:0})`;emit();
 });
 wc.on('render-process-gone',(_event,details)=>{state.load=`processo encerrado (${reasons.has(details.reason)?details.reason:'desconhecido'})`;state.dom='';emit();});
 wc.on('unresponsive',()=>{state.load='sem resposta';emit();});
 wc.on('responsive',()=>{state.load='respondendo';emit();});
 wc.on('console-message',(_event,...args)=>{
  const level=typeof args[0]==='object'?args[0]?.level:args[0];
  if(level===3||level==='error'){state.consoleErrors=Math.min(9999,state.consoleErrors+1);emit();}
 });
 const timer=setInterval(async()=>{
  if(busy||wc.isDestroyed())return;
  busy=true;let timeout;
  try{
   const result=await Promise.race([
    wc.executeJavaScript("({ready:document.readyState,empty:!document.body||document.body.children.length===0,loginVisible:!!document.querySelector('#login:not(.hidden)'),canvas:!!document.querySelector('canvas')})"),
    new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error()),3000);})
   ]);
   failures=0;state.dom=result.empty?'vazio':result.loginVisible?'login visível':result.canvas?'conteúdo e canvas presentes':'conteúdo presente';emit();
  }catch{state.dom='inspeção sem resposta';emit();if(++failures>=3&&now()-lastRecovery>=300000){lastRecovery=now();failures=0;onStalled();}}
  finally{clearTimeout(timeout);busy=false;}
 },interval);timer.unref?.();wc.once('destroyed',()=>clearInterval(timer));return {snapshot:()=>({...state}),close:()=>clearInterval(timer)};
}
module.exports={attachDiagnostics};
