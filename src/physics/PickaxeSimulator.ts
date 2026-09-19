import { Object3D, Quaternion, Vector3 } from 'three';

/**
 * PickaxeSimulator - a deliberately specialised physics toy for falling
 * pickaxes. This is NOT a rigid body engine: it only does
 *
 *   fall -> spin -> sweep -> impact -> bounce -> angular response
 *        -> destroy -> penetrate -> stick -> sleep
 *
 * Everything is written with plain vector/quaternion maths so the same formulas
 * can be re-implemented in Luau for the Roblox version later. The only Three.js
 * types used here are math classes; nothing in this file touches the renderer,
 * the scene graph (beyond writing the visual Object3D transform) or any physics
 * engine.
 *
 * Collision querying lives behind the CollisionWorld interface, so the voxel
 * grid can be swapped for a raycast adapter (or Luau `workspace:Raycast`)
 * without touching the simulation.
 */

// ----------------------------------------------------------------- tuning ---

export interface PickaxeTuning {
  gravity: number;
  fixedDelta: number;
  mass: number;
  inverseInertia: number;
  linearDrag: number;
  angularDrag: number;
  initialSpinMin: number;
  initialSpinMax: number;
  alignmentStrength: number;
  maxVelocity: number;
  maxAngularVelocity: number;
  headRestitution: number;
  handleRestitution: number;
  groundRestitution: number;
  /** |impact speed| below which restitution is ignored (kills resting jitter) */
  minBounceSpeed: number;
  /**
   * Extra exponential damping applied to slow (resting) contacts, per second.
   * Real contacts are lossy; without this a spinning pickaxe can skate on the
   * floor far longer than looks good, and sleeping never kicks in.
   */
  contactDamping: number;
  friction: number;
  headDamageMultiplier: number;
  handleDamageMultiplier: number;
  penetrationEnergyThreshold: number;
  penetrationVelocityLoss: number;
  stickMinSpeed: number;
  stickAlignmentThreshold: number;
  stickProbability: number;
  sleepLinearThreshold: number;
  sleepAngularThreshold: number;
  sleepDelay: number;
}

export const DEFAULT_PICKAXE_TUNING: PickaxeTuning = {
  gravity: -27,
  fixedDelta: 1 / 120,
  mass: 1,
  inverseInertia: 0.35,
  linearDrag: 0.01,
  angularDrag: 0.14,
  initialSpinMin: 2.5,
  initialSpinMax: 6,
  alignmentStrength: 10,
  maxVelocity: 90,
  maxAngularVelocity: 16,
  headRestitution: 0.16,
  handleRestitution: 0.46,
  groundRestitution: 0.3,
  minBounceSpeed: 1.5,
  contactDamping: 2.6,
  friction: 0.62,
  headDamageMultiplier: 1,
  handleDamageMultiplier: 0.05,
  penetrationEnergyThreshold: 22,
  penetrationVelocityLoss: 0.2,
  stickMinSpeed: 8,
  stickAlignmentThreshold: 0.58,
  stickProbability: 0.22,
  sleepLinearThreshold: 0.35,
  sleepAngularThreshold: 0.8,
  sleepDelay: 0.4,
};

// ---------------------------------------------------------------- probes ---

export type ProbeKind = 'head' | 'handle';

export interface CollisionProbe {
	name: string;
	kind: ProbeKind;
	/** local-space offset from the pickaxe origin */
	local: Vector3;
}

/**
 * Fallback probe set, used when a caller does not sample probes off its own
 * model (the game does - see physics/ToolProbes.ts).
 */
export const PICKAXE_PROBES: CollisionProbe[] = [
  { name: 'HEAD_LEFT', kind: 'head', local: new Vector3(-0.46, 0.47, 0) },
  { name: 'HEAD_CENTER', kind: 'head', local: new Vector3(0, 0.5, 0) },
  { name: 'HEAD_RIGHT', kind: 'head', local: new Vector3(0.46, 0.42, 0) },
  { name: 'HANDLE_MIDDLE', kind: 'handle', local: new Vector3(-0.05, -0.25, 0) },
  { name: 'HANDLE_END', kind: 'handle', local: new Vector3(-0.13, -0.6, 0) },
];

// ------------------------------------------------------------- collision ---

export interface SweepHit {
	/** 0..1 along the swept segment */
	t: number;
	point: Vector3;
	normal: Vector3;
	/** true when the hit belongs to the mineable voxel grid */
	destructible: boolean;
	/** 0..1; higher is tougher. Used for penetration checks. */
	resistance: number;
	/** world position of the block, so the game can carve it */
	voxelCenter?: Vector3;
	voxelId?: number;
	/** optional node behind the hit, e.g. a mesh or a part */
	node?: unknown;
}

/**
 * The only contact with the outside world. Implement it with a voxel DDA first,
 * a Three.js raycaster as a fallback, and a `workspace:Raycast` version in the
 * Roblox port - the simulation below never knows the difference.
 */
export interface CollisionWorld {
	sweepSegment(start: Vector3, end: Vector3): SweepHit | null;
}

// ---------------------------------------------------------------- events ---

export type ImpactQuality =
	| 'PERFECT_HEAD_HIT'
	| 'HEAD_HIT'
	| 'SIDE_HIT'
	| 'HANDLE_HIT'
	| 'GLANCING_HIT';

export interface ImpactEvent {
	body: PickaxeBody;
	quality: ImpactQuality;
	probe: string;
	probeKind: ProbeKind;
	point: Vector3;
	normal: Vector3;
	normalSpeed: number;
	energy: number;
	destructible: boolean;
	/** 0..1 toughness of the thing that was hit */
	resistance: number;
	damage: number;
	destroyed: boolean;
	/** angular speed right after the response */
	spun: number;
	/**
	 * Translation that would put the contact probe exactly on the surface.
	 * Applied when the hit survives; skipped when the block breaks so the tool
	 * actually travels through the crater instead of being rewound onto it.
	 */
	correction: Vector3;
	/** the block that was struck, when the hit came from the voxel grid */
	voxelCenter?: Vector3;
	voxelId?: number;
	node?: unknown;
}

export interface SimulatorHooks {
	onImpact?: (event: ImpactEvent) => void;
	onVoxelDamage?: (event: ImpactEvent) => void;
	/**
	 * Called when the solver believes the struck voxel should break. The game
	 * owns destruction, so it may veto by returning `false` - the pickaxe then
	 * behaves as if the block survived (bounce / stick).
	 */
	onVoxelDestroyed?: (event: ImpactEvent) => boolean | void;
	onPickaxeStick?: (body: PickaxeBody) => void;
	onPickaxeStop?: (body: PickaxeBody) => void;
}

// ------------------------------------------------------------------ body ---

export class PickaxeBody {
	position = new Vector3();
	velocity = new Vector3();
	orientation = new Quaternion();
	angularVelocity = new Vector3();

	previousPosition = new Vector3();
	previousOrientation = new Quaternion();

	mass: number;
	inverseMass: number;
	inverseInertia: number;

	linearDrag: number;
	angularDrag: number;

	/** per-tool multipliers taken from the tool definition */
	gravityScale = 1;
	restitutionScale = 1;

	/** local head axis; the direction that should lead the fall */
	headAxis = new Vector3(0, 1, 0);

	active = true;
	sleeping = false;
	stuck = false;

	/** true once this body has touched a destructible voxel (instrumentation) */
	hasTouchedVoxel = false;

	/** gameplay payload (drop id, tool def, ...) */
	userData: Record<string, unknown> = {};

	/** last contact, kept for instrumentation and the debug view */
	readonly lastContact = {
		probe: '',
		normal: new Vector3(),
		point: new Vector3(),
		destructible: false,
		normalSpeed: 0,
	};

	private stillTime = 0;

	constructor(
		public readonly visual: Object3D,
		public readonly probes: CollisionProbe[],
		tuning: PickaxeTuning,
	) {
		this.mass = tuning.mass;
		this.inverseMass = 1 / tuning.mass;
		this.inverseInertia = tuning.inverseInertia;
		this.linearDrag = tuning.linearDrag;
		this.angularDrag = tuning.angularDrag;
	}

	/** world-space position of a probe for a given transform */
	probeWorld(probe: CollisionProbe, out: Vector3, position = this.position, orientation = this.orientation): Vector3 {
		return out.copy(probe.local).applyQuaternion(orientation).add(position);
	}

	headDirection(out: Vector3): Vector3 {
		return out.copy(this.headAxis).applyQuaternion(this.orientation).normalize();
	}

	/** Wake a sleeping body (also clears the sleep timer). */
	wake(): void {
		this.sleeping = false;
		this.stillTime = 0;
	}

	markStill(delta: number, tuning: PickaxeTuning): boolean {
		const slow = this.velocity.length() < tuning.sleepLinearThreshold
			&& this.angularVelocity.length() < tuning.sleepAngularThreshold;
		this.stillTime = slow ? this.stillTime + delta : 0;
		return this.stillTime >= tuning.sleepDelay;
	}
}

// ------------------------------------------------------------ simulator ----

export class PickaxeSimulator {
	private accumulator = 0;
	private readonly bodies: PickaxeBody[] = [];
	private readonly tmpA = new Vector3();
	private readonly tmpB = new Vector3();
	private readonly tmpC = new Vector3();
	private readonly tmpD = new Vector3();
	private readonly tmpE = new Vector3();
	private readonly tmpF = new Vector3();
	private readonly tmpQ = new Quaternion();

	constructor(
		private world: CollisionWorld,
		public tuning: PickaxeTuning,
		private hooks: SimulatorHooks = {},
	) {}

	/** debug snapshot for the visualiser: rebuilt every simulated step */
	readonly debug = {
		enabled: false,
		probePoints: [] as Vector3[],
		probePrevious: [] as Vector3[],
		sweepLines: [] as Vector3[],
		lastQuality: '' as ImpactQuality | '',
		lastPoint: new Vector3(),
		lastNormal: new Vector3(),
		/** contacts resolved since the last debugReset() */
		contacts: 0,
		contactKinds: {} as Record<string, number>,
		/** impact classifications since the last debugReset() */
		qualities: {} as Record<string, number>,
		/** classified impacts split by probe kind since the last debugReset() */
		probeKinds: {} as Record<string, number>,
		/** first contact of each body, the one that defines how a drop lands */
		firstKinds: {} as Record<string, number>,
		firstQualities: {} as Record<string, number>,
		/** first *voxel* contact of each body: how it lands on a block */
		firstVoxelKinds: {} as Record<string, number>,
		firstVoxelQualities: {} as Record<string, number>,
	};

	debugReset(): void {
		this.debug.contacts = 0;
		this.debug.contactKinds = {};
		this.debug.qualities = {};
		this.debug.probeKinds = {};
		this.debug.firstKinds = {};
		this.debug.firstQualities = {};
		this.debug.firstVoxelKinds = {};
		this.debug.firstVoxelQualities = {};
	}

	add(body: PickaxeBody): void {
		this.bodies.push(body);
	}

	remove(body: PickaxeBody): void {
		const i = this.bodies.indexOf(body);
		if (i >= 0) {
			this.bodies.splice(i, 1);
		}
	}

	get all(): readonly PickaxeBody[] {
		return this.bodies;
	}

	/** Fixed timestep with an accumulator, so the feel never depends on FPS. */
	update(frameDelta: number): void {
		this.accumulator += Math.min(frameDelta, 0.06);
		const dt = this.tuning.fixedDelta;
		let guard = 0;
		while (this.accumulator >= dt && guard < 16) {
			this.simulateStep(dt);
			this.accumulator -= dt;
			guard += 1;
		}
		if (guard >= 16) this.accumulator = 0;
	}

	/** One fixed step. Long falls are split so nothing tunnels. */
	simulateStep(dt: number): void {
		for (let i = this.bodies.length - 1; i >= 0; i -= 1) {
			const body = this.bodies[i];
			if (!body.active) {
				this.bodies.splice(i, 1);
				continue;
			}
			if (body.sleeping || body.stuck) {
				continue;
			}

			const speed = body.velocity.length();
			// keep the per-substep travel well under one voxel so a contact
			// response is never applied from inside geometry
			const travel = speed * dt;
			const substeps = Math.min(6, Math.max(1, Math.ceil(travel / 0.16)));
			const step = dt / substeps;
			let touched = false;
			for (let s = 0; s < substeps; s += 1) {
				this.integrateLinear(body, step);
				this.integrateAngular(body, step);
				const hit = this.performSweptCollision(body);
				if (hit) {
					touched = true;
					const impact = this.resolveCollision(body, hit);
					this.handlePenetration(body, impact);
				}
				if (body.stuck) {
					break;
				}
			}

			if (touched) this.applyContactDamping(body, dt);
			this.handleSleeping(body, dt);
			this.writeTransform(body);
		}
	}

	// ---------------------------------------------------------- integration --

	private integrateLinear(body: PickaxeBody, dt: number): void {
		body.previousPosition.copy(body.position);
		body.previousOrientation.copy(body.orientation);

		body.velocity.y += this.tuning.gravity * body.gravityScale * dt;

		if (body.linearDrag > 0) {
			body.velocity.multiplyScalar(Math.exp(-body.linearDrag * dt));
		}

		const max = this.tuning.maxVelocity;
		if (body.velocity.lengthSq() > max * max) {
			body.velocity.setLength(max);
		}

		body.position.addScaledVector(body.velocity, dt);
	}

	private integrateAngular(body: PickaxeBody, dt: number): void {
		this.applyAlignmentTorque(body, dt);

		if (body.angularDrag > 0) {
			body.angularVelocity.multiplyScalar(Math.exp(-body.angularDrag * dt));
		}

		const max = this.tuning.maxAngularVelocity;
		if (body.angularVelocity.lengthSq() > max * max) {
			body.angularVelocity.setLength(max);
		}

		const spin = body.angularVelocity.length();
		if (spin > 1e-5) {
			this.tmpA.copy(body.angularVelocity).multiplyScalar(1 / spin); // axis
			this.tmpQ.setFromAxisAngle(this.tmpA, spin * dt);
			body.orientation.premultiply(this.tmpQ).normalize();
		}
	}

	/**
	 * A subtle fake aerodynamic torque: gravity alone never makes a pickaxe fall
	 * head-first, and a completely random tumble looks like junk. This biases the
	 * head towards the direction of travel without ever cancelling the spin, so
	 * the tool still wobbles, overshoots and occasionally lands badly.
	 *
	 * It only acts on a genuine fall (fast downward velocity). Steered by any
	 * horizontal velocity it would feed the ground friction, which feeds it back,
	 * and pickaxes would accelerate across the arena forever.
	 */
	private applyAlignmentTorque(body: PickaxeBody, dt: number): void {
		const fall = -body.velocity.y;
		if (fall < 4) {
			return;
		}
		const gain = Math.min(1, (fall - 4) / 8);
		const speed = body.velocity.length();
		const desired = this.tmpA.copy(body.velocity).multiplyScalar(1 / speed);
		const head = body.headDirection(this.tmpB);
		const axis = this.tmpC.copy(head).cross(desired);
		body.angularVelocity.addScaledVector(axis, this.tuning.alignmentStrength * gain * dt);
	}

	/**
	 * Contacts bleed a little energy even when the impact was gentle. Applied
	 * only to slow motion so real bounces stay lively, but it guarantees a
	 * rocking / spinning pickaxe actually comes to rest instead of skating.
	 */
	private applyContactDamping(body: PickaxeBody, dt: number): void {
		const k = Math.exp(-this.tuning.contactDamping * dt);
		if (body.velocity.length() < 4) body.velocity.multiplyScalar(k);
		if (body.angularVelocity.length() < 6) body.angularVelocity.multiplyScalar(k);
	}

	// ------------------------------------------------------------ collision --

	/**
	 * Every probe is swept from where it was last step to where it is now, and
	 * the earliest hit along the whole body wins. Point-in-block tests are never
	 * used on their own: a fast pickaxe would tunnel straight through.
	 */
	private performSweptCollision(body: PickaxeBody): (SweepHit & { probe: CollisionProbe }) | null {
		const record = this.debug.enabled;
		if (record) {
			this.debug.probePoints.length = 0;
			this.debug.probePrevious.length = 0;
			this.debug.sweepLines.length = 0;
		}

		let best: (SweepHit & { probe: CollisionProbe }) | null = null;
		let bestDepth = 0;
		const from = this.tmpD;
		const to = this.tmpE;

		for (let i = 0; i < body.probes.length; i += 1) {
			const probe = body.probes[i];
			body.probeWorld(probe, from, body.previousPosition, body.previousOrientation);
			body.probeWorld(probe, to, body.position, body.orientation);

			if (record) {
				this.debug.probePrevious.push(from.clone());
				this.debug.probePoints.push(to.clone());
				this.debug.sweepLines.push(from.clone(), to.clone());
			}

			const hit = this.world.sweepSegment(from, to);
			if (!hit) {
				continue;
			}
			// How far the probe already is past the contact point. On a tie the
			// deepest probe wins: otherwise the first probe in the list (often
			// one that already sits exactly on the surface) would soak up the
			// contact forever and a buried body could never be pushed out.
			const depth = to.distanceTo(hit.point);
			if (!best || hit.t < best.t - 1e-6 || (hit.t <= best.t + 1e-6 && depth > bestDepth)) {
				best = { ...hit, probe };
				bestDepth = depth;
			}
		}

		return best;
	}

	/**
	 * Single-contact impulse response at the probe that touched:
	 *
	 *   r  = contactPoint - bodyPosition
	 *   vp = velocity + angularVelocity x r        (velocity of the contact)
	 *   vn = vp . n
	 *
	 *   j  = -(1 + e) * vn / (1/m + invI * |r x n|^2)
	 *   velocity        += n * j / m
	 *   angularVelocity += (r x n*j) * invI
	 *
	 * then the tangential part of vp gets a clamped friction impulse through the
	 * same denominator. That is the whole solver - one contact, no tensor, no
	 * iteration - but it means an off-centre hit spins the pickaxe the way it
	 * should and a spinning pickaxe does not sink into the ground.
	 */
	private resolveCollision(body: PickaxeBody, hit: SweepHit & { probe: CollisionProbe }): ImpactEvent {
		const normal = this.tmpA.copy(hit.normal).normalize();

		// r = hitPoint - centreOfMass (the authored origin is the pivot). This is
		// the rotated local offset of the probe, so it does not depend on any
		// position correction applied below.
		body.probeWorld(hit.probe, this.tmpB, body.position, body.orientation);
		const r = this.tmpC.copy(hit.point).sub(body.position);
		const correction = this.tmpF.copy(hit.point).sub(this.tmpB);

		// contact-point velocity: v + w x r
		const pointVel = this.tmpB.copy(body.angularVelocity).cross(r).add(body.velocity);
		const vn = pointVel.dot(normal);
		const head = hit.probe.kind === 'head';
		const baseRestitution = hit.destructible
			? (head ? this.tuning.headRestitution : this.tuning.handleRestitution)
			: this.tuning.groundRestitution;

		const normalSpeed = Math.max(0, -vn);
		// below the resting speed a bounce is pointless (and jitters), so the
		// normal velocity is simply cancelled
		const restitution = normalSpeed < this.tuning.minBounceSpeed ? 0 : baseRestitution * body.restitutionScale;

		if (vn < 0) {
			const rn = this.tmpD.copy(r).cross(normal);
			const denom = body.inverseMass + body.inverseInertia * rn.lengthSq();
			const j = (-(1 + restitution) * vn) / Math.max(1e-6, denom);
			body.velocity.addScaledVector(normal, j * body.inverseMass);
			// Only a real arrival spins the body. A resting contact must not:
			// the support force is balanced by contacts this one-contact solver
			// does not model, and applying its torque here pumps rotation
			// forever (a pickaxe would slowly wind itself up while lying still).
			if (normalSpeed > this.tuning.minBounceSpeed) {
				this.applyAngularImpulse(body, r, this.tmpE.copy(normal).multiplyScalar(j));
			}

			// friction on the tangent of the contact velocity
			if (this.tuning.friction > 0) {
				this.tmpE.copy(body.angularVelocity).cross(r).add(body.velocity);
				const tangent = this.tmpE.addScaledVector(normal, -this.tmpE.dot(normal));
				const tangentSpeed = tangent.length();
				if (tangentSpeed > 1e-5) {
					tangent.multiplyScalar(1 / tangentSpeed);
					const rt = this.tmpB.copy(r).cross(tangent);
					const tDenom = body.inverseMass + body.inverseInertia * rt.lengthSq();
					let jt = -tangentSpeed / Math.max(1e-6, tDenom) * this.tuning.friction;
					const maxFriction = Math.abs(j) * this.tuning.friction;
					jt = Math.max(-maxFriction, Math.min(maxFriction, jt));
					body.velocity.addScaledVector(tangent, jt * body.inverseMass);
					this.applyAngularImpulse(body, r, this.tmpD.copy(tangent).multiplyScalar(jt));
				}
			}
		}
		const energy = 0.5 * body.mass * normalSpeed * normalSpeed;
		const quality = this.classifyImpact(body, hit, normalSpeed);
		const damage = energy * (head ? this.tuning.headDamageMultiplier : this.tuning.handleDamageMultiplier);

		const event: ImpactEvent = {
			body,
			quality,
			probe: hit.probe.name,
			probeKind: hit.probe.kind,
			point: hit.point.clone(),
			normal: normal.clone(),
			normalSpeed,
			energy,
			destructible: hit.destructible,
			resistance: hit.destructible ? hit.resistance : 0,
			damage,
			destroyed: false,
			spun: body.angularVelocity.length(),
			voxelCenter: hit.voxelCenter?.clone(),
			voxelId: hit.voxelId,
			node: hit.node,
			correction: correction.clone(),
		};
		this.debug.lastQuality = quality;
		this.debug.lastPoint.copy(hit.point);
		this.debug.lastNormal.copy(normal);
		const firstContact = body.lastContact.probe === '';
		const firstVoxel = hit.destructible && !body.hasTouchedVoxel;
		if (hit.destructible) body.hasTouchedVoxel = true;
		body.lastContact.probe = hit.probe.name;
		body.lastContact.normal.copy(normal);
		body.lastContact.point.copy(hit.point);
		body.lastContact.destructible = hit.destructible;
		body.lastContact.normalSpeed = normalSpeed;
		if (this.debug.enabled) {
			this.debug.contacts += 1;
			const key = `${hit.probe.name}/${hit.destructible ? 'voxel' : 'ground'}/${normal.x.toFixed(0)},${normal.y.toFixed(0)},${normal.z.toFixed(0)}`;
			this.debug.contactKinds[key] = (this.debug.contactKinds[key] ?? 0) + 1;
			if (normalSpeed > 2) {
				this.debug.qualities[quality] = (this.debug.qualities[quality] ?? 0) + 1;
				this.debug.probeKinds[hit.probe.kind] = (this.debug.probeKinds[hit.probe.kind] ?? 0) + 1;
			}
		}
		if (firstContact && normalSpeed > 2) {
			this.debug.firstKinds[hit.probe.kind] = (this.debug.firstKinds[hit.probe.kind] ?? 0) + 1;
			this.debug.firstQualities[quality] = (this.debug.firstQualities[quality] ?? 0) + 1;
		}
		if (firstVoxel && normalSpeed > 2) {
			this.debug.firstVoxelKinds[hit.probe.kind] = (this.debug.firstVoxelKinds[hit.probe.kind] ?? 0) + 1;
			this.debug.firstVoxelQualities[quality] = (this.debug.firstVoxelQualities[quality] ?? 0) + 1;
		}
		// resting contacts are silent: only real arrivals produce an event
		if (normalSpeed > 0.25) {
			this.hooks.onImpact?.(event);
			if (hit.destructible) {
				this.hooks.onVoxelDamage?.(event);
			}
		}
		return event;
	}

	private applyAngularImpulse(body: PickaxeBody, r: Vector3, impulse: Vector3): void {
		// angularImpulse = r x impulse, scaled by the scalar inverse inertia
		const angularImpulse = this.tmpB.copy(r).cross(impulse);
		body.angularVelocity.addScaledVector(angularImpulse, body.inverseInertia);
	}

	private classifyImpact(
		body: PickaxeBody,
		hit: SweepHit & { probe: CollisionProbe },
		normalSpeed: number,
	): ImpactQuality {
		const headDirection = body.headDirection(this.tmpB).clone();
		const alignment = headDirection.dot(this.tmpC.copy(hit.normal).negate()); // 1 = dead-on
		const spin = body.angularVelocity.length();

		if (hit.probe.kind === 'handle') {
			return spin > 4 ? 'SIDE_HIT' : 'HANDLE_HIT';
		}
		if (alignment > 0.9 && normalSpeed > 12) {
			return 'PERFECT_HEAD_HIT';
		}
		if (alignment > 0.5) {
			return 'HEAD_HIT';
		}
		return normalSpeed > 10 ? 'SIDE_HIT' : 'GLANCING_HIT';
	}

	/**
	 * Destroyed blocks must not stop the pickaxe - chains of destruction are the
	 * whole point. If the hit cannot be destroyed the tool either loses speed or
	 * sticks, depending on how square and how hard the impact was.
	 */
	private handlePenetration(body: PickaxeBody, event: ImpactEvent): void {
		if (!event.destructible) {
			// solid world (arena deck): always push back out of the surface
			body.position.add(event.correction);
			return;
		}
		const gate = this.tuning.penetrationEnergyThreshold * (0.5 + event.resistance * 1.5);
		const canBreak = event.damage >= gate;
		if (canBreak) {
			const destroyed = this.hooks.onVoxelDestroyed?.(event);
			if (destroyed !== false) {
				event.destroyed = true;
				body.velocity.multiplyScalar(1 - this.tuning.penetrationVelocityLoss);
				// deliberately NO position correction: the block is gone, so the
				// pickaxe carries on through the crater it just carved. Chains of
				// destruction depend on this.
				return;
			}
		}

		// the block survived: separate the probe from the surface before the
		// stick / bounce cases settle
		body.position.add(event.correction);

		const alignment = body.headDirection(this.tmpB).dot(this.tmpC.copy(event.normal).negate());
		if (
			event.probeKind === 'head'
			&& event.normalSpeed >= this.tuning.stickMinSpeed
			&& alignment >= this.tuning.stickAlignmentThreshold
			&& Math.random() < this.tuning.stickProbability
		) {
			body.stuck = true;
			body.velocity.set(0, 0, 0);
			body.angularVelocity.set(0, 0, 0);
			// sink the head a touch into the surface
			body.position.addScaledVector(event.normal, -0.12);
			this.hooks.onPickaxeStick?.(body);
		}
	}

	private handleSleeping(body: PickaxeBody, dt: number): void {
		if (body.sleeping) return;
		if (body.markStill(dt, this.tuning)) {
			body.sleeping = true;
			body.velocity.set(0, 0, 0);
			body.angularVelocity.set(0, 0, 0);
			this.hooks.onPickaxeStop?.(body);
		}
	}

	private writeTransform(body: PickaxeBody): void {
		body.visual.position.copy(body.position);
		body.visual.quaternion.copy(body.orientation);
	}
}
