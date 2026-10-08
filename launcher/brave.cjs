const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
function findBrave(){
  if(process.env.POKEIDLE_BROWSER_PATH && fs.existsSync(process.env.POKEIDLE_BROWSER_PATH))return process.env.POKEIDLE_BROWSER_PATH;
  if(process.platform==='linux')return ['/usr/bin/brave-browser','/usr/bin/brave','/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>fs.existsSync(p))||null;
  const candidates=[
    path.join(process.env.ProgramFiles || 'C:\\Program Files','BraveSoftware','Brave-Browser','Application','brave.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)','BraveSoftware','Brave-Browser','Application','brave.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware','Brave-Browser','Application','brave.exe')
  ];
  return candidates.find(p=>fs.existsSync(p)) || null;
}
function openBraveLogin(index,userData,{executable=findBrave(),spawnProcess=spawn,pair=null}={}){
  if(!Number.isInteger(index)||index<0||index>3)throw new Error('Conta inválida.');
  if(!executable)throw new Error('Navegador não encontrado. Instale Brave/Chrome ou configure POKEIDLE_BROWSER_PATH.');
  const profile=path.join(userData,'brave-logins',`account-${index+1}`);
  // Dedicated profiles only. No access to the user's existing Brave cookies or tokens.
  if(pair && (!Number.isInteger(pair.port)||pair.port<1||pair.port>65535||!/^[a-f0-9]{64}$/.test(pair.nonce)||pair.account!==index))throw Error('Autorização inválida');
  const args=pair?['--new-window',`https://pokeidle.io/app#launcher-bridge=${pair.port}.${pair.nonce}.${index}`]:[`--user-data-dir=${profile}`,'--new-window','https://pokeidle.io/app'];
  const child=spawnProcess(executable,args,{detached:true,stdio:'ignore',windowsHide:false,shell:false});
  child.on('error',()=>{});child.unref();
  return profile;
}
module.exports={findBrave,openBraveLogin};
