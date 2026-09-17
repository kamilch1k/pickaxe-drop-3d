import type { BuilderId } from '../destruction/builders';

export interface TargetSpec {
  id: string;
  name: string;
  subtitle: string;
  blurb: string;
  builder: BuilderId;
  /** world size of a single voxel */
  voxelSize: number;
  /** multiplies every voxel's HP */
  hpScale: number;
  /** coins awarded on completion */
  completionBonus: number;
  accent: string;
  /** rough camera distance bias */
  framing: number;
}

export const TARGETS: TargetSpec[] = [
  {
    id: 'stone-chunk',
    name: 'Stone Ore Chunk',
    subtitle: 'Warm-up rock',
    blurb: 'A fat lump of stone laced with copper and coal. Crack it open.',
    builder: 'oreChunk',
    voxelSize: 0.62,
    hpScale: 1,
    completionBonus: 400,
    accent: '#9aa0a8',
    framing: 1,
  },
  {
    id: 'gold-vein',
    name: 'Gold Vein',
    subtitle: 'Shiny and soft',
    blurb: 'Gold runs through this one in thick ribbons. Gold pays well.',
    builder: 'goldVein',
    voxelSize: 0.64,
    hpScale: 1.1,
    completionBonus: 900,
    accent: '#ffc93c',
    framing: 1.05,
  },
  {
    id: 'crystal-formation',
    name: 'Crystal Formation',
    subtitle: 'It sings when struck',
    blurb: 'Emerald, ruby and a diamond core. Glows in the dark a bit.',
    builder: 'crystalFormation',
    voxelSize: 0.62,
    hpScale: 1.25,
    completionBonus: 2200,
    accent: '#6ee7ff',
    framing: 1.12,
  },
  {
    id: 'treasure-block',
    name: 'Giant Treasure Block',
    subtitle: 'A vault with a lid',
    blurb: 'Solid gold under an iron shell. Literally money.',
    builder: 'treasureBlock',
    voxelSize: 0.7,
    hpScale: 1.45,
    completionBonus: 5200,
    accent: '#ffd75e',
    framing: 1.08,
  },
  {
    id: 'meme-creature',
    name: 'THE OOGA',
    subtitle: 'He is just standing there',
    blurb: 'Enormous head, tiny legs, a crown. He does not move. He does not need to.',
    builder: 'memeCreature',
    voxelSize: 0.66,
    hpScale: 1.7,
    completionBonus: 12000,
    accent: '#ff8a3d',
    framing: 1.1,
  },
  {
    id: 'obsidian-beast',
    name: 'Obsidian Beast',
    subtitle: 'Armoured and furious',
    blurb: 'Volcanic glass plating, burning eyes, unreasonable attitude.',
    builder: 'obsidianBeast',
    voxelSize: 0.68,
    hpScale: 2.0,
    completionBonus: 26000,
    accent: '#a06cff',
    framing: 1.12,
  },
  {
    id: 'mythic-core',
    name: 'The Mythic Core',
    subtitle: 'Final experiment',
    blurb: 'A floating crystal heart held up by pillars. Everything it is made of is worth a fortune.',
    builder: 'mythicCore',
    voxelSize: 0.72,
    hpScale: 2.4,
    completionBonus: 80000,
    accent: '#ff7bf0',
    framing: 1.18,
  },
];

export function targetSpec(index: number): TargetSpec {
  return TARGETS[Math.min(index, TARGETS.length - 1)];
}
