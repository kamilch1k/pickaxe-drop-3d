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
  /** voxel-space destruction radius */
  radius: number;
  /** seconds of continuous damage for drill/saw */
  channel?: number;
  channelDps?: number;
  /** fall tuning */
  spawnHeight: number;
  gravityScale: number;
  spin: number;
  /** extra lateral randomisation on spawn */
  spread: number;
  restitution: number;
  friction: number;
  angularDamping: number;
  linearDamping: number;
  /** reward modifier */
  coinBonus: number;
  /** hidden weapon multiplier shown in the shop */
  powerLabel: string;
  behavior: ToolBehavior;
  /**
   * Rolling bodies: voxels directly under the sphere are left alone so it
   * keeps its support and rolls, while everything it pushes into gets eaten.
   * Value is the world-space radius of the protected footprint.
   */
  footprint?: number;
  /** World-space radius of the body, used for rolling damage + protected zone. */
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

function pickaxeParts(headMat: ToolMaterialKey, headDensity: number, scale = 1): ToolPart[] {
  const s = scale;
  const parts: ToolPart[] = [
    { ...handle(1.32 * s, 0.11 * s) },
    // core of the head
    { kind: 'box', size: [0.34 * s, 0.24 * s, 0.26 * s], pos: [0, 0.62 * s, 0], mat: headMat, density: headDensity },
    // left blade
    { kind: 'box', size: [0.46 * s, 0.19 * s, 0.22 * s], pos: [-0.36 * s, 0.58 * s, 0], rot: [0, 0, 0.42], mat: headMat, density: headDensity },
    { kind: 'box', size: [0.3 * s, 0.14 * s, 0.19 * s], pos: [-0.66 * s, 0.47 * s, 0], rot: [0, 0, 0.78], mat: headMat, density: headDensity },
    // right blade
    { kind: 'box', size: [0.46 * s, 0.19 * s, 0.22 * s], pos: [0.36 * s, 0.58 * s, 0], rot: [0, 0, -0.42], mat: headMat, density: headDensity },
    { kind: 'box', size: [0.3 * s, 0.14 * s, 0.19 * s], pos: [0.66 * s, 0.47 * s, 0], rot: [0, 0, -0.78], mat: headMat, density: headDensity },
  ];
  return parts;
}

export const TOOLS: ToolDef[] = [
  {
    id: 'wooden',
    name: 'Wooden Pickaxe',
    tagline: 'Free forever. Chips away stone.',
    kind: 'pickaxe',
    price: 0,
    requires: 0,
    cooldown: 0.38,
    damage: 58,
    radius: 2.35,
    spawnHeight: 11,
    gravityScale: 1,
    spin: 3.4,
    spread: 0.35,
    restitution: 0.34,
    friction: 0.9,
    angularDamping: 0.1,
    linearDamping: 0.02,
    coinBonus: 1,
    powerLabel: '1x',
    behavior: 'impact',
    parts: pickaxeParts('wood', 1700, 0.92),
    accent: '#c98f4e',
  },
  {
    id: 'iron',
    name: 'Iron Pickaxe',
    tagline: 'Heavier head, deeper bite.',
    kind: 'pickaxe',
    price: 600,
    requires: 0,
    cooldown: 0.42,
    damage: 98,
    radius: 2.8,
    spawnHeight: 12,
    gravityScale: 1.05,
    spin: 3.0,
    spread: 0.3,
    restitution: 0.24,
    friction: 0.95,
    angularDamping: 0.12,
    linearDamping: 0.02,
    coinBonus: 1,
    powerLabel: '1.8x',
    behavior: 'impact',
    parts: pickaxeParts('iron', 3400, 0.98),
    accent: '#c8ccd4',
  },
  {
    id: 'golden',
    name: 'Golden Pickaxe',
    tagline: 'Greedy. Every hit pays extra.',
    kind: 'pickaxe',
    price: 2600,
    requires: 0,
    cooldown: 0.46,
    damage: 124,
    radius: 3.05,
    spawnHeight: 12,
    gravityScale: 1.05,
    spin: 3.4,
    spread: 0.3,
    restitution: 0.3,
    friction: 0.9,
    angularDamping: 0.1,
    linearDamping: 0.02,
    coinBonus: 1.45,
    powerLabel: '2.1x',
    behavior: 'impact',
    parts: pickaxeParts('gold', 4200, 1),
    accent: '#ffc93c',
  },
  {
    id: 'crystal',
    name: 'Crystal Pickaxe',
    tagline: 'Sings when it splits stone.',
    kind: 'pickaxe',
    price: 9500,
    requires: 0,
    cooldown: 0.48,
    damage: 185,
    radius: 3.55,
    spawnHeight: 13,
    gravityScale: 1.1,
    spin: 3.1,
    spread: 0.28,
    restitution: 0.26,
    friction: 0.95,
    angularDamping: 0.12,
    linearDamping: 0.02,
    coinBonus: 1.2,
    powerLabel: '3.1x',
    behavior: 'impact',
    parts: pickaxeParts('crystal', 4600, 1.06),
    accent: '#6ee7ff',
    burst: 14,
  },
  {
    id: 'anvil',
    name: 'Falling Anvil',
    tagline: 'Nearly no spin. Pure blunt mass.',
    kind: 'blunt',
    price: 17000,
    requires: 1,
    cooldown: 1.1,
    damage: 330,
    radius: 4.2,
    spawnHeight: 13,
    gravityScale: 1.15,
    spin: 0.3,
    spread: 0.2,
    restitution: 0.05,
    friction: 1,
    angularDamping: 0.7,
    linearDamping: 0.01,
    coinBonus: 1.1,
    powerLabel: '5x',
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
    tagline: 'Spins fast, keeps cutting.',
    kind: 'blunt',
    price: 28000,
    requires: 2,
    cooldown: 1.4,
    damage: 80,
    radius: 3.2,
    channel: 1.7,
    channelDps: 115,
    spawnHeight: 12,
    gravityScale: 1.15,
    spin: 26,
    spread: 0.22,
    restitution: 0.32,
    friction: 0.5,
    angularDamping: 0.02,
    linearDamping: 0,
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
    id: 'drill',
    name: 'Mega Drill',
    tagline: 'Bores in and keeps chewing.',
    kind: 'blunt',
    price: 42000,
    requires: 3,
    cooldown: 1.6,
    damage: 150,
    radius: 2.95,
    channel: 2.6,
    channelDps: 190,
    spawnHeight: 12.5,
    gravityScale: 1.1,
    spin: 9,
    spread: 0.2,
    restitution: 0.1,
    friction: 1,
    angularDamping: 0.05,
    linearDamping: 0.01,
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
    id: 'bomb',
    name: 'Blast Charge',
    tagline: 'Lob it, then stand back.',
    kind: 'projectile',
    price: 13000,
    requires: 1,
    cooldown: 2.6,
    damage: 430,
    radius: 6.6,
    spawnHeight: 10,
    gravityScale: 1.1,
    spin: 5,
    spread: 0.3,
    restitution: 0.42,
    friction: 0.7,
    angularDamping: 0.1,
    linearDamping: 0.01,
    coinBonus: 1.1,
    powerLabel: 'BOOM',
    behavior: 'explosive',
    parts: [
      { kind: 'sphere', size: [0.52], pos: [0, 0, 0], mat: 'dark', density: 2600 },
      { kind: 'cyl', size: [0.09, 0.3], pos: [0, 0.62, 0], mat: 'wood', density: 400 },
      { kind: 'sphere', size: [0.12], pos: [0, 0.82, 0], mat: 'hazard', density: 200 },
      { kind: 'box', size: [1.1, 0.12, 0.12], pos: [0, 0, 0], rot: [0, 0, 0.6], mat: 'red', density: 300, decor: true },
      { kind: 'box', size: [1.1, 0.12, 0.12], pos: [0, 0, 0], rot: [0, 0, -0.6], mat: 'red', density: 300, decor: true },
    ],
    accent: '#ff5a52',
  },
  {
    id: 'boulder',
    name: 'Rolling Boulder',
    tagline: 'Rolls the surface flat. Never digs in.',
    kind: 'blunt',
    price: 36000,
    requires: 2,
    cooldown: 3.2,
    damage: 190,
    radius: 3.4,
    channel: 8,
    channelDps: 260,
    spawnHeight: 13,
    gravityScale: 1.15,
    spin: 2.4,
    spread: 0.22,
    restitution: 0.16,
    friction: 1.35,
    angularDamping: 0.05,
    linearDamping: 0.005,
    coinBonus: 1.2,
    powerLabel: 'ROLL',
    behavior: 'roll',
    bodyRadius: 1.95,
    footprint: 1.95,
    rollSpeed: 9,
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
    id: 'rain',
    name: 'Pickaxe Rain',
    tagline: 'Fifteen pickaxes. One click.',
    kind: 'power',
    price: 150000,
    requires: 4,
    cooldown: 6,
    damage: 96,
    radius: 3.55,
    spawnHeight: 15,
    gravityScale: 1.1,
    spin: 3.6,
    spread: 0.1,
    restitution: 0.25,
    friction: 0.9,
    angularDamping: 0.1,
    linearDamping: 0.02,
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
    price: 210000,
    requires: 5,
    cooldown: 5.5,
    damage: 1500,
    radius: 11,
    spawnHeight: 16,
    gravityScale: 1.35,
    spin: 2.2,
    spread: 0.18,
    restitution: 0.18,
    friction: 0.8,
    angularDamping: 0.08,
    linearDamping: 0,
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
    price: 420000,
    requires: 6,
    cooldown: 9,
    damage: 5200,
    radius: 23,
    spawnHeight: 17,
    gravityScale: 1.2,
    spin: 2.6,
    spread: 0.14,
    restitution: 0.2,
    friction: 0.85,
    angularDamping: 0.08,
    linearDamping: 0,
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

export const TOOL_MATERIALS: Record<ToolMaterialKey, { color: string; metalness: number; roughness: number; emissive: string; emissiveIntensity: number }> = {
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
