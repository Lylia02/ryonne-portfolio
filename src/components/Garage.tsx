'use client';
/* =========================================================
   The 3D garage page — one scene, everything inside it.
   Intro: the car drives in. Then a small dock at the bottom:
   · Explore            orbit, zoom, lift the car to see underneath, paint
   · Repair the glass   impact → damage → if you wait → your glass → install → your build
   · What it's made of  the car opens up, each part and its materials
   · Drive it out       the turntable turns the car, the door opens
   "Use my car" (top right): a photo → 3D (open-source AI) or a 3D scan.
   ========================================================= */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useProgress } from '@react-three/drei';
import type * as THREE from 'three';
import Rich from './Rich';
import TLink from './TLink';
import { gsap } from '@/lib/motion';
import { diagnose, type GlassId } from '@/lib/site';
import { parts, type PartId } from '@/lib/studio';
import { addons, bases, decode, encode, grow, lab, repairPrice, sizeLabel, sizeMax, sizeMin, tempered, verdict, type CrackKind, type StepId, type Weather } from '@/lib/lab';
import { composition, garage as G, type GarageMode } from '@/lib/garage';
import { glassHit, glassSet, startEngine, startRoad } from '@/lib/garageAudio';
import { PREFILL_EVENT, type Prefill } from '@/lib/keys';
import type { GlassView, Input, PickInfo, Stats } from './Garage3D';

const Scene = dynamic(() => import('./Garage3D'), { ssr: false });
const usd = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
const glassName = (g: GlassId) => diagnose.glass.find(x => x.id === g)!.label;
const toInch = (x: number) => sizeMin * Math.pow(sizeMax / sizeMin, x);
const toSlider = (inch: number) => Math.log(inch / sizeMin) / Math.log(sizeMax / sizeMin);
const dayLabel = (d: number) => d === 0 ? 'Today' : d < 7 ? `${d} day${d > 1 ? 's' : ''}` : d < 30 ? `${Math.round(d / 7)} week${d >= 14 ? 's' : ''}` : `${Math.round(d / 30)} month${d >= 60 ? 's' : ''}`;
const KEYS: Record<string, keyof Input> = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'brake' };
/* the parts list in "What it's made of": the four wheels are one entry */
const groups: { id: PartId; ids: PartId[] }[] = [
  { id: 'windshield', ids: ['windshield'] }, { id: 'doorL', ids: ['doorL', 'doorR'] }, { id: 'roof', ids: ['roof'] },
  { id: 'hood', ids: ['hood'] }, { id: 'engine', ids: ['engine'] }, { id: 'seats', ids: ['seats'] },
  { id: 'wheelFL', ids: ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'] },
];
const groupTitle = (id: PartId) => id === 'doorL' ? 'Doors & side glass' : id === 'wheelFL' ? 'Wheels & tyres' : composition[id].title;

function Loader({ ready }: { ready: boolean }) {
  const { progress } = useProgress();
  return (
    <div className={'gx__load' + (ready ? ' is-done' : '')} aria-hidden={ready}>
      <span className="mono">{G.loading}</span><b className="h-wide">{String(Math.round(progress)).padStart(3, '0')}</b>
      <i style={{ transform: `scaleX(${progress / 100})` }} />
    </div>
  );
}

export default function Garage() {
  const ref = useRef<HTMLElement>(null);
  const canvasEl = useRef<HTMLCanvasElement | null>(null);
  const totalEl = useRef<HTMLElement>(null);
  const tags = useRef<Partial<Record<PartId, HTMLElement | null>>>({});
  const input = useRef<Input>({ up: false, down: false, left: false, right: false, brake: false });
  const [onScreen, setOnScreen] = useState(true);
  const [ready, setReady] = useState(false);
  const [touch, setTouch] = useState(false);
  const [stacked, setStacked] = useState(false);

  const [mode, setMode] = useState<GarageMode>('explore');
  const [intro, setIntro] = useState(true);
  const [lifted, setLifted] = useState(false);
  const [paint, setPaint] = useState(diagnose.paints[1].variant);
  const [custom, setCustom] = useState<THREE.Object3D | null>(null);
  const [turn, setTurn] = useState(0);
  const [mine, setMine] = useState<'closed' | 'open' | 'working' | 'error' | 'quota'>('closed');
  const [mineStep, setMineStep] = useState(0);
  // glass
  const [step, setStep] = useState<StepId>('impact');
  const [impact, setImpact] = useState<PickInfo | null>(null);
  const [kind, setKind] = useState<CrackKind>('star');
  const [inch, setInch] = useState(1);
  const [days, setDays] = useState(0);
  const [weather, setWeather] = useState<Weather[]>([]);
  const [baseId, setBaseId] = useState<string | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [installAt, setInstallAt] = useState<number | null>(null);
  const [installed, setInstalled] = useState(false);
  const [phase, setPhase] = useState(-1);
  const [calib, setCalib] = useState<number | null>(null);
  const [rain, setRain] = useState(false);
  const [road, setRoad] = useState(false);
  const [copied, setCopied] = useState(false);
  const [flash, setFlash] = useState(0);
  // parts
  const [explode, setExplode] = useState(0);
  const [part, setPart] = useState<PartId>('windshield');
  // drive
  const [mph, setMph] = useState(0);
  const [lights, setLights] = useState(false);
  const [sound, setSound] = useState(true);
  const [driveReady, setDriveReady] = useState(false);
  // under the hood
  const [under, setUnder] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const roadRef = useRef<ReturnType<typeof startRoad> | null>(null);
  const motor = useRef<ReturnType<typeof startEngine> | null>(null);

  /* ---------- derived (glass) ---------- */
  const g = impact?.glass ?? null;
  const grown = useMemo(() => grow(kind, inch, days, weather), [kind, inch, days, weather]);
  const now = useMemo(() => impact ? verdict(impact.glass, kind, inch, kind === 'line' || kind === 'edge' ? 1 : 0, impact.inView, impact.nearEdge) : null, [impact, kind, inch]);
  const later = useMemo(() => impact ? verdict(impact.glass, kind, grown.inch, grown.runner, impact.inView, impact.nearEdge) : null, [impact, kind, grown]);
  const list = g ? bases[g] : [];
  const base = list.find(b => b.id === baseId) ?? null;
  const extras = useMemo(() => addons.filter(a => !a.only || (g && a.only.includes(g))), [g]);
  const picked = extras.filter(a => a.required || extra.includes(a.id));
  const total = (base?.price ?? 0) + picked.reduce((s, a) => s + a.price, 0);
  const cheapest = g ? Math.min(...bases[g].map(b => b.price)) + (g === 'windshield' ? 199 : 0) : 0;
  const view: GlassView = step === 'impact' ? (impact ? 'impact' : 'idle') : step === 'damage' || step === 'time' ? 'impact' : step === 'build' ? 'hero' : 'glass';
  const shownInch = step === 'impact' || step === 'damage' ? inch : grown.inch;
  const shownRunner = step === 'impact' || step === 'damage' ? (kind === 'line' || kind === 'edge' ? 1 : 0) : grown.runner;
  const order = lab.steps.map(s => s.id), si = order.indexOf(step);
  const panel = !intro && (mode === 'glass' || mode === 'parts' || mine !== 'closed');

  /* ---------- page visibility, layout ---------- */
  useEffect(() => {
    setTouch(matchMedia('(hover: none), (pointer: coarse)').matches);
    const mq = matchMedia('(max-width: 980px)'), onMq = () => setStacked(mq.matches); onMq(); mq.addEventListener('change', onMq);
    const vis = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: .15 });
    vis.observe(ref.current!);
    // a shared build (#lab=…) skips the intro and opens on the build
    const h = location.hash.startsWith('#lab=') ? decode(location.hash.slice(5)) : null;
    if (h) {
      setIntro(false); setMode('glass');
      setImpact({ glass: h.g, point: h.p, normal: h.n, seed: 7, angle: 1, inView: false, nearEdge: false });
      setKind(h.k); setInch(h.s); setBaseId(h.b); setExtra(h.a); setInstalled(true); setStep('build');
    }
    return () => { vis.disconnect(); mq.removeEventListener('change', onMq); motor.current?.stop(); roadRef.current?.stop(); };
  }, []);

  /* ---------- the total counts up ---------- */
  const shown = useRef({ v: 0 });
  useEffect(() => {
    gsap.to(shown.current, { v: total, duration: .6, ease: 'power2.out', onUpdate: () => { if (totalEl.current) totalEl.current.textContent = usd(shown.current.v); } });
  }, [total]);

  /* ---------- keys while driving ---------- */
  useEffect(() => {
    if (!onScreen || mode !== 'drive') return;
    const set = (e: KeyboardEvent, v: boolean) => { const k = KEYS[e.code]; if (!k) return; e.preventDefault(); input.current[k] = v; };
    const dn = (e: KeyboardEvent) => set(e, true), up = (e: KeyboardEvent) => set(e, false);
    const inp = input.current;
    addEventListener('keydown', dn); addEventListener('keyup', up);
    return () => { removeEventListener('keydown', dn); removeEventListener('keyup', up); Object.assign(inp, { up: false, down: false, left: false, right: false, brake: false }); };
  }, [onScreen, mode]);
  useEffect(() => { motor.current?.setRpm(Math.min(mph / 80, 1)); }, [mph]);
  useEffect(() => { if (!onScreen) { motor.current?.stop(); motor.current = null; roadRef.current?.stop(); roadRef.current = null; setRoad(false); } }, [onScreen]);
  useEffect(() => { roadRef.current?.setQuiet(!!base?.acoustic); }, [base]);

  /* ---------- modes ---------- */
  const go = (m: GarageMode) => {
    if (m === mode || installAt) return;
    if (custom && (m === 'parts' || m === 'drive')) return;
    setLifted(false); setRain(false);
    if (m === 'parts') { setExplode(0); setTimeout(() => setExplode(1), 250); }
    if (m === 'drive') { setLights(true); setDriveReady(false); setMph(0); if (sound) { motor.current?.stop(); motor.current = startEngine('stock'); } }
    else { motor.current?.stop(); motor.current = null; setLights(false); }
    if (m !== 'glass') { roadRef.current?.stop(); roadRef.current = null; setRoad(false); }
    setMode(m);
  };
  const toggleSound = () => {
    if (sound) { motor.current?.stop(); motor.current = null; setSound(false); return; }
    setSound(true); if (mode === 'drive') motor.current = startEngine('stock');
  };
  const toggleRoad = () => {
    if (roadRef.current) { roadRef.current.stop(); roadRef.current = null; setRoad(false); return; }
    roadRef.current = startRoad(); roadRef.current.setQuiet(!!base?.acoustic); setRoad(true);
  };

  /* ---------- glass actions ---------- */
  const onPick = useCallback((p: PickInfo) => {
    if (step !== 'impact' && step !== 'damage') return;
    glassHit(); setFlash(f => f + 1);
    setImpact(p); setInstalled(false); setBaseId(null); setExtra([]);
    if (tempered(p.glass)) { setKind('combo'); setInch(2); }
    if (step === 'impact') setTimeout(() => setStep('damage'), 1100);
  }, [step]);
  const goStep = (s: StepId) => {
    if (s === 'glass' && g && !baseId) setBaseId(bases[g][0].id);
    setStep(s);
  };
  const install = () => {
    if (!base || installAt) return;
    setRain(false);
    if (custom) { setInstalled(true); setStep('build'); return; } // a scanned car has no separate glass to swap
    setStep('install'); setPhase(0); setInstallAt(performance.now());
    [0, 600, 1100, 1700, 2450].forEach((t, i) => setTimeout(() => setPhase(i), t));
    setTimeout(glassSet, 2350);
    const adas = g === 'windshield';
    if (adas) setTimeout(() => {
      const o = { e: 1.8 }; setCalib(o.e);
      gsap.to(o, { e: 0, duration: 1.6, ease: 'power3.inOut', onUpdate: () => setCalib(o.e), onComplete: () => { setTimeout(() => setCalib(null), 500); } });
    }, 2500);
    setTimeout(() => { setInstallAt(null); setInstalled(true); setPhase(5); setStep('build'); }, adas ? 4700 : 3000);
  };
  const restartGlass = () => {
    setImpact(null); setInstalled(false); setInstallAt(null); setBaseId(null); setExtra([]); setDays(0); setWeather([]);
    setKind('star'); setInch(1); setStep('impact'); setRain(false);
    if (location.hash.startsWith('#lab=')) history.replaceState(null, '', location.pathname + location.search);
  };
  const share = async () => {
    if (!impact || !base) return;
    const url = `${location.origin}${location.pathname}#lab=${encode({ g: impact.glass, k: kind, s: +shownInch.toFixed(2), b: base.id, a: extra, p: impact.point, n: impact.normal })}`;
    try { await navigator.clipboard.writeText(url); } catch { /* blocked: the link is in the address bar */ }
    history.replaceState(null, '', url); setCopied(true); setTimeout(() => setCopied(false), 1800);
  };
  const picture = () => {
    const c = canvasEl.current; if (!c) return;
    const a = document.createElement('a'); a.download = 'ryonne-garage.png'; a.href = c.toDataURL('image/png'); a.click();
  };
  const book = () => {
    if (!g || !base) return;
    const detail: Prefill = {
      glass: diagnose.glass.find(x => x.id === g)!.form,
      message: `3D garage build — ${glassName(g)}: ${base.name}${picked.length ? ' + ' + picked.map(a => a.name).join(', ') : ''}. Damage: ${lab.kinds.find(k => k.id === kind)!.label.toLowerCase()}, about ${sizeLabel(shownInch)}. Estimate ${usd(total)}.`,
    };
    try { sessionStorage.setItem(PREFILL_EVENT, JSON.stringify(detail)); } catch { /* private mode */ }
  };

  /* ---------- use my car ---------- */
  const fromPhoto = async (f: File) => {
    setMine('working'); setMineStep(0);
    try {
      const { photoToGlb, loadCustom } = await import('@/lib/scan');
      const obj = await loadCustom(await photoToGlb(f, setMineStep));
      takeCustom(obj);
    } catch (e) { console.error('[my car]', e); setMine((e as Error).message === 'quota' ? 'quota' : 'error'); }
  };
  const fromScan = async (f: File) => {
    setMine('working'); setMineStep(4);
    try { const { loadCustom } = await import('@/lib/scan'); takeCustom(await loadCustom(await f.arrayBuffer())); }
    catch (e) { console.error('[my car]', e); setMine('error'); }
  };
  const takeCustom = (obj: THREE.Object3D) => {
    setCustom(obj); setTurn(0); setMine('closed'); setMode('glass'); restartGlass();
  };
  const dropCustom = () => { setCustom(null); restartGlass(); setMode('explore'); };

  const onReady = useCallback((c: HTMLCanvasElement) => { canvasEl.current = c; setReady(true); }, []);
  const onIntroDone = useCallback(() => setIntro(false), []);
  const onSpeed = useCallback((v: number) => setMph(Math.round(v)), []);
  const onDriveReady = useCallback(() => setDriveReady(true), []);
  const onPart = useCallback((id: PartId) => setPart(groups.find(x => x.ids.includes(id))!.id), []);
  const hold = (k: keyof Input, v: boolean) => () => { input.current[k] = v; };
  const V = later && step === 'time' ? later : now;
  const hint = intro ? '' : mode === 'glass' ? (step === 'impact' ? lab.impact.hint : '') : mode === 'drive' ? (driveReady ? G.dock[3].hint : '') : G.dock.find(d => d.id === mode)!.hint;
  const comp = composition[part];

  return (
    <section className={`gx is-${mode}${intro ? ' is-intro' : ''}${panel ? ' has-panel' : ''}`} ref={ref} aria-label="The 3D garage">
      <div className="gx__stage" data-cursor="">
        <Scene mode={mode} intro={intro} lifted={lifted} paint={paint} custom={custom} customTurn={turn}
          view={view} picking={mode === 'glass' && (step === 'impact' || step === 'damage')} impact={impact} kind={kind} inch={shownInch} runner={shownRunner}
          base={mode === 'glass' && (step === 'glass' || step === 'install' || step === 'build') ? base : installed ? base : null}
          addons={(mode === 'glass' && (step === 'glass' || step === 'install' || step === 'build')) || installed ? picked.map(a => a.id) : []}
          rain={rain} installAt={installAt} installed={installed} showZone={mode === 'glass' && step === 'damage' && g === 'windshield'}
          explode={explode} highlight={mode === 'parts' ? part : null} tags={tags} input={input} lights={lights}
          touch={touch} panel={panel} stacked={stacked} active={onScreen}
          onPick={onPick} onReady={onReady} onIntroDone={onIntroDone} onSpeed={onSpeed} onPart={onPart} onDriveReady={onDriveReady}
          onStats={under ? setStats : undefined} />
        <Loader ready={ready} />
        <div className="gx__tags" aria-hidden="true">
          {parts.map(p => <span key={p.id} className={'gx__tag mono' + (groups.find(x => x.id === part)?.ids.includes(p.id) ? ' is-on' : '')} ref={el => { tags.current[p.id] = el; }}>{p.name}</span>)}
        </div>
        {flash > 0 && <span key={flash} className="gx__flash" aria-hidden="true" />}
        {calib !== null && (
          <div className="gx__adas" aria-live="polite">
            <svg viewBox="0 0 200 120" aria-hidden="true">
              <rect x="1" y="1" width="198" height="118" fill="none" stroke="currentColor" strokeOpacity=".3" />
              <path d="M70 120 L96 50 M130 120 L104 50" stroke="#ffd400" strokeWidth="2" />
              <g transform={`translate(${100 + calib * 14} ${60 - calib * 6})`}><circle r="10" fill="none" stroke="#e8102a" strokeWidth="1.5" /><path d="M-16 0H16M0-16V16" stroke="#e8102a" strokeWidth="1.5" /></g>
              <circle cx="100" cy="60" r="3" fill="#fff" />
            </svg>
            <span className="mono">Lane camera · aim {calib.toFixed(2)}°</span>
            <b className="mono">{calib < .02 ? 'Calibrated ✓' : 'Calibrating'}</b>
          </div>
        )}
        {mode === 'drive' && !intro && <div className="gx__hud" aria-live="off"><b className="h-wide">{mph}</b><span className="mono">{G.speed}</span></div>}
        {touch && mode === 'drive' && driveReady && (
          <div className="gx__pad">
            {(['left', 'right'] as const).map(k => <button key={k} type="button" className="gx__key" onPointerDown={hold(k, true)} onPointerUp={hold(k, false)} onPointerLeave={hold(k, false)} aria-label={k}>{k === 'left' ? '◀' : '▶'}</button>)}
            <span />
            <button type="button" className="gx__key" onPointerDown={hold('down', true)} onPointerUp={hold('down', false)} onPointerLeave={hold('down', false)} aria-label="Brake or back">▼</button>
            <button type="button" className="gx__key" onPointerDown={hold('up', true)} onPointerUp={hold('up', false)} onPointerLeave={hold('up', false)} aria-label="Go">▲</button>
          </div>
        )}
      </div>

      {/* ---------- title ---------- */}
      <header className="gx__head">
        <p className="mono"><i />{G.kicker}</p>
        <h1 className="h-wide" key={intro ? 'intro' : mode}><Rich text={intro ? 'Welcome to\n*the garage.*' : G.titles[mode]} /></h1>
      </header>

      {/* ---------- my car ---------- */}
      {!intro && (custom
        ? <button type="button" className="gx__mine" onClick={dropCustom}>↺ {G.yourCar.reset}</button>
        : <button type="button" className="gx__mine" onClick={() => setMine(m => m === 'closed' ? 'open' : 'closed')} aria-expanded={mine !== 'closed'}><i />{G.yourCar.cta}</button>)}

      {/* ---------- side panel ---------- */}
      {panel && (
        <aside className="gx__panel" key={mine !== 'closed' ? 'mine' : mode + step}>
          {mine !== 'closed' ? (
            <div className="gx__card">
              <div className="gx__cardhead"><span className="mono">{G.yourCar.cta}</span><button type="button" className="gx__x" onClick={() => setMine('closed')} aria-label="Close">×</button></div>
              <h3>{G.yourCar.title}</h3>
              <p>{G.yourCar.text}</p>
              {mine === 'working' ? (
                <ul className="gx__check">{G.yourCar.working.map((s, i) => <li key={s} className={i < mineStep ? 'is-done' : i === mineStep ? 'is-on' : ''}><i />{s}</li>)}</ul>
              ) : <>
                <label className="gx__file">
                  <b>{G.yourCar.photo}</b><span>{G.yourCar.photoHint}</span>
                  <em className="mono">{G.yourCar.choose}</em>
                  <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) fromPhoto(f); }} />
                </label>
                <label className="gx__file">
                  <b>{G.yourCar.scan}</b><span>{G.yourCar.scanHint}</span>
                  <em className="mono">{G.yourCar.chooseScan}</em>
                  <input type="file" accept=".glb,model/gltf-binary" onChange={e => { const f = e.target.files?.[0]; if (f) fromScan(f); }} />
                </label>
                {mine === 'error' && <p className="gx__err">{G.yourCar.busy}</p>}
                {mine === 'quota' && <p className="gx__err">{G.yourCar.quota}</p>}
                <p className="gx__small">{G.yourCar.privacy}</p>
              </>}
            </div>
          ) : mode === 'parts' ? (
            <div className="gx__card">
              <div className="gx__cardhead"><span className="mono">{groups.length} parts</span></div>
              <ul className="gx__parts">
                {groups.map(x => <li key={x.id}><button type="button" className={part === x.id ? 'is-on' : ''} onClick={() => setPart(x.id)}>{composition[x.id].glass && <i />}{groupTitle(x.id)}</button></li>)}
              </ul>
              <div className="gx__comp" key={part}>
                <h3>{groupTitle(part)}</h3>
                <ul>{comp.materials.map(m => <li key={m} className="mono">{m}</li>)}</ul>
                <p>{comp.text}</p>
                {comp.glass && <button type="button" className="gx__link" onClick={() => go('glass')}>Damaged? Repair the glass →</button>}
              </div>
              <label className="gx__range">
                <span className="mono">Closed<b>Open</b></span>
                <input type="range" min={0} max={1} step={.01} value={explode} onChange={e => setExplode(+e.target.value)} aria-label="Open the car" />
              </label>
            </div>
          ) : (
            <div className="gx__card">
              <div className="gx__cardhead">
                <span className="mono">{String(si + 1).padStart(2, '0')} / {String(order.length).padStart(2, '0')} · {lab.steps[si].label}</span>
                <ol className="gx__dots" aria-hidden="true">{order.map((s, i) => <li key={s} className={i < si ? 'is-done' : i === si ? 'is-on' : ''} />)}</ol>
              </div>

              {step === 'impact' && <>
                <h3>{lab.impact.title}</h3>
                <p>{custom ? 'Click your car where it is damaged.' : lab.impact.text}</p>
                {impact && <p className="gx__picked"><i />{custom ? 'Marked on your car' : glassName(impact.glass)}</p>}
              </>}

              {step === 'damage' && g && now && <>
                <h3>What does it look like?</h3>
                <div className="gx__kinds">
                  {lab.kinds.map(k => <button type="button" key={k.id} className={kind === k.id ? 'is-on' : ''} onClick={() => setKind(k.id)} aria-pressed={kind === k.id}><b>{k.label}</b><span>{k.hint}</span></button>)}
                </div>
                <label className="gx__range">
                  <span className="mono">Size<b>{sizeLabel(inch)}</b></span>
                  <input type="range" min={0} max={1} step={.001} value={toSlider(inch)} onChange={e => setInch(toInch(+e.target.value))} />
                </label>
                {g === 'windshield' && !custom && <p className="gx__small">{impact?.inView ? 'The red frame is the driver’s line of sight: your impact is inside it.' : 'The red frame is the driver’s line of sight.'}</p>}
                <Verdict v={now} cheapest={cheapest} />
                <div className="gx__nav"><button type="button" className="gx__ghost" onClick={() => goStep('impact')}>{lab.back}</button><button type="button" className="gx__cta" onClick={() => goStep('time')}>{lab.next}</button></div>
              </>}

              {step === 'time' && V && <>
                <h3>{lab.timeTitle}</h3>
                <label className="gx__range">
                  <span className="mono">Waiting<b>{dayLabel(days)}</b></span>
                  <input type="range" min={0} max={120} step={1} value={days} onChange={e => setDays(+e.target.value)} />
                </label>
                <div className="gx__chips">
                  {lab.weather.map(w => <button type="button" key={w.id} className={weather.includes(w.id) ? 'is-on' : ''} aria-pressed={weather.includes(w.id)} onClick={() => setWeather(x => x.includes(w.id) ? x.filter(y => y !== w.id) : [...x, w.id])}>{w.label}</button>)}
                </div>
                <p className="gx__grow mono">{sizeLabel(inch)} → <b>{sizeLabel(grown.inch)}</b>{grown.runner > .05 && kind !== 'line' && kind !== 'edge' ? ' · running' : ''}</p>
                <Verdict v={V} cheapest={cheapest} />
                {now?.repair && !V.repair && <p className="gx__cost">Waiting turns a {usd(repairPrice)} repair into a {usd(cheapest)}+ replacement.</p>}
                <div className="gx__nav"><button type="button" className="gx__ghost" onClick={() => goStep('damage')}>{lab.back}</button><button type="button" className="gx__cta" onClick={() => goStep('glass')}>{V.repair ? 'Build a new glass' : lab.next}</button></div>
              </>}

              {step === 'glass' && g && <>
                <h3>{lab.glassTitle}</h3>
                {base && <div className="gx__sel"><b>{base.name}</b><p>{base.text}</p><ul>{base.tags.map(t => <li key={t} className="mono">{t}</li>)}</ul></div>}
                {!custom && g === 'windshield' && <p className="gx__small">Every windshield is also on the wall, behind the car.</p>}
                <Quote lines={[...(base ? [{ n: base.name, p: base.price }] : []), ...picked.map(a => ({ n: a.name, p: a.price }))]} total={total} totalEl={totalEl} />
                <div className="gx__nav"><button type="button" className="gx__ghost" onClick={() => goStep('time')}>{lab.back}</button><button type="button" className="gx__cta" disabled={!base} onClick={install}>{lab.install.cta}</button></div>
              </>}

              {step === 'install' && <>
                <h3>{lab.install.running}…</h3>
                <ul className="gx__check">{lab.install.steps.filter((_, i) => i < 4 || g === 'windshield').map((s, i) => <li key={s} className={phase > i ? 'is-done' : phase === i ? 'is-on' : ''}><i />{s}</li>)}</ul>
              </>}

              {step === 'build' && g && base && <>
                <h3>{lab.build.title}</h3>
                <p className="gx__small">{custom ? 'Your car' : glassName(g)} · {lab.kinds.find(k => k.id === kind)!.label.toLowerCase()} {sizeLabel(shownInch)}</p>
                <Quote lines={[{ n: base.name, p: base.price }, ...picked.map(a => ({ n: a.name, p: a.price }))]} total={total} totalEl={totalEl} />
                <div className="gx__actions">
                  <TLink href="/contact#contact" className="gx__cta" onClick={book}>{lab.build.book}</TLink>
                  <button type="button" className="gx__ghost" onClick={share}>{copied ? lab.build.copied : lab.build.share}</button>
                  <button type="button" className="gx__ghost" onClick={picture}>{lab.build.shot}</button>
                  <button type="button" className="gx__link" onClick={restartGlass}>↺ {lab.build.again}</button>
                </div>
              </>}
              {custom && <p className="gx__small">{G.yourCar.limited}</p>}
            </div>
          )}
        </aside>
      )}

      {/* ---------- the jewel rail: base glass + add-ons ---------- */}
      {mode === 'glass' && step === 'glass' && g && (
        <div className="gx__rail">
          <div className="gx__gems" role="radiogroup" aria-label="Glass">
            {list.map(b => (
              <button type="button" role="radio" aria-checked={b.id === baseId} key={b.id} className={'gx__gem' + (b.id === baseId ? ' is-on' : '')} onClick={() => setBaseId(b.id)}>
                <i style={{ background: b.gem }} /><b>{b.name}</b><span className="mono">{usd(b.price)}</span>
              </button>
            ))}
          </div>
          <div className="gx__pearls">
            {extras.map(a => {
              const on = a.required || extra.includes(a.id);
              return (
                <button type="button" key={a.id} className={'gx__pearl' + (on ? ' is-on' : '')} aria-pressed={on} disabled={a.required} title={a.text}
                  onClick={() => setExtra(x => x.includes(a.id) ? x.filter(y => y !== a.id) : [...x, a.id])}>
                  <i /><span>{a.name}</span><em className="mono">{a.price ? '+' + usd(a.price) : 'free'}{a.required ? ' · required' : ''}</em>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------- bottom: dock, tools, hint ---------- */}
      {intro ? (
        <button type="button" className="gx__skip mono" onClick={() => setIntro(false)}>{G.skip} →</button>
      ) : (
        <div className="gx__bottom">
          {hint && <p className="gx__hint mono">{hint}</p>}
          <div className="gx__tools">
            {mode === 'explore' && <>
              <button type="button" className={'gx__tool' + (lifted ? ' is-on' : '')} onClick={() => setLifted(v => !v)} aria-pressed={lifted}>⇡ {lifted ? G.lift.down : G.lift.up}</button>
              {!custom && <div className="gx__paints">{diagnose.paints.map(p => <button type="button" key={p.variant} className={paint === p.variant ? 'is-on' : ''} onClick={() => setPaint(p.variant)} aria-label={p.label} title={p.label}><i style={{ background: p.swatch }} /></button>)}</div>}
            </>}
            {custom && (mode === 'explore' || (mode === 'glass' && step === 'impact')) && <button type="button" className="gx__tool" onClick={() => setTurn(t => 1 - t)}>↻ Turn it around</button>}
            {mode === 'glass' && g && !custom && (step === 'glass' || step === 'build') && <>
              <button type="button" className={'gx__tool' + (rain ? ' is-on' : '')} onClick={() => setRain(r => !r)} aria-pressed={rain}>☂ {lab.rain}</button>
              <button type="button" className={'gx__tool' + (road ? ' is-on' : '')} onClick={toggleRoad} aria-pressed={road}>♪ {lab.hear}</button>
            </>}
            {mode === 'drive' && <>
              <button type="button" className={'gx__tool' + (lights ? ' is-on' : '')} onClick={() => setLights(v => !v)}>{G.lights}</button>
              <button type="button" className={'gx__tool' + (sound ? ' is-on' : '')} onClick={toggleSound}>{G.sound}</button>
            </>}
          </div>
          <nav className="gx__dock" aria-label="Garage">
            {G.dock.map(d => {
              const off = !!custom && (d.id === 'parts' || d.id === 'drive');
              return (
                <button type="button" key={d.id} className={mode === d.id ? 'is-on' : ''} aria-pressed={mode === d.id} disabled={off || !!installAt} title={off ? G.yourCar.limited : undefined} onClick={() => go(d.id)}>
                  <Icon id={d.id} /><span>{mode === 'drive' && d.id === 'drive' ? 'Driving' : d.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      )}

      <button type="button" className={'gx__under mono' + (under ? ' is-on' : '')} onClick={() => setUnder(u => !u)} aria-pressed={under}>{'</>'}</button>
      {under && (
        <div className="gx__stats mono" aria-live="off">
          <b>{stats?.fps ?? '—'} fps</b>
          <span>{stats?.calls ?? '—'} draw calls · {stats ? Math.round(stats.tris / 1000) + 'k' : '—'} triangles</span>
          <i>React Three Fiber · three.js · DecalGeometry · reflective floor · Web Audio · GSAP{custom ? ' · Hugging Face (image → 3D)' : ''}</i>
        </div>
      )}
      <p className="gx__note mono">{G.note} · 3D car: “Car Concept”, Eric Chadwick, CC BY 4.0</p>
    </section>
  );
}

function Icon({ id }: { id: GarageMode }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (id === 'explore') return <svg {...p}><path d="M12 3a9 9 0 1 0 9 9" /><path d="M21 3l-6 6M15 3h6v6" /></svg>;
  if (id === 'glass') return <svg {...p}><path d="M4 18 7 6h10l3 12z" /><path d="M11 9l1 3-2 2 3 2" /></svg>;
  if (id === 'parts') return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
  return <svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2" /><path d="M12 3v7M5 16l5-3M19 16l-5-3" /></svg>;
}

function Verdict({ v, cheapest }: { v: { repair: boolean; title: string; why: string; price: number }; cheapest: number }) {
  return (
    <div className={'gx__verdict' + (v.repair ? ' is-ok' : '')} aria-live="polite">
      <span className="mono">Verdict</span>
      <b className="h-wide">{v.title}</b>
      <em className="mono">{v.repair ? `$${v.price} · 30 min` : `from $${cheapest}`}</em>
      <p>{v.why}</p>
    </div>
  );
}
function Quote({ lines, total, totalEl }: { lines: { n: string; p: number }[]; total: number; totalEl: React.RefObject<HTMLElement | null> }) {
  return (
    <div className="gx__quote">
      <ul>{lines.map(l => <li key={l.n}><span>{l.n}</span><span>{l.p ? usd(l.p) : 'free'}</span></li>)}</ul>
      <div className="gx__total"><span className="mono">Total</span><b className="h-wide" ref={totalEl as React.RefObject<HTMLElement>}>{usd(total)}</b></div>
    </div>
  );
}
