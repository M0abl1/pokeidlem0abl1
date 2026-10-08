const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {startServerAgent}=require('./server-agent.cjs');
test('launcher settings persist at controller before applying to game',async()=>{
  let captured,applied;const server=http.createServer((req,res)=>{
    if(req.url==='/api/session'){res.writeHead(204,{'Set-Cookie':'pi_session=synthetic'});res.end();return;}
    if(req.url!=='/api/accounts/0/settings'){res.writeHead(404);res.end();return;}
    let body='';req.on('data',c=>body+=c);req.on('end',()=>{assert.equal(req.headers.cookie,'pi_session=synthetic');captured=JSON.parse(body);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({settings:captured}));});
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const agent=startServerAgent({baseUrl:`http://127.0.0.1:${server.address().port}`,token:'synthetic',accountCount:1,onSettings:(_i,s)=>applied=s,onLogin(){}});
  try{await agent.update(0,{autoCapture:true});assert.equal(captured.autoCapture,true);assert.equal(applied.autoCapture,true);await agent.update(0,{autoCapture:false});assert.equal(applied.autoCapture,false);}finally{agent.close();await new Promise(r=>server.close(r));}
});
