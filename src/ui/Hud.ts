import { Progression } from '../progression/Progression';
import { formatNumber } from '../utils/math';
import { el } from './dom';

export type ToastKind = 'gold' | 'cyan' | 'magenta' | 'plain';

export class Hud {
  private coinValue: HTMLElement;
  private coinPill: HTMLElement;
  private targetName: HTMLElement;
  private targetSub: HTMLElement;
  private targetBar: HTMLElement;
  private barFill: HTMLElement;
  private comboBox: HTMLElement;
  private comboCount: HTMLElement;
  private comboLabel: HTMLElement;
  private toastStack: HTMLElement;
  private prompt: HTMLElement;
  private promptBig: HTMLElement;
  private promptSmall: HTMLElement;
  private transition: HTMLElement;
  private transKicker: HTMLElement;
  private transTitle: HTMLElement;
  private transText: HTMLElement;
  private transCoins: HTMLElement;
  private displayCoins = 0;
  private comboHideTimer = 0;

  constructor(parent: HTMLElement, prog: Progression) {
    this.displayCoins = prog.coins;
    const top = el('div', 'hud-top');

    this.coinPill = el('div', 'coin-pill');
    this.coinPill.appendChild(el('div', 'coin-icon'));
    const coinCol = el('div');
    this.coinValue = el('div', 'coin-value', '0');
    coinCol.appendChild(this.coinValue);
    coinCol.appendChild(el('div', 'coin-label', 'coins'));
    this.coinPill.appendChild(coinCol);
    top.appendChild(this.coinPill);

    const bar = el('div', 'target-bar');
    this.targetName = el('div', 'target-name', 'TARGET');
    this.targetSub = el('div', 'target-sub', '0% destroyed');
    bar.appendChild(this.targetName);
    bar.appendChild(this.targetSub);
    this.targetBar = el('div', 'bar');
    this.barFill = el('div', 'fill');
    this.targetBar.appendChild(this.barFill);
    bar.appendChild(this.targetBar);
    top.appendChild(bar);

    const right = el('div', 'top-right');
    const targetsBtn = el('button', 'icon-btn clickable', '🗺');
    targetsBtn.title = 'Target log';
    targetsBtn.id = 'btn-targets';
    const settingsBtn = el('button', 'icon-btn clickable', '⚙');
    settingsBtn.title = 'Settings';
    settingsBtn.id = 'btn-settings';
    right.appendChild(targetsBtn);
    right.appendChild(settingsBtn);
    top.appendChild(right);
    parent.appendChild(top);

    const mid = el('div', 'mid-row');
    const sideCol = el('div', 'side-col');
    const upBtn = el('button', 'pill-btn clickable');
    upBtn.id = 'btn-upgrades';
    upBtn.appendChild(el('span', 'dot ready'));
    upBtn.appendChild(el('span', undefined, 'Upgrades'));
    sideCol.appendChild(upBtn);
    mid.appendChild(el('div'));
    mid.appendChild(sideCol);
    parent.appendChild(mid);

    this.comboBox = el('div');
    this.comboBox.id = 'combo';
    this.comboCount = el('div', 'count', 'x2');
    this.comboLabel = el('div', 'label', 'combo');
    this.comboBox.appendChild(this.comboCount);
    this.comboBox.appendChild(this.comboLabel);
    parent.appendChild(this.comboBox);

    this.toastStack = el('div');
    this.toastStack.id = 'toast-stack';
    parent.appendChild(this.toastStack);

    this.prompt = el('div', 'center-prompt');
    this.promptBig = el('div', 'big', 'CLICK TO DROP');
    this.promptSmall = el('div', 'small', 'Aim at the target');
    this.prompt.appendChild(this.promptBig);
    this.prompt.appendChild(this.promptSmall);
    parent.appendChild(this.prompt);

    this.transition = el('div');
    this.transition.id = 'transition';
    const inner = el('div', 'inner');
    this.transKicker = el('div', 'kicker', 'TARGET CLEARED');
    this.transTitle = el('h1', undefined, 'NEXT');
    this.transText = el('p', undefined, '');
    this.transCoins = el('div', 'coins', '');
    inner.appendChild(this.transKicker);
    inner.appendChild(this.transTitle);
    inner.appendChild(this.transText);
    inner.appendChild(this.transCoins);
    this.transition.appendChild(inner);
    parent.appendChild(this.transition);
  }

  /* ------------------------------------------------------------- elements */

  get settingsButton(): HTMLElement {
    return document.getElementById('btn-settings') as HTMLElement;
  }

  get upgradeButton(): HTMLElement {
    return document.getElementById('btn-upgrades') as HTMLElement;
  }

  get targetsButton(): HTMLElement {
    return document.getElementById('btn-targets') as HTMLElement;
  }

  get coinRect(): DOMRect {
    return this.coinPill.getBoundingClientRect();
  }

  /* ---------------------------------------------------------------- state */

  setTarget(name: string, subtitle: string, accent: string): void {
    this.targetName.textContent = name;
    this.targetSub.textContent = subtitle;
    this.targetName.style.color = accent;
    this.barFill.style.width = '0%';
  }

  setProgress(pct: number, remaining: number): void {
    this.barFill.style.width = `${(pct * 100).toFixed(1)}%`;
    this.targetSub.textContent = `${Math.floor(pct * 100)}% destroyed · ${remaining} blocks left`;
  }

  flashBar(): void {
    this.targetBar.parentElement?.classList.remove('flash');
    void this.targetBar.offsetWidth;
    this.targetBar.parentElement?.classList.add('flash');
  }

  bumpCoins(): void {
    this.coinPill.classList.remove('bump');
    void this.coinPill.offsetWidth;
    this.coinPill.classList.add('bump');
  }

  toast(text: string, kind: ToastKind = 'plain'): void {
    const node = el('div', 'toast' + (kind === 'plain' ? '' : ' ' + kind), text);
    this.toastStack.appendChild(node);
    while (this.toastStack.children.length > 4) {
      this.toastStack.removeChild(this.toastStack.firstChild!);
    }
    window.setTimeout(() => {
      node.classList.add('out');
      window.setTimeout(() => node.remove(), 400);
    }, 2600);
  }

  combo(count: number): void {
    if (count < 2) {
      this.comboBox.classList.remove('on');
      return;
    }
    this.comboCount.textContent = `x${count}`;
    this.comboLabel.textContent = count >= 8 ? 'obliteration' : count >= 5 ? 'rampage' : 'combo';
    this.comboBox.classList.add('on');
    this.comboBox.classList.remove('hit');
    void this.comboBox.offsetWidth;
    this.comboBox.classList.add('hit');
    this.comboHideTimer = 1.6;
  }

  setPrompt(big: string | null, small = ''): void {
    if (big === null) {
      this.prompt.classList.add('hidden');
      return;
    }
    this.prompt.classList.remove('hidden');
    this.promptBig.textContent = big;
    this.promptSmall.textContent = small;
  }

  showTransition(kicker: string, title: string, text: string, coins: number): void {
    this.transKicker.textContent = kicker;
    this.transTitle.textContent = title;
    this.transText.textContent = text;
    this.transCoins.textContent = coins > 0 ? `+${formatNumber(coins)} coins` : '';
    this.transition.classList.add('on');
  }

  hideTransition(): void {
    this.transition.classList.remove('on');
  }

  update(dt: number, prog: Progression): void {
    const diff = prog.coins - this.displayCoins;
    if (Math.abs(diff) < 0.6) {
      this.displayCoins = prog.coins;
    } else {
      this.displayCoins += diff * (1 - Math.exp(-9 * dt));
    }
    this.coinValue.textContent = formatNumber(this.displayCoins);
    if (this.comboHideTimer > 0) {
      this.comboHideTimer -= dt;
      if (this.comboHideTimer <= 0) this.comboBox.classList.remove('on');
    }
  }
}
