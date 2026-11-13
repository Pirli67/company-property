// All gameplay tunables live here. Distances are metres, speeds m/s.

export const CFG = {
  routeLength: 4500, // distance from the office to the lunch kiosk

  road: {
    lanes: 4,
    laneWidth: 3.5,
    edge: 7.6, // drivable half-width on a normal stretch
    bayEdge: 13.4, // drivable right edge inside a charging bay
    bayTaper: 24, // length of the entry / exit taper
    bayLength: 56, // flat part of a charging bay
  },

  player: {
    maxSpeed: 36, // ~130 km/h
    boostSpeed: 46, // ~165 km/h
    limpSpeed: 9, // empty battery
    accel: 12,
    brake: 20,
    reverse: 6,
    lateral: 11, // max sideways speed
    halfW: 0.95,
    halfL: 2.35,
  },

  battery: {
    start: 0.5, // the apprentices never plug it in
    range: 2100, // metres on a full battery at normal speed
    boostDrain: 2.6, // multiplier while boosting
    chargePerSec: 0.36,
    regenPerSec: 0.012,
    lowWarning: 0.18,
  },

  chaser: {
    startGap: 110,
    startDelay: 1.8, // seconds he needs to get into the truck
    speedStart: 26,
    speedEnd: 31.5,
    speedPerWeek: 0.5,
    accel: 7,
    lateral: 7,
    maxGap: 320, // beyond this he keeps pace (rubber band)
    catchGap: 5.3,
    catchWidth: 1.9,
    halfW: 1.0,
    halfL: 2.8,
  },

  chargers: {
    first: 650,
    spacing: 850,
    jitter: 60,
  },

  spawn: {
    slot: 30, // obstacle rows are generated per slot
    ahead: 330,
    behind: 130,
    clearStart: 150,
  },
};

export const laneX = (i) => (i - (CFG.road.lanes - 1) / 2) * CFG.road.laneWidth;

// Small deterministic RNG so a seed always produces the same road.
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hash2 = (a, b) => (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) | 0;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const smooth = (t) => t * t * (3 - 2 * t);
