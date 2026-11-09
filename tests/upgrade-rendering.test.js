import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { parseHTML } from 'linkedom';
import { buildMap } from '../public/map.js';
import { createWeaponModel,createViewWeapon } from '../public/weapons.js';
import { createCharacter } from '../public/player.js';
import { MAPS } from '../shared/map-data.js';
import { SKINS } from '../shared/cosmetics.js';

// These tests exercise geometry and animation construction, not GPU rasterization.
function documentForTextures(t){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
  const {document}=parseHTML('<html><body></body></html>');
  const create=document.createElement.bind(document);
  document.createElement=tag=>{
    const element=create(tag);
    if(tag==='canvas')element.getContext=()=>Object.fromEntries(['fillRect','beginPath','moveTo','lineTo','stroke','fillText','roundRect','fill'].map(name=>[name,()=>{}]));
    return element;
  };
  globalThis.document=document;
  t.after(()=>descriptor?Object.defineProperty(globalThis,'document',descriptor):delete globalThis.document);
}
function finite(root){
  root.updateMatrixWorld(true);
  root.traverse(object=>{
    assert.ok(object.matrixWorld.elements.every(Number.isFinite));
    if(object.geometry?.attributes.position)assert.ok(object.geometry.attributes.position.array.every(Number.isFinite));
  });
}
function observeResources(root){
  const resources=new Set(),disposed=new Set();
  root.traverse(object=>{
    // Three.js owns Sprite's shared quad; each actor owns its material and texture.
    if(object.geometry&&!object.isSprite)resources.add(object.geometry);
    const materials=Array.isArray(object.material)?object.material:[object.material];
    for(const material of materials)if(material){resources.add(material);if(material.map)resources.add(material.map);}
  });
  for(const resource of resources)resource.addEventListener('dispose',()=>disposed.add(resource));
  return ()=>assert.equal(disposed.size,resources.size);
}

test('all original arenas construct bounded instanced geometry with their own theme',t=>{
  documentForTextures(t);
  for(const map of Object.values(MAPS)){
    const scene=new THREE.Scene(),world=buildMap(scene,'high',map),root=scene.getObjectByName(map.name);
    assert.ok(root,map.name);assert.equal(scene.background.getHex(),map.theme?.sky??0xb9d3da);
    const matrices=[],matrix=new THREE.Matrix4();let draws=0;
    root.traverse(object=>{
      if(object.isMesh)draws++;
      if(object.isInstancedMesh)for(let i=0;i<object.count;i++){object.getMatrixAt(i,matrix);matrices.push(matrix.clone());}
    });
    for(const solid of map.solids){
      assert.ok(matrices.some(transform=>Math.abs(transform.elements[12]-solid.x)<1e-4&&Math.abs(transform.elements[13]-solid.y)<1e-4&&Math.abs(transform.elements[14]-solid.z)<1e-4&&Math.abs(transform.elements[0]-solid.w)<1e-4&&Math.abs(transform.elements[5]-solid.h)<1e-4&&Math.abs(transform.elements[10]-solid.d)<1e-4),`solid missing in ${map.name}`);
    }
    assert.ok(draws<45,`${map.name} static draw calls are batched`);finite(root);
    world.setQuality('low');world.update(2);
    const disposed=observeResources(root);world.dispose();disposed();assert.equal(scene.children.length,0);
  }
});

test('new firearms and knife have distinct finite models with server-selected finishes',()=>{
  const skin=Object.values(SKINS).find(value=>value.kind==='weapon');assert.ok(skin);
  const shapes=[];
  for(const id of ['vector','scatter','pulse','knife']){
    const model=createWeaponModel(id,skin.id);assert.equal(model.userData.skinId,skin.id);finite(model);
    const bounds=new THREE.Box3().setFromObject(model),size=new THREE.Vector3();bounds.getSize(size);
    assert.ok(size.x>0&&size.y>0&&size.z>0);shapes.push(size.toArray().join(','));
    const painted=[];model.traverse(object=>{if(object.isMesh)painted.push(object.material.color.getHexString());});
    assert.ok(painted.includes(new THREE.Color(skin.colors.metal).getHexString()));
    const disposed=observeResources(model);model.userData.dispose();disposed();
  }
  assert.equal(new Set(shapes).size,4,'classes have distinct silhouettes');
});

test('skin changes replace view models, knife slashes and mobility lean without muzzle flash',()=>{
  const skin=Object.values(SKINS).find(value=>value.kind==='weapon');
  const camera=new THREE.PerspectiveCamera(),view=createViewWeapon(camera);
  const initial=view.group.getObjectByName('weapon:glock'),disposedOld=observeResources(initial);
  view.equip('glock',skin.id);disposedOld();assert.notEqual(view.group.getObjectByName('weapon:glock'),initial);
  view.equip('knife',skin.id);view.update(.3,{speed:0,grounded:true});
  view.shoot();view.update(.07,{speed:13,grounded:false,dashTime:.15});
  assert.ok(view.group.rotation.y<-.1);
  const flash=view.group.children.find(object=>object.geometry?.type==='ConeGeometry');assert.equal(flash.visible,false);
  finite(view.group);const disposed=observeResources(view.group);view.dispose();disposed();
});

test('operator cosmetics retain team markers and articulated movement responds to airborne dash',t=>{
  documentForTextures(t);
  const characterSkin=Object.values(SKINS).find(value=>value.kind==='character');
  const initial={x:0,y:0,z:0,team:'CT',nickname:'Amigo',weapon:'knife',alive:true,connected:true,grounded:true,vx:0,vy:0,vz:0,cosmetics:{weapon:'default',character:characterSkin.id}};
  const actor=createCharacter(initial);assert.ok(actor.group.getObjectByName('knee:-1'));
  const colors=[];actor.group.traverse(object=>{if(object.isMesh)colors.push(object.material.color.getHexString());});
  assert.ok(colors.includes(new THREE.Color(characterSkin.colors.uniform).getHexString()));assert.ok(colors.includes('63d1ff'),'team marker survives outfit skin');
  actor.update({...initial,grounded:false,y:1,vy:2,vx:13,dashTime:.15},1,.1);
  const body=actor.group.getObjectByName('operator-body');assert.ok(body.rotation.x>0);assert.ok(actor.group.getObjectByName('knee:-1').rotation.x>0);
  actor.shoot();actor.update({...initial,weapon:'knife'},1.1,.016);
  actor.setLabelVisible(true);const label=actor.group.children.find(object=>object.isSprite);assert.equal(label.visible,true);
  finite(actor.group);const disposed=observeResources(actor.group);actor.dispose();disposed();
});
