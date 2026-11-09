import test from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { createGameServer } from '../server.js';
import { DT } from '../shared/config.js';
import { WEAPONS } from '../shared/weapons.js';
import { getMap } from '../shared/map-data.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ask = (socket,event,data={}) => socket.timeout(2500).emitWithAck(event,data);
async function accepted(socket,event,data={}) {
  const response=await ask(socket,event,data);
  assert.equal(response.ok,true,`${event}: ${response.error}`);
  return response;
}
async function fixture(t) {
  let now=1_900_000_000_000;
  const server=createGameServer({manualTick:true,now:()=>now});await server.listen(0);
  const clients=[];
  t.after(async()=>{for(const socket of clients)socket.disconnect();await pause(5);await server.close();});
  const connect=async(token)=>{
    const socket=io(`http://127.0.0.1:${server.httpServer.address().port}`,{forceNew:true,reconnection:false,transports:['websocket'],auth:token?{profileToken:token}:{}});
    clients.push(socket);await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
    const account=(await accepted(socket,'profile:get')).profile;
    return {socket,account};
  };
  const create=async(name='Alfa')=>{
    const client=await connect();const auth=await accepted(client.socket,'room:create',{nickname:name});
    return {...client,auth,player:server.rooms.get(auth.code).players.get(auth.id)};
  };
  const join=async(code,name='Bravo')=>{
    const client=await connect();const auth=await accepted(client.socket,'room:join',{code,nickname:name});
    return {...client,auth,player:server.rooms.get(code).players.get(auth.id)};
  };
  const start=async(host,guest)=>{
    await accepted(host.socket,'player:ready',{ready:true});if(guest)await accepted(guest.socket,'player:ready',{ready:true});
    await accepted(host.socket,'match:start');return server.rooms.get(host.auth.code);
  };
  const tick=(count=1)=>{for(let i=0;i<count;i++){now+=DT*1000;server.tick(now);}};
  return {server,connect,create,join,start,tick,get now(){return now;}};
}
const command=(p,seq,changes={})=>({seq,time:0,yaw:p.yaw,pitch:p.pitch,forward:0,strafe:0,jump:false,crouch:false,walk:false,fire:false,interact:false,dash:false,...changes});
const place=(p,x,z)=>Object.assign(p,{x,y:0,z,vx:0,vy:0,vz:0,grounded:true,crouch:false,yaw:0,pitch:0});

test('host selects larger maps independently per room and selection cannot change a live round',async t=>{
  const f=await fixture(t),host=await f.create(),guest=await f.join(host.auth.code),other=await f.create('Outro');
  assert.equal((await ask(guest.socket,'room:map',{mapId:'yard'})).ok,false);
  assert.equal((await ask(host.socket,'room:map',{mapId:'__proto__'})).ok,false);
  await accepted(host.socket,'room:map',{mapId:'yard'});
  await accepted(other.socket,'room:map',{mapId:'depot'});
  const room=await f.start(host,guest),second=await f.start(other);
  assert.equal(room.map,getMap('yard'));assert.equal(second.map,getMap('depot'));
  assert.equal(room.snapshot(f.now).mapId,'yard');assert.equal(second.snapshot(f.now).mapId,'depot');
  assert.equal(host.player.z,room.map.spawns.T[0].z);
  assert.equal((await ask(host.socket,'room:map',{mapId:'dust'})).ok,false);
  place(host.player,room.map.bounds.minX+.31,0);host.player.vx=-13;host.player.dashTime=.18;
  room.enqueue(host.player,command(host.player,1,{strafe:-1}),f.now);f.tick(25);
  assert.ok(host.player.x>=room.map.bounds.minX+.29,'selected map collision prevents leaving its boundary');
});

test('only a server-confirmed enemy kill grants exactly one private crate',async t=>{
  const f=await fixture(t),host=await f.create(),guest=await f.join(host.auth.code),room=await f.start(host,guest);
  const before=(await accepted(host.socket,'profile:get')).profile;
  host.socket.emit('game:event',{type:'kill',attacker:host.player.id,target:guest.player.id});await pause(5);
  let view=(await accepted(host.socket,'profile:get')).profile;
  assert.equal(view.crates.weapon+view.crates.character,0,'client-invented kill events have no authority');
  room.applyDamage(host.player,guest.player,1000,'torso',f.now);
  room.applyDamage(host.player,guest.player,1000,'torso',f.now);
  view=(await accepted(host.socket,'profile:get')).profile;
  assert.equal(view.crates.weapon+view.crates.character,1);
  assert.equal(JSON.stringify(room.snapshot(f.now)).includes(before.token),false);
  assert.equal((await accepted(guest.socket,'profile:get')).profile.crates.weapon+(await accepted(guest.socket,'profile:get')).profile.crates.character,0);
});

test('crate opening consumes one earned crate and owned cosmetics synchronize without changing weapon statistics',async t=>{
  const f=await fixture(t),host=await f.create(),guest=await f.join(host.auth.code),room=await f.start(host,guest);
  assert.equal((await ask(host.socket,'profile:open',{type:'weapon'})).ok,false);
  assert.equal((await ask(host.socket,'profile:equip',{kind:'weapon',skinId:'unowned'})).ok,false);
  room.applyDamage(host.player,guest.player,1000,'torso',f.now);
  const account=(await accepted(host.socket,'profile:get')).profile;
  const kind=account.crates.weapon?'weapon':'character';
  const result=await accepted(host.socket,'profile:open',{type:kind});
  assert.ok(result.profile.owned.includes(result.drop.skin));assert.equal(result.profile.crates[kind],0);
  const before=JSON.stringify(WEAPONS.glock);
  await accepted(host.socket,'profile:equip',{kind,skinId:result.drop.skin});
  assert.equal(host.player.cosmetics[kind],result.drop.skin);
  assert.equal(room.snapshot(f.now).players.find(p=>p.id===host.player.id).cosmetics[kind],result.drop.skin);
  assert.equal(JSON.stringify(WEAPONS.glock),before);
});

test('friends require consent and may locate only an accepted online friend on the same server',async t=>{
  const f=await fixture(t),a=await f.create(),b=await f.connect();
  assert.equal((await ask(b.socket,'friend:join',{code:a.account.id})).ok,false);
  await accepted(a.socket,'friend:request',{code:b.account.id});
  const pending=(await accepted(b.socket,'profile:get')).profile;
  assert.ok(pending.requests.some(friend=>friend.id===a.account.id));
  assert.equal(JSON.stringify(pending.requests).includes(a.account.token),false);
  await accepted(b.socket,'friend:accept',{code:a.account.id});
  const result=await accepted(b.socket,'friend:join',{code:a.account.id});assert.equal(result.code,a.auth.code);
  const friend=(await accepted(b.socket,'profile:get')).profile.friends[0];assert.equal(friend.online,true);assert.equal(friend.roomCode,a.auth.code);
  await accepted(a.socket,'friend:remove',{code:b.account.id});
  assert.equal((await ask(b.socket,'friend:join',{code:a.account.id})).ok,false);
});

test('private account token restores cosmetics and identity independently from room reconnect tokens',async t=>{
  const f=await fixture(t),a=await f.connect();
  const b=await f.connect(a.account.token),c=await f.connect('f'.repeat(64));
  assert.equal(b.account.id,a.account.id);assert.notEqual(c.account.id,a.account.id);
  assert.equal(b.account.token,a.account.token);
});

test('knife slot is available without ammunition and cannot damage a distant target',async t=>{
  const f=await fixture(t),host=await f.create(),guest=await f.join(host.auth.code),room=await f.start(host,guest);
  assert.ok(host.player.inventory.includes('knife'));
  await accepted(host.socket,'game:action',{type:'equip',slot:3});f.tick(12);
  assert.equal(host.player.weapon,'knife');assert.deepEqual(host.player.ammo.knife,{mag:0,reserve:0});
  place(host.player,0,15);place(guest.player,0,10);
  assert.equal(room.fire(host.player,f.now),true);assert.equal(guest.player.hp,100);
  f.tick(30);place(guest.player,0,13.4);f.tick(4);
  assert.equal(room.fire(host.player,f.now),true);assert.ok(guest.player.hp<100);
  assert.deepEqual(host.player.ammo.knife,{mag:0,reserve:0});
});

test('shotgun fires eight server traces but consumes a single shell and obeys fire rate',async t=>{
  const f=await fixture(t),host=await f.create(),room=await f.start(host);
  host.player.money=16000;await accepted(host.socket,'game:action',{type:'buy',item:'scatter'});
  const events=[];room.emit=event=>events.push(event);
  const initial=host.player.ammo.scatter.mag;
  assert.equal(room.fire(host.player,f.now),true);assert.equal(room.fire(host.player,f.now),false);
  assert.equal(host.player.ammo.scatter.mag,initial-1);
  assert.equal(events.find(event=>event.type==='shot').traces.length,8);
});

test('Pulse burst is three authoritative rounds and Vector uses automatic cadence',async t=>{
  const f=await fixture(t),host=await f.create(),room=await f.start(host);
  host.player.money=16000;await accepted(host.socket,'game:action',{type:'buy',item:'pulse'});
  room.enqueue(host.player,command(host.player,1,{fire:true}),f.now);f.tick(15);
  assert.equal(host.player.ammo.pulse.mag,WEAPONS.pulse.mag-3);
  await accepted(host.socket,'game:action',{type:'buy',item:'vector'});
  f.tick(Math.max(0,Math.ceil((host.player.nextShotAt-f.now)/(DT*1000)))+1);
  room.enqueue(host.player,command(host.player,2,{fire:true}),f.now);f.tick(10);
  assert.ok(host.player.ammo.vector.mag<=WEAPONS.vector.mag-2);
});

test('network sanitizes dash flags and synchronizes bounded mobility counters',async t=>{
  const f=await fixture(t),host=await f.create(),room=await f.start(host);
  place(host.player,0,20);
  room.enqueue(host.player,command(host.player,1,{forward:1,jump:true,dash:'true'}),f.now);
  assert.equal(host.player.inputQueue[0].dash,false);
  f.tick();
  room.enqueue(host.player,command(host.player,2,{forward:1,jump:true,crouch:true,dash:true}),f.now);f.tick();
  assert.ok(host.player.dashTime>0);assert.equal(host.player.dashAvailable,false);
  const view=room.snapshot(f.now).players[0];assert.equal(view.dashAvailable,false);assert.ok(view.dashCooldown>0);
  assert.ok(Math.hypot(view.vx,view.vz)<=13.01);
});
