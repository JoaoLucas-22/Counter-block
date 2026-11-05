import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { io } from 'socket.io-client';
import { createGameServer } from '../server.js';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(predicate, message, frame = () => {}, timeout = 2500) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${message}`);
    frame(); await sleep(8);
  }
}

/**
 * Execute the actual game entry point and its actual helper modules against a real
 * Socket.io server. linkedom supplies DOM events; the graphics boundary is stubbed.
 * This checks module wiring and gameplay input, not browser rasterization/WebGL.
 */
test('game entry connects real menu, lobby, movement, shop, equipment and rendering state', async t => {
  const server = createGameServer();
  await server.listen(0);
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  const originalInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const keys = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'innerWidth', 'innerHeight',
    'devicePixelRatio', 'requestAnimationFrame', 'cancelAnimationFrame', 'setInterval', '__CounterBlockRenderer'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const intervals = [], sockets = [], renderers = [];
  let client, pendingFrame;
  const errors = [];
  t.mock.method(console, 'error', (...values) => errors.push(values));
  t.after(async () => {
    for (const interval of intervals) originalClearInterval(interval);
    client?.__network.dispose();
    client?.__ui.dispose(); client?.__audio.dispose();
    for (const socket of sockets) socket.disconnect();
    await server.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const { document, window: domWindow } = parseHTML(html);
  const createElement = document.createElement.bind(document);
  document.createElement = name => {
    const element = createElement(name);
    if (name.toLowerCase() === 'canvas') {
      const context = Object.fromEntries(['fillRect', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke',
        'fillText', 'roundRect', 'fill', 'save', 'restore', 'arc', 'clip'].map(method => [method, () => {}]));
      Object.defineProperty(element, 'getContext', { value: type => { assert.equal(type, '2d'); return context; } });
    }
    return element;
  };
  domWindow.HTMLElement.prototype.focus = function () {};
  for (const select of document.querySelectorAll('select')) {
    Object.defineProperty(select, 'value', { configurable: true, writable: true, value: select.querySelector('option')?.value || '' });
  }
  document.pointerLockElement = null;
  document.exitPointerLock = () => {
    document.pointerLockElement = null;
    document.dispatchEvent(new domWindow.Event('pointerlockchange'));
  };
  const storage = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  };
  const browserWindow = {
    io(options) {
      const socket = io(url, { ...options, reconnection: false }); sockets.push(socket); return socket;
    },
    addEventListener: domWindow.addEventListener.bind(domWindow),
    removeEventListener: domWindow.removeEventListener.bind(domWindow),
  };
  class RendererBoundary {
    constructor() {
      this.domElement = document.createElement('canvas'); this.shadowMap = {}; this.frames = 0;
      this.domElement.requestPointerLock = async () => {
        document.pointerLockElement = this.domElement;
        document.dispatchEvent(new domWindow.Event('pointerlockchange'));
      };
      renderers.push(this);
    }
    setSize(width, height) { this.width = width; this.height = height; }
    setPixelRatio(value) { this.pixelRatio = value; }
    render(scene, camera) {
      this.frames++; this.scene = scene; this.camera = camera;
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      scene.traverse(object => assert.ok(object.matrixWorld.elements.every(Number.isFinite), 'finite scene transform'));
      assert.ok(camera.projectionMatrix.elements.every(Number.isFinite), 'finite camera projection');
    }
    dispose() {}
  }
  const globals = {
    window: browserWindow, document, navigator: { clipboard: { writeText: async () => {} } },
    localStorage: storage(), sessionStorage: storage(), innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    requestAnimationFrame: callback => { pendingFrame = callback; return 1; }, cancelAnimationFrame: () => {},
    setInterval: (callback, milliseconds, ...args) => {
      const timer = originalInterval(callback, milliseconds, ...args); intervals.push(timer); return timer;
    },
    __CounterBlockRenderer: RendererBoundary,
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

  const entry = new URL('../public/game.js', import.meta.url);
  let source = await readFile(entry, 'utf8');
  source = source.replace("import * as THREE from 'three';",
    `import * as ThreeSource from ${JSON.stringify(import.meta.resolve('three'))};\nconst THREE = {...ThreeSource, WebGLRenderer:globalThis.__CounterBlockRenderer};`);
  source = source.replace(/\bfrom\s+(['"])(\.\/[^'"]+|\/shared\/[^'"]+)\1/g, (_match, _quote, path) => {
    const target = path.startsWith('/') ? new URL(`..${path}`, import.meta.url) : new URL(path, entry);
    return `from ${JSON.stringify(target.href)}`;
  });
  // Access only permits teardown of the real module's retained resources.
  source += '\nexport {network as __network, ui as __ui, audio as __audio};\n';
  client = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const frame = () => {
    assert.equal(typeof pendingFrame, 'function', 'entry point scheduled rendering');
    const callback = pendingFrame; pendingFrame = null; callback(performance.now());
  };
  const $ = id => document.getElementById(id);
  const visible = id => !$(id).classList.contains('hidden');
  const click = id => $(id).dispatchEvent(new domWindow.Event('click', { bubbles: true }));
  const key = (code, type = 'keydown') => {
    const event = new domWindow.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { code: { value: code }, repeat: { value: false } });
    document.dispatchEvent(event);
  };
  assert.equal(renderers.length, 1); frame();
  await until(() => sockets[0]?.connected, 'real frontend WebSocket connection', frame);
  assert.match($('connection-text').textContent, /ONLINE/);

  click('main-play'); $('nickname').value = 'Jogo Integrado'; click('create-room');
  await until(() => visible('screen-lobby') && server.rooms.size === 1, 'button-created lobby', frame);
  const room = [...server.rooms.values()][0], player = [...room.players.values()][0];
  assert.equal(player.nickname, 'Jogo Integrado'); assert.match($('lobby-code').textContent, /^[A-Z]{5}$/);
  click('start-match');
  await until(() => room.phase === 'playing' && visible('screen-game'), 'actual match start', frame);
  frame(); assert.ok(visible('overlay-pause'));
  click('resume-game');
  await until(() => document.pointerLockElement === renderers[0].domElement, 'mouse capture', frame);
  assert.equal(visible('overlay-pause'), false);

  const initialZ = player.z;
  key('KeyW');
  await until(() => player.z < initialZ - .25, 'W key moving the authoritative server body', frame);
  key('KeyW', 'keyup');
  assert.ok(player.ack > 0); assert.ok(Number.isFinite(player.vz));
  await sleep(80); frame();
  key('KeyB'); assert.ok(visible('overlay-buy')); assert.equal(document.pointerLockElement, null);
  document.querySelector('[data-category="grenade"]').dispatchEvent(new domWindow.Event('click'));
  const smoke = [...$('buy-items').children].find(button => button.textContent.includes('Smoke'));
  assert.ok(smoke); assert.equal(smoke.disabled, false);
  const initialMoney = player.money; smoke.dispatchEvent(new domWindow.Event('click'));
  await until(() => player.inventory.includes('smoke'), 'server-acknowledged smoke purchase', frame);
  assert.equal(player.money, initialMoney - 300);
  await sleep(80); frame();
  assert.ok($('equipment-bar').textContent.includes('SMOKE'));
  click('buy-close');
  await until(() => document.pointerLockElement === renderers[0].domElement, 'buy-close resumes pointer lock', frame);
  assert.equal(visible('overlay-buy'), false);
  await sleep(120); frame();
  assert.equal(visible('overlay-buy'), false, 'new snapshots do not reopen the dismissed shop');
  key('Digit3');
  await until(() => player.weapon === 'smoke', 'actual equip action', frame);
  await sleep(80); frame(); assert.equal($('weapon-name').textContent, 'SMOKE');
  key('Digit2');
  await until(() => player.weapon === 'glock', 'pistol equip action', frame);
  assert.ok(renderers[0].frames > 5);
  assert.equal(errors.length, 0, errors.map(values => values.join(' ')).join('\n'));

  document.exitPointerLock(); click('pause-leave');
  await until(() => server.rooms.size === 0 && visible('screen-menu'), 'leave button cleans room', frame);
  frame(); assert.equal(visible('overlay-buy'), false);
});
