export interface UpgradeDef {
  id: string;
  name: string;
  desc: (level: number) => string;
  icon: string;
  baseCost: number;
  growth: number;
  max: number;
  /** short label of the effect at a given level, for the panel header */
  valueLabel: (level: number) => string;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'power',
    name: 'Drop Power',
    icon: 'radius',
    baseCost: 220,
    growth: 1.58,
    max: 30,
    desc: () => '+11% destruction radius per level',
    valueLabel: (l) => `${(1 + l * 0.11).toFixed(2)}x`,
  },
  {
    id: 'weight',
    name: 'Impact Weight',
    icon: 'weight',
    baseCost: 300,
    growth: 1.62,
    max: 30,
    desc: () => '+10% damage per hit',
    valueLabel: (l) => `${(1 + l * 0.1).toFixed(2)}x`,
  },
  {
    id: 'height',
    name: 'Drop Height',
    icon: 'arrow',
    baseCost: 260,
    growth: 1.6,
    max: 24,
    desc: () => '+7% fall height and impact speed',
    valueLabel: (l) => `${(1 + l * 0.07).toFixed(2)}x`,
  },
  {
    id: 'greed',
    name: 'Coin Multiplier',
    icon: 'coin',
    baseCost: 400,
    growth: 1.68,
    max: 30,
    desc: () => '+16% coins from every voxel',
    valueLabel: (l) => `${(1 + l * 0.16).toFixed(2)}x`,
  },
  {
    id: 'luck',
    name: 'Fortune',
    icon: 'star',
    baseCost: 500,
    growth: 1.72,
    max: 20,
    desc: () => '+2.4% critical impact chance',
    valueLabel: (l) => `${(l * 2.4).toFixed(1)}%`,
  },
  {
    id: 'multi',
    name: 'Multi Drop',
    icon: 'double',
    baseCost: 1400,
    growth: 1.85,
    max: 14,
    desc: () => '+3.5% chance to drop a second object',
    valueLabel: (l) => `${(l * 3.5).toFixed(1)}%`,
  },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(
  UPGRADES.map((u) => [u.id, u]),
);

export function upgradeCost(def: UpgradeDef, level: number): number {
  return Math.round(def.baseCost * Math.pow(def.growth, level));
}
