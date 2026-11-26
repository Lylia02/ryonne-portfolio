/* =========================================================
   Procedural glass damage, drawn on a canvas (Glass Lab).
   The same seed always gives the same crack, so it can grow
   smoothly: size, the running crack and the "draw-in" reveal
   only change how far each stroke goes.
   The canvas covers SPAN metres of glass (see GlassLab3D).
   ========================================================= */
import type { CrackKind } from './lab';

export const CANVAS = 1024;
export const SPAN = 1.1;                       // metres of glass covered by the canvas
const PX_PER_INCH = (CANVAS / SPAN) * .0254 * 5; // ×5: a bit larger than life so it reads on screen

type Opts = { kind: CrackKind; inch: number; runner: number; reveal: number; seed: number; angle: number };

export function drawCrack(c: HTMLCanvasElement, o: Opts) {
  const g = c.getContext('2d')!, S = CANVAS, cx = S / 2;
  g.clearRect(0, 0, S, S);
  let seed = o.seed;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const R = Math.max(5, (o.inch / 2) * PX_PER_INCH);
  const rv = Math.max(0, Math.min(1, o.reveal));
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = 'rgba(210,235,255,.8)'; g.shadowBlur = 10;
  const LW = 2.4; // line weight: thin lines vanish on screen

  /* a wavy stroke from (x,y), heading a, length len — only `part` of it is drawn */
  const stroke = (x: number, y: number, a: number, len: number, w: number, alpha: number, part: number, kids: number) => {
    const n = 14, pts: [number, number][] = [[x, y]];
    for (let i = 0; i < n; i++) { a += (rnd() - .5) * .5; x += Math.cos(a) * len / n; y += Math.sin(a) * len / n; pts.push([x, y]); }
    const kidAt = Array.from({ length: kids }, () => 2 + Math.floor(rnd() * (n - 4)));
    const kidDir = kidAt.map(() => (rnd() < .5 ? -1 : 1) * (.5 + rnd() * .7));
    const upto = part * n;
    g.lineWidth = w * LW; g.strokeStyle = `rgba(240,248,255,${alpha})`;
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i <= Math.min(n, Math.ceil(upto)); i++) {
      const f = Math.min(1, upto - (i - 1));
      g.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f);
    }
    g.stroke();
    kidAt.forEach((k, j) => {
      if (k >= upto) return;
      const [px, py] = pts[k], [qx, qy] = pts[k + 1], h = Math.atan2(qy - py, qx - px);
      stroke(px, py, h + kidDir[j], len * (.18 + rnd() * .2), w * .6, alpha * .8, Math.min(1, (upto - k) / 4), 0);
    });
  };

  const legs = (count: number, reach: number) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rnd() * .6;
      stroke(cx, cx, a, reach * (.55 + rnd() * .5), 1.8, .85, rv, 1);
    }
  };
  const bull = (r: number) => {
    const rr = r * Math.min(1, rv * 1.6);
    const grad = g.createRadialGradient(cx, cx, 0, cx, cx, rr);
    grad.addColorStop(0, 'rgba(255,255,255,.85)'); grad.addColorStop(.18, 'rgba(160,175,185,.55)');
    grad.addColorStop(.75, 'rgba(70,80,90,.45)'); grad.addColorStop(1, 'rgba(220,235,245,.7)');
    g.fillStyle = grad; g.beginPath(); g.arc(cx, cx, rr, 0, Math.PI * 2); g.fill();
    g.lineWidth = 1.4 * LW; g.strokeStyle = 'rgba(240,250,255,.85)';
    g.beginPath(); g.arc(cx, cx, rr, rnd() * 6, Math.PI * (1.2 + rnd() * .6) + 2); g.stroke(); // the half-moon edge
  };

  if (o.kind === 'bullseye') bull(R);
  if (o.kind === 'star') legs(7, R);
  if (o.kind === 'combo') { bull(R * .55); legs(6, R); }
  if (o.kind === 'edge') { stroke(cx, cx, o.angle, R * 1.4, 2.2, .9, rv, 3); legs(3, R * .25); }
  if (o.kind === 'line') { stroke(cx, cx, o.angle, R * 1.1, 2.2, .9, rv, 3); stroke(cx, cx, o.angle + Math.PI, R * .9, 2, .9, rv, 2); }

  /* the running crack, once the damage starts to spread */
  if (o.runner > .01 && (o.kind !== 'line' && o.kind !== 'edge')) {
    const reach = o.runner * S * .42;
    stroke(cx, cx, o.angle, reach, 2, .9, rv, Math.round(o.runner * 4));
    if (o.runner > .5) stroke(cx, cx, o.angle + Math.PI + .3, reach * .6 * (o.runner - .5) * 2, 1.8, .85, rv, 2);
  }
  // the impact point
  g.shadowBlur = 0;
  const dot = g.createRadialGradient(cx, cx, 0, cx, cx, 11);
  dot.addColorStop(0, 'rgba(255,255,255,.9)'); dot.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = dot; g.beginPath(); g.arc(cx, cx, 11, 0, Math.PI * 2); g.fill();
}

/* ---------- other glass overlays (canvas textures) ---------- */
export function drawBand(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!; c.width = 64; c.height = 256;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(20,90,110,.92)'); grad.addColorStop(.75, 'rgba(20,90,110,.55)'); grad.addColorStop(1, 'rgba(20,90,110,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 256);
}
export function drawHeat(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!; c.width = 1024; c.height = 128;
  g.strokeStyle = 'rgba(255,140,60,.95)'; g.lineWidth = 2;
  for (let i = 0; i < 9; i++) { g.beginPath(); for (let x = 0; x <= 1024; x += 16) g.lineTo(x, 20 + i * 11 + Math.sin(x * .03 + i) * 2); g.stroke(); }
}
export function drawSensor(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!; c.width = c.height = 256;
  g.fillStyle = 'rgba(8,8,10,.96)'; g.beginPath(); g.roundRect(40, 30, 176, 196, 26); g.fill();
  g.fillStyle = 'rgba(30,140,255,.75)'; g.beginPath(); g.arc(128, 100, 22, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(84, 150, 88, 10); g.fillRect(84, 170, 60, 10);
}
export function drawHud(c: HTMLCanvasElement, mph: number) {
  const g = c.getContext('2d')!; c.width = 512; c.height = 256;
  g.clearRect(0, 0, 512, 256);
  g.shadowColor = 'rgba(80,255,170,.9)'; g.shadowBlur = 14; g.fillStyle = 'rgba(140,255,200,.95)';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 120px Arial, sans-serif'; g.fillText(String(Math.round(mph)), 200, 118);
  g.font = '700 30px Arial, sans-serif'; g.fillText('MPH', 200, 200);
  g.font = '700 70px Arial, sans-serif'; g.fillText('➚', 390, 100);
  g.font = '600 26px Arial, sans-serif'; g.fillText('0.4 mi', 390, 175);
}
/* water on the glass: beads (coated) or a smeared film (bare) */
export type Drop = { x: number; y: number; r: number; v: number };
export function drawRain(c: HTMLCanvasElement, drops: Drop[], coated: boolean) {
  const g = c.getContext('2d')!, S = c.width;
  g.clearRect(0, 0, S, S);
  if (!coated) { g.fillStyle = 'rgba(190,210,225,.2)'; g.fillRect(0, 0, S, S); }
  for (const d of drops) {
    const grad = g.createRadialGradient(d.x - d.r * .3, d.y - d.r * .3, 0, d.x, d.y, d.r);
    grad.addColorStop(0, 'rgba(255,255,255,.95)'); grad.addColorStop(.5, 'rgba(170,200,220,.35)'); grad.addColorStop(1, 'rgba(255,255,255,.55)');
    g.fillStyle = grad;
    g.beginPath();
    if (coated) g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    else g.ellipse(d.x, d.y + d.r * 2, d.r * .9, d.r * 3.4, 0, 0, Math.PI * 2);
    g.fill();
  }
}
