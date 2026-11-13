// Procedural stand-in models. Every asset in the game has a builder here, so
// the game is fully playable before (and without) the generated GLB assets.
// Conventions shared with the GLB pipeline: metres, Y up, origin at the
// bottom centre, vehicles and characters face -Z.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const col = new THREE.Color();

export const MAT = {
  solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05, flatShading: true }),
  glass: new THREE.MeshStandardMaterial({
    color: 0x2a3d50,
    roughness: 0.12,
    metalness: 0.4,
    transparent: true,
    opacity: 0.62,
  }),
};

function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  col.set(color);
  for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

function place(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

// Box centred on (x, y, z). `top` = [scaleX, scaleZ, shiftZ] squeezes the top face.
function box(w, h, d, x, y, z, color, { top, rx = 0, ry = 0, rz = 0 } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (top) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0) {
        p.setX(i, p.getX(i) * top[0]);
        p.setZ(i, p.getZ(i) * top[1] + (top[2] || 0));
      }
    }
  }
  return place(paint(g, color), x, y, z, rx, ry, rz);
}

function cyl(rTop, rBot, h, x, y, z, color, { seg = 12, rx = 0, rz = 0 } = {}) {
  return place(paint(new THREE.CylinderGeometry(rTop, rBot, h, seg), color), x, y, z, rx, 0, rz);
}

function ball(r, x, y, z, color, detail = 1) {
  return place(paint(new THREE.IcosahedronGeometry(r, detail), color), x, y, z);
}

function wheels(list, r, w, hx, zFront, zRear) {
  for (const sx of [-1, 1]) {
    for (const z of [zFront, zRear]) {
      list.push(cyl(r, r, w, sx * hx, r, z, 0x14161a, { seg: 14, rz: Math.PI / 2 }));
      list.push(cyl(r * 0.55, r * 0.55, w + 0.02, sx * hx, r, z, 0x9aa0a8, { seg: 8, rz: Math.PI / 2 }));
    }
  }
}

function person(list, x, y, z, { hair = 0x3a2a1c, shirt = 0x2f6fd0, skin = 0xe8b796, glasses = false } = {}) {
  list.push(box(0.4, 0.34, 0.24, x, y - 0.3, z, shirt));
  list.push(ball(0.15, x, y, z, skin));
  list.push(box(0.27, 0.1, 0.27, x, y + 0.11, z + 0.02, hair));
  if (glasses) list.push(box(0.26, 0.05, 0.03, x, y + 0.01, z - 0.14, 0x111111));
}

const merge = (list) => mergeGeometries(list, false);
const part = (list, material = MAT.solid) => ({ geometry: merge(list), material });

// --- Vehicles ---------------------------------------------------------------

function playerCar() {
  const s = [];
  const blue = 0x1f4fd8;
  s.push(box(1.94, 0.2, 4.72, 0, 0.3, 0, 0x191b20)); // sill
  s.push(box(1.92, 0.56, 4.7, 0, 0.68, 0, blue, { top: [0.96, 0.97] }));
  s.push(box(1.8, 0.16, 1.25, 0, 1.0, -1.62, blue, { top: [0.92, 0.8, 0.1], rx: -0.08 })); // sloped bonnet
  s.push(box(1.78, 0.14, 0.9, 0, 1.0, 1.85, blue, { top: [0.94, 0.7, -0.12] })); // tailgate shoulder
  s.push(box(1.4, 0.05, 1.86, 0, 1.6, 0.42, 0x101216)); // panoramic roof
  s.push(box(0.5, 0.07, 0.06, -0.62, 0.84, -2.34, 0xf6fbff)); // headlights
  s.push(box(0.5, 0.07, 0.06, 0.62, 0.84, -2.34, 0xf6fbff));
  s.push(box(1.72, 0.07, 0.06, 0, 0.92, 2.34, 0xe02222)); // light bar
  wheels(s, 0.37, 0.26, 0.86, -1.48, 1.5);
  // The five apprentices.
  person(s, -0.42, 1.28, -0.3, { hair: 0x2b1d12, shirt: 0xe2573d });
  person(s, 0.42, 1.28, -0.3, { hair: 0xd9b25a, shirt: 0x38a169 });
  person(s, -0.52, 1.26, 0.72, { hair: 0x151515, shirt: 0xf2c230 });
  person(s, 0, 1.26, 0.72, { hair: 0x8a3b1b, shirt: 0x8e5bd6 });
  person(s, 0.52, 1.26, 0.72, { hair: 0x4a3524, shirt: 0xf08a24 });

  const glass = [box(1.78, 0.62, 2.95, 0, 1.27, 0.28, 0xffffff, { top: [0.8, 0.62, 0.14] })];
  return [part(s), part(glass, MAT.glass)];
}

function pickup() {
  const s = [];
  const white = 0xf1eee4;
  const chrome = 0xc5c9cf;
  s.push(box(1.9, 0.24, 5.4, 0, 0.52, 0, 0x22252a)); // frame
  s.push(box(1.98, 0.56, 1.55, 0, 0.98, -2.0, white)); // bonnet
  s.push(box(1.98, 0.56, 1.7, 0, 0.98, -0.4, white)); // cab lower
  s.push(box(1.74, 0.07, 1.32, 0, 1.94, -0.4, white)); // roof
  s.push(box(1.98, 0.12, 2.3, 0, 0.78, 1.62, 0x3a3d42)); // bed floor
  s.push(box(0.09, 0.5, 2.3, -0.945, 1.02, 1.62, white));
  s.push(box(0.09, 0.5, 2.3, 0.945, 1.02, 1.62, white));
  s.push(box(1.98, 0.5, 0.09, 0, 1.02, 2.74, white)); // tailgate
  s.push(box(1.98, 0.56, 0.09, 0, 0.98, 0.5, white));
  s.push(box(2.06, 0.2, 0.2, 0, 0.6, -2.84, chrome)); // bumpers
  s.push(box(2.06, 0.2, 0.2, 0, 0.6, 2.86, chrome));
  s.push(box(1.2, 0.3, 0.06, 0, 1.0, -2.79, 0x4a4f56)); // grille
  s.push(box(0.3, 0.24, 0.06, -0.8, 1.02, -2.79, 0xfff1b8));
  s.push(box(0.3, 0.24, 0.06, 0.8, 1.02, -2.79, 0xfff1b8));
  s.push(box(0.22, 0.2, 0.06, -0.86, 1.0, 2.8, 0xc81e1e));
  s.push(box(0.22, 0.2, 0.06, 0.86, 1.0, 2.8, 0xc81e1e));
  for (const [x, z] of [[-1.0, -1.7], [1.0, 1.3], [-1.0, 1.25]]) s.push(box(0.03, 0.14, 0.5, x, 0.82, z, 0x9c5a2e)); // rust
  wheels(s, 0.43, 0.3, 0.9, -1.85, 1.75);
  // The man himself, at the wheel.
  person(s, -0.45, 1.6, -0.35, { hair: 0xa9a9a9, shirt: 0xffffff, glasses: true });

  const glass = [box(1.92, 0.64, 1.62, 0, 1.58, -0.4, 0xffffff, { top: [0.9, 0.8] })];
  return [part(s), part(glass, MAT.glass)];
}

function trafficCar() {
  const s = [];
  const body = 0xffffff; // tinted per instance
  s.push(box(1.76, 0.18, 3.9, 0, 0.3, 0, 0x1c1e22));
  s.push(box(1.74, 0.55, 3.88, 0, 0.66, 0, body, { top: [0.96, 0.97] }));
  s.push(box(1.62, 0.56, 2.3, 0, 1.2, 0.3, 0x1b2430, { top: [0.84, 0.72, 0.05] }));
  s.push(box(1.36, 0.05, 1.66, 0, 1.5, 0.35, body));
  s.push(box(0.34, 0.14, 0.06, -0.58, 0.8, -1.94, 0xfff6cf));
  s.push(box(0.34, 0.14, 0.06, 0.58, 0.8, -1.94, 0xfff6cf));
  s.push(box(0.3, 0.14, 0.06, -0.6, 0.82, 1.94, 0xd21f1f));
  s.push(box(0.3, 0.14, 0.06, 0.6, 0.82, 1.94, 0xd21f1f));
  wheels(s, 0.32, 0.22, 0.8, -1.25, 1.25);
  return [part(s)];
}

// --- Character --------------------------------------------------------------

function chaser() {
  const s = [];
  const skin = 0xe8b796;
  const shirt = 0xfafafa;
  const trousers = 0x34373d;
  s.push(box(0.17, 0.08, 0.3, -0.12, 0.04, -0.03, 0x111111)); // shoes
  s.push(box(0.17, 0.08, 0.3, 0.12, 0.04, -0.03, 0x111111));
  s.push(box(0.17, 0.8, 0.19, -0.12, 0.48, 0, trousers));
  s.push(box(0.17, 0.8, 0.19, 0.12, 0.48, 0, trousers));
  s.push(box(0.46, 0.62, 0.25, 0, 1.19, 0, shirt, { top: [1.06, 1] }));
  s.push(box(0.2, 0.05, 0.02, 0, 1.44, -0.13, skin)); // open collar
  s.push(box(0.12, 0.56, 0.13, 0.31, 1.2, 0, shirt, { rz: 0.12 })); // resting arm
  s.push(box(0.11, 0.1, 0.11, 0.35, 0.89, 0, skin));
  s.push(box(0.12, 0.56, 0.13, -0.31, 1.42, -0.24, shirt, { rx: 1.25 })); // pointing arm
  s.push(box(0.1, 0.1, 0.16, -0.31, 1.5, -0.56, skin));
  s.push(box(0.11, 0.09, 0.1, 0, 1.53, 0, skin)); // neck
  s.push(ball(0.165, 0, 1.69, 0, skin, 2));
  s.push(box(0.3, 0.09, 0.3, 0, 1.82, 0.02, 0xa9a9a9)); // short grey hair
  s.push(box(0.31, 0.12, 0.2, 0, 1.74, 0.1, 0xa9a9a9));
  s.push(box(0.13, 0.07, 0.02, -0.075, 1.71, -0.16, 0x151515)); // glasses
  s.push(box(0.13, 0.07, 0.02, 0.075, 1.71, -0.16, 0x151515));
  s.push(box(0.1, 0.04, 0.015, -0.075, 1.71, -0.165, 0xbcd8ea));
  s.push(box(0.1, 0.04, 0.015, 0.075, 1.71, -0.165, 0xbcd8ea));
  s.push(box(0.12, 0.025, 0.02, -0.08, 1.775, -0.155, 0x6f6f6f, { rz: -0.35 })); // furrowed brows
  s.push(box(0.12, 0.025, 0.02, 0.08, 1.775, -0.155, 0x6f6f6f, { rz: 0.35 }));
  s.push(box(0.1, 0.02, 0.02, 0, 1.6, -0.155, 0x7a3b2e)); // unimpressed mouth
  return [part(s)];
}

// --- Obstacles and props ----------------------------------------------------

function cone() {
  const s = [];
  s.push(box(0.44, 0.05, 0.44, 0, 0.025, 0, 0x1a1a1a));
  s.push(cyl(0.035, 0.19, 0.62, 0, 0.36, 0, 0xff6a13, { seg: 10 }));
  s.push(cyl(0.118, 0.148, 0.1, 0, 0.3, 0, 0xffffff, { seg: 10 }));
  s.push(cyl(0.07, 0.097, 0.09, 0, 0.47, 0, 0xffffff, { seg: 10 }));
  return [part(s)];
}

function barrier() {
  const s = [];
  for (let i = 0; i < 4; i++) {
    const x = -0.75 + i * 0.5;
    const c = i % 2 ? 0xf4f4f4 : 0xd92626;
    s.push(box(0.5, 0.26, 0.56, x, 0.13, 0, c));
    s.push(box(0.5, 0.64, 0.5, x, 0.58, 0, c, { top: [1, 0.42] }));
  }
  return [part(s)];
}

function charger() {
  const s = [];
  s.push(box(0.8, 0.12, 0.8, 0, 0.06, 0, 0x9a9d9f));
  s.push(box(0.46, 1.9, 0.32, 0, 1.07, 0, 0xf5f7f8));
  s.push(box(0.5, 0.24, 0.36, 0, 2.08, 0, 0x16b3a6));
  s.push(box(0.3, 0.3, 0.03, 0, 1.55, -0.17, 0x10151c)); // screen
  s.push(box(0.36, 0.06, 0.03, 0, 1.24, -0.17, 0x3df07a)); // status strip
  s.push(box(0.08, 0.5, 0.08, 0.28, 1.2, -0.05, 0x111111)); // holster + cable
  s.push(box(0.06, 0.06, 0.34, 0.28, 0.95, -0.2, 0x111111));
  s.push(box(0.1, 0.16, 0.1, 0.28, 1.48, -0.05, 0x16b3a6));
  return [part(s)];
}

function tree() {
  const s = [];
  s.push(cyl(0.2, 0.3, 2.4, 0, 1.2, 0, 0x6e4a2c, { seg: 7 }));
  s.push(ball(1.7, 0, 3.7, 0, 0x3f9a45, 0));
  s.push(ball(1.25, 0.95, 3.1, 0.35, 0x347f3b, 0));
  s.push(ball(1.15, -0.85, 3.3, -0.4, 0x4cae52, 0));
  s.push(ball(1.0, 0.1, 4.9, 0.1, 0x55b95a, 0));
  return [part(s)];
}

function kiosk() {
  const s = [];
  s.push(box(3.4, 0.14, 2.8, 0, 0.07, 0, 0x8c8f91));
  s.push(box(3.0, 2.3, 2.2, 0, 1.29, 0.2, 0xf3e7cf));
  s.push(box(2.5, 0.9, 0.06, 0, 1.75, -0.92, 0x26211d)); // serving hatch
  s.push(box(2.8, 0.1, 0.5, 0, 1.2, -1.1, 0xb8793f)); // counter
  for (let i = 0; i < 8; i++) {
    s.push(box(0.4, 0.06, 1.1, -1.4 + i * 0.4, 2.42, -1.25, i % 2 ? 0xffffff : 0xd62828, { rx: 0.28 }));
  }
  s.push(box(3.2, 0.14, 2.4, 0, 2.5, 0.2, 0xd62828)); // roof
  s.push(box(1.8, 0.5, 0.1, 0, 2.86, -0.6, 0xfff7e0)); // blank sign
  s.push(cyl(0.16, 0.2, 0.6, 0.7, 1.75, -0.75, 0x9a5a2b, { seg: 8 })); // kebab spit
  s.push(cyl(0.02, 0.02, 0.9, 0.7, 1.75, -0.75, 0x888888, { seg: 5 }));
  return [part(s)];
}

function lamp() {
  const s = [];
  s.push(cyl(0.07, 0.1, 7.2, 0, 3.6, 0, 0x5b6067, { seg: 6 }));
  s.push(box(2.2, 0.08, 0.1, 1.05, 7.15, 0, 0x5b6067));
  s.push(box(0.7, 0.1, 0.26, 1.9, 7.08, 0, 0xfff3c4));
  return [part(s)];
}

function rail() {
  // One 10 m guard-rail segment running along Z, centred.
  const s = [];
  s.push(box(0.07, 0.3, 10, 0, 0.62, 0, 0xb9bec4));
  for (const z of [-3.75, -1.25, 1.25, 3.75]) s.push(box(0.1, 0.62, 0.1, 0.05, 0.31, z, 0x7b8087));
  return [part(s)];
}

export const BUILDERS = {
  player_car: playerCar,
  pickup,
  chaser,
  traffic_car: trafficCar,
  cone,
  barrier,
  charger,
  tree,
  kiosk,
  lamp,
  rail,
};

// --- Textures drawn at runtime ----------------------------------------------

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function speckle(g, w, h, n, colors) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length];
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

// One 12 m tile of four-lane road, including the edge lines.
export function roadTexture() {
  const t = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#3b3e44';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2600, ['#44474d', '#34373c', '#3f4248']);
    const px = w / 16; // texture spans 16 m across
    g.fillStyle = '#e9e9e2';
    g.fillRect(px * 0.75, 0, 5, h);
    g.fillRect(w - px * 0.75 - 5, 0, 5, h);
    for (const m of [4.5, 8, 11.5]) g.fillRect(px * m - 2, 0, 5, h * 0.4);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function grassTexture() {
  const t = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#6fae52';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1800, ['#79b85a', '#65a24a', '#74b356']);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function asphaltTexture() {
  const t = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#4a4d53';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1400, ['#53565c', '#43464b']);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function windowTexture() {
  const t = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#d9d4c9';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        g.fillStyle = (x * 7 + y * 3) % 5 === 0 ? '#f4e6a6' : '#52677d';
        g.fillRect(x * 32 + 7, y * 32 + 8, 18, 18);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function boltTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#12a35a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(74, 10);
    g.lineTo(32, 70);
    g.lineTo(58, 70);
    g.lineTo(48, 118);
    g.lineTo(96, 52);
    g.lineTo(68, 52);
    g.closePath();
    g.fill();
  });
}

export function checkerTexture() {
  return canvasTexture(256, 32, (g, w, h) => {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 16; x++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
        g.fillRect(x * 16, y * 16, 16, 16);
      }
    }
  });
}
