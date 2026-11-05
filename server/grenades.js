import { randomUUID } from 'node:crypto';
import { EQUIPMENT } from '../shared/weapons.js';
import { direction, eyeHeight, traceWorld } from '../shared/physics.js';
import { MAP } from '../shared/map-data.js';

// Grenade positions and detonation times are simulated only on the server.
const RADIUS = 0.12;
const GRAVITY = 15;
const SMOKE_RADIUS = 4.6;
const MAX_GRENADES = 40;

const values = collection => collection instanceof Map ? [...collection.values()]
  : Array.isArray(collection) ? collection : Object.values(collection || {});

function overlaps(g, wall) {
  return g.x + RADIUS > wall.x - wall.w / 2 && g.x - RADIUS < wall.x + wall.w / 2
    && g.y + RADIUS > wall.y - wall.h / 2 && g.y - RADIUS < wall.y + wall.h / 2
    && g.z + RADIUS > wall.z - wall.d / 2 && g.z - RADIUS < wall.z + wall.d / 2;
}

/** Inventory checks and decrement belong to the calling authoritative action. */
export function throwGrenade(room, player, item, now, emit = () => {}) {
  if (item !== 'smoke' && item !== 'flash') return null;
  room.grenades ||= [];
  if (room.grenades.length >= MAX_GRENADES) return null;
  const aim = direction(player.yaw, player.pitch);
  const g = {
    id: randomUUID(), type: item, owner: player.id,
    x: player.x, y: player.y + eyeHeight(player), z: player.z,
    vx: aim.x * 11 + (player.vx || 0) * 0.5,
    vy: aim.y * 11 + 2.2 + (player.vy || 0) * 0.2,
    vz: aim.z * 11 + (player.vz || 0) * 0.5,
    active: false, radius: item === 'smoke' ? SMOKE_RADIUS : 0,
    detonateAt: now + EQUIPMENT[item].fuse * 1000, expiresAt: 0,
  };
  room.grenades.push(g);
  emit({ type: 'grenade', action: 'throw', id: g.id, item, owner: player.id, x: g.x, y: g.y, z: g.z });
  return g;
}

function moveGrenade(g, dt) {
  // Substeps keep fast projectiles from crossing narrow walls between ticks.
  const steps = Math.max(1, Math.ceil(Math.hypot(g.vx, g.vy, g.vz) * dt / 0.1));
  const delta = dt / steps;
  for (let step = 0; step < steps; step++) {
    g.vy -= GRAVITY * delta;
    for (const [axis, velocity] of [['x', 'vx'], ['y', 'vy'], ['z', 'vz']]) {
      const previous = g[axis];
      g[axis] += g[velocity] * delta;
      if (MAP.solids.some(wall => overlaps(g, wall))) {
        g[axis] = previous;
        g[velocity] *= -0.48;
        if (axis === 'y') { g.vx *= 0.82; g.vz *= 0.82; }
      }
    }
    if (g.y < RADIUS) {
      g.y = RADIUS;
      g.vy = Math.abs(g.vy) > 0.5 ? Math.abs(g.vy) * 0.4 : 0;
      g.vx *= 0.9;
      g.vz *= 0.9;
    }
    // Shared ramp metadata is optional; use its physical slope when present.
    for (const ramp of MAP.ramps || []) {
      if (g.x < ramp.x - ramp.w / 2 || g.x > ramp.x + ramp.w / 2
        || g.z < ramp.z - ramp.d / 2 || g.z > ramp.z + ramp.d / 2) continue;
      const axis = ramp.direction === 'x' ? 'x' : 'z';
      const size = axis === 'x' ? ramp.w : ramp.d;
      let fraction = (g[axis] - ramp[axis] + size / 2) / size;
      if (ramp.sign < 0) fraction = 1 - fraction;
      let height = (ramp.y || 0) + fraction * (ramp.height || 0);
      if (typeof ramp.heightAt === 'function') height = ramp.heightAt(g.x, g.z);
      if (Number.isFinite(height) && g.y < height + RADIUS) {
        g.y = height + RADIUS;
        g.vy = Math.abs(g.vy) * 0.35;
        g.vx *= 0.9; g.vz *= 0.9;
      }
    }
  }
}

function flashPlayers(room, g, emit) {
  for (const player of values(room.players)) {
    if (!player.alive || !player.connected) continue;
    const eye = { x: player.x, y: player.y + eyeHeight(player), z: player.z };
    const offset = { x: g.x - eye.x, y: g.y - eye.y, z: g.z - eye.z };
    const distance = Math.hypot(offset.x, offset.y, offset.z);
    if (distance > 24) continue;
    const ray = distance > 0.001
      ? { x: offset.x / distance, y: offset.y / distance, z: offset.z / distance }
      : { x: 0, y: 0, z: -1 };
    const obstacle = traceWorld(eye, ray, distance);
    if (typeof obstacle === 'number' && obstacle < distance - 0.16) continue;
    const aim = direction(player.yaw, player.pitch);
    const dot = aim.x * ray.x + aim.y * ray.y + aim.z * ray.z;
    // Looking away reduces duration and intensity without removing the effect.
    const facing = 0.18 + 0.82 * Math.max(0, dot);
    const attenuation = Math.max(0, 1 - distance / 24);
    const intensity = Math.min(1, facing * attenuation);
    if (intensity < 0.035) continue;
    emit({ type: 'flash', target: player.id, owner: g.owner,
      intensity, duration: 0.35 + intensity * (EQUIPMENT.flash.duration - 0.35), x: g.x, y: g.y, z: g.z });
  }
}

export function tickGrenades(room, dt, now, emit = () => {}) {
  if (!room.grenades?.length) return;
  for (const g of room.grenades) {
    if (g.active) continue;
    moveGrenade(g, dt);
    if (now < g.detonateAt) continue;
    g.active = true;
    g.vx = g.vy = g.vz = 0;
    if (g.type === 'smoke') {
      g.expiresAt = now + EQUIPMENT.smoke.duration * 1000;
      emit({ type: 'grenade', action: 'smoke', id: g.id, item: g.type,
        owner: g.owner, x: g.x, y: g.y, z: g.z, radius: g.radius, expiresAt: g.expiresAt });
    } else {
      g.expiresAt = now;
      flashPlayers(room, g, emit);
      emit({ type: 'grenade', action: 'explode', id: g.id, item: g.type,
        owner: g.owner, x: g.x, y: g.y, z: g.z });
    }
  }
  room.grenades = room.grenades.filter(g => !g.active || g.expiresAt > now);
}

export function serializeGrenades(room) {
  return (room.grenades || []).map(g => ({
    id: g.id, type: g.type, owner: g.owner, x: g.x, y: g.y, z: g.z,
    active: g.active, radius: g.radius, detonateAt: g.detonateAt, expiresAt: g.expiresAt,
  }));
}
