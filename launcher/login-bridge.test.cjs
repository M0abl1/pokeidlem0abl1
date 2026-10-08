const assert=require('node:assert/strict'),{createLoginBridge}=require('./login-bridge.cjs');
(async()=>{
  const received=[];const bridge=createLoginBridge(async(i,s)=>received.push({i,nick:s.nick}));await bridge.start();
  try{
    const pair=bridge.authorize(2),url=`http://127.0.0.1:${pair.port}/session`,origin=`chrome-extension://${'a'.repeat(32)}`;
    const send=(nonce,source=origin)=>fetch(url,{method:'POST',headers:{Origin:source,'Content-Type':'application/json','X-Pokeidle-Pairing':nonce},body:JSON.stringify({nick:'FakeTest',token:'synthetic-test-credential'})});
    assert.equal((await send(pair.nonce,'https://evil.example')).status,403);
    assert.equal((await send('bad')).status,403);
    assert.equal((await send(pair.nonce)).status,200);assert.equal(received[0].i,2);
    assert.equal((await send(pair.nonce)).status,403,'replay denied');
    const old=bridge.authorize(1);bridge.authorize(1);assert.equal((await send(old.nonce)).status,403,'previous request revoked');
    assert.throws(()=>bridge.authorize(9));
    console.log('OK: loopback, origin filter, one-time pairing, account binding and replay rejection; no real credentials used.');
  }finally{await bridge.close();}
})().catch(()=>{console.error('Bridge test failed');process.exitCode=1;});
