/* =========================================================
   Glass Lab — data and rules.
   The visitor shows where the glass got hit, describes the damage,
   watches what happens if they wait, then builds the replacement
   glass like a configurator (base glass + add-ons) and installs it.
   Prices are demo prices for this concept site.
   ========================================================= */
import type { GlassId } from './site';

export type CrackKind = 'bullseye' | 'star' | 'combo' | 'edge' | 'line';
export type Weather = 'sun' | 'frost' | 'wash' | 'pothole';
export type StepId = 'impact' | 'damage' | 'time' | 'glass' | 'install' | 'build';

export const lab = {
  kicker: 'Glass lab',
  title: 'Break it.\n*Build it back.*',
  intro: 'Click the exact spot where the stone hit. Then describe it, see what happens if you wait, and build the glass that replaces it.',
  steps: [
    { id: 'impact', label: 'Impact' },
    { id: 'damage', label: 'Damage' },
    { id: 'time', label: 'If you wait' },
    { id: 'glass', label: 'Your glass' },
    { id: 'install', label: 'Install' },
    { id: 'build', label: 'Your build' },
  ] as { id: StepId; label: string }[],
  impact: {
    title: 'Where did it hit?',
    text: 'Click the glass, right where the stone landed. Any window works: windshield, side windows, rear glass.',
    hint: 'Click the glass · drag to turn',
    again: 'Click again to move the impact.',
  },
  kinds: [
    { id: 'bullseye', label: 'Bullseye', hint: 'A round dark circle' },
    { id: 'star', label: 'Star', hint: 'Short legs around the impact' },
    { id: 'combo', label: 'Combination', hint: 'A bullseye with legs' },
    { id: 'edge', label: 'Edge crack', hint: 'Starts near the frame' },
    { id: 'line', label: 'Long crack', hint: 'A line that runs' },
  ] as { id: CrackKind; label: string; hint: string }[],
  weather: [
    { id: 'sun', label: 'Hot sun', factor: 1.35 },
    { id: 'frost', label: 'Freezing night', factor: 1.7 },
    { id: 'wash', label: 'Car wash', factor: 1.2 },
    { id: 'pothole', label: 'Potholes', factor: 1.5 },
  ] as { id: Weather; label: string; factor: number }[],
  timeTitle: 'What if you wait?',
  timeText: 'A chip is a crack waiting to happen. Move the days and pick the weather: this is a simulation of how damage usually spreads.',
  glassTitle: 'Build your glass',
  addonsTitle: 'Add to it',
  install: { cta: 'Install it', running: 'Installing', steps: ['Old glass out', 'Frame cleaned and primed', 'Urethane bead', 'New glass set', 'Camera recalibrated'] },
  build: { title: 'Your build', share: 'Copy the link', copied: 'Link copied', shot: 'Save a picture', book: 'Book this', again: 'Start over' },
  under: 'Under the hood',
  rain: 'Rain test',
  hear: 'Hear the road',
  next: 'Next',
  back: 'Back',
  note: 'Demo prices · concept project',
};

/* ---------- Size: inches on a log-ish slider ---------- */
export const sizeMin = .25, sizeMax = 14;
export const sizeLabel = (inch: number) => inch < 1 ? `${Math.round(inch * 4) / 4}″` : `${inch.toFixed(inch < 4 ? 1 : 0)}″`;

/* ---------- Where the glass is tempered (side, rear): it never gets repaired ---------- */
export const tempered = (g: GlassId) => g !== 'windshield';

/* ---------- How the damage grows with time (simulation for the story, not physics) ---------- */
export function grow(kind: CrackKind, inch: number, days: number, weather: Weather[]) {
  const f = weather.reduce((m, w) => m * (lab.weather.find(x => x.id === w)!.factor), 1);
  const speed = kind === 'line' || kind === 'edge' ? .09 : kind === 'combo' ? .05 : kind === 'star' ? .04 : .02;
  const grown = inch * (1 + speed * f * Math.pow(days, .85));
  // a chip turns into a running crack once it has grown enough
  const runner = kind === 'line' || kind === 'edge' ? 1 : Math.max(0, Math.min(1, (grown - 1.1) / 3));
  return { inch: Math.min(sizeMax * 1.6, grown), runner };
}

/* ---------- The verdict: repair or replace, and why ---------- */
export type Verdict = { repair: boolean; title: string; why: string; price: number };
export function verdict(glass: GlassId, kind: CrackKind, inch: number, runner: number, inView: boolean, nearEdge: boolean): Verdict {
  if (tempered(glass)) return { repair: false, title: 'Replace', price: 0, why: 'Side and rear glass is tempered. It cannot be repaired: it gets replaced.' };
  if (runner > .35 || kind === 'line') return { repair: false, title: 'Replace', price: 0, why: 'A running crack keeps spreading. A resin repair would not hold.' };
  if (kind === 'edge' || nearEdge) return { repair: false, title: 'Replace', price: 0, why: 'Damage near the frame weakens the whole glass.' };
  if (inView && inch > .75) return { repair: false, title: 'Replace', price: 0, why: 'It is in the driver’s line of sight. A repair would leave a mark right where you look.' };
  if (inch > 1.25) return { repair: false, title: 'Replace', price: 0, why: 'Bigger than a quarter: too large for a resin repair.' };
  return { repair: true, title: 'Repair', price: 79, why: 'Small and away from the edge: resin fills it in 30 minutes and keeps your factory seal.' };
}

/* ---------- The catalogue ---------- */
export type Base = { id: string; name: string; price: number; text: string; tags: string[]; tint: string; opacity: number; iridescence?: number; band?: boolean; hud?: boolean; acoustic?: boolean; gem: string };
export type Addon = { id: string; name: string; price: number; text: string; required?: boolean; only?: GlassId[] };

const W: Base[] = [
  { id: 'oee', name: 'OE-equivalent', price: 289, text: 'Same shape, thickness and optics as the factory glass.', tags: ['Laminated', 'DOT certified'], tint: '#0b1016', opacity: .38, gem: 'radial-gradient(circle at 35% 30%,#fff 0 6%,#cfe3e9 14%,#7fa2ad 48%,#2b3c44 100%)' },
  { id: 'oem', name: 'Factory OEM', price: 449, text: 'The exact glass your car left the factory with, logo included.', tags: ['Laminated', 'Factory logo'], tint: '#0b1016', opacity: .36, gem: 'radial-gradient(circle at 35% 30%,#fff 0 6%,#e6f0f2 16%,#97b6bf 50%,#33464f 100%)' },
  { id: 'acoustic', name: 'Acoustic', price: 389, text: 'A sound-damping layer inside the glass: a quieter cabin on the highway.', tags: ['−6 dB road noise', 'Laminated'], tint: '#0a1418', opacity: .42, acoustic: true, gem: 'radial-gradient(circle at 35% 30%,#fff 0 6%,#c9ecea 16%,#5f9f9b 52%,#183634 100%)' },
  { id: 'solar', name: 'Solar control', price: 429, text: 'A heat-reflecting coat. Cooler cabin, the AC works less.', tags: ['Blocks 60% of the heat', 'IR coat'], tint: '#14101c', opacity: .46, iridescence: 1, gem: 'conic-gradient(from 200deg at 50% 50%,#2c1f4a,#b48cff,#5fe0d0,#ffd36b,#2c1f4a)' },
  { id: 'band', name: 'Shade band', price: 329, text: 'A tinted band across the top cuts the low sun.', tags: ['Blue-green band', 'Laminated'], tint: '#0b1016', opacity: .38, band: true, gem: 'linear-gradient(180deg,#1d5a6b 0 34%,#9cc4cc 34% 100%)' },
  { id: 'hud', name: 'Head-up display', price: 519, text: 'A wedge layer so the speed shows sharp on the glass, without a double image.', tags: ['HUD wedge', 'Acoustic'], tint: '#0b1016', opacity: .38, hud: true, acoustic: true, gem: 'radial-gradient(circle at 50% 50%,#7dffb2 0 8%,#1e5a3d 30%,#0f1d18 100%)' },
];
const SIDE: Base[] = [
  { id: 'v70', name: 'Clear · 70%', price: 169, text: 'Factory clear tempered glass.', tags: ['Tempered', '70% light'], tint: '#0b1016', opacity: .32, gem: 'radial-gradient(circle at 35% 30%,#fff 0 6%,#d7e4e8 18%,#8aa5ae 55%,#2b3c44 100%)' },
  { id: 'v50', name: 'Light tint · 50%', price: 189, text: 'A light tint, cooler and calmer.', tags: ['Tempered', '50% light'], tint: '#06090c', opacity: .55, gem: 'radial-gradient(circle at 35% 30%,#ddd 0 6%,#8a9aa0 20%,#3b4a50 60%,#111 100%)' },
  { id: 'v35', name: 'Medium tint · 35%', price: 209, text: 'Clear privacy without going dark.', tags: ['Tempered', '35% light'], tint: '#030506', opacity: .8, gem: 'radial-gradient(circle at 35% 30%,#bbb 0 6%,#56646a 22%,#20282c 62%,#070707 100%)' },
  { id: 'v20', name: 'Dark tint · 20%', price: 229, text: 'Dark privacy glass. Check your state’s tint rules first.', tags: ['Tempered', '20% light'], tint: '#010202', opacity: .92, gem: 'radial-gradient(circle at 35% 30%,#999 0 5%,#333b3e 24%,#111 64%,#000 100%)' },
];
const REAR: Base[] = [
  { id: 'rdef', name: 'With defroster', price: 329, text: 'Tempered rear glass with the heating grid printed in.', tags: ['Tempered', 'Heated grid'], tint: '#0b1016', opacity: .42, gem: 'repeating-linear-gradient(180deg,#a3442a 0 2px,#2b3c44 2px 12px)' },
  { id: 'rpriv', name: 'Privacy + defroster', price: 369, text: 'Dark privacy glass with the heating grid.', tags: ['Tempered', '20% light'], tint: '#020303', opacity: .8, gem: 'repeating-linear-gradient(180deg,#7a2a18 0 2px,#0c0f10 2px 12px)' },
];
export const bases: Record<GlassId, Base[]> = { windshield: W, driver: SIDE, passenger: SIDE, quarter: SIDE, rear: REAR };

export const addons: Addon[] = [
  { id: 'adas', name: 'Camera recalibration', price: 199, text: 'Your lane camera looks through this glass: it must be aimed again.', required: true, only: ['windshield'] },
  { id: 'rain', name: 'Rain & light sensor', price: 45, text: 'Wipers and headlights switch on by themselves.', only: ['windshield'] },
  { id: 'heat', name: 'Heated wiper zone', price: 60, text: 'Thin wires melt the ice where the wipers rest.', only: ['windshield'] },
  { id: 'coat', name: 'Rain-repellent coat', price: 39, text: 'Water beads up and flies off above 40 mph.' },
  { id: 'mobile', name: 'Mobile install', price: 0, text: 'We come to your driveway.' },
];

export const repairPrice = 79;

/* ---------- Share link: the whole build in the URL hash ---------- */
export type Shared = { g: GlassId; k: CrackKind; s: number; b: string; a: string[]; p: [number, number, number]; n: [number, number, number] };
export const encode = (x: Shared) => btoa(JSON.stringify(x)).replace(/=+$/, '');
export function decode(h: string): Shared | null {
  try { return JSON.parse(atob(h)) as Shared; } catch { return null; }
}
