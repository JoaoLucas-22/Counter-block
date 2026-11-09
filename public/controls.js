/** Browser-safe bindings. C is the dependable crouch key; Ctrl is optional. */
export function movementInput(keys, active = true) {
  const crouch = active && (keys.has('KeyC') || keys.has('ControlLeft') || keys.has('ControlRight'));
  const jump = active && keys.has('Space');
  return {
    forward: active ? Number(keys.has('KeyW')) - Number(keys.has('KeyS')) : 0,
    strafe: active ? Number(keys.has('KeyD')) - Number(keys.has('KeyA')) : 0,
    jump, crouch, dash: jump && crouch,
    walk: active && (keys.has('ShiftLeft') || keys.has('ShiftRight')),
    interact: active && keys.has('KeyE'),
  };
}

export function blockGameShortcut(event, locked, editing = false) {
  if (!locked || editing) return false;
  if ((event.ctrlKey || event.metaKey) && ['KeyW','KeyS','KeyD','KeyR'].includes(event.code)) {
    event.preventDefault();
    return true;
  }
  return false;
}

/** Keyboard Lock requires support, a secure context and fullscreen in many browsers. */
export async function captureGameKeyboard() {
  if (!document.fullscreenElement || !navigator.keyboard?.lock) return false;
  try {
    await navigator.keyboard.lock(['KeyW','KeyA','KeyS','KeyD','KeyC','ControlLeft','ControlRight','Space','Tab']);
    return true;
  } catch { return false; }
}
