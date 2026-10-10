// All sound is synthesised with Web Audio: no files to download.
// Painting plays notes from a pentatonic scale, so any sequence sounds good.

const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private musicTimer = 0;
  private chordIndex = 0;
  private cursor = 0;
  private root = 261.63;
  enabled = true;
  private musicOn = true;

  private musicStarted = false;

  /**
   * Sound starts on the first touch (browsers block audio before one): only
   * a cheap resume then, as everything was prepared at load (see prepare).
   */
  unlock() {
    this.prepare();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    if (!this.musicStarted) {
      this.musicStarted = true;
      this.startMusic();
    }
  }

  /**
   * Build the audio graph (context, reverb, noise) ahead of time, while the
   * game loads: creating it is slow, and doing it on the first swipe made
   * that first move start late. The context waits, suspended, for unlock.
   */
  prepare() {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.enabled ? 0.8 : 0;
    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? 0.22 : 0;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.reverb.connect(wet).connect(this.master);
    this.sfx.connect(this.master);
    this.sfx.connect(this.reverb);
    this.music.connect(this.master);
    this.music.connect(this.reverb);
    this.noise = this.noiseBuffer();
  }

  /** Sound effects on or off (music has its own switch). */
  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ctx) this.sfx.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (this.ctx) this.music.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.2);
  }

  /** Duck everything (e.g. while an ad plays or the tab is hidden). */
  setMuted(muted: boolean) {
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  setRoot(hz: number) {
    this.root = hz;
  }

  resetMelody() {
    this.cursor = 0;
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
    }
    return buf;
  }

  private noiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private ready(): AudioContext | null {
    // Not before the first touch: sounds queued on a suspended context
    // would all burst out at once when it starts.
    return this.ctx && this.enabled && this.musicStarted ? this.ctx : null;
  }

  private note(freq: number, when: number, dur: number, gain: number, type: OscillatorType = 'sine', dest?: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    o2.type = 'sine';
    o2.frequency.value = freq * 2.001;
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(dest ?? this.sfx);
    o.start(when);
    o2.start(when);
    o.stop(when + dur + 0.05);
    o2.stop(when + dur + 0.05);
  }

  private scaleFreq(step: number): number {
    const octave = Math.floor(step / PENTA.length);
    return this.root * PENTA[((step % PENTA.length) + PENTA.length) % PENTA.length] * 2 ** octave;
  }

  /** One soft pluck per painted tile, climbing the scale. */
  paintTile() {
    const ctx = this.ready();
    if (!ctx) return;
    const step = this.cursor % 11;
    this.cursor++;
    this.note(this.scaleFreq(step + 3), ctx.currentTime, 0.5, 0.085, 'triangle');
  }

  /** Rolling whoosh that lasts the whole slide. */
  launch(durMs = 200) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = Math.max(0.12, durMs / 1000);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(380, t);
    bp.frequency.exponentialRampToValueAtTime(1600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.03);
    g.gain.setValueAtTime(0.1, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    src.connect(bp).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 0.4, dur + 0.12);
  }

  thock(strength = 1) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.14);
    g.gain.setValueAtTime(0.38 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.2);
    // Wet squish on top.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.Q.value = 1.4;
    lp.frequency.setValueAtTime(1300, t);
    lp.frequency.exponentialRampToValueAtTime(420, t + 0.12);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16 * strength, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    src.connect(lp).connect(ng).connect(this.sfx);
    src.start(t, Math.random() * 0.5, 0.16);
  }

  bump() {
    const ctx = this.ready();
    if (!ctx) return;
    this.note(110, ctx.currentTime, 0.12, 0.08, 'sine');
  }

  /**
   * The saw slicing the ball, heard in slow motion: a bright metallic shing
   * with a ringing tail over a deep boom whose pitch sinks away.
   */
  slice() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(5200, t);
    bp.frequency.exponentialRampToValueAtTime(1700, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    src.connect(bp).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 0.3, 0.6);
    this.note(1320, t, 0.7, 0.045, 'sine');
    this.note(1980, t + 0.01, 0.5, 0.025, 'sine');
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.95);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.34, t + 0.03);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    o.connect(og).connect(this.sfx);
    o.start(t);
    o.stop(t + 1.1);
  }

  /** Stopper studs clamping onto the ball: a short, firm double snap. */
  grip() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.note(196, t, 0.07, 0.11, 'triangle');
    this.note(this.scaleFreq(11), t + 0.035, 0.06, 0.04, 'sine');
  }

  click() {
    const ctx = this.ready();
    if (!ctx) return;
    this.note(this.scaleFreq(9), ctx.currentTime, 0.12, 0.05, 'sine');
  }

  /** Rising arpeggio and shimmer for a finished level. */
  complete() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [0, 2, 4, 5, 7, 10].forEach((s, i) => this.note(this.scaleFreq(s + 5), t + i * 0.075, 1.4, 0.085, 'triangle'));
    [15, 17, 19].forEach((s, i) => this.note(this.scaleFreq(s), t + 0.5 + i * 0.06, 1.8, 0.03, 'sine'));
  }

  star(i: number) {
    const ctx = this.ready();
    if (!ctx) return;
    this.note(this.scaleFreq(10 + i * 2), ctx.currentTime, 0.9, 0.08, 'triangle');
    this.note(this.scaleFreq(15 + i * 2), ctx.currentTime + 0.03, 0.9, 0.025, 'sine');
  }

  /**
   * A soft bell: a sine with a few gentle overtones, rounded off by a
   * lowpass, a quick bloom and a long fade (and the shared reverb).
   */
  private bell(freq: number, when: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(7000, freq * 5);
    for (const [ratio, amp] of [[1, 1], [2, 0.26], [3, 0.1], [4.2, 0.04]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(when);
      o.stop(when + dur + 0.05);
    }
    g.connect(lp).connect(this.sfx);
  }

  /** A key picked up on the board: two bright, gentle bells. */
  keyGet() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.bell(this.scaleFreq(12), t, 0.9, 0.06);
    this.bell(this.scaleFreq(16), t + 0.07, 1, 0.035);
  }

  // ---- The Safe: calm, bell-like sounds throughout.

  /** The Safe slides in: a quiet rising shimmer. */
  vaultAppear() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [7, 9, 11, 14].forEach((s, i) => this.bell(this.scaleFreq(s), t + i * 0.1, 1.8, 0.025));
  }

  /** A key slides into a lock: a small tink. */
  vaultKey() {
    const ctx = this.ready();
    if (!ctx) return;
    this.bell(this.scaleFreq(15), ctx.currentTime, 0.35, 0.03);
  }

  /** The key turns: two soft, muted ticks. */
  vaultTurn() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.note(196, t, 0.07, 0.05, 'sine');
    this.note(247, t + 0.11, 0.08, 0.045, 'sine');
  }

  /** The lock springs open: a warm chime. */
  vaultOpen() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.bell(this.scaleFreq(9), t, 1.4, 0.05);
    this.bell(this.scaleFreq(12), t + 0.05, 1.2, 0.028);
  }

  /** A prize dot fills: one bell, a step higher for each dot. */
  vaultDot(i: number) {
    const ctx = this.ready();
    if (!ctx) return;
    this.bell(this.scaleFreq(11 + i * 2), ctx.currentTime, 1.2, 0.045);
  }

  /** A prize is won: an unhurried bell arpeggio over a warm low note. */
  vaultWin() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [0, 2, 4, 7, 9].forEach((s, i) => this.bell(this.scaleFreq(s + 7), t + i * 0.12, 2.2, 0.04));
    this.note(this.scaleFreq(0), t, 2.6, 0.03, 'sine');
  }

  coin() {
    const ctx = this.ready();
    if (!ctx) return;
    this.note(this.scaleFreq(14), ctx.currentTime, 0.18, 0.04, 'square');
  }

  // Slow evolving pad: four chords, long attacks, very quiet.
  private startMusic() {
    const chords = [
      [0, 2, 4, 7],
      [-2, 1, 3, 5],
      [-1, 2, 4, 6],
      [-3, 0, 2, 5],
    ];
    const play = () => {
      const ctx = this.ctx;
      if (!ctx) return;
      const t = ctx.currentTime + 0.05;
      const chord = chords[this.chordIndex++ % chords.length];
      for (const s of chord) {
        const f = this.scaleFreq(s) / 2;
        for (const detune of [-4, 4]) {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = f;
          o.detune.value = detune;
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 900;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.05, t + 2.5);
          g.gain.linearRampToValueAtTime(0.04, t + 5.5);
          g.gain.linearRampToValueAtTime(0, t + 8.5);
          o.connect(lp).connect(g).connect(this.music);
          o.start(t);
          o.stop(t + 8.6);
        }
      }
    };
    play();
    this.musicTimer = window.setInterval(play, 7000);
  }

  dispose() {
    window.clearInterval(this.musicTimer);
    void this.ctx?.close();
  }
}
