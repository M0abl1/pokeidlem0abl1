const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('remote draw budget caps frames, supports cancellation and leaves timers alone',()=>{
  let now=0;const jobs=[];
  const timer=(fn,delay=0)=>jobs.push({fn,at:now+delay});
  const window={requestAnimationFrame:fn=>timer(()=>fn(now),1),cancelAnimationFrame:()=>{}};
  const context={window,setTimeout:timer,performance:{now:()=>now}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'render-budget.js'),'utf8'),context);
  let frames=0,ordinaryTimer=false;
  function draw(){frames++;window.requestAnimationFrame(draw);}
  const canceled=window.requestAnimationFrame(()=>assert.fail('canceled callback ran'));
  window.cancelAnimationFrame(canceled);window.requestAnimationFrame(draw);
  timer(()=>{ordinaryTimer=true;},10);
  while(jobs.length){jobs.sort((a,b)=>a.at-b.at);const job=jobs.shift();if(job.at>1000)break;now=job.at;job.fn();}
  assert.equal(ordinaryTimer,true);assert.ok(frames>=19&&frames<=20,`frames=${frames}`);
});
