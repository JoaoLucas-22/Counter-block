import test from 'node:test';
import assert from 'node:assert/strict';
import { createBody,movePlayer,DT,eyeHeight,rayAABB,traceWorld,hitboxes,direction,inZone,rampHeight } from '../shared/physics.js';
import { MAP } from '../shared/map-data.js';
const tick=(body,input,n=1,speed=6)=>{for(let i=0;i<n;i++) movePlayer(body,input,DT,speed);return body;};

test('ground acceleration, residual momentum, and counter-strafing use velocity',()=>{
  const b=createBody(0,0,20);
  tick(b,{forward:1},1);
  assert.ok(-b.vz>0 && -b.vz<6);
  tick(b,{forward:1},30);
  assert.ok(Math.abs(b.vz+6)<1e-8);
  const coasting={...b},braking={...b};
  tick(coasting,{},3);tick(braking,{forward:-1},3);
  assert.ok(Math.abs(coasting.vz)>0,'release should not stop instantly');
  assert.ok(Math.abs(braking.vz)<Math.abs(coasting.vz),'opposite input brakes faster');
});

test('normalizing diagonal input prevents faster diagonal movement',()=>{
  const straight=createBody(0,0,25),diagonal=createBody(0,0,25);
  tick(straight,{forward:1},20);tick(diagonal,{forward:1,strafe:1},20);
  assert.ok(Math.abs(Math.hypot(diagonal.vx,diagonal.vz)-Math.hypot(straight.vx,straight.vz))<1e-8);
});

test('solid walls prevent tunnelling and preserve tangential sliding',()=>{
  const b=createBody(29,0,0);
  tick(b,{strafe:1,forward:.3},180);
  assert.ok(b.x<=31.2+1e-6);
  assert.ok(b.z<0,'should slide along the boundary');
  assert.equal(b.vx,0);
  const building=createBody(0,0,10);
  tick(building,{strafe:1},200);
  assert.ok(building.x<=6.7+1e-6);
});

test('jumping is ballistic, lands, and air acceleration stays bounded',()=>{
  const b=createBody(0,0,20);
  tick(b,{jump:true},1);
  assert.equal(b.grounded,false);
  assert.ok(b.y>0);
  tick(b,{forward:1,strafe:1},100);
  assert.equal(b.y,0);
  assert.equal(b.grounded,true);
  assert.ok(Math.hypot(b.vx,b.vz)<=8.5+1e-6);
});

test('walk and crouch reduce movement and crouch lowers the eye',()=>{
  const a=createBody(0,0,25),b=createBody(0,0,25),c=createBody(0,0,25);
  tick(a,{forward:1},20);tick(b,{forward:1,walk:true},20);tick(c,{forward:1,crouch:true},20);
  assert.ok(Math.abs(c.vz)<Math.abs(b.vz) && Math.abs(b.vz)<Math.abs(a.vz));
  assert.ok(eyeHeight(c)<eyeHeight(a));
});

test('small step and ramp climb are continuous and tall ramp sides block',()=>{
  const step=createBody(-25,0,-2);
  tick(step,{forward:1},22);
  assert.ok(Math.abs(step.y-.24)<1e-6);
  const ramp=createBody(-25,0,-9);
  let previous=0,maxDelta=0;
  for(let i=0;i<75;i++) {tick(ramp,{forward:1});maxDelta=Math.max(maxDelta,Math.abs(ramp.y-previous));previous=ramp.y;}
  assert.ok(ramp.y>.85,'ramp must reach platform');
  assert.ok(maxDelta<.1,'ramp movement should remain gradual');
  const side=createBody(-30,0,-13.5);
  tick(side,{strafe:1},80);
  assert.ok(side.x<=-28.3+1e-6,'cannot move through solid side of ramp');
  assert.ok(Math.abs(rampHeight(-25,-13)-.45)<1e-8);
});

test('shared camera direction agrees with yaw and pitch conventions',()=>{
  assert.deepEqual(direction(0,0),{x:-0,y:0,z:-1});
  assert.ok(direction(Math.PI/2,0).x<-.999);
  assert.ok(direction(0,Math.PI/4).y>0);
});

test('ray traces honor obstructions, regions, and exact distance',()=>{
  const box={x:0,y:1,z:-5,w:2,h:2,d:2};
  assert.equal(rayAABB({x:0,y:1,z:0},{x:0,y:0,z:-1},box),4);
  assert.equal(rayAABB({x:4,y:1,z:0},{x:0,y:0,z:-1},box),null);
  assert.equal(rayAABB({x:0,y:1,z:-5},{x:0,y:0,z:-1},box),0);
  const wall=traceWorld({x:0,y:1.5,z:10},{x:1,y:0,z:0});
  assert.ok(Math.abs(wall-7)<1e-6);
  const boxes=hitboxes(createBody(0,0,0));
  assert.ok(boxes.find(h=>h.region==='head').multiplier>boxes.find(h=>h.region==='legs').multiplier);
  assert.equal(traceWorld({x:0,y:5,z:20},{x:0,y:-1,z:0}),5);
});

test('limb hitboxes rotate with yaw and retain enclosing horizontal bounds',()=>{
  const body={...createBody(4,0,7),yaw:0};
  const straight=hitboxes(body);
  const turned=hitboxes({...body,yaw:Math.PI/2});
  const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} should equal ${expected}`);
  for(const region of ['arms','legs']) {
    const before=straight.filter(h=>h.region===region);
    const after=turned.filter(h=>h.region===region);
    for(let i=0;i<before.length;i++) {
      near(after[i].box.x,body.x);
      near(after[i].box.z,body.z-(before[i].box.x-body.x));
      near(after[i].box.w,before[i].box.d);
      near(after[i].box.d,before[i].box.w);
      near(after[i].box.y,before[i].box.y);
    }
  }
  assert.deepEqual(turned.find(h=>h.region==='head').box,straight.find(h=>h.region==='head').box);
  const diagonal=hitboxes({...body,yaw:Math.PI/4}).find(h=>h.region==='arms').box;
  near(diagonal.w,(.18+.25)/Math.sqrt(2));
  near(diagonal.d,(.18+.25)/Math.sqrt(2));
  const crouched=hitboxes({...body,yaw:Math.PI/2,crouch:true}).find(h=>h.region==='arms').box;
  near(crouched.h,.68*.66);
});

test('invalid command fields cannot introduce NaN or arbitrary displacement',()=>{
  const b=createBody(0,0,20);
  movePlayer(b,{forward:Infinity,strafe:NaN,yaw:NaN},1000);
  assert.ok(Object.values(b).every(v=>typeof v!=='number'||Number.isFinite(v)));
  assert.equal(b.x,0);assert.equal(b.z,20);
  tick(b,{forward:1000000},1);
  assert.ok(Math.abs(b.z-20)<.1);
});

test('spawns are separated, all players fit, and both sites have accessible zones',()=>{
  assert.equal(MAP.spawns.T.length,5);assert.equal(MAP.spawns.CT.length,5);
  for(const team of ['T','CT']) for(const spawn of MAP.spawns[team]) {
    assert.equal(inZone(spawn,MAP.buyZones[team]),true);
    const b=createBody(spawn.x,spawn.y,spawn.z);
    tick(b,{},5);
    assert.equal(b.x,spawn.x);assert.equal(b.z,spawn.z);assert.equal(b.y,0);
  }
  for(const zone of Object.values(MAP.sites)) {
    const b=createBody(zone.x,0,zone.z);
    tick(b,{},5);
    assert.equal(b.y,0,'site center should be unobstructed ground');
    assert.ok(inZone(b,zone));
  }
});

test('both bombsites and opposing spawn are reachable through standing-width corridors',()=>{
  const free=(x,z)=>!MAP.solids.some(b=>b.y-b.h/2<1.8 && b.y+b.h/2>.32 &&
    x+.31>b.x-b.w/2 && x-.31<b.x+b.w/2 && z+.31>b.z-b.d/2 && z-.31<b.z+b.d/2);
  const seen=new Set(['0,27']),queue=[[0,27]];
  for(let i=0;i<queue.length;i++) {
    const [x,z]=queue[i];
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx=x+dx,nz=z+dz,key=`${nx},${nz}`;
      if(Math.abs(nx)>31 || Math.abs(nz)>31 || seen.has(key) || !free(nx,nz)) continue;
      seen.add(key);queue.push([nx,nz]);
    }
  }
  for(const zone of Object.values(MAP.sites)) assert.ok(seen.has(`${zone.x},${zone.z}`));
  assert.ok(seen.has('0,-27'));
});
