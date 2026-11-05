import { randomUUID } from 'node:crypto';
import { CONFIG } from '../shared/config.js';
import { MAP } from '../shared/map-data.js';
import { WEAPONS, EQUIPMENT } from '../shared/weapons.js';
import { createBody, movePlayer, eyeHeight, direction, hitboxes, rayAABB, traceWorld, inZone } from '../shared/physics.js';
import { throwGrenade, tickGrenades, serializeGrenades } from './grenades.js';

const NEUTRAL = Object.freeze({forward:0,strafe:0,yaw:0,pitch:0,jump:false,walk:false,crouch:false,fire:false,interact:false});
const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const money = (p,amount,config) => { p.money=Math.max(0,Math.min(config.maxMoney,p.money+amount)); };
export class RuleError extends Error {}
const requireRule = (condition,message) => { if(!condition) throw new RuleError(message); };

export function newPlayer(nickname,socketId,config) {
  return {...createBody(),id:randomUUID(),token:randomUUID()+randomUUID(),nickname,socketId,connected:true,ready:false,team:'T',
    alive:false,hp:100,armor:0,helmet:false,kit:false,money:config.initialMoney,kills:0,deaths:0,assists:0,ping:0,
    yaw:0,pitch:0,weapon:'glock',inventory:['glock'],ammo:{glock:{mag:WEAPONS.glock.mag,reserve:WEAPONS.glock.reserve}},
    ack:0,lastSeq:0,inputQueue:[],input:{...NEUTRAL},lastInputAt:0,fireHeld:false,nextShotAt:0,lastShotAt:0,
    spray:0,recoilVertical:0,recoilHorizontal:0,reloadingAt:0,interaction:null,damageFrom:new Map(),scoped:false,burst:false,burstLeft:0,
    disconnectedAt:0,footstepAt:0,jumpHeld:false};
}

/** All mutations run on the single Node event loop. Inputs never contain positions or damage. */
export class GameRoom {
  constructor(code,{config={},emit=()=>{},onEmpty=()=>{}}={}) {
    this.code=code; this.config={...CONFIG,...config}; this.players=new Map(); this.host=null;
    this.phase='lobby'; this.round=0; this.score={T:0,CT:0}; this.roundEndsAt=0; this.buyEndsAt=0;
    this.winner=null; this.reason=''; this.nextRoundAt=0; this.bomb={state:'none',carrier:null,x:0,y:0,z:0};
    this.grenades=[]; this.history=[]; this.losses={T:0,CT:0}; this.emit=emit; this.onEmpty=onEmpty;
    this.lastTickAt=0; this.startedTeamCounts={T:0,CT:0}; this.lastProbeAt=0;
  }
  addPlayer(p) {
    requireRule(this.players.size<this.config.maxPlayers,'Sala cheia (máximo de 10 jogadores).');
    requireRule(![...this.players.values()].some(v=>v.nickname.toLocaleLowerCase()===p.nickname.toLocaleLowerCase()),'Esse nickname já está em uso nesta sala.');
    const counts=this.countTeams(); p.team=counts.T<=counts.CT?'T':'CT';
    if(counts[p.team]>=this.config.teamSize) p.team=p.team==='T'?'CT':'T';
    this.players.set(p.id,p); if(!this.host) this.host=p.id;
    return p;
  }
  countTeams(){const counts={T:0,CT:0};for(const p of this.players.values()) counts[p.team]++;return counts;}
  selectTeam(p,team) {
    requireRule(this.phase==='lobby','Troque de equipe no lobby.');
    requireRule(team==='T'||team==='CT','Equipe inválida.');
    if(team===p.team) return;
    requireRule(this.countTeams()[team]<this.config.teamSize,'Esta equipe já tem 5 jogadores.');
    p.team=team;p.ready=false;
  }
  setReady(p,ready){requireRule(this.phase==='lobby','A partida já começou.');requireRule(typeof ready==='boolean','Estado pronto inválido.');p.ready=ready;}
  startMatch(now) {
    requireRule(this.phase==='lobby'||this.phase==='finished','A partida já está em andamento.');
    const present=[...this.players.values()].filter(p=>p.connected);
    requireRule(present.length>0,'A sala está vazia.');
    if(this.phase==='lobby')requireRule(present.length===1||present.every(p=>p.ready),'Todos os jogadores conectados precisam estar prontos.');
    this.score={T:0,CT:0};this.round=0;this.losses={T:0,CT:0};
    for(const p of this.players.values()){p.money=this.config.initialMoney;p.kills=0;p.deaths=0;p.assists=0;p.alive=false;p.armor=0;p.helmet=false;p.kit=false;}
    this.startRound(now);
  }
  startRound(now) {
    if(this.round===this.config.swapAfter){
      for(const p of this.players.values()){p.team=p.team==='T'?'CT':'T';p.alive=false;p.money=this.config.initialMoney;p.armor=0;p.helmet=false;p.kit=false;}
      this.score={T:this.score.CT,CT:this.score.T};this.losses={T:0,CT:0};
      this.emit({type:'sides',message:'Intervalo: as equipes trocaram de lado.'});
    }
    this.round++;this.phase='playing';this.winner=null;this.reason='';this.roundEndsAt=now+this.config.roundTime*1000;
    this.buyEndsAt=now+this.config.buyTime*1000;this.grenades=[];this.history=[];this.lastTickAt=now;
    const spawnIndex={T:0,CT:0};this.startedTeamCounts={T:0,CT:0};
    for(const p of this.players.values()) {
      if(!p.connected){p.alive=false;continue;}
      const survived=p.alive; const spawn=MAP.spawns[p.team][spawnIndex[p.team]++%MAP.spawns[p.team].length];
      Object.assign(p,createBody(spawn.x,spawn.y,spawn.z));p.yaw=spawn.yaw;p.pitch=0;p.alive=true;p.hp=100;
      if(!survived){const pistol=p.team==='T'?'glock':'usp';p.inventory=[pistol];p.weapon=pistol;p.ammo={[pistol]:{mag:WEAPONS[pistol].mag,reserve:WEAPONS[pistol].reserve}};p.armor=0;p.helmet=false;p.kit=false;}
      // Surviving weapons persist; all owned firearms receive round-start ammunition.
      for(const id of p.inventory){const weapon=WEAPONS[id];if(weapon)p.ammo[id]={mag:weapon.mag,reserve:weapon.reserve};}
      p.inputQueue=[];p.input={...NEUTRAL,yaw:p.yaw};p.lastInputAt=now;p.fireHeld=false;p.reloadingAt=0;p.interaction=null;
      p.nextShotAt=now;p.lastShotAt=0;p.spray=0;p.recoilVertical=0;p.recoilHorizontal=0;p.scoped=false;p.burstLeft=0;p.damageFrom.clear();p.jumpHeld=false;
      this.startedTeamCounts[p.team]++;
    }
    const carrier=[...this.players.values()].find(p=>p.connected&&p.team==='T'&&p.alive);
    this.bomb={state:carrier?'carried':'none',carrier:carrier?.id??null,x:carrier?.x??0,y:carrier?.y??0,z:carrier?.z??0,site:null,explodesAt:0,pickupAfter:0};
    this.emit({type:'roundStart',round:this.round});
  }
  endRound(winner,reason,now) {
    if(this.phase!=='playing') return false;
    this.phase='ended';this.score[winner]++;this.winner=winner;this.reason=reason;this.nextRoundAt=now+this.config.roundEndTime*1000;
    const loser=winner==='T'?'CT':'T';this.losses[winner]=0;this.losses[loser]=Math.min(4,this.losses[loser]+1);
    for(const p of this.players.values()) {money(p,p.team===winner?3250:1400+(this.losses[loser]-1)*500,this.config);p.inputQueue=[];p.input={...NEUTRAL,yaw:p.yaw,pitch:p.pitch};p.interaction=null;p.vx=0;p.vy=0;p.vz=0;p.reloadingAt=0;p.fireHeld=false;p.burstLeft=0;}
    this.emit({type:'round',winner,reason,round:this.round});
    const winsNeeded=Math.floor(this.config.maxRounds/2)+1;
    if(this.round>=this.config.maxRounds||this.score[winner]>=winsNeeded){this.phase='finished';this.winner=this.score.T===this.score.CT?'draw':this.score.T>this.score.CT?'T':'CT';this.emit({type:'matchEnd',winner:this.winner,score:{...this.score}});}
    return true;
  }
  dropBomb(p,now) {
    requireRule(this.phase==='playing'&&this.bomb.state==='carried'&&this.bomb.carrier===p.id,'Você não está carregando a bomba.');
    const origin={x:p.x,y:p.y+.12,z:p.z};
    const down=traceWorld(origin,{x:0,y:-1,z:0},100)??origin.y;
    this.bomb={...this.bomb,state:'dropped',carrier:null,x:p.x,y:Math.max(.06,origin.y-down+.06),z:p.z,pickupAfter:now+800};p.interaction=null;
    this.emit({type:'bomb',action:'drop',player:p.id,x:p.x,y:p.y,z:p.z});
  }
  buy(p,item,now) {
    requireRule(this.phase==='playing'&&p.alive&&p.connected,'Você precisa estar vivo para comprar.');
    requireRule(now<=this.buyEndsAt,'O período de compra terminou.');
    requireRule(inZone(p,MAP.buyZones[p.team]),'Volte à área de compra.');
    requireRule(typeof item==='string'&&(Object.hasOwn(WEAPONS,item)||Object.hasOwn(EQUIPMENT,item)),'Item inválido.');
    const definition=Object.hasOwn(WEAPONS,item)?WEAPONS[item]:EQUIPMENT[item];
    requireRule(definition.team==='both'||definition.team===p.team,'Este item não está disponível para sua equipe.');
    requireRule(p.money>=definition.price,'Saldo insuficiente.');
    if(WEAPONS[item]) {
      requireRule(!p.inventory.includes(item),'Você já possui esta arma.');
      for(const old of [...p.inventory]) if(WEAPONS[old]?.slot===definition.slot){p.inventory.splice(p.inventory.indexOf(old),1);delete p.ammo[old];}
      p.inventory.push(item);p.ammo[item]={mag:definition.mag,reserve:definition.reserve};p.weapon=item;p.reloadingAt=0;p.scoped=false;p.burstLeft=0;
    } else if(item==='armor'){requireRule(p.armor<100,'Seu colete já está completo.');p.armor=100;}
    else if(item==='helmet'){requireRule(!p.helmet||p.armor<100,'Você já possui capacete e colete completos.');p.armor=100;p.helmet=true;}
    else if(item==='kit'){requireRule(!p.kit,'Você já possui um kit.');p.kit=true;}
    else {requireRule(!p.inventory.includes(item),'Você já possui esta granada.');p.inventory.push(item);}
    money(p,-definition.price,this.config);this.emit({type:'buy',player:p.id,item,x:p.x,y:p.y,z:p.z});
  }
  equip(p,weapon,slot) {
    requireRule(this.phase==='playing'&&p.alive,'Você precisa estar vivo para equipar.');
    if(slot!==undefined){requireRule(Number.isInteger(slot)&&slot>=1&&slot<=3,'Slot inválido.');if(slot===1) weapon=p.inventory.find(id=>WEAPONS[id]?.slot==='primary');if(slot===2) weapon=p.inventory.find(id=>WEAPONS[id]?.slot==='secondary');if(slot===3) weapon=p.inventory.find(id=>id==='smoke'||id==='flash');}
    requireRule(typeof weapon==='string'&&p.inventory.includes(weapon),'Equipamento indisponível.');
    if(weapon===p.weapon) return;
    p.weapon=weapon;p.reloadingAt=0;p.scoped=false;p.burstLeft=0;p.nextShotAt=Math.max(p.nextShotAt,this.lastTickAt+180);p.spray=0;p.recoilVertical=0;p.recoilHorizontal=0;
    this.emit({type:'equip',player:p.id,weapon,x:p.x,y:p.y,z:p.z});
  }
  action(p,data,now) {
    requireRule(data&&typeof data==='object'&&!Array.isArray(data),'Ação inválida.');
    requireRule(this.phase==='playing'&&p.alive&&p.connected,'Ação indisponível agora.');
    switch(data.type) {
      case 'buy': this.buy(p,data.item,now);break;
      case 'equip':this.equip(p,data.weapon,data.slot);break;
      case 'reload':{
        const w=WEAPONS[p.weapon],a=p.ammo[p.weapon];requireRule(w&&a,'Esta arma não pode ser recarregada.');
        requireRule(!p.reloadingAt&&a.mag<w.mag&&a.reserve>0,'Não é possível recarregar agora.');
        p.reloadingAt=now+w.reload*1000;p.burstLeft=0;this.emit({type:'reload',player:p.id,weapon:p.weapon,x:p.x,y:p.y,z:p.z});break;
      }
      case 'dropBomb':this.dropBomb(p,now);break;
      case 'secondary':
        if(p.weapon==='glock'){p.burst=!p.burst;p.burstLeft=0;}
        else if(p.weapon==='awp'){p.scoped=!p.scoped;}
        else throw new RuleError('Esta arma não possui ação secundária.');
        break;
      case 'grenade':this.throwUtility(p,data.item??p.weapon,now);break;
      default:throw new RuleError('Ação desconhecida.');
    }
  }
  throwUtility(p,item,now) {
    requireRule((item==='smoke'||item==='flash')&&p.inventory.includes(item),'Granada indisponível.');
    requireRule(now>=p.nextShotAt,'Aguarde antes de arremessar.');
    requireRule(!!throwGrenade(this,p,item,now,e=>this.emit(e)),'Muitas granadas em jogo.');
    p.inventory.splice(p.inventory.indexOf(item),1);if(p.weapon===item)p.weapon=p.inventory.find(id=>WEAPONS[id])??(p.team==='T'?'glock':'usp');
    p.nextShotAt=now+500;
  }
  enqueue(p,command,now) {
    if(this.phase!=='playing'||!p.alive||!p.connected||!command||typeof command!=='object')return false;
    const {seq}=command;if(!Number.isSafeInteger(seq)||seq<=p.lastSeq||seq>2**31-1||seq-p.lastSeq>10000)return false;
    if(!Number.isFinite(command.yaw)||Math.abs(command.yaw)>1e6||!Number.isFinite(command.pitch)||Math.abs(command.pitch)>1.58)return false;
    if(!Number.isFinite(command.forward)||Math.abs(command.forward)>1||!Number.isFinite(command.strafe)||Math.abs(command.strafe)>1)return false;
    const input={seq,time:Number.isFinite(command.time)?Math.max(now-1000,Math.min(now,command.time)):now,
      forward:command.forward,strafe:command.strafe,yaw:((command.yaw+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI,
      pitch:Math.max(-1.5,Math.min(1.5,command.pitch)),jump:command.jump===true,walk:command.walk===true,crouch:command.crouch===true,fire:command.fire===true,interact:command.interact===true};
    p.lastSeq=seq;p.lastInputAt=now;
    // Limit queue latency: dropping excess commands never adds simulation time.
    if(p.inputQueue.length>=8)p.inputQueue.shift();p.inputQueue.push(input);return true;
  }
  rewindPlayer(p,targetAt) {
    let selected=null;for(let i=this.history.length-1;i>=0;i--){if(this.history[i].time<=targetAt){selected=this.history[i].players.get(p.id);break;}}
    return selected??p;
  }
  fire(p,now,forcedBurst=false) {
    if(this.phase!=='playing'||!p.alive||p.reloadingAt||now<p.nextShotAt)return false;
    if(p.weapon==='smoke'||p.weapon==='flash'){this.throwUtility(p,p.weapon,now);return true;}
    const w=WEAPONS[p.weapon],ammo=p.ammo[p.weapon];if(!w||!ammo||ammo.mag<=0)return false;
    if(now-p.lastShotAt>350){p.spray=0;p.recoilVertical=0;p.recoilHorizontal=0;}
    const recoil=w.recoil[Math.min(p.spray,w.recoil.length-1)];
    p.recoilVertical=Math.min(.22,p.recoilVertical+recoil[0]);p.recoilHorizontal=Math.max(-.12,Math.min(.12,p.recoilHorizontal+recoil[1]));p.spray++;
    const moving=Math.min(1,Math.hypot(p.vx,p.vz)/w.speed);
    const spread=(p.scoped&&w.scopedSpread!==undefined?w.scopedSpread:w.spread)+(w.moveSpread*moving)+(p.grounded?0:w.airSpread);
    const yaw=p.yaw+p.recoilHorizontal+(Math.random()-.5)*spread*2;
    const pitch=Math.max(-1.55,Math.min(1.55,p.pitch+p.recoilVertical+(Math.random()-.5)*spread*2));
    const origin={x:p.x,y:p.y+eyeHeight(p),z:p.z};const dir=direction(yaw,pitch);
    let closest=traceWorld(origin,dir,200)??200;let victim=null,region=null;
    const maxRewind=Math.min(this.config.maxRewind*1000,(p.ping||0)/2+50);
    const targetAt=now-Math.max(0,Math.min(maxRewind,now-(p.input.time??now)));
    for(const target of this.players.values()){
      if(target.id===p.id||!target.alive||!target.connected||(!this.config.friendlyFire&&target.team===p.team))continue;
      const pose=this.rewindPlayer(target,targetAt);
      for(const hitbox of hitboxes(pose)){
        const distance=rayAABB(origin,dir,hitbox.box,closest);
        if(distance!==null&&distance<closest){closest=distance;victim=target;region=hitbox.region;}
      }
    }
    ammo.mag--;p.lastShotAt=now;
    if(p.weapon==='glock'&&p.burst){
      if(!forcedBurst)p.burstLeft=2;else p.burstLeft=Math.max(0,p.burstLeft-1);
      p.nextShotAt=now+(p.burstLeft>0?65:450);
    } else p.nextShotAt=now+w.rate*1000;
    const end={x:origin.x+dir.x*closest,y:origin.y+dir.y*closest,z:origin.z+dir.z*closest};
    this.emit({type:'shot',shooter:p.id,weapon:p.weapon,origin,direction:dir,end,recoil});
    if(victim){const multiplier=this.config.hitMultipliers[region]??1;this.applyDamage(p,victim,w.damage*multiplier,region,now);}
    return true;
  }
  applyDamage(attacker,target,amount,region,now) {
    if(this.phase!=='playing'||!attacker?.alive||!target?.alive||attacker.id===target.id||(!this.config.friendlyFire&&attacker.team===target.team))return 0;
    let damage=Math.max(0,amount);
    if(target.armor>0&&region!=='legs'&&(region!=='head'||target.helmet)){
      const absorbed=Math.min(target.armor,damage*.5);target.armor=Math.max(0,target.armor-Math.ceil(absorbed));damage-=absorbed;
    }
    damage=Math.max(1,Math.round(damage));target.hp=Math.max(0,target.hp-damage);
    const prior=target.damageFrom.get(attacker.id);target.damageFrom.set(attacker.id,{damage:(prior?.damage??0)+damage,time:now});
    this.emit({type:'hit',attacker:attacker.id,target:target.id,damage,region,hp:target.hp,armor:target.armor});
    if(target.hp===0){
      target.alive=false;target.deaths++;attacker.kills++;money(attacker,WEAPONS[attacker.weapon]?.killReward??300,this.config);
      const assist=[];for(const [id,record] of target.damageFrom){const p=this.players.get(id);if(p&&id!==attacker.id&&record.damage>=30&&now-record.time<10000){p.assists++;money(p,150,this.config);assist.push(id);}}
      if(this.bomb.carrier===target.id&&this.bomb.state==='carried')this.dropBomb(target,now);
      target.inputQueue=[];target.interaction=null;target.reloadingAt=0;target.vx=0;target.vy=0;target.vz=0;
      this.emit({type:'kill',attacker:attacker.id,target:target.id,weapon:attacker.weapon,headshot:region==='head',assist});
      this.checkElimination(now);
    }
    return damage;
  }
  checkElimination(now) {
    // A solo practice round can exercise the objective without an absent opponent ending it.
    if(this.phase!=='playing'||!this.startedTeamCounts.T||!this.startedTeamCounts.CT)return;
    let T=0,CT=0;for(const p of this.players.values())if(p.alive&&p.connected){if(p.team==='T')T++;else CT++;}
    if(!CT)this.endRound('T','Todos os CTs foram eliminados.',now);
    else if(!T&&this.bomb.state!=='planted')this.endRound('CT','Todos os Terroristas foram eliminados antes do plantio.',now);
  }
  updateBomb(p,now) {
    if(!p.alive||!p.connected){p.interaction=null;return;}
    if(this.bomb.state==='dropped'&&p.team==='T'&&now>=this.bomb.pickupAfter&&dist(p,this.bomb)<1.7){this.bomb.state='carried';this.bomb.carrier=p.id;this.emit({type:'bomb',action:'pickup',player:p.id});}
    if(this.bomb.state==='carried'&&this.bomb.carrier===p.id){this.bomb.x=p.x;this.bomb.y=p.y;this.bomb.z=p.z;}
    let type=null,site=null,duration=0;
    const still=Math.hypot(p.vx,p.vz)<.55&&p.grounded;
    if(p.input.interact&&still&&p.team==='T'&&this.bomb.state==='carried'&&this.bomb.carrier===p.id){
      site=Object.keys(MAP.sites).find(key=>inZone(p,MAP.sites[key]));if(site){type='plant';duration=this.config.plantTime*1000;}
    } else if(p.input.interact&&still&&p.team==='CT'&&this.bomb.state==='planted'&&dist(p,this.bomb)<2.4){
      const origin={x:p.x,y:p.y+eyeHeight(p),z:p.z},length=dist(origin,this.bomb);
      const dir={x:(this.bomb.x-origin.x)/length,y:(this.bomb.y-origin.y)/length,z:(this.bomb.z-origin.z)/length};
      const wall=traceWorld(origin,dir,length);if(wall===null||wall>=length-.2){type='defuse';duration=(p.kit?this.config.kitDefuseTime:this.config.defuseTime)*1000;}
    }
    if(!type){p.interaction=null;return;}
    if(p.interaction?.type!==type||p.interaction?.site!==site)p.interaction={type,site,start:now,progress:0};
    p.interaction.progress=Math.min(1,(now-p.interaction.start)/duration);
    if(p.interaction.progress>=1){
      if(type==='plant'){
        this.bomb={state:'planted',carrier:null,x:p.x,y:p.y+.1,z:p.z,site,explodesAt:now+this.config.bombTime*1000,pickupAfter:Infinity};money(p,300,this.config);
        this.emit({type:'bomb',action:'plant',player:p.id,site,x:p.x,y:p.y,z:p.z,explodesAt:this.bomb.explodesAt});
      }else{this.bomb.state='defused';money(p,300,this.config);this.emit({type:'bomb',action:'defuse',player:p.id});this.endRound('CT','Bomba desarmada.',now);}
      p.interaction=null;
    }
  }
  disconnect(p,now) {
    p.connected=false;p.socketId=null;p.disconnectedAt=now;p.ready=false;p.inputQueue=[];
    if(this.bomb.state==='carried'&&this.bomb.carrier===p.id){if(this.phase==='playing')this.dropBomb(p,now);else {this.bomb.state='dropped';this.bomb.carrier=null;}}
    if(p.alive){p.alive=false;p.deaths++;}p.interaction=null;
    if(this.host===p.id)this.host=[...this.players.values()].find(other=>other.connected)?.id??null;
    this.emit({type:'disconnect',player:p.id,nickname:p.nickname});this.checkElimination(now);
  }
  remove(p,now){if(p.connected)this.disconnect(p,now);this.players.delete(p.id);if(!this.players.size)this.onEmpty(this.code);}
  tick(now) {
    const dt=1/this.config.tickRate;this.lastTickAt=now;
    for(const p of this.players.values())if(!p.connected&&now-p.disconnectedAt>=this.config.reconnectTime*1000)this.players.delete(p.id);
    if(!this.players.size){this.onEmpty(this.code);return;}
    if(this.phase==='ended'){if(now>=this.nextRoundAt)this.startRound(now);return;}
    if(this.phase!=='playing')return;
    if(this.bomb.state==='planted'&&now>=this.bomb.explodesAt){this.bomb.state='exploded';this.emit({type:'bomb',action:'explode',x:this.bomb.x,y:this.bomb.y,z:this.bomb.z});this.endRound('T','Bomba detonada.',now);return;}
    if(this.bomb.state!=='planted'&&now>=this.roundEndsAt){this.endRound('CT','O tempo terminou sem plantio.',now);return;}
    for(const p of this.players.values()){
      if(this.phase!=='playing')break;if(!p.connected||!p.alive)continue;
      let command=p.inputQueue.shift();
      if(command){p.input=command;p.ack=command.seq;p.yaw=command.yaw;p.pitch=command.pitch;}
      else if(now-p.lastInputAt>200)p.input={...NEUTRAL,yaw:p.yaw,pitch:p.pitch};
      if(p.reloadingAt&&now>=p.reloadingAt){const a=p.ammo[p.weapon],w=WEAPONS[p.weapon];if(a&&w){const transfer=Math.min(w.mag-a.mag,a.reserve);a.mag+=transfer;a.reserve-=transfer;}p.reloadingAt=0;}
      const beforeGrounded=p.grounded;const jumping=p.input.jump&&!p.jumpHeld;
      movePlayer(p,{...p.input,jump:jumping},dt,(WEAPONS[p.weapon]?.speed??6)*(p.scoped?.72:1));p.jumpHeld=p.input.jump;
      if(beforeGrounded&&!p.grounded&&p.vy>0)this.emit({type:'jump',player:p.id,x:p.x,y:p.y,z:p.z});
      if(p.grounded&&Math.hypot(p.vx,p.vz)>1.2&&!p.input.walk&&!p.crouch&&now>=p.footstepAt){p.footstepAt=now+340;this.emit({type:'footstep',player:p.id,x:p.x,y:p.y,z:p.z});}
      p.recoilVertical*=Math.exp(-dt*7);p.recoilHorizontal*=Math.exp(-dt*6);
      if(p.input.fire&&(WEAPONS[p.weapon]?.automatic||!p.fireHeld)){
        try{this.fire(p,now);}catch(e){if(!(e instanceof RuleError))throw e;}
      }else if(p.burstLeft>0&&now>=p.nextShotAt)this.fire(p,now,true);
      p.fireHeld=p.input.fire;
      this.updateBomb(p,now);
    }
    if(this.phase!=='playing')return;
    tickGrenades(this,dt,now,event=>this.emit(event));
    const poses=new Map();for(const p of this.players.values())if(p.alive)poses.set(p.id,{x:p.x,y:p.y,z:p.z,yaw:p.yaw,crouch:p.crouch,grounded:p.grounded});
    this.history.push({time:now,players:poses});const cutoff=now-this.config.maxRewind*1000-50;while(this.history.length&&this.history[0].time<cutoff)this.history.shift();
    this.checkElimination(now);
  }
  snapshot(now) {
    const players=[];for(const p of this.players.values())players.push({id:p.id,nickname:p.nickname,team:p.team,connected:p.connected,ready:p.ready,alive:p.alive,
      x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz,yaw:p.yaw,pitch:p.pitch,crouch:p.crouch,walk:p.input.walk,grounded:p.grounded,hp:p.hp,armor:p.armor,helmet:p.helmet,kit:p.kit,money:p.money,kills:p.kills,deaths:p.deaths,assists:p.assists,ping:p.ping,
      weapon:p.weapon,inventory:[...p.inventory],ammo:Object.fromEntries(Object.entries(p.ammo).map(([id,a])=>[id,{...a}])),ack:p.ack,scoped:p.scoped,burst:p.burst,reloadingAt:p.reloadingAt,
      interaction:p.interaction?{type:p.interaction.type,site:p.interaction.site,progress:p.interaction.progress}:null});
    const bomb={...this.bomb};delete bomb.pickupAfter;
    return {serverTime:now,code:this.code,host:this.host,phase:this.phase,round:this.round,score:{...this.score},roundEndsAt:this.roundEndsAt,buyEndsAt:this.buyEndsAt,nextRoundAt:this.nextRoundAt,winner:this.winner,reason:this.reason,bomb,players,grenades:serializeGrenades(this),config:{maxRounds:this.config.maxRounds,swapAfter:this.config.swapAfter,buyTime:this.config.buyTime}};
  }
}
