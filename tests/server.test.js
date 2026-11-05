import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../server.js';
import { CONFIG, DT } from '../shared/config.js';
import { MAP } from '../shared/map-data.js';
import { WEAPONS } from '../shared/weapons.js';
import { tickGrenades, throwGrenade } from '../server/grenades.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(predicate, message = 'condition', timeout = 1800) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${message}`);
    await pause(3);
  }
}

const request = (socket, event, payload = {}) => socket.timeout(2000).emitWithAck(event, payload);
async function accepted(socket, event, payload = {}) {
  const result = await request(socket, event, payload);
  assert.equal(result.ok, true, `${event}: ${result.error || 'request rejected'}`);
  return result;
}

/** A real HTTP + WebSocket server, with only the simulation clock under test control. */
async function fixture(t, config = {}) {
  let now = 1_800_000_000_000;
  const server = createGameServer({ manualTick: true, now: () => now, config });
  await server.listen(0);
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await pause(5);
    await server.close();
  });
  const client = async () => {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(socket);
    await until(() => socket.connected, 'WebSocket connection');
    return socket;
  };
  const tick = (count = 1) => {
    for (let i = 0; i < count; i++) {
      now += DT * 1000;
      server.tick(now);
    }
  };
  const advance = seconds => tick(Math.ceil(seconds / DT));
  const create = async (nickname = 'Alfa') => {
    const socket = await client();
    const auth = await accepted(socket, 'room:create', { nickname });
    return { socket, auth, player: server.rooms.get(auth.code).players.get(auth.id) };
  };
  const join = async (code, nickname = 'Bravo') => {
    const socket = await client();
    const auth = await accepted(socket, 'room:join', { code, nickname });
    return { socket, auth, player: server.rooms.get(auth.code).players.get(auth.id) };
  };
  const session = async ({ solo = false } = {}) => {
    const host = await create();
    await accepted(host.socket, 'team:select', { team: 'T' });
    const guest = solo ? null : await join(host.auth.code);
    if (guest) await accepted(guest.socket, 'team:select', { team: 'CT' });
    await accepted(host.socket, 'player:ready', { ready: true });
    if (guest) await accepted(guest.socket, 'player:ready', { ready: true });
    await accepted(host.socket, 'match:start');
    return { host, guest, room: server.rooms.get(host.auth.code) };
  };
  return { server, url, client, create, join, session, tick, advance, get now() { return now; } };
}

function place(player, { x = 0, y = 0, z = 10, yaw = 0, pitch = 0 } = {}) {
  Object.assign(player, { x, y, z, yaw, pitch, vx: 0, vy: 0, vz: 0, grounded: true, crouch: false });
}

function input(f, player, seq, changes = {}) {
  return {
    seq, time: f.now, forward: 0, strafe: 0, yaw: player.yaw || 0,
    pitch: player.pitch || 0, jump: false, walk: false, crouch: false,
    fire: false, interact: false, ...changes,
  };
}

async function sendInput(f, actor, seq, changes = {}) {
  actor.socket.emit('game:input', input(f, actor.player, seq, changes));
  // Input has no acknowledgement by design; wait only for the transport delivery.
  await pause(5);
  f.tick();
}

async function hold(f, actor, seconds, changes = {}) {
  let remaining = Math.ceil(seconds / DT);
  while (remaining > 0) {
    actor.seq = Math.max(actor.seq || 0, actor.player.lastSeq || 0) + 1;
    await sendInput(f, actor, actor.seq, changes);
    remaining--;
    const extra = Math.min(5, remaining);
    f.tick(extra);
    remaining -= extra;
  }
}

test('HTTP serves the actual app, shared physics and local Three.js dependency', async t => {
  const f = await fixture(t);
  for (const path of ['/', '/game.js', '/shared/physics.js', '/vendor/three.module.js']) {
    const response = await fetch(`${f.url}${path}`);
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 50, path);
  }
});

test('rooms use unique invitation codes, join through Socket.io and reject unknown codes', async t => {
  const f = await fixture(t);
  const host = await f.create();
  assert.match(host.auth.code, /^[A-Z]{5}$/);
  assert.equal(host.auth.state.phase, 'lobby');
  const friend = await f.join(host.auth.code.toLowerCase(), 'Amigo');
  assert.notEqual(friend.auth.id, host.auth.id);
  assert.equal(friend.auth.state.players.length, 2);
  assert.deepEqual(new Set(friend.auth.state.players.map(p => p.nickname)), new Set(['Alfa', 'Amigo']));
  const otherHost = await f.create('Outro');
  assert.notEqual(otherHost.auth.code, host.auth.code);
  const stranger = await f.client();
  const bad = await request(stranger, 'room:join', { code: 'ZZZZZ', nickname: 'Intruso' });
  assert.equal(bad.ok, false);
  assert.ok(bad.error);
  // Resume credentials belong only to the acknowledgement sent to their owner.
  assert.ok(host.auth.token && host.auth.token !== friend.auth.token);
  assert.equal(JSON.stringify(friend.auth.state).includes(host.auth.token), false);
});

test('a room holds ten players and rejects an eleventh; teams hold at most five', async t => {
  const f = await fixture(t);
  const host = await f.create('P0');
  const members = [host];
  for (let n = 1; n < 10; n++) members.push(await f.join(host.auth.code, `P${n}`));
  assert.equal(f.server.rooms.get(host.auth.code).players.size, 10);
  const overflow = await f.client();
  const rejected = await request(overflow, 'room:join', { code: host.auth.code, nickname: 'P10' });
  assert.equal(rejected.ok, false);
  const counts = { T: [], CT: [] };
  for (const member of members) counts[member.player.team].push(member);
  assert.equal(counts.T.length, 5);
  assert.equal(counts.CT.length, 5);
  const fullTeam = await request(counts.CT[0].socket, 'team:select', { team: 'T' });
  assert.equal(fullTeam.ok, false);
  assert.equal(counts.CT[0].player.team, 'CT');
});

test('only the host starts, readiness is required for friends and a solo room can start', async t => {
  const f = await fixture(t);
  const host = await f.create();
  const friend = await f.join(host.auth.code);
  const denied = await request(friend.socket, 'match:start');
  assert.equal(denied.ok, false);
  const notReady = await request(host.socket, 'match:start');
  assert.equal(notReady.ok, false);
  await accepted(host.socket, 'player:ready', { ready: true });
  await accepted(friend.socket, 'player:ready', { ready: true });
  await accepted(host.socket, 'match:start');
  const room = f.server.rooms.get(host.auth.code);
  assert.equal(room.phase, 'playing');
  assert.equal(room.round, 1);
  assert.ok(host.player.alive && friend.player.alive);
  assert.equal(host.player.hp, 100);
  assert.equal(host.player.money, CONFIG.initialMoney);
  const solo = await f.create('Treino');
  await accepted(solo.socket, 'match:start');
  assert.equal(f.server.rooms.get(solo.auth.code).phase, 'playing');
});

test('two clients receive the same authoritative snapshot with distinct players', async t => {
  const f = await fixture(t);
  const { host, guest, room } = await f.session();
  let hostSnapshot;
  let guestSnapshot;
  host.socket.on('game:snapshot', state => { hostSnapshot = state; });
  guest.socket.on('game:snapshot', state => { guestSnapshot = state; });
  await sendInput(f, host, 1, { forward: 1 });
  f.tick(6);
  await until(() => hostSnapshot && guestSnapshot, 'both snapshots');
  assert.equal(hostSnapshot.code, room.code);
  assert.equal(guestSnapshot.code, room.code);
  assert.equal(hostSnapshot.players.length, 2);
  assert.deepEqual(hostSnapshot.players.map(p => p.id), guestSnapshot.players.map(p => p.id));
  assert.notEqual(host.player.z, guest.player.z);
  const visible = guestSnapshot.players.find(p => p.id === host.auth.id);
  assert.ok(Number.isFinite(visible.x) && Number.isFinite(visible.z));
  assert.ok(visible.ack >= 1);
});

test('clients cannot supply position, velocity, elapsed time or replay old commands', async t => {
  const f = await fixture(t);
  const { host } = await f.session({ solo: true });
  place(host.player, { x: 0, z: 15 });
  const start = { x: host.player.x, z: host.player.z };
  await sendInput(f, host, 10, { forward: 1, strafe: 1, x: 9999, z: -9999, vx: 5000, dt: 100 });
  assert.ok(Math.hypot(host.player.x - start.x, host.player.z - start.z) <= 7 * DT + 0.01);
  assert.ok(Math.hypot(host.player.vx, host.player.vz) <= 7.01);
  const ack = host.player.ack;
  assert.equal(ack, 10);
  const yaw = host.player.yaw;
  await sendInput(f, host, 1, { forward: -1, yaw: 1000 });
  assert.equal(host.player.ack, ack, 'replayed commands are ignored');
  assert.equal(host.player.yaw, yaw);
  await sendInput(f, host, 11, { forward: NaN, yaw: Infinity, pitch: Infinity });
  assert.ok([host.player.x, host.player.y, host.player.z, host.player.yaw, host.player.pitch].every(Number.isFinite));
});

test('purchases validate balance, team, buy area, time, life and duplicate ownership', async t => {
  const f = await fixture(t);
  const { host, guest, room } = await f.session();
  const poor = await request(host.socket, 'game:action', { type: 'buy', item: 'ak' });
  assert.equal(poor.ok, false);
  host.player.money = 16000;
  const wrongTeam = await request(host.socket, 'game:action', { type: 'buy', item: 'm4' });
  assert.equal(wrongTeam.ok, false);
  const bought = await accepted(host.socket, 'game:action', { type: 'buy', item: 'ak' });
  assert.equal(bought.ok, true);
  assert.equal(host.player.money, 16000 - WEAPONS.ak.price);
  assert.ok(host.player.inventory.includes('ak'));
  const balance = host.player.money;
  const duplicate = await request(host.socket, 'game:action', { type: 'buy', item: 'ak' });
  assert.equal(duplicate.ok, false);
  assert.equal(host.player.money, balance);
  place(host.player, { x: 0, z: 15 });
  assert.equal((await request(host.socket, 'game:action', { type: 'buy', item: 'armor' })).ok, false);
  guest.player.alive = false;
  assert.equal((await request(guest.socket, 'game:action', { type: 'buy', item: 'flash' })).ok, false);
  guest.player.alive = true;
  room.buyEndsAt = f.now - 1;
  assert.equal((await request(guest.socket, 'game:action', { type: 'buy', item: 'flash' })).ok, false);
  assert.ok(host.player.money >= 0 && guest.player.money >= 0);
});

test('malformed purchase identifiers and equipment slots cannot mutate authoritative inventory', async t => {
  const f = await fixture(t);
  const { host } = await f.session({ solo: true });
  host.player.money = 16000;
  const before = {
    money: host.player.money, weapon: host.player.weapon, inventory: [...host.player.inventory],
    ammo: structuredClone(host.player.ammo), armor: host.player.armor,
  };
  for (const item of ['__proto__', 'constructor', 'toString', ['ak'], ['armor'], { toString: null }, null, 42]) {
    const result = await request(host.socket, 'game:action', { type: 'buy', item });
    assert.equal(result.ok, false, `invalid item ${JSON.stringify(item)}`);
    assert.match(result.error, /Item inválido/);
  }
  for (const slot of [0, 4, 1.5, '1', null]) {
    const result = await request(host.socket, 'game:action', { type: 'equip', slot });
    assert.equal(result.ok, false, `invalid slot ${JSON.stringify(slot)}`);
    assert.match(result.error, /Slot inválido/);
  }
  assert.deepEqual({
    money: host.player.money, weapon: host.player.weapon, inventory: host.player.inventory,
    ammo: host.player.ammo, armor: host.player.armor,
  }, before);
});

test('semi-automatic fire consumes one round per press, burst consumes three and reload conserves ammo', async t => {
  const f = await fixture(t);
  const { host } = await f.session({ solo: true });
  const ammo = host.player.ammo.glock;
  const initial = ammo.mag;
  await hold(f, host, 0.7, { fire: true });
  assert.equal(ammo.mag, initial - 1, 'holding a semi-automatic pistol cannot auto-fire');
  await hold(f, host, 0.1, { fire: false });
  await accepted(host.socket, 'game:action', { type: 'secondary' });
  await hold(f, host, 0.6, { fire: true });
  assert.equal(ammo.mag, initial - 4, 'one burst consists of three server-timed shots');
  await hold(f, host, 0.1, { fire: false });
  const total = ammo.mag + ammo.reserve;
  await accepted(host.socket, 'game:action', { type: 'reload' });
  const before = ammo.mag;
  await hold(f, host, 0.5, { fire: true });
  assert.equal(ammo.mag, before, 'reloading blocks shots');
  f.advance(WEAPONS.glock.reload);
  assert.equal(ammo.mag, WEAPONS.glock.mag);
  assert.equal(ammo.mag + ammo.reserve, total);
  assert.equal(host.player.reloadingAt, 0);
});

test('automatic fire obeys weapon cadence and ammunition cannot go below zero', async t => {
  const f = await fixture(t);
  const { host } = await f.session({ solo: true });
  host.player.money = 16000;
  await accepted(host.socket, 'game:action', { type: 'buy', item: 'ak' });
  const ammo = host.player.ammo.ak;
  await hold(f, host, 0.5, { fire: true });
  const used = WEAPONS.ak.mag - ammo.mag;
  assert.ok(used >= 4 && used <= 6, `AK fired ${used} shots in half a second`);
  ammo.mag = 1;
  await hold(f, host, 0.5, { fire: true });
  assert.equal(ammo.mag, 0);
  await hold(f, host, 0.5, { fire: true });
  assert.equal(ammo.mag, 0);
});

test('a server-evaluated headshot eliminates the enemy and damage stops after the round', async t => {
  const f = await fixture(t);
  const { host, guest, room } = await f.session();
  place(host.player, { x: 0, z: 8 });
  place(guest.player, { x: 0, z: 0, yaw: Math.PI });
  f.tick(15); // Populate the bounded history with the controlled combat positions.
  const kills = [];
  host.socket.on('game:event', event => { if (event.type === 'kill') kills.push(event); });
  await hold(f, host, 0.1, { fire: true });
  assert.equal(guest.player.hp, 0);
  assert.equal(guest.player.alive, false);
  assert.equal(guest.player.deaths, 1);
  assert.equal(host.player.kills, 1);
  assert.equal(room.phase, 'ended');
  assert.equal(room.winner, 'T');
  assert.equal(room.score.T, 1);
  await until(() => kills.length === 1, 'kill feed event');
  assert.equal(kills[0].headshot, true);
  const hp = host.player.hp;
  assert.equal(room.applyDamage(guest.player, host.player, 999, 'head', f.now), 0);
  assert.equal(host.player.hp, hp);
  assert.ok(host.player.money > CONFIG.initialMoney);
});

test('solid geometry blocks bullets even when the enemy is aligned with the crosshair', async t => {
  const f = await fixture(t);
  const { host, guest } = await f.session();
  // This line goes directly through the east building at x=12, z=-3.
  place(host.player, { x: 12, z: 2 });
  place(guest.player, { x: 12, z: -9, yaw: Math.PI });
  f.tick(15);
  const ammo = host.player.ammo.glock.mag;
  await hold(f, host, 0.1, { fire: true });
  assert.equal(host.player.ammo.glock.mag, ammo - 1);
  assert.equal(guest.player.hp, 100);
  assert.equal(guest.player.alive, true);
});

test('lag compensation rewinds a recent target pose and retains only bounded history', async t => {
  const f = await fixture(t);
  const { host, guest, room } = await f.session();
  place(host.player, { x: 0, z: 8 });
  place(guest.player, { x: 0, z: 0, yaw: Math.PI });
  f.tick(30);
  assert.ok(room.history.length <= Math.ceil((CONFIG.maxRewind + 0.05) / DT) + 1);
  assert.ok(room.history[0].time >= f.now - CONFIG.maxRewind * 1000 - 51);
  host.player.ping = 300;
  const viewedAt = f.now - 50;
  place(guest.player, { x: 3, z: 0, yaw: Math.PI });
  f.tick(3);
  // The shot timestamp describes the previous visible pose, still inside the 200ms cap.
  await sendInput(f, host, 1, { fire: true, time: viewedAt });
  assert.equal(guest.player.x, 3, 'the target has already moved away from the live ray');
  assert.equal(guest.player.hp, 0, 'the recent pose is evaluated on the server');
  assert.equal(room.winner, 'T');
});

test('a flood of input packets has a bounded queue and cannot add simulation time', async t => {
  const f = await fixture(t);
  const { host } = await f.session({ solo: true });
  place(host.player, { x: 0, z: 15 });
  for (let seq = 1; seq <= 300; seq++) {
    host.socket.emit('game:input', input(f, host.player, seq, { forward: 1 }));
  }
  await until(() => host.player.lastSeq > 0, 'input delivery');
  await pause(10);
  assert.ok(host.player.inputQueue.length <= 8);
  const z = host.player.z;
  f.tick();
  assert.ok(z - host.player.z <= WEAPONS.glock.speed * DT + 0.001);
  assert.ok(host.player.inputQueue.length <= 7);
  assert.ok(host.player.ack <= host.player.lastSeq);
});

test('armor and helmets reduce covered damage; a third teammate can receive an assist', async t => {
  const f = await fixture(t);
  const host = await f.create();
  const target = await f.join(host.auth.code, 'Alvo');
  const assist = await f.join(host.auth.code, 'Apoio');
  await accepted(host.socket, 'team:select', { team: 'T' });
  await accepted(target.socket, 'team:select', { team: 'CT' });
  await accepted(assist.socket, 'team:select', { team: 'T' });
  for (const actor of [host, target, assist]) await accepted(actor.socket, 'player:ready', { ready: true });
  await accepted(host.socket, 'match:start');
  const room = f.server.rooms.get(host.auth.code);
  target.player.armor = 100;
  target.player.helmet = true;
  assert.equal(room.applyDamage(assist.player, target.player, 60, 'head', f.now), 30);
  assert.equal(target.player.hp, 70);
  assert.equal(target.player.armor, 70);
  room.applyDamage(host.player, target.player, 140, 'legs', f.now);
  assert.equal(target.player.alive, false);
  assert.equal(assist.player.assists, 1);
  assert.equal(host.player.kills, 1);
  assert.equal(target.player.deaths, 1);
});

test('planting is limited to a site, cancelling resets progress and CT can complete a defuse', async t => {
  const f = await fixture(t);
  const { host, guest, room } = await f.session();
  assert.equal(room.bomb.carrier, host.auth.id);
  await hold(f, host, 0.3, { interact: true });
  assert.equal(room.bomb.state, 'carried');
  assert.equal(host.player.interaction, null, 'cannot plant at T spawn');
  place(host.player, { x: 24, z: -21 });
  await hold(f, host, 1, { interact: true });
  assert.equal(host.player.interaction.type, 'plant');
  assert.ok(host.player.interaction.progress > 0);
  await hold(f, host, 0.1, { interact: false });
  assert.equal(host.player.interaction, null);
  await hold(f, host, CONFIG.plantTime + 0.2, { interact: true });
  assert.equal(room.bomb.state, 'planted');
  assert.equal(room.bomb.site, 'B');
  assert.ok(room.bomb.explodesAt > f.now);
  const plantedMoney = host.player.money;
  assert.ok(plantedMoney >= CONFIG.initialMoney + 300);
  place(guest.player, { x: room.bomb.x, z: room.bomb.z + 1 });
  await hold(f, guest, CONFIG.defuseTime - 0.2, { interact: true });
  assert.equal(room.bomb.state, 'planted', 'defusing takes the configured full duration');
  await hold(f, guest, 0.5, { interact: true });
  assert.equal(room.bomb.state, 'defused');
  assert.equal(room.phase, 'ended');
  assert.equal(room.winner, 'CT');
  assert.equal(room.score.CT, 1);
});

test('a defuse kit uses its shorter duration and releasing E cancels the defuse', async t => {
  const f = await fixture(t);
  const { host, guest, room } = await f.session();
  // Construct only the authoritative objective state; the interaction still arrives over Socket.io.
  room.bomb = { state: 'planted', carrier: null, x: 0, y: 0.1, z: 12, site: 'B', explodesAt: f.now + 40000 };
  place(guest.player, { x: 0, z: 13 });
  guest.player.kit = true;
  await hold(f, guest, 0.7, { interact: true });
  assert.equal(guest.player.interaction.type, 'defuse');
  await hold(f, guest, 0.1, { interact: false });
  assert.equal(guest.player.interaction, null);
  await hold(f, guest, CONFIG.kitDefuseTime - 0.2, { interact: true });
  assert.equal(room.bomb.state, 'planted');
  await hold(f, guest, 0.5, { interact: true });
  assert.equal(room.bomb.state, 'defused');
  assert.equal(room.winner, 'CT');
  assert.equal(host.player.alive, true);
});

test('eliminating all T after planting keeps the bomb active until explosion', async t => {
  const f = await fixture(t);
  const { host, guest, room } = await f.session();
  room.bomb = { state: 'planted', carrier: null, x: 0, y: 0.1, z: 12, site: 'B', explodesAt: f.now + 40000 };
  room.applyDamage(guest.player, host.player, 100, 'legs', f.now);
  assert.equal(host.player.alive, false);
  assert.equal(room.phase, 'playing');
  assert.equal(room.bomb.state, 'planted');
  f.advance(40.1);
  assert.equal(room.bomb.state, 'exploded');
  assert.equal(room.phase, 'ended');
  assert.equal(room.winner, 'T');
  assert.equal(room.score.T, 1);
});

test('bombs can be dropped and picked up by T, while CT cannot take them', async t => {
  const f = await fixture(t);
  const { host, guest, room } = await f.session();
  place(host.player, { x: 0, z: 12 });
  await accepted(host.socket, 'game:action', { type: 'dropBomb' });
  assert.equal(room.bomb.state, 'dropped');
  place(guest.player, { x: 0, z: 12 });
  place(host.player, { x: 0, z: 15 });
  f.advance(1);
  assert.equal(room.bomb.state, 'dropped');
  place(host.player, { x: 0, z: 12 });
  f.tick();
  assert.equal(room.bomb.state, 'carried');
  assert.equal(room.bomb.carrier, host.auth.id);
});

test('round timeout awards CT once and the next round respawns players automatically', async t => {
  const f = await fixture(t);
  const { host, guest, room } = await f.session();
  room.roundEndsAt = f.now + 2 * DT * 1000;
  f.tick(3);
  assert.equal(room.phase, 'ended');
  assert.equal(room.score.CT, 1);
  assert.equal(room.winner, 'CT');
  const balance = guest.player.money;
  f.tick(10);
  assert.equal(room.score.CT, 1, 'round rewards and score cannot be granted twice');
  assert.equal(guest.player.money, balance);
  f.advance(CONFIG.roundEndTime + 0.1);
  assert.equal(room.phase, 'playing');
  assert.equal(room.round, 2);
  assert.equal(host.player.hp, 100);
  assert.equal(guest.player.hp, 100);
  assert.ok(host.player.alive && guest.player.alive);
  assert.equal(room.bomb.state, 'carried');
});

test('configurable side switch and match completion allow a new match in the same room', async t => {
  const f = await fixture(t, { maxRounds: 2, swapAfter: 1, roundEndTime: 0.1 });
  const { host, guest, room } = await f.session();
  room.endRound('T', 'test first round', f.now);
  f.advance(0.2);
  assert.equal(room.round, 2);
  assert.equal(host.player.team, 'CT');
  assert.equal(guest.player.team, 'T');
  assert.deepEqual(room.score, { T: 0, CT: 1 });
  room.endRound('CT', 'test second round', f.now);
  assert.equal(room.phase, 'finished');
  assert.equal(room.winner, 'CT');
  await accepted(host.socket, 'match:restart');
  assert.equal(room.phase, 'playing');
  assert.equal(room.round, 1);
  assert.deepEqual(room.score, { T: 0, CT: 0 });
});

test('host can restart a finished match with a resumed unready player and a late joiner', async t => {
  const f = await fixture(t, { maxRounds: 1 });
  const { host, guest, room } = await f.session();
  room.endRound('T', 'completed match', f.now);
  assert.equal(room.phase, 'finished');
  guest.socket.disconnect();
  await until(() => !guest.player.connected, 'finished-match disconnect');
  const resumedSocket = await f.client();
  await accepted(resumedSocket, 'room:resume', { code: room.code, token: guest.auth.token });
  assert.equal(guest.player.ready, false);
  const late = await f.join(room.code, 'ChegouDepois');
  assert.equal(late.player.ready, false);
  assert.equal((await request(late.socket, 'match:restart')).ok, false, 'restart remains host-only');
  await accepted(host.socket, 'match:restart');
  assert.equal(room.phase, 'playing');
  assert.equal(room.round, 1);
  assert.deepEqual(room.score, { T: 0, CT: 0 });
  assert.ok([...room.players.values()].every(p => p.alive && p.connected));
});

test('survivors retain firearms while magazines and reserves replenish for the next round', async t => {
  const f = await fixture(t, { roundEndTime: 0.1 });
  const { host, room } = await f.session();
  host.player.money = 16000;
  await accepted(host.socket, 'game:action', { type: 'buy', item: 'ak' });
  await accepted(host.socket, 'game:action', { type: 'buy', item: 'armor' });
  for (const ammo of Object.values(host.player.ammo)) { ammo.mag = 0; ammo.reserve = 0; }
  const weapons = [...host.player.inventory];
  room.endRound('T', 'survivor round', f.now);
  const balance = host.player.money;
  f.advance(0.2);
  assert.equal(room.round, 2);
  assert.equal(host.player.weapon, 'ak');
  assert.deepEqual(host.player.inventory, weapons);
  assert.equal(host.player.armor, 100);
  assert.equal(host.player.money, balance, 'ammunition replenishment costs no money');
  for (const id of weapons) {
    assert.deepEqual(host.player.ammo[id], { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve });
  }
});

test('disconnect transfers host, secure reconnect retains identity and empty rooms expire', async t => {
  const f = await fixture(t);
  const host = await f.create();
  const guest = await f.join(host.auth.code);
  const room = f.server.rooms.get(host.auth.code);
  host.socket.disconnect();
  await until(() => !host.player.connected, 'disconnect processing');
  assert.equal(room.host, guest.auth.id);
  const replacement = await f.client();
  const invalid = await request(replacement, 'room:resume', { code: room.code, token: 'wrong-token' });
  assert.equal(invalid.ok, false);
  const resumed = await accepted(replacement, 'room:resume', { code: room.code, token: host.auth.token });
  assert.equal(resumed.id, host.auth.id);
  assert.equal(room.players.size, 2);
  assert.equal(host.player.connected, true);
  const duplicate = await f.client();
  assert.equal((await request(duplicate, 'room:resume', { code: room.code, token: host.auth.token })).ok, false);
  guest.socket.disconnect();
  replacement.disconnect();
  await until(() => [...room.players.values()].every(p => !p.connected), 'all disconnects');
  f.advance(CONFIG.reconnectTime + 0.1);
  assert.equal(f.server.rooms.has(room.code), false);
});

test('explicitly leaving deletes a last-player room immediately, including after a round', async t => {
  const f = await fixture(t);
  const { host, room } = await f.session({ solo: true });
  room.endRound('CT', 'time expired', f.now);
  await accepted(host.socket, 'room:leave');
  assert.equal(f.server.rooms.has(host.auth.code), false);
});

test('smoke detonates on the server, lasts fifteen seconds and is removed afterwards', () => {
  const room = { grenades: [], players: new Map() };
  const player = { id: 'thrower', x: 0, y: 0, z: 15, yaw: 0, pitch: 0 };
  const events = [];
  const emit = event => events.push(event);
  const grenade = throwGrenade(room, player, 'smoke', 1000, emit);
  assert.ok(grenade);
  assert.equal(room.grenades.length, 1);
  tickGrenades(room, DT, 2799, emit);
  assert.equal(grenade.active, false);
  tickGrenades(room, DT, 2800, emit);
  assert.equal(grenade.active, true);
  assert.equal(grenade.expiresAt, 17800);
  assert.ok(events.some(event => event.type === 'grenade' && event.action === 'smoke'));
  tickGrenades(room, DT, 17801, emit);
  assert.equal(room.grenades.length, 0);
});

test('flash duration depends on view direction and solid walls block the effect', () => {
  const makeFlash = (x, z) => ({ id: 'flash', type: 'flash', owner: 'owner', x, y: 1.61, z,
    vx: 0, vy: 0, vz: 0, active: false, detonateAt: 0, expiresAt: 0 });
  const facing = { id: 'facing', connected: true, alive: true, x: 0, y: 0, z: 10, yaw: 0, pitch: 0 };
  const away = { ...facing, id: 'away', yaw: Math.PI };
  const events = [];
  tickGrenades({ grenades: [makeFlash(0, 5)], players: new Map([[facing.id, facing], [away.id, away]]) },
    0, 100, event => events.push(event));
  const front = events.find(event => event.type === 'flash' && event.target === facing.id);
  const back = events.find(event => event.type === 'flash' && event.target === away.id);
  assert.ok(front && back);
  assert.ok(front.intensity > back.intensity);
  assert.ok(front.duration > back.duration);
  const behindWall = { ...facing, id: 'hidden', x: 12, z: 2 };
  const blocked = [];
  tickGrenades({ grenades: [makeFlash(12, -8)], players: new Map([[behindWall.id, behindWall]]) },
    0, 100, event => blocked.push(event));
  assert.equal(blocked.some(event => event.type === 'flash'), false);
});
