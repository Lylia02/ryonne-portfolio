/* ---------- 3D Studio (below the 3D diagnosis) — texts and parts ----------
   Four ways to play with the same car:
   · Take it apart — grab a part and pull it off, fit a new one
   · Exploded view — the whole car comes apart in the air
   · Walk the workshop — first person, around the car
   · Drive it — keyboard or on-screen pedals
   Prices are demo values (concept project). */
export type ModeId = 'apart' | 'exploded' | 'walk' | 'drive';
export type PartKind = 'wheel' | 'door' | 'hood' | 'windshield' | 'roof' | 'engine' | 'seats';
export type PartId = 'wheelFL' | 'wheelFR' | 'wheelRL' | 'wheelRR' | 'doorL' | 'doorR' | 'hood' | 'windshield' | 'roof' | 'engine' | 'seats';
export type Finish = { id: string; label: string; swatch: string; price: number };

export const finishes: Record<PartKind, Finish[]> = {
  wheel: [
    { id: 'oe', label: 'Original rim, new tyre', swatch: '#c9ccd1', price: 145 },
    { id: 'black', label: 'Gloss black rim', swatch: '#101114', price: 190 },
    { id: 'bronze', label: 'Bronze rim', swatch: '#8c6a3c', price: 210 },
    { id: 'chrome', label: 'Chrome rim', swatch: '#e3e7ec', price: 230 },
  ],
  door: [
    { id: 'oe', label: 'New door, body colour', swatch: '#ebe8e2', price: 620 },
    { id: 'carbon', label: 'Carbon door', swatch: '#1d1f23', price: 1100 },
  ],
  hood: [
    { id: 'oe', label: 'New hood, body colour', swatch: '#ebe8e2', price: 480 },
    { id: 'carbon', label: 'Carbon hood', swatch: '#1d1f23', price: 950 },
  ],
  windshield: [
    { id: 'clear', label: 'Clear OE glass', swatch: '#9fb6c3', price: 329 },
    { id: 'acoustic', label: 'Acoustic, light tint', swatch: '#3e4c55', price: 389 },
    { id: 'solar', label: 'Solar blue', swatch: '#2c5584', price: 449 },
  ],
  roof: [
    { id: 'oe', label: 'Body colour roof', swatch: '#ebe8e2', price: 540 },
    { id: 'glass', label: 'Panoramic glass', swatch: '#2a3946', price: 1250 },
    { id: 'carbon', label: 'Carbon roof', swatch: '#1d1f23', price: 1400 },
  ],
  engine: [
    { id: 'stock', label: 'Rebuilt stock engine', swatch: '#3a3c40', price: 2400 },
    { id: 'sport', label: 'Sport tune', swatch: '#e8102a', price: 3600 },
    { id: 'electric', label: 'Electric motor', swatch: '#2f8bff', price: 9800 },
  ],
  seats: [
    { id: 'carmine', label: 'Carmine leather', swatch: '#5c0c12', price: 1300 },
    { id: 'cream', label: 'Cream leather', swatch: '#d9cdb8', price: 1300 },
    { id: 'black', label: 'Black leather', swatch: '#141416', price: 1100 },
    { id: 'tan', label: 'Tan leather', swatch: '#8a5a32', price: 1200 },
  ],
};

export const parts: { id: PartId; kind: PartKind; name: string; nodes: string[] }[] = [
  { id: 'wheelFL', kind: 'wheel', name: 'Front left wheel', nodes: ['WheelFrontL'] },
  { id: 'wheelFR', kind: 'wheel', name: 'Front right wheel', nodes: ['WheelFrontR'] },
  { id: 'wheelRL', kind: 'wheel', name: 'Rear left wheel', nodes: ['WheelRearL'] },
  { id: 'wheelRR', kind: 'wheel', name: 'Rear right wheel', nodes: ['WheelRearR'] },
  { id: 'doorL', kind: 'door', name: 'Left door', nodes: ['BodyDoorLColor1'] },
  { id: 'doorR', kind: 'door', name: 'Right door', nodes: ['BodyDoorRColor1'] },
  { id: 'hood', kind: 'hood', name: 'Hood', nodes: ['BodyHood'] },
  { id: 'windshield', kind: 'windshield', name: 'Windshield', nodes: ['BodyWindshield', 'BodyWindshieldGasket', 'BodyWindshieldWipers', 'BodyWindshieldWipersBase'] },
  { id: 'roof', kind: 'roof', name: 'Roof panel', nodes: ['BodyRoofPanel'] },
  { id: 'engine', kind: 'engine', name: 'Engine', nodes: ['Engine'] },
  { id: 'seats', kind: 'seats', name: 'Seats', nodes: ['InteriorSeatsColor1', 'InteriorSeatsColor2', 'InteriorSeatsFrame1', 'InteriorSeatsFrame2'] },
];

export const studio = {
  kicker: 'The studio',
  title: 'Take it apart.\n*Then drive it.*',
  modes: [
    { id: 'apart', label: 'Take it apart', hint: 'Grab a part with the mouse and pull it off the car. Drag anywhere else to turn.' },
    { id: 'exploded', label: 'Exploded view', hint: 'Slide to take the whole car apart in the air. Tap a part name to light it up.' },
    { id: 'walk', label: 'Walk the workshop', hint: 'W A S D or arrows to walk, drag to look around.' },
    { id: 'drive', label: 'Drive it out', hint: 'The door opens: drive it out of the garage. W / ↑ to accelerate, S / ↓ to brake, A D / ← → to steer. Space for the handbrake.' },
  ] as { id: ModeId; label: string; hint: string }[],
  paints: [
    { variant: 'Pearly Swirly', label: 'Pearl', swatch: '#ebe8e2' },
    { variant: 'Torched Graphite', label: 'Graphite', swatch: '#3b3e44' },
    { variant: 'Carmine Candy', label: 'Carmine', swatch: '#8a0f1d' },
  ],
  removed: 'On the floor',
  noneRemoved: 'Nothing removed yet. Pull a wheel, a door, the hood or the windshield off the car.',
  fit: 'Fit a new one',
  putBack: 'Put the old one back',
  allBack: 'Put everything back',
  quote: 'Your quote',
  total: 'Total',
  empty: 'Fit a new part to build your quote.',
  demo: 'Demo prices · concept project',
  explode: 'Explode',
  assemble: 'Assemble',
  speed: 'mph',
  lights: 'Headlights',
  horn: 'Horn',
  engineOn: 'Engine sound on',
  engineOff: 'Engine sound off',
  loading: 'Opening the studio',
  pull: 'Pull',
};
