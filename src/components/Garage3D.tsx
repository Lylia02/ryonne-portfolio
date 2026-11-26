'use client';
/* =========================================================
   The 3D garage — one WebGL scene for the whole page.
   - the garage: reflective floor, light bars, turntable, 2-post lift,
     a wall of windshields, a roll-up door; outside, a lot at night
   - intro: the car drives in through the door and parks on the turntable
   - explore: orbit all around; lift the car to look underneath
   - glass: click where it is damaged → crack drawn on the real glass
     (three.js DecalGeometry), new glass previewed live, installed
   - parts: the car opens up, each part labelled (what it is made of)
   - drive: the turntable turns the car around, the door opens, drive out
   - "use my car": a model from a photo or a scan replaces the car
   ========================================================= */
import { Suspense, useEffect, useMemo, useReducer, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CameraControls, CameraControlsImpl, Environment, Lightformer, MeshReflectorMaterial } from '@react-three/drei';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { gsap } from '@/lib/motion';
import { useCarModel } from '@/lib/useCar';
import { diagnose, type GlassId } from '@/lib/site';
import { parts as PARTS, type PartId, type PartKind } from '@/lib/studio';
import { bases, type Base, type CrackKind } from '@/lib/lab';
import type { GarageMode } from '@/lib/garage';
import { CANVAS, SPAN, drawBand, drawCrack, drawHeat, drawHud, drawRain, drawSensor, type Drop } from '@/lib/crackgen';

export type V3 = [number, number, number];
export type Impact = { glass: GlassId; point: V3; normal: V3; seed: number; angle: number };
export type PickInfo = Impact & { inView: boolean; nearEdge: boolean };
export type GlassView = 'idle' | 'impact' | 'glass' | 'hero';
export type Stats = { fps: number; calls: number; tris: number };
export type Input = { up: boolean; down: boolean; left: boolean; right: boolean; brake: boolean };

type Props = {
  mode: GarageMode; intro: boolean; lifted: boolean; paint: string; custom: THREE.Object3D | null; customTurn: number;
  view: GlassView; picking: boolean; impact: Impact | null; kind: CrackKind; inch: number; runner: number;
  base: Base | null; addons: string[]; rain: boolean; installAt: number | null; installed: boolean; showZone: boolean;
  explode: number; highlight: PartId | null; tags: React.RefObject<Partial<Record<PartId, HTMLElement | null>>>;
  input: React.RefObject<Input>; lights: boolean;
  touch: boolean; panel: boolean; stacked: boolean; active: boolean;
  onPick: (p: PickInfo) => void; onReady: (c: HTMLCanvasElement) => void; onIntroDone: () => void;
  onSpeed: (mph: number) => void; onPart: (id: PartId) => void; onDriveReady: () => void; onStats?: (s: Stats) => void;
};

const { ACTION } = CameraControlsImpl;
const CAR_LENGTH = 4.4, UP = new THREE.Vector3(0, 1, 0);
const ROOM = { W: 20, D: 14, H: 5.8, door: 6.4, lift: 1.75 };
const MAXD = 6.4; // the camera stays inside the room
const flat = (v: THREE.Vector3) => { v.y = 0; return v.normalize(); };
const nodeToGlass = Object.fromEntries(diagnose.glass.map(g => [g.node, g.id])) as Record<string, GlassId>;
const tmpV = new THREE.Vector3();

/* ---------- small helpers ---------- */
const eachMesh = (o: THREE.Object3D, fn: (m: THREE.Mesh) => void) => o.traverse(x => { if ((x as THREE.Mesh).isMesh) fn(x as THREE.Mesh); });
function centroid(objs: THREE.Object3D[]) {
  const v = new THREE.Vector3(), sum = new THREE.Vector3(); let n = 0;
  objs.forEach(o => eachMesh(o, m => { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i += 3) { sum.add(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)); n++; } }));
  return n ? sum.divideScalar(n) : new THREE.Vector3();
}
const boxOf = (objs: THREE.Object3D[]) => { const b = new THREE.Box3(); objs.forEach(o => b.expandByObject(o)); return b; };
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
const texOf = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
const mkCanvas = (w = 256, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const glassMat = (tint = '#0b1016', opacity = .4) => new THREE.MeshPhysicalMaterial({
  color: tint, roughness: .04, metalness: .1, transparent: true, opacity, envMapIntensity: 2.2,
  clearcoat: 1, clearcoatRoughness: .03, side: THREE.DoubleSide, depthWrite: false,
  emissive: new THREE.Color('#e8102a'), emissiveIntensity: 0, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 620],
});

/* paint variants (KHR_materials_variants) on a subtree, awaitable */
const originals = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
async function applyVariant(gltf: GLTF, root: THREE.Object3D, name: string) {
  const ext = gltf.userData?.gltfExtensions?.KHR_materials_variants as { variants: { name: string }[] } | undefined;
  if (!ext) return;
  const index = ext.variants.findIndex(v => v.name === name);
  const jobs: Promise<void>[] = [];
  root.traverse(o => {
    const m = o as THREE.Mesh;
    const data = m.isMesh ? m.userData.gltfExtensions?.KHR_materials_variants as { mappings: { material: number; variants: number[] }[] } | undefined : undefined;
    if (!data) return;
    if (!originals.has(m)) originals.set(m, m.material);
    const map = data.mappings.find(x => x.variants.includes(index));
    if (map) jobs.push(gltf.parser.getDependency('material', map.material).then((mat: THREE.Material) => { m.material = mat; gltf.parser.assignFinalMaterial(m); }));
    else m.material = originals.get(m)!;
  });
  await Promise.all(jobs);
}

/* =========================================================
   The car: parts on pivots (exploded view), one glass material
   per window (glass lab), headlights, wheel radius (driving)
   ========================================================= */
type Part = { id: PartId; kind: PartKind; pivot: THREE.Group; base: THREE.Vector3; boom: THREE.Vector3; label: THREE.Object3D };
type Zone = { id: GlassId; mesh: THREE.Mesh; mat: THREE.MeshPhysicalMaterial; out: THREE.Vector3; center: THREE.Vector3; u: [number, number]; v: [number, number]; w: [number, number] };

function build(gltf: GLTF) {
  const root = gltf.scene.clone(true);
  root.position.set(0, 0, 0); root.scale.setScalar(1); root.quaternion.identity(); root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
  const s = CAR_LENGTH / Math.max(size.x, size.z);
  root.scale.setScalar(s);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
  root.position.set(-c.x, -box.min.y * s, -c.z);
  root.updateMatrixWorld(true);
  eachMesh(root, m => { m.castShadow = false; m.receiveShadow = false; });
  const get = (n: string) => root.getObjectByName(n)!;
  const height = size.y * s, center = new THREE.Vector3(0, height * .5, 0);
  const front = flat(centroid([get('BodyWindshield')]).sub(centroid([get('BodyRearwindow')])));
  const side = flat(centroid([get('BodyDoorLColor1')]).sub(center));
  const owner = new WeakMap<THREE.Object3D, PartId>();
  const toLocal = (w: THREE.Vector3) => root.worldToLocal(w.clone());

  /* glass zones first (world positions at rest) */
  const zones: Zone[] = diagnose.glass.map(g => {
    const m = get(g.node) as THREE.Mesh, mat = glassMat();
    m.material = mat;
    const pos = m.geometry.attributes.position, p = new THREE.Vector3();
    const u: [number, number] = [Infinity, -Infinity], v: [number, number] = [Infinity, -Infinity], w: [number, number] = [Infinity, -Infinity];
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const a = p.dot(side), b = p.y, f = p.dot(front);
      if (g.id === 'quarter' && a < 0) continue;
      u[0] = Math.min(u[0], a); u[1] = Math.max(u[1], a); v[0] = Math.min(v[0], b); v[1] = Math.max(v[1], b); w[0] = Math.min(w[0], f); w[1] = Math.max(w[1], f);
    }
    const cc = side.clone().multiplyScalar((u[0] + u[1]) / 2).addScaledVector(UP, (v[0] + v[1]) / 2).addScaledVector(front, (w[0] + w[1]) / 2);
    const out = g.id === 'windshield' ? front.clone() : g.id === 'rear' ? front.clone().negate() : g.id === 'passenger' ? side.clone().negate() : side.clone();
    return { id: g.id, mesh: m, mat, out, center: cc, u, v, w };
  });

  /* parts on pivots (the door glass travels with its door) */
  const list: Part[] = PARTS.map(p => {
    const names = p.id === 'doorL' ? [...p.nodes, 'BodyDoorLWindow'] : p.id === 'doorR' ? [...p.nodes, 'BodyDoorRWindow'] : p.nodes;
    const nodes = names.map(get).filter(Boolean);
    const cw = centroid(nodes), bb = boxOf(nodes);
    const pivot = new THREE.Group(); root.add(pivot); pivot.position.copy(toLocal(cw)); pivot.updateMatrixWorld(true);
    nodes.forEach(n => pivot.attach(n));
    pivot.traverse(o => owner.set(o, p.id));
    const rel = cw.clone().sub(center);
    const boom = rel.clone(); boom.y = boom.y * 1.6 + (p.kind === 'seats' || p.kind === 'engine' ? .9 : p.kind === 'roof' ? .8 : .2);
    boom.normalize().multiplyScalar(p.kind === 'wheel' ? .8 : 1.05);
    const label = new THREE.Object3D(); pivot.add(label); label.position.set(0, (bb.max.y - cw.y) / s + .08 / s, 0);
    return { id: p.id, kind: p.kind, pivot, base: pivot.position.clone(), boom: boom.divideScalar(s), label };
  });
  const byId = Object.fromEntries(list.map(p => [p.id, p])) as Record<PartId, Part>;

  const headMesh = get('BodyHeadlights') as THREE.Mesh;
  const headMat = (headMesh.material as THREE.MeshStandardMaterial).clone(); headMesh.material = headMat;
  const hc = centroid([headMesh]);
  const beams = [1, -1].map(k => {
    const l = new THREE.SpotLight('#f4f6ff', 0, 40, .42, .5, 1.1);
    const p = hc.clone().addScaledVector(side, k * .6).addScaledVector(front, .1);
    root.add(l); l.position.copy(toLocal(p));
    root.add(l.target); l.target.position.copy(toLocal(p.clone().addScaledVector(front, 10).setY(0)));
    return l;
  });
  const wr = boxOf([byId.wheelFL.pivot]).getSize(new THREE.Vector3()).y / 2;
  const wheelbase = centroid([byId.wheelFL.pivot]).sub(centroid([byId.wheelRL.pivot])).length();
  root.updateMatrixWorld(true);
  return { gltf, root, scale: s, center, front, side, height, list, byId, owner, zones, headMat, beams, wr, wheelbase };
}
type Rig = ReturnType<typeof build>;

/* a point on the windshield / rear glass at (u along the car's left, v height), by a ray from outside */
const ray = new THREE.Raycaster();
function onGlass(r: Rig, z: Zone, u: number, v: number) {
  const o = flat(z.out.clone());
  ray.set(r.side.clone().multiplyScalar(u).addScaledVector(UP, v).addScaledVector(o, 4), o.clone().negate());
  const hit = ray.intersectObject(z.mesh, false)[0];
  if (!hit) return null;
  const n = hit.face!.normal.clone().transformDirection(z.mesh.matrixWorld);
  if (n.dot(z.out) < 0) n.negate();
  return { p: hit.point.clone(), n };
}
function decal(mesh: THREE.Mesh, p: THREE.Vector3, n: THREE.Vector3, w: number, h: number) {
  const o = new THREE.Object3D(); o.position.copy(p); o.lookAt(p.clone().add(n));
  return new DecalGeometry(mesh, p, o.rotation, new THREE.Vector3(w, h, .5));
}

/* =========================================================
   The garage. Room axes follow the car: +x = the car's front.
   Door in the back wall (−x), windshield wall in front (+x).
   ========================================================= */
function Garage({ front, doorOpen, lifted, spin, baseId, mode }: { front: THREE.Vector3; doorOpen: boolean; lifted: boolean; spin: React.RefObject<number>; baseId: string | null; mode: GarageMode }) {
  const rot = Math.atan2(-front.z, front.x);
  const { W, D, H } = ROOM;
  const door = useRef<THREE.Group>(null), table = useRef<THREE.Group>(null), arms = useRef<THREE.Group>(null);
  const openK = useRef(doorOpen ? 1 : 0), liftK = useRef(0);
  const tex = useMemo(() => ({
    wall: canvasTex(512, 256, g => {
      g.fillStyle = '#121317'; g.fillRect(0, 0, 512, 256);
      for (let x = 0; x < 512; x += 32) { g.fillStyle = 'rgba(255,255,255,.025)'; g.fillRect(x, 0, 2, 256); }
    }, [6, 1]),
    sign: canvasTex(1024, 256, g => {
      g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 1024, 256);
      g.shadowColor = '#ffffff'; g.shadowBlur = 24; g.fillStyle = '#ffffff';
      g.font = '800 132px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('RYONNE', 512, 112);
      g.shadowColor = '#e8102a'; g.fillStyle = '#e8102a'; g.fillRect(352, 196, 320, 9);
    }),
    door: canvasTex(256, 256, g => {
      g.fillStyle = '#2a2d33'; g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 22) { g.fillStyle = '#1b1d21'; g.fillRect(0, y, 256, 3); g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, y + 3, 256, 1); }
    }),
    ring: canvasTex(512, 512, g => {
      g.fillStyle = '#0c0d10'; g.beginPath(); g.arc(256, 256, 256, 0, Math.PI * 2); g.fill();
      for (let r = 40; r < 250; r += 26) { g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 2; g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke(); }
    }),
  }), []);
  // the windshield wall: one sample of each windshield the lab offers
  const samples = bases.windshield;

  useFrame((_, dt) => {
    openK.current = THREE.MathUtils.damp(openK.current, doorOpen ? 1 : 0, 2.2, dt);
    if (door.current) { door.current.position.y = 2.1 + openK.current * 3.2; door.current.scale.y = 1 - openK.current * .85; }
    liftK.current = THREE.MathUtils.damp(liftK.current, lifted ? 1 : 0, 2, dt);
    if (arms.current) arms.current.position.y = liftK.current * ROOM.lift;
    if (table.current) table.current.rotation.y = spin.current ?? 0;
  });

  const dw = ROOM.door;
  return (
    <group rotation-y={rot}>
      {/* floor: polished concrete that reflects the car */}
      <mesh rotation-x={-Math.PI / 2} position-y={0}>
        <planeGeometry args={[W, D]} />
        <MeshReflectorMaterial resolution={512} blur={[400, 120]} mixBlur={1} mixStrength={22} roughness={.85} depthScale={1}
          minDepthThreshold={.4} maxDepthThreshold={1.3} color="#16171b" metalness={.4} mirror={.6} />
      </mesh>
      {/* ceiling + light bars */}
      <mesh position={[0, H, 0]} rotation-x={Math.PI / 2}><planeGeometry args={[W, D]} /><meshStandardMaterial color="#08090b" /></mesh>
      {[-3.6, 0, 3.6].map(z => <mesh key={z} position={[0, H - .03, z]}><boxGeometry args={[W - 3, .04, .14]} /><meshBasicMaterial color="#f4f6ff" toneMapped={false} /></mesh>)}
      {[-6, 0, 6].map(x => <pointLight key={x} position={[x, H - .8, 0]} intensity={10} distance={14} decay={1.3} color="#eef1ff" />)}
      <hemisphereLight args={['#c9d3e8', '#0b0c10', .35]} />
      {/* walls: sides and front */}
      <mesh position={[0, H / 2, -D / 2]}><planeGeometry args={[W, H]} /><meshStandardMaterial map={tex.wall} /></mesh>
      <mesh position={[0, H / 2, D / 2]} rotation-y={Math.PI}><planeGeometry args={[W, H]} /><meshStandardMaterial map={tex.wall} /></mesh>
      <mesh position={[W / 2, H / 2, 0]} rotation-y={-Math.PI / 2}><planeGeometry args={[D, H]} /><meshStandardMaterial color="#101114" /></mesh>
      {/* back wall with the door opening */}
      {[-1, 1].map(k => <mesh key={k} position={[-W / 2, H / 2, k * (dw / 2 + (D - dw) / 4)]} rotation-y={Math.PI / 2}><planeGeometry args={[(D - dw) / 2, H]} /><meshStandardMaterial color="#101114" side={THREE.DoubleSide} /></mesh>)}
      <mesh position={[-W / 2, (H + 4.2) / 2, 0]} rotation-y={Math.PI / 2}><planeGeometry args={[dw, H - 4.2]} /><meshStandardMaterial color="#101114" side={THREE.DoubleSide} /></mesh>
      <group ref={door} position={[-W / 2 + .02, 2.1, 0]}>
        <mesh rotation-y={Math.PI / 2}><planeGeometry args={[dw, 4.2]} /><meshStandardMaterial map={tex.door} metalness={.5} roughness={.45} side={THREE.DoubleSide} /></mesh>
      </group>
      {/* neon sign over the windshield wall */}
      <mesh position={[W / 2 - .03, 4.3, 0]} rotation-y={-Math.PI / 2}><planeGeometry args={[4.6, 1.15]} /><meshBasicMaterial map={tex.sign} transparent toneMapped={false} /></mesh>
      <pointLight position={[W / 2 - 1, 4.2, 0]} intensity={6} distance={6} color="#ff3045" />
      {/* the windshield wall: a rail with one of each glass */}
      <mesh position={[W / 2 - .12, 3.05, 0]}><boxGeometry args={[.06, .06, 10.6]} /><meshStandardMaterial color="#3a3d44" metalness={1} roughness={.3} /></mesh>
      {samples.map((b, i) => {
        const z = (i - (samples.length - 1) / 2) * 1.75, on = mode === 'glass' && b.id === baseId;
        return (
          <group key={b.id} position={[W / 2 - .2, 2.15, z]} rotation-y={-Math.PI / 2}>
            <mesh rotation-x={-.12}><planeGeometry args={[1.5, 1.05]} /><meshPhysicalMaterial color={b.tint} transparent opacity={b.opacity + .15} roughness={.05} metalness={.2} envMapIntensity={2} iridescence={b.iridescence ?? 0} side={THREE.DoubleSide} /></mesh>
            {b.band && <mesh position={[0, .38, .005]} rotation-x={-.12}><planeGeometry args={[1.5, .26]} /><meshBasicMaterial color="#1b6a7a" transparent opacity={.7} /></mesh>}
            {b.hud && <mesh position={[-.3, -.15, .006]} rotation-x={-.12}><planeGeometry args={[.32, .14]} /><meshBasicMaterial color="#7dffb2" transparent opacity={.6} toneMapped={false} /></mesh>}
            <mesh position={[0, -.62, .02]}><boxGeometry args={[1.56, .03, .03]} /><meshBasicMaterial color={on ? '#e8102a' : '#2a2c31'} toneMapped={false} /></mesh>
            {on && <pointLight position={[0, 0, .8]} intensity={4} distance={3} color="#ffffff" />}
          </group>
        );
      })}
      {/* turntable */}
      <group ref={table}>
        <mesh rotation-x={-Math.PI / 2} position-y={.012}><circleGeometry args={[3.1, 96]} /><meshStandardMaterial map={tex.ring} metalness={.6} roughness={.35} /></mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={.014}><ringGeometry args={[3.08, 3.16, 128]} /><meshBasicMaterial color="#e8102a" toneMapped={false} /></mesh>
      </group>
      {/* 2-post lift: posts beside the car, arms rise with it */}
      {[-1, 1].map(k => (
        <group key={k} position={[0, 0, k * 2.7]}>
          <mesh position={[0, 1.45, 0]}><boxGeometry args={[.24, 2.9, .24]} /><meshStandardMaterial color="#c4161c" metalness={.3} roughness={.35} /></mesh>
          <mesh position={[0, .03, 0]}><boxGeometry args={[.6, .06, .6]} /><meshStandardMaterial color="#1a1b1f" /></mesh>
        </group>
      ))}
      <group ref={arms}>
        {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, k], i) => (
          <mesh key={i} position={[a * .7, .1, k * 1.6]} rotation-y={a * k * .45}><boxGeometry args={[2.3, .08, .12]} /><meshStandardMaterial color="#2c2e33" metalness={.8} roughness={.3} /></mesh>
        ))}
      </group>
      {/* outside: the building's shell, and the lot */}
      <mesh position={[0, H + .02, 0]} rotation-x={-Math.PI / 2}><planeGeometry args={[W + .4, D + .4]} /><meshStandardMaterial color="#1b1d22" /></mesh>
      {[[0, -D / 2 - .02, Math.PI], [0, D / 2 + .02, 0], [W / 2 + .02, 0, Math.PI / 2]].map(([x, z, ry], i) => (
        <mesh key={i} position={[x, H / 2, z]} rotation-y={ry}><planeGeometry args={[i < 2 ? W + .4 : D + .4, H]} /><meshStandardMaterial color="#202329" /></mesh>
      ))}
      <mesh position={[-W / 2 - .03, H - .5, 0]} rotation-y={-Math.PI / 2}><planeGeometry args={[4.2, 1.05]} /><meshBasicMaterial map={tex.sign} transparent toneMapped={false} /></mesh>
      <Lot />
    </group>
  );
}

function Lot() {
  const tex = useMemo(() => canvasTex(512, 512, g => {
    g.fillStyle = '#17181c'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * .05})`; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
    g.fillStyle = 'rgba(255,255,255,.5)'; for (let y = 0; y < 512; y += 64) g.fillRect(254, y, 4, 34);
  }, [60, 60]), []);
  const cones = useMemo(() => {
    const m = new THREE.InstancedMesh(new THREE.ConeGeometry(.22, .7, 12), new THREE.MeshStandardMaterial({ color: '#ff5a1f', roughness: .5 }), 60);
    const o = new THREE.Object3D();
    for (let i = 0; i < 60; i++) { o.position.set(-18 - (i % 30) * 4, .35, (i < 30 ? -1 : 1) * 7); o.updateMatrix(); m.setMatrixAt(i, o.matrix); }
    return m;
  }, []);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-.004}><planeGeometry args={[600, 600]} /><meshStandardMaterial map={tex} roughness={.9} /></mesh>
      <primitive object={cones} />
      {[-30, -60, -90].map(x => (
        <group key={x} position={[x, 0, 9]}>
          <mesh position={[0, 3, 0]}><cylinderGeometry args={[.08, .1, 6]} /><meshStandardMaterial color="#2a2c31" /></mesh>
          <mesh position={[0, 6, -.6]}><boxGeometry args={[.4, .1, 1.4]} /><meshBasicMaterial color="#ffe7c2" toneMapped={false} /></mesh>
          <pointLight position={[0, 5.6, -.8]} intensity={30} distance={22} decay={1.4} color="#ffd9a0" />
        </group>
      ))}
      <fog attach="fog" args={['#07080b', 30, 160]} />
    </group>
  );
}

/* =========================================================
   The car with everything laid on it
   ========================================================= */
function Car(p: Props & { rigRef: React.RefObject<Rig | null>; spin: React.RefObject<number>; onDoor: (open: boolean) => void }) {
  const gltf = useCarModel();
  const r = useMemo(() => build(gltf), [gltf]);
  const car = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const hover = useRef<GlassId | null>(null);
  useEffect(() => { p.rigRef.current = r; }, [r, p.rigRef]);
  const sz = useThree(s => s.size);
  useEffect(() => { // test helper (dev only): where a glass is on screen
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as { __gxProbe?: unknown }).__gxProbe = (id: GlassId, du = 0, dv = 0) => {
      const zz = r.zones.find(x => x.id === id)!;
      const q = (id === 'windshield' || id === 'rear') ? onGlass(r, zz, (zz.u[0] + zz.u[1]) / 2 + du, (zz.v[0] + zz.v[1]) / 2 + dv) : null;
      const v = (q?.p ?? zz.center).clone().project(camera);
      return [(v.x + 1) / 2 * sz.width, (1 - v.y) / 2 * sz.height];
    };
  }, [r, camera, sz]);
  const across = useMemo(() => new THREE.Vector3(-r.front.z, 0, r.front.x), [r]); // room z axis

  const z = p.custom ? null : r.zones.find(x => x.id === p.impact?.glass) ?? null;
  const W = r.zones.find(x => x.id === 'windshield')!;

  /* a car from a photo or a scan: lay its long side along the garage, then the visitor can turn it around */
  useEffect(() => {
    const c = p.custom; if (!c) return;
    c.rotation.set(0, 0, 0); c.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(c).getSize(new THREE.Vector3());
    const along = Math.atan2(-r.front.z, r.front.x); // turns local +x onto the car's front
    c.rotation.y = along + (size.x >= size.z ? 0 : Math.PI / 2) + p.customTurn * Math.PI;
    c.updateMatrixWorld(true);
  }, [p.custom, p.customTurn, r]);

  /* paint (the glass keeps its own materials) */
  useEffect(() => {
    applyVariant(r.gltf, r.root, p.paint).then(() => r.zones.forEach(x => { x.mesh.material = x.mat; }));
  }, [p.paint, r]);

  /* headlights */
  const lightsOn = p.lights || p.intro;
  useEffect(() => {
    r.headMat.emissiveIntensity = lightsOn ? 3 : 0;
    r.beams.forEach(b => gsap.to(b, { intensity: lightsOn ? 50 : 0, duration: .3 }));
  }, [lightsOn, r]);

  /* ---------- intro: drive in through the door, park on the turntable ---------- */
  const introT = useRef(-1);
  const drive = useRef({ v: 0, steer: 0, heading: 0, spin: 0, pos: new THREE.Vector3(), t: 0, ready: false, turn: 0 });
  useEffect(() => {
    if (p.intro) { introT.current = 0; p.onDoor(true); return; }
    introT.current = -1; drive.current.pos.set(0, 0, 0); drive.current.spin = 0;
    if (p.mode !== 'drive') p.onDoor(false);
  }, [p.intro]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- drive: the turntable turns the car to the door, the door opens ---------- */
  useEffect(() => {
    const D = drive.current;
    if (p.mode === 'drive') {
      Object.assign(D, { v: 0, steer: 0, heading: 0, spin: 0, ready: false, turn: 0 }); D.pos.set(0, 0, 0);
      const k = { a: 0 };
      gsap.to(k, { a: Math.PI, duration: 2.2, ease: 'power2.inOut', delay: .4, onUpdate: () => { D.heading = k.a; p.spin.current = k.a; }, onComplete: () => { p.onDoor(true); D.ready = true; p.onDriveReady(); } });
      camera.position.copy(r.front).multiplyScalar(7).addScaledVector(across, 3.5).setY(2.4);
    } else {
      D.ready = false; D.heading = 0; D.pos.set(0, 0, 0); p.spin.current = 0;
      if (car.current) { car.current.position.set(0, 0, 0); car.current.rotation.set(0, 0, 0); }
      if (!p.intro) p.onDoor(false);
      r.list.forEach(pt => pt.pivot.quaternion.identity());
    }
  }, [p.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- glass overlays (canvas textures + decals) ---------- */
  const crack = useMemo(() => { const c = mkCanvas(CANVAS); return { c, t: texOf(c) }; }, []);
  const customHit = useRef<THREE.Mesh | null>(null);
  const crackGeo = useMemo(() => {
    if (!p.impact) return null;
    const mesh = p.custom ? customHit.current : z?.mesh;
    if (!mesh) return null;
    return decal(mesh, new THREE.Vector3(...p.impact.point), new THREE.Vector3(...p.impact.normal), SPAN, SPAN);
  }, [p.impact, z, p.custom]);
  const reveal = useRef(1), revealFrom = useRef(0), drawn = useRef('');
  useEffect(() => { reveal.current = 0; revealFrom.current = performance.now(); }, [p.impact]);

  const ov = useMemo(() => {
    const band = mkCanvas(); drawBand(band);
    const heat = mkCanvas(); drawHeat(heat);
    const sensor = mkCanvas(); drawSensor(sensor);
    const hud = mkCanvas(512, 256), rain = mkCanvas(512), zoneC = mkCanvas(512, 256);
    { const g = zoneC.getContext('2d')!;
      g.fillStyle = 'rgba(232,16,42,.12)'; g.fillRect(0, 0, 512, 256);
      g.setLineDash([16, 12]); g.lineWidth = 6; g.strokeStyle = 'rgba(232,16,42,.9)'; g.strokeRect(4, 4, 504, 248);
      g.fillStyle = 'rgba(232,16,42,.95)'; g.fillRect(4, 4, 196, 40); g.fillStyle = '#fff'; g.font = '700 22px Arial'; g.textAlign = 'left'; g.fillText("DRIVER'S VIEW", 16, 32); }
    const span = (zz: Zone) => ({ W: zz.u[1] - zz.u[0], H: Math.hypot(zz.v[1] - zz.v[0], zz.w[1] - zz.w[0]) });
    const geo = (zz: Zone, u: number, v: number, w: number, h: number) => { const q = onGlass(r, zz, u, v); return q ? decal(zz.mesh, q.p, q.n, w, h) : null; };
    const ws = span(W), um = (W.u[0] + W.u[1]) / 2;
    const R = r.zones.find(x => x.id === 'rear')!, rs = span(R);
    const drv = { u: um + ws.W * .22, v: W.v[0] + (W.v[1] - W.v[0]) * .5 };
    return {
      t: { band: texOf(band), heat: texOf(heat), sensor: texOf(sensor), hud: texOf(hud), rain: texOf(rain), zone: texOf(zoneC) },
      c: { hud, rain },
      g: {
        band: geo(W, um, W.v[1] - (W.v[1] - W.v[0]) * .14, ws.W * 1.1, ws.H * .32),
        heat: geo(W, um, W.v[0] + (W.v[1] - W.v[0]) * .06, ws.W * 1.05, ws.H * .16),
        sensor: geo(W, um, W.v[1] - (W.v[1] - W.v[0]) * .1, .13, .13),
        hud: geo(W, drv.u, W.v[0] + (W.v[1] - W.v[0]) * .3, .4, .2),
        zone: geo(W, drv.u, drv.v, ws.W * .34, ws.H * .5),
        grid: geo(R, (R.u[0] + R.u[1]) / 2, (R.v[0] + R.v[1]) / 2, rs.W * .85, rs.H * .7),
      },
      drv, ws,
    };
  }, [r, W]);
  const rainGeo = useMemo(() => {
    if (!z) return null;
    const q = z.id === 'windshield' || z.id === 'rear' ? onGlass(r, z, (z.u[0] + z.u[1]) / 2, (z.v[0] + z.v[1]) / 2) : null;
    return decal(z.mesh, q?.p ?? z.center, q?.n ?? z.out, 2.2, 1.6);
  }, [z, r]);
  const drops = useRef<Drop[]>([]);

  /* install: the cracked glass flies out, the new one drops in */
  const flyOld = useRef<THREE.Group>(null), flyNew = useRef<THREE.Group>(null), crackRef = useRef<THREE.Group>(null);
  const oldMat = useMemo(() => glassMat(), []);
  const flyGeo = useMemo(() => { if (!z) return null; const g = z.mesh.geometry.clone(); g.applyMatrix4(z.mesh.matrixWorld); return g; }, [z]);

  /* ---------- every frame ---------- */
  const fps = useRef({ t: 0, n: 0 }), hudT = useRef(0), rainT = useRef(0), boom = useRef(0), lift = useRef(0);
  useFrame((st, dtRaw) => {
    const dt = Math.min(dtRaw, .05), t = st.clock.elapsedTime, now = performance.now();
    const g = car.current; if (!g) return;
    const D = drive.current;

    /* intro */
    if (p.intro && introT.current >= 0) {
      introT.current += dt;
      const e = introT.current, k = 1 - Math.pow(1 - Math.min(1, e / 5.2), 3);
      D.pos.copy(r.front).multiplyScalar(-17 * (1 - k));
      D.spin = 17 * k / r.wr;
      const cam = st.camera;
      cam.position.copy(r.front).multiplyScalar(6.6 - e * .12).addScaledVector(across, -1.6).setY(1.25 + e * .05);
      cam.lookAt(tmpV.copy(D.pos).setY(.8));
      if (e > 5.6) p.onDoor(false);
      if (e > 6.6) { introT.current = -1; p.onIntroDone(); }
    }

    /* lift */
    lift.current = THREE.MathUtils.damp(lift.current, p.lifted ? ROOM.lift : 0, 2, dt);

    /* drive */
    if (p.mode === 'drive' && D.ready) {
      const I = p.input.current!;
      const accel = I.up ? 9 : 0, brake = I.down ? (D.v > .5 ? 16 : 6) : 0;
      D.v += (accel - (D.v > 0 ? brake : -brake * (I.down ? 1 : 0))) * dt;
      if (I.down && D.v <= .5) D.v = Math.max(D.v - 6 * dt, -7);
      D.v *= I.brake ? Math.pow(.2, dt) : Math.pow(.985, dt * 60);
      D.v = THREE.MathUtils.clamp(D.v, -7, 38);
      const steerT = (I.left ? 1 : 0) - (I.right ? 1 : 0);
      D.steer = THREE.MathUtils.damp(D.steer, steerT * .5 * (1 - Math.min(Math.abs(D.v) / 60, .6)), 8, dt);
      D.heading += D.v * Math.tan(D.steer) / r.wheelbase * dt;
      const fw = r.front.clone().applyAxisAngle(UP, D.heading);
      D.pos.addScaledVector(fw, D.v * dt);
      // walls: the car leaves through the door only (back wall, −x)
      let x = D.pos.dot(r.front), zz = D.pos.dot(across);
      const was = [x, zz], HL = 2.3, HW = 1.15, WALL = ROOM.W / 2, HD = ROOM.door / 2;
      if (x > -WALL) {
        zz = THREE.MathUtils.clamp(zz, -ROOM.D / 2 + HW, ROOM.D / 2 - HW); x = Math.min(x, WALL - HL);
        if (Math.abs(zz) > HD - HW && x < -WALL + HL) x = -WALL + HL;
      } else if (x > -WALL - HL && Math.abs(zz) > HD - HW) x = -WALL - HL;
      x = Math.max(x, -200); zz = THREE.MathUtils.clamp(zz, -150, 150);
      if (x !== was[0] || zz !== was[1]) { D.v *= -.25; D.pos.copy(r.front).multiplyScalar(x).addScaledVector(across, zz); }
      D.spin += D.v * dt / r.wr;
      const cam = st.camera as THREE.PerspectiveCamera;
      const want = D.pos.clone().addScaledVector(fw, -7.5 - Math.abs(D.v) * .05).setY(2.6 + Math.abs(D.v) * .02);
      cam.position.lerp(want, 1 - Math.pow(.02, dt));
      cam.lookAt(tmpV.copy(D.pos).addScaledVector(fw, 2).setY(.9));
      D.t += dt; if (D.t > .1) { D.t = 0; p.onSpeed(Math.abs(D.v) * 2.237); }
    } else if (p.mode === 'drive') {
      const cam = st.camera;
      cam.lookAt(0, .8, 0);
    }
    g.position.copy(D.pos).setY(lift.current); g.rotation.set(0, D.heading, 0);
    // wheels roll (and steer when driving)
    r.list.forEach(pt => {
      if (pt.kind !== 'wheel') return;
      const q = new THREE.Quaternion().setFromAxisAngle(r.side, -D.spin);
      if (p.mode === 'drive' && (pt.id === 'wheelFL' || pt.id === 'wheelFR')) q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, D.steer));
      pt.pivot.quaternion.copy(q);
    });

    /* parts: the car opens up */
    boom.current = THREE.MathUtils.damp(boom.current, p.mode === 'parts' ? p.explode : 0, 4, dt);
    r.list.forEach(pt => {
      pt.pivot.position.copy(pt.base).addScaledVector(pt.boom, boom.current);
      pt.pivot.scale.setScalar(p.highlight === pt.id && boom.current > .2 ? 1 + .03 * Math.sin(t * 7) : 1);
      const el = p.tags.current?.[pt.id];
      if (el) {
        pt.label.getWorldPosition(tmpV); tmpV.project(st.camera);
        el.style.transform = `translate(${(tmpV.x + 1) / 2 * st.size.width}px, ${(1 - tmpV.y) / 2 * st.size.height}px)`;
        el.style.opacity = p.mode === 'parts' && boom.current > .3 && tmpV.z < 1 ? '1' : '0';
      }
    });

    /* glass looks */
    for (const x of r.zones) {
      const mine = x === z, b = mine && p.mode === 'glass' || (mine && p.installed) ? p.base : null;
      const op = b?.opacity ?? .4;
      x.mat.color.lerp(tmpColor.set(b?.tint ?? '#0b1016'), Math.min(1, dt * 6));
      x.mat.opacity = THREE.MathUtils.damp(x.mat.opacity, op, 6, dt);
      x.mat.iridescence = THREE.MathUtils.damp(x.mat.iridescence, b?.iridescence ?? 0, 4, dt);
      const dark = Math.max(0, op - .4);
      x.mat.envMapIntensity = THREE.MathUtils.damp(x.mat.envMapIntensity, Math.max(.25, 2.2 - dark * 4.4), 6, dt);
      x.mat.clearcoat = THREE.MathUtils.damp(x.mat.clearcoat, Math.max(.15, 1 - dark * 1.6), 6, dt);
      x.mat.specularIntensity = THREE.MathUtils.damp(x.mat.specularIntensity, Math.max(.1, 1 - dark * 2.2), 6, dt);
      const glow = p.picking && hover.current === x.id ? .55 + .25 * Math.sin(t * 4) : 0;
      x.mat.emissiveIntensity = THREE.MathUtils.damp(x.mat.emissiveIntensity, glow, 10, dt);
      if (x.mesh.material !== x.mat) x.mesh.material = x.mat;
    }
    /* the damage */
    if (p.impact) {
      reveal.current = Math.min(1, (now - revealFrom.current) / 900);
      const key = [p.impact.seed, p.kind, p.inch.toFixed(2), p.runner.toFixed(3), reveal.current.toFixed(2)].join('|');
      if (key !== drawn.current) {
        drawn.current = key;
        drawCrack(crack.c, { kind: p.kind, inch: p.inch, runner: p.runner, reveal: 1 - Math.pow(1 - reveal.current, 3), seed: p.impact.seed, angle: p.impact.angle });
        crack.t.needsUpdate = true;
      }
    }
    if (p.base?.hud && (hudT.current -= dt) < 0) { hudT.current = .12; drawHud(ov.c.hud, 41 + Math.sin(t * .7) * 3); ov.t.hud.needsUpdate = true; }
    if (p.rain && (rainT.current -= dt) < 0) {
      rainT.current = 1 / 30;
      const coated = p.addons.includes('coat'), Dd = drops.current, S = 512;
      for (let i = 0; i < (coated ? 3 : 5); i++) Dd.push({ x: Math.random() * S, y: Math.random() * S * .9, r: coated ? 1.5 + Math.random() * 3.5 : 2 + Math.random() * 3.5, v: 0 });
      for (const d of Dd) { d.v += coated ? (d.r > 3.2 ? 2.6 : .25) : .1; d.y += d.v; }
      drops.current = Dd.filter(d => d.y < S + 20).slice(-(coated ? 90 : 260));
      drawRain(ov.c.rain, drops.current, coated); ov.t.rain.needsUpdate = true;
    }
    if (p.installAt && flyOld.current && flyNew.current && z) {
      const e = (now - p.installAt) / 1000, o = flat(z.out.clone());
      const k1 = THREE.MathUtils.smoothstep(e, .15, 1.15), k2 = 1 - THREE.MathUtils.smoothstep(e, 1.25, 2.35);
      flyOld.current.visible = e < 1.2;
      flyOld.current.position.copy(o).multiplyScalar(k1 * 2.4).addScaledVector(UP, k1 * 1.4);
      oldMat.opacity = .45 * (1 - k1);
      flyNew.current.visible = e > 1.15 && e < 2.5;
      flyNew.current.position.copy(o).multiplyScalar(k2 * .8).addScaledVector(UP, k2 * 2.2);
      z.mesh.visible = e >= 2.5;
      if (crackRef.current) crackRef.current.visible = e < .2;
    } else {
      if (z) z.mesh.visible = true;
      if (flyOld.current) flyOld.current.visible = false;
      if (flyNew.current) flyNew.current.visible = false;
      if (crackRef.current) crackRef.current.visible = !p.installed && (p.mode === 'glass' || p.mode === 'explore');
    }
    if (p.onStats) {
      const a = fps.current; a.t += dtRaw; a.n++;
      if (a.t > .5) { const i = st.gl.info; p.onStats({ fps: Math.round(a.n / a.t), calls: i.render.calls, tris: i.render.triangles }); a.t = 0; a.n = 0; }
    }
  });

  /* ---------- picking ---------- */
  const partOf = (o: THREE.Object3D | null) => { while (o) { const id = r.owner.get(o); if (id) return id; o = o.parent; } return null; };
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6 || p.installAt) return;
    if (p.mode === 'parts') { const id = partOf(e.object); if (id) { e.stopPropagation(); p.onPart(id); } return; }
    if (!p.picking) return;
    const id = nodeToGlass[e.object.name]; if (!id) return;
    e.stopPropagation();
    const zz = r.zones.find(x => x.id === id)!;
    const n = e.face ? e.face.normal.clone().transformDirection(e.object.matrixWorld) : zz.out.clone();
    if (n.dot(zz.out) < 0) n.negate();
    const pt = e.point.clone(), a = pt.dot(r.side), b = pt.y, f = pt.dot(r.front);
    const lat = id === 'windshield' || id === 'rear' ? [a, zz.u] as const : [f, zz.w] as const;
    const nearEdge = Math.min(lat[0] - lat[1][0], lat[1][1] - lat[0], (b - zz.v[0]) * 1.6, (zz.v[1] - b) * 1.6) < .07;
    const inView = id === 'windshield' && Math.abs(a - ov.drv.u) < ov.ws.W * .17 && Math.abs(b - ov.drv.v) < (zz.v[1] - zz.v[0]) * .28;
    p.onPick({ glass: id, point: pt.toArray() as V3, normal: n.toArray() as V3, seed: 1 + Math.floor(Math.random() * 1e6), angle: Math.random() * Math.PI * 2, inView, nearEdge });
  };
  const clickCustom = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6 || !p.picking) return;
    e.stopPropagation();
    customHit.current = e.object as THREE.Mesh;
    const n = e.face ? e.face.normal.clone().transformDirection(e.object.matrixWorld) : UP.clone();
    p.onPick({ glass: 'windshield', point: e.point.toArray() as V3, normal: n.toArray() as V3, seed: 1 + Math.floor(Math.random() * 1e6), angle: Math.random() * Math.PI * 2, inView: false, nearEdge: false });
  };
  const setHover = (id: GlassId | null) => {
    hover.current = id;
    const wrap = document.querySelector<HTMLElement>('.gx__stage');
    if (wrap) wrap.dataset.cursor = (id && p.picking) || (p.mode === 'parts' && id) ? 'hit' : '';
  };

  const noRay = () => null;
  const isW = z?.id === 'windshield', b = p.mode === 'glass' || p.installed ? p.base : null, on = (id: string) => p.addons.includes(id) && (p.mode === 'glass' || p.installed);
  const Dc = (geo: THREE.BufferGeometry | null | undefined, t: THREE.Texture, opts: Partial<THREE.MeshBasicMaterialParameters> = {}) =>
    geo && <mesh geometry={geo} raycast={noRay} renderOrder={12}>
      <meshBasicMaterial map={t} transparent depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-4} {...opts} />
    </mesh>;

  return (
    <group ref={car}>
      <primitive object={r.root} visible={!p.custom} onClick={click}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => setHover(p.mode === 'parts' ? (partOf(e.object) as unknown as GlassId) : nodeToGlass[e.object.name] ?? null)}
        onPointerOut={() => setHover(null)} />
      {p.custom && <primitive object={p.custom} onClick={clickCustom} />}
      {p.impact && crackGeo && <group ref={crackRef}>{Dc(crackGeo, crack.t)}</group>}
      {!p.custom && <>
        {p.showZone && isW && Dc(ov.g.zone, ov.t.zone, { opacity: .9 })}
        {isW && b?.band && Dc(ov.g.band, ov.t.band)}
        {isW && on('heat') && Dc(ov.g.heat, ov.t.heat, { blending: THREE.AdditiveBlending })}
        {isW && on('rain') && Dc(ov.g.sensor, ov.t.sensor)}
        {isW && b?.hud && Dc(ov.g.hud, ov.t.hud, { blending: THREE.AdditiveBlending })}
        {z?.id === 'rear' && b && Dc(ov.g.grid, ov.t.heat, { color: '#7a3a22', opacity: .85 })}
        {p.rain && Dc(rainGeo, ov.t.rain, { opacity: .95 })}
        {flyGeo && z && <>
          <group ref={flyOld} visible={false}><mesh geometry={flyGeo} material={oldMat} raycast={noRay} />{crackGeo && Dc(crackGeo, crack.t)}</group>
          <group ref={flyNew} visible={false}><mesh geometry={flyGeo} material={z.mat} raycast={noRay} /></group>
        </>}
      </>}
    </group>
  );
}
const tmpColor = new THREE.Color();

/* =========================================================
   Camera for the orbit modes
   ========================================================= */
function Cam({ rigRef, mode, view, impact, lifted, panel, stacked }: { rigRef: React.RefObject<Rig | null>; mode: GarageMode; view: GlassView; impact: Impact | null; lifted: boolean; panel: boolean; stacked: boolean }) {
  const controls = useThree(s => s.controls) as unknown as CameraControlsImpl | null;
  const size = useThree(s => s.size);
  const aspect = size.width / Math.max(1, size.height);
  const halfTan = Math.tan(THREE.MathUtils.degToRad(20));
  const shift = stacked || !panel ? 0 : .15;

  const place = () => {
    const c = controls, r = rigRef.current; if (!c || !r) return;
    const share = stacked ? .9 : panel ? .58 : .7;
    const fit = (span: number) => span / (share * 2 * halfTan * Math.min(aspect, 1.7));
    const at = (t: THREE.Vector3, dir: THREE.Vector3, dist: number) => { const p = t.clone().addScaledVector(dir.normalize(), Math.min(dist, MAXD)); c.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, true); };
    const three4 = r.front.clone().multiplyScalar(.8).addScaledVector(r.side, .6);
    const ly = lifted ? ROOM.lift : 0;
    c.maxPolarAngle = lifted ? Math.PI * .82 : Math.PI / 2 - .04;
    if (mode === 'parts') return at(new THREE.Vector3(0, 1.1, 0), three4.addScaledVector(UP, .75), MAXD);
    const z = r.zones.find(x => x.id === impact?.glass);
    if (mode !== 'glass' || view === 'idle' || !z || !impact) return at(new THREE.Vector3(0, .7 + ly, 0), three4.addScaledVector(UP, lifted ? -.1 : .28), fit(5.6));
    const o = flat(z.out.clone());
    if (view === 'impact') return at(new THREE.Vector3(...impact.point), o.clone().addScaledVector(UP, z.id === 'windshield' ? .55 : .25).addScaledVector(r.side, z.id === 'windshield' ? .15 : 0), fit(z.id === 'windshield' ? 1.1 : 1));
    if (view === 'glass') return at(z.center.clone(), o.clone().addScaledVector(UP, z.id === 'windshield' ? .6 : .3).addScaledVector(r.side, z.id === 'windshield' || z.id === 'rear' ? .28 : 0).addScaledVector(r.front, z.id === 'windshield' || z.id === 'rear' ? 0 : .3), fit(z.id === 'windshield' ? 2.9 : 2.4));
    at(new THREE.Vector3(z.center.x * .5, r.height * .45, z.center.z * .5), o.clone().addScaledVector(r.side, .9).addScaledVector(UP, .38), fit(5.2));
  };
  const placeRef = useRef(place); placeRef.current = place;
  useEffect(() => { placeRef.current(); }, [mode, view, impact, lifted, panel, stacked, aspect, controls]);
  useFrame(() => { if (controls) controls.setFocalOffset(controls.distance * 2 * halfTan * aspect * shift, 0, 0, false); });
  return null;
}

function Hooks({ onReady }: { onReady: (c: HTMLCanvasElement) => void }) {
  const gl = useThree(s => s.gl);
  useEffect(() => { onReady(gl.domElement); }, [gl, onReady]);
  return null;
}

export default function Garage3D(props: Props) {
  const rigRef = useRef<Rig | null>(null);
  const spin = useRef(0);
  const doorRef = useRef(true);
  const [, setTick] = useReducer((x: number) => x + 1, 0);
  const onDoor = useMemo(() => (open: boolean) => { if (doorRef.current !== open) { doorRef.current = open; setTick(); } }, [setTick]);
  const orbit = !props.intro && props.mode !== 'drive';
  return (
    <Canvas className="gx__canvas" dpr={[1, 1.75]} frameloop={props.active ? 'always' : 'never'}
      camera={{ position: [9, 2, 9], fov: 40, near: .05, far: 300 }}
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}>
      <color attach="background" args={['#07080b']} />
      {orbit && (
        <CameraControls makeDefault smoothTime={.7} draggingSmoothTime={.12}
          minDistance={.6} maxDistance={MAXD} minPolarAngle={.15} maxPolarAngle={Math.PI / 2 - .04}
          mouseButtons={{ left: ACTION.ROTATE, middle: ACTION.NONE, right: ACTION.NONE, wheel: ACTION.DOLLY }}
          touches={{ one: props.touch ? ACTION.NONE : ACTION.TOUCH_ROTATE, two: ACTION.TOUCH_DOLLY_ROTATE, three: ACTION.NONE }} />
      )}
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#050505']} />
        {[-3.2, 0, 3.2].map(z => <Lightformer key={z} form="rect" intensity={3.2} position={[0, 5.5, z]} rotation-x={Math.PI / 2} scale={[15, .3, 1]} />)}
        <Lightformer form="rect" intensity={1.6} position={[-8, 1.6, 0]} rotation-y={Math.PI / 2} scale={[12, 1, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[8, 1.6, 0]} rotation-y={-Math.PI / 2} scale={[12, 1, 1]} />
        <Lightformer form="ring" color="#e8102a" intensity={5} position={[9, 4.3, 0]} rotation-y={-Math.PI / 2} scale={2.2} />
      </Environment>
      <Suspense fallback={null}>
        <Car {...props} rigRef={rigRef} spin={spin} onDoor={onDoor} />
        <Room rigRef={rigRef} doorOpen={doorRef.current} lifted={props.lifted} spin={spin} baseId={props.base?.id ?? null} mode={props.mode} />
      </Suspense>
      {orbit && <Cam rigRef={rigRef} mode={props.mode} view={props.view} impact={props.impact} lifted={props.lifted} panel={props.panel} stacked={props.stacked} />}
      <Hooks onReady={props.onReady} />
    </Canvas>
  );
}

/* the room waits for the car (its axes follow the car) */
function Room({ rigRef, ...rest }: { rigRef: React.RefObject<Rig | null>; doorOpen: boolean; lifted: boolean; spin: React.RefObject<number>; baseId: string | null; mode: GarageMode }) {
  const gltf = useCarModel(); // same suspense as the car: rigRef is set right after
  const front = useMemo(() => {
    const root = gltf.scene, get = (n: string) => root.getObjectByName(n)!;
    root.updateMatrixWorld(true);
    return flat(centroid([get('BodyWindshield')]).sub(centroid([get('BodyRearwindow')])));
  }, [gltf]);
  void rigRef;
  return <Garage front={front} {...rest} />;
}

