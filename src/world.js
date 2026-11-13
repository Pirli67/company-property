// The road and everything on it: scenery, charging bays, obstacles, traffic
// and the debris that flies when something gets hit. Repeated objects are
// drawn with InstancedMesh pools; a pool slot is recycled when its object
// falls behind the player.
//
// Game space: the car drives along -Z. `d` is always "distance from the
// office" in metres, so world z = -d.

import * as THREE from 'three';
import { CFG, laneX, mulberry32, hash2, clamp, lerp, smooth } from './config.js';
import { InstancePool } from './assets.js';
import { roadTexture, grassTexture, asphaltTexture, windowTexture, boltTexture, checkerTexture } from './procedural.js';

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const E = new THREE.Euler();
const C = new THREE.Color();

function mat(x, y, z, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
  Q.setFromEuler(E.set(rx, ry, rz));
  return M.compose(P.set(x, y, z), Q, S.set(sx, sy, sz));
}

const SCENERY_SLOT = 20;
const TRAFFIC_TINTS = [0xffffff, 0xf2c94c, 0xeb5757, 0x6fcf97, 0x56ccf2, 0xbdbdbd, 0xf2994a, 0x9b8cff];
const BUILDING_TINTS = [0xe8dfd0, 0xd7c9b8, 0xc9d3dc, 0xe6c9a8, 0xbfc7c0, 0xd9b6a3];

export class World {
  constructor(scene, assets) {
    this.scene = scene;
    this.assets = assets;
    this.onEvent = () => {};

    const tintTraffic = assets.source.traffic_car === 'procedural';
    this.pools = {
      cone: new InstancePool(scene, assets.parts.cone, 280),
      barrier: new InstancePool(scene, assets.parts.barrier, 70),
      traffic: new InstancePool(scene, assets.parts.traffic_car, 30, { tint: tintTraffic }),
      charger: new InstancePool(scene, assets.parts.charger, 20),
      tree: new InstancePool(scene, assets.parts.tree, 260),
      lamp: new InstancePool(scene, assets.parts.lamp, 40, { castShadow: false }),
      rail: new InstancePool(scene, assets.parts.rail, 140, { castShadow: false }),
      building: new InstancePool(
        scene,
        [
          {
            geometry: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
            material: new THREE.MeshStandardMaterial({ map: windowTexture(), roughness: 0.9 }),
          },
        ],
        90,
        { tint: true, castShadow: false },
      ),
    };
    this.tintTraffic = tintTraffic;

    // Ground and road are single planes that follow the car, snapped to their
    // texture tile so the motion is invisible.
    const grass = grassTexture();
    grass.repeat.set(175, 175);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.03;
    this.ground.receiveShadow = true;
    scene.add(this.ground);

    const road = roadTexture();
    road.repeat.set(1, 60);
    this.road = new THREE.Mesh(new THREE.PlaneGeometry(16, 720), new THREE.MeshStandardMaterial({ map: road, roughness: 0.92 }));
    this.road.rotation.x = -Math.PI / 2;
    this.road.receiveShadow = true;
    scene.add(this.road);

    this.asphalt = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.95 });
    this.padMaterial = new THREE.MeshBasicMaterial({ color: 0x3df07a, transparent: true, opacity: 0.55 });
    this.boltMaterial = new THREE.MeshBasicMaterial({ map: boltTexture() });
    this.poleMaterial = new THREE.MeshStandardMaterial({ color: 0x5b6067, roughness: 0.6 });
    this.fixed = new THREE.Group(); // bays, finish arch, kiosk: rebuilt per run
    scene.add(this.fixed);

    this.statics = [];
    this.traffic = [];
    this.debris = [];
    this.sceneSlots = new Map();
    this.bays = [];
  }

  reset(seed, week) {
    this.seed = seed;
    this.week = week;
    for (const p of Object.values(this.pools)) p.releaseAll();
    this.statics.length = 0;
    this.traffic.length = 0;
    this.debris.length = 0;
    this.sceneSlots.clear();
    this.nextSlot = 0;

    const rnd = mulberry32(seed);
    const { first, spacing, jitter } = CFG.chargers;
    const L = CFG.road.bayLength;
    this.bays = [];
    for (let d = first; d < CFG.routeLength - 300; d += spacing) {
      const c = d + (rnd() * 2 - 1) * jitter;
      this.bays.push({ d0: c - L / 2, d1: c + L / 2, center: c, chargers: true });
    }
    this.bays.push({ d0: CFG.routeLength - 4, d1: CFG.routeLength + 64, center: CFG.routeLength + 30, chargers: false });

    this.buildFixed();
    this.update(0, { d: 0, x: 0, speed: 0 });
  }

  // --- Road shape -----------------------------------------------------------

  edgeRight(d) {
    const { edge, bayEdge, bayTaper: T } = CFG.road;
    for (const b of this.bays) {
      if (d < b.d0 - T || d > b.d1 + T) continue;
      if (d < b.d0) return lerp(edge, bayEdge, smooth((d - (b.d0 - T)) / T));
      if (d > b.d1) return lerp(bayEdge, edge, smooth((d - b.d1) / T));
      return bayEdge;
    }
    return edge;
  }

  // The charging bay the point is parked in, if any.
  bayAt(d, x) {
    for (const b of this.bays) {
      if (b.chargers && d >= b.d0 - 6 && d <= b.d1 + 6 && x > CFG.road.edge + 0.7) return b;
    }
    return null;
  }

  nextBay(d) {
    return this.bays.find((b) => b.chargers && b.d1 > d) || null;
  }

  buildFixed() {
    const g = this.fixed;
    for (const child of [...g.children]) {
      g.remove(child);
      child.geometry?.dispose();
    }
    const { edge, bayEdge, bayTaper: T } = CFG.road;

    for (const b of this.bays) {
      // Asphalt apron following the taper.
      const pos = [];
      const uv = [];
      const idx = [];
      let n = 0;
      for (let d = b.d0 - T; d <= b.d1 + T + 0.01; d += 4) {
        const x1 = this.edgeRight(d) + 0.5;
        pos.push(edge - 0.6, 0.012, -d, x1, 0.012, -d);
        uv.push(0, d / 5, (x1 - edge) / 5, d / 5);
        if (n > 0) idx.push(n - 2, n - 1, n, n, n - 1, n + 1);
        n += 2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const apron = new THREE.Mesh(geo, this.asphalt);
      apron.receiveShadow = true;
      g.add(apron);

      if (b.chargers) {
        for (const off of [-16, 0, 16]) {
          const id = this.pools.charger.alloc();
          this.pools.charger.set(id, mat(bayEdge - 0.5, 0, -(b.center + off), Math.PI / 2, 1.15));
          const pad = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 5.6), this.padMaterial);
          pad.rotation.x = -Math.PI / 2;
          pad.position.set(bayEdge - 3, 0.03, -(b.center + off));
          g.add(pad);
        }
        // Tall sign so the bay can be spotted from far away.
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 9, 8), this.poleMaterial);
        pole.position.set(bayEdge + 1.6, 4.5, -(b.d0 - 8));
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), this.boltMaterial);
        sign.position.set(bayEdge + 1.6, 9.6, -(b.d0 - 8) + 0.15);
        g.add(pole, sign);
      }
    }

    // Finish: checkered arch and the lunch kiosk.
    const zf = -CFG.routeLength;
    for (const x of [-8.4, bayEdge + 0.6]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 7.4, 8), this.poleMaterial);
      post.position.set(x, 3.7, zf);
      g.add(post);
    }
    const checker = checkerTexture();
    checker.wrapS = THREE.RepeatWrapping;
    checker.repeat.set(2, 1);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(bayEdge + 9, 1.3, 0.2), new THREE.MeshBasicMaterial({ map: checker }));
    banner.position.set((bayEdge + 0.6 - 8.4) / 2, 6.9, zf);
    g.add(banner);

    const kiosk = this.assets.group('kiosk');
    kiosk.scale.setScalar(1.5);
    kiosk.rotation.y = Math.PI / 2;
    kiosk.position.set(bayEdge + 3.2, 0, zf - 34);
    g.add(kiosk);
  }

  // --- Per-frame ------------------------------------------------------------

  update(dt, player, chaser) {
    const d = player.d;
    this.ground.position.set(0, -0.03, -Math.round(d / 8) * 8);
    this.road.position.set(0, 0, -(Math.round(d / 12) * 12 + 204));

    // Scenery slots.
    const s0 = Math.floor((d - 140) / SCENERY_SLOT);
    const s1 = Math.floor((d + 440) / SCENERY_SLOT);
    for (const [slot, items] of this.sceneSlots) {
      if (slot < s0 || slot > s1) {
        for (const [pool, id] of items) pool.release(id);
        this.sceneSlots.delete(slot);
      }
    }
    for (let s = s0; s <= s1; s++) if (!this.sceneSlots.has(s)) this.sceneSlots.set(s, this.spawnScenery(s));

    // Obstacle rows.
    while (this.nextSlot * CFG.spawn.slot < d + CFG.spawn.ahead) this.spawnObstacles(this.nextSlot++);
    for (let i = this.statics.length - 1; i >= 0; i--) {
      const o = this.statics[i];
      if (o.d < d - CFG.spawn.behind) {
        o.pool.release(o.id);
        this.statics.splice(i, 1);
      }
    }

    if (dt > 0) {
      this.updateTraffic(dt, player);
      this.updateDebris(dt);
      if (chaser) this.collideChaser(chaser, player);
    }
    for (const p of Object.values(this.pools)) p.flush();
  }

  spawnScenery(slot) {
    const items = [];
    const rnd = mulberry32(hash2(this.seed + 77, slot));
    const d0 = slot * SCENERY_SLOT;
    const put = (pool, m, tint) => {
      const id = pool.alloc();
      if (id < 0) return;
      pool.set(id, m);
      if (tint !== undefined) pool.setColor(id, C.set(tint));
      items.push([pool, id]);
    };

    // Guard rails, following the bay outline on the right.
    for (let k = 0; k < 2; k++) {
      const da = d0 + k * 10;
      put(this.pools.rail, mat(-(CFG.road.edge + 0.35), 0, -(da + 5), Math.PI));
      const xa = this.edgeRight(da) + 0.35;
      const xb = this.edgeRight(da + 10) + 0.35;
      const len = Math.hypot(xb - xa, 10);
      put(this.pools.rail, mat((xa + xb) / 2, 0, -(da + 5), -Math.atan2(xb - xa, 10), 1, 1, len / 10));
    }

    if (slot % 2 === 0) put(this.pools.lamp, mat(-(CFG.road.edge + 1.1), 0, -d0));

    const right = this.edgeRight(d0 + 10);
    for (const side of [-1, 1]) {
      const edge = side < 0 ? CFG.road.edge : right;
      const n = Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const x = side * (edge + 5 + rnd() * 26);
        put(this.pools.tree, mat(x, 0, -(d0 + rnd() * SCENERY_SLOT), rnd() * 6.28, 0.8 + rnd() * 0.7));
      }
      if (rnd() < 0.3) {
        const w = 12 + rnd() * 16;
        const h = 8 + rnd() * rnd() * 34;
        const x = side * (48 + rnd() * 40 + w / 2);
        const tint = BUILDING_TINTS[Math.floor(rnd() * BUILDING_TINTS.length)];
        put(this.pools.building, mat(x, 0, -(d0 + 10), 0, w, h, 12 + rnd() * 10), tint);
      }
    }
    return items;
  }

  addStatic(kind, x, d, sx = 1) {
    const pool = this.pools[kind];
    const id = pool.alloc();
    if (id < 0) return;
    const o = { kind, x, d, pool, id, sx, ry: kind === 'cone' ? Math.random() * 6.28 : 0 };
    o.hx = kind === 'cone' ? 0.22 : sx;
    o.hz = kind === 'cone' ? 0.22 : 0.3;
    pool.set(id, mat(x, 0, -d, o.ry, kind === 'cone' ? 1.25 : sx, kind === 'cone' ? 1.25 : 1.1, kind === 'cone' ? 1.25 : 1));
    this.statics.push(o);
  }

  addTraffic(lane, d, speed, rnd) {
    const id = this.pools.traffic.alloc();
    if (id < 0) return;
    if (this.tintTraffic) this.pools.traffic.setColor(id, C.set(TRAFFIC_TINTS[Math.floor(rnd() * TRAFFIC_TINTS.length)]));
    this.traffic.push({ id, x: laneX(lane), targetX: laneX(lane), d, speed, base: speed, yaw: 0 });
  }

  spawnObstacles(slot) {
    const { slot: SL, clearStart } = CFG.spawn;
    const d0 = slot * SL;
    if (d0 < clearStart || d0 > CFG.routeLength - 90) return;
    const rnd = mulberry32(hash2(this.seed, slot));
    const p = d0 / CFG.routeLength;
    const density = Math.min(0.9, 0.5 + 0.3 * p + this.week * 0.03);
    if (rnd() > density) return;

    const lanes = CFG.road.lanes;
    const lane = Math.floor(rnd() * lanes);
    const kind = rnd();

    if (kind < 0.34) {
      // Slower traffic.
      const n = rnd() < 0.3 + p * 0.35 ? 2 : 1;
      this.addTraffic(lane, d0 + rnd() * 10, 13 + rnd() * 6, rnd);
      if (n === 2) this.addTraffic((lane + 1 + Math.floor(rnd() * (lanes - 1))) % lanes, d0 + 12 + rnd() * 10, 13 + rnd() * 6, rnd);
    } else if (kind < 0.58) {
      // Loose cones.
      const n = 3 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        this.addStatic('cone', laneX(Math.floor(rnd() * lanes)) + (rnd() - 0.5) * 2.4, d0 + rnd() * (SL - 6));
      }
    } else if (kind < 0.82) {
      // One lane closed: cones funnel into a barrier.
      const dir = lane === 0 ? 1 : lane === lanes - 1 ? -1 : rnd() < 0.5 ? 1 : -1;
      for (let i = 0; i < 4; i++) this.addStatic('cone', laneX(lane) - dir * (1.5 - i * 0.95), d0 + i * 4.2);
      this.addStatic('barrier', laneX(lane), d0 + 19, 1.6);
    } else {
      // Roadworks: two neighbouring lanes closed.
      const a = Math.min(lane, lanes - 2);
      for (const l of [a, a + 1]) {
        this.addStatic('cone', laneX(l) - 0.9, d0 + 5);
        this.addStatic('cone', laneX(l) + 0.9, d0 + 5);
        this.addStatic('barrier', laneX(l), d0 + 16, 1.6);
      }
    }
  }

  // --- Traffic ----------------------------------------------------------------

  laneBlocked(x, d, self) {
    for (const o of this.statics) {
      if (o.kind !== 'barrier') continue;
      const dd = o.d - d;
      if (dd > -4 && dd < 45 && Math.abs(o.x - x) < o.hx + 1.0) return true;
    }
    for (const u of this.traffic) {
      if (u !== self && Math.abs(u.d - d) < 9 && Math.abs(u.x - x) < 2) return true;
    }
    return false;
  }

  updateTraffic(dt, player) {
    const { halfW, halfL } = CFG.player;
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const t = this.traffic[i];
      let lead = t.base;

      let blocked = false;
      for (const o of this.statics) {
        if (o.kind !== 'barrier') continue;
        const dd = o.d - t.d;
        if (dd > 0 && dd < 40 && Math.abs(o.x - t.targetX) < o.hx + 1.0) blocked = true;
      }
      for (const u of this.traffic) {
        const dd = u.d - t.d;
        if (u !== t && dd > 0 && dd < 14 && Math.abs(u.x - t.x) < 2) lead = Math.min(lead, u.speed);
      }
      // A slow or parked player car ahead is just another vehicle to them.
      const dp = player.d - t.d;
      if (dp > 0 && dp < 28 && Math.abs(player.x - t.x) < halfW + 1.1 && player.speed < t.speed) {
        lead = Math.min(lead, Math.max(0, player.speed) * (dp < halfL + 6 ? 0 : 1));
      }

      if (blocked) {
        let found = false;
        const cur = Math.round(t.targetX / CFG.road.laneWidth + (CFG.road.lanes - 1) / 2);
        for (const step of [1, -1, 2, -2, 3, -3]) {
          const l = cur + step;
          if (l < 0 || l >= CFG.road.lanes) continue;
          if (!this.laneBlocked(laneX(l), t.d, t)) {
            t.targetX = laneX(l);
            found = true;
            break;
          }
        }
        if (!found) lead = Math.min(lead, 6); // boxed in: crawl up to the roadworks
      }

      // Brake hard for hazards, but only ease off after being shunted.
      t.speed += clamp(lead - t.speed, (lead < t.base ? -14 : -3) * dt, 4 * dt);
      const dx = clamp(t.targetX - t.x, -3.2 * dt, 3.2 * dt);
      t.x += dx;
      t.d += t.speed * dt;
      t.yaw = lerp(t.yaw, Math.atan2(dx / Math.max(dt, 1e-4), Math.max(t.speed, 6)), 0.2);

      // Traffic drives over cones, and a boxed-in driver nudges a barrier aside
      // rather than blocking the road for good.
      for (let j = this.statics.length - 1; j >= 0; j--) {
        const o = this.statics[j];
        if (Math.abs(o.d - t.d) < 2.1 && Math.abs(o.x - t.x) < 0.8 + o.hx) this.knock(j, t.speed, Math.sign(o.x - t.x) || 1);
      }

      if (t.d < player.d - CFG.spawn.behind || t.d > player.d + CFG.spawn.ahead + 200) {
        this.pools.traffic.release(t.id);
        this.traffic.splice(i, 1);
        continue;
      }
      this.pools.traffic.set(t.id, mat(t.x, 0, -t.d, -t.yaw));
    }
  }

  // Clears traffic around a point, so nothing parks in front of the end-of-run camera.
  clearTrafficNear(d, radius) {
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      if (Math.abs(this.traffic[i].d - d) > radius) continue;
      this.pools.traffic.release(this.traffic[i].id);
      this.traffic.splice(i, 1);
    }
  }

  // --- Debris -----------------------------------------------------------------

  // Turn a static obstacle into a flying one.
  knock(index, speed, side) {
    const o = this.statics[index];
    this.statics.splice(index, 1);
    const heavy = o.kind === 'barrier';
    this.debris.push({
      pool: o.pool,
      id: o.id,
      x: o.x,
      y: 0.1,
      z: -o.d,
      vx: side * (2 + Math.random() * 4) * (heavy ? 0.6 : 1),
      vy: (heavy ? 3 : 5) + Math.random() * 3,
      vz: -speed * (heavy ? 0.55 : 0.8),
      rx: 0,
      ry: o.ry,
      rz: 0,
      wx: (Math.random() - 0.5) * 14,
      wy: (Math.random() - 0.5) * 8,
      wz: (Math.random() - 0.5) * 14,
      sx: heavy ? o.sx : 1.25,
      sy: heavy ? 1.1 : 1.25,
      life: 2.6,
    });
  }

  knockTraffic(index, speed, side) {
    const t = this.traffic[index];
    this.traffic.splice(index, 1);
    this.debris.push({
      pool: this.pools.traffic,
      id: t.id,
      x: t.x,
      y: 0.2,
      z: -t.d,
      vx: side * (7 + Math.random() * 4),
      vy: 5 + Math.random() * 2,
      vz: -speed * 0.8,
      rx: 0,
      ry: 0,
      rz: 0,
      wx: 1.5,
      wy: side * 5,
      wz: -side * 4,
      sx: 1,
      sy: 1,
      life: 3,
    });
  }

  updateDebris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const b = this.debris[i];
      b.life -= dt;
      if (b.life <= 0) {
        b.pool.release(b.id);
        this.debris.splice(i, 1);
        continue;
      }
      b.vy -= 22 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.y < 0.15 && b.vy < 0) {
        b.y = 0.15;
        b.vy *= -0.4;
        b.vx *= 0.7;
        b.vz *= 0.7;
        b.wx *= 0.6;
        b.wz *= 0.6;
      }
      b.rx += b.wx * dt;
      b.ry += b.wy * dt;
      b.rz += b.wz * dt;
      const fade = Math.min(1, b.life * 3);
      b.pool.set(b.id, mat(b.x, b.y, b.z, b.ry, b.sx * fade, b.sy * fade, fade, b.rx, b.rz));
    }
  }

  // --- Collisions -------------------------------------------------------------

  collidePlayer(player) {
    const { halfW, halfL } = CFG.player;

    for (let i = this.statics.length - 1; i >= 0; i--) {
      const o = this.statics[i];
      if (Math.abs(o.d - player.d) > halfL + o.hz || Math.abs(o.x - player.x) > halfW + o.hx) continue;
      const impact = Math.abs(player.speed);
      const side = Math.sign(o.x - player.x) || 1;
      if (o.kind === 'cone') {
        player.speed *= 0.9;
        this.knock(i, impact, side);
        if (impact > 3) this.onEvent('cone', impact);
      } else {
        player.speed *= 0.35;
        player.stun = 0.45;
        this.knock(i, impact, side);
        this.onEvent('barrier', impact);
      }
    }

    const tw = 0.88;
    const tl = 1.95;
    for (const t of this.traffic) {
      const dx = t.x - player.x;
      const dd = t.d - player.d;
      const ox = halfW + tw - Math.abs(dx);
      const oz = halfL + tl - Math.abs(dd);
      if (ox <= 0 || oz <= 0) continue;
      if (ox < oz * 0.5 || ox < 0.6) {
        // Side swipe or a glancing corner hit: push the two apart.
        const push = ox * (Math.sign(dx) || 1);
        t.x += push * 0.5;
        player.x -= push * 0.5;
        player.vx = -Math.sign(dx) * 3;
        player.speed *= 0.96;
        this.onEvent('scrape', Math.abs(player.speed));
      } else if (dd > 0) {
        // Rear-ending someone.
        const rel = player.speed - t.speed;
        player.d = t.d - (halfL + tl);
        if (rel > 0) {
          // Shunt: the car in front is shoved ahead, so nobody ends up stuck.
          const v = Math.max(t.speed, player.speed * 0.55);
          player.speed = Math.max(0, v - 1.5);
          t.speed = v + 3;
          if (rel > 5) {
            player.stun = 0.3;
            this.onEvent('traffic', rel);
          }
        }
      } else {
        t.d = player.d - (halfL + tl);
        t.speed = Math.min(t.speed, Math.max(0, player.speed));
      }
    }
  }

  // The pickup does not dodge anything. It goes through.
  collideChaser(chaser, player) {
    if (player.d - chaser.d > 160) return;
    const { halfW, halfL } = CFG.chaser;
    for (let i = this.statics.length - 1; i >= 0; i--) {
      const o = this.statics[i];
      if (Math.abs(o.d - chaser.d) > halfL + o.hz || Math.abs(o.x - chaser.x) > halfW + o.hx) continue;
      const heavy = o.kind === 'barrier';
      chaser.speed -= heavy ? 1.2 : 0.2;
      this.knock(i, chaser.speed, Math.sign(o.x - chaser.x) || 1);
      this.onEvent('smash', heavy ? 1 : 0.3);
    }
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const t = this.traffic[i];
      if (Math.abs(t.d - chaser.d) > halfL + 1.95 || Math.abs(t.x - chaser.x) > halfW + 0.88) continue;
      chaser.speed -= 3.5;
      this.knockTraffic(i, chaser.speed, Math.sign(t.x - chaser.x) || (Math.random() < 0.5 ? -1 : 1));
      this.onEvent('smash', 1.4);
    }
  }
}
