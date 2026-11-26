/* ---------- 3D Garage — sounds, made in the browser (Web Audio) ----------
   No audio files: the engine is two detuned saw waves through a low-pass
   filter, the radio is a short original chord loop. Everything starts
   from a click, as browsers require. */
let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new AudioContext());

type Engine = { stop: () => void; rev: () => void; setTone: (kind: string) => void; setRpm: (x: number) => void };
export function startEngine(kind: string): Engine {
  const a = ac(); a.resume();
  const out = a.createGain(); out.gain.value = 0; out.connect(a.destination);
  const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 3; lp.connect(out);
  const o1 = a.createOscillator(), o2 = a.createOscillator();
  o1.type = 'sawtooth'; o2.type = 'sawtooth';
  const wob = a.createOscillator(), wobG = a.createGain(); wob.frequency.value = 9; wobG.gain.value = 3; wob.connect(wobG);
  wobG.connect(o1.frequency); wobG.connect(o2.frequency);
  o1.connect(lp); o2.connect(lp);
  let base = 42;
  const setTone = (k: string) => {
    base = k === 'sport' ? 52 : k === 'electric' ? 0 : 42;
    const t = a.currentTime;
    if (k === 'electric') { o1.type = 'sine'; o2.type = 'sine'; o1.frequency.setTargetAtTime(220, t, .2); o2.frequency.setTargetAtTime(330, t, .2); lp.frequency.setTargetAtTime(1200, t, .2); }
    else { o1.type = 'sawtooth'; o2.type = 'sawtooth'; o1.frequency.setTargetAtTime(base, t, .2); o2.frequency.setTargetAtTime(base * 2.01, t, .2); lp.frequency.setTargetAtTime(k === 'sport' ? 480 : 340, t, .2); }
  };
  setTone(kind);
  o1.start(); o2.start(); wob.start();
  // ignition: a quick rise, then idle
  const t = a.currentTime;
  out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(.22, t + .25); out.gain.linearRampToValueAtTime(.12, t + 1.2);
  return {
    setTone,
    // x: 0 (idle) → 1 (full throttle), used while driving
    setRpm: (x: number) => {
      const n = a.currentTime, k = 1 + x * 2.4;
      if (o1.type === 'sine') { o1.frequency.setTargetAtTime(220 * k, n, .08); o2.frequency.setTargetAtTime(330 * k, n, .08); }
      else { o1.frequency.setTargetAtTime(base * k, n, .08); o2.frequency.setTargetAtTime(base * 2.01 * k, n, .08); }
      out.gain.setTargetAtTime(.1 + x * .12, n, .1);
    },
    rev: () => {
      const n = a.currentTime;
      const f1 = o1.frequency, f2 = o2.frequency, peak = kind === 'electric' ? 2.2 : 2.6;
      f1.cancelScheduledValues(n); f2.cancelScheduledValues(n);
      const b1 = f1.value, b2 = f2.value;
      f1.setValueAtTime(b1, n); f2.setValueAtTime(b2, n);
      f1.linearRampToValueAtTime(b1 * peak, n + .35); f2.linearRampToValueAtTime(b2 * peak, n + .35);
      f1.setTargetAtTime(b1, n + .4, .35); f2.setTargetAtTime(b2, n + .4, .35);
      out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(out.gain.value, n);
      out.gain.linearRampToValueAtTime(.26, n + .3); out.gain.setTargetAtTime(.12, n + .45, .4);
    },
    stop: () => {
      const n = a.currentTime;
      out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(out.gain.value, n); out.gain.linearRampToValueAtTime(0, n + .5);
      setTimeout(() => { o1.stop(); o2.stop(); wob.stop(); out.disconnect(); }, 700);
    },
  };
}

/* an original four-chord loop with a soft kick, 92 bpm */
export function startRadio() {
  const a = ac(); a.resume();
  const out = a.createGain(); out.gain.value = .0; out.connect(a.destination);
  out.gain.linearRampToValueAtTime(.16, a.currentTime + .6);
  const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 207.7, 246.9]];
  const beat = 60 / 92;
  let next = a.currentTime + .1, step = 0, live = true;
  const note = (f: number, t: number, d: number, type: OscillatorType, v: number) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = f; o.connect(g); g.connect(out);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .03); g.gain.exponentialRampToValueAtTime(.001, t + d);
    o.start(t); o.stop(t + d + .05);
  };
  const kick = (t: number) => {
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + .18);
    g.gain.setValueAtTime(.5, t); g.gain.exponentialRampToValueAtTime(.001, t + .25);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + .3);
  };
  const tick = () => {
    if (!live) return;
    while (next < a.currentTime + .4) {
      const bar = Math.floor(step / 4) % 4, b = step % 4;
      if (b === 0) chords[bar].forEach(f => note(f, next, beat * 3.6, 'triangle', .12));
      if (b % 2 === 0) kick(next);
      note(chords[bar][(step * 2) % 3] * 2, next + beat / 2, beat * .45, 'sine', .06);
      next += beat; step++;
    }
    setTimeout(tick, 120);
  };
  tick();
  return () => {
    live = false;
    const n = a.currentTime;
    out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(out.gain.value, n); out.gain.linearRampToValueAtTime(0, n + .4);
    setTimeout(() => out.disconnect(), 600);
  };
}

/* ---------- Glass lab sounds ---------- */
const noiseBuffer = (a: AudioContext, seconds: number, brown = false) => {
  const b = a.createBuffer(1, a.sampleRate * seconds, a.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    d[i] = brown ? (last = (last + .02 * w) / 1.02) * 3.5 : w;
  }
  return b;
};

/** a stone on glass: a bright tick and a short crackle */
export function glassHit() {
  const a = ac(); a.resume();
  const t = a.currentTime, src = a.createBufferSource(), hp = a.createBiquadFilter(), g = a.createGain();
  src.buffer = noiseBuffer(a, .5); hp.type = 'highpass'; hp.frequency.value = 2600;
  g.gain.setValueAtTime(.55, t); g.gain.exponentialRampToValueAtTime(.001, t + .45);
  src.connect(hp); hp.connect(g); g.connect(a.destination); src.start(t); src.stop(t + .5);
  const o = a.createOscillator(), og = a.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(3200, t); o.frequency.exponentialRampToValueAtTime(1400, t + .12);
  og.gain.setValueAtTime(.18, t); og.gain.exponentialRampToValueAtTime(.001, t + .16);
  o.connect(og); og.connect(a.destination); o.start(t); o.stop(t + .2);
}

/** the new glass sets into the urethane: a soft low thud */
export function glassSet() {
  const a = ac(); a.resume();
  const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(55, t + .25);
  g.gain.setValueAtTime(.4, t); g.gain.exponentialRampToValueAtTime(.001, t + .35);
  o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + .4);
}

/** highway noise heard from the cabin. setQuiet(true) = acoustic glass (less hiss, −6 dB) */
export function startRoad() {
  const a = ac(); a.resume();
  const out = a.createGain(); out.gain.value = 0; out.connect(a.destination);
  const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; lp.connect(out);
  const rumble = a.createBufferSource(); rumble.buffer = noiseBuffer(a, 4, true); rumble.loop = true;
  const hiss = a.createBufferSource(); hiss.buffer = noiseBuffer(a, 3); hiss.loop = true;
  const hissG = a.createGain(); hissG.gain.value = .06;
  rumble.connect(lp); hiss.connect(hissG); hissG.connect(lp);
  rumble.start(); hiss.start();
  out.gain.linearRampToValueAtTime(.32, a.currentTime + .5);
  return {
    setQuiet: (q: boolean) => {
      const n = a.currentTime;
      lp.frequency.setTargetAtTime(q ? 900 : 5200, n, .15);
      out.gain.setTargetAtTime(q ? .16 : .32, n, .15);
    },
    stop: () => {
      const n = a.currentTime;
      out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(out.gain.value, n); out.gain.linearRampToValueAtTime(0, n + .3);
      setTimeout(() => { rumble.stop(); hiss.stop(); out.disconnect(); }, 400);
    },
  };
}
