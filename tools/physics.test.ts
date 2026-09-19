/**
 * Unit tests for the planar pickaxe solver, ported from the Pickaxe Drop Astra
 * test suite and adapted to this game's hooks and world seam.
 *
 * Run with: npm test        (node --test tools/physics.test.ts)
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Object3D, Vector3 } from 'three';
import {
  DEFAULT_PICKAXE_TUNING,
  PickaxeBody,
  PickaxeSimulator,
  applyImpulse,
  enforceZConstraint,
  sweepAABB,
  type CollisionWorld,
  type ImpactEvent,
  type SweepHit,
} from '../src/physics/PickaxeSimulator.ts';
import { buildToolProbes } from '../src/physics/ToolProbes.ts';
import { TOOL_BY_ID } from '../src/content/tools.ts';

const tuning = DEFAULT_PICKAXE_TUNING;
const STEP = tuning.fixedDelta;

function testProbes() {
  const def = TOOL_BY_ID.wooden;
  return buildToolProbes(def, def.scale);
}

/** Minimal block world for tests: a flat floor plus cubes, all swept spheres. */
class BoxWorld implements CollisionWorld {
  blocks: { min: Vector3; max: Vector3; health: number; alive: boolean; id: number }[] = [];
  floorY = 0;
  damageScale = 0.6;

  addBlock(x: number, y: number, z: number, half = 0.48, health = 65): number {
    const center = new Vector3(x, y, z);
    const id = this.blocks.length;
    this.blocks.push({
      min: center.clone().addScalar(-half),
      max: center.clone().addScalar(half),
      health,
      alive: true,
      id,
    });
    return id;
  }

  sweepSphere(from: Vector3, to: Vector3, radius: number): SweepHit | null {
    let best: SweepHit | null = null;
    const deck = sweepAABB(
      from,
      to,
      new Vector3(-50, this.floorY - 5 - radius, -50),
      new Vector3(50, this.floorY + radius, 50),
    );
    if (deck) {
      best = {
        t: deck.t,
        point: from.clone().lerp(to, deck.t),
        normal: deck.normal.clone(),
        depth: deck.depth,
        destructible: false,
        resistance: 0,
      };
    }
    for (const block of this.blocks) {
      if (!block.alive) continue;
      const hit = sweepAABB(
        from,
        to,
        block.min.clone().addScalar(-radius),
        block.max.clone().addScalar(radius),
      );
      if (!hit) continue;
      if (best && hit.t >= best.t) continue;
      best = {
        t: hit.t,
        point: from.clone().lerp(to, hit.t),
        normal: hit.normal.clone(),
        depth: hit.depth,
        destructible: true,
        resistance: 0.1,
        voxelId: block.id,
        voxelCenter: block.min.clone().add(block.max).multiplyScalar(0.5),
      };
    }
    return best;
  }

  /** stand-in for the game's crater: energy must beat the block's health */
  applyDamage(id: number, energy: number): boolean {
    const block = this.blocks[id];
    if (!block || !block.alive) return false;
    block.health -= energy * this.damageScale;
    if (block.health <= 0) {
      block.alive = false;
      return true;
    }
    return false;
  }
}

function makeSim(world: BoxWorld): PickaxeSimulator {
  return new PickaxeSimulator(world, tuning, {
    onVoxelDestroyed: (event: ImpactEvent): boolean =>
      world.applyDamage(event.voxelId ?? -1, event.energy),
  });
}

function body(): PickaxeBody {
  return new PickaxeBody(new Object3D(), testProbes(), tuning, TOOL_BY_ID.wooden.scale);
}

/** head-down: the blade points at the floor */
function headDown(b: PickaxeBody): void {
  b.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
}

test('sweepAABB catches a block even when both endpoints are outside', () => {
  const hit = sweepAABB(
    new Vector3(0, 20, 0),
    new Vector3(0, -20, 0),
    new Vector3(-1, -1, -1),
    new Vector3(1, 1, 1),
  );
  assert.ok(hit);
  assert.ok(Math.abs(hit.t - 0.475) < 1e-6);
  assert.equal(hit.normal.y, 1);
  assert.equal(hit.depth, 0);
});

test('sweepAABB reports depth when the sphere starts inside', () => {
  const hit = sweepAABB(
    new Vector3(0, 0, 0),
    new Vector3(0, 0.1, 0),
    new Vector3(-1, -1, -1),
    new Vector3(1, 1, 1),
  );
  assert.ok(hit);
  assert.equal(hit.t, 0);
  assert.equal(hit.depth, 1);
  assert.equal(hit.normal.x + hit.normal.y + hit.normal.z, 1);
});

test('rotation is locked to the drop plane, including corrupted orientations', () => {
  const sim = makeSim(new BoxWorld());
  for (let i = 0; i < 10; i += 1) {
    const b = body();
    b.position.set(0, 6, 0);
    b.orientation.setFromAxisAngle(new Vector3(1, 1, 1).normalize(), 1.2);
    b.angularVelocity.set(8, -6, 4);
    sim.add(b);
    assert.equal(b.previousOrientation.x, 0);
    assert.equal(b.previousOrientation.y, 0);
    assert.equal(b.angularVelocity.x, 0);
    assert.equal(b.angularVelocity.y, 0);
    sim.step(STEP);
    assert.equal(b.orientation.x, 0);
    assert.equal(b.orientation.y, 0);
    assert.equal(b.angularVelocity.x, 0);
    assert.equal(b.angularVelocity.y, 0);
  }
});

test('the depth lane cancels outward depth velocity and keeps everything else', () => {
  for (const sign of [-1, 1]) {
    const b = body();
    b.position.set(2, 30, sign * 10);
    b.velocity.set(3, -4, sign * 80);
    const spin = b.angularVelocity.clone();
    const q = b.orientation.clone();
    enforceZConstraint(b);
    assert.equal(b.position.z, sign * b.halfDepth);
    assert.equal(b.velocity.z, 0);
    assert.equal(b.position.x, 2);
    assert.equal(b.position.y, 30);
    assert.equal(b.velocity.x, 3);
    assert.equal(b.velocity.y, -4);
    assert.ok(b.angularVelocity.equals(spin));
    assert.ok(b.orientation.equals(q));
  }
});

test('an off-centre impulse spins the pickaxe, a centred one does not', () => {
  const a = body();
  const b = body();
  a.angularVelocity.set(0, 0, 0);
  b.angularVelocity.set(0, 0, 0);
  applyImpulse(a, new Vector3(), new Vector3(0, 2, 0), tuning);
  applyImpulse(b, new Vector3(1, 0, 0), new Vector3(0, 2, 0), tuning);
  assert.equal(a.angularVelocity.length(), 0);
  assert.ok(b.angularVelocity.z > 0.5);
});

test('a fast head strike breaks one block then rebounds upward', () => {
  const world = new BoxWorld();
  world.addBlock(0, 10, 0, 0.48, 12);
  const sim = makeSim(world);
  const b = body();
  b.position.set(0, 12.5, 0);
  headDown(b);
  b.angularVelocity.set(0, 0, 0);
  b.velocity.set(0, -30, 0);
  sim.add(b);
  for (let i = 0; i < 14 && sim.stats.broken === 0; i += 1) sim.step(STEP);
  assert.equal(sim.stats.broken, 1);
  assert.ok(b.velocity.y >= tuning.breakHopSpeed - 0.2, `hop was ${b.velocity.y}`);
  assert.equal(b.orientation.x, 0);
  assert.equal(b.orientation.y, 0);
  const height = b.position.y;
  for (let i = 0; i < 12; i += 1) sim.step(STEP);
  assert.ok(b.position.y > height, 'pickaxe should be moving up after the break');
  assert.equal(sim.stats.broken, 1, 'must not drill through the column');
});

test('breaking a side block sends the pickaxe up and away from that side', () => {
  for (const sign of [-1, 1]) {
    const world = new BoxWorld();
    world.addBlock(sign * 0.99, 10, 0, 0.48, 5);
    const sim = makeSim(world);
    const b = body();
    b.position.set(0, 10, 0);
    b.orientation.identity();
    b.angularVelocity.set(0, 0, 0);
    b.velocity.set(sign * 0.6, -8, 0);
    sim.add(b);
    for (let i = 0; i < 12 && world.blocks[0].alive; i += 1) sim.step(STEP);
    assert.equal(world.blocks[0].alive, false);
    assert.ok(b.velocity.y > 3, `should hop up, vy=${b.velocity.y}`);
  }
});

test('handle contacts never mine, head contacts do', () => {
  const headWorld = new BoxWorld();
  headWorld.addBlock(0, 12, 0, 0.48, 20);
  const headSim = makeSim(headWorld);
  const head = body();
  head.position.set(0, 14.6, 0);
  headDown(head);
  head.angularVelocity.set(0, 0, 0);
  head.velocity.set(0, -9, 0);
  headSim.add(head);

  const handleWorld = new BoxWorld();
  handleWorld.addBlock(0, 12, 0, 0.48, 20);
  const handleSim = makeSim(handleWorld);
  const handle = body();
  handle.position.set(0, 14.6, 0);
  handle.orientation.identity();
  handle.angularVelocity.set(0, 0, 0);
  handle.velocity.set(0, -9, 0);
  handleSim.add(handle);

  for (let i = 0; i < 80; i += 1) {
    headSim.step(STEP);
    handleSim.step(STEP);
  }
  assert.ok(headSim.stats.head > 0, 'head contact should register as a strike');
  assert.ok(handleSim.stats.handleContacts > 0, 'handle contact should register');
  assert.equal(handleSim.stats.head, 0, 'handle-first landings must not mine');
  assert.ok(headWorld.blocks[0].health < 20, 'head hit should damage the block');
  assert.equal(handleWorld.blocks[0].health, 20, 'handle hits should not damage at all');
});

test('moderate head impacts damage a block without instantly destroying it', () => {
  const world = new BoxWorld();
  world.addBlock(0, 12, 0, 0.48, 65);
  const sim = makeSim(world);
  const b = body();
  b.position.set(0, 13.3, 0);
  headDown(b);
  b.angularVelocity.set(0, 0, 0);
  b.velocity.set(0, -8, 0);
  sim.add(b);
  for (let i = 0; i < 30; i += 1) sim.step(STEP);
  assert.equal(world.blocks[0].alive, true);
  assert.ok(world.blocks[0].health < 65, 'it should still take damage');
  assert.ok(sim.stats.head >= 1 && sim.stats.head <= 3, `contacts: ${sim.stats.head}`);
});

test('the pickaxe settles on the floor and sleeps', () => {
  const sim = makeSim(new BoxWorld());
  const b = body();
  b.position.set(0, 8, 0);
  b.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI + 0.45);
  b.angularVelocity.set(0, 0, 2.2);
  sim.add(b);
  for (let i = 0; i < 120 * 12; i += 1) sim.step(STEP);
  assert.ok(b.sleeping, 'should be asleep after 12 s');
  assert.ok(b.position.y > -0.2, `must not sink through the floor (y=${b.position.y})`);
  assert.ok(Math.abs(b.position.z) <= b.halfDepth + 1e-9, 'must stay inside its lane');
});

test('many independent bodies stay finite, inside their lane and settle', () => {
  let seed = 29;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const sim = makeSim(new BoxWorld());
  for (let i = 0; i < 24; i += 1) {
    const b = body();
    b.position.set((rand() - 0.5) * 6, 6 + rand() * 3, (rand() - 0.5) * 0.2);
    b.planeZ = b.position.z;
    b.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI + (rand() - 0.5) * 1.8);
    b.angularVelocity.set(0, 0, (rand() - 0.5) * 6);
    sim.add(b);
  }
  for (let i = 0; i < 120 * 30; i += 1) sim.step(STEP);
  for (const b of sim.all) {
    assert.ok(Number.isFinite(b.position.length()));
    assert.ok(b.position.y > -0.2, `body sank to ${b.position.y}`);
    assert.ok(b.velocity.length() <= tuning.maxVelocity + 1e-3);
    assert.ok(Math.abs(b.orientation.length() - 1) < 1e-6);
    assert.ok(Math.abs(b.position.z - b.planeZ) <= b.halfDepth + 1e-9);
  }
  const sleeping = sim.all.filter((b) => b.sleeping).length;
  console.log(`  settled: ${sleeping}/24`);
  assert.ok(sleeping >= 20, `only ${sleeping}/24 slept`);
});

test('tool probes are sparse and carry the landmark names', () => {
  for (const id of ['wooden', 'iron', 'crystal']) {
    const def = TOOL_BY_ID[id];
    const probes = buildToolProbes(def, def.scale);
    assert.ok(probes.length <= 14, `${id} has ${probes.length} probes`);
    assert.ok(probes.length >= 8, `${id} has only ${probes.length} probes`);
    const names = probes.map((p) => p.name);
    for (const want of ['HEAD_LEFT', 'HEAD_CENTER', 'HEAD_RIGHT', 'HANDLE_END']) {
      assert.ok(names.includes(want), `${id} is missing ${want}`);
    }
    assert.ok(probes.some((p) => p.kind === 'head'));
    assert.ok(probes.some((p) => p.kind === 'handle'));
  }
});
