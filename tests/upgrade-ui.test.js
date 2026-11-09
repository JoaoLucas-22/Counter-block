import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { UI } from '../public/ui.js';
import { MAPS } from '../shared/map-data.js';
import { SKINS } from '../shared/cosmetics.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
  const {window} = parseHTML(html), entries = new Map(), calls = [];
  globalThis.document = window.document;
  globalThis.localStorage = {getItem:key => entries.get(key) || null, setItem:(key,value) => entries.set(key,String(value))};
  Object.defineProperty(globalThis, 'navigator', {configurable:true,value:{clipboard:{writeText:async value => calls.push(['clipboard',value])}}});
  window.HTMLElement.prototype.focus = function () {};
  document.querySelectorAll('select').forEach(select => Object.defineProperty(select, 'value', {configurable:true,writable:true,value:select.querySelector('option')?.value || ''}));
  const callbacks = Object.fromEntries(['friendRequest','friendAccept','friendRemove','friendJoin','openCrate','equipSkin','selectMap','fullscreen','settings'].map(name=>[name,(...args)=>calls.push([name,...args])]));
  const ui = new UI(callbacks); t.after(()=>ui.dispose());
  const $ = id => document.getElementById(id), event = (node,type='click') => node.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}));
  return {ui,$,calls,entries,event,window};
}
function profile(overrides={}) {
  return {id:'ABCDEFGH',nickname:'Amigo',friends:[],requests:[],owned:['default'],crates:{weapon:0,character:0},equipped:{weapon:'default',character:'default'},...overrides};
}
function local(map=MAPS.dust,overrides={}) {
  return {id:'local',nickname:'Local',team:'T',alive:true,connected:true,x:map.buyZones.T.x,y:0,z:map.buyZones.T.z,weapon:'glock',inventory:['glock','knife'],ammo:{glock:{mag:20,reserve:120}},hp:100,money:800,armor:0,...overrides};
}
function room(player,mapId='dust',overrides={}) {
  return {code:'ABCDE',host:player.id,phase:'lobby',round:1,mapId,players:[player],serverTime:1000,buyEndsAt:16000,roundEndsAt:116000,score:{T:0,CT:0},bomb:{state:'carried',carrier:player.id},...overrides};
}

test('social menu uses server profile, safe nicknames and all friend actions',async t=>{
  const {ui,$,event,calls}=fixture(t);
  const p=profile({friends:[{id:'IJKLMNOP',nickname:'<img src=x>',online:true,roomCode:'ABCDE'},{id:'QRSTUVWX',nickname:'Offline',online:false}],requests:[{id:'ZZZZZZZZ',nickname:'<svg onload=alert(1)>'}]});
  ui.updateProfile(p); event($('main-friends'));
  assert.equal(ui.modal,'friends'); assert.equal($('profile-code').textContent,p.id); assert.equal($('menu-profile-code').textContent,p.id);
  assert.equal($('friend-list').querySelector('img'),null); assert.equal($('friend-requests').querySelector('svg'),null);
  assert.ok($('friend-list').textContent.includes('<img src=x>'));
  const buttons=$('friend-list').querySelectorAll('button');
  assert.equal(buttons[0].disabled,false); assert.equal(buttons[2].disabled,true);
  event(buttons[0]); event(buttons[1]); event($('friend-requests').querySelector('button')); event($('copy-profile-code')); await flush();
  assert.deepEqual(calls,[['friendJoin','IJKLMNOP'],['friendRemove','IJKLMNOP'],['friendAccept','ZZZZZZZZ'],['clipboard','ABCDEFGH']]);
  event($('friends-back')); assert.equal(ui.modal,null);
});

test('friend request form validates eight letters and invokes server callback',async t=>{
  const {ui,$,event,calls}=fixture(t); ui.updateProfile(profile()); ui.showFriends();
  $('friend-code').value='abc-4defgh'; event($('friend-code'),'input'); assert.equal($('friend-code').value,'ABCDEFGH');
  $('friend-code').value='AB'; event($('friend-form'),'submit'); await flush(); assert.equal(calls.length,0);
  $('friend-code').value='IJKLMNOP'; event($('friend-form'),'submit'); await flush(); assert.deepEqual(calls.at(-1),['friendRequest','IJKLMNOP']);
});

test('crate opening requires server balance and does not locally fabricate a reward',async t=>{
  const {ui,$,event,calls}=fixture(t); ui.showCollection();
  assert.equal($('open-weapon-crate').disabled,true); ui.updateProfile(profile()); assert.equal($('open-weapon-crate').disabled,true);
  ui.updateProfile(profile({crates:{weapon:2,character:1}}));
  assert.equal($('cases-count').textContent,'3'); assert.equal($('weapon-crate-count').textContent,'2'); assert.equal($('open-weapon-crate').disabled,false);
  event($('open-weapon-crate')); event($('open-weapon-crate')); await flush();
  assert.deepEqual(calls,[['openCrate','weapon']]);
  assert.equal($('weapon-crate-count').textContent,'2','only authoritative profile updates alter inventory');
  assert.equal($('crate-result').classList.contains('hidden'),true);
  ui.updateProfile(profile({owned:['default','oxide'],lastDrop:{skin:'oxide',duplicate:false,crate:'weapon'},crates:{weapon:1,character:1}}));
  assert.match($('crate-result').textContent,/NOVO VISUAL.*Óxido/); assert.match($('crate-odds').textContent,/50%/); assert.match($('crate-odds').textContent,/5%/);
  ui.updateProfile(profile({owned:['default','oxide'],lastDrop:{skin:'oxide',duplicate:true,crate:'weapon'}})); assert.match($('crate-result').textContent,/REPETIDO/);
});

test('collection exposes only owned skins of the selected kind and equips by callback',async t=>{
  const {ui,$,event,calls}=fixture(t); ui.updateProfile(profile({owned:['default','oxide','scout']})); ui.showCollection();
  event(document.querySelector('[data-collection="weapon"]'));
  assert.equal($('collection-skins').children.length,2); assert.ok($('collection-skins').textContent.includes(SKINS.oxide.name)); assert.ok(!$('collection-skins').textContent.includes(SKINS.scout.name));
  const oxide=$('collection-skins').querySelector('[data-skin="oxide"]'); event(oxide.querySelector('button')); await flush();
  assert.deepEqual(calls.at(-1),['equipSkin','weapon','oxide']);
  ui.updateProfile(profile({owned:['default','oxide','scout'],equipped:{weapon:'oxide',character:'default'}}));
  assert.equal($('collection-skins').querySelector('[data-skin="oxide"] button').disabled,true);
  event(document.querySelector('[data-collection="character"]')); event($('collection-skins').querySelector('[data-skin="scout"] button')); await flush();
  assert.deepEqual(calls.at(-1),['equipSkin','character','scout']);
});

test('host map selector lists all arenas and follows per-room state',async t=>{
  const {ui,$,event,calls}=fixture(t), player=local();
  assert.equal($('map-select').querySelectorAll('option').length,Object.keys(MAPS).length);
  ui.updateRoom(room(player,'yard'),player.id); assert.equal($('map-select').value,'yard'); assert.equal($('map-select').disabled,false); assert.equal($('lobby-map-name').textContent,MAPS.yard.name);
  $('map-select').value='depot'; event($('map-select'),'change'); await flush(); assert.deepEqual(calls.at(-1),['selectMap','depot']);
  ui.updateRoom(room(player,'depot',{host:'someone-else'}),player.id); assert.equal($('map-select').disabled,true);
  const arenaPlayer=local(MAPS.yard); const state=room(arenaPlayer,'yard',{phase:'playing'});
  ui.updateHUD(state,arenaPlayer,{now:1000,dashCooldown:.6}); assert.match($('dash-status').textContent,/0.6s/); assert.match($('location-label').textContent,/BASE T/);
  ui.showBuy(true,arenaPlayer); event(document.querySelector('[data-category="grenade"]')); assert.ok([...$('buy-items').children].every(button=>!button.disabled),'new arena uses its own buy zone');
});

test('social overlays return to pause and names/fullscreen settings are real controls',async t=>{
  const {ui,$,event,calls,entries,window}=fixture(t); assert.equal(ui.settings.showNames,true);
  $('setting-showNames').checked=false; event($('setting-showNames'),'change'); await flush();
  assert.equal(ui.settings.showNames,false); assert.equal(JSON.parse(entries.get('counter-block.settings')).showNames,false);
  ui.showScreen('game'); ui.showPause(true); event($('pause-collection')); assert.equal(ui.modal,'collection');
  const escape=new window.Event('keydown',{bubbles:true,cancelable:true}); Object.defineProperty(escape,'code',{value:'Escape'}); document.dispatchEvent(escape);
  assert.equal(ui.modal,'pause'); event($('fullscreen-button')); await flush(); assert.deepEqual(calls.at(-1),['fullscreen']);
  event($('pause-friends')); assert.equal(ui.modal,'friends'); event($('friends-back')); assert.equal(ui.modal,'pause');
  assert.match($('controls-list').textContent,/ESPAÇO \+ C/); assert.match($('controls-list').textContent,/faca/i);
});
