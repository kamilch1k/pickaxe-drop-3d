import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Hud } from './Hud';
import { Dock } from './Dock';
import { Floats } from './Floats';
import { Panels, type PanelCallbacks } from './Panels';
import { renderToolIcons } from './ToolIcons';
import { TOOLS, type ToolDef } from '../content/tools';
import { Progression } from '../progression/Progression';
import type { CameraDirector } from '../scene/CameraDirector';
import { el } from './dom';

export interface UiCallbacks extends PanelCallbacks {
  onSelectTool(def: ToolDef): void;
  onBuyTool(def: ToolDef): void;
  onDenied(): void;
}

export class Ui {
  readonly hud: Hud;
  readonly dock: Dock;
  readonly floats: Floats;
  readonly panels: Panels;
  private upgradesReady = false;

  constructor(
    prog: Progression,
    director: CameraDirector,
    rapier: typeof RAPIER,
    cb: UiCallbacks,
  ) {
    const root = el('div');
    root.id = 'ui';
    document.body.appendChild(root);

    this.hud = new Hud(root, prog);
    this.floats = new Floats(director, document.body);

    const dockWrap = el('div', 'dock-wrap');
    const dockEl = el('div', 'dock');
    dockWrap.appendChild(dockEl);
    root.appendChild(dockWrap);

    const icons = renderToolIcons(TOOLS, rapier);
    this.dock = new Dock(dockEl, prog, icons, {
      onSelect: (def) => cb.onSelectTool(def),
      onBuy: (def) => cb.onBuyTool(def),
      onDenied: () => cb.onDenied(),
    });

    this.panels = new Panels(root, prog, {
      onBuyUpgrade: (def) => {
        const ok = cb.onBuyUpgrade(def);
        if (ok) this.markUpgradesReady(false);
        return ok;
      },
      onToggleSetting: cb.onToggleSetting,
      onReset: cb.onReset,
      onClose: cb.onClose,
    });

    this.hud.settingsButton.addEventListener('click', () => this.panels.toggle('settings'));
    this.hud.upgradeButton.addEventListener('click', () => this.panels.toggle('upgrades'));
    this.hud.targetsButton.addEventListener('click', () => this.panels.toggle('targets'));
  }

  markUpgradesReady(ready: boolean): void {
    this.upgradesReady = ready;
    const dot = this.hud.upgradeButton.querySelector('.dot');
    if (dot) dot.classList.toggle('ready', ready);
    if (ready) this.hud.toast('Upgrade available!', 'cyan');
  }

  get hasNewUpgrade(): boolean {
    return this.upgradesReady;
  }

  refreshAll(): void {
    this.dock.refresh();
    this.panels.refresh();
  }

  update(dt: number, prog: Progression, cool: (id: string) => number): void {
    this.hud.update(dt, prog);
    this.dock.updateCooldowns(cool);
  }

  floatAt(world: THREE.Vector3, text: string, color?: string, crit = false): void {
    this.floats.text(world, text, { color, crit, size: crit ? 34 : 22 });
  }
}
