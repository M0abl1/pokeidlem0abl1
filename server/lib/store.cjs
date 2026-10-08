'use strict';
const fs=require('node:fs'),path=require('node:path');
const {defaults,normalizeSettings,pauseSettings}=require('../../common/settings.cjs');
const safeStatus=value=>{
  const clean={updatedAt:new Date().toISOString()};
  for(const key of ['active','hunt','connection','automationStatus','diagnostic','captureStatus'])if(typeof value?.[key]==='string')clean[key]=value[key].slice(0,160);
  for(const key of ['xpPerMin','goldPerMin','killsPerMin'])if(Number.isFinite(value?.[key])&&value[key]>=0)clean[key]=value[key];
  for(const key of ['buyBlocked','buyAvailable'])if(typeof value?.[key]==='boolean')clean[key]=value[key];
  for(const key of ['ultraBallStock','greatPotionStock','captureTargets'])if(Number.isSafeInteger(value?.[key])&&value[key]>=0)clean[key]=value[key];
  return clean;
};
const IV_KEYS=['hp','atk','def','spAtk','spDef','spd'];
const text=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const finite=v=>Number.isFinite(v)?v:null;
const int=(v,max)=>Number.isInteger(v)&&v>=0&&v<=max?v:null;
const safeCapture=(account,v)=>{
  if(!v||typeof v!=='object')return null;
  const id=String(v.id??''),species=text(v.species,40);
  if(!/^[\w-]{1,40}$/.test(id)||!species)return null;
  const ivs={};for(const k of IV_KEYS)ivs[k]=int(v.ivs?.[k],64);
  return {account,id,species,level:int(v.level,10000),p:typeof v.p==='string'&&/^P\d{1,2}$/.test(v.p)?v.p:null,quality:finite(v.quality),ivTotal:int(v.ivTotal,400),ivs,
    score:finite(v.score),gameScore:finite(v.gameScore),shiny:v.shiny===true,profile:text(v.profile,40),hunt:text(v.hunt,80),at:new Date().toISOString()};
};
class Store {
  constructor(dataDir,accountCount=4){if(!Number.isInteger(accountCount)||accountCount<1||accountCount>32)throw Error('Quantidade de contas inválida');this.file=path.join(dataDir,'state.json');this.capturesFile=path.join(dataDir,'captures.json');this.data={accounts:[],logs:[]};fs.mkdirSync(dataDir,{recursive:true});this.load(accountCount);this.captures=this.loadCaptures();}
  load(count){try{const parsed=JSON.parse(fs.readFileSync(this.file,'utf8'));if(Array.isArray(parsed.accounts))this.data=parsed;}catch{} for(let i=this.data.accounts.length;i<count;i++)this.data.accounts.push({id:i,name:`Treinador ${i+1}`,settings:{...defaults},status:{connection:'Aguardando agente'},updatedAt:null});this.data.accounts=this.data.accounts.map((a,i)=>({id:i,name:typeof a.name==='string'?a.name:`Treinador ${i+1}`,settings:normalizeSettings(a.settings),status:safeStatus(a.status||{}),updatedAt:a.updatedAt||null}));this.save();}
  save(){const temp=`${this.file}.tmp`;fs.writeFileSync(temp,JSON.stringify(this.data,null,2),{mode:0o600});fs.renameSync(temp,this.file);}
  publicAccounts(){return this.data.accounts.map(({id,name,settings,status,updatedAt})=>({id,name,settings,status,updatedAt,buyAutomation:{available:true,reason:'Ultra Ball: abaixo de 100 compra 100. Great Potion: abaixo de 200 compra 200. Sem teto de gasto; exige gold suficiente e confirmação do estoque.'}}));}
  settings(id,value){const a=this.data.accounts[id];if(!a)throw Error('Conta inválida');a.settings=normalizeSettings({...a.settings,...value});a.updatedAt=new Date().toISOString();this.log(id,'configuração atualizada');this.save();return a;}
  pause(id){if(id==null)this.data.accounts.forEach(a=>a.settings=pauseSettings(a.settings));else {const a=this.data.accounts[id];if(!a)throw Error('Conta inválida');a.settings=pauseSettings(a.settings);}this.log(id==null?'global':id,'automações pausadas');this.save();}
  status(id,value){const a=this.data.accounts[id];if(!a)throw Error('Conta inválida');const previous=a.status;a.status=safeStatus({...a.status,...value});for(const [key,label] of [['captureStatus','Captura'],['automationStatus','Automação'],['hunt','Hunt'],['connection','Conexão']]){if(typeof value?.[key]==='string'&&value[key]&&a.status[key]!==previous[key])this.log(id,`${label}: ${a.status[key]}`);}if(value?.buyBlocked===true){a.settings.autoBuyBalls=false;a.settings.autoBuyPotions=false;}if(value?.buyConfirmed===true)this.log(id,'Compra automática confirmada pelo estoque do servidor.');a.updatedAt=new Date().toISOString();this.save();return a;}
  loadCaptures(){try{const parsed=JSON.parse(fs.readFileSync(this.capturesFile,'utf8'));if(Array.isArray(parsed.items))return {sessionStartedAt:parsed.sessionStartedAt||new Date().toISOString(),items:parsed.items};}catch{}return {sessionStartedAt:new Date().toISOString(),items:[]};}
  saveCaptures(){const temp=`${this.capturesFile}.tmp`;fs.writeFileSync(temp,JSON.stringify(this.captures),{mode:0o600});fs.renameSync(temp,this.capturesFile);}
  publicCaptures(){return {sessionStartedAt:this.captures.sessionStartedAt,captures:this.captures.items};}
  addCaptures(id,list){
    if(!this.data.accounts[id])throw Error('Conta inválida');if(!Array.isArray(list))return [];
    const seen=new Set(this.captures.items.map(c=>`${c.account}:${c.id}`)),added=[];
    for(const raw of list.slice(0,50)){const c=safeCapture(id,raw);if(!c||seen.has(`${id}:${c.id}`))continue;seen.add(`${id}:${c.id}`);added.push(c);}
    if(added.length){this.captures.items=[...this.captures.items,...added].slice(-5000);this.saveCaptures();this.log(id,`Capturado: ${added.map(c=>`${c.species}${c.shiny?' ✨':''}`).join(', ')}`);}
    return added;
  }
  clearCaptures(){this.captures={sessionStartedAt:new Date().toISOString(),items:[]};this.saveCaptures();this.log('global','nova sessão de capturas');}
  log(account,message){this.data.logs.unshift({at:new Date().toISOString(),account,message:String(message).slice(0,300)});this.data.logs=this.data.logs.slice(0,500);this.save();}
}
module.exports={Store,safeStatus,safeCapture};
