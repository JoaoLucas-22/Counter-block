import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP, MAPS, getMap } from '../shared/map-data.js';
import { DT, createBody, movePlayer, traceWorld, inZone } from '../shared/physics.js';

const advance=(body,input,count=1,map=MAP)=>{
  for(let i=0;i<count;i++) movePlayer(body,input,DT,6,map);
  return body;
};
const horizontal=body=>Math.hypot(body.vx,body.vz);

test('map selection is allowlisted, isolated and keeps the original Dust Block',()=>{
  assert.equal(getMap('dust'),MAP);
  for(const value of ['missing','constructor','__proto__',null,{},['yard']]) assert.equal(getMap(value),MAP);
  assert.equal(Object.keys(MAPS).length,3);
  assert.ok(MAPS.yard.bounds.maxX>MAP.bounds.maxX);
  assert.ok(MAPS.depot.bounds.maxX>MAPS.yard.bounds.maxX);
  const origin={x:40,y:1,z:40},direction={x:1,y:0,z:0};
  assert.equal(traceWorld(origin,direction,200,MAPS.yard),7.5);
  assert.equal(traceWorld(origin,direction,200,MAPS.depot),11.5);
  assert.equal(traceWorld(origin,direction,200),null,'explicit map calls never mutate the default map');
});

for(const map of Object.values(MAPS)) {
  test(`${map.name}: all spawns and sites fit and the opposing base is reachable`,()=>{
    for(const team of ['T','CT']) for(const spawn of map.spawns[team]) {
      assert.ok(inZone(spawn,map.buyZones[team]));
      const body=createBody(spawn.x,spawn.y,spawn.z);
      advance(body,{},5,map);
      assert.deepEqual([body.x,body.y,body.z],[spawn.x,spawn.y,spawn.z]);
      assert.equal(body.grounded,true);
    }
    for(const site of Object.values(map.sites)) {
      const body=createBody(site.x,0,site.z);
      advance(body,{},5,map);
      assert.equal(body.y,0,'site center must be unobstructed ground');
    }
    const free=(x,z)=>!map.solids.some(box=>box.y-box.h/2<1.8 && box.y+box.h/2>.32 &&
      x+.31>box.x-box.w/2 && x-.31<box.x+box.w/2 && z+.31>box.z-box.d/2 && z-.31<box.z+box.d/2);
    const spawn=map.spawns.T[2],seen=new Set([`${spawn.x},${spawn.z}`]),queue=[[spawn.x,spawn.z]];
    for(let i=0;i<queue.length;i++) {
      const [x,z]=queue[i];
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx=x+dx,nz=z+dz,key=`${nx},${nz}`;
        if(nx<=map.bounds.minX||nx>=map.bounds.maxX||nz<=map.bounds.minZ||nz>=map.bounds.maxZ||seen.has(key)||!free(nx,nz))continue;
        seen.add(key);queue.push([nx,nz]);
      }
    }
    for(const site of Object.values(map.sites)) assert.ok(seen.has(`${site.x},${site.z}`),'both sites are reachable from T');
    assert.ok(seen.has(`${map.spawns.CT[2].x},${map.spawns.CT[2].z}`),'bases have connected routes');
  });

  test(`${map.name}: snapshot replay preserves all dash and slide counters`,()=>{
    const spawn=map.spawns.T[2],server=createBody(spawn.x,spawn.y,spawn.z);
    const commands=Array.from({length:80},(_,i)=>({
      forward:1,yaw:0,jump:i===15,crouch:i>=20&&i<35,dash:i>=20&&i<30,
    }));
    for(const command of commands.slice(0,25))movePlayer(server,command,DT,6,map);
    const client=structuredClone(server);
    assert.ok(server.dashTime>0,'snapshot falls inside the active dash');
    for(const command of commands.slice(25)) {
      movePlayer(server,command,DT,6,map);movePlayer(client,command,DT,6,map);
      assert.deepEqual(client,server);
      assert.ok(horizontal(server)<=13+1e-8);
      assert.ok(Object.values(server).every(value=>typeof value!=='number'||Number.isFinite(value)));
    }
  });
}

test('jump plus crouch dashes once in the air and cannot be refreshed by repeated packets',()=>{
  const body=createBody(0,0,27);
  advance(body,{forward:1},15);
  advance(body,{forward:1,jump:true});
  advance(body,{forward:1,crouch:true,dash:true});
  assert.equal(body.dashAvailable,false);
  assert.equal(body.dashTime,.18);
  assert.equal(body.dashCooldown,1.2);
  assert.ok(Math.abs(horizontal(body)-13)<1e-8);
  advance(body,{forward:1,crouch:true,dash:true},4);
  const cooldown=body.dashCooldown;
  advance(body,{forward:1,crouch:true,dash:false});
  advance(body,{forward:1,crouch:true,dash:true});
  assert.ok(body.dashCooldown<cooldown,'repeated combo edges do not reset the cooldown');
  assert.equal(body.dashAvailable,false);
  advance(body,{crouch:true,dash:true},100);
  assert.equal(body.grounded,true);
  assert.equal(body.dashAvailable,true);
  assert.equal(body.dashTime,0,'holding the combo through landing does not launch another dash');
  assert.ok(horizontal(body)<.1);
});

test('dash uses swept substeps and cannot tunnel through a thin solid wall',()=>{
  const map={...MAP,solids:[{x:.65,y:2,z:0,w:.1,h:4,d:10}],ramps:[]};
  const body=createBody(0,1,0);
  movePlayer(body,{strafe:1,crouch:true,dash:true},.05,6,map);
  assert.ok(body.x<=.3+1e-8);
  assert.equal(body.vx,0);
  for(let i=0;i<60;i++)movePlayer(body,{strafe:1,crouch:true,dash:true},DT,6,map);
  assert.ok(body.x<=.3+1e-8);
});

test('a fast grounded crouch slides and held crouch cannot repeatedly boost speed',()=>{
  const sliding=createBody(0,0,27);
  advance(sliding,{forward:1},20);
  const ordinary={...sliding,crouchHeld:true};
  advance(sliding,{forward:1,crouch:true});
  advance(ordinary,{forward:1,crouch:true});
  assert.equal(sliding.crouch,true);
  assert.equal(sliding.slideTime,.35);
  assert.ok(horizontal(sliding)>horizontal(ordinary));
  assert.ok(horizontal(sliding)<=9);
  advance(sliding,{crouch:true},30);
  advance(ordinary,{crouch:true},30);
  assert.ok(sliding.z<ordinary.z,'slide preserves momentum longer than ordinary crouching');
  assert.equal(sliding.slideTime,0);
  const before=horizontal(sliding);
  advance(sliding,{crouch:true},10);
  assert.ok(horizontal(sliding)<=before);
});
