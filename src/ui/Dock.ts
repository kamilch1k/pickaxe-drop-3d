import { TOOLS, type ToolDef } from '../content/tools';
import { Progression } from '../progression/Progression';
import { formatNumber } from '../utils/math';
import { el } from './dom';

export interface DockCallbacks {
  onSelect(def: ToolDef): void;
  onBuy(def: ToolDef): void;
  onDenied(): void;
}

interface Chip {
  def: ToolDef;
  root: HTMLElement;
  cd: HTMLElement;
  price: HTMLElement;
  name: HTMLElement;
}

export class Dock {
  private chips: Chip[] = [];
  private unlockedCount = -1;

  constructor(
    private root: HTMLElement,
    private prog: Progression,
    private icons: Map<string, string>,
    private cb: DockCallbacks,
  ) {
    this.rebuild();
  }

  rebuild(): void {
    this.root.replaceChildren();
    this.chips = [];
    let index = 0;
    for (const def of TOOLS) {
      if (!this.prog.toolVisible(def)) continue;
      const unlocked = this.prog.toolUnlocked(def.id);
      const chip = el('button', 'tool-chip');
      chip.dataset.id = def.id;
      chip.style.setProperty('--chip-accent', def.accent);
      chip.style.pointerEvents = 'auto';

      const icon = el('img') as HTMLImageElement;
      const src = this.icons.get(def.id);
      const canvas = el('canvas');
      canvas.width = 108;
      canvas.height = 108;
      if (src) {
        icon.src = src;
        icon.style.width = '54px';
        icon.style.height = '54px';
        icon.style.imageRendering = 'auto';
        chip.appendChild(icon);
      } else {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = def.accent;
          ctx.beginPath();
          ctx.arc(54, 54, 26, 0, Math.PI * 2);
          ctx.fill();
        }
        chip.appendChild(canvas);
      }

      const name = el('span', 'name', def.name);
      chip.appendChild(name);
      const cd = el('div', 'cd');
      chip.appendChild(cd);
      const price = el('span', 'price');
      chip.appendChild(price);

      if (unlocked) {
        index++;
        const key = el('span', 'key', String(index));
        chip.appendChild(key);
      } else {
        chip.classList.add('locked');
      }

      chip.addEventListener('click', () => {
        if (this.prog.toolUnlocked(def.id)) {
          this.cb.onSelect(def);
        } else if (this.prog.coins >= def.price) {
          this.cb.onBuy(def);
        } else {
          this.cb.onDenied();
          chip.animate(
            [
              { transform: 'translateX(0)' },
              { transform: 'translateX(-5px)' },
              { transform: 'translateX(5px)' },
              { transform: 'translateX(0)' },
            ],
            { duration: 220 },
          );
        }
      });

      this.root.appendChild(chip);
      this.chips.push({ def, root: chip, cd, price, name });
    }
    this.unlockedCount = this.prog.unlocked.size;
  }

  /** Number of currently visible chips (used for keyboard shortcuts). */
  get visibleTools(): ToolDef[] {
    return this.chips.map((c) => c.def);
  }

  selectByIndex(i: number): void {
    const chip = this.chips[i];
    if (!chip) return;
    if (this.prog.toolUnlocked(chip.def.id)) this.cb.onSelect(chip.def);
  }

  refresh(): void {
    if (this.unlockedCount !== this.prog.unlocked.size) this.rebuild();
    let selected: HTMLElement | null = null;
    for (const chip of this.chips) {
      const unlocked = this.prog.toolUnlocked(chip.def.id);
      const isSelected = this.prog.selected === chip.def.id;
      if (isSelected && !chip.root.classList.contains('selected')) selected = chip.root;
      chip.root.classList.toggle('selected', isSelected);
      chip.root.classList.toggle('locked', !unlocked);
      if (!unlocked) {
        const afford = this.prog.coins >= chip.def.price;
        chip.price.textContent = `${formatNumber(chip.def.price)}`;
        chip.price.classList.toggle('cant', !afford);
        chip.price.style.display = 'block';
      } else {
        chip.price.style.display = 'none';
      }
    }
    if (selected) selected.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  updateCooldowns(getCool: (id: string) => number): void {
    for (const chip of this.chips) {
      const t = getCool(chip.def.id);
      const k = t > 0 ? t / chip.def.cooldown : 0;
      chip.cd.style.transform = `scaleY(${Math.min(1, k).toFixed(3)})`;
      chip.cd.style.opacity = k > 0 ? '1' : '0';
    }
  }
}
