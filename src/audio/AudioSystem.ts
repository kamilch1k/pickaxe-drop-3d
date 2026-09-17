import { clamp } from '../utils/math';

export type SoundId =
  | 'impact-stone'
  | 'impact-metal'
  | 'impact-crystal'
  | 'impact-gold'
  | 'impact-dark'
  | 'impact-organic'
  | 'impact-mythic'
  | 'impact-cloth';

const FX_TO_SOUND: Record<string, SoundId> = {
  stone: 'impact-stone',
  metal: 'impact-metal',
  crystal: 'impact-crystal',
  gold: 'impact-gold',
  dark: 'impact-dark',
  organic: 'impact-organic',
  mythic: 'impact-mythic',
  cloth: 'impact-cloth',
};

export function soundForFx(fx: string): SoundId {
  return FX_TO_SOUND[fx] ?? 'impact-stone';
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private started = false;
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private beat = 0;
  private beatDur = 0.5;
  muted = false;
  musicOn = true;

  /** Must be called from a user gesture. */
  async start(): Promise<void> {
    if (this.started) return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    await this.ctx.resume();
    this.started = true;

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.2, 2.6);
    const wet = this.ctx.createGain();
    wet.gain.value = 0.28;
    this.reverb.connect(wet);
    wet.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.85;
    this.sfxBus.connect(this.master);
    this.sfxBus.connect(this.reverb);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.3;
    this.musicBus.connect(this.master);

    this.noise = this.makeNoise(2);
    this.startMusic();
  }

  get isStarted(): boolean {
    return this.started;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /* ------------------------------------------------------------ primitives */

  private env(
    node: AudioNode,
    t0: number,
    attack: number,
    decay: number,
    peak: number,
  ): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    return g;
  }

  private tone(
    freq: number,
    t0: number,
    dur: number,
    type: OscillatorType,
    peak: number,
    dest: AudioNode,
    slideTo?: number,
  ): void {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    const g = this.env(o, t0, Math.min(0.012, dur * 0.15), dur, peak);
    g.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private noiseBurst(
    t0: number,
    dur: number,
    filterType: BiquadFilterType,
    freq: number,
    peak: number,
    dest: AudioNode,
    q = 1,
    sweepTo?: number,
  ): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1;
    const f = this.ctx!.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + dur);
    src.connect(f);
    const g = this.env(f, t0, 0.004, dur, peak);
    g.connect(dest);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  /* --------------------------------------------------------------- sounds */

  impact(fx: string, power: number): void {
    if (!this.started) return;
    const t = this.now() + 0.001;
    const p = clamp(power, 0.2, 2.4);
    const detune = 1 + (Math.random() - 0.5) * 0.14;
    const dest = this.sfxBus;
    const loud = 0.16 + p * 0.16;

    switch (fx) {
      case 'metal':
        this.noiseBurst(t, 0.28, 'bandpass', 2600 * detune, loud * 0.7, dest, 2.2);
        this.tone(880 * detune, t, 0.42, 'triangle', loud * 0.5, dest, 420);
        this.tone(1320 * detune, t, 0.24, 'sine', loud * 0.3, dest);
        break;
      case 'crystal':
        this.noiseBurst(t, 0.2, 'highpass', 3200, loud * 0.5, dest, 1.4);
        this.tone(1760 * detune, t, 0.5, 'sine', loud * 0.34, dest, 2600);
        this.tone(2640 * detune, t + 0.02, 0.36, 'sine', loud * 0.2, dest);
        this.tone(3520 * detune, t + 0.05, 0.26, 'triangle', loud * 0.12, dest);
        break;
      case 'gold':
        this.noiseBurst(t, 0.24, 'bandpass', 1800 * detune, loud * 0.6, dest, 1.8);
        this.tone(660 * detune, t, 0.3, 'triangle', loud * 0.45, dest, 990);
        this.tone(1980 * detune, t + 0.03, 0.4, 'sine', loud * 0.2, dest);
        break;
      case 'dark':
        this.noiseBurst(t, 0.5, 'lowpass', 900, loud * 1.1, dest, 1.2, 120);
        this.tone(70 * detune, t, 0.6, 'sawtooth', loud * 0.5, dest, 40);
        break;
      case 'organic':
        this.noiseBurst(t, 0.22, 'lowpass', 1400, loud * 0.9, dest, 0.9, 420);
        this.tone(180 * detune, t, 0.24, 'square', loud * 0.34, dest, 110);
        break;
      case 'mythic':
        this.noiseBurst(t, 0.3, 'bandpass', 2400, loud * 0.6, dest, 2);
        this.tone(520 * detune, t, 0.7, 'sine', loud * 0.4, dest, 1560);
        this.tone(1040 * detune, t + 0.05, 0.6, 'triangle', loud * 0.24, dest, 2600);
        break;
      case 'cloth':
        this.noiseBurst(t, 0.3, 'lowpass', 700, loud * 0.8, dest, 0.7, 200);
        break;
      default:
        this.noiseBurst(t, 0.26, 'bandpass', 1100 * detune, loud * 0.9, dest, 1.1, 300);
        this.tone(150 * detune, t, 0.22, 'sine', loud * 0.5, dest, 80);
        break;
    }
    // low thump for heavy hits
    if (p > 0.9) {
      this.tone(58, t, 0.5, 'sine', 0.16 + p * 0.12, dest, 34);
      this.noiseBurst(t, 0.5, 'lowpass', 300, 0.1 + p * 0.08, dest, 0.8, 90);
    }
  }

  whoosh(power = 1): void {
    if (!this.started) return;
    const t = this.now() + 0.001;
    this.noiseBurst(t, 0.55, 'bandpass', 380, 0.1 * power, this.sfxBus, 1.1, 1500);
  }

  explosion(power = 1): void {
    if (!this.started) return;
    const t = this.now() + 0.001;
    this.noiseBurst(t, 1.1, 'lowpass', 1800, 0.34 * power, this.sfxBus, 0.7, 90);
    this.tone(90, t, 1.2, 'sine', 0.3 * power, this.sfxBus, 30);
    this.tone(150, t + 0.02, 0.8, 'sawtooth', 0.12 * power, this.sfxBus, 42);
    this.noiseBurst(t + 0.05, 1.6, 'lowpass', 500, 0.16 * power, this.sfxBus, 0.6, 60);
  }

  coin(pitchStep = 0): void {
    if (!this.started) return;
    const t = this.now() + 0.001;
    const base = 1180 * Math.pow(1.0595, pitchStep);
    this.tone(base, t, 0.09, 'square', 0.055, this.sfxBus);
    this.tone(base * 1.5, t + 0.045, 0.12, 'square', 0.045, this.sfxBus);
  }

  uiClick(up = true): void {
    if (!this.started) return;
    const t = this.now() + 0.001;
    this.tone(up ? 540 : 380, t, 0.07, 'triangle', 0.07, this.sfxBus, up ? 760 : 260);
  }

  purchase(): void {
    if (!this.started) return;
    const t = this.now() + 0.001;
    [0, 4, 7, 12].forEach((semi, i) => {
      this.tone(440 * Math.pow(2, semi / 12), t + i * 0.055, 0.2, 'triangle', 0.07, this.sfxBus);
    });
  }

  denied(): void {
    if (!this.started) return;
    const t = this.now() + 0.001;
    this.tone(220, t, 0.14, 'square', 0.06, this.sfxBus, 160);
  }

  complete(): void {
    if (!this.started) return;
    const t = this.now() + 0.001;
    const notes = [0, 7, 12, 16, 19, 24];
    notes.forEach((s, i) => {
      const f = 330 * Math.pow(2, s / 12);
      this.tone(f, t + i * 0.09, 0.7, 'triangle', 0.09, this.sfxBus);
      this.tone(f * 2, t + i * 0.09, 0.5, 'sine', 0.04, this.sfxBus);
    });
    this.noiseBurst(t, 1.4, 'highpass', 2000, 0.12, this.sfxBus, 0.8);
  }

  upgrade(): void {
    if (!this.started) return;
    const t = this.now() + 0.001;
    this.tone(300, t, 0.5, 'sawtooth', 0.06, this.sfxBus, 900);
    [0, 5, 12].forEach((s, i) =>
      this.tone(440 * Math.pow(2, s / 12), t + 0.05 + i * 0.06, 0.5, 'triangle', 0.08, this.sfxBus),
    );
  }

  /* ---------------------------------------------------------------- music */

  private startMusic(): void {
    if (!this.ctx) return;
    this.nextNoteTime = this.ctx.currentTime + 0.2;
    const tick = () => {
      if (!this.ctx) return;
      this.schedule();
    };
    tick();
    this.musicTimer = window.setInterval(tick, 260);
  }

  private schedule(): void {
    if (!this.ctx || !this.musicOn) return;
    const chords: number[][] = [
      [220, 261.63, 329.63],
      [174.61, 220, 261.63],
      [196, 246.94, 293.66],
      [164.81, 207.65, 246.94],
    ];
    const scale = [0, 3, 5, 7, 10, 12, 15, 17];
    while (this.nextNoteTime < this.ctx.currentTime + 1.2) {
      const t = this.nextNoteTime;
      const bar = Math.floor(this.beat / 4) % chords.length;
      const chord = chords[bar];
      if (this.beat % 8 === 0) {
        // pad
        for (const f of chord) {
          const o = this.ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = f;
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.035, t + 1.1);
          g.gain.linearRampToValueAtTime(0.0001, t + 4.2);
          o.connect(g);
          g.connect(this.musicBus);
          o.start(t);
          o.stop(t + 4.4);
        }
      }
      if (this.beat % 4 === 0) {
        const bass = chord[0] / 2;
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = bass;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
        o.connect(g);
        g.connect(this.musicBus);
        o.start(t);
        o.stop(t + 1.6);
      }
      // arp / pluck
      const step = (this.beat * 3) % scale.length;
      const octave = this.beat % 5 === 0 ? 4 : 2;
      const freq = chord[0] * octave * Math.pow(2, scale[step] / 12);
      if (this.beat % 2 === 1 || Math.random() < 0.45) {
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = freq;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = ((step % 3) - 1) * 0.35;
        o.connect(g);
        g.connect(pan);
        pan.connect(this.musicBus);
        o.start(t);
        o.stop(t + 0.7);
      }
      this.beat++;
      this.nextNoteTime += this.beatDur;
      if (this.beat > 4096) this.beat = 0;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.9;
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.musicBus) this.musicBus.gain.value = on ? 0.3 : 0;
  }

  setSfx(on: boolean): void {
    if (this.sfxBus) this.sfxBus.gain.value = on ? 0.85 : 0;
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  dispose(): void {
    if (this.musicTimer) window.clearInterval(this.musicTimer);
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
