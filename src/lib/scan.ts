'use client';
/* =========================================================
   "Use my car": a photo becomes a 3D model, or a 3D scan is dropped in.
   Photo → 3D runs on public Hugging Face Spaces (free, open-source models,
   no key), called from the visitor's browser: each visitor uses their own
   free daily GPU time (about 2 minutes a day without a Hugging Face account).
   1. Stable Fast 3D (Stability AI): fast, textured, asks ~60 s of GPU per call
   2. TRELLIS.2 (Microsoft): finer, but asks ~2 × 120 s — only as a fallback
   ========================================================= */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export class QuotaError extends Error {}

const urlOf = (x: unknown): string | null => {
  if (!x) return null;
  if (typeof x === 'string') return /\.(glb|gltf)(\?|$)/i.test(x) || x.startsWith('http') ? x : null;
  if (Array.isArray(x)) { for (const y of x) { const u = urlOf(y); if (u && /\.glb/i.test(u)) return u; } for (const y of x) { const u = urlOf(y); if (u) return u; } return null; }
  const f = x as { url?: string; value?: unknown; path?: string };
  return f.url ?? (f.value ? urlOf(f.value) : null);
};
const isQuota = (e: unknown) => /quota/i.test(String((e as { message?: string })?.message ?? e));

type Step = (i: number) => void;

async function stableFast3d(photo: File, onStep: Step) {
  const { Client, handle_file } = await import('@gradio/client');
  const app = await Client.connect('stabilityai/stable-fast-3d');
  onStep(1);
  // inputs: button label, image, foreground ratio, remesh, vertex count, texture size (the Space's state is kept by the session)
  await app.predict('/run_button', ['Remove Background', handle_file(photo), .85, 'None', -1, 1024]);
  onStep(2);
  const out = await app.predict('/run_button', ['Run', handle_file(photo), .85, 'None', -1, 1024]);
  onStep(3);
  return urlOf(out.data);
}

async function trellis2(photo: File, onStep: Step) {
  const { Client, handle_file } = await import('@gradio/client');
  const app = await Client.connect('microsoft/TRELLIS.2');
  onStep(1);
  const image = ((await app.predict('/preprocess_image', [handle_file(photo)])).data as unknown[])[0];
  const seed = ((await app.predict('/get_seed', [true, 0])).data as number[])[0];
  onStep(2);
  await app.predict('/image_to_3d', [image, seed, '512', 7.5, .7, 10, 5, 7.5, .5, 10, 3, 1, 0, 10, 3]);
  onStep(3);
  return urlOf((await app.predict('/extract_glb', [120000, 1024])).data);
}

/** photo → .glb (ArrayBuffer). Throws QuotaError when today's free GPU time is used up. */
export async function photoToGlb(photo: File, onStep: Step): Promise<ArrayBuffer> {
  onStep(0);
  let url: string | null = null, quota = false;
  for (const run of [stableFast3d, trellis2]) {
    try { url = await run(photo, onStep); if (url) break; }
    catch (e) { console.warn('[my car]', run.name, e); if (isQuota(e)) quota = true; }
  }
  if (!url) throw quota ? new QuotaError('quota') : new Error('No model returned');
  onStep(4);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download failed');
  return res.arrayBuffer();
}

/** a .glb (from the AI or a scan) → a scene ready for the garage: 4.4 m long, wheels on the floor, centred */
export async function loadCustom(buf: ArrayBuffer): Promise<THREE.Object3D> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); // compressed scans
  const gltf = await loader.parseAsync(buf, '');
  const root = new THREE.Group(); root.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3());
  const s = 4.4 / Math.max(size.x, size.z, 1e-3);
  gltf.scene.scale.setScalar(s);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
  gltf.scene.position.set(-c.x, -box.min.y * s, -c.z);
  root.traverse(o => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
    mats.forEach(mt => {
      if (!mt.map) { mt.color?.set('#c9ccd2'); mt.roughness = .45; mt.metalness = .35; } // untextured: satin "scan" finish
      mt.side = THREE.DoubleSide;
    });
  });
  root.updateMatrixWorld(true);
  return root;
}
