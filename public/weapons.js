import * as THREE from 'three';

// Original geometric models. Units are metres, with the barrel pointing along -Z.
export function createWeaponModel(id = 'glock') {
  const group = new THREE.Group();
  const materials = {
    metal: new THREE.MeshStandardMaterial({ color: 0x273139, roughness: .58, metalness: .55 }),
    black: new THREE.MeshStandardMaterial({ color: 0x141c23, roughness: .82 }),
    tan: new THREE.MeshStandardMaterial({ color: id === 'ak' ? 0x9a5934 : id === 'awp' ? 0x6a7855 : 0xa79a7c, roughness: .78 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xdc8143, roughness: .55, metalness: .3 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x2b6878, metalness: .75, roughness: .18 }),
  };
  const box = (w, h, d, x, y, z, mat = 'metal') => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[mat]);
    mesh.position.set(x, y, z); mesh.castShadow = true; group.add(mesh); return mesh;
  };
  const tube = (r, length, x, y, z, mat = 'metal', sides = 8) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, length, sides), materials[mat]);
    mesh.rotation.x = Math.PI / 2; mesh.position.set(x, y, z); mesh.castShadow = true; group.add(mesh); return mesh;
  };
  let muzzleZ = -.48;
  if (id === 'smoke' || id === 'flash') {
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(.055, .06, .17, 8), materials[id === 'smoke' ? 'tan' : 'metal']);
    shell.position.y = -.015; group.add(shell); box(.035, .055, .04, 0, .095, 0, 'black');
    box(.022, .15, .018, .057, .03, 0, 'accent'); muzzleZ = 0;
  } else if (id === 'glock' || id === 'usp') {
    box(.075, .075, .24, 0, .025, -.1); box(.066, .048, .21, 0, -.035, -.09, 'black');
    const grip = box(.067, .155, .075, 0, -.11, -.012, 'black'); grip.rotation.x = -.2;
    box(.014, .019, .025, 0, .07, -.205, 'accent'); box(.065, .018, .02, 0, .07, -.004, 'black');
    box(.016, .045, .018, .035, -.056, -.075, 'black');
    tube(.019, id === 'usp' ? .17 : .025, 0, .022, id === 'usp' ? -.295 : -.23, 'black');
    muzzleZ = id === 'usp' ? -.386 : -.25;
  } else {
    const sniper = id === 'awp';
    box(.095, .10, .29, 0, .025, -.15);
    box(.105, .11, .23, 0, .025, -.39, 'tan');
    tube(sniper ? .021 : .015, sniper ? .38 : .24, 0, .032, sniper ? -.64 : -.61, 'black');
    tube(.027, .045, 0, .032, sniper ? -.84 : -.745);
    const stock = box(.077, .115, .23, 0, .015, .12, 'tan'); stock.rotation.x = -.06;
    box(.092, .15, .035, 0, .005, .235, 'black');
    const grip = box(.065, .135, .075, 0, -.095, -.025, 'black'); grip.rotation.x = -.25;
    const mag = box(.065, sniper ? .105 : .19, .095, 0, -.12, -.20, 'black'); mag.rotation.x = id === 'ak' ? .18 : -.04;
    box(.015, .055, .04, .055, .015, -.095, 'accent');
    if (sniper) {
      tube(.037, .23, 0, .144, -.20, 'black');
      tube(.05, .058, 0, .144, -.34, 'black');
      tube(.046, .004, 0, .144, -.372, 'glass');
      box(.035, .07, .035, 0, .08, -.14, 'black');
      box(.035, .07, .035, 0, .08, -.28, 'black');
    } else {
      box(.018, .06, .025, 0, .097, -.49, 'black');
      box(.055, .025, .09, 0, .095, -.11, 'black');
      for (let i = 0; i < 4; i++) box(.113, .012, .014, 0, .084, -.32 - i * .04, 'black');
    }
    muzzleZ = sniper ? -.87 : -.775;
  }
  group.userData.muzzleZ = muzzleZ;
  group.userData.dispose = () => {
    group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    Object.values(materials).forEach(m => m.dispose());
  };
  return group;
}

export function createViewWeapon(camera) {
  const group = new THREE.Group(); group.position.set(.27, -.26, -.43); camera.add(group);
  let id, model, kick = 0, cycle = 0, reloadLeft = 0, reloadTotal = 1, flashLeft = 0;
  const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffd07a, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flash = new THREE.Mesh(new THREE.ConeGeometry(.055, .15, 5), flashMaterial);
  flash.rotation.x = -Math.PI / 2; flash.visible = false; group.add(flash);
  const gloveMaterial=new THREE.MeshStandardMaterial({color:0x374548,roughness:.95});
  const sleeveMaterial=new THREE.MeshStandardMaterial({color:0x647067,roughness:1});
  const hand=new THREE.Mesh(new THREE.BoxGeometry(.085,.12,.115),gloveMaterial);
  hand.position.set(.005,-.104,.02);hand.rotation.x=-.2;group.add(hand);
  const sleeve=new THREE.Mesh(new THREE.BoxGeometry(.105,.11,.24),sleeveMaterial);
  sleeve.position.set(.025,-.18,.145);sleeve.rotation.x=-.42;group.add(sleeve);
  const api = {
    group,
    equip(nextId) {
      if (id === nextId && model) return;
      if (model) { group.remove(model); model.userData.dispose(); }
      id = nextId; model = createWeaponModel(id); group.add(model);
      flash.position.set(0, .032, model.userData.muzzleZ - .05);
      reloadLeft = 0; kick = 0;
    },
    shoot() { kick = Math.min(1.6, kick + (id === 'awp' ? 1.2 : .6)); flashLeft = .045; },
    reload(duration = 2) { reloadLeft = reloadTotal = duration; },
    update(dt, state = {}) {
      const speed = state.speed || 0; cycle += dt * (speed > .05 ? 7 + speed * 1.5 : 1.6);
      kick *= Math.exp(-dt * 14); flashLeft -= dt;
      const bob = state.grounded === false ? 0 : Math.min(speed / 6, 1) * .009;
      const aim = state.aim ? 1 : 0;
      group.position.set(.27 - aim * .13 + Math.sin(cycle) * bob, -.26 - aim * .015 + Math.abs(Math.cos(cycle)) * bob - kick * .012, -.43 + kick * .055);
      group.rotation.set(kick * .09, 0, -.035 + Math.sin(cycle) * bob * .9);
      if (reloadLeft > 0) {
        reloadLeft = Math.max(0, reloadLeft - dt);
        const progress = 1 - reloadLeft / reloadTotal;
        const tilt = Math.sin(progress * Math.PI);
        group.rotation.z -= tilt * .65; group.rotation.x -= tilt * .5; group.position.y -= tilt * .14;
      }
      flash.visible = flashLeft > 0 && id !== 'smoke' && id !== 'flash';
      if (flash.visible) flash.rotation.y += dt * 100;
    },
    setVisible(visible) { group.visible = visible; },
    dispose() {
      if(model)model.userData.dispose();flash.geometry.dispose();flashMaterial.dispose();
      hand.geometry.dispose();sleeve.geometry.dispose();gloveMaterial.dispose();sleeveMaterial.dispose();camera.remove(group);
    },
  };
  api.equip('glock'); return api;
}
