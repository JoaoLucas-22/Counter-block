/** Original tuning and recoil patterns. Angles are radians, rates are seconds. */
export const WEAPONS = Object.freeze({
  glock: {
    id: 'glock', name: 'Glock-18', slot: 'secondary', team: 'T', price: 200,
    damage: 25, rate: 0.15, automatic: false, burst: true, mag: 20, reserve: 120,
    reload: 2.2, spread: 0.002, moveSpread: 0.022, airSpread: 0.065,
    recoil: [[0.010,0.002],[0.014,-0.002],[0.018,0.004]], speed: 6.2, killReward: 300,
  },
  usp: {
    id: 'usp', name: 'USP-S', slot: 'secondary', team: 'CT', price: 200,
    damage: 35, rate: 0.17, automatic: false, silenced: true, mag: 12, reserve: 36,
    reload: 2.2, spread: 0.0012, moveSpread: 0.022, airSpread: 0.065,
    recoil: [[0.012,0.001],[0.015,-0.002],[0.018,0.002]], speed: 6.2, killReward: 300,
  },
  ak: {
    id: 'ak', name: 'AK-47', slot: 'primary', team: 'T', price: 2700,
    damage: 36, rate: 0.10, automatic: true, mag: 30, reserve: 90,
    reload: 2.5, spread: 0.0014, moveSpread: 0.035, airSpread: 0.095,
    recoil: [[0.013,0.001],[0.018,-0.002],[0.022,0.003],[0.024,0.005],[0.026,0.008],[0.025,-0.008],[0.022,-0.011],[0.018,-0.014],[0.015,0.009],[0.015,0.015]],
    speed: 5.7, killReward: 300,
  },
  m4: {
    id: 'm4', name: 'M4A4', slot: 'primary', team: 'CT', price: 3100,
    damage: 31, rate: 0.09, automatic: true, mag: 30, reserve: 90,
    reload: 2.4, spread: 0.0011, moveSpread: 0.03, airSpread: 0.09,
    recoil: [[0.011,0.001],[0.014,-0.001],[0.017,0.002],[0.019,0.004],[0.020,0.006],[0.018,-0.006],[0.017,-0.009],[0.015,-0.009],[0.013,0.007],[0.013,0.011]],
    speed: 5.8, killReward: 300,
  },
  awp: {
    id: 'awp', name: 'AWP', slot: 'primary', team: 'both', price: 4750,
    damage: 115, rate: 1.35, automatic: false, mag: 5, reserve: 30,
    reload: 3.4, spread: 0.020, scopedSpread: 0.0002, moveSpread: 0.055, airSpread: 0.15,
    recoil: [[0.065,0.005]], speed: 5.1, killReward: 100,
  },
  vector: {
    id:'vector', name:'Vector-9', slot:'primary', team:'both', price:1200,
    damage:19, rate:.065, automatic:true, mag:32, reserve:128,
    reload:1.9, spread:.0025, moveSpread:.018, airSpread:.07,
    recoil:[[.008,.001],[.011,-.002],[.013,.003],[.014,-.004]], speed:6.5, killReward:350,
  },
  scatter: {
    id:'scatter', name:'Scatter-8', slot:'primary', team:'both', price:1600,
    damage:12, pellets:8, rate:.8, automatic:false, mag:8, reserve:32,
    reload:2.7, spread:.05, moveSpread:.012, airSpread:.035,
    recoil:[[.042,.005]], speed:5.9, killReward:450,
  },
  pulse: {
    id:'pulse', name:'Pulse-3', slot:'primary', team:'both', price:2200,
    damage:27, rate:.5, automatic:false, burstCount:3, burstInterval:.075,
    mag:27, reserve:108, reload:2.1, spread:.0014, moveSpread:.026, airSpread:.08,
    recoil:[[.012,.001],[.016,-.002],[.019,.003]], speed:6, killReward:300,
  },
  knife: {
    id:'knife', name:'Faca Block', slot:'melee', team:'both', price:0, melee:true, range:2.2,
    damage:45, rate:.48, automatic:false, mag:0, reserve:0, reload:0,
    spread:0, moveSpread:0, airSpread:0, recoil:[[0,0]], speed:6.8, killReward:500,
  },
});
export const EQUIPMENT = Object.freeze({
  armor: { id:'armor', name:'Colete', price:650, team:'both' },
  helmet: { id:'helmet', name:'Capacete + colete', price:1000, team:'both' },
  kit: { id:'kit', name:'Kit de desarme', price:400, team:'CT' },
  smoke: { id:'smoke', name:'Smoke', price:300, team:'both', duration:15, fuse:1.8 },
  flash: { id:'flash', name:'Flashbang', price:200, team:'both', duration:3.5, fuse:1.6 },
});
