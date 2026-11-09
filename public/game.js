import * as THREE from 'three';
import { UI } from './ui.js';
import { Networking } from './networking.js';
import { buildMap } from './map.js';
import { createCharacter } from './player.js';
import { createViewWeapon } from './weapons.js';
import { GameAudio } from './audio.js';
import { MAP, getMap } from '/shared/map-data.js';
import { movementInput, blockGameShortcut, captureGameKeyboard } from './controls.js';
import { WEAPONS } from '/shared/weapons.js';
import { DT, movePlayer, eyeHeight, traceWorld } from '/shared/physics.js';

const network = new Networking();
const audio = new GameAudio();
const keys = new Set();
const models = new Map();
const smokeEffects = new Map();
const grenadeVisuals = new Map();
const traces = [];
let renderer, scene, camera, world, viewWeapon;
let state = null, me = null, predicted = null, pending = [], seq = 0;
let yaw = 0, pitch = 0, recoilPitch = 0, recoilYaw = 0;
let locked = false, buyOpen = false, scoreOpen = false, lastRound = -1;
let leftMouse = false, shotHeld = false, nextShot = 0, spray = 0;
let jumpHeld = false;
let flashUntil = 0, flashIntensity = 0, damageUntil = 0;
let spectatorIndex = 0, lastVisualTime = performance.now(), frameCount = 0, fpsTime = 0, fps = 0;
let footstep = 0, lastGrounded = true, lastPhase = 'menu', displayEye = 1.61;
let preferences, nextHud = 0, lastFeedback = 0;
let activeMap = MAP;
const predictedShots = [];
const correction = new THREE.Vector3();
const remoteSteps = new Map();
const lookAt = new THREE.Vector3(0, 0, -3);
const ui = new UI({
  create: nickname => task(async () => { await network.create(nickname); audio.unlock(); }),
  join: (code, nickname) => task(async () => { await network.join(code, nickname); audio.unlock(); }),
  team: team => task(() => network.request('team:select', { team })),
  ready: () => task(() => network.request('player:ready', { ready: !me?.ready })),
  start: () => task(() => network.request('match:start')),
  copy: () => task(copyCode),
  leave: () => task(leaveRoom),
  resume: requestPointer,
  restart: () => task(() => network.request('match:restart')),
  buy: item => task(() => network.action('buy', { item })),
  settings: applySettings,
  selectMap: mapId => task(() => network.request('room:map',{mapId})),
  openCrate: type => task(async () => { await network.request('profile:open',{type}); audio.unlock(); audio.play('crate'); }),
  equipSkin: (kind,skinId) => task(() => network.request('profile:equip',{kind,skinId})),
  friendRequest: code => task(async () => { await network.request('friend:request',{code}); ui.toast('Solicitação de amizade enviada.'); }),
  friendAccept: code => task(async () => { await network.request('friend:accept',{code}); ui.toast('Amizade aceita. Vocês já podem entrar na mesma sala.'); }),
  friendRemove: code => task(async () => { await network.request('friend:remove',{code}); ui.toast('Amizade removida.'); }),
  friendJoin: code => task(async () => {
    const destination = await network.request('friend:join',{code});
    if (network.code) await leaveRoom();
    await network.join(destination.code,ui.nickname || network.profile?.nickname || 'Jogador');
  }),
  fullscreen: () => task(toggleFullscreen),
});
preferences = ui.settings;
async function task(action) {
  try { return await action(); } catch (error) { ui.toast(error.message); }
}
async function copyCode() {
  if (!network.code) return;
  try { await navigator.clipboard.writeText(network.code); }
  catch {
    const field = document.createElement('textarea');
    field.value = network.code; document.body.append(field); field.select();
    const copied = document.execCommand('copy');
    field.remove();
    if (!copied) throw new Error(`Código da sala: ${network.code}`);
  }
  ui.toast('Código copiado. Seus amigos também precisam do endereço deste servidor.');
}
async function leaveRoom() {
  document.exitPointerLock?.();
  try { await network.leave(); } catch (error) { ui.toast(error.message); }
  state = me = predicted = null; pending.length = 0; lastRound = -1; seq = 0;
  keys.clear(); leftMouse = false; buyOpen = false; scoreOpen = false;
  for (const model of models.values()) { scene?.remove(model.group); model.dispose(); }
  models.clear();
  for (const item of smokeEffects.values()) disposeSmoke(item);
  smokeEffects.clear();
  for (const item of grenadeVisuals.values()) scene?.remove(item.mesh);
  grenadeVisuals.clear();
  ui.showBuy(false); ui.showScore(false); ui.showPause(false); ui.showScreen('menu');
  lastPhase = 'menu';
}
function requestPointer() {
  if (!renderer) return ui.toast('WebGL indisponível. Ative aceleração de hardware no navegador.');
  if (!state || state.phase === 'lobby') return;
  audio.unlock();
  captureGameKeyboard();
  if (state.phase === 'finished') return;
  buyOpen = false; ui.showBuy(false);
  const promise = renderer.domElement.requestPointerLock?.();
  if (promise?.catch) promise.catch(() => ui.toast('Clique em Retomar para ativar o mouse.'));
}
async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen?.();
    navigator.keyboard?.unlock?.();
    return;
  }
  if (!document.documentElement.requestFullscreen) return ui.toast('Use F11 e C para agachar neste navegador.');
  await document.documentElement.requestFullscreen();
  const captured = await captureGameKeyboard();
  ui.toast(captured ? 'Teclado capturado. Esc libera os controles.' : 'Tela cheia ativa. Use C para agachar sem atalhos do navegador.');
}
function useMap(id) {
  const map = getMap(id);
  if (map.id === activeMap.id) return;
  activeMap = map;
  pending.length = 0; predicted = null; network.snapshots.length = 0;
  for (const effect of smokeEffects.values()) disposeSmoke(effect);
  smokeEffects.clear();
  for (const visual of grenadeVisuals.values()) scene?.remove(visual.mesh);
  grenadeVisuals.clear();
  for (const trace of traces) { scene?.remove(trace.line); trace.line.geometry.dispose(); }
  traces.length = 0;
  if (scene) { world?.dispose(); world = buildMap(scene,preferences.quality,map); }
}
function applySettings(settings = ui.settings) {
  preferences = settings;
  audio.setVolume(settings.master ?? settings.volume ?? .7, settings.effects ?? settings.sfx ?? .8);
  if (!renderer) return;
  renderer.setPixelRatio(Math.min(2,Math.min(devicePixelRatio || 1, 1.75) * (settings.renderScale ?? 1)));
  renderer.shadowMap.enabled = settings.quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setSize(innerWidth, innerHeight);
  world?.setQuality(settings.quality ?? 'medium');
  camera.fov = settings.fov ?? 90; camera.updateProjectionMatrix();
}
function initGraphics() {
  try {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(90, innerWidth / innerHeight, .055, 260);
    camera.rotation.order = 'YXZ';
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    document.getElementById('viewport').append(renderer.domElement);
    scene.add(camera);
    world = buildMap(scene, ui.settings.quality,activeMap);
    viewWeapon = createViewWeapon(camera);
    viewWeapon.setVisible(false);
    applySettings();
    renderer.domElement.addEventListener('click', () => { if (!locked && lastPhase !== 'menu' && lastPhase !== 'lobby') requestPointer(); });
    requestAnimationFrame(render);
  } catch (error) {
    console.error(error);
    ui.toast('Não foi possível iniciar o WebGL. Use um navegador com aceleração de hardware.');
  }
}

network.on('connection', status => {
  ui.setConnection(status);
  if (status === 'disconnected') {
    keys.clear(); leftMouse = false;
    document.exitPointerLock?.();
    ui.toast('Conexão interrompida. Tentando recuperar sua vaga por até 20 segundos.');
  }
});
network.on('failure', message => { ui.toast(message); leaveRoom(); });
network.on('resumed', () => ui.toast('Conexão recuperada. Sua sessão foi restaurada.'));
network.on('profile', profile => ui.updateProfile(profile));
network.on('entered', session => {
  seq = session.inputSeq; pending.length = 0; predicted = null; lastRound = -1;
  keys.clear(); leftMouse = false; jumpHeld = false; correction.set(0,0,0);
});
network.on('room', next => {
  if (!next) return;
  useMap(next.mapId);
  state = next; me = next.players?.find(p => p.id === network.id) || null;
  if (next.phase === 'lobby') {
    if (ui.screen !== 'lobby') { ui.showPause(false); ui.showScreen('lobby'); }
    lastPhase = 'lobby';
    ui.updateRoom(next, network.id);
  }
});
network.on('snapshot', next => {
  useMap(next.mapId);
  const previous = me;
  state = next;
  me = next.players.find(player => player.id === network.id) || null;
  if (!me) return;
  if (next.phase === 'lobby') {
    ui.updateRoom(next, network.id); return;
  }
  if (lastPhase === 'menu' || lastPhase === 'lobby') {
    ui.showScreen('game'); ui.showPause(true);
    ui.toast('Clique em Retomar. B abre a loja; E planta ou desarma.');
  }
  lastPhase = next.phase;
  const reset = next.round !== lastRound || (!previous?.alive && me.alive) || !predicted;
  if (reset) {
    lastRound = next.round;
    pending.length = 0;
    seq = Math.max(seq, me.ack ?? 0, network.inputSeq || 0);
    jumpHeld = false;
    yaw = me.yaw; pitch = me.pitch;
    recoilPitch = recoilYaw = spray = 0; nextShot = 0;
    predictedShots.length = 0;
    buyOpen = false; ui.showBuy(false);
    displayEye = eyeHeight(me);
  }
  const before = predicted ? {x:predicted.x,y:predicted.y,z:predicted.z} : null;
  predicted = { x:me.x, y:me.y, z:me.z, vx:me.vx, vy:me.vy, vz:me.vz, crouch:me.crouch, grounded:me.grounded,
    dashAvailable:me.dashAvailable, dashTime:me.dashTime, dashCooldown:me.dashCooldown,
    dashHeld:me.dashHeld, crouchHeld:me.crouchHeld, slideTime:me.slideTime };
  pending = pending.filter(input => input.seq > (me.ack ?? 0));
  if (me.alive && next.phase === 'playing') {
    const speed = (WEAPONS[me.weapon]?.speed ?? 6) * (me.scoped ? .72 : 1);
    for (const command of pending) movePlayer(predicted, { ...command, jump: command.jumpPressed }, DT, speed,activeMap);
  }
  if (!reset && before && Math.hypot(before.x-predicted.x,before.y-predicted.y,before.z-predicted.z)<.65) {
    correction.x += before.x-predicted.x; correction.y += before.y-predicted.y; correction.z += before.z-predicted.z;
    correction.clampLength(0,.3);
  } else correction.set(0,0,0);
  // Rebase onto the authoritative body, then replay only unacknowledged commands.
  for (const p of next.players) {
    if (p.id === network.id || models.has(p.id) || !scene) continue;
    const model = createCharacter(p); models.set(p.id, model); scene.add(model.group);
  }
  for (const [id, model] of models) if (!next.players.some(p => p.id === id)) {
    scene?.remove(model.group); model.dispose(); models.delete(id); remoteSteps.delete(id);
  }
  viewWeapon?.equip(me.weapon,me.cosmetics?.weapon);
  if (next.phase === 'finished') { document.exitPointerLock?.(); ui.showPause(false); }
  updateSmoke(next.grenades || []);
  updateProjectiles(next.grenades || []);
});

network.on('event', event => {
  if (!event || !scene) return;
  const position = event.origin || event;
  const at = { x:position.x, y:position.y, z:position.z, weapon:event.weapon };
  switch (event.type) {
    case 'shot': {
      if (event.shooter !== network.id) audio.play('shot', at);
      if (event.shooter === network.id) {
        const now = performance.now();
        while (predictedShots.length && now-predictedShots[0].at>700) predictedShots.shift();
        const expected = predictedShots.findIndex(shot => shot.weapon === event.weapon);
        if (expected >= 0) predictedShots.splice(expected,1);
        else shotFeedback(event.weapon,event.recoil);
      } else models.get(event.shooter)?.shoot();
      addTrace(event); break;
    }
    case 'hit':
      if (event.target === network.id) { damageUntil = performance.now() + 380; audio.play('hit'); }
      if (event.attacker === network.id) {
        const crosshair = document.getElementById('crosshair');
        crosshair?.classList.add('hit');
        setTimeout(() => crosshair?.classList.remove('hit'), 110);
        audio.play('hit', { volume:.3 });
      }
      break;
    case 'kill':
      ui.feed(event);
      if (event.target === network.id) { leftMouse = false; ui.toast('Eliminado. Espectador: use as setas para trocar de aliado.'); }
      break;
    case 'case':
      if (event.player === network.id || event.profileId === network.profile?.id) { audio.play('drop'); ui.toast('Eliminação! Uma caixa gratuita chegou à sua coleção.'); }
      break;
    case 'reload':
      audio.play('reload', event.player === network.id ? {} : at);
      if (event.player === network.id) viewWeapon?.reload(WEAPONS[event.weapon || me?.weapon]?.reload ?? 2.2);
      break;
    case 'equip': audio.play('switch', event.player === network.id ? {} : at); break;
    case 'buy': if (event.player === network.id) audio.play('buy'); break;
    case 'round': audio.play(event.winner === me?.team ? 'victory' : 'defeat'); ui.feed(event); break;
    case 'plant': audio.play('plant', at); ui.toast('Objetivo armado. 40 segundos até a detonação.'); break;
    case 'defuse': audio.play('defuse', at); break;
    case 'bomb':
      if (event.action === 'plant') { audio.play('plant',at); ui.toast('Objetivo armado. 40 segundos até a detonação.'); }
      else if (event.action === 'defuse') { audio.play('defuse',at); ui.toast('Objetivo desarmado.'); }
      else if (event.action === 'explode') audio.play('explode',at);
      else if (event.action === 'pickup' && event.player === network.id) ui.toast('Você recuperou a bomba. Vá ao local A ou B.');
      break;
    case 'roundStart': audio.play('round'); ui.toast(`Round ${event.round}. Janela de compra aberta por 15 segundos.`); break;
    case 'sides': ui.toast(event.message || 'As equipes trocaram de lado.'); break;
    case 'flash':
      if (event.target === network.id) {
        flashIntensity = Math.max(flashIntensity, event.intensity);
        flashUntil = performance.now() + event.duration * 1000;
        audio.play('flash', { volume:.25 * event.intensity });
      }
      break;
    case 'grenade':
      if (event.action === 'explode') audio.play(event.item === 'flash' ? 'flash' : 'grenade', at);
      if (event.action === 'smoke') audio.play('smoke', at);
      break;
    case 'alert': ui.toast(event.message || 'Estado da partida atualizado.'); break;
  }
});

/** Fixed command/simulation cadence is independent from requestAnimationFrame. */
function fixedTick() {
  if (!me || !predicted || !state || state.phase !== 'playing' || !me.alive || !network.socket.connected) return;
  const active = locked && !buyOpen && me.alive && state.phase === 'playing';
  const command = {
    seq: ++seq, time:network.now(), yaw, pitch,
    ...movementInput(keys,active), fire:active && leftMouse,
  };
  command.jumpPressed = command.jump && !jumpHeld;
  jumpHeld = command.jump;
  network.input(command);
  pending.push(command);
  if (pending.length > 120) pending.shift();
  const dashBefore = predicted.dashTime || 0;
  movePlayer(predicted, { ...command, jump: command.jumpPressed }, DT, (WEAPONS[me.weapon]?.speed ?? 6) * (me.scoped ? .72 : 1),activeMap);
  if (predicted.dashTime > dashBefore) audio.play('dash');
  if (!predicted.grounded && lastGrounded && command.jump) audio.play('jump');
  lastGrounded = predicted.grounded;
  const now = performance.now();
  recoilPitch *= Math.exp(-DT*7); recoilYaw *= Math.exp(-DT*6);
  if (now-lastFeedback>350) { spray = 0; recoilPitch = recoilYaw = 0; }
  if (command.fire && (WEAPONS[me.weapon]?.automatic || !shotHeld) && now >= nextShot && !me.reloadingAt && (WEAPONS[me.weapon]?.melee || me.ammo?.[me.weapon]?.mag > 0)) {
    const weapon = WEAPONS[me.weapon];
    if (weapon) {
      const kick = weapon.recoil[Math.min(spray, weapon.recoil.length - 1)];
      shotFeedback(me.weapon,kick);
      predictedShots.push({weapon:me.weapon,at:now});
      if (predictedShots.length>20) predictedShots.shift();
      const burstCount = weapon.burstCount ?? (me.weapon==='glock' && me.burst ? 3 : 1);
      const recovery = me.weapon==='glock' && me.burst ? .45 : weapon.rate;
      nextShot = now + (recovery+(burstCount-1)*(weapon.burstInterval ?? .065))*1000;
    }
  }
  shotHeld = command.fire;
}
let simulationLast = performance.now(), simulationAccumulator = 0;
setInterval(() => {
  const now = performance.now();
  simulationAccumulator += Math.min(100,Math.max(0,now-simulationLast));
  simulationLast = now;
  while (simulationAccumulator >= DT*1000) { fixedTick(); simulationAccumulator -= DT*1000; }
}, 4);
function shotFeedback(weapon,kick) {
  viewWeapon?.shoot(); audio.play('shot',{weapon});
  if (kick) {
    recoilPitch = Math.min(.22,recoilPitch+kick[0]);
    recoilYaw = Math.max(-.12,Math.min(.12,recoilYaw+kick[1]));
  }
  spray++; lastFeedback = performance.now();
}

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer?.domElement;
  if (!locked) {
    keys.clear(); leftMouse = false; shotHeld = false;
    if (state && !['lobby','finished'].includes(state.phase) && !buyOpen) ui.showPause(true);
  } else ui.showPause(false);
});
document.addEventListener('pointerlockerror', () => ui.toast('O navegador bloqueou o mouse. Clique em Retomar para tentar novamente.'));
document.addEventListener('mousemove', event => {
  if (!locked || buyOpen) return;
  const sensitivity = (preferences.sensitivity ?? 1) * .002;
  yaw -= event.movementX * sensitivity;
  pitch = Math.max(-1.5, Math.min(1.5, pitch - event.movementY * sensitivity));
  // Keep finite bounded angles after long sessions.
  yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
});
document.addEventListener('mousedown', event => {
  if (!locked || buyOpen) return;
  if (!me?.alive) { spectatorIndex++; return; }
  if (event.button === 0) leftMouse = true;
  if (event.button === 2) task(() => network.action('secondary'));
});
document.addEventListener('mouseup', event => { if (event.button === 0) leftMouse = false; });
document.addEventListener('contextmenu', event => { if (locked) event.preventDefault(); });
document.addEventListener('keydown', event => {
  const editing = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
  blockGameShortcut(event,locked,editing);
  if (['settings','controls','friends','collection'].includes(ui.modal)) return;
  if (editing || !state || state.phase === 'lobby') return;
  if (event.code === 'Tab') { event.preventDefault(); scoreOpen = true; ui.showScore(true, state); }
  if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (!me?.alive && ['ArrowRight','ArrowLeft'].includes(event.code)) spectatorIndex += event.code === 'ArrowRight' ? 1 : -1;
  if (event.code === 'Escape') {
    if (locked) document.exitPointerLock?.();
    if (buyOpen) { buyOpen = false; ui.showBuy(false); ui.showPause(true); }
    else if (!locked && state.phase !== 'finished') ui.showPause(true);
    return;
  }
  if (event.code === 'KeyB' && me?.alive && state.phase === 'playing') {
    buyOpen = !buyOpen; ui.showBuy(buyOpen, me);
    if (buyOpen) { keys.clear(); leftMouse = false; document.exitPointerLock?.(); ui.showPause(false); }
    else requestPointer();
    return;
  }
  if (!locked || buyOpen || !me?.alive) return;
  if (event.code === 'KeyR') task(() => network.action('reload'));
  if (event.code === 'Digit1') task(() => network.action('equip', { slot:1 }));
  if (event.code === 'Digit2') task(() => network.action('equip', { slot:2 }));
  if (event.code === 'Digit3') task(() => network.action('equip', { slot:3 }));
  if (event.code === 'Digit4') task(() => network.action('grenade', { item:'smoke' }));
  if (event.code === 'Digit5') task(() => network.action('grenade', { item:'flash' }));
  if (event.code === 'KeyG') task(() => network.action('dropBomb'));
});
document.addEventListener('keyup', event => {
  keys.delete(event.code);
  if (event.code === 'Tab') { scoreOpen = false; ui.showScore(false); }
});
window.addEventListener('blur', () => { keys.clear(); leftMouse = false; shotHeld = false; scoreOpen = false; ui.showScore(false); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); leftMouse = false; } });
window.addEventListener('resize', () => {
  if (!renderer) return;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

const traceMaterial = new THREE.LineBasicMaterial({ color:0xffdc87, transparent:true, opacity:.65 });
function addTrace(event) {
  if (!event.origin) return;
  for (const ray of event.traces || [event]) {
    if (!ray.end || traces.length>=24) break;
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(event.origin.x,event.origin.y,event.origin.z), new THREE.Vector3(ray.end.x,ray.end.y,ray.end.z),
    ]);
    const line = new THREE.Line(geometry, traceMaterial); scene.add(line);
    traces.push({ line, until:performance.now() + 80 });
  }
}
const smokeGeometry = new THREE.IcosahedronGeometry(1, 1);
const smokeTransform = new THREE.Object3D();
const grenadeGeometry = new THREE.CylinderGeometry(.08,.08,.18,8);
const grenadeMaterials = {
  smoke:new THREE.MeshStandardMaterial({color:0x5f7054,roughness:.8}),
  flash:new THREE.MeshStandardMaterial({color:0xc3bba1,metalness:.6,roughness:.4}),
};
function updateProjectiles(grenades) {
  if (!scene) return;
  const flying = grenades.filter(grenade => !grenade.active);
  for (const grenade of flying) {
    let visual = grenadeVisuals.get(grenade.id);
    if (!visual) {
      const mesh = new THREE.Mesh(grenadeGeometry,grenadeMaterials[grenade.type] || grenadeMaterials.smoke);
      mesh.position.set(grenade.x,grenade.y,grenade.z); scene.add(mesh);
      visual = {mesh,target:new THREE.Vector3(grenade.x,grenade.y,grenade.z)};
      grenadeVisuals.set(grenade.id,visual);
    }
    visual.target.set(grenade.x,grenade.y,grenade.z);
  }
  for (const [id,visual] of grenadeVisuals) if (!flying.some(grenade => grenade.id===id)) { scene.remove(visual.mesh); grenadeVisuals.delete(id); }
}
function disposeSmoke(effect) { scene?.remove(effect.group); effect.material.dispose(); }
function updateSmoke(grenades) {
  if (!scene) return;
  const active = grenades.filter(g => (g.item || g.type) === 'smoke' && g.active);
  for (const grenade of active) if (!smokeEffects.has(grenade.id)) {
    const group = new THREE.Group();
    const material = new THREE.MeshLambertMaterial({ color:0xadb2af, transparent:true, opacity:.91, depthWrite:true, side:THREE.DoubleSide });
    const cloud = new THREE.InstancedMesh(smokeGeometry,material,12);
    for (let i = 0; i < 12; i++) {
      const angle = i * 2.4;
      smokeTransform.position.set(Math.cos(angle) * (i ? 2.1 : 0), 1.1 + (i % 3) * .7, Math.sin(angle) * (i ? 2.1 : 0));
      smokeTransform.scale.setScalar(1.65 + (i % 3) * .25); smokeTransform.updateMatrix();
      cloud.setMatrixAt(i,smokeTransform.matrix);
    }
    cloud.computeBoundingSphere(); group.add(cloud);
    group.position.set(grenade.x, grenade.y, grenade.z); scene.add(group);
    smokeEffects.set(grenade.id, { group,material,created:performance.now() });
  }
  for (const [id,effect] of smokeEffects) if (!active.some(g => g.id === id)) { disposeSmoke(effect); smokeEffects.delete(id); }
}
const bombGroup = new THREE.Group();
const bombCase = new THREE.Mesh(new THREE.BoxGeometry(.34,.15,.22), new THREE.MeshStandardMaterial({ color:0x273c32, roughness:.8 }));
bombGroup.add(bombCase);
const bombLight = new THREE.Mesh(new THREE.BoxGeometry(.07,.025,.05), new THREE.MeshBasicMaterial({ color:0xff5c29 }));
bombLight.position.set(.07,.085,0); bombGroup.add(bombLight);
let bombBeep = 0;
const radar = document.createElement('canvas'); radar.id = 'radar'; radar.width = radar.height = 170;
radar.setAttribute('aria-label', 'Radar com aliados e locais A e B');
radar.style.cssText = 'position:fixed;left:24px;top:24px;width:150px;height:150px;border:1px solid #ffffff26;border-radius:50%;background:#111b20dd;pointer-events:none;z-index:5;display:none';
document.getElementById('screen-game').append(radar);
const radarContext = radar.getContext('2d');
const scope = document.getElementById('scope') || document.createElement('div'); scope.id = 'scope';
scope.classList.remove('hidden');
scope.style.cssText = 'position:fixed;inset:0;z-index:2;pointer-events:none;display:none;background:radial-gradient(circle at center,transparent 0,transparent min(34vw,38vh),#000 min(34.1vw,38.1vh))';
scope.innerHTML = '<i style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:#0009"></i><i style="position:absolute;top:50%;left:0;right:0;height:1px;background:#0009"></i>';
document.body.append(scope);
const smokeVeil = document.createElement('div');
smokeVeil.style.cssText = 'position:fixed;inset:0;background:#adb2af;opacity:0;z-index:3;pointer-events:none;transition:opacity .12s';
document.body.append(smokeVeil);
function drawRadar() {
  if (!radarContext || !me) return;
  const bounds = activeMap.bounds;
  const ctx = radarContext, scale = 150/Math.max(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ), center = 85;
  const x = value => center + (value-(bounds.maxX+bounds.minX)/2) * scale;
  const z = value => center + (value-(bounds.maxZ+bounds.minZ)/2) * scale;
  ctx.clearRect(0,0,170,170);
  ctx.save(); ctx.beginPath(); ctx.arc(85,85,83,0,Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#71858a55';
  for (const b of activeMap.solids) ctx.fillRect(x(b.x-b.w/2),z(b.z-b.d/2),b.w*scale,b.d*scale);
  ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#ed9d5d';
  for (const [name,site] of Object.entries(activeMap.sites)) ctx.fillText(name,x(site.x),z(site.z));
  for (const player of state.players) {
    if (!player.alive || (player.team !== me.team && player.id !== me.id)) continue;
    const body = player.id === me.id ? predicted : player;
    if (!body) continue;
    ctx.fillStyle = player.id === me.id ? '#ffffff' : player.team === 'CT' ? '#6fc5e9' : '#e8ae63';
    ctx.beginPath(); ctx.arc(x(body.x),z(body.z),player.id === me.id ? 3.7 : 2.5,0,Math.PI*2); ctx.fill();
  }
  if (state.bomb?.state === 'planted' || (state.bomb?.state === 'dropped' && me.team === 'T')) {
    ctx.fillStyle = '#ff623d'; ctx.fillRect(x(state.bomb.x)-3,z(state.bomb.z)-3,6,6);
  }
  ctx.restore();
}
function render(now) {
  requestAnimationFrame(render);
  const dt = Math.min(.05, (now - lastVisualTime) / 1000); lastVisualTime = now;
  frameCount++; fpsTime += dt;
  if (fpsTime > .5) { fps = Math.round(frameCount / fpsTime); frameCount = 0; fpsTime = 0; }
  const inGame = state && !['lobby'].includes(state.phase) && me && predicted;
  radar.style.display = inGame ? '' : 'none';
  if (inGame) {
    let viewed = me;
    let body = predicted;
    if (!me.alive) {
      const teammates = state.players.filter(player => player.id !== me.id && player.team === me.team && player.alive && player.connected);
      if (teammates.length) { viewed = teammates[((spectatorIndex % teammates.length) + teammates.length) % teammates.length]; body = network.interpolated(viewed.id) || viewed; }
    }
    displayEye += (eyeHeight(body) - displayEye) * Math.min(1, dt * 16);
    correction.multiplyScalar(Math.exp(-dt*15));
    camera.position.set(body.x + (viewed===me?correction.x:0), body.y + displayEye + (viewed===me?correction.y:0), body.z + (viewed===me?correction.z:0));
    camera.rotation.set((viewed === me ? Math.max(-1.55,Math.min(1.55,pitch + recoilPitch)) : body.pitch || 0), (viewed === me ? yaw + recoilYaw : body.yaw || 0), 0, 'YXZ');
    const scoped = me.alive && me.weapon === 'awp' && me.scoped && !buyOpen;
    const targetFov = scoped ? 32 : preferences.fov ?? 90;
    if (Math.abs(camera.fov-targetFov)>.1) { camera.fov += (targetFov-camera.fov) * Math.min(1,dt*15); camera.updateProjectionMatrix(); }
    scope.style.display = scoped ? '' : 'none';
    viewWeapon.setVisible(me.alive && !scoped && state.phase !== 'finished');
    const speed = Math.hypot(predicted.vx,predicted.vz);
    viewWeapon.update(dt,{ speed,grounded:predicted.grounded,crouch:predicted.crouch,aim:scoped,time:now/1000,dashTime:predicted.dashTime,slideTime:predicted.slideTime });
    audio.setListener(camera.position.x,camera.position.y,camera.position.z,camera.rotation.y);
    const quiet = keys.has('ShiftLeft') || keys.has('ShiftRight') || predicted.crouch;
    if (me.alive && predicted.grounded && speed>1 && !quiet && now>footstep) { audio.play('step'); footstep = now + Math.max(280,420-speed*15); }
    for (const [id,model] of models) {
      const p = network.interpolated(id);
      if (!p) continue;
      model.update(p,now/1000,dt);
      model.group.visible = p.connected && id !== viewed.id;
      const distance = Math.hypot(p.x-camera.position.x,p.z-camera.position.z);
      const to = { x:p.x-camera.position.x,y:p.y+eyeHeight(p)-camera.position.y,z:p.z-camera.position.z };
      const length = Math.hypot(to.x,to.y,to.z);
      const wall = length > .01 ? traceWorld(camera.position,{x:to.x/length,y:to.y/length,z:to.z/length},length,activeMap) : null;
      let smoky = false;
      for (const effect of smokeEffects.values()) {
        const center = effect.group.position;
        const t = length>.001 ? Math.max(0,Math.min(1,((center.x-camera.position.x)*to.x+(center.y+1.5-camera.position.y)*to.y+(center.z-camera.position.z)*to.z)/(length*length))) : 0;
        if (Math.hypot(camera.position.x+to.x*t-center.x,camera.position.y+to.y*t-center.y-1.5,camera.position.z+to.z*t-center.z)<4.2) { smoky=true; break; }
      }
      model.setLabelVisible(preferences.showNames !== false && p.alive && distance<40 && wall===null && !smoky);
      if (p.alive && p.grounded && !p.walk && !p.crouch && Math.hypot(p.vx,p.vz)>1 && distance<25 && now>(remoteSteps.get(id)||0)) {
        audio.play('step',{x:p.x,y:p.y,z:p.z,volume:.6}); remoteSteps.set(id,now+370);
      }
    }
    if (!bombGroup.parent) scene.add(bombGroup);
    const bomb = state.bomb;
    bombGroup.visible = !!bomb && ['dropped','planted'].includes(bomb.state);
    if (bombGroup.visible) bombGroup.position.set(bomb.x,(bomb.y||0)+.1,bomb.z);
    bombLight.visible = Math.sin(now*.009)>0;
    if (bomb?.state === 'planted' && now>bombBeep) {
      audio.play('beep',{x:bomb.x,y:bomb.y,z:bomb.z,volume:.6});
      bombBeep = now + Math.max(140,(bomb.explodesAt-network.now())/40);
    }
    const crosshair = document.getElementById('crosshair');
    if (crosshair) {
      const weapon = WEAPONS[me.weapon];
      const dispersion = weapon ? weapon.spread + weapon.moveSpread*Math.min(1,speed/weapon.speed) + (predicted.grounded ? 0 : weapon.airSpread) : .002;
      const pixels = innerHeight/(2*Math.tan(camera.fov*Math.PI/360));
      crosshair.style.setProperty('--gap', `${Math.min(90,4+(dispersion+Math.abs(recoilPitch)*.35)*pixels)}px`);
      crosshair.style.visibility = me.alive && !scoped && !buyOpen ? 'visible' : 'hidden';
    }
    if (now>nextHud) {
      ui.updateHUD(state,me,{fps,ping:network.ping,speed,now:network.now(),dashCooldown:predicted.dashCooldown,dashAvailable:predicted.dashAvailable,spectating:viewed !== me ? viewed.nickname : null});
      drawRadar(); nextHud = now+75;
    }
  } else {
    scope.style.display = 'none'; bombGroup.visible = false; viewWeapon.setVisible(false);
    const t = now*.000025;
    const radius = (activeMap.bounds.maxX-activeMap.bounds.minX)*.75;
    camera.position.set(Math.cos(t)*radius,radius*.8,Math.sin(t)*radius+7); camera.lookAt(lookAt);
    for (const model of models.values()) model.group.visible = false;
  }
  const flash = document.getElementById('flash');
  if (flash) {
    const remaining = Math.max(0,(flashUntil-now)/1000);
    const max = preferences.reducedFlash ? .32 : .94;
    flash.style.opacity = String(Math.min(max,remaining * flashIntensity * .75));
    if (!remaining) flashIntensity = 0;
  }
  const damage = document.getElementById('damage'); if (damage) damage.style.opacity = String(Math.max(0,(damageUntil-now)/380)*.7);
  for (let i=traces.length-1;i>=0;i--) if (traces[i].until<now) { scene.remove(traces[i].line); traces[i].line.geometry.dispose(); traces.splice(i,1); }
  for (const effect of smokeEffects.values()) { const grow = Math.min(1,(now-effect.created)/550); effect.group.scale.setScalar(grow); }
  for (const visual of grenadeVisuals.values()) {
    visual.mesh.position.lerp(visual.target,Math.min(1,dt*24)); visual.mesh.rotation.x += dt*8; visual.mesh.rotation.z += dt*5;
  }
  let smokeOpacity = 0;
  if (inGame) for (const effect of smokeEffects.values()) {
    const centerDistance = Math.hypot(camera.position.x-effect.group.position.x,camera.position.y-effect.group.position.y-1.5,camera.position.z-effect.group.position.z);
    smokeOpacity = Math.max(smokeOpacity,Math.min(.97,Math.max(0,(4.2-centerDistance)*.7)));
  }
  smokeVeil.style.opacity = String(smokeOpacity);
  world.update(now/1000);
  renderer.render(scene,camera);
}
initGraphics();
