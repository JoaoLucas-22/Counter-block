import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { Networking } from '../public/networking.js';

class FakeSocket {
  connected = false;
  handlers = new Map();
  replies = new Map();
  sent = [];
  disconnects = 0;
  on(name, handler) {
    const list = this.handlers.get(name) || [];
    list.push(handler); this.handlers.set(name, list); return this;
  }
  timeout(milliseconds) { this.timeoutMs = milliseconds; return this; }
  emit(name, payload, callback) {
    this.sent.push({ name, payload });
    if (typeof callback === 'function') queueMicrotask(async () => {
      const reply = this.replies.get(name) ?? { ok: true };
      const response = typeof reply === 'function' ? await reply(payload) : reply;
      if (response instanceof Error) callback(response);
      else callback(null, response);
    });
    return this;
  }
  async receive(name, ...args) {
    if (name === 'connect') this.connected = true;
    if (name === 'disconnect') this.connected = false;
    await Promise.all((this.handlers.get(name) || []).map(handler => handler(...args)));
  }
  disconnect() { this.disconnects++; this.connected = false; void this.receive('disconnect'); }
}

/** Exercises the actual transport wrapper without claiming a browser or WebGL run. */
function fixture(t, stored = null, profileToken = null) {
  const socket = new FakeSocket();
  const entries = new Map(stored === null ? [] : [['counter-block-session', stored]]);
  const profileEntries = new Map(profileToken ? [['counter-block.profile-token',profileToken]] : []);
  const timers = [];
  const originals = new Map(['window', 'sessionStorage', 'localStorage', 'setInterval', 'clearInterval'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let ioOptions;
  globalThis.window = { io: options => { ioOptions = options; return socket; } };
  globalThis.sessionStorage = {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key),
  };
  globalThis.localStorage = {
    getItem:key => profileEntries.get(key) ?? null,
    setItem:(key,value) => profileEntries.set(key,String(value)),
    removeItem:key => profileEntries.delete(key),
  };
  globalThis.setInterval = (callback, ms) => { const timer = { callback, ms, cleared: false }; timers.push(timer); return timer; };
  globalThis.clearInterval = timer => { timer.cleared = true; };
  const net = new Networking();
  t.after(() => {
    net.dispose();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { net, socket, entries, profileEntries, timers, get ioOptions() { return ioOptions; } };
}

const auth = (overrides = {}) => ({ ok: true, id: 'local-player', token: 'private-token', code: 'ABCDE',
  inputSeq: 0, state: { code: 'ABCDE', phase: 'lobby', players: [] }, ...overrides });
const player = (overrides = {}) => ({ id: 'remote', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, alive: true, weapon: 'glock', ...overrides });
const snapshot = (time, p = player(), overrides = {}) => ({ serverTime: time, round: 1, players: p ? [p] : [], ...overrides });

test('client create/join use acknowledged identity and persist only reconnect credentials', async t => {
  const f = fixture(t), entered = [], rooms = [];
  f.net.on('entered', event => entered.push(event)); f.net.on('room', state => rooms.push(state));
  assert.deepEqual(f.ioOptions.transports, ['websocket', 'polling']);
  f.socket.replies.set('room:create', auth());
  await f.net.create('Alfa');
  assert.deepEqual(f.socket.sent[0], { name: 'room:create', payload: { nickname: 'Alfa' } });
  assert.equal(f.socket.timeoutMs, 6000);
  assert.equal(f.net.id, 'local-player'); assert.equal(f.net.code, 'ABCDE'); assert.equal(f.net.inputSeq, 0);
  assert.deepEqual(JSON.parse(f.entries.get('counter-block-session')), { token: 'private-token', code: 'ABCDE' });
  assert.deepEqual(entered[0], { state: f.net.state, inputSeq: 0 }); assert.equal(rooms[0], f.net.state);
  f.net.snapshots.push(snapshot(1000));
  f.socket.replies.set('room:join', auth({ id: 'joined-player', code: 'FGHIJ', token: 'other-token', inputSeq: 27 }));
  await f.net.join('FGHIJ', 'Bravo');
  assert.deepEqual(f.socket.sent.at(-1), { name: 'room:join', payload: { code: 'FGHIJ', nickname: 'Bravo' } });
  assert.equal(f.net.id, 'joined-player'); assert.equal(f.net.inputSeq, 27);
  assert.equal(f.net.snapshots.length, 0, 'entering a new session clears interpolation history');
  assert.deepEqual(JSON.parse(f.entries.get('counter-block-session')), { token: 'other-token', code: 'FGHIJ' });
});

test('client reconnect resumes with its private token and restored command sequence', async t => {
  const credentials = { code: 'ABCDE', token: 'retained-token' };
  const f = fixture(t, JSON.stringify(credentials)), connections = [], resumed = [];
  f.net.on('connection', state => connections.push(state)); f.net.on('resumed', state => resumed.push(state));
  f.socket.replies.set('room:resume', auth({ token: credentials.token, inputSeq: 981 }));
  await f.socket.receive('connect');
  assert.deepEqual(f.socket.sent[0], { name: 'room:resume', payload: credentials });
  assert.equal(f.net.inputSeq, 981); assert.equal(resumed[0], f.net.state);
  await f.socket.receive('disconnect'); await f.socket.receive('connect_error'); await f.socket.receive('connect');
  assert.deepEqual(connections, ['connected', 'disconnected', 'connecting', 'connected']);
  assert.equal(f.socket.sent.filter(event => event.name === 'room:resume').length, 2);
  let probed = false;
  await f.socket.receive('net:probe', {}, () => { probed = true; }); assert.equal(probed, true);
});

test('client discards expired reconnect credentials and handles corrupt saved JSON', async t => {
  const f = fixture(t, JSON.stringify({ code: 'ABCDE', token: 'expired' })), failures = [];
  f.net.on('failure', error => failures.push(error));
  f.socket.replies.set('room:resume', { ok: false, error: 'A sessão expirou.' });
  await f.socket.receive('connect');
  assert.deepEqual(failures, ['A sessão expirou.']);
  assert.equal(f.net.id, null); assert.equal(f.net.code, null); assert.equal(f.net.credentials, null);
  assert.equal(f.entries.has('counter-block-session'), false);
});

test('corrupt session storage does not prevent initial connection', async t => {
  const f = fixture(t, '{invalid JSON');
  assert.equal(f.net.credentials, null);
  await f.socket.receive('connect');
  assert.equal(f.socket.sent.some(event => event.name === 'room:resume'), false);
});

test('client rejects stale snapshots and keeps a forty-frame interpolation buffer', async t => {
  const f = fixture(t), received = [];
  f.net.on('snapshot', state => received.push(state));
  await f.socket.receive('game:snapshot', snapshot(2000));
  await f.socket.receive('game:snapshot', snapshot(1900));
  await f.socket.receive('game:snapshot', snapshot(2000));
  await f.socket.receive('game:snapshot', snapshot(NaN));
  await f.socket.receive('game:snapshot', snapshot(Infinity));
  assert.equal(received.length, 1);
  assert.equal(f.net.state.serverTime, 2000);
  for (let i = 1; i <= 55; i++) await f.socket.receive('game:snapshot', snapshot(2000 + i * 50));
  assert.equal(f.net.snapshots.length, 40);
  assert.equal(f.net.snapshots[0].serverTime, 2800);
  assert.equal(f.net.snapshots.at(-1).serverTime, 4750);
  assert.equal(f.net.state.serverTime, 4750);
});

test('client clock uses server timestamps with a smoothed offset', async t => {
  const f = fixture(t);
  t.mock.method(Date, 'now', () => 1000);
  f.net.ping = 40;
  await f.socket.receive('game:snapshot', snapshot(1100));
  assert.equal(f.net.offset, 120); assert.equal(f.net.now(), 1120);
  await f.socket.receive('game:snapshot', snapshot(1200));
  assert.ok(Math.abs(f.net.offset - 125) < 1e-8);
});

test('remote interpolation uses shortest yaw, interpolates coordinates and never extrapolates', t => {
  const { net } = fixture(t), radians = degrees => degrees * Math.PI / 180;
  const first = snapshot(1000, player({ x: 0, y: 0, z: 0, yaw: radians(170), pitch: 0 }));
  const second = snapshot(1100, player({ x: 10, y: 2, z: -4, yaw: radians(-170), pitch: .6, weapon: 'ak' }));
  net.snapshots = [first, second]; net.now = () => 1150;
  const result = net.interpolated('remote');
  assert.equal(result.x, 5); assert.equal(result.y, 1); assert.equal(result.z, -2);
  assert.ok(Math.abs(result.yaw - Math.PI) < 1e-8); assert.equal(result.pitch, .3); assert.equal(result.weapon, 'ak');
  assert.equal(first.players[0].x, 0); assert.equal(second.players[0].x, 10);
  net.now = () => 1800; assert.equal(net.interpolated('remote').x, 10);
  net.now = () => 900; assert.equal(net.interpolated('remote').x, 0);
  assert.equal(net.interpolated('missing-player'), null);
  net.snapshots = []; assert.equal(net.interpolated('remote'), null);
});

test('remote respawn, death and first appearance do not blend across incompatible poses', t => {
  const { net } = fixture(t); net.now = () => 1150;
  const first = snapshot(1000, player({ x: 0 }));
  const respawn = snapshot(1100, player({ x: 100 }), { round: 2 });
  net.snapshots = [first, respawn]; assert.equal(net.interpolated('remote').x, 100);
  const dead = snapshot(1100, player({ x: 50, alive: false }));
  net.snapshots = [first, dead]; assert.equal(net.interpolated('remote').x, 50);
  assert.equal(net.interpolated('remote').alive, false);
  net.snapshots = [snapshot(1000, null), snapshot(1100, player({ x: 12 }))];
  assert.equal(net.interpolated('remote').x, 12);
});

test('actions and input are sent through the real wrapper and request failures retain clear errors', async t => {
  const f = fixture(t), command = { seq: 12, forward: 1 };
  f.net.input(command); assert.equal(f.socket.sent.length, 0);
  f.socket.connected = true; f.net.input(command); assert.equal(f.socket.sent.length, 0, 'no input without a room');
  f.net.code = 'ABCDE'; f.net.input(command);
  assert.deepEqual(f.socket.sent.at(-1), { name: 'game:input', payload: command });
  await f.net.action('buy', { item: 'ak' });
  assert.deepEqual(f.socket.sent.at(-1), { name: 'game:action', payload: { type: 'buy', item: 'ak' } });
  f.socket.replies.set('denied', { ok: false, error: 'Saldo insuficiente.' });
  await assert.rejects(f.net.request('denied'), /Saldo insuficiente/);
  f.socket.replies.set('missing', {});
  await assert.rejects(f.net.request('missing'), /Ação recusada pelo servidor/);
  f.socket.replies.set('timeout', new Error('transport timeout'));
  await assert.rejects(f.net.request('timeout'), /Servidor sem resposta/);
});

test('leave clears session even if its acknowledgement fails; dispose clears its ping timer', async t => {
  const f = fixture(t);
  f.socket.replies.set('room:create', auth()); await f.net.create('Alfa');
  f.socket.connected = true;
  const timer = f.timers[0]; assert.equal(timer.ms, 2500);
  await timer.callback();
  assert.equal(f.socket.sent.at(-1).name, 'net:ping');
  f.socket.replies.set('room:leave', { ok: false, error: 'Conexão encerrada.' });
  await assert.rejects(f.net.leave(), /Conexão encerrada/);
  assert.equal(f.net.id, null); assert.equal(f.net.code, null); assert.equal(f.net.state, null);
  assert.equal(f.net.snapshots.length, 0); assert.equal(f.entries.has('counter-block-session'), false);
  f.net.dispose(); assert.equal(timer.cleared, true); assert.equal(f.socket.connected, false);
  assert.equal(f.socket.disconnects, 1);
});

test('HTML module entry, import map and relative client import targets resolve locally', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const { document } = parseHTML(html);
  const imports = JSON.parse(document.querySelector('script[type="importmap"]').textContent).imports;
  assert.equal(imports.three, '/vendor/three.module.js');
  await access(new URL('../node_modules/three/build/three.module.js', import.meta.url));
  const visited = new Set();
  async function inspect(url) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = await readFile(url, 'utf8');
    const pattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s*)?['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier.startsWith('.')) await inspect(new URL(specifier, url));
      else if (specifier.startsWith('/shared/')) await inspect(new URL(`..${specifier}`, import.meta.url));
      else if (specifier.startsWith('/')) await inspect(new URL(`../public${specifier}`, import.meta.url));
      else assert.ok(imports[specifier], `Missing browser import map for ${specifier}`);
    }
  }
  const entries = [...document.querySelectorAll('script[type="module"][src]')];
  assert.ok(entries.length > 0);
  for (const script of entries) {
    const path = script.getAttribute('src').replace(/^\//, '');
    await inspect(new URL(`../public/${path}`, import.meta.url));
  }
  assert.ok([...visited].some(path => path.endsWith('/networking.js')));
  assert.ok([...visited].some(path => path.endsWith('/shared/physics.js')));
});


test('profile credentials authenticate reconnects but stay out of the UI state and match session', async t => {
  const f=fixture(t,null,'old-private-profile-token'), profiles=[];
  f.net.on('profile',profile => profiles.push(profile));
  assert.equal(f.ioOptions.auth.profileToken,'old-private-profile-token');
  const state={id:'ABCDEFGH',nickname:'Amigo',token:'new-private-profile-token',friends:[],requests:[],crates:{weapon:1,character:0},owned:['default'],equipped:{weapon:'default',character:'default'},lastDrop:null};
  await f.socket.receive('profile:state',state);
  assert.equal(f.profileEntries.get('counter-block.profile-token'),'new-private-profile-token');
  assert.equal(f.socket.auth.profileToken,'new-private-profile-token');
  assert.equal(f.net.profile.id,'ABCDEFGH');
  assert.equal(Object.hasOwn(f.net.profile,'token'),false);
  assert.equal(Object.hasOwn(profiles[0],'token'),false);
  assert.equal(f.entries.has('counter-block-session'),false);
  await f.socket.receive('profile:state',{...f.net.profile,crates:{weapon:0,character:0}});
  assert.equal(f.socket.auth.profileToken,'new-private-profile-token','incremental updates do not erase the private credential');
  await f.net.leave();
  assert.equal(f.profileEntries.get('counter-block.profile-token'),'new-private-profile-token','leaving a match retains profile ownership');
});
