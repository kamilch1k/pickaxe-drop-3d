# Handoff prompt: finish the Rapier-free pickaxe simulation (Three.js version)

> **STATUS: DONE.** The hand-written solver is wired in and Rapier is no longer
> involved anywhere in the pickaxe drop/mine path. The solver was subsequently
> replaced by a port of the **Pickaxe Drop Astra** physics (see
> `src/physics/PickaxeSimulator.ts`): planar lock + depth lane, swept sphere
> probes against grown voxel AABBs, time-of-impact resolution, break rebound
> with an upward hop, side chipping, and support-based sleeping.
>
> - `src/physics/PickaxeSimulator.ts` — the solver, config and planar helpers
> - `src/physics/VoxelCollisionWorld.ts` — `CollisionWorld` over the voxel grid
>   + deck, implementing `sweepSphere`
> - `src/physics/ToolProbes.ts` — sparse collision probes sampled from the tool
>   parts (`HEAD_LEFT/CENTER/RIGHT`, `HANDLE_MIDDLE/END` and extremities)
> - `src/physics/PickaxeDebugView.ts` — dev overlay (probes, sweeps, normals,
>   vectors, depth lane)
> - `src/entities/DropSystem.ts` — pickaxes (`kind === 'pickaxe'`) spawn a
>   `PickaxeBody` and never touch Rapier; anvils/bombs/saws/drills/boulders/
>   meteors keep the engine path
> - `npm test` — solver unit tests in `tools/physics.test.ts`, ported from the
>   Astra suite (sweeps, planar lock, depth lane, off-centre spin, break hop,
>   handle damage rules, multi-body settling)
> - physics lab target + dev hooks (`dev.lab()`, `dev.dropMany()`,
>   `dev.pickaxeDebug()`, `dev.tuning()`), see the README
>
> The prompt below is kept for history; nothing in it is still pending. Note
> that sticking was dropped with the Astra port - the reference solver bounces
> and hops out of craters instead of sticking.

Paste this into a fresh session running in `C:\Users\rewwe\Documents\OpenCode`.

---

## Mission

The Three.js version of Pickaxe Drop (`pickaxe-drop-3d`) currently simulates falling pickaxes with the Rapier physics engine. Replace that with the project's own hand-written lightweight solver so that falling pickaxes use **no external physics engine at all** (no Rapier, Cannon, Ammo, Matter, Havok). Rapier may stay for anything else that still needs it, but the pickaxe drop/mine path must stop touching it.

A solver module already exists: `pickaxe-drop-3d/src/physics/PickaxeSimulator.ts`. It was written from scratch with only Three.js math classes (Vector3, Quaternion) and recent defect fixes were applied. It is **not yet wired into the game** — that is the job.

Do not redesign the game. Preserve existing visuals, controls, spawning, voxel destruction, progression, UI and gameplay wherever possible. Work incrementally.

## What already exists (read this file first)

`src/physics/PickaxeSimulator.ts` contains:

- `PickaxeTuning` + `DEFAULT_PICKAXE_TUNING` — all tuning dials (gravity, fixedDelta, mass, inverseInertia, linearDrag, angularDrag, initialSpinMin/Max, alignmentStrength, maxVelocity, maxAngularVelocity, head/handle/ground restitution, friction, head/handle damage multipliers, penetrationEnergyThreshold, penetrationVelocityLoss, stickMinSpeed, stickAlignmentThreshold, stickProbability, sleep thresholds + delay).
- `PICKAXE_PROBES` — HEAD_LEFT, HEAD_CENTER, HEAD_RIGHT, HANDLE_MIDDLE, HANDLE_END as local-space offsets tagged `head` or `handle`.
- `CollisionWorld` interface — one method: `sweepSegment(start: Vector3, end: Vector3): SweepHit | null`, where `SweepHit` carries `t`, `point`, `normal`, `destructible`, `resistance`, optional `voxelCenter`/`voxelId`/`node`.
- `PickaxeBody` — position/velocity/orientation/angularVelocity, previous transform, mass/inverseMass/inverseInertia, drags, headAxis, active/sleeping/stuck, `probeWorld()`, `headDirection()`, `markStill()`.
- `PickaxeSimulator` — `update(dt)` fixed-timestep accumulator (1/120), `simulateStep()`, `integrateLinear()`, `integrateAngular()`, `applyAlignmentTorque()`, `performSweptCollision()`, `resolveCollision()`, `classifyImpact()` (PERFECT_HEAD_HIT / HEAD_HIT / SIDE_HIT / HANDLE_HIT / GLANCING_HIT), `handlePenetration()`, `handleSleeping()`, plus a `debug` snapshot (probe points, previous probe points, sweep lines, normals, last quality) and hooks: `onImpact`, `onVoxelDamage`, `onVoxelDestroyed`, `onPickaxeStick`, `onPickaxeStop`.
- `DEFAULT_PICKAXE_TUNING` values are first-pass guesses; plan to tune after it runs.

## Tasks, in order

1. **Implement `CollisionWorld` over the game's voxel store.** New file `src/physics/VoxelCollisionWorld.ts`. Map the swept segment from world space into voxel grid space and walk the cells along it (DDA / segment-vs-voxel), returning the earliest hit with outward normal, `resistance` from the block's material/hardness, and the voxel identity so the game can carve it. If the current voxel architecture makes direct grid queries genuinely awkward, a Three.js `Raycaster` adapter is an acceptable first implementation — but keep it behind the same `CollisionWorld` interface so the DDA can replace it later. Never report a hit from a simple "point is inside a block" test; a fast pickaxe tunnels through.
2. **Wire the simulator into `src/entities/DropSystem.ts`.** Create one `PickaxeSimulator` for the drop system; per pickaxe create a `PickaxeBody` with that pickaxe's visual group (the mesh must be visual only — never let it determine physics) and add it to the simulator; call `sim.update(dt)` once per frame from the existing update/render loop. Remove the Rapier pickaxe path: `setLinvel`, `setAngvel`, the DOF locking block (**around lines 207–220**), the bounce/hop (**around lines 519–527**), and the mining speed gate (**around lines 331–355**). Line numbers are approximate — find them, don't trust them.
3. **Route hooks into existing gameplay.** `onVoxelDestroyed` → the existing destruction routine (keep current visuals, progression and UI untouched); `onVoxelDamage` → existing damage feedback; `onImpact` → existing sound/particle/camera-shake hooks, categorised by impact quality; `onPickaxeStick` / `onPickaxeStop` → whatever despawn/rest policy already exists. Do not invent new visual effects.
4. **Spawn variation.** At spawn, give each body a randomised angular velocity (random axis, magnitude between `initialSpinMin` and `initialSpinMax`) so no two drops fall identically.
5. **Debug visualisation** (dev-mode only): draw probe positions, previous probe positions, sweep lines, collision normals, centre of mass, velocity vector, angular velocity axis, and the current impact classification label. Simple lines/spheres in Three.js.
6. **Test scene / test mode** with: flat floor, a single voxel block, a wall, and a pile of voxel blocks. Spawn many pickaxes from above simultaneously.
7. **Tune `DEFAULT_PICKAXE_TUNING`** so the result feels like a satisfying arcade physics toy: substantial, heavy pickaxes; clear 3D tumbling; crunchy head impacts; occasional bad handle impacts; head-first common but not guaranteed; destroyed blocks do not stop the tool (chains of destruction feel good); off-centre hits produce convincing spin; no jitter and no numerical explosions; no tunnelling.

## Hard constraints (owner's words, condensed)

- No Rapier / Cannon / Ammo / Matter / Havok / any external physics engine in the pickaxe path.
- Not a general physics engine: no SAT, no convex solver, no constraint solver, no rigid-body framework. Only: fall → spin → sweep → impact → bounce → angular response → destroy → penetrate → stick → sleep.
- Fixed timestep with an accumulator; semi-implicit Euler for linear motion; quaternion-delta integration for angular motion; exponential damping; velocity and angular-velocity clamps.
- Collision knows which probe hit; head collisions bite (high damage, lower bounce, may stick, may penetrate weakened blocks), handle collisions bounce and tumble (little damage, rotational response).
- `impactEnergy = 0.5 * mass * normalSpeed²` with big gameplay multipliers, not scientific precision.
- Keep physics maths conceptually separate from Three.js rendering/collision adapters — this exact system will be re-implemented in Roblox later (Vector3 + CFrame/quaternion + `workspace:Raycast` or voxel queries), so keep the formulas simple and explicit and avoid unnecessary Three.js-specific functionality in the core maths.
- Expose events/hooks rather than building juice: `onImpact`, `onVoxelDamage`, `onVoxelDestroyed`, `onPickaxeStick`, `onPickaxeStop`.
- Incremental order: one pickaxe vs floor/simple block → voxel destruction → multiple blocks → many simultaneous pickaxes. Do not optimise before correct behaviour is visible.

## Notes from a first read of `DropSystem.ts` (lines 1–260)

- `ActiveDrop` (lines 41–64) holds `body: RAPIER.RigidBody`, `built: BuiltTool` (`group`, `tip`, `colliders`, `parts`), a `falling | channel | done` state, `stuck`, `fade`, `tipWorld`/`prevTipWorld`, `prevVel`, `mineCooldown`, `radiusBlocks`. Replace `body` with a `PickaxeBody`; keep the rest as-is so mining/fades/QA stay untouched.
- `spawnOne` (line 170): `buildTool(def, physics.RAPIER)` → orient group by `def.spinMode` → dynamic body with `enabledTranslations(true, true, false)` (X/Y only) → spins locked to Z only for `planar`, Y only for `axial` → colliders registered as `kind: 'tool'` with `part: built.parts[i]` → `setLinvel({ x: lateral, y: -2.5, z: 0 })`.
- **The current game is 2D-in-3D**: tools translate in X/Y and rotate about Z (`FORWARD`) only. `PickaxeSimulator.ts` as written is full 3D. Decide deliberately: either keep the planar feel by projecting the solver's orientation onto Z and zeroing X/Y spin components (cheapest way to preserve today's look), or accept full 3D tumbling as the new feel. Do not mix the two silently.
- `built.tip` (a local point on the tool) drives the existing mine-contact checks, and `built.parts[i]` labels already distinguish `'head'`-ish parts — both map naturally onto `PICKAXE_PROBES` and the head/handle split in the solver.
- Rapier remains in use for voxel `Target` bodies, debris, and tool-icon rendering (`Ui.ts`, `ToolIcons.ts`). Only the pickaxe drop path is in scope; do not rip Rapier out of those.

## Later (not this session)

The Roblox place "DROP PICKAXES" (placeId 109418348284287) will get the same solver re-implemented in Luau with `workspace:Raycast` behind the same `CollisionWorld` seam. Keep that port in mind, don't do it now.

## Definition of done

Pickaxes spawn, fall with visible 3D tumbling, hit voxels, break them, sometimes bounce off and tumble, occasionally stick, eventually sleep; no Rapier is involved anywhere in that path; visuals/UI/progression behave as before; debug view available; tuning committed with sensible defaults.
