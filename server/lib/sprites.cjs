'use strict';
// Local copy of the PokémonDB "home" sprites: synced once into DATA_DIR and served by the panel.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https');
const ORIGIN='https://img.pokemondb.net/sprites/home/',INDEX='https://pokemondb.net/sprites';
const SLUG=/^[a-z0-9-]{1,40}$/,VARIANTS=['normal','shiny'],PNG='89504e470d0a1a0a';
function get(url){return new Promise((resolve,reject)=>{const req=https.get(url,{headers:{'User-Agent':'PokeIdleManager/1.0'},timeout:15000},res=>{if(res.statusCode!==200){res.resume();return reject(Object.assign(Error(`HTTP ${res.statusCode}`),{status:res.statusCode}));}const chunks=[];let size=0;res.on('data',c=>{size+=c.length;if(size>4e6)req.destroy(Error('resposta grande demais'));else chunks.push(c);});res.on('end',()=>resolve(Buffer.concat(chunks)));});req.on('timeout',()=>req.destroy(Error('tempo esgotado')));req.on('error',reject);});}
class Sprites {
  constructor(dir,{fetch=get}={}){this.dir=dir;this.fetch=fetch;this.inflight=new Map();this.missing=new Set();for(const v of VARIANTS)fs.mkdirSync(path.join(dir,v),{recursive:true});}
  file(variant,slug){return path.join(this.dir,variant,`${slug}.png`);}
  async load(variant,slug){
    if(!VARIANTS.includes(variant)||!SLUG.test(slug))return null;
    const file=this.file(variant,slug);try{return await fs.promises.readFile(file);}catch{}
    const key=`${variant}/${slug}`;if(this.missing.has(key))return null;
    if(!this.inflight.has(key))this.inflight.set(key,this.fetch(`${ORIGIN}${variant}/${slug}.png`).then(async buf=>{
      if(buf.subarray(0,8).toString('hex')!==PNG)throw Error('sprite não é PNG');
      await fs.promises.writeFile(`${file}.tmp`,buf);await fs.promises.rename(`${file}.tmp`,file);return buf;
    }).catch(error=>{if(error.status===404&&this.missing.size<5000)this.missing.add(key);return null;}).finally(()=>this.inflight.delete(key)));
    return this.inflight.get(key);
  }
  async slugs(){
    const listFile=path.join(this.dir,'slugs.json');
    try{const list=JSON.parse(await fs.promises.readFile(listFile,'utf8'));if(Array.isArray(list)&&list.length)return list;}catch{}
    const html=(await this.fetch(INDEX)).toString('utf8');
    const list=[...new Set([...html.matchAll(/href="\/sprites\/([a-z0-9-]+)"/g)].map(m=>m[1]))];
    if(list.length<100)throw Error('lista de sprites incompleta');
    await fs.promises.writeFile(listFile,JSON.stringify(list));return list;
  }
  // Downloads every species once; files already on disk are skipped, shiny stays on demand.
  async sync({concurrency=4}={}){
    const list=await this.slugs(),queue=list.filter(s=>SLUG.test(s)&&!fs.existsSync(this.file('normal',s)));
    let downloaded=0,failed=0;
    const worker=async()=>{for(let slug;(slug=queue.shift());)(await this.load('normal',slug))?downloaded++:failed++;};
    await Promise.all(Array.from({length:concurrency},worker));
    return {total:list.length,downloaded,failed};
  }
}
module.exports={Sprites,SLUG};
