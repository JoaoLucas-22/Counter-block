import test from 'node:test';
import assert from 'node:assert/strict';
import { movementInput, blockGameShortcut, captureGameKeyboard } from '../public/controls.js';

test('C and optional Ctrl crouch without sacrificing forward movement; dash follows the actual chord', () => {
  for (const crouch of ['KeyC','ControlLeft','ControlRight']) {
    const keys=new Set(['KeyW',crouch]);
    assert.equal(movementInput(keys).forward,1);
    assert.equal(movementInput(keys).crouch,true);
    assert.equal(movementInput(keys).dash,false);
    keys.add('Space');
    assert.equal(movementInput(keys).jump,true);
    assert.equal(movementInput(keys).dash,true);
    keys.delete(crouch);
    assert.equal(movementInput(keys).crouch,false);
    assert.equal(movementInput(keys).dash,false);
    assert.deepEqual(movementInput(keys,false),{forward:0,strafe:0,jump:false,crouch:false,dash:false,walk:false,interact:false});
  }
});

test('reserved browser chords are cancelled only while playing, with input editing preserved', () => {
  for (const code of ['KeyW','KeyS','KeyD','KeyR']) {
    for (const modifier of ['ctrlKey','metaKey']) {
      const event=new Event('keydown',{cancelable:true});
      Object.assign(event,{code,[modifier]:true});
      assert.equal(blockGameShortcut(event,true,false),true);
      assert.equal(event.defaultPrevented,true);
    }
  }
  for (const [locked,editing] of [[false,false],[true,true],[false,true]]) {
    const event=new Event('keydown',{cancelable:true}); Object.assign(event,{code:'KeyW',ctrlKey:true});
    assert.equal(blockGameShortcut(event,locked,editing),false);
    assert.equal(event.defaultPrevented,false);
  }
});

test('keyboard capture is optional and handles denied or missing browser support', async t => {
  const originals=new Map(['document','navigator'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  t.after(() => {for(const [key,value] of originals) {if(value) Object.defineProperty(globalThis,key,value); else delete globalThis[key];}});
  Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:{fullscreenElement:null}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,writable:true,value:{}});
  assert.equal(await captureGameKeyboard(),false);
  document.fullscreenElement={};
  assert.equal(await captureGameKeyboard(),false);
  const locked=[];
  navigator.keyboard={lock:async keys => {locked.push(keys);}};
  assert.equal(await captureGameKeyboard(),true);
  assert.ok(locked[0].includes('KeyW')); assert.ok(locked[0].includes('KeyC'));
  navigator.keyboard.lock=async () => {throw new Error('Denied by browser');};
  assert.equal(await captureGameKeyboard(),false);
});
