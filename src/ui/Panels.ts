import { UPGRADES, type UpgradeDef } from '../content/upgrades';
import { TARGETS } from '../content/targets';
import type { Progression } from '../progression/Progression';
import { formatNumber } from '../utils/math';
import { el } from './dom';
import * as THREE from 'three';

export interface PanelCallbacks {
  onBuyUpgrade(def: UpgradeDef): boolean;
  onToggleSetting(key: 'music' | 'sfx' | 'bloom', value: boolean): void;
  onReset(): void;
  onClose(): void;
}

const ICONS: Record<string, string> = {
  radius: '◎',
  weight: '⬒',
  arrow: '↑',
  coin: '◉',
  star: '★',
  double: '⧉',
};

export class Panels {
  private overlay: HTMLElement;
  private body: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private openKind: 'upgrades' | 'settings' | 'targets' | null = null;

  constructor(
    parent: HTMLElement,
    private prog: Progression,
    private cb: PanelCallbacks,
  ) {
    this.overlay = el('div', 'overlay');
    const panel = el('div', 'panel');
    const head = el('div', 'panel-head');
    const info = el('div');
    this.title = el('h2', undefined, 'UPGRADES');
    this.sub = el('div', 'sub', '');
    info.appendChild(this.title);
    info.appendChild(this.sub);
    head.appendChild(info);
    const close = el('button', 'close-btn clickable', '✕');
    close.addEventListener('click', () => this.close());
    head.appendChild(close);
    panel.appendChild(head);
    this.body = el('div', 'panel-body');
    panel.appendChild(this.body);
    this.overlay.appendChild(panel);
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    parent.appendChild(this.overlay);
  }

  get isOpen(): boolean {
    return this.openKind !== null;
  }

  close(): void {
    this.openKind = null;
    this.overlay.classList.remove('open');
    this.cb.onClose();
  }

  toggle(kind: 'upgrades' | 'settings' | 'targets'): void {
    if (this.openKind === kind) {
      this.close();
      return;
    }
    this.openKind = kind;
    this.render();
    this.overlay.classList.add('open');
  }

  refresh(): void {
    if (this.openKind) this.render();
  }

  private render(): void {
    if (this.openKind === 'upgrades') this.renderUpgrades();
    else if (this.openKind === 'settings') this.renderSettings();
    else if (this.openKind === 'targets') this.renderTargets();
  }

  private renderUpgrades(): void {
    this.title.textContent = 'UPGRADES';
    this.sub.textContent = `Permanent boosts · ${formatNumber(this.prog.coins)} coins available`;
    this.body.replaceChildren();
    for (const def of UPGRADES) {
      const level = this.prog.level(def.id);
      const maxed = this.prog.isMaxed(def.id);
      const cost = this.prog.costOf(def.id);
      const row = el('div', 'up-row');
      const icon = el('div', 'icon', ICONS[def.icon] ?? '◆');
      row.appendChild(icon);
      const info = el('div', 'info');
      const title = el('div', 'title');
      title.appendChild(el('span', undefined, def.name));
      title.appendChild(el('span', 'lvl', `LV ${level}${maxed ? ' · MAX' : ''}`));
      info.appendChild(title);
      info.appendChild(el('div', 'desc', def.desc(level)));
      const pips = el('div', 'pips');
      const shown = Math.min(def.max, 12);
      for (let i = 0; i < shown; i++) {
        const pip = el('i');
        if (i < (level / def.max) * shown) pip.classList.add('on');
        pips.appendChild(pip);
      }
      info.appendChild(pips);
      row.appendChild(info);
      const btn = el('button', 'buy-btn clickable');
      if (maxed) {
        btn.classList.add('max');
        btn.textContent = 'MAXED';
      } else {
        btn.textContent = `▲ ${formatNumber(cost)}`;
        if (this.prog.coins < cost) btn.classList.add('no');
      }
      btn.addEventListener('click', () => {
        if (maxed) return;
        if (this.cb.onBuyUpgrade(def)) {
          this.render();
        } else {
          btn.animate(
            [
              { transform: 'translateX(0)' },
              { transform: 'translateX(-4px)' },
              { transform: 'translateX(4px)' },
              { transform: 'translateX(0)' },
            ],
            { duration: 200 },
          );
        }
      });
      row.appendChild(btn);
      this.body.appendChild(row);
    }
  }

  private renderSettings(): void {
    this.title.textContent = 'SETTINGS';
    this.sub.textContent = 'Tune the chaos';
    this.body.replaceChildren();

    const mk = (
      label: string,
      key: 'music' | 'sfx' | 'bloom',
      value: boolean,
    ): HTMLElement => {
      const row = el('div', 'setting-row');
      row.appendChild(el('span', undefined, label));
      const toggle = el('button', 'toggle clickable' + (value ? ' on' : ''));
      toggle.addEventListener('click', () => {
        const next = !toggle.classList.contains('on');
        toggle.classList.toggle('on', next);
        this.cb.onToggleSetting(key, next);
      });
      row.appendChild(toggle);
      return row;
    };

    this.body.appendChild(mk('Music', 'music', this.prog.settings.music));
    this.body.appendChild(mk('Sound effects', 'sfx', this.prog.settings.sfx));
    this.body.appendChild(mk('Bloom / glow', 'bloom', this.prog.settings.bloom));

    const stats = el('div', 'stat-grid');
    const mkStat = (k: string, v: string) => {
      const s = el('div', 'stat');
      s.appendChild(el('div', 'k', k));
      s.appendChild(el('div', 'v', v));
      stats.appendChild(s);
    };
    this.body.appendChild(el('div', 'hint', 'CAREER STATS'));
    mkStat('Voxels destroyed', formatNumber(this.prog.stats.destroyed));
    mkStat('Coins earned', formatNumber(this.prog.stats.earned));
    mkStat('Objects dropped', formatNumber(this.prog.stats.drops));
    mkStat('Targets cleared', `${this.prog.completed}`);
    this.body.appendChild(stats);

    const reset = el('button', 'danger-btn clickable', 'Reset all progress');
    reset.addEventListener('click', () => {
      if (reset.dataset.armed === '1') {
        this.cb.onReset();
        this.close();
      } else {
        reset.dataset.armed = '1';
        reset.textContent = 'Click again to confirm';
        window.setTimeout(() => {
          reset.dataset.armed = '0';
          reset.textContent = 'Reset all progress';
        }, 2600);
      }
    });
    this.body.appendChild(reset);
  }

  private renderTargets(): void {
    this.title.textContent = 'TARGET LOG';
    this.sub.textContent = `${this.prog.completed} of ${TARGETS.length} cleared`;
    this.body.replaceChildren();
    TARGETS.forEach((t, i) => {
      const card = el('div', 'target-card');
      if (i === this.prog.targetIndex) card.classList.add('current');
      if (i > this.prog.targetIndex) card.classList.add('locked');
      const swatch = el('div', 'swatch');
      const c = new THREE.Color(t.accent);
      swatch.style.background = `linear-gradient(140deg, #${c.clone().offsetHSL(0, 0, 0.18).getHexString()}, #${c.getHexString()})`;
      card.appendChild(swatch);
      const info = el('div', 'info');
      const title = el('div', 'title');
      title.appendChild(el('span', undefined, `${i + 1}. ${t.name}`));
      if (i < this.prog.targetIndex) title.appendChild(el('span', 'lvl', 'CLEARED'));
      else if (i === this.prog.targetIndex) title.appendChild(el('span', 'lvl', 'ACTIVE'));
      info.appendChild(title);
      info.appendChild(el('div', 'desc', i > this.prog.targetIndex ? 'Locked' : t.blurb));
      card.appendChild(info);
      this.body.appendChild(card);
    });
  }
}

