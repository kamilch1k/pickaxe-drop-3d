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
npm test           # solver unit tests (node --test, no browser needed)
```

## Mining feel

Falling pickaxes are simulated by a **hand-written planar solver**
(`src/physics/PickaxeSimulator.ts`), a port of the physics from the
[Pickaxe Drop Astra](https://kamilch1k.github.io/pickaxe-drop-astra/) experiment.
No Rapier, no external physics engine anywhere in the drop/mine path:

- each drop owns a vertical **interaction plane**: the pickaxe only ever spins
  about that plane's normal and is locked into a thin depth lane, so the blade
  always faces the target the way it was aimed
- a fixed 1/120 s timestep behind an accumulator, with angular substeps
- **swept sphere probes**: every collision probe is a small sphere swept from
  its previous to its current position and tested against grown voxel AABBs, so
  a fast pickaxe can never tunnel
- collisions resolve at their **exact time of impact** (the body is rewound to
  the contact, an impulse is applied, then the rest of the step continues), up
  to 16 contacts per substep
- one-contact impulses with a scalar inertia give bounce, friction and the
  off-centre spin that makes edge hits tumble
- **breaking a block kicks the pickaxe back out** of the new crater with a
  rebound plus a guaranteed upward hop, so it never drills down its own hole
- head contacts mine; side scuffs on a metal head chip a block (capped, with a
  cooldown); handle contacts never damage and just clang off
- bodies sleep once they have rested on a supporting contact for a moment, and
  the visual transform is interpolated between fixed steps

Colliders in the engine path are still 3D compound shapes for the tools that
still use Rapier (anvils, bombs, saws, drills, boulders, meteors), and the
target is still a full 3D voxel volume — a strike carves the block it hit, with
damage squashed along the drop plane so a flat blade never gouges depth it did
not touch.

**Hard per-hit block caps** keep every tool readable: the starter pickaxe breaks
*exactly one block* per hit, then 3 → 6 → 12 → 45 as you unlock better tools, with
explosives in the hundreds. Blocks closest to the impact always break first, so
a capped hit still bites the surface instead of tunnelling.

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

**Drop physics** — pickaxes run on the hand-written planar solver described
above. The remaining tools (anvils, bombs, saws, drills, boulders, meteors) are
still built from the same part list that feeds both the visual meshes and a
Rapier compound collider, so mass distribution stays physical for them, and they
differ in mass, restitution, damping, spin, gravity scale and behaviour
(`impact`, `drill`, `saw`, `roll`, `explosive`, `meteor`, `rain`).

**Physics lab (dev)** — `window.__game.dev.lab()` loads a flat floor with one
lone block, a wall and a pile, `dev.dropMany(n, tool)` dumps pickaxes on it,
`dev.pickaxeDebug(true)` overlays collision probes, swept probe paths, contact
normals, velocity / spin vectors and the depth lane, and `dev.tuning({...})`
reads or patches the live solver dials (`gravity`, restitutions, probe radius,
lane depth, break hop, side chips, sleep thresholds, ...).

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
  physics/           hand-written pickaxe solver (PickaxeSimulator,
                     VoxelCollisionWorld, ToolProbes, PickaxeDebugView) and the
                     Rapier wrapper still used by non-pickaxe tools
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
npm test                    # solver unit tests: sweeps, planar lock, hop, settling
node tools/smoke.mjs        # end-to-end click-through
node tools/pacing.mjs       # drops-to-clear per target
node tools/targets.mjs      # ASCII silhouette of every target
node tools/planartest.mjs   # planar contract: no depth drift, no off-axis spin
node tools/hoptest.mjs      # break rebound: bites kick the pickaxe back out
node tools/simtest.mjs      # physics lab: falls, tumbles, mines, settles
node tools/simwatch.mjs     # per-body speed/spin/contact trace (catches runaways)
node tools/feeltest.mjs     # strike mix (head vs handle, quality split)
node tools/simtrace.mjs     # single-drop trace from release to rest
```
