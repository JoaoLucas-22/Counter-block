import { MAP } from './map-data.js';
import { DT } from './config.js';
export { DT };

export const PLAYER_RADIUS = .3;
export const STAND_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.18;
export const STEP_HEIGHT = .32;
export const GRAVITY = 19;
const EPS = 1e-6;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const finite = (v,fallback=0) => Number.isFinite(v) ? v : fallback;
export const playerHeight = body => body.crouch ? CROUCH_HEIGHT : STAND_HEIGHT;
export const eyeHeight = body => body.crouch ? 1.02 : 1.61;
export function createBody(x=0,y=0,z=0) {
  return { x:finite(x),y:finite(y),z:finite(z),vx:0,vy:0,vz:0,grounded:y<=0,crouch:false,
    dashAvailable:true,dashTime:0,dashCooldown:0,dashHeld:false,crouchHeld:false,slideTime:0 };
}
export function direction(yaw=0,pitch=0) {
  const cp=Math.cos(pitch);
  return {x:-Math.sin(yaw)*cp,y:Math.sin(pitch),z:-Math.cos(yaw)*cp};
}
export function inZone(body,zone) {
  return !!zone && Math.abs(body.x-zone.x)<=zone.w/2 && Math.abs(body.z-zone.z)<=zone.d/2;
}

/** Surface height at a point. Ramps use the same data for visuals and collision. */
export function rampHeight(x,z,map=MAP) {
  let result=0;
  for (const r of map.ramps || []) {
    if(Math.abs(x-r.x)>r.w/2+EPS || Math.abs(z-r.z)>r.d/2+EPS) continue;
    const t=r.direction==='x' ? (x-r.x)/r.w+.5 : (z-r.z)/r.d+.5;
    result=Math.max(result,r.height*(r.sign===-1 ? 1-t : t));
  }
  return result;
}
function overlapsHorizontal(x,z,b,radius=PLAYER_RADIUS) {
  return x+radius>b.x-b.w/2+EPS && x-radius<b.x+b.w/2-EPS &&
    z+radius>b.z-b.d/2+EPS && z-radius<b.z+b.d/2-EPS;
}
function overlapsBody(x,y,z,height,b) {
  return overlapsHorizontal(x,z,b) && y<b.y+b.h/2-EPS && y+height>b.y-b.h/2+EPS;
}
function canOccupy(x,y,z,height,map) {
  for(const b of map.solids) if(overlapsBody(x,y,z,height,b)) return false;
  return true;
}
function rampSurface(r,x,z) {
  const t=r.direction==='x' ? (x-r.x)/r.w+.5 : (z-r.z)/r.d+.5;
  return r.height*clamp(r.sign===-1 ? 1-t : t,0,1);
}
function moveAxis(body,axis,amount,height,mayStep,map) {
  if(!amount) return;
  body[axis]+=amount;
  for(const b of map.solids) {
    if(!overlapsBody(body.x,body.y,body.z,height,b)) continue;
    const top=b.y+b.h/2;
    if(mayStep && top-body.y<=STEP_HEIGHT+EPS && top>=body.y-EPS && canOccupy(body.x,top,body.z,height,map)) {
      body.y=top;
      continue;
    }
    if(axis==='x') {
      body.x=amount>0 ? b.x-b.w/2-PLAYER_RADIUS : b.x+b.w/2+PLAYER_RADIUS;
      body.vx=0;
    } else {
      body.z=amount>0 ? b.z-b.d/2-PLAYER_RADIUS : b.z+b.d/2+PLAYER_RADIUS;
      body.vz=0;
    }
  }
  for(const r of map.ramps || []) {
    const b={x:r.x,z:r.z,w:r.w,d:r.d};
    if(!overlapsHorizontal(body.x,body.z,b)) continue;
    const surface=rampSurface(r,body.x,body.z);
    // Block the tall sides of the wedge; the shallow slope remains walkable.
    if(surface<=body.y+STEP_HEIGHT+EPS || body.y+height<=0) continue;
    if(axis==='x') {
      body.x=amount>0 ? r.x-r.w/2-PLAYER_RADIUS : r.x+r.w/2+PLAYER_RADIUS;
      body.vx=0;
    } else {
      body.z=amount>0 ? r.z-r.d/2-PLAYER_RADIUS : r.z+r.d/2+PLAYER_RADIUS;
      body.vz=0;
    }
  }
}
function groundBelow(body,maxDrop,map) {
  let support=rampHeight(body.x,body.z,map);
  for(const b of map.solids) {
    const top=b.y+b.h/2;
    if(top<=body.y+EPS && top>=body.y-maxDrop-EPS && overlapsHorizontal(body.x,body.z,b)) support=Math.max(support,top);
  }
  return support;
}

/**
 * Shared deterministic movement. The caller advances exactly one DT per command;
 * clients cannot choose simulation duration. dt is bounded as a defensive fallback.
 * A feet-based AABB slides along walls and climbs only small, head-clear steps.
 */
export function movePlayer(body,input={},dt=DT,speed=6,map=MAP) {
  dt=clamp(finite(dt,DT),0,.05);
  if(dt===0) return body;
  // Counters live in the shared body so reconciliation can replay exactly the
  // same dash/slide state. Neither their duration nor velocity comes from input.
  body.dashTime=Math.max(0,finite(body.dashTime)-dt);
  body.dashCooldown=Math.max(0,finite(body.dashCooldown)-dt);
  body.slideTime=Math.max(0,finite(body.slideTime)-dt);
  if(body.dashAvailable===undefined) body.dashAvailable=true;
  if(body.grounded) body.dashAvailable=true;
  const crouchPressed=!!input.crouch && !body.crouchHeld;
  body.crouchHeld=!!input.crouch;
  const standingClear=canOccupy(body.x,body.y,body.z,STAND_HEIGHT,map);
  body.crouch=!!input.crouch || (!standingClear && !!body.crouch);
  const height=playerHeight(body);
  const yaw=finite(input.yaw);
  let f=clamp(finite(input.forward),-1,1),s=clamp(finite(input.strafe),-1,1);
  const len=Math.hypot(f,s);
  if(len>1) {f/=len;s/=len;}
  const wx=-Math.sin(yaw)*f+Math.cos(yaw)*s;
  const wz=-Math.cos(yaw)*f-Math.sin(yaw)*s;
  const wishLength=Math.hypot(wx,wz);
  const dx=wishLength>EPS ? wx/wishLength : 0;
  const dz=wishLength>EPS ? wz/wishLength : 0;
  const maxSpeed=clamp(finite(speed,6),1,8)*(body.crouch?.46:input.walk?.52:1);
  const jumping=!!input.jump && body.grounded;
  const horizontalBefore=Math.hypot(body.vx,body.vz);
  if(body.grounded && crouchPressed && horizontalBefore>4 && !jumping) {
    body.slideTime=.35;
    const boost=Math.min(9,Math.max(7.5,horizontalBefore*1.15))/horizontalBefore;
    body.vx*=boost;body.vz*=boost;
  }
  if(!body.crouch) body.slideTime=0;
  if(jumping) {body.vy=6.2;body.grounded=false;body.slideTime=0;}
  // Space + crouch is transmitted as raw `dash`, independently of jump edges.
  // A combo must be released before another activation, even across landing.
  const dash=!!input.dash || (!!input.jump && !!input.crouch);
  if(dash && !body.dashHeld && !body.grounded && body.dashAvailable && body.dashCooldown===0) {
    let dashX=dx,dashZ=dz;
    if(wishLength<EPS) {
      dashX=horizontalBefore>EPS ? body.vx/horizontalBefore : -Math.sin(yaw);
      dashZ=horizontalBefore>EPS ? body.vz/horizontalBefore : -Math.cos(yaw);
    }
    body.vx=dashX*13;body.vz=dashZ*13;
    body.dashAvailable=false;body.dashTime=.18;body.dashCooldown=1.2;
  }
  body.dashHeld=dash;
  if(body.grounded) {
    const horizontal=Math.hypot(body.vx,body.vz);
    if(horizontal>EPS) {
      const next=Math.max(0,horizontal-Math.max(1.5,horizontal)*(body.slideTime>0?2.5:7.5)*dt);
      body.vx*=next/horizontal; body.vz*=next/horizontal;
    }
  }
  if(wishLength>EPS && body.dashTime===0) {
    // Air projection cap permits strafing without instant mid-air redirection.
    const wishSpeed=maxSpeed*Math.min(1,wishLength);
    const add=(body.grounded ? wishSpeed : Math.min(wishSpeed,1.8))-(body.vx*dx+body.vz*dz);
    if(add>0) {
      const accel=Math.min(add,(body.grounded?11:2.8)*wishSpeed*dt);
      body.vx+=dx*accel; body.vz+=dz*accel;
    }
  }
  const horizontal=Math.hypot(body.vx,body.vz);
  const hardCap=body.dashTime>0 ? 13 : body.slideTime>0 ? 9 : Math.max(maxSpeed,8.5);
  if(horizontal>hardCap) {body.vx*=hardCap/horizontal;body.vz*=hardCap/horizontal;}
  // Substeps prevent tunnelling if a bounded catch-up dt is used.
  const n=Math.max(1,Math.ceil(Math.max(Math.abs(body.vx),Math.abs(body.vz))*dt/.16));
  const sub=dt/n;
  for(let i=0;i<n;i++) {
    const previousY=body.y;
    const wasGrounded=body.grounded;
    moveAxis(body,'x',body.vx*sub,height,wasGrounded,map);
    moveAxis(body,'z',body.vz*sub,height,wasGrounded,map);
    // Follow rising ramps while grounded, but never pull a jumping player down.
    const ramp=rampHeight(body.x,body.z,map);
    if(wasGrounded && ramp>body.y && ramp-body.y<=STEP_HEIGHT && canOccupy(body.x,ramp,body.z,height,map)) body.y=ramp;
    body.vy-=GRAVITY*sub;
    const oldY=body.y;
    body.y+=body.vy*sub;
    body.grounded=false;
    for(const b of map.solids) {
      if(!overlapsHorizontal(body.x,body.z,b)) continue;
      const top=b.y+b.h/2,bottom=b.y-b.h/2;
      if(body.vy<=0 && oldY>=top-EPS && body.y<top) {
        body.y=top; body.vy=0;body.grounded=true;
      } else if(body.vy>0 && oldY+height<=bottom+EPS && body.y+height>bottom) {
        body.y=bottom-height;body.vy=0;
      }
    }
    const floor=rampHeight(body.x,body.z,map);
    if(body.y<=floor && oldY>=floor-STEP_HEIGHT && body.vy<=0) {
      body.y=floor;body.vy=0;body.grounded=true;
    }
    if(wasGrounded && body.vy<=0 && !body.grounded) {
      const support=groundBelow(body,STEP_HEIGHT,map);
      if(body.y-support<=STEP_HEIGHT && body.y>=support-EPS) {
        body.y=support;body.vy=0;body.grounded=true;
      }
    }
    // The zero plane is always solid, including the foot of a ramp.
    if(body.y<0) {body.y=0;body.vy=0;body.grounded=true;}
    if(!Number.isFinite(body.y)) body.y=previousY;
  }
  if(body.grounded) {body.dashAvailable=true;body.dashTime=0;}
  return body;
}

/** Slab intersection against a centred box, including rays beginning inside it. */
export function rayAABB(origin,dir,box,maxDistance=200) {
  let near=0,far=maxDistance;
  for(const [axis,size] of [['x','w'],['y','h'],['z','d']]) {
    const min=box[axis]-box[size]/2,max=box[axis]+box[size]/2;
    if(Math.abs(dir[axis])<1e-9) {
      if(origin[axis]<min || origin[axis]>max) return null;
      continue;
    }
    let a=(min-origin[axis])/dir[axis],b=(max-origin[axis])/dir[axis];
    if(a>b) [a,b]=[b,a];
    near=Math.max(near,a);far=Math.min(far,b);
    if(near>far) return null;
  }
  return far<0 || near>maxDistance ? null : near;
}
/** Ramp volumes are intersected with bounded line sampling after AABB broadphase. */
function rayRamp(origin,dir,r,maxDistance) {
  const box={x:r.x,y:r.height/2,z:r.z,w:r.w,h:r.height,d:r.d};
  const near=rayAABB(origin,dir,box,maxDistance);
  if(near===null) return null;
  // A ramp is a convex wedge: clip the ray by the slope plane as well as its box.
  let lo=near,hi=maxDistance;
  for(const [axis,size] of [['x','w'],['y','h'],['z','d']]) {
    if(Math.abs(dir[axis])>1e-9) {
      const a=(box[axis]-box[size]/2-origin[axis])/dir[axis];
      const b=(box[axis]+box[size]/2-origin[axis])/dir[axis];
      hi=Math.min(hi,Math.max(a,b));
    }
  }
  const axis=r.direction==='x'?'x':'z',span=r.direction==='x'?r.w:r.d;
  const slope=r.height/span*(r.sign===-1?-1:1);
  const surface=r.height/2+slope*(origin[axis]-r[axis]);
  const a=origin.y-surface,b=dir.y-slope*dir[axis];
  if(Math.abs(b)<1e-9) return a<=0 ? lo : null;
  const t=-a/b;
  if(b>0) hi=Math.min(hi,t);else lo=Math.max(lo,t);
  return lo<=hi+EPS && lo<=maxDistance ? Math.max(0,lo) : null;
}
export function traceWorld(origin,dir,maxDistance=200,map=MAP) {
  let nearest=maxDistance,result=null;
  for(const box of map.solids) {
    const d=rayAABB(origin,dir,box,nearest);
    if(d!==null && d<=nearest) {nearest=d;result=d;}
  }
  for(const ramp of map.ramps||[]) {
    const d=rayRamp(origin,dir,ramp,nearest);
    if(d!==null && d<=nearest) {nearest=d;result=d;}
  }
  if(dir.y<0) {
    const d=-origin.y/dir.y;
    if(d>=0 && d<=nearest) result=d;
  }
  return result;
}
export function hitboxes(body) {
  const scale=body.crouch?.66:1;
  const yaw=finite(body.yaw),cos=Math.cos(yaw),sin=Math.sin(yaw);
  const absCos=Math.abs(cos),absSin=Math.abs(sin);
  // Match the character's Y rotation. Enclosing AABBs stay compatible with the
  // shared slab raycast while placing each limb on the correct side of the body.
  const box=(x,y,z,w,h,d,rotate=true)=>({
    x:body.x+x*cos+z*sin,
    y:body.y+y*scale,
    z:body.z-x*sin+z*cos,
    w:rotate ? absCos*w+absSin*d : w,
    h:h*scale,
    d:rotate ? absSin*w+absCos*d : d,
  });
  return [
    {region:'head',box:box(0,1.61,0,.36,.36,.36,false),multiplier:4},
    {region:'torso',box:box(0,1.06,0,.52,.72,.36),multiplier:1},
    {region:'arms',box:box(-.36,1.04,0,.18,.68,.25),multiplier:.85},
    {region:'arms',box:box(.36,1.04,0,.18,.68,.25),multiplier:.85},
    {region:'legs',box:box(-.16,.36,0,.23,.72,.28),multiplier:.75},
    {region:'legs',box:box(.16,.36,0,.23,.72,.28),multiplier:.75},
  ];
}
