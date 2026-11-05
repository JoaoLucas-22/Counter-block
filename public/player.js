import * as THREE from 'three';
import { createWeaponModel } from './weapons.js';

function nicknameTexture(name, team) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 80;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(10,18,25,.80)'; context.roundRect(8, 8, 496, 64, 9); context.fill();
  context.fillStyle = team === 'T' ? '#efa765' : '#84c4e3';
  context.font = '600 32px system-ui'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(String(name || 'Jogador').slice(0, 20), 256, 41, 465);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export function createCharacter(initial) {
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  const materials = {
    uniform: new THREE.MeshStandardMaterial({ color: initial.team === 'T' ? 0x965533 : 0x3d627a, roughness: .9 }),
    vest: new THREE.MeshStandardMaterial({ color: initial.team === 'T' ? 0x4b4234 : 0x253b48, roughness: .95 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xcba780, roughness: .85 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x202a2c, roughness: .9 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x86adb4, roughness: .3, metalness: .45 }),
  };
  const box = (w,h,d,x,y,z,key,parent=body) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), materials[key]);
    mesh.position.set(x,y,z); mesh.castShadow = true; parent.add(mesh); return mesh;
  };
  box(.43,.55,.28,0,1.10,0,'uniform'); box(.46,.40,.31,0,1.13,-.015,'vest');
  box(.13,.13,.035,-.115,1.10,-.185,'uniform'); box(.13,.13,.035,.115,1.10,-.185,'uniform');
  box(.44,.09,.30,0,.80,0,'dark');
  box(.15,.13,.15,0,1.43,0,'skin');
  const head = new THREE.Group(); head.position.y = 1.61; body.add(head);
  box(.30,.31,.29,0,0,0,'skin',head); box(.32,.14,.31,0,.10,.004,'dark',head);
  box(.31,.075,.02,0,.022,-.15,'visor',head); box(.31,.11,.30,0,-.11,0,'dark',head);
  const legs = [-1,1].map(sign => {
    const pivot = new THREE.Group(); pivot.position.set(sign * .13,.77,0); body.add(pivot);
    box(.19,.53,.23,0,-.265,0,'uniform',pivot); box(.205,.16,.33,0,-.61,-.04,'dark',pivot); return pivot;
  });
  const arms = [-1,1].map(sign => {
    const pivot = new THREE.Group(); pivot.position.set(sign * .31,1.31,0); body.add(pivot);
    box(.17,.37,.19,0,-.18,-.02,'uniform',pivot); box(.15,.17,.18,0,-.43,-.05,'skin',pivot); return pivot;
  });
  const weaponAnchor = new THREE.Group(); weaponAnchor.position.set(.24,1.02,-.19); body.add(weaponAnchor);
  const flashMaterial=new THREE.MeshBasicMaterial({color:0xffce72,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false});
  const muzzleFlash=new THREE.Mesh(new THREE.ConeGeometry(.05,.13,5),flashMaterial);
  muzzleFlash.rotation.x=-Math.PI/2;muzzleFlash.visible=false;weaponAnchor.add(muzzleFlash);
  let gun, weaponId, lastTeam=initial.team, lastName=initial.nickname;
  const labelMap = nicknameTexture(lastName,lastTeam);
  const labelMaterial = new THREE.SpriteMaterial({ map: labelMap, transparent:true, depthTest:true, depthWrite:false });
  const label = new THREE.Sprite(labelMaterial); label.position.y=1.97; label.scale.set(1.6,.25,1); group.add(label);
  let deathTilt=0,flashRemaining=0;
  const api = {
    group,
    update(player,time=0,dt=.016) {
      group.position.set(player.x,player.y,player.z); group.rotation.y = player.yaw || 0;
      if (player.team !== lastTeam) {
        lastTeam=player.team; materials.uniform.color.setHex(lastTeam === 'T' ? 0x965533 : 0x3d627a);
        materials.vest.color.setHex(lastTeam === 'T' ? 0x4b4234 : 0x253b48);
      }
      if (player.nickname !== lastName || labelMaterial.userData.team !== player.team) {
        lastName=player.nickname; labelMaterial.map.dispose(); labelMaterial.map=nicknameTexture(lastName,player.team);
        labelMaterial.userData.team=player.team;
      }
      const crouch=player.crouch ? .66 : 1; body.scale.y=THREE.MathUtils.lerp(body.scale.y,crouch,Math.min(1,dt*18));
      label.position.y=body.scale.y*1.8+.17;
      head.rotation.x = (player.pitch || 0) * .45;
      const speed=Math.hypot(player.vx || 0,player.vz || 0), stride=Math.sin(time*11)*Math.min(speed/6,1)*.52;
      legs[0].rotation.x=stride; legs[1].rotation.x=-stride;
      arms[0].rotation.x=-.35-stride*.22; arms[1].rotation.x=-.75+stride*.12;
      weaponAnchor.rotation.x=player.pitch || 0;
      if (weaponId !== player.weapon) {
        if (gun) { weaponAnchor.remove(gun); gun.userData.dispose(); }
        weaponId=player.weapon; gun=createWeaponModel(weaponId || 'glock'); weaponAnchor.add(gun);
        muzzleFlash.position.set(0,.032,gun.userData.muzzleZ-.04);
      }
      flashRemaining=Math.max(0,flashRemaining-dt);
      muzzleFlash.visible=flashRemaining>0&&player.alive!==false;
      deathTilt=THREE.MathUtils.lerp(deathTilt,player.alive===false ? 1 : 0,Math.min(1,dt*9));
      body.rotation.z=deathTilt*1.35; body.position.y=-deathTilt*.45;
      label.visible=api.labelVisible && player.alive!==false && player.connected!==false;
      group.visible=player.connected!==false;
    },
    shoot() { flashRemaining=.06;muzzleFlash.visible=true; },
    labelVisible:true,
    setLabelVisible(visible) { api.labelVisible=visible; label.visible=visible; },
    dispose() {
      if(gun) {weaponAnchor.remove(gun); gun.userData.dispose();}
      body.traverse(o=>{if(o.isMesh) o.geometry.dispose();});
      Object.values(materials).forEach(m=>m.dispose());flashMaterial.dispose();labelMaterial.map.dispose();labelMaterial.dispose();
      group.removeFromParent();
    },
  };
  api.update(initial,0,1); return api;
}
