'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Sprites}=require('../lib/sprites.cjs');
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from('fake')]);
const index=Array.from({length:120},(_,i)=>`<a href="/sprites/mon-${i}">`).join('')+'<a href="/sprites/pikachu">';
function fakeFetch(calls){return async url=>{calls.push(url);if(url==='https://pokemondb.net/sprites')return Buffer.from(index);if(url.endsWith('/missing.png'))throw Object.assign(Error('HTTP 404'),{status:404});if(url.endsWith('/notpng.png'))return Buffer.from('<html>');return png;};}
test('sincroniza todos os sprites uma vez e reaproveita o disco',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-spr-')),calls=[];const sprites=new Sprites(dir,{fetch:fakeFetch(calls)});
  const first=await sprites.sync();assert.deepEqual(first,{total:121,downloaded:121,failed:0});
  assert.ok(fs.existsSync(path.join(dir,'normal','pikachu.png')));
  calls.length=0;const again=await new Sprites(dir,{fetch:fakeFetch(calls)}).sync();
  assert.deepEqual(again,{total:121,downloaded:0,failed:0});assert.equal(calls.length,0);
});
test('baixa sob demanda, rejeita nomes inválidos e não repete 404',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-spr-')),calls=[];const sprites=new Sprites(dir,{fetch:fakeFetch(calls)});
  assert.deepEqual(await sprites.load('shiny','pikachu'),png);assert.ok(fs.existsSync(path.join(dir,'shiny','pikachu.png')));
  assert.equal(await sprites.load('normal','../etc'),null);assert.equal(await sprites.load('evil','pikachu'),null);
  assert.equal(await sprites.load('normal','notpng'),null);assert.equal(fs.existsSync(path.join(dir,'normal','notpng.png')),false);
  assert.equal(await sprites.load('normal','missing'),null);const count=calls.length;
  assert.equal(await sprites.load('normal','missing'),null);assert.equal(calls.length,count);
});
