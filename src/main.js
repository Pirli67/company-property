import * as THREE from 'three';
import { CFG, laneX, clamp, damp } from './config.js';
import { Assets } from './assets.js';
import { World } from './world.js';
import { Player, Chaser } from './vehicles.js';
import { GameAudio } from './audio.js';
import { VoiceDirector } from './voice.js';
import { Hud } from './hud.js';
import { Input } from './input.js';

const params = new URLSearchParams(location.search);
const AUTOPILOT = params.has('autopilot');
const BASE = import.meta.env.BASE_URL;

// --- Renderer and scene -------------------------------------------------------

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe9f7, 140, 430);
scene.background = skyTexture();

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 900);
camera.position.set(6, 3, 8);

scene.add(new THREE.HemisphereLight(0xdff1ff, 0x6f8f5a, 1.15));
const sun = new THREE.DirectionalLight(0xfff2d9, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 60, bottom: -45, near: 1, far: 190 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#4fa3e8');
  grad.addColorStop(0.55, '#a9d8f6');
  grad.addColorStop(0.72, '#cfe9f7');
  grad.addColorStop(1, '#cfe9f7');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// --- Game objects -------------------------------------------------------------

const hud = new Hud();
const input = new Input();
const audio = new GameAudio();
const voice = new VoiceDirector(audio, hud);
const assets = new Assets(renderer);

const game = {
  state: 'loading', // loading | menu | playing | paused | caught | won
  time: 0,
  stateTime: 0,
  week: loadWeek(),
  shake: 0,
  stats: null,
};

function loadWeek() {
  try {
    return Number(localStorage.getItem('ccc.week')) || 1;
  } catch {
    return 1; // private windows and sandboxed frames can refuse storage
  }
}

let world, player, chaser, man, playerGroup, chaserGroup;

async function boot() {
  await assets.load((p) => (document.getElementById('loadFill').style.width = `${p * 100}%`));

  world = new World(scene, assets);
  playerGroup = assets.group('player_car');
  chaserGroup = assets.group('pickup');
  man = assets.group('chaser');
  scene.add(playerGroup, chaserGroup, man);
  player = new Player(playerGroup);
  chaser = new Chaser(chaserGroup);

  world.onEvent = (kind, strength) => {
    audio.hit(kind, strength);
    if (kind === 'barrier' || kind === 'traffic') {
      game.shake = Math.min(1, 0.35 + strength / 50);
      game.stats.crashes++;
    } else if (kind === 'cone') {
      game.shake = Math.max(game.shake, 0.12);
      game.stats.cones++;
    } else if (kind === 'smash') {
      game.shake = Math.max(game.shake, 0.1);
    }
  };

  if (assets.manifest.portrait) hud.setPortrait(`${BASE}assets/${assets.manifest.portrait}`);
  // Debug handle. fastForward() steps the simulation without rendering, which
  // is how the balance was tuned (with ?autopilot driving).
  window.__ccc = {
    game,
    player,
    chaser,
    world,
    assets,
    renderer,
    CFG,
    fastForward(seconds, dt = 1 / 60) {
      for (let t = 0; t < seconds && game.state === 'playing'; t += dt) updatePlaying(dt);
      return game.state;
    },
  };
  console.info(
    '[assets]',
    Object.entries(assets.source)
      .map(([n, s]) => `${n}: ${s} (${Math.round(assets.triangles(n))} tris)`)
      .join(', '),
  );

  toMenu();
  renderer.setAnimationLoop(frame);
}

function prepareRun() {
  const seed = params.has('seed') ? Number(params.get('seed')) : (Math.random() * 2 ** 31) | 0;
  world.reset(seed, game.week);
  player.reset();
  chaser.reset(game.week);
  voice.reset();
  hud.setBays(world.bays);
  hud.clearSubtitle();
  hud.toast('');
  game.time = 0;
  game.shake = 0;
  game.stats = { crashes: 0, cones: 0, charges: 0, minGap: CFG.chaser.startGap, top: 0, wasCharging: false };
  chaser.d = -15; // parked behind the car until the chase starts
  chaser.sync(0);
  man.visible = true;
  man.position.set(laneX(1) - 2.4, 0, 9.5);
  man.rotation.set(0, 0, 0);
}

function setState(s) {
  game.state = s;
  game.stateTime = 0;
}

function toMenu() {
  prepareRun();
  document.getElementById('weekLabel').textContent = `Week ${game.week}`;
  hud.setVisible(false);
  hud.show('menu');
  setState('menu');
}

function startRun() {
  audio.init(assets.manifest.voice);
  if (game.state !== 'menu') prepareRun();
  chaser.reset(game.week);
  man.visible = false; // he is in the truck now
  hud.show(null);
  hud.setVisible(true);
  hud.el.hud.classList.remove('ended');
  setState('playing');
}

function endRun(won) {
  const s = game.stats;
  const seconds = Math.round(game.time);
  audio.stopVoice();
  if (won) {
    game.week++;
    try {
      localStorage.setItem('ccc.week', game.week);
    } catch {
      /* storage blocked: the week counter just lasts for this visit */
    }
    audio.jingle(true);
    setState('won');
  } else {
    audio.hit('caught', 30);
    game.shake = 1;
    setState('caught');
    world.clearTrafficNear(player.d, 40);
    // He gets out and has a word at the driver's window.
    const side = (game.side = player.x < -3.5 ? 1 : -1);
    man.visible = true;
    man.position.set(player.x + side * 1.9, 0, -player.d - 0.2);
    man.rotation.set(0, side * (Math.PI / 2), 0);
  }
  voice.say(won ? 'won' : 'caught', true);
  hud.toast('');
  hud.el.hud.classList.add('ended');
  setTimeout(
    () => {
      if (game.state !== 'won' && game.state !== 'caught') return;
      hud.end({
        won,
        title: won ? 'You made it to lunch!' : 'Caught.',
        text: won
          ? `Five kebabs, zero consequences. He will be waiting next Monday (week ${game.week}), and he will be faster.`
          : `He has the keys. The apprentices walk. ${Math.round(player.d)} m of ${CFG.routeLength} m driven.`,
        stats: [
          ['TIME', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`],
          ['CLOSEST', `${Math.max(0, Math.round(s.minGap))} m`],
          ['TOP SPEED', `${Math.round(s.top * 3.6)} km/h`],
          ['CHARGE STOPS', s.charges],
          ['CRASHES', s.crashes],
          ['CONES', s.cones],
        ],
      });
    },
    won ? 2600 : 2200,
  );
}

// --- Autopilot (add ?autopilot to the URL): demo mode and balance testing -----

const pilot = { lane: 1, stop: null };

function autopilot() {
  const out = { steer: 0, throttle: 1, brake: 0, boost: false, lookBack: false };
  const { d, x, speed, battery } = player;
  let targetX;

  const bay = world.nextBay(d - 30);
  const wantsCharge = bay && battery < 0.62 && bay.center - d < 300 && bay.center - d > -6;
  const T = CFG.road.bayTaper;
  // Only commit to the right-hand lane on the final approach; dodge normally before that.
  if ((wantsCharge && d > bay.d0 - T - 80) || (pilot.stop && pilot.stop === bay)) {
    pilot.stop = bay;
    targetX = d > bay.d0 - T * 0.6 ? CFG.road.bayEdge - 3 : laneX(3);
    const stopAt = bay.center + 10;
    const brakeDist = (speed * speed) / (2 * CFG.player.brake) + 4;
    if (d + brakeDist >= stopAt) {
      out.throttle = 0;
      out.brake = speed > 0.3 ? 1 : 0;
      const full = battery > 0.97 || (chaser.gap < 105 && battery > 0.55) || chaser.gap < 70;
      if (speed < 0.5 && (full || !player.inBay)) pilot.stop = undefined;
    }
    if (d > bay.d1 + 10) pilot.stop = undefined;
  } else {
    pilot.stop = undefined;
    // Pick the lane with the most free road ahead.
    const freeIn = (lx, merging) => {
      let free = 150;
      for (const o of world.statics) {
        const dd = o.d - d;
        if (dd > -3 && dd < free && Math.abs(o.x - lx) < o.hx + 1.3) free = o.kind === 'cone' ? Math.max(dd, 70) : dd;
      }
      for (const t of world.traffic) {
        const dd = t.d - d;
        if (Math.abs(t.x - lx) > 2.3) continue;
        if (dd > 4.5) free = Math.min(free, (dd * Math.max(speed, 8)) / Math.max(speed - t.speed, 1));
        else if (merging && dd > -6) free = 0; // someone is alongside
      }
      return free;
    };
    const here = Math.round(x / CFG.road.laneWidth + (CFG.road.lanes - 1) / 2);
    let best = -1e9;
    for (let l = 0; l < CFG.road.lanes; l++) {
      let score = freeIn(laneX(l), l !== here) - Math.abs(laneX(l) - x) * 4 - (l === pilot.lane ? 0 : 8);
      // Crossing a lane that is blocked right here is not an option.
      for (let k = Math.min(l, here); k <= Math.max(l, here); k++) if (k !== here && freeIn(laneX(k), true) < 16) score -= 200;
      if (score > best) {
        best = score;
        pilot.pick = l;
      }
    }
    pilot.lane = pilot.pick;
    targetX = laneX(pilot.lane);
    // Nowhere better to go: hold back instead of ramming whatever is ahead.
    const ahead = freeIn(x, false);
    if (ahead < speed * 0.9) out.throttle = 0;
    if (ahead < speed * 0.45 && speed > 8) out.brake = 1;
    out.boost = battery > 0.5 && chaser.gap < 70;
  }
  out.steer = clamp((targetX - x) / 1.2, -1, 1);
  return out;
}

// --- Frame --------------------------------------------------------------------

const timer = new THREE.Timer();
timer.connect(document);
const look = new THREE.Vector3();
const perf = { t: 0, frames: 0, level: 0 };

function frame(now) {
  timer.update(now);
  const rawDt = timer.getDelta();
  const dt = Math.min(rawDt, 0.05);
  game.stateTime += dt;

  if (game.state === 'playing') updatePlaying(dt);
  else if (game.state === 'won') {
    player.update(dt, { steer: 0, throttle: 0, brake: 1, boost: false }, world);
    if (player.speed < 0) player.speed = 0;
    chaser.speed = Math.max(0, chaser.speed - 14 * dt);
    chaser.d += chaser.speed * dt;
    chaser.sync(dt);
    world.update(dt, player, null);
  } else if (game.state === 'caught') {
    world.update(dt, player, null);
    man.rotation.z = Math.sin(game.stateTime * 16) * 0.04; // furious finger wagging
  }

  updateCamera(dt);
  updateAudio();
  renderer.render(scene, camera);
  renderRearCamera();
  watchPerformance(rawDt);
}

// Picture-in-picture rear camera, switched on while he is close enough to matter.
const rearCam = new THREE.PerspectiveCamera(46, 3, 0.5, 420);
const mirrorEl = document.getElementById('mirror');
let mirrorOn = false;

function renderRearCamera() {
  const want = game.state === 'playing' && chaser.gap < 95 && !game.input?.lookBack;
  if (want !== mirrorOn) {
    mirrorOn = want;
    mirrorEl.classList.toggle('hidden', !want);
  }
  if (!want) return;
  mirrorEl.classList.toggle('danger', chaser.gap < 20);
  const r = mirrorEl.getBoundingClientRect();
  if (r.width < 4) return;
  const y = window.innerHeight - r.bottom;
  rearCam.position.set(player.x, 1.9, -player.d + 2.7);
  rearCam.lookAt(player.x * 0.5 + chaser.x * 0.5, 1.1, -player.d + 40);
  renderer.setScissorTest(true);
  renderer.setScissor(r.left, y, r.width, r.height);
  renderer.setViewport(r.left, y, r.width, r.height);
  renderer.shadowMap.autoUpdate = false; // reuse this frame's shadow map
  renderer.render(scene, rearCam);
  renderer.shadowMap.autoUpdate = true;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
}

function updatePlaying(dt) {
  game.time += dt;
  const inp = AUTOPILOT ? autopilot() : input.state;
  game.input = inp;

  player.update(dt, inp, world);
  world.collidePlayer(player);
  chaser.update(dt, player, world);
  world.update(dt, player, chaser);
  voice.update(dt, { gap: chaser.gap, charging: player.charging, time: game.time });

  const s = game.stats;
  s.minGap = Math.min(s.minGap, chaser.gap);
  s.top = Math.max(s.top, player.speed);
  if (player.charging && !s.wasCharging) s.charges++;
  s.wasCharging = player.charging;

  hud.update({
    battery: player.battery,
    charging: player.charging,
    boosting: player.boosting,
    speed: player.speed,
    gap: chaser.gap,
    d: player.d,
    chaserD: chaser.d,
  });
  updateToast();

  if (chaser.caught) endRun(false);
  else if (player.d >= CFG.routeLength) endRun(true);
}

function updateToast() {
  const bay = world.nextBay(player.d - 20);
  const toBay = bay ? bay.d0 - player.d : Infinity;
  if (player.charging) {
    hud.toast(player.battery >= 1 ? 'FULL — GO GO GO!' : `⚡ CHARGING ${Math.round(player.battery * 100)}% · he is ${Math.round(chaser.gap)} m away`, 'good');
  } else if (player.inBay && Math.abs(player.speed) > 1.2) {
    hud.toast('STOP TO CHARGE', 'good');
  } else if (player.battery <= 0) {
    hud.toast('BATTERY EMPTY — LIMP MODE', 'bad');
  } else if (toBay < 320 && toBay > -10) {
    hud.toast(`⚡ CHARGER IN ${Math.max(0, Math.round(toBay / 10) * 10)} m — KEEP RIGHT`);
  } else if (player.battery < CFG.battery.lowWarning) {
    hud.toast(bay ? `LOW BATTERY — next charger ${Math.round(toBay)} m` : 'LOW BATTERY', 'bad');
  } else if (CFG.routeLength - player.d < 400) {
    hud.toast(`🥙 LUNCH IN ${Math.max(0, Math.round((CFG.routeLength - player.d) / 10) * 10)} m`);
  } else {
    hud.toast('');
  }
}

function updateCamera(dt) {
  const px = player.x;
  const pz = -player.d;
  game.shake = Math.max(0, game.shake - dt * 2.2);
  let fov = 62;

  if (game.state === 'menu') {
    // Title shot: the car up front, the man and his pickup looming behind it.
    const a = game.stateTime * 0.3;
    camera.position.set(px + 5.2 + Math.sin(a) * 1.4, 2.3 + Math.sin(a * 0.7) * 0.3, pz - 8.5);
    look.set(px - 0.6, 1.2, pz + 8);
  } else if (game.state === 'caught') {
    // Slow push-in from the front quarter: car, man and pickup all in frame.
    const side = game.side || -1;
    const t = Math.min(game.stateTime, 8);
    const tx = px + side * (7.5 - t * 0.2);
    const tz = pz - 7.5 + t * 0.2;
    camera.position.set(tx, 2.3, tz); // hard cut, then drift
    look.set(px + side * 0.6, 1.25, pz + 2.5);
  } else if (game.input?.lookBack && game.state === 'playing') {
    camera.position.set(px, 3.3, pz - 8.5);
    look.set(px, 1.4, pz + 30);
  } else {
    // Chase camera. It pulls back when the pickup is close so you can see it coming.
    const closeness = clamp(1 - chaser.gap / 34, 0, 1);
    const back = 9.2 + player.speed * 0.05 + closeness * 5;
    const height = 4 + closeness * 2;
    camera.position.x = damp(camera.position.x, px * 0.82, 6, dt);
    camera.position.y = damp(camera.position.y, height, 4, dt);
    camera.position.z = pz + back;
    look.set(camera.position.x * 0.35 + px * 0.65, 1.3, pz - 14);
    fov = 60 + Math.max(0, player.speed) * 0.34 + (player.boosting ? 5 : 0);
  }

  if (game.shake > 0) {
    const s = game.shake * game.shake * 0.5;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
  }
  camera.lookAt(look);
  const newFov = damp(camera.fov, fov, 4, dt);
  if (Math.abs(newFov - camera.fov) > 0.01) {
    camera.fov = newFov;
    camera.updateProjectionMatrix();
  }

  // The shadow frustum follows the car, snapped to avoid shimmering.
  const sz = Math.round(pz / 4) * 4;
  sun.target.position.set(0, 0, sz - 10);
  sun.position.set(38, 60, sz + 22);
}

function updateAudio() {
  const playing = game.state === 'playing';
  audio.update({
    active: playing || game.state === 'won',
    speed: player.speed,
    throttle: playing && game.input?.throttle,
    boosting: player.boosting,
    onRail: player.onRail,
    charging: player.charging,
    battery: player.battery,
    lowWarning: CFG.battery.lowWarning,
    gap: chaser.gap,
    chaserSpeed: chaser.speed,
    chaserDx: chaser.x - player.x,
  });
}

// Drop quality in steps if the machine cannot hold ~50 FPS.
function watchPerformance(dt) {
  if (game.state !== 'playing' || document.hidden) return;
  perf.t += dt;
  perf.frames++;
  if (perf.t < 2.5) return;
  const fps = perf.frames / perf.t;
  perf.t = perf.frames = 0;
  game.fps = fps;
  if (fps > 48 || perf.level >= 3) return;
  perf.level++;
  if (perf.level === 1 && pixelRatio > 1.25) renderer.setPixelRatio((pixelRatio = 1.25));
  else if (perf.level <= 2) {
    perf.level = 2;
    renderer.shadowMap.enabled = false;
    sun.castShadow = false;
    scene.traverse((o) => o.material && (o.material.needsUpdate = true));
  } else renderer.setPixelRatio((pixelRatio = 1));
  console.info(`[perf] ${fps.toFixed(0)} FPS, quality level ${perf.level}`);
}

// --- Wiring -------------------------------------------------------------------

function togglePause() {
  if (game.state === 'playing') {
    setState('paused');
    hud.show('pause');
    audio.ctx?.suspend();
  } else if (game.state === 'paused') {
    hud.show(null);
    audio.ctx?.resume();
    setState('playing');
  }
}

document.getElementById('startBtn').addEventListener('click', startRun);
document.getElementById('againBtn').addEventListener('click', () => {
  audio.stopVoice();
  toMenu();
  startRun();
});
document.getElementById('resumeBtn').addEventListener('click', togglePause);
input.on('KeyP', togglePause);
input.on('Escape', togglePause);
input.on('KeyM', () => audio.setMuted(!audio.muted));
input.on('Enter', () => {
  if (game.state === 'menu') startRun();
  else if (!document.getElementById('end').classList.contains('hidden')) document.getElementById('againBtn').click();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'playing') togglePause();
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

boot().catch((err) => {
  console.error(err);
  document.querySelector('#loading h1').textContent = 'Could not start: ' + err.message;
});
