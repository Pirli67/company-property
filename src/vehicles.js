// Arcade vehicle logic for the apprentices' car and the pickup chasing it.
// No physics engine: speed along the road plus a damped sideways velocity is
// all a lane-dodging game needs, and it stays stable at any frame rate.

import { CFG, laneX, clamp, lerp, damp } from './config.js';

export class Player {
  constructor(group) {
    this.group = group;
    this.reset();
  }

  reset() {
    this.x = laneX(1);
    this.d = 0;
    this.speed = 0;
    this.vx = 0;
    this.battery = CFG.battery.start;
    this.stun = 0;
    this.charging = false;
    this.boosting = false;
    this.onRail = false;
    this.roll = 0;
    this.pitch = 0;
    this.sync(0);
  }

  update(dt, input, world) {
    const P = CFG.player;
    const B = CFG.battery;
    const empty = this.battery <= 0;
    this.stun = Math.max(0, this.stun - dt);

    const throttle = this.stun > 0 ? 0 : input.throttle;
    this.boosting = !!input.boost && throttle > 0 && !empty && this.speed > 4;
    const vmax = empty ? P.limpSpeed : this.boosting ? P.boostSpeed : P.maxSpeed;

    const before = this.speed;
    if (input.brake) {
      if (this.speed > 0.3) {
        this.speed = Math.max(0, this.speed - P.brake * dt);
        this.battery = Math.min(1, this.battery + B.regenPerSec * dt * (this.speed / P.maxSpeed)); // regen
      } else {
        this.speed = Math.max(-P.reverse, this.speed - 7 * dt);
      }
    } else if (throttle) {
      if (this.speed < vmax) {
        const fade = 1 - 0.55 * clamp(this.speed / vmax, 0, 1);
        this.speed = Math.min(vmax, this.speed + P.accel * fade * (this.boosting ? 1.5 : 1) * dt);
      } else {
        this.speed = Math.max(vmax, this.speed - 7 * dt);
      }
    } else {
      // Coasting: rolling resistance + drag.
      const drag = 1.2 + 0.0035 * this.speed * this.speed;
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), drag * dt);
    }
    if (this.speed > vmax + 0.01 && empty) this.speed = Math.max(vmax, this.speed - 10 * dt);

    // Steering: sideways speed grows with road speed, so a parked car can't strafe.
    const lat = Math.min(P.lateral, Math.abs(this.speed) * 0.42);
    this.vx = damp(this.vx, input.steer * lat, 9, dt);
    this.x += this.vx * dt;
    const step = this.speed * dt;
    this.d = Math.max(-20, this.d + step);

    // Guard rails.
    const minX = -CFG.road.edge + P.halfW;
    const maxX = Math.min(world.edgeRight(this.d - P.halfL), world.edgeRight(this.d + P.halfL)) - P.halfW;
    this.onRail = false;
    if (this.x < minX || this.x > maxX) {
      const side = this.x < minX ? -1 : 1;
      this.x = clamp(this.x, minX, maxX);
      // Only a car that is actually steering into the rail scrapes along it. A
      // bay taper closing in on a car that is already merging just nudges it.
      if (this.vx * side > 0.5) {
        this.onRail = Math.abs(this.speed) > 6;
        this.vx *= -0.2;
        this.speed -= this.speed * 0.9 * dt;
      }
    }

    // Battery.
    if (step > 0) this.battery = Math.max(0, this.battery - (step / B.range) * (this.boosting ? B.boostDrain : 1));
    const bay = world.bayAt(this.d, this.x);
    this.charging = !!bay && Math.abs(this.speed) < 1.2;
    if (this.charging) this.battery = Math.min(1, this.battery + B.chargePerSec * dt);
    this.inBay = !!bay;

    this.sync(dt, (this.speed - before) / Math.max(dt, 1e-4));
  }

  sync(dt, accel = 0) {
    const g = this.group;
    const yaw = Math.atan2(this.vx, Math.max(Math.abs(this.speed), 7));
    this.roll = damp(this.roll, -this.vx * 0.012, 8, dt);
    this.pitch = damp(this.pitch, clamp(-accel * 0.0035, -0.05, 0.06), 6, dt);
    g.position.set(this.x, 0, -this.d);
    g.rotation.set(this.pitch, -yaw, this.roll);
  }
}

export class Chaser {
  constructor(group) {
    this.group = group;
    this.reset(1);
  }

  reset(week) {
    this.week = week;
    this.x = laneX(1);
    this.d = -CFG.chaser.startGap;
    this.speed = 0;
    this.delay = CFG.chaser.startDelay;
    this.gap = CFG.chaser.startGap;
    this.caught = false;
    this.vx = 0;
    this.sync(0);
  }

  update(dt, player, world) {
    const K = CFG.chaser;
    const progress = clamp(player.d / CFG.routeLength, 0, 1);
    let target = lerp(K.speedStart, K.speedEnd, progress) + (this.week - 1) * K.speedPerWeek;
    // Rubber band: once the car is far ahead he keeps pace instead of vanishing.
    if (this.gap > K.maxGap) target = Math.max(target, player.speed + 1.5);
    if (this.delay > 0) {
      this.delay -= dt;
      target = 0;
    }
    this.speed += clamp(target - this.speed, -10 * dt, K.accel * dt);
    this.speed = Math.max(0, this.speed);
    this.d += this.speed * dt;

    const lat = Math.min(K.lateral, this.speed * 0.3);
    const want = clamp(player.x - this.x, -lat, lat);
    this.vx = damp(this.vx, want, 6, dt);
    this.x += this.vx * dt;
    const maxX = world.edgeRight(this.d) - K.halfW;
    this.x = clamp(this.x, -CFG.road.edge + K.halfW, maxX);

    this.gap = player.d - this.d;
    if (this.gap <= K.catchGap) {
      if (Math.abs(this.x - player.x) < K.catchWidth) {
        this.caught = true;
      } else {
        // Alongside but not touching: he holds station and squeezes over.
        this.d = player.d - K.catchGap;
        this.speed = Math.min(this.speed, Math.max(player.speed, 4));
      }
      this.gap = player.d - this.d;
    }
    this.sync(dt);
  }

  sync(dt) {
    const g = this.group;
    const yaw = Math.atan2(this.vx, Math.max(this.speed, 7));
    g.position.set(this.x, Math.sin(this.d * 0.9) * 0.02, -this.d);
    g.rotation.set(0, -yaw, -this.vx * 0.02);
  }
}
