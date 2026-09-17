export type PartKind = 'box' | 'cyl' | 'cone' | 'sphere';
export type ToolMaterialKey =
  | 'deepstone'
  | 'wood'
  | 'stone'
  | 'iron'
  | 'gold'
  | 'crystal'
  | 'dark'
  | 'steel'
  | 'red'
  | 'hazard'
  | 'mythic'
  | 'obsidian';

export interface ToolPart {
  kind: PartKind;
  /** box: [w,h,d] | cyl/cone: [radius, height] | sphere: [radius] */
  size: number[];
  pos: [number, number, number];
  rot?: [number, number, number];
  mat: ToolMaterialKey;
  /** collision density, kg/m^3 */
  density: number;
  /** exclude from the physics compound shape (pure decoration) */
  decor?: boolean;
}

export type ToolBehavior =
  | 'impact'
  | 'drill'
  | 'saw'
  | 'roll'
  | 'explosive'
  | 'meteor'
  | 'rain'
  | 'shower';

/**
 * How a falling tool is allowed to rotate.
 * - `planar`: keeps the tool in a fixed vertical plane facing the camera and
 *   only spins it around that plane's normal, so it flips end over end like the
 *   pickaxes in the reference game and never tips onto its side.
 * - `axial`: keeps the spawn orientation and spins around the tool's own axis
 *   (drill bits, saw blades).
 * - `free`: full rigid-body rotation (anvils, bombs, boulders, meteors).
 */
export type SpinMode = 'planar' | 'axial' | 'free';

export interface ToolDef {
  id: string;
  name: string;
  tagline: string;
  kind: 'pickaxe' | 'blunt' | 'projectile' | 'power';
  price: number;
  /** number of targets that must be completed before this shows up as purchasable */
  requires: number;
  cooldown: number;
  /** damage at the centre of the impact */
  damage: number;
  /**
   * Destruction radius expressed in *blocks* (voxels) so every tool carves the
   * same shape regardless of how big the target's blocks are.
   */
  radiusBlocks: number;
  /** seconds of continuous damage for drill/saw/roll */
  channel?: number;
  channelDps?: number;
  /** fall tuning */
  spawnHeight: number;
  gravityScale: number;
  spin: number;
  spinMode: SpinMode;
  /** extra lateral randomisation on spawn */
  spread: number;
  restitution: number;
  friction: number;
  angularDamping: number;
  linearDamping: number;
  /** uniform size multiplier applied to every part */
  scale: number;
  /** continuous collision detection - only worth it for fast/big bodies */
  ccd?: boolean;
  /** reward modifier */
  coinBonus: number;
  /** hidden weapon multiplier shown in the shop */
  powerLabel: string;
  behavior: ToolBehavior;
  /** Rolling bodies only: world radius of the protected footprint + the body. */
  bodyRadius?: number;
  /** Target speed a rolling body tries to hold, m/s. */
  rollSpeed?: number;
  /** Special payload for rain / shower behaviours */
  payload?: { tool: string; count: number; spread: number };
  parts: ToolPart[];
  /** color used on the toolbar chip */
  accent: string;
  /** extra particle burst on impact */
  burst?: number;
}

const handle = (h: number, d = 0.11, mat: ToolMaterialKey = 'wood'): ToolPart => ({
  kind: 'box',
  size: [d, h, d],
  pos: [0, 0, 0],
  mat,
  density: 380,
});

function pickaxeParts(headMat: ToolMaterialKey, headDensity: number, s = 1): ToolPart[] {
  return [
    { ...handle(1.3 * s, 0.12 * s) },
    { kind: 'box', size: [0.34 * s, 0.26 * s, 0.28 * s], pos: [0, 0.6 * s, 0], mat: headMat, density: headDensity },
    { kind: 'box', size: [0.48 * s, 0.2 * s, 0.24 * s], pos: [-0.36 * s, 0.56 * s, 0], rot: [0, 0, 0.42], mat: headMat, density: headDensity },
    { kind: 'box', size: [0.32 * s, 0.15 * s, 0.2 * s], pos: [-0.67 * s, 0.45 * s, 0], rot: [0, 0, 0.78], mat: headMat, density: headDensity },
    { kind: 'box', size: [0.48 * s, 0.2 * s, 0.24 * s], pos: [0.36 * s, 0.56 * s, 0], rot: [0, 0, -0.42], mat: headMat, density: headDensity },
    { kind: 'box', size: [0.32 * s, 0.15 * s, 0.2 * s], pos: [0.67 * s, 0.45 * s, 0], rot: [0, 0, -0.78], mat: headMat, density: headDensity },
  ];
}

export const TOOLS: ToolDef[] = [
  {
    id: 'wooden',
    name: 'Wooden Pickaxe',
    tagline: 'Free forever. Chips one block at a time.',
    kind: 'pickaxe',
    price: 0,
    requires: 0,
    cooldown: 0.16,
    damage: 42,
    radiusBlocks: 0.78,
    spawnHeight: 7.5,
    gravityScale: 1,
    spin: 4.4,
    spinMode: 'planar',
    spread: 0.3,
    restitution: 0.24,
    friction: 0.9,
    angularDamping: 0.1,
    linearDamping: 0.02,
    scale: 0.86,
    coinBonus: 1,
    powerLabel: '1x',
    behavior: 'impact',
    parts: pickaxeParts('wood', 1700, 0.92),
    accent: '#c98f4e',
  },
  {
    id: 'iron',
    name: 'Iron Pickaxe',
    tagline: 'Bites through two blocks at a time.',
    kind: 'pickaxe',
    price: 600,
    requires: 0,
    cooldown: 0.17,
    damage: 95,
    radiusBlocks: 1.3,
    spawnHeight: 8,
    gravityScale: 1.05,
    spin: 4.1,
    spinMode: 'planar',
    spread: 0.26,
    restitution: 0.2,
    friction: 0.95,
    angularDamping: 0.12,
    linearDamping: 0.02,
    scale: 0.92,
    coinBonus: 1,
    powerLabel: '2x',
    behavior: 'impact',
    parts: pickaxeParts('iron', 3400, 0.98),
    accent: '#c8ccd4',
  },
  {
    id: 'golden',
    name: 'Golden Pickaxe',
    tagline: 'Greedy. Every block pays extra.',
    kind: 'pickaxe',
    price: 4500,
    requires: 0,
    cooldown: 0.19,
    damage: 130,
    radiusBlocks: 1.6,
    spawnHeight: 8.5,
    gravityScale: 1.05,
    spin: 4.5,
    spinMode: 'planar',
    spread: 0.26,
    restitution: 0.26,
    friction: 0.9,
    angularDamping: 0.1,
    linearDamping: 0.02,
    scale: 0.96,
    coinBonus: 1.5,
    powerLabel: '3x',
    behavior: 'impact',
    parts: pickaxeParts('gold', 4200, 1),
    accent: '#ffc93c',
  },
  {
    id: 'crystal',
    name: 'Crystal Pickaxe',
    tagline: 'Sings when it splits stone.',
    kind: 'pickaxe',
    price: 14000,
    requires: 2,
    cooldown: 0.2,
    damage: 210,
    radiusBlocks: 2.0,
    spawnHeight: 9,
    gravityScale: 1.1,
    spin: 4.2,
    spinMode: 'planar',
    spread: 0.24,
    restitution: 0.22,
    friction: 0.95,
    angularDamping: 0.12,
    linearDamping: 0.02,
    scale: 1.02,
    coinBonus: 1.25,
    powerLabel: '4x',
    behavior: 'impact',
    parts: pickaxeParts('crystal', 4600, 1.06),
    accent: '#6ee7ff',
    burst: 14,
  },
  {
    id: 'bomb',
    name: 'Blast Charge',
    tagline: 'Lob it, then stand back.',
    kind: 'projectile',
    price: 3000,
    requires: 1,
    cooldown: 2.2,
    damage: 520,
    radiusBlocks: 4.6,
    spawnHeight: 7.5,
    gravityScale: 1.1,
    spin: 5,
    spinMode: 'free',
    spread: 0.3,
    restitution: 0.42,
    friction: 0.7,
    angularDamping: 0.1,
    linearDamping: 0.01,
    scale: 0.7,
    ccd: true,
    coinBonus: 1.1,
    powerLabel: 'BOOM',
    behavior: 'explosive',
    parts: [
      { kind: 'sphere', size: [0.42], pos: [0, 0, 0], mat: 'dark', density: 2600 },
      { kind: 'cyl', size: [0.08, 0.26], pos: [0, 0.5, 0], mat: 'wood', density: 400 },
      { kind: 'sphere', size: [0.1], pos: [0, 0.68, 0], mat: 'hazard', density: 200 },
      { kind: 'box', size: [0.9, 0.1, 0.1], pos: [0, 0, 0], rot: [0, 0, 0.6], mat: 'red', density: 300, decor: true },
      { kind: 'box', size: [0.9, 0.1, 0.1], pos: [0, 0, 0], rot: [0, 0, -0.6], mat: 'red', density: 300, decor: true },
    ],
    accent: '#ff5a52',
  },
  {
    id: 'anvil',
    name: 'Falling Anvil',
    tagline: 'Nearly no spin. Pure blunt mass.',
    kind: 'blunt',
    price: 22000,
    requires: 3,
    cooldown: 0.6,
    damage: 420,
    radiusBlocks: 2.9,
    spawnHeight: 9.5,
    gravityScale: 1.15,
    spin: 0.35,
    spinMode: 'free',
    spread: 0.18,
    restitution: 0.05,
    friction: 1,
    angularDamping: 0.7,
    linearDamping: 0.01,
    scale: 0.7,
    coinBonus: 1.1,
    powerLabel: '7x',
    behavior: 'impact',
    parts: [
      { kind: 'box', size: [1.15, 0.34, 0.62], pos: [0, 0.16, 0], mat: 'iron', density: 7200 },
      { kind: 'box', size: [0.66, 0.3, 0.5], pos: [0, -0.16, 0], mat: 'iron', density: 7200 },
      { kind: 'box', size: [0.98, 0.22, 0.56], pos: [0, -0.42, 0], mat: 'iron', density: 7200 },
      { kind: 'box', size: [0.34, 0.2, 0.34], pos: [0, -0.62, 0], mat: 'iron', density: 7200 },
      { kind: 'box', size: [0.4, 0.12, 0.3], pos: [-0.72, 0.16, 0], mat: 'steel', density: 7200 },
    ],
    accent: '#9aa4b2',
  },
  {
    id: 'saw',
    name: 'Buzzsaw Disc',
    tagline: 'Spins flat out and keeps chewing.',
    kind: 'blunt',
    price: 30000,
    requires: 3,
    cooldown: 0.9,
    damage: 90,
    radiusBlocks: 1.7,
    channel: 1.8,
    channelDps: 260,
    spawnHeight: 8.5,
    gravityScale: 1.15,
    spin: 24,
    spinMode: 'axial',
    spread: 0.2,
    restitution: 0.3,
    friction: 0.5,
    angularDamping: 0.02,
    linearDamping: 0,
    scale: 0.62,
    coinBonus: 1.15,
    powerLabel: '6x',
    behavior: 'saw',
    parts: [
      { kind: 'cyl', size: [0.82, 0.13], pos: [0, 0, 0], mat: 'steel', density: 3200 },
      { kind: 'cyl', size: [0.3, 0.18], pos: [0, 0, 0], mat: 'hazard', density: 2600 },
      ...Array.from({ length: 8 }, (_, i): ToolPart => {
        const a = (i / 8) * Math.PI * 2;
        return {
          kind: 'box',
          size: [0.2, 0.14, 0.13],
          pos: [Math.cos(a) * 0.86, 0, Math.sin(a) * 0.86],
          rot: [0, -a, 0],
          mat: 'hazard',
          density: 3000,
        };
      }),
    ],
    accent: '#ffdd33',
  },
  {
    id: 'boulder',
    name: 'Rolling Boulder',
    tagline: 'Rolls the surface flat. Never digs in.',
    kind: 'blunt',
    price: 38000,
    requires: 4,
    cooldown: 2.6,
    damage: 260,
    radiusBlocks: 2.6,
    channel: 9,
    channelDps: 900,
    spawnHeight: 9,
    gravityScale: 1.15,
    spin: 2.4,
    spinMode: 'free',
    spread: 0.2,
    restitution: 0.16,
    friction: 1.35,
    angularDamping: 0.05,
    linearDamping: 0.005,
    scale: 0.62,
    ccd: true,
    coinBonus: 1.2,
    powerLabel: 'ROLL',
    behavior: 'roll',
    bodyRadius: 1.95,
    rollSpeed: 5.5,
    parts: [
      { kind: 'sphere', size: [1.95], pos: [0, 0, 0], mat: 'stone', density: 900 },
      { kind: 'box', size: [1.5, 0.55, 0.62], pos: [0, 0.5, 0.9], rot: [0.3, 0, 0], mat: 'iron', density: 900, decor: true },
      { kind: 'box', size: [0.7, 0.5, 0.72], pos: [1.2, -0.4, 0.7], rot: [-0.4, 0.8, 0.2], mat: 'deepstone', density: 900, decor: true },
      { kind: 'box', size: [0.86, 0.6, 0.6], pos: [-1.05, 0.7, -0.8], rot: [0.5, 0.3, 0.9], mat: 'stone', density: 900, decor: true },
      { kind: 'box', size: [0.6, 0.66, 0.7], pos: [-0.4, -1.3, 0.9], rot: [0.9, 0.4, 0.3], mat: 'gold', density: 900, decor: true },
    ],
    accent: '#b9a37e',
  },
  {
    id: 'drill',
    name: 'Mega Drill',
    tagline: 'Bores in and keeps chewing.',
    kind: 'blunt',
    price: 50000,
    requires: 4,
    cooldown: 1.1,
    damage: 170,
    radiusBlocks: 1.6,
    channel: 2.6,
    channelDps: 320,
    spawnHeight: 8.5,
    gravityScale: 1.1,
    spin: 9,
    spinMode: 'axial',
    spread: 0.18,
    restitution: 0.1,
    friction: 1,
    angularDamping: 0.05,
    linearDamping: 0.01,
    scale: 0.72,
    coinBonus: 1.2,
    powerLabel: '9x',
    behavior: 'drill',
    parts: [
      { kind: 'cyl', size: [0.4, 0.9], pos: [0, 0.55, 0], mat: 'steel', density: 5200 },
      { kind: 'cyl', size: [0.52, 0.34], pos: [0, 0.05, 0], mat: 'hazard', density: 5200 },
      { kind: 'cone', size: [0.4, 1.1], pos: [0, -0.5, 0], rot: [Math.PI, 0, 0], mat: 'steel', density: 6000 },
      { kind: 'box', size: [0.9, 0.16, 0.16], pos: [0, 0.95, 0], mat: 'iron', density: 4200 },
    ],
    accent: '#8be0ff',
  },
  {
    id: 'rain',
    name: 'Pickaxe Rain',
    tagline: 'Fifteen pickaxes. One click.',
    kind: 'power',
    price: 90000,
    requires: 5,
    cooldown: 6,
    damage: 210,
    radiusBlocks: 2.0,
    spawnHeight: 11,
    gravityScale: 1.1,
    spin: 4.6,
    spinMode: 'planar',
    spread: 0.1,
    restitution: 0.22,
    friction: 0.9,
    angularDamping: 0.1,
    linearDamping: 0.02,
    scale: 1.02,
    coinBonus: 1.25,
    powerLabel: 'RAIN',
    behavior: 'rain',
    payload: { tool: 'crystal', count: 15, spread: 4.6 },
    parts: pickaxeParts('crystal', 4600, 1.06),
    accent: '#7cf2d0',
  },
  {
    id: 'meteor',
    name: 'Meteor',
    tagline: 'A rock from orbit. Nothing survives.',
    kind: 'projectile',
    price: 160000,
    requires: 5,
    cooldown: 5,
    damage: 1800,
    radiusBlocks: 9,
    spawnHeight: 13,
    gravityScale: 1.35,
    spin: 2.2,
    spinMode: 'free',
    spread: 0.16,
    restitution: 0.18,
    friction: 0.8,
    angularDamping: 0.08,
    linearDamping: 0,
    scale: 0.85,
    ccd: true,
    coinBonus: 1.3,
    powerLabel: 'MASSIVE',
    behavior: 'meteor',
    parts: [
      { kind: 'sphere', size: [1.25], pos: [0, 0, 0], mat: 'dark', density: 4200, decor: true },
      { kind: 'box', size: [1.6, 1.5, 1.55], pos: [0.1, 0.05, 0], rot: [0.5, 0.4, 0.3], mat: 'obsidian', density: 4200 },
      { kind: 'box', size: [1.3, 1.35, 1.4], pos: [-0.25, 0.35, 0.1], rot: [-0.3, 0.9, 0.4], mat: 'deepstone', density: 4200 },
      { kind: 'box', size: [0.75, 0.8, 0.8], pos: [0.7, -0.5, -0.4], rot: [0.8, 0.2, 0.7], mat: 'stone', density: 4200 },
      { kind: 'box', size: [0.5, 0.5, 0.5], pos: [-0.6, -0.6, 0.5], rot: [0.2, 0.6, 0.9], mat: 'stone', density: 4200 },
    ],
    accent: '#ff8a3d',
    burst: 26,
  },
  {
    id: 'nuke',
    name: 'NUCLEAR PICKAXE',
    tagline: 'It was never really about mining.',
    kind: 'power',
    price: 320000,
    requires: 6,
    cooldown: 9,
    damage: 6000,
    radiusBlocks: 19,
    spawnHeight: 14,
    gravityScale: 1.2,
    spin: 2.6,
    spinMode: 'planar',
    spread: 0.14,
    restitution: 0.2,
    friction: 0.85,
    angularDamping: 0.08,
    linearDamping: 0,
    scale: 3.4,
    ccd: true,
    coinBonus: 1.6,
    powerLabel: 'Ω',
    behavior: 'meteor',
    parts: [
      ...pickaxeParts('mythic', 9000, 2.35),
      { kind: 'sphere', size: [0.55], pos: [0, 1.5, 0], mat: 'mythic', density: 500, decor: true },
      { kind: 'sphere', size: [0.34], pos: [0, -1.6, 0], mat: 'hazard', density: 500, decor: true },
    ],
    accent: '#ff7bf0',
    burst: 40,
  },
];

export const TOOL_BY_ID: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

export const TOOL_MATERIALS: Record<
  ToolMaterialKey,
  { color: string; metalness: number; roughness: number; emissive: string; emissiveIntensity: number }
> = {
  wood: { color: '#a9713d', metalness: 0.0, roughness: 0.85, emissive: '#000000', emissiveIntensity: 0 },
  stone: { color: '#9aa0a8', metalness: 0.05, roughness: 0.9, emissive: '#000000', emissiveIntensity: 0 },
  iron: { color: '#c8ccd4', metalness: 0.5, roughness: 0.34, emissive: '#000000', emissiveIntensity: 0 },
  gold: { color: '#ffc93c', metalness: 0.55, roughness: 0.22, emissive: '#4a3000', emissiveIntensity: 0.5 },
  crystal: { color: '#6ee7ff', metalness: 0.3, roughness: 0.1, emissive: '#0e5f7d', emissiveIntensity: 1.3 },
  dark: { color: '#2a2340', metalness: 0.25, roughness: 0.55, emissive: '#2a0f52', emissiveIntensity: 0.5 },
  steel: { color: '#8b949f', metalness: 0.6, roughness: 0.28, emissive: '#000000', emissiveIntensity: 0 },
  red: { color: '#e04a4a', metalness: 0.1, roughness: 0.6, emissive: '#3a0000', emissiveIntensity: 0.4 },
  hazard: { color: '#ffdd33', metalness: 0.2, roughness: 0.5, emissive: '#4a3a00', emissiveIntensity: 0.6 },
  mythic: { color: '#ff7bf0', metalness: 0.5, roughness: 0.16, emissive: '#8a1e9c', emissiveIntensity: 1.6 },
  deepstone: { color: '#6a6d76', metalness: 0.06, roughness: 0.92, emissive: '#000000', emissiveIntensity: 0 },
  obsidian: { color: '#2f2444', metalness: 0.35, roughness: 0.32, emissive: '#2a0f52', emissiveIntensity: 0.6 },
};
