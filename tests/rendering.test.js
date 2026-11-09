import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { parseHTML } from 'linkedom';
import { buildMap } from '../public/map.js';
import { createCharacter } from '../public/player.js';
import { createViewWeapon, createWeaponModel } from '../public/weapons.js';
import { MAP } from '../shared/map-data.js';

/** Geometry/material construction tests only; no rasterization or GPU is emulated. */
function canvasDocument(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const { document } = parseHTML('<html><body></body></html>');
  const createElement = document.createElement.bind(document);
  document.createElement = name => {
    const element = createElement(name);
    if (name.toLowerCase() === 'canvas') {
      const context = Object.fromEntries(['fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText', 'roundRect', 'fill'].map(method => [method, () => {}]));
      Object.defineProperty(element, 'getContext', { value: type => { assert.equal(type, '2d'); return context; } });
    }
    return element;
  };
  globalThis.document = document;
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
}

function resources(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(object => {
    // Three.js owns the shared Sprite quad; disposing it per character would affect other labels.
    if (object.geometry && !object.isSprite) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      materials.add(material);
      if (material.map) textures.add(material.map);
    }
  });
  return new Set([...geometries, ...materials, ...textures]);
}

function observeDisposal(root) {
  const owned = resources(root), disposed = new Set();
  for (const resource of owned) resource.addEventListener('dispose', () => disposed.add(resource));
  return () => assert.equal(disposed.size, owned.size, 'all referenced geometry, material and texture resources are disposed');
}

function assertFiniteTransforms(root) {
  root.updateMatrixWorld(true);
  root.traverse(object => {
    assert.ok(object.matrixWorld.elements.every(Number.isFinite));
    const position = object.geometry?.getAttribute('position');
    if (position) assert.ok([...position.array].every(Number.isFinite));
  });
}

test('Dust Block renders every authoritative solid with matching instance transforms and disposes resources', t => {
  canvasDocument(t);
  const scene = new THREE.Scene(), map = buildMap(scene, 'medium');
  const root = scene.getObjectByName('Dust Block'); assert.ok(root);
  const sunlight = root.children.find(object => object.isDirectionalLight);
  const dust = root.children.find(object => object.isPoints);
  const transforms = [], matrix = new THREE.Matrix4();
  root.traverse(object => {
    if (!object.isInstancedMesh) return;
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix);
      const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
      matrix.decompose(position, rotation, scale);
      transforms.push({ position, scale });
    }
  });
  for (const box of MAP.solids) {
    assert.ok(transforms.some(({ position, scale }) =>
      Math.abs(position.x - box.x) < 1e-5 && Math.abs(position.y - box.y) < 1e-5 && Math.abs(position.z - box.z) < 1e-5 &&
      Math.abs(scale.x - box.w) < 1e-5 && Math.abs(scale.y - box.h) < 1e-5 && Math.abs(scale.z - box.d) < 1e-5),
    `unrendered solid at ${box.x},${box.y},${box.z}`);
  }
  map.setQuality('low'); assert.equal(sunlight.castShadow, false); assert.equal(dust.visible, false);
  map.setQuality('high'); assert.equal(sunlight.castShadow, true); assert.equal(sunlight.shadow.mapSize.x, 2048);
  map.update(7); assertFiniteTransforms(root);
  const verifyDisposal = observeDisposal(root);
  map.dispose(); verifyDisposal(); assert.equal(root.parent, null); assert.equal(scene.children.length, 0);
});

test('remote characters have articulated geometry, follow state, change equipment and dispose cleanly', t => {
  canvasDocument(t);
  const initial = { id: 'remote', nickname: 'Amigo', team: 'T', alive: true, connected: true, weapon: 'glock',
    x: 1, y: 0, z: 2, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, crouch: false };
  const actor = createCharacter(initial), scene = new THREE.Scene(); scene.add(actor.group);
  let meshCount = 0; actor.group.traverse(object => { if (object.isMesh) meshCount++; });
  assert.ok(meshCount > 15, 'characters contain head, limbs, torso, equipment and a weapon');
  const update = { ...initial, x: 4, y: 0.9, z: -6, yaw: 1.2, pitch: .2, crouch: true, team: 'CT', weapon: 'm4', vx: 3 };
  actor.update(update, 1, 1);
  assert.deepEqual(actor.group.position.toArray(), [4, .9, -6]); assert.equal(actor.group.rotation.y, 1.2);
  const body = actor.group.children.find(object => object.isGroup); assert.equal(body.scale.y, .66);
  const label = actor.group.children.find(object => object.isSprite);
  actor.setLabelVisible(false); actor.update(update, 2, .016); assert.equal(label.visible, false);
  actor.shoot(); actor.update(update, 2, .016);
  actor.update({ ...update, alive: false }, 3, 1); assert.ok(body.rotation.z > 1);
  actor.update({ ...update, connected: false }, 4, .016); assert.equal(actor.group.visible, false);
  assertFiniteTransforms(actor.group);
  const verifyDisposal = observeDisposal(actor.group);
  actor.dispose(); verifyDisposal(); assert.equal(actor.group.parent, null);
});

test('all arsenal models have finite three-dimensional geometry and release their resources', () => {
  for (const id of ['glock', 'usp', 'ak', 'm4', 'awp', 'smoke', 'flash']) {
    const model = createWeaponModel(id);
    assert.ok(model.children.length >= 3, id);
    assertFiniteTransforms(model);
    const box = new THREE.Box3().setFromObject(model), size = new THREE.Vector3(); box.getSize(size);
    assert.ok(size.x > 0 && size.y > 0 && size.z > 0, id);
    assert.ok(Number.isFinite(model.userData.muzzleZ));
    const verifyDisposal = observeDisposal(model);
    model.userData.dispose(); verifyDisposal();
  }
});

test('first-person weapons animate firing, recovery, reload, equipment and visibility', () => {
  const camera = new THREE.PerspectiveCamera(), view = createViewWeapon(camera);
  const flash = view.group.children.find(object => object.geometry?.type === 'ConeGeometry');
  view.shoot(); view.update(.016, { speed: 0, grounded: true });
  assert.equal(flash.visible, true); assert.ok(view.group.position.z > -.43);
  view.update(.2, { speed: 0, grounded: true }); assert.equal(flash.visible, false);
  view.reload(2); view.update(1, { speed: 0, grounded: true });
  assert.ok(view.group.rotation.z < -.5); assert.ok(view.group.position.y < -.35);
  view.equip('awp'); view.update(.016, { speed: 4, grounded: true, aim: true });
  assert.ok(view.group.position.x < .2);
  view.setVisible(false); assert.equal(view.group.visible, false);
  view.setVisible(true); assert.equal(view.group.visible, true);
  assertFiniteTransforms(view.group);
  const verifyDisposal = observeDisposal(view.group);
  view.dispose(); verifyDisposal(); assert.equal(view.group.parent, null);
});
