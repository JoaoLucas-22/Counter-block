import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { UI } from '../public/ui.js';
import { MAP } from '../shared/map-data.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const visible = id => !document.getElementById(id).classList.contains('hidden');

/** These tests exercise real DOM handlers; they do not claim WebGL/browser verification. */
function fixture(t, existing = {}) {
  const { window } = parseHTML(html), entries = new Map(Object.entries(existing));
  const storage = {
    getItem: key => entries.has(key) ? entries.get(key) : null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key)
  };
  globalThis.document = window.document;
  globalThis.localStorage = storage;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {clipboard: {writeText: async () => {}}} });
  // A DOM emulator has no focus/pointer-lock/rendering implementation.
  window.HTMLElement.prototype.focus = function () {};
  // linkedom's select.value is getter-only; browsers expose a writable value.
  window.document.querySelectorAll('select').forEach(select => Object.defineProperty(select, 'value', {configurable: true, writable: true, value: select.querySelector('option')?.value || ''}));
  const calls = [], callbacks = Object.fromEntries(['create', 'join', 'team', 'ready', 'start', 'copy', 'leave', 'resume', 'buy', 'settings', 'restart'].map(name => [name, (...args) => { calls.push([name, ...args]); }]));
  const ui = new UI(callbacks);
  t.after(() => ui.dispose());
  const $ = id => window.document.getElementById(id);
  const click = id => $(id).dispatchEvent(new window.Event('click', {bubbles: true}));
  const input = (id, value, event = 'input') => { $(id).value = value; $(id).dispatchEvent(new window.Event(event, {bubbles: true})); };
  return {window, ui, calls, $, click, input, entries};
}

function player(overrides = {}) {
  return {id: 'local', nickname: 'Jogador', team: 'T', connected: true, ready: false, alive: true,
    x: MAP.buyZones.T.x, y: 0, z: MAP.buyZones.T.z,
    hp: 100, armor: 0, helmet: false, kit: false, money: 5000, kills: 0, deaths: 0, assists: 0,
    weapon: 'glock', inventory: ['glock'], ammo: {glock: {mag: 20, reserve: 120}}, ping: 24, ...overrides};
}
function state(local, overrides = {}) {
  return {code: 'ABCDE', host: local.id, phase: 'playing', serverTime: 100000, round: 1,
    roundEndsAt: 215000, buyEndsAt: 115000, score: {T: 0, CT: 0}, players: [local], bomb: {state: 'carried', carrier: local.id}, ...overrides};
}

test('menu, create and join invoke real callbacks and persist nickname', async t => {
  const {ui, calls, $, click, input, window, entries} = fixture(t);
  assert.equal(ui.screen, 'menu'); assert.ok(visible('screen-menu'));
  click('main-play'); assert.equal(ui.screen, 'play'); assert.ok(visible('screen-play'));
  click('create-room'); await flush();
  assert.equal(calls.length, 0, 'invalid nickname does not contact the server');
  assert.match($('toast-container').textContent, /pelo menos 2/);
  input('nickname', 'Amigo'); click('create-room'); await flush();
  assert.deepEqual(calls.at(-1), ['create', 'Amigo']);
  assert.equal(JSON.parse(entries.get('counter-block.nickname')), 'Amigo');
  assert.equal($('create-room').disabled, false);
  input('room-code', 'ab-3cde'); assert.equal($('room-code').value, 'ABCDE');
  $('join-form').dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true})); await flush();
  assert.deepEqual(calls.at(-1), ['join', 'ABCDE', 'Amigo']);
  input('room-code', 'AB');
  $('join-form').dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true})); await flush();
  assert.equal(calls.filter(call => call[0] === 'join').length, 1, 'incomplete room code cannot join');
  document.querySelector('[data-back="menu"]').dispatchEvent(new window.Event('click'));
  assert.equal(ui.screen, 'menu');
});

test('lobby renders safe nicknames, host, teams and every action callback', async t => {
  const {ui, calls, $, click} = fixture(t);
  const local = player(), opponent = player({id: 'other', team: 'CT', nickname: '<img src=x onerror=alert(1)>', ready: true});
  const room = state(local, {phase: 'lobby', players: [local, opponent]});
  ui.showScreen('lobby'); ui.updateRoom(room, local.id);
  assert.equal($('lobby-code').textContent, 'ABCDE'); assert.equal($('count-t').textContent, '1 / 5');
  assert.equal($('team-ct').querySelector('img'), null); assert.ok($('team-ct').textContent.includes(opponent.nickname));
  assert.match($('team-t').textContent, /HOST/); assert.match($('team-t').textContent, /VOCÊ/);
  assert.equal($('join-t').disabled, true); assert.equal($('join-ct').disabled, false); assert.equal($('start-match').disabled, false);
  click('join-ct'); click('ready-button'); click('start-match'); click('copy-code'); click('lobby-leave'); await flush();
  assert.deepEqual(calls, [['team', 'CT'], ['ready'], ['start'], ['copy'], ['leave']]);
  ui.updateRoom({...room, host: opponent.id}, local.id);
  assert.equal($('start-match').disabled, true, 'only host can start from the interface');
  const fullCT = Array.from({length: 5}, (_, index) => player({id: `ct${index}`, nickname: `CT${index}`, team: 'CT'}));
  ui.updateRoom({...room, players: [local, ...fullCT]}, local.id); assert.equal($('join-ct').disabled, true);
});

test('settings clamp saved values, update actual controls and persist changes', async t => {
  const settings = {sensitivity: 500, fov: 1, master: -2, effects: 3, renderScale: 9, quality: 'invalid', showFPS: true};
  const {ui, calls, $, click, input, entries, window} = fixture(t, {'counter-block.settings': JSON.stringify(settings)});
  assert.deepEqual(ui.settings, {sensitivity: 3, fov: 65, master: 0, effects: 1, renderScale: 1.5, quality: 'medium', showFPS: true, reducedFlash: false, showNames: true});
  click('main-settings'); assert.equal(ui.modal, 'settings'); assert.ok(visible('overlay-settings'));
  input('setting-fov', '100'); input('setting-master', '.42'); input('setting-quality', 'low', 'change');
  $('setting-reducedFlash').checked = true; $('setting-reducedFlash').dispatchEvent(new window.Event('change'));
  await flush();
  assert.equal(ui.settings.fov, 100); assert.equal(ui.settings.master, .42); assert.equal(ui.settings.quality, 'low');
  assert.equal(JSON.parse(entries.get('counter-block.settings')).reducedFlash, true);
  assert.equal(calls.at(-1)[0], 'settings'); assert.equal(calls.at(-1)[1].reducedFlash, true);
  click('settings-back'); assert.equal(ui.modal, null); assert.equal(visible('overlay-settings'), false);
  click('main-controls'); assert.ok(visible('overlay-controls')); assert.equal($('controls-list').children.length, 16);
  click('controls-back'); assert.equal(visible('overlay-controls'), false);
  ui.showScreen('game'); ui.showPause(true); click('pause-settings'); assert.equal(ui.modal, 'settings');
  click('settings-back'); assert.equal(ui.modal, 'pause'); assert.ok(visible('overlay-pause'));
  click('resume-game'); await flush(); assert.deepEqual(calls.at(-1), ['resume']);
  assert.ok(visible('overlay-pause'), 'resume callback waits for actual pointer lock before hiding pause');
  click('pause-controls'); click('controls-back'); click('pause-leave'); await flush(); assert.deepEqual(calls.at(-1), ['leave']);
});

test('buy menu invokes category purchases and enforces displayed inventory, funds and buy conditions', async t => {
  const {ui, calls, $, window} = fixture(t), local = player();
  const room = state(local); ui.updateRoom(room, local.id); ui.updateHUD(room, local, {now: room.serverTime}); ui.showBuy(true, local);
  assert.ok(visible('overlay-buy')); assert.equal(ui.buyOpen, true);
  assert.equal($('buy-items').children.length, 1, 'only team pistol is offered'); assert.equal($('buy-items').firstElementChild.disabled, true, 'owned pistol is disabled');
  const category = name => document.querySelector(`[data-category="${name}"]`).dispatchEvent(new window.Event('click'));
  category('primary'); assert.equal($('buy-items').children.length, 5, 'team rifle, AWP, Vector, Scatter and Pulse are offered');
  const ak = [...$('buy-items').children].find(button => button.textContent.includes('AK-47'));
  assert.equal(ak.disabled, false); ak.dispatchEvent(new window.Event('click')); await flush();
  assert.deepEqual(calls.at(-1), ['buy', 'ak']);
  category('equipment'); assert.equal($('buy-items').children.length, 2, 'T does not receive CT defuse kit');
  category('grenade'); assert.equal($('buy-items').children.length, 2);
  const smoke = [...$('buy-items').children].find(button => button.textContent.includes('Smoke'));
  smoke.dispatchEvent(new window.Event('click')); await flush(); assert.deepEqual(calls.at(-1), ['buy', 'smoke']);
  ui.showBuy(true, {...local, money: 0}); assert.ok([...$('buy-items').children].every(button => button.disabled));
  ui.updateHUD({...room, serverTime: 116000}, local, {now: 116000}); ui.showBuy(true, local);
  assert.ok([...$('buy-items').children].every(button => button.disabled), 'closed buy window disables purchases');
  const away = {...local, x: 25, z: 0}; ui.updateHUD(room, away, {now: room.serverTime}); ui.showBuy(true, away);
  assert.ok([...$('buy-items').children].every(button => button.disabled), 'away from base disables purchases');
  const ct = player({team: 'CT', x: MAP.buyZones.CT.x, z: MAP.buyZones.CT.z, weapon: 'usp', inventory: ['usp']});
  const ctRoom = state(ct); ui.updateHUD(ctRoom, ct, {now: ctRoom.serverTime}); ui.showBuy(true, ct); category('equipment');
  assert.ok($('buy-items').textContent.includes('Kit de desarme'));
  $('buy-close').dispatchEvent(new window.Event('click')); await flush(); assert.equal(ui.buyOpen, false); assert.deepEqual(calls.at(-1), ['resume']);
});

test('HUD reflects authoritative reload, bomb interaction, spectators and host match restart', async t => {
  const {ui, calls, $, click} = fixture(t);
  const local = player({reloadingAt: 101000, armor: 70, money: 1200}), room = state(local);
  ui.showScreen('game'); ui.updateRoom(room, local.id); ui.updateHUD(room, local, {now: 100000, fps: 61, ping: 39});
  assert.equal($('reload-label').textContent, 'RECARREGANDO'); assert.equal($('armor-value').textContent, '70');
  assert.equal($('round-time').textContent, '1:55'); assert.equal($('network-stats').textContent, '39 MS');
  ui.updateHUD(room, {...local, interaction: {type: 'plant', progress: .5}}, {now: 100000});
  assert.ok(visible('interaction')); assert.equal($('interaction-fill').style.width, '50%');
  const planted = {...room, bomb: {state: 'planted', site: 'A', explodesAt: 140000}};
  ui.updateHUD(planted, {...local, alive: false}, {now: 101000, spectating: 'Colega'});
  assert.ok(visible('spectator')); assert.match($('spectator').textContent, /COLEGA/); assert.equal($('round-time').textContent, '0:39');
  const finished = {...room, phase: 'finished', winner: 'T', reason: 'A bomba explodiu.'};
  ui.updateHUD(finished, local, {now: 102000}); assert.ok(visible('round-result')); assert.ok(visible('restart-match'));
  click('restart-match'); await flush(); assert.deepEqual(calls.at(-1), ['restart']);
  ui.updateHUD({...finished, host: 'other'}, local, {now: 102000}); assert.equal(visible('restart-match'), false);
  ui.showScore(true, room); assert.ok(visible('overlay-score')); assert.equal($('score-rows').children.length, 1);
  ui.showScore(false); assert.equal(visible('overlay-score'), false);
});

test('kill feed and scoreboard use text nodes for untrusted nicknames', t => {
  const {ui, $} = fixture(t), attacker = player({nickname: '<svg onload=alert(1)>', kills: 2}), victim = player({id: 'victim', nickname: '<img src=x>', team: 'CT', deaths: 1});
  const room = state(attacker, {players: [attacker, victim]});
  ui.updateRoom(room, attacker.id); ui.showScore(true, room); ui.feed({type: 'kill', attacker: attacker.id, target: victim.id, weapon: 'ak', headshot: true});
  assert.equal($('score-rows').querySelector('svg'), null); assert.equal($('score-rows').querySelector('img'), null);
  assert.ok($('score-rows').textContent.includes(attacker.nickname));
  assert.equal($('kill-feed').querySelector('svg'), null); assert.equal($('kill-feed').querySelector('img'), null);
  assert.ok($('kill-feed').textContent.includes(victim.nickname)); assert.ok($('kill-feed').textContent.includes('AK-47'));
  ui.toast('<img src=x>'); assert.equal($('toast-container').querySelector('img'), null);
});
