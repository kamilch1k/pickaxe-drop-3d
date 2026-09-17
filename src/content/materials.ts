export type FxKind =
  | 'stone'
  | 'metal'
  | 'crystal'
  | 'gold'
  | 'dark'
  | 'organic'
  | 'mythic'
  | 'cloth';

export interface VoxelMaterialDef {
  id: string;
  /** Coins awarded per voxel. */
  value: number;
  /** Hitpoints per voxel. */
  hardness: number;
  /** Representative color used for particles, UI pips and instance tinting. */
  color: number;
  /** Primary texture color. */
  base: string;
  /** Secondary / speckle colors, painted as pixel noise. */
  speck: string[];
  speckDensity: number;
  /** Edge darkening amount for the per-voxel border. */
  edge: number;
  roughness: number;
  metalness: number;
  emissive?: number;
  emissiveIntensity?: number;
  fx: FxKind;
  /** Ambient glow halo rendered around the voxel (for valuable ores). */
  halo?: number;
}

const M = (d: VoxelMaterialDef): VoxelMaterialDef => d;

export const MATERIALS: Record<string, VoxelMaterialDef> = {
  stone: M({
    id: 'stone',
    value: 1,
    hardness: 11,
    color: 0x8d8f96,
    base: '#7d8089',
    speck: ['#6b6e76', '#8d929b', '#5f626a', '#949aa4', '#6f7278'],
    speckDensity: 0.5,
    edge: 0.1,
    roughness: 0.95,
    metalness: 0.0,
    fx: 'stone',
  }),
  deepstone: M({
    id: 'deepstone',
    value: 2,
    hardness: 15,
    color: 0x6c6f78,
    base: '#5c606a',
    speck: ['#4e525b', '#6b707b', '#454952', '#767b86'],
    speckDensity: 0.55,
    edge: 0.12,
    roughness: 0.95,
    metalness: 0.02,
    fx: 'stone',
  }),
  coal: M({
    id: 'coal',
    value: 3,
    hardness: 13,
    color: 0x2c2f36,
    base: '#3a3f4b',
    speck: ['#2b3038', '#4c525f', '#22262d', '#5b6270'],
    speckDensity: 0.5,
    edge: 0.16,
    roughness: 0.8,
    metalness: 0.12,
    fx: 'stone',
  }),
  copper: M({
    id: 'copper',
    value: 5,
    hardness: 18,
    color: 0xd07a3c,
    base: '#c47338',
    speck: ['#e08d4d', '#a75f2a', '#f0a262', '#8e4d20'],
    speckDensity: 0.42,
    edge: 0.18,
    roughness: 0.5,
    metalness: 0.42,
    fx: 'metal',
  }),
  iron: M({
    id: 'iron',
    value: 6,
    hardness: 22,
    color: 0xc9cdd6,
    base: '#b9bdc6',
    speck: ['#d7dbe3', '#9aa0aa', '#e6e9ef'],
    speckDensity: 0.4,
    edge: 0.16,
    roughness: 0.42,
    metalness: 0.45,
    fx: 'metal',
  }),
  gold: M({
    id: 'gold',
    value: 12,
    hardness: 20,
    color: 0xffc93c,
    base: '#e8b331',
    speck: ['#ffe07a', '#c8912a', '#fff0b0', '#a87420'],
    speckDensity: 0.4,
    edge: 0.14,
    roughness: 0.28,
    metalness: 0.5,
    emissive: 0x6b4400,
    emissiveIntensity: 0.75,
    fx: 'gold',
    halo: 0.16,
  }),
  emerald: M({
    id: 'emerald',
    value: 22,
    hardness: 28,
    color: 0x36e07a,
    base: '#2fc46c',
    speck: ['#6ef7a5', '#1d9a51', '#b6ffd2', '#158a48'],
    speckDensity: 0.4,
    edge: 0.16,
    roughness: 0.24,
    metalness: 0.35,
    emissive: 0x0d5c2c,
    emissiveIntensity: 0.9,
    fx: 'crystal',
    halo: 0.3,
  }),
  ruby: M({
    id: 'ruby',
    value: 30,
    hardness: 32,
    color: 0xf23a5a,
    base: '#dc2f4e',
    speck: ['#ff7d92', '#a01a33', '#ffc0cc', '#8d1128'],
    speckDensity: 0.4,
    edge: 0.16,
    roughness: 0.22,
    metalness: 0.35,
    emissive: 0x6b0c1e,
    emissiveIntensity: 0.95,
    fx: 'crystal',
    halo: 0.34,
  }),
  diamond: M({
    id: 'diamond',
    value: 45,
    hardness: 40,
    color: 0x63e9ff,
    base: '#54d8f5',
    speck: ['#c4f8ff', '#2fa8cf', '#ffffff', '#1c86ad'],
    speckDensity: 0.4,
    edge: 0.14,
    roughness: 0.14,
    metalness: 0.4,
    emissive: 0x0f5f7d,
    emissiveIntensity: 1.15,
    fx: 'crystal',
    halo: 0.4,
  }),
  obsidian: M({
    id: 'obsidian',
    value: 38,
    hardness: 70,
    color: 0x3a2a52,
    base: '#2f2444',
    speck: ['#4a3568', '#1b1330', '#6b4f96', '#120c22'],
    speckDensity: 0.45,
    edge: 0.3,
    roughness: 0.35,
    metalness: 0.3,
    emissive: 0x2a0f52,
    emissiveIntensity: 0.75,
    fx: 'dark',
    halo: 0.28,
  }),
  mythic: M({
    id: 'mythic',
    value: 95,
    hardness: 95,
    color: 0xff7bf0,
    base: '#e05fd6',
    speck: ['#ffd6ff', '#a02fb0', '#7ef6ff', '#6a1a86'],
    speckDensity: 0.45,
    edge: 0.14,
    roughness: 0.18,
    metalness: 0.5,
    emissive: 0x8a1e9c,
    emissiveIntensity: 1.5,
    fx: 'mythic',
    halo: 0.5,
  }),

  // ---------------------------------------------------------------- creature
  fur: M({
    id: 'fur',
    value: 6,
    hardness: 14,
    color: 0xff8a3d,
    base: '#f07f34',
    speck: ['#ffa860', '#c66020', '#ffc48f', '#a94b12'],
    speckDensity: 0.5,
    edge: 0.18,
    roughness: 0.9,
    metalness: 0.0,
    fx: 'organic',
  }),
  furDark: M({
    id: 'furDark',
    value: 7,
    hardness: 16,
    color: 0xcf5f22,
    base: '#b8521c',
    speck: ['#d97a38', '#8c3a10', '#f09a5a'],
    speckDensity: 0.5,
    edge: 0.2,
    roughness: 0.9,
    metalness: 0.0,
    fx: 'organic',
  }),
  cloth: M({
    id: 'cloth',
    value: 4,
    hardness: 12,
    color: 0x2b2f45,
    base: '#262a3d',
    speck: ['#383e56', '#181b28', '#4a5170'],
    speckDensity: 0.45,
    edge: 0.22,
    roughness: 0.92,
    metalness: 0.0,
    fx: 'cloth',
  }),
  eye: M({
    id: 'eye',
    value: 25,
    hardness: 18,
    color: 0xffffff,
    base: '#f6f7fb',
    speck: ['#ffffff', '#dfe4ee', '#c9d2e4'],
    speckDensity: 0.3,
    edge: 0.1,
    roughness: 0.28,
    metalness: 0.0,
    emissive: 0x2a2a3a,
    emissiveIntensity: 0.25,
    fx: 'organic',
  }),
  pupil: M({
    id: 'pupil',
    value: 26,
    hardness: 18,
    color: 0x14161f,
    base: '#101218',
    speck: ['#242833', '#05060a'],
    speckDensity: 0.35,
    edge: 0.2,
    roughness: 0.2,
    metalness: 0.05,
    fx: 'organic',
  }),
  teeth: M({
    id: 'teeth',
    value: 5,
    hardness: 20,
    color: 0xf2f4e8,
    base: '#e9ecd8',
    speck: ['#ffffff', '#cfd3bb'],
    speckDensity: 0.3,
    edge: 0.12,
    roughness: 0.5,
    metalness: 0.0,
    fx: 'organic',
  }),
  tongue: M({
    id: 'tongue',
    value: 6,
    hardness: 10,
    color: 0xff5f7a,
    base: '#ee4f6d',
    speck: ['#ff8fa3', '#c93450'],
    speckDensity: 0.4,
    edge: 0.15,
    roughness: 0.7,
    metalness: 0.0,
    fx: 'organic',
  }),
  crown: M({
    id: 'crown',
    value: 40,
    hardness: 26,
    color: 0xffd75e,
    base: '#f3c542',
    speck: ['#fff2b0', '#c8981f', '#ffffff'],
    speckDensity: 0.35,
    edge: 0.12,
    roughness: 0.24,
    metalness: 0.5,
    emissive: 0x6b4a00,
    emissiveIntensity: 1.0,
    fx: 'gold',
    halo: 0.22,
  }),
  candy: M({
    id: 'candy',
    value: 15,
    hardness: 16,
    color: 0xff7fd0,
    base: '#f56ec4',
    speck: ['#ffb3e3', '#c93f96', '#ffffff'],
    speckDensity: 0.45,
    edge: 0.16,
    roughness: 0.4,
    metalness: 0.05,
    emissive: 0x51103c,
    emissiveIntensity: 0.4,
    fx: 'crystal',
    halo: 0.14,
  }),
  slime: M({
    id: 'slime',
    value: 9,
    hardness: 12,
    color: 0x6ef07a,
    base: '#5fd96b',
    speck: ['#a6ffb0', '#37a544', '#d6ffda'],
    speckDensity: 0.5,
    edge: 0.16,
    roughness: 0.45,
    metalness: 0.05,
    emissive: 0x1e5c26,
    emissiveIntensity: 0.6,
    fx: 'organic',
    halo: 0.12,
  }),
};

export const MATERIAL_IDS = Object.keys(MATERIALS);

/**
 * Global economy scale. Materials are authored with small relative values
 * (stone = 1, gold = 12 ...) which keeps them readable; this multiplier turns
 * them into satisfying payouts per voxel.
 */
export const COIN_SCALE = 12;

export function materialIndexOf(id: string): number {
  return MATERIAL_IDS.indexOf(id);
}

export function materialById(id: string): VoxelMaterialDef {
  return MATERIALS[id] ?? MATERIALS.stone;
}
