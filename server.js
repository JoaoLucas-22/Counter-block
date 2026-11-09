import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './shared/config.js';
import { GameRoom, RuleError, newPlayer } from './server/game.js';
import { ProfileStore, ProfileError } from './server/profiles.js';

const dirname=path.dirname(fileURLToPath(import.meta.url));
const cleanNickname=value=>{
  if(typeof value!=='string')throw new RuleError('Digite um nickname.');
  const nickname=value.normalize('NFKC').trim().replace(/[\u0000-\u001f\u007f<>]/g,'');
  if(nickname.length<2||nickname.length>20)throw new RuleError('O nickname deve ter entre 2 e 20 caracteres.');
  return nickname;
};
const parseCode=value=>{if(typeof value!=='string'||!/^[A-Z]{5}$/.test(value.trim().toUpperCase()))throw new RuleError('Informe um código de sala com 5 letras.');return value.trim().toUpperCase();};

/** One persistent process owns independent in-memory rooms. No client may set state directly. */
export function createGameServer(options={}) {
  const config={...CONFIG,...options.config};const clock=options.now??Date.now;
  const profiles=new ProfileStore({filePath:options.profilePath!==undefined?options.profilePath:options.manualTick?null:path.join(dirname,'data','profiles.json')});
  const app=express();app.disable('x-powered-by');
  app.use((_req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');next();});
  const httpServer=createServer(app);
  const io=new Server(httpServer,{maxHttpBufferSize:16*1024,pingInterval:10000,pingTimeout:15000,perMessageDeflate:false,
    ...(process.env.ALLOWED_ORIGIN?{cors:{origin:process.env.ALLOWED_ORIGIN.split(',')}}:{})});
  const rooms=new Map();let tickIndex=0,closed=false;
  app.get(['/health','/healthz'],(_req,res)=>res.json({ok:true,game:'Counter Block',rooms:rooms.size}));
  app.use('/shared',express.static(path.join(dirname,'shared')));
  app.use('/vendor',express.static(path.join(dirname,'node_modules/three/build')));
  app.use(express.static(path.join(dirname,'public')));
  function broadcastRoom(room){if(rooms.has(room.code))io.to(room.code).emit('room:state',room.snapshot(clock()));}
  function profileState(profile) {
    const view=profiles.view(profile);
    view.friends=view.friends.map(friend=>{
      const connections=[...io.sockets.sockets.values()].filter(socket=>socket.data.profileId===friend.id);
      const active=connections.find(socket=>rooms.has(socket.data.code));
      return {...friend,online:connections.length>0,roomCode:active?.data.code??null};
    });
    return view;
  }
  function emitProfiles(){for(const socket of io.sockets.sockets.values()){
    const account=profiles.get(socket.data.profileId);if(account)socket.emit('profile:state',profileState(account));
  }}
  function bindProfile(socket,player,nickname){
    const profile=profiles.get(socket.data.profileId);profiles.setNickname(profile.id,nickname);
    player.profileId=profile.id;player.cosmetics={...profile.equipped};emitProfiles();
  }
  function awardCase(attacker,target){
    if(!attacker.profileId||attacker.profileId===target?.profileId||!profiles.get(attacker.profileId))return;
    const reward=profiles.grantKill(attacker.profileId);
    for(const socket of io.sockets.sockets.values())if(socket.data.profileId===attacker.profileId){
      socket.emit('game:event',{type:'case',...reward,player:attacker.id,serverTime:clock()});
    }
    emitProfiles();
  }
  function removeEmpty(code){const room=rooms.get(code);if(room&&!room.players.size){room.grenades=[];room.history=[];rooms.delete(code);}}
  function freshCode(){let code;do{code=Array.from({length:5},()=>String.fromCharCode(65+randomInt(26))).join('');}while(rooms.has(code));return code;}
  function getMembership(socket){const room=rooms.get(socket.data.code);const player=room?.players.get(socket.data.playerId);if(!room||!player||!player.connected||player.socketId!==socket.id)throw new RuleError('Você não está em uma sala.');return {room,player};}
  function setMembership(socket,room,player){socket.data.code=room.code;socket.data.playerId=player.id;socket.join(room.code);}
  function leaveCurrent(socket){
    if(!socket.data.code)return;const room=rooms.get(socket.data.code),player=room?.players.get(socket.data.playerId);
    if(room&&player&&player.socketId===socket.id){room.remove(player,clock());broadcastRoom(room);}
    socket.leave(socket.data.code);delete socket.data.code;delete socket.data.playerId;
  }
  io.use((socket,next)=>{try{socket.data.profileId=profiles.authenticate(socket.handshake.auth?.profileToken).id;next();}catch(error){next(new Error(error instanceof ProfileError?error.message:'Não foi possível carregar o perfil.'));}});
  io.on('connection',socket=>{
    const account=profiles.get(socket.data.profileId);
    socket.emit('profile:state',{...profileState(account),token:account.token});emitProfiles();
    const buckets=new Map();
    function consume(key,rate,burst=rate){const now=clock();let bucket=buckets.get(key);if(!bucket){bucket={tokens:burst,time:now};buckets.set(key,bucket);}bucket.tokens=Math.min(burst,bucket.tokens+Math.max(0,now-bucket.time)*rate/1000);bucket.time=now;if(bucket.tokens<1)return false;bucket.tokens--;return true;}
    let abusive=0;
    socket.use((_packet,next)=>{if(!consume('all',180,240)){abusive++;if(abusive>120)socket.disconnect(true);return;}next();});
    function handle(event,fn,rate=8,burst=12){socket.on(event,(payload,callback)=>{const ack=typeof callback==='function'?callback:typeof payload==='function'?payload:()=>{};if(!consume(event,rate,burst)){ack({ok:false,error:'Muitas solicitações. Aguarde um momento.'});return;}try{const result=fn(payload??{});ack({ok:true,...(result??{})});}catch(error){if(!(error instanceof RuleError)&&!(error instanceof ProfileError))console.error(`Event ${event}:`,error);ack({ok:false,error:error instanceof RuleError||error instanceof ProfileError?error.message:'Erro interno ao processar a ação.'});}});}
    handle('room:create',data=>{
      if(socket.data.code)throw new RuleError('Saia da sala atual antes de criar outra.');
      const nickname=cleanNickname(data?.nickname);if(rooms.size>=200)throw new RuleError('O servidor atingiu o limite de salas.');
      const code=freshCode();const room=new GameRoom(code,{config,emit:event=>io.to(code).emit('game:event',{...event,serverTime:clock()}),onEmpty:removeEmpty,onKill:awardCase});
      rooms.set(code,room);const player=room.addPlayer(newPlayer(nickname,socket.id,config));bindProfile(socket,player,nickname);setMembership(socket,room,player);broadcastRoom(room);emitProfiles();
      return {id:player.id,token:player.token,code,inputSeq:player.lastSeq,state:room.snapshot(clock())};
    },1,3);
    handle('room:join',data=>{
      if(socket.data.code)throw new RuleError('Saia da sala atual antes de entrar em outra.');
      const code=parseCode(data?.code),nickname=cleanNickname(data?.nickname),room=rooms.get(code);if(!room)throw new RuleError('Sala não encontrada. Confira o código.');
      const player=room.addPlayer(newPlayer(nickname,socket.id,config));bindProfile(socket,player,nickname);setMembership(socket,room,player);broadcastRoom(room);emitProfiles();
      return {id:player.id,token:player.token,code,inputSeq:player.lastSeq,state:room.snapshot(clock())};
    },2,4);
    handle('room:resume',data=>{
      if(socket.data.code)throw new RuleError('Você já está conectado a uma sala.');
      const code=parseCode(data?.code),room=rooms.get(code);if(!room)throw new RuleError('A sala não está mais disponível.');
      if(typeof data?.token!=='string'||data.token.length>100)throw new RuleError('Sessão inválida.');
      const player=[...room.players.values()].find(p=>p.token===data.token);if(!player||player.connected||clock()-player.disconnectedAt>=config.reconnectTime*1000)throw new RuleError('A sessão expirou ou já está conectada.');
      player.connected=true;player.socketId=socket.id;player.disconnectedAt=0;player.inputQueue=[];player.lastInputAt=clock();if(!room.host)room.host=player.id;
      setMembership(socket,room,player);broadcastRoom(room);return {id:player.id,token:player.token,code,inputSeq:player.lastSeq,state:room.snapshot(clock())};
    },2,4);
    handle('room:leave',()=>{leaveCurrent(socket);emitProfiles();return {};},2,4);
    handle('room:map',data=>{const {room,player}=getMembership(socket);if(room.host!==player.id)throw new RuleError('Somente o host escolhe o mapa.');room.selectMap(data?.mapId);broadcastRoom(room);return {state:room.snapshot(clock())};});
    handle('team:select',data=>{const {room,player}=getMembership(socket);room.selectTeam(player,data?.team);broadcastRoom(room);});
    handle('player:ready',data=>{const {room,player}=getMembership(socket);room.setReady(player,data?.ready);broadcastRoom(room);});
    const start=(socket,restart=false)=>{const {room,player}=getMembership(socket);if(room.host!==player.id)throw new RuleError('Somente o host pode iniciar a partida.');if(restart&&room.phase!=='finished')throw new RuleError('A partida ainda não terminou.');room.startMatch(clock());broadcastRoom(room);return {state:room.snapshot(clock())};};
    handle('match:start',()=>start(socket),1,2);
    handle('match:restart',()=>start(socket,true),1,2);
    socket.on('game:input',command=>{if(!consume('input',90,120))return;try{const {room,player}=getMembership(socket);room.enqueue(player,command,clock());}catch{ /* Detached clients cannot submit commands. */ }});
    handle('game:action',data=>{const {room,player}=getMembership(socket);room.action(player,data,clock());broadcastRoom(room);return {state:room.snapshot(clock())};},12,16);
    handle('profile:get',()=>({profile:{...profileState(profiles.get(socket.data.profileId)),token:profiles.get(socket.data.profileId).token}}));
    handle('profile:open',data=>{const drop=profiles.openCrate(socket.data.profileId,data?.type);emitProfiles();return {drop,profile:profileState(profiles.get(socket.data.profileId))};},3,4);
    handle('profile:equip',data=>{
      profiles.equip(socket.data.profileId,data?.kind,data?.skinId);
      const account=profiles.get(socket.data.profileId);
      for(const room of rooms.values()){let changed=false;for(const player of room.players.values())if(player.profileId===account.id){player.cosmetics={...account.equipped};changed=true;}if(changed)broadcastRoom(room);}
      emitProfiles();return {profile:profileState(account)};
    });
    handle('friend:request',data=>{profiles.requestFriend(socket.data.profileId,data?.code);emitProfiles();return {};});
    handle('friend:accept',data=>{profiles.acceptFriend(socket.data.profileId,data?.code);emitProfiles();return {};});
    handle('friend:remove',data=>{profiles.removeFriend(socket.data.profileId,data?.code);emitProfiles();return {};});
    handle('friend:join',data=>{
      const view=profiles.view(socket.data.profileId),friend=view.friends.find(friend=>friend.id===data?.code);
      if(!friend)throw new RuleError('Este jogador não está na sua lista de amigos.');
      for(const room of rooms.values())if([...room.players.values()].some(player=>player.profileId===friend.id&&player.connected))return {code:room.code};
      throw new RuleError('Seu amigo não está em uma sala neste servidor.');
    });
    handle('net:ping',()=>({serverTime:clock()}),2,4);
    socket.on('disconnect',()=>{const room=rooms.get(socket.data.code),player=room?.players.get(socket.data.playerId);if(room&&player&&player.socketId===socket.id){room.disconnect(player,clock());broadcastRoom(room);}emitProfiles();});
  });
  function tick(now=clock()){
    if(closed)return;
    tickIndex++;
    for(const room of rooms.values()){
      room.tick(now);
      if(rooms.has(room.code)&&(options.manualTick||tickIndex%Math.max(1,Math.round(config.tickRate/config.snapshotRate))===0))io.to(room.code).emit('game:snapshot',room.snapshot(now));
      if(now-room.lastProbeAt>=2500){room.lastProbeAt=now;for(const p of room.players.values())if(p.connected&&p.socketId){const start=clock();io.to(p.socketId).timeout(2000).emit('net:probe',{serverTime:start},error=>{if(!error&&p.connected)p.ping=Math.min(2000,Math.max(0,clock()-start));});}}
    }
  }
  let timer=null;
  if(!options.manualTick){let last=performance.now(),accumulator=0,simNow=clock();const step=1000/config.tickRate;timer=setInterval(()=>{const real=performance.now();accumulator=Math.min(250,accumulator+real-last);last=real;while(accumulator>=step){simNow+=step;tick(simNow);accumulator-=step;}},Math.max(2,Math.floor(step/2)));timer.unref();}
  return {app,httpServer,io,rooms,profiles,config,tick,broadcastRoom,
    listen(port=Number(process.env.PORT)||3000,host='0.0.0.0'){return new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(port,host,()=>{httpServer.off('error',reject);resolve(httpServer.address());});});},
    async close(){if(closed)return;closed=true;if(timer)clearInterval(timer);rooms.clear();await new Promise(resolve=>io.close(()=>resolve()));if(httpServer.listening)await new Promise(resolve=>httpServer.close(()=>resolve()));}
  };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const game=createGameServer();game.listen().then(address=>console.log(`Counter Block: http://localhost:${address.port}`)).catch(error=>{console.error(error);process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{game.close().finally(()=>process.exit(0));});
}
