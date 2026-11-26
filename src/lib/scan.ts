'use client';
/* =========================================================
   "Use my car": a photo becomes a 3D model, or a 3D scan is dropped in.
   Photo → 3D runs on a public Hugging Face Space (free, open source,
   no key): microsoft/TRELLIS.2 by default, see IMG3D_SPACE in garage.ts.
   Steps (Gradio API, same session): preprocess the photo (background
   removed) → seed → image_to_3d (kept in the Space's session) → extract_glb.
   Free GPUs are shared: when the Space is busy the visitor is told so.
   ========================================================= */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { IMG3D_SPACE } from './garage';

type FileData = { url?: string; path?: string };
const urlOf = (x: unknown): string | null => {
  if (!x) return null;
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) { for (const y of x) { const u = urlOf(y); if (u) return u; } return null; }
  const f = x as FileData & { value?: unknown };
  return f.url ?? (f.value ? urlOf(f.value) : null);
};

/** photo → .glb (ArrayBuffer). onStep(i) follows the stages shown to the visitor. */
export async function photoToGlb(photo: File, onStep: (i: number) => void): Promise<ArrayBuffer> {
  const { Client, handle_file } = await import('@gradio/client');
  onStep(0);
  const app = await Client.connect(IMG3D_SPACE);
  onStep(1);
  const pre = await app.predict('/preprocess_image', [handle_file(photo)]);
  const image = (pre.data as unknown[])[0];
  const seed = ((await app.predict('/get_seed', [true, 0])).data as number[])[0];
  onStep(2);
  // lighter settings than the Space defaults: a car for a web page, not a film asset
  await app.predict('/image_to_3d', [image, seed, '512', 7.5, .7, 10, 5, 7.5, .5, 10, 3, 1, 0, 10, 3]);
  onStep(3);
  const out = await app.predict('/extract_glb', [120000, 1024]);
  const url = urlOf(out.data);
  if (!url) throw new Error('No model returned');
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
  // the long side becomes the car's length; most generators face +Z or −Z, scans vary: keep as is
  const s = 4.4 / Math.max(size.x, size.z, 1e-3);
  gltf.scene.scale.setScalar(s);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
  gltf.scene.position.set(-c.x, -box.min.y * s, -c.z);
  root.traverse(o => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
    mats.forEach(mt => {
      // untextured models come out white: give them a satin "scan" finish
      if (!mt.map) { mt.color?.set('#c9ccd2'); mt.roughness = .45; mt.metalness = .35; }
      mt.side = THREE.DoubleSide;
    });
  });
  root.updateMatrixWorld(true);
  return root;
}
