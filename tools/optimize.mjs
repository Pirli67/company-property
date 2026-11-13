// Turns a raw image-to-3D GLB into a game-ready one.
//
//   npm run optimize                  every asset that has pipeline/raw/<name>.glb
//   npm run optimize -- pickup        one asset
//   npm run optimize -- pickup --yaw 90 --triangles 16000
//
// Per asset (settings in pipeline/assets.json):
//   1. weld + simplify to the triangle budget (meshoptimizer)
//   2. fix orientation (vehicles face -Z), scale to real-world metres,
//      move the pivot to the bottom centre
//   3. resize textures and re-encode them as WebP
//   4. Meshopt-compress geometry, write public/assets/models/<name>.glb
//   5. register the file in public/assets/manifest.json

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, getBounds, join as joinMeshes, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'pipeline/assets.json'), 'utf8'));
const manifestPath = join(root, 'public/assets/manifest.json');
const outDir = join(root, 'public/assets/models');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const names = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

const countTriangles = (doc) =>
  doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);

async function optimize(name) {
  const spec = config.assets[name];
  if (!spec) throw new Error(`unknown asset "${name}"`);
  const input = join(root, 'pipeline/raw', `${name}.glb`);
  if (!existsSync(input)) return console.log(`- ${name}: no pipeline/raw/${name}.glb, skipped`);

  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  const doc = await io.read(input);
  const before = countTriangles(doc);
  const budget = flag('triangles') ?? spec.triangles;

  await doc.transform(dedup(), flatten(), joinMeshes(), weld());
  if (before > budget) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: budget / before, error: 0.02 }));
  }

  // Orientation, scale and pivot go on one wrapper node; the game bakes node
  // transforms into the geometry when it loads the file.
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const yaw = ((flag('yaw') ?? spec.yaw ?? 0) * Math.PI) / 180;
  const turn = doc.createNode('turn').setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    turn.addChild(child);
  }
  scene.addChild(turn);
  let b = getBounds(scene);
  const axis = { x: 0, y: 1, z: 2 }[spec.size.axis];
  const scale = spec.size.metres / (b.max[axis] - b.min[axis]);
  const pivot = doc.createNode(name).setScale([scale, scale, scale]);
  scene.removeChild(turn);
  pivot.addChild(turn);
  scene.addChild(pivot);
  b = getBounds(scene);
  pivot.setTranslation([-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2]);

  const texture = flag('texture') ?? spec.texture ?? 1024;
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 86, resize: [texture, texture] }),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );

  mkdirSync(outDir, { recursive: true });
  const output = join(outDir, `${name}.glb`);
  await io.write(output, doc);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.models[name] = { ...manifest.models[name], file: `models/${name}.glb` };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  b = getBounds(scene);
  const dims = b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(' x ');
  const kb = (f) => `${(statSync(f).size / 1024).toFixed(0)} kB`;
  console.log(`✓ ${name}: ${Math.round(before)} → ${Math.round(countTriangles(doc))} tris, ${dims} m, texture ≤${texture}px, ${kb(input)} → ${kb(output)}`);
}

for (const name of names.length ? names : Object.keys(config.assets)) await optimize(name);
