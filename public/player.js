import * as THREE from 'three';
import { createWeaponModel } from './weapons.js';
import { SKINS } from '../shared/cosmetics.js';

function nicknameTexture(name,team) {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=80;
  const context=canvas.getContext('2d');
  context.fillStyle='rgba(10,18,25,.82)';context.roundRect(8,8,496,64,9);context.fill();
  context.fillStyle=team==='T'?'#ffbe79':'#8ae0ff';context.font='700 32px system-ui';
  context.textAlign='center';context.textBaseline='middle';context.fillText(String(name||'Jogador').slice(0,20),256,41,465);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

/** Articulated original operator; authoritative body coordinates remain untouched. */
export function createCharacter(initial) {
  const group=new THREE.Group(),body=new THREE.Group();body.name='operator-body';group.add(body);
  const materials={
    uniform:new THREE.MeshStandardMaterial({color:0x965533,roughness:.86}),
    vest:new THREE.MeshStandardMaterial({color:0x4b4234,roughness:.9}),
    skin:new THREE.MeshStandardMaterial({color:0xcba780,roughness:.85}),
    dark:new THREE.MeshStandardMaterial({color:0x202a2c,roughness:.85}),
    visor:new THREE.MeshStandardMaterial({color:0x86adb4,roughness:.25,metalness:.45}),
    team:new THREE.MeshStandardMaterial({color:initial.team==='T'?0xffad54:0x63d1ff,roughness:.5,emissive:initial.team==='T'?0x392009:0x08283c,emissiveIntensity:.3}),
  };
  const box=(w,h,d,x,y,z,key,parent=body)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),materials[key]);
    mesh.position.set(x,y,z);mesh.castShadow=true;parent.add(mesh);return mesh;
  };
  box(.43,.55,.28,0,1.10,0,'uniform');box(.46,.40,.31,0,1.13,-.015,'vest');
  box(.13,.13,.035,-.115,1.10,-.185,'uniform');box(.13,.13,.035,.115,1.10,-.185,'uniform');
  box(.44,.09,.30,0,.80,0,'dark');box(.15,.13,.15,0,1.43,0,'skin');
  // These bright armbands and chest tabs always show team identity, independently of skins.
  box(.11,.07,.035,0,1.30,-.185,'team');
  const head=new THREE.Group();head.position.y=1.61;body.add(head);
  box(.30,.31,.29,0,0,0,'skin',head);box(.32,.14,.31,0,.10,.004,'dark',head);
  box(.31,.075,.02,0,.022,-.15,'visor',head);box(.31,.11,.30,0,-.11,0,'dark',head);
  const legs=[-1,1].map(sign=>{
    const hip=new THREE.Group();hip.position.set(sign*.13,.77,0);hip.name=`hip:${sign}`;body.add(hip);
    box(.19,.29,.23,0,-.145,0,'uniform',hip);
    const knee=new THREE.Group();knee.position.y=-.29;knee.name=`knee:${sign}`;hip.add(knee);
    box(.17,.26,.21,0,-.13,0,'uniform',knee);box(.205,.16,.33,0,-.32,-.04,'dark',knee);
    box(.20,.11,.055,0,.015,-.13,'vest',knee);return {hip,knee};
  });
  const arms=[-1,1].map(sign=>{
    const shoulder=new THREE.Group();shoulder.position.set(sign*.31,1.31,0);body.add(shoulder);
    box(.17,.25,.19,0,-.12,-.02,'uniform',shoulder);box(.18,.065,.20,0,-.12,-.02,'team',shoulder);
    const elbow=new THREE.Group();elbow.position.set(0,-.25,0);shoulder.add(elbow);
    box(.15,.22,.18,0,-.11,-.015,'uniform',elbow);box(.15,.10,.18,0,-.255,-.035,'dark',elbow);
    return {shoulder,elbow};
  });
  const weaponAnchor=new THREE.Group();weaponAnchor.position.set(.24,1.02,-.19);body.add(weaponAnchor);
  const flashMaterial=new THREE.MeshBasicMaterial({color:0xffce72,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false});
  const muzzleFlash=new THREE.Mesh(new THREE.ConeGeometry(.05,.13,5),flashMaterial);
  muzzleFlash.rotation.x=-Math.PI/2;muzzleFlash.visible=false;weaponAnchor.add(muzzleFlash);
  let gun,weaponId,weaponSkin,lastTeam,lastSkin,lastName=initial.nickname;
  // Stable screen size keeps names readable at mid-range; visibility still uses
  // the game's line-of-sight, smoke, distance and accessibility checks.
  const labelMaterial=new THREE.SpriteMaterial({map:nicknameTexture(lastName,initial.team),transparent:true,depthTest:true,depthWrite:false,sizeAttenuation:false});
  const label=new THREE.Sprite(labelMaterial);label.position.y=1.97;label.scale.set(.36,.056,1);group.add(label);
  let deathTilt=0,flashRemaining=0,shotTime=0,landing=0,wasGrounded=true;
  const api={
    group,
    update(player,time=0,dt=.016) {
      group.position.set(player.x,player.y,player.z);group.rotation.y=player.yaw||0;
      const characterSkin=player.cosmetics?.character||'default';
      if(player.team!==lastTeam||characterSkin!==lastSkin){
        lastTeam=player.team;lastSkin=characterSkin;
        const finish=characterSkin!=='default'&&SKINS[characterSkin]?.kind==='character'?SKINS[characterSkin].colors:{};
        materials.uniform.color.set(finish.uniform??(lastTeam==='T'?0x965533:0x3d627a));
        materials.vest.color.set(finish.vest??(lastTeam==='T'?0x4b4234:0x253b48));
        materials.team.color.setHex(lastTeam==='T'?0xffad54:0x63d1ff);
      }
      if(player.nickname!==lastName||labelMaterial.userData.team!==player.team){
        lastName=player.nickname;labelMaterial.map.dispose();labelMaterial.map=nicknameTexture(lastName,player.team);labelMaterial.userData.team=player.team;
      }
      const crouch=player.crouch?.66:1;body.scale.y=THREE.MathUtils.lerp(body.scale.y,crouch,Math.min(1,dt*18));
      label.position.y=body.scale.y*1.8+.23;
      head.rotation.x=(player.pitch||0)*.45;
      const speed=Math.hypot(player.vx||0,player.vz||0),walking=Math.min(speed/6,1),grounded=player.grounded!==false;
      const cycle=time*(player.walk?8:12),stride=Math.sin(cycle)*walking*.55;
      const dash=player.dashTime>0,slide=player.slideTime>0,reloading=!!player.reloadingAt;
      if(grounded&&!wasGrounded)landing=.08;wasGrounded=grounded;landing*=Math.exp(-dt*12);
      for(let i=0;i<2;i++){
        const direction=i===0?1:-1;
        legs[i].hip.rotation.x=grounded?stride*direction:(dash?-.65:player.vy>0?-.38:.18);
        legs[i].knee.rotation.x=grounded?Math.max(0,-stride*direction)*.9:.65;
        if(slide){legs[i].hip.rotation.x=-.7;legs[i].knee.rotation.x=.38;}
        arms[i].shoulder.rotation.x=(i===0?-.35:-.75)+stride*direction*.16;
        arms[i].elbow.rotation.x=-.25-(dash?.3:0);
      }
      if(reloading){arms[0].shoulder.rotation.x=-1.0;arms[0].elbow.rotation.x=-.65+Math.sin(time*8)*.25;}
      shotTime=Math.max(0,shotTime-dt);weaponAnchor.rotation.x=(player.pitch||0)+Math.sin(shotTime*22)*.035;
      if(player.weapon==='knife'&&shotTime>0){arms[1].shoulder.rotation.x-=Math.sin(shotTime/.22*Math.PI)*1.0;weaponAnchor.rotation.z=-Math.sin(shotTime/.22*Math.PI)*.65;}
      else weaponAnchor.rotation.z=0;
      const nextSkin=player.cosmetics?.weapon||'default';
      if(weaponId!==player.weapon||weaponSkin!==nextSkin){
        if(gun){weaponAnchor.remove(gun);gun.userData.dispose();}
        weaponId=player.weapon;weaponSkin=nextSkin;gun=createWeaponModel(weaponId||'glock',weaponSkin);weaponAnchor.add(gun);
        muzzleFlash.position.set(0,.032,gun.userData.muzzleZ-.04);
      }
      flashRemaining=Math.max(0,flashRemaining-dt);muzzleFlash.visible=flashRemaining>0&&player.alive!==false&&weaponId!=='knife';
      deathTilt=THREE.MathUtils.lerp(deathTilt,player.alive===false?1:0,Math.min(1,dt*9));
      body.rotation.z=deathTilt*1.35+(dash?-.08:slide?.12:0);
      body.rotation.x=dash?.15:slide?-.15:0;
      body.position.y=-deathTilt*.45-landing+(grounded?Math.abs(Math.cos(cycle))*walking*.018:0);
      label.visible=api.labelVisible&&player.alive!==false&&player.connected!==false;
      group.visible=player.connected!==false;
    },
    shoot(){flashRemaining=.06;shotTime=.22;},
    labelVisible:true,
    setLabelVisible(visible){api.labelVisible=visible;label.visible=visible;},
    dispose(){
      if(gun){weaponAnchor.remove(gun);gun.userData.dispose();}
      body.traverse(object=>{if(object.isMesh)object.geometry.dispose();});
      Object.values(materials).forEach(material=>material.dispose());flashMaterial.dispose();labelMaterial.map.dispose();labelMaterial.dispose();group.removeFromParent();
    },
  };
  api.update(initial,0,1);return api;
}
