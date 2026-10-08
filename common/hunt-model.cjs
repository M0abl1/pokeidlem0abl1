'use strict';
// Conservative local model used only to filter unsafe hunts before comparing
// measured XP. It does not send game actions or claim measured results.
function hit(level,power,attack,defense,stab,effectiveness){return Math.max(0,((2*level/5+2)*power*Math.max(1,attack)/Math.max(1,defense)/50+2)*(stab?1.5:1)*effectiveness*.925);}
function simulateTarget(moves,hp,{gap=.9,travel=1,kills=12}={}){
 if(!moves.length||!(hp>0)||moves.some(m=>!Number.isFinite(m.damage)||m.damage<0||!(m.cooldown>0)))return null;
 const ready=moves.map(()=>0);let time=0,attacks=0;
 for(let k=0;k<kills;k++){let left=hp;while(left>0){if(++attacks>5000||time>kills*120)return null;let index=-1;for(let i=0;i<moves.length;i++)if(ready[i]<=time&&moves[i].damage>0&&(index<0||moves[i].damage>moves[index].damage))index=i;if(index<0){const next=Math.min(...ready.filter((_,i)=>moves[i].damage>0));if(!Number.isFinite(next))return null;time=Math.max(time,next);continue;}left-=moves[index].damage;ready[index]=time+moves[index].cooldown;time+=gap;}time+=travel;}
 return time/kills;
}
function estimateHunt({pokemon,hunt,catalog,matchup,types}){
 const stats=pokemon?.combatStats;if(!stats||!['hp','atk','def','spAtk','spDef'].every(k=>Number.isFinite(stats[k])&&stats[k]>0)||!(pokemon.level>0))return null;
 const entries=hunt.raw?.especies;if(!entries?.length)return null;const total=entries.reduce((sum,entry)=>sum+Number(entry.pontos||0),0);if(!(total>0))return null;
 let seconds=0,damageTaken=0;
 for(const entry of entries){const enemy=catalog.get(entry.pokeId),level=hunt.level,weight=entry.pontos/total;if(!enemy||!(weight>0)||!['baseHp','baseAtk','baseDef','baseSpAtk','baseSpDef'].every(k=>Number.isFinite(enemy[k])&&enemy[k]>0)||!enemy.attacks?.length)return null;const wild=base=>(base+32)*level/100,enemyTypes=types(enemy),playerTypes=types(pokemon);const moves=(pokemon.moves||[]).filter(move=>move.power>0&&move.cooldown>0).map(move=>{const special=/special|especial/i.test(move.category||'');return {damage:hit(pokemon.level,move.power,stats[special?'spAtk':'atk'],wild(enemy[special?'baseSpDef':'baseDef']),playerTypes.includes(move.type),matchup([move.type],enemyTypes)),cooldown:move.cooldown};});const duration=simulateTarget(moves,wild(enemy.baseHp)*12*5);if(duration==null)return null;const attacks=enemy.attacks.filter(attack=>attack.power>0&&Number.isFinite(attack.power));if(!attacks.length)return null;const incoming=Math.max(...attacks.map(attack=>{const special=/special|especial/i.test(attack.category||'');return hit(level,attack.power,wild(enemy[special?'baseSpAtk':'baseAtk']),stats[special?'spDef':'def'],enemyTypes.some(type=>String(type).toLowerCase()===String(attack.type).toLowerCase()),matchup([attack.type],playerTypes));}))/1.5;seconds+=weight*duration;damageTaken+=weight*incoming*duration*1.8;}
 const killsPerLife=stats.hp*12/Math.max(1,damageTaken);return {seconds,killsPerLife,safe:seconds<=60&&killsPerLife>=5,model:'estimativa local conservadora'};
}
if(typeof module!=='undefined')module.exports={hit,simulateTarget,estimateHunt};else globalThis.PokeIdleHuntModel={estimateHunt};
