/* =========================================================
   The 3D garage — texts and data (one page, one scene).
   ========================================================= */
import type { PartId } from './studio';

export type GarageMode = 'explore' | 'glass' | 'parts' | 'drive';

export const garage = {
  kicker: 'Ryonne · The 3D garage',
  titles: {
    explore: 'Walk around\n*your car.*',
    glass: 'Break it.\n*Build it back.*',
    parts: 'What your car\n*is made of.*',
    drive: 'Take it\n*out.*',
  } as Record<GarageMode, string>,
  dock: [
    { id: 'explore', label: 'Explore', hint: 'Drag to turn · scroll to zoom' },
    { id: 'glass', label: 'Repair the glass', hint: 'Click where the stone hit' },
    { id: 'parts', label: 'What it’s made of', hint: 'Every part and its materials' },
    { id: 'drive', label: 'Drive it out', hint: 'Arrows or W A S D' },
  ] as { id: GarageMode; label: string; hint: string }[],
  lift: { up: 'Lift the car', down: 'Lower the car', hint: 'Look underneath' },
  skip: 'Skip intro',
  loading: 'Opening the garage',
  back: 'Back in the garage',
  speed: 'mph',
  lights: 'Headlights',
  sound: 'Engine sound',
  yourCar: {
    cta: 'Use my car',
    title: 'Bring your own car',
    text: 'Turn a photo of your car into a 3D model, or drop a 3D scan. Then show us where the glass is damaged, right on your car.',
    photo: 'From a photo',
    photoHint: 'One clear photo, 3/4 front view, the whole car in frame. An open-source AI (TRELLIS, by Microsoft) builds the 3D model in about two minutes. Free, so it can be busy.',
    scan: 'From a 3D scan',
    scanHint: 'A .glb file, for example from a free phone scanning app like Scaniverse or Polycam.',
    choose: 'Choose a photo',
    chooseScan: 'Choose a .glb file',
    working: ['Sending the photo', 'Removing the background', 'Building the shape', 'Painting the surface', 'Bringing it into the garage'],
    busy: 'The free AI is busy right now. Try again in a few minutes, or use a 3D scan.',
    reset: 'Back to the Ryonne car',
    limited: 'On your car: damage and glass quote. Parts and driving use the Ryonne car.',
    privacy: 'Your photo is sent to a public Hugging Face Space to build the model. Nothing is kept on this site.',
  },
  note: 'Demo prices · concept project',
};

/* What each part is made of — shown in "What it's made of" */
export const composition: Record<PartId, { title: string; materials: string[]; text: string; glass?: boolean }> = {
  windshield: { title: 'Windshield', glass: true, materials: ['2 layers of glass', 'PVB plastic film in between', 'Ceramic frit band'], text: 'Laminated glass: if it breaks, the film holds the pieces together. It also holds up the roof in a rollover and backs up the passenger airbag.' },
  roof: { title: 'Roof panel', materials: ['Aluminium sheet', 'Sound-deadening pad', 'Headliner fabric'], text: 'Bonded to the frame. On many cars today it is a glass roof — then it is laminated like the windshield.' },
  hood: { title: 'Hood', materials: ['Aluminium outer skin', 'Steel inner frame', 'Heat shield'], text: 'Built to crumple in a frontal hit and to soften a pedestrian impact.' },
  doorL: { title: 'Driver door', glass: true, materials: ['Steel frame', 'Side-impact beam', 'Tempered side glass', 'Window motor'], text: 'The side glass is tempered: it is toughened, and if it breaks it turns into small rounded cubes.' },
  doorR: { title: 'Passenger door', glass: true, materials: ['Steel frame', 'Side-impact beam', 'Tempered side glass', 'Window motor'], text: 'Same as the driver door. Tempered glass cannot be repaired, only replaced.' },
  engine: { title: 'Engine', materials: ['Aluminium block', 'Steel crankshaft', 'Plastic intake'], text: 'Sits under the hood. Most of its weight is metal; the covers are plastic.' },
  seats: { title: 'Seats', materials: ['Steel frame', 'Foam', 'Leather or fabric', 'Side airbags'], text: 'The front seats carry their own airbags in the outer bolster.' },
  wheelFL: { title: 'Front left wheel', materials: ['Aluminium alloy rim', 'Rubber tyre', 'Steel belts'], text: 'The tyre is layers of rubber over steel and fabric belts.' },
  wheelFR: { title: 'Front right wheel', materials: ['Aluminium alloy rim', 'Rubber tyre', 'Steel belts'], text: 'The tyre is layers of rubber over steel and fabric belts.' },
  wheelRL: { title: 'Rear left wheel', materials: ['Aluminium alloy rim', 'Rubber tyre', 'Steel belts'], text: 'The tyre is layers of rubber over steel and fabric belts.' },
  wheelRR: { title: 'Rear right wheel', materials: ['Aluminium alloy rim', 'Rubber tyre', 'Steel belts'], text: 'The tyre is layers of rubber over steel and fabric belts.' },
};

/* Photo → 3D: a public, free Hugging Face Space running an open-source model.
   Change it here (or with NEXT_PUBLIC_IMG3D_SPACE) if the Space moves. */
export const IMG3D_SPACE = process.env.NEXT_PUBLIC_IMG3D_SPACE || 'microsoft/TRELLIS.2';
