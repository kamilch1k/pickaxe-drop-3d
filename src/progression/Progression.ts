import { TOOL_BY_ID, TOOLS, type ToolDef } from '../content/tools';
import { TARGETS } from '../content/targets';
import { UPGRADE_BY_ID, upgradeCost } from '../content/upgrades';
import { DEFAULT_SAVE, clearSave, loadSave, writeSave, type SaveData } from './SaveSystem';

export type ProgressionEvent =
  | { type: 'coins' }
  | { type: 'tools' }
  | { type: 'upgrades' }
  | { type: 'target' }
  | { type: 'reset' };

export type SettingKey = 'music' | 'sfx' | 'bloom';

export class Progression {
  coins = 0;
  unlocked = new Set<string>(['wooden']);
  upgrades: Record<string, number> = {};
  selected = 'wooden';
  targetIndex = 0;
  completed = 0;
  stats = { destroyed: 0, earned: 0, drops: 0 };
  settings = { music: true, sfx: true, bloom: true };

  private listeners: ((e: ProgressionEvent) => void)[] = [];
  private saveTimer: number | null = null;

  static load(): Progression {
    const p = new Progression();
    const data = loadSave() ?? DEFAULT_SAVE;
    p.coins = data.coins;
    p.unlocked = new Set(data.tools.length ? data.tools : ['wooden']);
    p.unlocked.add('wooden');
    p.selected = p.unlocked.has(data.selected) ? data.selected : 'wooden';
    p.upgrades = { ...data.upgrades };
    p.targetIndex = Math.min(data.targetIndex, TARGETS.length - 1);
    p.completed = data.completed ?? 0;
    p.stats = { ...DEFAULT_SAVE.stats, ...data.stats };
    p.settings = { ...DEFAULT_SAVE.settings, ...data.settings };
    return p;
  }

  on(fn: (e: ProgressionEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(e: ProgressionEvent): void {
    for (const fn of this.listeners) fn(e);
    this.queueSave();
  }

  private queueSave(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 400);
  }

  save(): void {
    const data: SaveData = {
      version: 1,
      coins: Math.floor(this.coins),
      tools: [...this.unlocked],
      selected: this.selected,
      upgrades: this.upgrades,
      targetIndex: this.targetIndex,
      completed: this.completed,
      stats: this.stats,
      settings: this.settings,
    };
    writeSave(data);
  }

  /* ------------------------------------------------------------ accessors */

  get tool(): ToolDef {
    return TOOL_BY_ID[this.selected] ?? TOOLS[0];
  }

  level(id: string): number {
    return this.upgrades[id] ?? 0;
  }

  get radiusMul(): number {
    return 1 + this.level('power') * 0.11;
  }

  get damageMul(): number {
    return 1 + this.level('weight') * 0.1;
  }

  get heightMul(): number {
    return 1 + this.level('height') * 0.07;
  }

  get coinMul(): number {
    return 1 + this.level('greed') * 0.16;
  }

  get critChance(): number {
    return Math.min(0.55, this.level('luck') * 0.024);
  }

  get multiChance(): number {
    return Math.min(0.5, this.level('multi') * 0.035);
  }

  costOf(id: string): number {
    const def = UPGRADE_BY_ID[id];
    if (!def) return Infinity;
    return upgradeCost(def, this.level(id));
  }

  isMaxed(id: string): boolean {
    const def = UPGRADE_BY_ID[id];
    return !!def && this.level(id) >= def.max;
  }

  toolUnlocked(id: string): boolean {
    return this.unlocked.has(id);
  }

  toolAvailable(def: ToolDef): boolean {
    return this.unlocked.has(def.id);
  }

  toolVisible(def: ToolDef): boolean {
    return this.completed >= def.requires;
  }

  /* -------------------------------------------------------------- actions */

  addCoins(amount: number): void {
    if (amount <= 0) return;
    this.coins += amount;
    this.stats.earned += amount;
    this.emit({ type: 'coins' });
  }

  noteDestroyed(n: number): void {
    this.stats.destroyed += n;
  }

  noteDrop(): void {
    this.stats.drops++;
  }

  buyTool(def: ToolDef): boolean {
    if (this.unlocked.has(def.id)) return false;
    if (this.coins < def.price) return false;
    this.coins -= def.price;
    this.unlocked.add(def.id);
    this.selected = def.id;
    this.emit({ type: 'tools' });
    this.emit({ type: 'coins' });
    return true;
  }

  selectTool(id: string): boolean {
    if (!this.unlocked.has(id)) return false;
    this.selected = id;
    this.emit({ type: 'tools' });
    return true;
  }

  buyUpgrade(id: string): boolean {
    if (this.isMaxed(id)) return false;
    const cost = this.costOf(id);
    if (this.coins < cost) return false;
    this.coins -= cost;
    this.upgrades[id] = this.level(id) + 1;
    this.emit({ type: 'upgrades' });
    this.emit({ type: 'coins' });
    return true;
  }

  completeTarget(): void {
    this.completed++;
    this.targetIndex = Math.min(this.targetIndex + 1, TARGETS.length - 1);
    this.emit({ type: 'target' });
  }

  setSetting(key: SettingKey, value: boolean): void {
    this.settings[key] = value;
    this.queueSave();
  }

  reset(): void {
    clearSave();
    this.coins = 0;
    this.unlocked = new Set(['wooden']);
    this.upgrades = {};
    this.selected = 'wooden';
    this.targetIndex = 0;
    this.completed = 0;
    this.stats = { destroyed: 0, earned: 0, drops: 0 };
    this.emit({ type: 'reset' });
  }
}
