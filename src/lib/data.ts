export type MovieId = 'dune' | 'lastlight' | 'quiet';
export type Tier = 'standard' | 'vip';
export type ViewKey = 'overview' | 'front' | 'vip' | 'back' | 'stage' | 'seat';
export type Vec3 = [number, number, number];

/* ── Films ─────────────────────────────────────────────────────────── */
export interface Movie {
  id: MovieId;
  title: string;
  rating: string;
  runtime: string;
  genres: string[];
  synopsis: string;
  /** Tints screen light, projector beam and dust — content layer only. */
  ambient: string;
  /** Index of the procedural trailer in CinemaScreen's shader. */
  scene: number;
  /** Original CSS art for the carousel thumbnail (no studio artwork). */
  thumb: string;
}

export const MOVIES: Record<MovieId, Movie> = {
  dune: {
    id: 'dune', title: 'Dune: Part Two', rating: 'PG-13', runtime: '2h 46m',
    genres: ['Sci-Fi', 'Adventure'],
    synopsis: 'Paul Atreides joins the Fremen on a path of revenge against the houses that destroyed his family.',
    ambient: '#E39B4B', scene: 0,
    thumb: 'radial-gradient(circle at 66% 46%, #ffe2b0 0 9%, transparent 10%), linear-gradient(180deg, #6b2510 0%, #e8a35a 52%, #b4602a 53%, #2a0f06 100%)',
  },
  lastlight: {
    id: 'lastlight', title: 'The Last Light', rating: 'PG-13', runtime: '2h 08m',
    genres: ['Drama', 'Mystery'],
    synopsis: 'On a drowned coast, the keeper of the last working lighthouse has one night to keep it burning.',
    ambient: '#8FB4FF', scene: 1,
    thumb: 'radial-gradient(circle at 24% 50%, #fff1d6 0 4%, transparent 14%), linear-gradient(180deg, #050914 0%, #1a2a4a 44%, #f2b880 64%, #0a1424 65%, #03060c 100%)',
  },
  quiet: {
    id: 'quiet', title: 'A Quiet Place', rating: 'PG-13', runtime: '1h 30m',
    genres: ['Horror', 'Thriller'],
    synopsis: 'A family lives in silence on an isolated farm, hunted by creatures that track every sound.',
    ambient: '#7FC39A', scene: 2,
    thumb: 'radial-gradient(circle at 74% 26%, #dfe9e3 0 6%, transparent 7%), linear-gradient(180deg, #0a1110 0%, #2b3a36 52%, #0d1514 53%, #050807 100%)',
  },
};
export const MOVIE_ORDER: MovieId[] = ['dune', 'lastlight', 'quiet'];

/* ── Pricing & sessions ────────────────────────────────────────────── */
export const PRICES: Record<Tier, number> = { standard: 18, vip: 26 };
export const TIER_LABEL: Record<Tier, string> = { standard: 'Standard', vip: 'VIP Lounger' };
export const MAX_SEATS = 8;

export interface Showtime { id: string; time: string; format: string; premium: number }
export const SHOWTIMES: Showtime[] = [
  { id: '1430', time: '14:30', format: 'IMAX', premium: 4 },
  { id: '1715', time: '17:15', format: 'Dolby Atmos', premium: 3 },
  { id: '2000', time: '20:00', format: 'VIP', premium: 5 },
  { id: '2245', time: '22:45', format: 'Standard', premium: 0 },
];

export interface DateOption { key: string; label: string; long: string; isToday: boolean }
const pad = (n: number) => String(n).padStart(2, '0');

/** Live dates: Today + the next three days. */
export const DATES: DateOption[] = Array.from({ length: 4 }, (_, i) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + i);
  return {
    key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    label: i === 0 ? 'Today' : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getDate()}`,
    long: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    isToday: i === 0,
  };
});

export function hasStarted(show: Showtime, date: DateOption, now = new Date()) {
  if (!date.isToday) return false;
  const [h, m] = show.time.split(':').map(Number);
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const usd = (n: number) => money.format(n);

/* ── Auditorium geometry (metres) ──────────────────────────────────── */
export const SCREEN = { width: 14.4, height: 14.4 / 2.35, y: 4.4, z: -12 } as const;
export const SCREEN_CENTER: Vec3 = [0, SCREEN.y, SCREEN.z];
export const ROOM = { halfWidth: 8.6, front: -12.4, back: 9.6, ceiling: 9.2 } as const;
export const STAGE_EDGE = -8.6;
export const ROWS = 'ABCDEFGHIJ'.split('');
export const SEATS_PER_ROW = 14;            // blocks of 3 | 8 | 3
export const ROW = { firstZ: -5, pitch: 1.3, rise: 0.34 } as const;
const SPACING = 0.68;
const AISLE_GAP = 0.9;
const VIP_ROWS = new Set([5, 6]);          // rows F and G, centre block
const EDGE = 3.5 * SPACING;

export const AISLE_X = [-7.0, -(EDGE + (AISLE_GAP + SPACING) / 2), EDGE + (AISLE_GAP + SPACING) / 2, 7.0];
export const rowZ = (r: number) => ROW.firstZ + r * ROW.pitch;
export const rowFloor = (r: number) => r * ROW.rise;

function seatX(col: number) {
  if (col >= 3 && col <= 10) return (col - 3 - 3.5) * SPACING;
  if (col < 3) return -(EDGE + AISLE_GAP + (3 - col) * SPACING);
  return EDGE + AISLE_GAP + (col - 10) * SPACING;
}

export interface Seat {
  index: number; id: string; row: string; rowIndex: number; number: number;
  col: number; tier: Tier; position: Vec3; yaw: number;
}

export const SEATS: Seat[] = ROWS.flatMap((row, r) =>
  Array.from({ length: SEATS_PER_ROW }, (_, col) => {
    const x = seatX(col);
    const z = rowZ(r) + x * x * 0.01;          // gentle row curvature
    const tier: Tier = VIP_ROWS.has(r) && col >= 3 && col <= 10 ? 'vip' : 'standard';
    return {
      index: r * SEATS_PER_ROW + col, id: `${row}${col + 1}`, row, rowIndex: r,
      number: col + 1, col, tier, position: [x, rowFloor(r), z] as Vec3,
      yaw: Math.atan2(x, z - SCREEN.z) * 0.8,  // seats angle toward the screen
    };
  }),
);
export const SEAT_BY_ID = new Map(SEATS.map((s) => [s.id, s]));
export const seatLabel = (s: Seat) => `Row ${s.row} • Seat ${s.number}`;
export const seatSpoken = (s: Seat) => `Row ${s.row}, seat ${s.number}`;

/** Seated eye position, slightly behind the cushion centre. */
export function seatEye(s: Seat): Vec3 {
  const up = s.tier === 'vip' ? 1.1 : 1.16;
  const back = 0.06;
  return [s.position[0] + Math.sin(s.yaw) * back, s.position[1] + up, s.position[2] + Math.cos(s.yaw) * back];
}

/* ── Camera presets ────────────────────────────────────────────────── */
export const PRESET_SEAT: Partial<Record<ViewKey, string>> = { front: 'A7', vip: 'G7', back: 'J7' };
export const CAMERA_PRESETS: Record<'overview' | 'stage', { position: Vec3; target: Vec3 }> = {
  overview: { position: [0, 12.5, 15.5], target: [0, 1.2, -3.2] },
  stage: { position: [0, 2.35, -9.6], target: [0, 2.1, 3] },
};
export const VIEW_LABEL: Record<ViewKey, string> = {
  overview: 'Overview', front: 'Front Row', vip: 'Center VIP',
  back: 'Back Row', stage: 'Stage View', seat: 'Seat POV',
};

/* ── Deterministic occupancy per session ───────────────────────────── */
function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const occupancy = new Map<string, Set<string>>();
const sessionKey = (m: MovieId, d: string, s: string) => `${m}|${d}|${s}`;

export function getOccupied(movie: MovieId, dateKey: string, showId: string): Set<string> {
  const key = sessionKey(movie, dateKey, showId);
  const cached = occupancy.get(key);
  if (cached) return cached;
  const rand = mulberry32(hashString(key));
  const demand = 0.22 + rand() * 0.3;
  const set = new Set<string>();
  for (const s of SEATS) {
    const centre = 1 - Math.min(1, Math.abs(s.position[0]) / 5.5);
    const sweet = 1 - Math.abs(s.rowIndex - 6) / 7;
    if (rand() < demand * (0.5 + 0.4 * centre + 0.35 * sweet)) set.add(s.id);
  }
  occupancy.set(key, set);
  return set;
}

export function markBooked(movie: MovieId, dateKey: string, showId: string, ids: string[]) {
  const next = new Set(getOccupied(movie, dateKey, showId));
  ids.forEach((id) => next.add(id));
  occupancy.set(sessionKey(movie, dateKey, showId), next);
  return next;
}

/* ── Sightline quality (drives the HUD gauge) ──────────────────────── */
export interface Sightline {
  score: number; label: string; note: string;
  fov: number; offAxis: number; elevation: number; distance: number;
}
const DEG = 180 / Math.PI;

export function sightline(s: Seat): Sightline {
  const [x, y, z] = seatEye(s);
  const d = z - SCREEN.z;
  const fov = 2 * Math.atan(SCREEN.width / 2 / d) * DEG;     // how much of your view the screen fills
  const offAxis = Math.atan(Math.abs(x) / d) * DEG;
  const elevation = Math.atan((SCREEN.y - y) / d) * DEG;     // + means looking up
  const h = 1 - Math.min(1, Math.abs(fov - 50) / 40);
  const o = 1 - Math.min(1, offAxis / 30);
  const v = 1 - Math.min(1, Math.max(0, Math.abs(elevation) - 6) / 24);
  const score = Math.round(100 * (0.45 * h + 0.3 * o + 0.25 * v));
  const label = score >= 92 ? 'Reference' : score >= 80 ? 'Excellent' : score >= 65 ? 'Great' : score >= 50 ? 'Good' : 'Limited';
  const note =
    elevation > 16 ? 'Steep upward angle' :
    fov > 72 ? 'Screen overfills your view' :
    offAxis > 14 ? 'Off-axis sightline' :
    fov < 40 ? 'Screen feels distant' : 'Balanced, centered sightline';
  return { score, label, note, fov, offAxis, elevation, distance: Math.hypot(x, y - SCREEN.y, d) };
}
