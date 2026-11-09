import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CRATES, SKINS } from '../shared/cosmetics.js';
import { ProfileError, ProfileStore } from '../server/profiles.js';

const memory = () => new ProfileStore({filePath:null});
const nextCase = (store,p) => {
  const grant=store.grantKill(p.id);
  return {grant,result:store.openCrate(p.id,grant.crate)};
};

test('private bearer credentials recover only their own stable device account', () => {
  const store=memory(), a=store.authenticate(), b=store.authenticate();
  assert.match(a.id,/^[A-Z]{8}$/); assert.match(a.token,/^[a-f0-9]{64}$/);
  assert.notEqual(a.id,b.id); assert.notEqual(a.token,b.token);
  assert.equal(store.authenticate(a.token),a);
  assert.notEqual(store.authenticate(a.id).id,a.id,'a public friend code cannot authenticate');
  assert.notEqual(store.authenticate(a.token.slice(0,-1)).id,a.id);
  assert.equal(store.view(a).token,undefined);
  assert.equal(store.publicView(a.id).token,undefined);
  assert.equal(JSON.stringify(store.view(a)).includes(a.token),false);
});

test('one authoritative elimination grants exactly one free case and opening consumes exactly one', () => {
  const store=memory(), p=store.authenticate();
  assert.equal(p.crates.weapon+p.crates.character,0);
  for (let i=0;i<20;i++) {
    const before=p.crates.weapon+p.crates.character;
    const reward=store.grantKill(p.id);
    assert.ok(Object.hasOwn(CRATES,reward.crate));
    assert.equal(p.crates.weapon+p.crates.character,before+1);
  }
  for (const kind of ['weapon','character']) while (p.crates[kind]>0) {
    const before=p.crates[kind], result=store.openCrate(p.id,kind);
    assert.equal(p.crates[kind],before-1); assert.equal(result.crate,kind);
    assert.equal(SKINS[result.skin].kind,kind); assert.ok(p.owned.includes(result.skin));
    assert.deepEqual(store.view(p).lastDrop,result);
  }
  assert.throws(() => store.openCrate(p.id,'weapon'),ProfileError);
  assert.equal(p.crates.weapon+p.crates.character,0);
});

test('cosmetic ownership, type checks and duplicate drops never grant combat stats', () => {
  const store=memory(), p=store.authenticate();
  assert.throws(() => store.equip(p.id,'weapon','prism'),/não possui/);
  const {result}=nextCase(store,p), kind=SKINS[result.skin].kind;
  store.equip(p.id,kind,result.skin);
  assert.equal(store.view(p).equipped[kind],result.skin);
  const other=kind === 'weapon' ? 'character' : 'weapon';
  assert.throws(() => store.equip(p.id,other,result.skin),/categoria/);
  store.equip(p.id,kind,'default'); assert.equal(p.equipped[kind],'default');
  let duplicate=false;
  for (let i=0;i<13;i++) duplicate=nextCase(store,p).result.duplicate || duplicate;
  assert.equal(duplicate,true,'thirteen additional drops among twelve finishes must include a duplicate');
  assert.equal(p.owned.length,new Set(p.owned).size);
  for (const skin of Object.values(SKINS)) {
    assert.equal(skin.damage,undefined); assert.equal(skin.speed,undefined); assert.equal(skin.armor,undefined);
    for (const value of Object.values(skin.colors)) assert.match(value,/^#[a-f0-9]{6}$/i);
  }
});

test('malformed crate and equipment identifiers cannot coerce inventory or change balances', () => {
  const store=memory(), p=store.authenticate(); store.grantKill(p.id);
  const before=JSON.stringify(store.view(p));
  for (const input of [['weapon'],{},null,'constructor','__proto__','unknown',42]) {
    assert.throws(() => store.openCrate(p.id,input),ProfileError);
    assert.throws(() => store.equip(p.id,'weapon',input),ProfileError);
  }
  for (const kind of [['weapon'],{},null,'__proto__']) assert.throws(() => store.equip(p.id,kind,'default'),ProfileError);
  assert.equal(JSON.stringify(store.view(p)),before);
});

test('friend requests require acceptance, become bilateral, and can be removed or declined', () => {
  const store=memory(), a=store.authenticate(), b=store.authenticate();
  store.setNickname(a.id,'  Alfa  '); store.setNickname(b.id,'Bravo');
  store.requestFriend(a.id,b.id.toLowerCase());
  assert.deepEqual(store.view(b).requests,[{id:a.id,nickname:'Alfa'}]);
  assert.deepEqual(store.view(a).friends,[]);
  assert.throws(() => store.requestFriend(a.id,b.id),/já enviou/);
  assert.throws(() => store.acceptFriend(a.id,b.id),/não encontrada/);
  store.acceptFriend(b.id,a.id);
  assert.deepEqual(store.view(a).friends,[{id:b.id,nickname:'Bravo'}]);
  assert.deepEqual(store.view(b).friends,[{id:a.id,nickname:'Alfa'}]);
  assert.deepEqual(store.view(b).requests,[]);
  assert.throws(() => store.requestFriend(a.id,b.id),/já está/);
  store.removeFriend(a.id,b.id);
  assert.deepEqual(store.view(a).friends,[]); assert.deepEqual(store.view(b).friends,[]);
  store.requestFriend(a.id,b.id); store.removeFriend(b.id,a.id);
  assert.deepEqual(store.view(b).requests,[],'removing a pending sender declines the request');
});

test('invalid public codes, self requests and overfull friend lists are rejected', () => {
  const store=memory(), p=store.authenticate();
  assert.throws(() => store.requestFriend(p.id,p.id),/próprio/);
  for (const invalid of [null,[],{},'ABC12345','ZZZZZZZ',42]) assert.throws(() => store.requestFriend(p.id,invalid),ProfileError);
  for (let i=0;i<50;i++) { const friend=store.authenticate(); store.requestFriend(friend.id,p.id); store.acceptFriend(p.id,friend.id); }
  const extra=store.authenticate();
  assert.throws(() => store.requestFriend(p.id,extra.id),/cheia/);
  assert.throws(() => store.requestFriend(extra.id,p.id),/cheia/);
  assert.equal(store.view(p).friends.length,50);
});

test('views cannot mutate private state and nickname storage uses safe bounded strings', () => {
  const store=memory(), p=store.authenticate();
  store.setNickname(p.id,'<Alice>'); assert.equal(store.view(p).nickname,'Alice');
  for (const value of ['a','',{},null,'x'.repeat(21)]) assert.throws(() => store.setNickname(p.id,value),ProfileError);
  const view=store.view(p); view.owned.push('prism'); view.crates.weapon=100; view.equipped.weapon='prism';
  assert.deepEqual(p.owned,['default']); assert.equal(p.crates.weapon,0); assert.equal(p.equipped.weapon,'default');
});

test('profiles, friend acceptance, crates and equipped ownership survive server-store restart', t => {
  const directory=mkdtempSync(path.join(tmpdir(),'counter-block-profiles-'));
  t.after(() => rmSync(directory,{recursive:true,force:true}));
  const filePath=path.join(directory,'nested','profiles.json');
  const first=new ProfileStore({filePath}), a=first.authenticate(), b=first.authenticate();
  first.setNickname(a.id,'Persistente'); first.requestFriend(a.id,b.id); first.acceptFriend(b.id,a.id);
  const {result}=nextCase(first,a); first.equip(a.id,SKINS[result.skin].kind,result.skin);
  first.grantKill(a.id);
  const expected=first.view(a);
  const second=new ProfileStore({filePath});
  assert.deepEqual(second.view(second.authenticate(a.token)),expected);
  assert.deepEqual(second.view(b.id).friends,[{id:a.id,nickname:'Persistente'}]);
  assert.equal(JSON.parse(readFileSync(filePath,'utf8')).profiles.length,2);
  if (process.platform !== 'win32') assert.equal(statSync(filePath).mode & 0o777,0o600);
});

test('a corrupted on-disk profile store is preserved and fails explicitly', t => {
  const directory=mkdtempSync(path.join(tmpdir(),'counter-block-profile-bad-'));
  t.after(() => rmSync(directory,{recursive:true,force:true}));
  const filePath=path.join(directory,'profiles.json');
  writeFileSync(filePath,'{broken');
  assert.throws(() => new ProfileStore({filePath}),/Não foi possível ler/);
  assert.equal(readFileSync(filePath,'utf8'),'{broken');
});

test('crate catalog exposes exactly the server weighted drop probabilities', () => {
  for (const [kind,crate] of Object.entries(CRATES)) {
    assert.equal(crate.drops.reduce((sum,drop) => sum+drop.weight,0),100);
    assert.equal(crate.drops.length,6);
    assert.ok(crate.drops.every(drop => SKINS[drop.skin].kind === kind && Number.isSafeInteger(drop.weight) && drop.weight>0));
  }
});
