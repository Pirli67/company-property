# Company Car Chase

Monday, 12:00. Five apprentices take the company car to lunch. One colleague, who has no
authority to stop them, follows in an old white pickup. You drive the car.

A 3D browser game in Three.js. No backend.

## Run it

```bash
npm install
```

```bash
npm run dev
```

`npm run build` writes a static site to `dist/`.

## Play

| Key | Action |
| --- | --- |
| W / ↑ | accelerate |
| S / ↓ | brake, then reverse |
| A D / ← → | steer |
| Shift or Space | boost (drains the battery 2.6× faster) |
| C | look back |
| P / Esc | pause |
| M | mute |

Touch devices get on-screen buttons and accelerate automatically.

The battery starts half empty. Pull into a ⚡ bay on the right and come to a full stop to
charge. He keeps coming while you stand still, so how long you stay plugged in is the
whole game. Reach the kebab kiosk 4.5 km away to win; every week he gets a little faster.

Add `?autopilot` to the URL for a self-driving demo, `?seed=7` for a fixed road.

## Code

| File | What it does |
| --- | --- |
| `src/config.js` | every gameplay number (speeds, battery, chaser, spawn rates) |
| `src/main.js` | renderer, game states, camera, rear camera, quality scaling |
| `src/world.js` | road, charging bays, scenery, obstacles, traffic, debris, collisions |
| `src/vehicles.js` | arcade driving model for the car and the pickup |
| `src/assets.js` | GLB loading (Meshopt / Draco / KTX2) with procedural fallback, instancing |
| `src/procedural.js` | stand-in models and runtime textures |
| `src/audio.js` | Web Audio: synthesised motor, V8, charging, impacts; voice playback |
| `src/voice.js` | the chaser's lines and when he says them |
| `src/hud.js` | DOM HUD |

Everything repeated (cones, barriers, traffic, trees, rails, buildings) is an
`InstancedMesh`; a frame is about 20 draw calls.

## Assets

The game runs on procedural stand-in models until generated ones exist. Each model in
`public/assets/manifest.json` with a `file` is loaded as GLB; anything without one keeps
its stand-in, so assets can be swapped in one at a time.

Pipeline (settings and prompts in `pipeline/assets.json`):

1. Concept image, fal.ai `fal-ai/nano-banana-2`, saved to `public/assets/concepts/`.
2. Approved concept to 3D, fal.ai `fal-ai/trellis-2`, saved to `pipeline/raw/<name>.glb`.
3. `npm run optimize -- <name>`: simplify to the triangle budget, face -Z, scale to
   metres, pivot at bottom centre, textures resized and stored as WebP, Meshopt
   compression, registered in the manifest.
4. Voice lines, fal.ai `elevenlabs/tts/eleven-v4`, saved to
   `public/assets/audio/voice/<line id>.mp3` and listed under `voice` in the manifest.
   Until then the browser's speech synthesis reads the lines.

No logos, brand names or copyrighted audio are used. The vehicles are generic designs and
the voice lines are original writing.
