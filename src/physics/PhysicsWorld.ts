import RAPIER from '@dimforge/rapier3d-compat';

export type OwnerKind = 'target' | 'tool' | 'debris' | 'ground' | 'prop';

export interface Owner {
  kind: OwnerKind;
  ref: unknown;
  /** for tools: which compound part touched (only the head mines) */
  part?: 'head' | 'handle';
}

export interface CollisionEvent {
  a: Owner;
  b: Owner;
}

export class PhysicsWorld {
  world!: RAPIER.World;
  events!: RAPIER.EventQueue;
  RAPIER = RAPIER;
  private owners = new Map<number, Owner>();
  private ready = false;

  async init(gravityY = -27): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: gravityY, z: 0 });
    this.world.integrationParameters.numSolverIterations = 4;
    this.events = new RAPIER.EventQueue(true);
    this.ready = true;
  }

  get isReady(): boolean {
    return this.ready;
  }

  registerCollider(handle: number, owner: Owner): void {
    this.owners.set(handle, owner);
  }

  unregisterCollider(handle: number): void {
    this.owners.delete(handle);
  }

  ownerOf(handle: number): Owner | undefined {
    return this.owners.get(handle);
  }

  bodyOf(handle: number): RAPIER.RigidBody | null {
    const col = this.world.getCollider(handle);
    return col ? col.parent() : null;
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step(this.events);
  }

  /**
   * Drains collision-start and contact-force events into a single callback.
   * `force` is 0 for plain collision starts.
   */
  drain(onEvent: (a: Owner, b: Owner) => void): void {
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.owners.get(h1);
      const b = this.owners.get(h2);
      if (a && b) onEvent(a, b);
    });
  }

  /** Number of rigid-bodies currently participating in the simulation. */
  enabledBodyCount(): number {
    let n = 0;
    this.world.bodies.forEach((b) => {
      if (b.isEnabled()) n++;
    });
    return n;
  }

  removeBody(body: RAPIER.RigidBody | null | undefined): void {
    if (!body) return;
    for (let i = 0; i < body.numColliders(); i++) {
      this.unregisterCollider(body.collider(i).handle);
    }
    this.world.removeRigidBody(body);
  }

  removeCollidersOf(body: RAPIER.RigidBody): void {
    for (let i = body.numColliders() - 1; i >= 0; i--) {
      const col = body.collider(i);
      this.unregisterCollider(col.handle);
      this.world.removeCollider(col, false);
    }
  }
}
