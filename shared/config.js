/** All gameplay times are seconds. Server may receive overrides in tests only. */
export const CONFIG = Object.freeze({
  roundTime: 115,
  bombTime: 40,
  plantTime: 3.5,
  defuseTime: 7,
  kitDefuseTime: 3.5,
  buyTime: 15,
  roundEndTime: 5,
  initialMoney: 800,
  maxMoney: 16000,
  maxRounds: 12,
  swapAfter: 6,
  tickRate: 60,
  snapshotRate: 20,
  maxRewind: 0.2,
  reconnectTime: 20,
  maxPlayers: 10,
  teamSize: 5,
  friendlyFire: false,
  hitMultipliers: { head: 4, torso: 1, arms: 0.85, legs: 0.75 },
});
export const DT = 1 / CONFIG.tickRate;
