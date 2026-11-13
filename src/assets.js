// Asset loading. Each model is described once in the manifest; if a GLB is
// listed and loads, it is used, otherwise the procedural stand-in is used.
// Both paths produce the same thing: a list of { geometry, material } parts,
// which can be turned into a Group (vehicles) or an InstancedMesh (obstacles).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BUILDERS } from './procedural.js';

const BASE = import.meta.env.BASE_URL;

export class Assets {
  constructor(renderer) {
    this.renderer = renderer;
    this.parts = {};
    this.source = {}; // name -> 'glb' | 'procedural'
    this.manifest = { models: {}, voice: {} };
  }

  async load(onProgress = () => {}) {
    try {
      const res = await fetch(`${BASE}assets/manifest.json`, { cache: 'no-cache' });
      this.manifest = await res.json();
    } catch (err) {
      console.warn('[assets] no manifest, using procedural models only', err);
    }

    const names = Object.keys(BUILDERS);
    let done = 0;
    await Promise.all(
      names.map(async (name) => {
        const entry = this.manifest.models?.[name];
        if (entry?.file) {
          try {
            this.parts[name] = await this.loadGlb(`${BASE}assets/${entry.file}`, entry);
            this.source[name] = 'glb';
          } catch (err) {
            console.warn(`[assets] ${name}: GLB failed, using procedural model`, err);
          }
        }
        if (!this.parts[name]) {
          this.parts[name] = BUILDERS[name]();
          this.source[name] = 'procedural';
        }
        onProgress(++done / names.length);
      }),
    );
    this.ktx2?.dispose();
    return this;
  }

  get loader() {
    if (!this._loader) {
      // three bundles the Draco and Basis decoders itself; Vite emits them as assets.
      const draco = new DRACOLoader();
      this.ktx2 = new KTX2Loader().detectSupport(this.renderer);
      this._loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder);
    }
    return this._loader;
  }

  async loadGlb(url, entry) {
    const gltf = await this.loader.loadAsync(url);
    gltf.scene.updateMatrixWorld(true);

    // Optional runtime tweaks on top of what tools/optimize.mjs baked in.
    const fix = new THREE.Matrix4().compose(
      new THREE.Vector3(0, entry.yOffset || 0, 0),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(entry.yaw || 0)),
      new THREE.Vector3().setScalar(entry.scale || 1),
    );

    const parts = [];
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const geometry = o.geometry.clone();
      // Meshopt/quantised files store positions as normalised integers. They
      // must become floats before a transform can be baked into them.
      for (const key of ['position', 'normal', 'tangent']) {
        const a = geometry.getAttribute(key);
        if (!a || (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute)) continue;
        const f = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
        geometry.setAttribute(key, new THREE.BufferAttribute(f, a.itemSize));
      }
      geometry.applyMatrix4(o.matrixWorld).applyMatrix4(fix);
      geometry.computeBoundingBox();
      parts.push({ geometry, material: o.material });
    });
    if (!parts.length) throw new Error('GLB contains no meshes');
    return parts;
  }

  // A regular scene-graph object, for the handful of unique things.
  group(name, { castShadow = true } = {}) {
    const g = new THREE.Group();
    for (const p of this.parts[name]) {
      const m = new THREE.Mesh(p.geometry, p.material);
      m.castShadow = castShadow && !p.material.transparent;
      g.add(m);
    }
    return g;
  }

  triangles(name) {
    return this.parts[name].reduce((n, p) => n + (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3, 0);
  }
}

// Fixed-capacity pool of instances sharing one draw call per part.
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class InstancePool {
  constructor(scene, parts, capacity, { castShadow = true, tint = false } = {}) {
    this.capacity = capacity;
    this.meshes = parts.map((p) => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, capacity);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; // instances are spread along the whole road
      m.castShadow = castShadow && !p.material.transparent;
      for (let i = 0; i < capacity; i++) {
        m.setMatrixAt(i, ZERO);
        if (tint) m.setColorAt(i, WHITE);
      }
      scene.add(m);
      return m;
    });
    this.free = [];
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
    this.high = 0;
    for (const m of this.meshes) m.count = 0;
    this.dirty = true;
    this.colorDirty = tint;
  }

  alloc() {
    if (!this.free.length) return -1;
    const id = this.free.pop();
    // Only draw up to the highest slot ever used, not the whole capacity.
    if (id >= this.high) {
      this.high = id + 1;
      for (const m of this.meshes) m.count = this.high;
    }
    return id;
  }

  set(id, matrix) {
    if (id < 0) return;
    for (const m of this.meshes) m.setMatrixAt(id, matrix);
    this.dirty = true;
  }

  setColor(id, color) {
    if (id < 0) return;
    for (const m of this.meshes) m.setColorAt(id, color);
    this.colorDirty = true;
  }

  release(id) {
    if (id < 0) return;
    this.set(id, ZERO);
    this.free.push(id);
  }

  releaseAll() {
    this.free.length = 0;
    for (let i = this.capacity - 1; i >= 0; i--) {
      for (const m of this.meshes) m.setMatrixAt(i, ZERO);
      this.free.push(i);
    }
    this.high = 0;
    for (const m of this.meshes) m.count = 0;
    this.dirty = true;
  }

  flush() {
    if (this.dirty) for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
    if (this.colorDirty) for (const m of this.meshes) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    this.dirty = this.colorDirty = false;
  }
}

const WHITE = new THREE.Color(1, 1, 1);
