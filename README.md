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

Falling pickaxes are simulated by a **hand-written solver** (`src/physics/PickaxeSimulator.ts`)
that uses nothing but Three.js math classes — no Rapier, no external physics
engine anywhere in the drop/mine path:

- fixed 1/120 s timestep behind an accumulator, so the feel never depends on FPS
- semi-implicit Euler for linear motion, quaternion-delta integration for
  rotation, exponential damping, velocity / angular-velocity clamps
- gravity, linear + angular velocity, free 3D tumbling, drag, sleep
- a `PickaxeBody` per drop holds position / velocity / orientation /
  angularVelocity and writes the mesh transform — the mesh is purely visual
- collision probes are sampled from the same part list as the meshes
  (`HEAD_LEFT`, `HEAD_CENTER`, `HEAD_RIGHT`, `HANDLE_MIDDLE`, `HANDLE_END` and
  the rest of the sample cloud); every probe is **swept** from its previous
  world position to its current one, so a fast pickaxe can never tunnel
- collisions are resolved against a voxel DDA plus the arena deck behind the
  `CollisionWorld` interface (`src/physics/VoxelCollisionWorld.ts`), which is the
  seam a `workspace:Raycast` Roblox port would replace
- a single-contact impulse response with a scalar inverse inertia gives bounce,
  friction and the off-centre spin that makes edge hits tumble
- a subtle speed-gated alignment torque makes the head lead the fall, so
  head-first arrivals are common (about 80% of first contacts) while roughly
  one in five drops still lands handle-first
- impact quality (`PERFECT_HEAD_HIT`, `HEAD_HIT`, `SIDE_HIT`, `GLANCING_HIT`,
  `HANDLE_HIT`) drives crater damage, bounce, camera shake and sound

Colliders in the engine path are still 3D compound shapes for the tools that
still use Rapier (anvils, bombs, saws, drills, boulders, meteors), and the
target is still a full 3D voxel volume — a strike carves the block it hit, with
damage spreading a few blocks into the depth so the crater never looks paper
thin.

**Only the metal head mines.** Each probe is tagged as `head` or `handle`, so a
wooden-handle strike does not carve anything: it clangs, kicks the spin and
tumbles the pickaxe away to bounce again. Nearly one in five badly-aimed drops
bounce off harmlessly, which is what makes the good head-first hits read.

**Destroyed blocks never stop the pickaxe.** A head impact that beats the
block's resistance carves its crater and lets the tool carry straight on
through it, so a hard drop can chain through several blocks before it slows
down, tumbles off or sticks.

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

**Drop physics** — pickaxes run on the hand-written `PickaxeSimulator` described
above. The remaining tools (anvils, bombs, saws, drills, boulders, meteors) are
still built from the same part list that feeds both the visual meshes and a
Rapier compound collider, so mass distribution stays physical for them, and they
differ in mass, restitution, damping, spin, gravity scale and behaviour
(`impact`, `drill`, `saw`, `roll`, `explosive`, `meteor`, `rain`).

**Physics lab (dev)** — `window.__game.dev.lab()` loads a flat floor with one
lone block, a wall and a pile, `dev.dropMany(n, tool)` dumps pickaxes on it,
`dev.pickaxeDebug(true)` overlays collision probes, sweep lines, contact normals,
velocity/angular-velocity vectors and the impact classification of every hit, and
`dev.tuning({...})` reads or patches the live solver dials (`gravity`,
`alignmentStrength`, restitutions, penetration, stick, sleep, ...).

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
node tools/smoke.mjs        # end-to-end click-through
node tools/pacing.mjs       # drops-to-clear per target
node tools/targets.mjs      # ASCII silhouette of every target
node tools/simtest.mjs      # physics lab: falls, tumbles, mines, settles
node tools/simwatch.mjs     # per-body speed/spin/contact trace (catches runaways)
node tools/feeltest.mjs     # impact-quality mix (head vs handle arrivals)
node tools/planartest.mjs   # solver contract: bounded, no tunnelling, settles
node tools/sticktest.mjs    # sticking into blocks
node tools/simtrace.mjs     # single-drop trace from release to rest
```
