import './ui/styles.css';
import { Game } from './Game';
import { must } from './ui/dom';

async function boot(): Promise<void> {
  const canvas = must<HTMLCanvasElement>('game-canvas');
  const bootEl = must('boot');
  const spinner = must('boot-spinner');
  const startBtn = must<HTMLButtonElement>('boot-start');
  const hint = must('boot-hint');

  const game = new Game(canvas);
  if (import.meta.env.DEV) {
    (window as unknown as { __game: Game }).__game = game;
  }

  try {
    hint.textContent = 'Building the arena…';
    await game.init();
  } catch (err) {
    console.error(err);
    hint.textContent = 'Something went wrong while loading. Check the console.';
    return;
  }

  spinner.style.display = 'none';
  startBtn.style.display = 'block';
  hint.textContent = 'Best with sound on · desktop & touch';
  startBtn.focus();

  let starting = false;
  const start = async () => {
    if (starting) return;
    starting = true;
    startBtn.disabled = true;
    startBtn.textContent = 'GO!';
    await game.audioSystem.start().catch(() => undefined);
    bootEl.classList.add('hide');
    window.setTimeout(() => bootEl.remove(), 600);
    window.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      void start();
    }
  };
  startBtn.addEventListener('click', () => void start());
  window.addEventListener('keydown', onKey);
}

void boot();
