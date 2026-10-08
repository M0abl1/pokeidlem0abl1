'use strict';
// Local desktop mode: the web panel runs in-process on 127.0.0.1 with a token created per run.
// Nothing here talks to the remote server; game sessions live in a separate userData folder.
const crypto=require('node:crypto');
const localMode=process.argv.includes('--local')||process.env.POKEIDLE_LOCAL==='1';
async function startLocalPanel(dataDir){
  const token=crypto.randomBytes(32).toString('hex');
  // Sprites are fetched from PokémonDB on first use instead of syncing all 1025 at startup.
  Object.assign(process.env,{HOST:'127.0.0.1',PORT:'0',DATA_DIR:dataDir,PANEL_AUTH_TOKEN:token,POKEIDLE_LOCAL:'1',SPRITE_SYNC:'0'});
  const {listening}=require('../server/app.cjs');
  const url=`http://127.0.0.1:${await listening}`;
  Object.assign(process.env,{POKEIDLE_CONTROL_URL:url,POKEIDLE_AGENT_TOKEN:token});
  const login=await fetch(`${url}/api/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
  const cookie=/pi_session=([a-f0-9]+)/.exec(login.headers.get('set-cookie')||'')?.[1];
  if(login.status!==204||!cookie)throw Error('Painel local não autenticou');
  return {url,cookie};
}
module.exports={localMode,startLocalPanel};
