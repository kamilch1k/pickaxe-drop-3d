export interface SaveData {
  version: number;
  coins: number;
  tools: string[];
  selected: string;
  upgrades: Record<string, number>;
  targetIndex: number;
  completed: number;
  stats: { destroyed: number; earned: number; drops: number };
  settings: { music: boolean; sfx: boolean; bloom: boolean };
}

const KEY = 'pickaxe-drop-3d.save.v1';

export const DEFAULT_SAVE: SaveData = {
  version: 1,
  coins: 0,
  tools: ['wooden'],
  selected: 'wooden',
  upgrades: {},
  targetIndex: 0,
  completed: 0,
  stats: { destroyed: 0, earned: 0, drops: 0 },
  settings: { music: true, sfx: true, bloom: true },
};

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      ...DEFAULT_SAVE,
      ...parsed,
      tools: Array.isArray(parsed.tools) && parsed.tools.length ? parsed.tools : ['wooden'],
      upgrades: parsed.upgrades ?? {},
      stats: { ...DEFAULT_SAVE.stats, ...(parsed.stats ?? {}) },
      settings: { ...DEFAULT_SAVE.settings, ...(parsed.settings ?? {}) },
      version: 1,
    };
  } catch {
    return null;
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable - the game still plays, it just will not persist */
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
