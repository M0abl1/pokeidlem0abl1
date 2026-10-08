const http=require('node:http'),crypto=require('node:crypto');
function createLoginBridge(onSession,{listenPort=0,listenHost='127.0.0.1'}={}){
  if(!['127.0.0.1','0.0.0.0'].includes(listenHost))throw Error('Interface de login inválida');
  if(!Number.isInteger(listenPort)||listenPort<0||listenPort>65535)throw Error('Porta de login inválida');
  const requests=new Map();let port;
  const server=http.createServer(async(req,res)=>{
    const origin=req.headers.origin || '';
    if(!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)||req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);res.end();return;}
    const headers={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'no-store','Content-Type':'application/json'};
    if(req.method==='OPTIONS'){res.writeHead(204,{...headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'content-type,x-pokeidle-pairing'});res.end();return;}
    const nonce=req.headers['x-pokeidle-pairing'];const pair=requests.get(nonce);
    if(req.method!=='POST'||req.url!=='/session'||!pair||pair.expires<Date.now()||pair.busy){res.writeHead(403,headers);res.end('{"error":"Autorização inválida ou expirada"}');return;}
    pair.busy=true;
    try{
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)throw Error('Payload excessivo');}
      const value=JSON.parse(body);
      if(typeof value.nick!=='string'||!value.nick.trim()||value.nick.length>100||typeof value.token!=='string'||!value.token||value.token.length>12000)throw Error('Sessão inválida');
      // One attempt, one target. Never accept credentials for Google or generic cookies.
      requests.delete(nonce);
      await onSession(pair.account,{nick:value.nick,token:value.token});
      res.writeHead(200,headers);res.end('{"ok":true}');
    }catch{requests.delete(nonce);res.writeHead(400,headers);res.end('{"error":"Importação não concluída. Inicie novamente pelo launcher."}');}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  return {
    async start(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(listenPort,listenHost,resolve);});port=server.address().port;},
    authorize(account){
      if(!Number.isInteger(account)||account<0||account>3)throw Error('Conta inválida');
      for(const [nonce,pair]of requests)if(pair.account===account||pair.expires<Date.now())requests.delete(nonce);
      const nonce=crypto.randomBytes(32).toString('hex');requests.set(nonce,{account,expires:Date.now()+300000,busy:false});
      return {port,nonce,account};
    },
    close(){requests.clear();return new Promise(resolve=>server.close(resolve));}
  };
}
module.exports={createLoginBridge};
