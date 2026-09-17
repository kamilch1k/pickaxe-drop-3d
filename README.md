# PICKAXE DROP 3D

A polished 3D physics destruction toy: you drop increasingly ridiculous heavy
objects from the sky onto voxel targets and watch them come apart block by
block.

**Play it now: https://kamilch1k.github.io/pickaxe-drop-3d/**

Everything runs in the browser. No backend, no build-time assets — every
texture, sound and model in the game is generated procedurally at runtime.

```bash
npm install
npm run dev        # http://localhost:5177
```

```bash
npm run build      # typecheck + production bundle in dist/
npm run preview    # serve the production build
```

## Mining feel

Pickaxes are sized to the blocks and dropped **dead vertical** — no lateral
spread, no sideways shove. Each one is locked to a single rotation axis: it
spins only in a plane facing the camera around its own Z axis, and X/Y rotation
is overwritten every frame from both the rotation and the angular velocity, so a
pickaxe can never tip onto its side or start tumbling around world Z after it
lands. The tool geometry is built around its own centre of mass, which is what
makes that constraint free of drift. Drills and saws spin on their own axis;
anvils, bombs, boulders and meteors keep full rigid-body rotation.

A strike carves exactly the block it hit (and a growing cluster as you unlock
better tools), so the crater grows where you aim.

## How to play

- **Left click / tap** anywhere on the target to drop the selected object there.
  A golden ring and a light column show exactly where it will land.
- **Right-drag** (or two-finger drag) to orbit the arena a little. The camera
  always keeps a composed three-quarter framing, reframing automatically as the
  target gets smaller.
- **1 – 9** select tools, **Space** drops at the last aim point, **Esc** closes
  panels.
- Crack the target apart, collect coins, buy better droppers and upgrades,
  clear the target, then meet the next one.

## Systems

**Voxel destruction** — targets are generated into a dense voxel grid
(`Uint8Array` occupancy + `Float32Array` health, 40×46×40). Voxels are rendered
through one `InstancedMesh` per material, so a 6000-voxel creature is a handful
of draw calls. Impacts carve spherical craters with distance falloff, tint
damaged voxels, spawn material-specific particles/shards and detach unsupported
chunks (a flood fill from the anchor layer) which tumble away as pooled rigid
bodies. Collision uses greedy-merged boxes rebuilt from the live grid, throttled
so it never costs a frame.

**Drop physics (Rapier 3D)** — every tool is built from the same part list that
feeds both the visual meshes and the compound collider, so mass distribution is
physical: a pickaxe head is ~95% of the mass, which means it naturally rights
itself head-down as it falls, then tumbles end-over-end from a controlled
angular impulse. Tools differ in mass, restitution, damping, spin, gravity
scale and behaviour (`impact`, `drill`, `saw`, `roll`, `explosive`, `meteor`,
`rain`).

**Rolling bodies** — a rolling sphere protects the footprint underneath itself,
so it rolls along the surface and only eats the blocks it pushes into sideways,
instead of drilling itself into the ground.

**Game feel** — hit-stop on big impacts, slow motion on a target clear, camera
shake and FOV kicks scaled by impact energy, material-aware particles (stone
dust, metal sparks, crystal shards, gold glitter, obsidian purple, mythic
rainbow), expanding shockwaves, impact flashes, aggregated floating coin
numbers, coin flights into the HUD, combo meter, animated counters.

**Audio** — fully synthesised through the Web Audio API: filtered noise bursts,
detuned oscillators and pitch-randomised impacts per material, plus a generative
music loop with a reverb tail. Music/SFX toggles live in settings.

**Progression** — 12 permanent unlocks, 6 upgrade tracks (drop power, impact
weight, drop height, coin multiplier, fortune, multi-drop) and 7 targets:
Stone Ore Chunk, Gold Vein, Crystal Formation, Giant Treasure Block, **THE
OOGA** (a giant voxel creature with a very large head), Obsidian Beast and The
Mythic Core. Everything is saved to `localStorage`, with a reset in settings.

## Project layout

```
src/
  main.ts            boot + first-gesture audio unlock
  Game.ts            orchestration, loop, hit-stop/slow-mo, target lifecycle
  scene/             renderer + post FX, camera director, procedural textures,
                     arena/world building
  physics/           Rapier wrapper (bodies, pooled colliders, event routing)
  destruction/       voxel grid, damage model, procedural target builders
  entities/          tool factory, falling objects, debris pool
  effects/           particles, shards, shockwaves, material FX
  audio/             synth engine + generative music
  progression/       save system and progression state
  ui/                HUD, dock, panels, floats (DOM + CSS)
  content/           data: materials, tools, targets, upgrades
  utils/             math, rng, noise
```

## Performance notes

Instanced voxels, pooled debris/particles/shards, a single shadow-casting light,
throttled collider rebuilds and connectivity checks, capped rigid bodies, and an
adaptive quality step that lowers the pixel ratio and disables bloom if the
frame budget is repeatedly blown.

## Deployment

The playable build lives on the `gh-pages` branch: it contains the contents of
`dist/` plus a `.nojekyll` file, and GitHub Pages serves it at
https://kamilch1k.github.io/pickaxe-drop-3d/.

```bash
npm run build
# then publish dist/ to the gh-pages branch (any static host works too,
# the bundle uses relative asset paths so it runs from a sub-path)
```

## QA scripts (optional)

The `tools/` folder contains the headless Playwright-style harness used while
building the game (frame-rate checks, target silhouettes, pacing measurements).
They need `npm i -D puppeteer-core` and a local Chrome/Edge install.

```bash
npm run dev
node tools/smoke.mjs        # end-to-end click-through
node tools/pacing.mjs       # drops-to-clear per target
node tools/targets.mjs      # ASCII silhouette of every target
```
