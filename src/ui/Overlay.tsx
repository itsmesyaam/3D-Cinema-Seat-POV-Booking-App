import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  MOVIES, MOVIE_ORDER, SEAT_BY_ID, VIEW_LABEL, seatLabel, seatSpoken, sightline,
  type MovieId, type ViewKey,
} from '../lib/data';
import { useBooking } from '../lib/store';
import { useCoarsePointer } from '../lib/useMedia';

const PRESETS: ViewKey[] = ['overview', 'front', 'vip', 'back', 'stage'];
const isSeatView = (v: ViewKey) => v !== 'overview' && v !== 'stage';

/** Left/Right/Home/End move focus along a row of buttons (Tab still works as usual). */
function arrowNav(e: KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  const n = items.length;
  const next =
    e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
  items[next].focus();
  items[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* ── Root ───────────────────────────────────────────────────────────── */
export function Overlay() {
  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Scrims keep HUD text legible when the bright screen is behind it. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/60 to-transparent" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-60 bg-gradient-to-t from-black/70 to-transparent" />

      <div className="relative flex h-full flex-col justify-between p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] lg:p-6">
        <div className="flex items-start justify-between gap-4">
          <Masthead />
          <SightlineHud />
        </div>
        <div className="flex flex-col items-center gap-3">
          <Notice />
          <MovieCarousel />
          <CameraBar />
        </div>
      </div>

      <ArrivalAnnouncer />
    </div>
  );
}

/* ── Top left: wordmark, where the camera is, how to move ───────────── */
function Masthead() {
  const view = useBooking((s) => s.view);
  const povSeat = useBooking((s) => s.povSeat);
  const flying = useBooking((s) => s.flying);
  const coarse = useCoarsePointer();

  const seat = isSeatView(view) && povSeat ? SEAT_BY_ID.get(povSeat) : undefined;
  const where = seat ? `${VIEW_LABEL[view]} · ${seatLabel(seat)}` : VIEW_LABEL[view];
  const hint =
    view === 'overview'
      ? coarse ? 'Drag to orbit · Pinch to zoom · Tap a seat' : 'Drag to orbit · Scroll to zoom · Click a seat'
      : coarse ? 'Drag to look around' : 'Drag to look around · Esc for overview';

  return (
    <div className="min-w-0">
      <p className="font-display text-[20px] tracking-[0.32em] text-paper lg:text-[22px]">LUMIÈRE</p>
      <p className="eyebrow mt-1 hidden sm:block">Auditorium 3 · 14.4 m Laser Screen</p>
      <div className="glass mt-3 inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${flying ? 'bg-paper motion-safe:animate-pulse' : 'bg-fog'}`}
        />
        <span className="truncate text-[13px] text-paper">{where}</span>
      </div>
      <p className="mt-2 hidden text-[12px] text-fog sm:block">{hint}</p>
    </div>
  );
}

/* ── Top right: circular sightline gauge + view toggle ──────────────── */
const R = 52;
const CIRC = 2 * Math.PI * R;
const BANDS = [50, 65, 80, 92]; // thresholds for Good, Great, Excellent, Reference

function SightlineHud() {
  const view = useBooking((s) => s.view);
  const seated = useBooking((s) => (isSeatView(s.view) ? s.povSeat : null));
  const hovered = useBooking((s) => s.hovered);
  const active = useBooking((s) => s.activeSeat);
  const selected = useBooking((s) => s.selected);
  const occupied = useBooking((s) => s.occupied);
  const goTo = useBooking((s) => s.goTo);
  const toggleSeat = useBooking((s) => s.toggleSeat);
  const coarse = useCoarsePointer();

  // The seat you're sitting in wins; otherwise preview the hovered seat; otherwise the pinned one.
  const id = seated ?? hovered ?? active;
  const seat = id ? SEAT_BY_ID.get(id) : undefined;
  const q = useMemo(() => (seat ? sightline(seat) : null), [seat]);

  const source = seated ? 'Viewing From' : hovered ? (coarse ? 'Seat' : 'Hovering') : 'Selected';
  const isSel = seat ? selected.includes(seat.id) : false;
  const taken = seat ? occupied.has(seat.id) && !isSel : false;
  const inOverview = view === 'overview';
  const deg = (d: number) => `${Math.round(d)}°`;

  const gaugeA11y = q && seat
    ? {
        role: 'meter',
        'aria-label': 'Sightline quality',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': q.score,
        'aria-valuetext': `${q.score} out of 100, ${q.label}, from ${seatSpoken(seat)}. ${q.note}.`,
      }
    : { role: 'img', 'aria-label': 'Sightline quality. Choose a seat to rate its view.' };

  return (
    <div className="pointer-events-auto flex w-[180px] shrink-0 flex-col items-end gap-2.5 sm:w-[220px]">
      <div {...gaugeA11y} className="glass relative grid h-[104px] w-[104px] place-items-center rounded-full lg:h-[128px] lg:w-[128px]">
        <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="5" />
          {BANDS.map((b) => {
            const a = (b / 100) * Math.PI * 2;
            return (
              <line
                key={b}
                x1={60 + 56 * Math.cos(a)} y1={60 + 56 * Math.sin(a)}
                x2={60 + 59 * Math.cos(a)} y2={60 + 59 * Math.sin(a)}
                stroke="rgba(255,255,255,0.35)" strokeWidth="1.2"
              />
            );
          })}
          {q && (
            <circle
              cx="60" cy="60" r={R} fill="none" stroke="#F2F0EC" strokeWidth="5" strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - q.score / 100)}
              className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
            />
          )}
        </svg>
        <div className="relative text-center" aria-hidden>
          <div className="font-display text-[30px] leading-none text-paper tabular-nums lg:text-[36px]">
            {q ? q.score : '—'}
          </div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-fog">
            {q ? q.label : 'Sightline'}
          </div>
        </div>
      </div>

      {/* Details card: hidden on the smallest screens to keep the 3D view clear. */}
      <div className="glass hidden w-full rounded-2xl p-3.5 sm:block">
        <p className="eyebrow">{seat ? source : 'Sightline'}</p>
        {seat && q ? (
          <>
            <p className="mt-1 font-mono text-[13px] text-paper">{seatLabel(seat)}</p>
            <p className="mt-0.5 text-[12px] leading-snug text-fog">{q.note}</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
              <dt className="text-mute">Distance</dt>
              <dd className="text-right font-mono tabular-nums text-paper">{q.distance.toFixed(1)} m</dd>
              <dt className="text-mute">Screen fills</dt>
              <dd className="text-right font-mono tabular-nums text-paper">{deg(q.fov)} of view</dd>
              <dt className="text-mute">Off-axis</dt>
              <dd className="text-right font-mono tabular-nums text-paper">{deg(q.offAxis)}</dd>
              <dt className="text-mute">Tilt</dt>
              <dd className="text-right font-mono tabular-nums text-paper">
                {deg(Math.abs(q.elevation))} {q.elevation >= 0 ? 'up' : 'down'}
              </dd>
            </dl>
          </>
        ) : (
          <p className="mt-1 text-[12px] leading-snug text-fog">
            {coarse ? 'Tap' : 'Hover over'} a seat to see how the screen looks from there.
          </p>
        )}
      </div>

      {/* While sitting in a seat, offer to book it right here. */}
      {seated && seat &&
        (taken ? (
          <p className="glass rounded-full px-3.5 py-2 text-[12px] text-fog">This seat is taken</p>
        ) : (
          <button
            type="button"
            onClick={() => toggleSeat(seat.id)}
            className={`focus-ring h-11 rounded-full px-4 text-[13px] font-medium transition-colors motion-reduce:transition-none ${
              isSel ? 'glass text-paper hover:bg-[#26242b]/85' : 'bg-crimson text-white hover:bg-[#c92233]'
            }`}
          >
            {isSel ? 'Remove Seat' : 'Select This Seat'}
          </button>
        ))}

      <button
        type="button"
        onClick={() => goTo(inOverview ? 'stage' : 'overview')}
        className="glass focus-ring h-11 rounded-full px-4 text-[13px] font-medium text-paper transition-colors hover:bg-[#26242b]/85 motion-reduce:transition-none"
      >
        {inOverview ? 'View from Stage' : 'Reset View'}
      </button>
    </div>
  );
}

/* ── Status message (seats dropped on session change, seat limit) ───── */
function Notice() {
  const notice = useBooking((s) => s.notice);
  // The live region is always mounted so screen readers announce changes to it.
  return (
    <div role="status" aria-live="polite" className="flex justify-center">
      {notice && (
        <div className="glass pointer-events-auto flex max-w-[min(92vw,520px)] items-center gap-2 rounded-2xl py-1.5 pl-4 pr-1.5 text-[13px] text-paper">
          <p className="py-1">{notice}</p>
          <button
            type="button"
            onClick={() => useBooking.setState({ notice: null })}
            aria-label="Dismiss message"
            className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-full text-fog hover:bg-white/10 hover:text-paper"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Film carousel ──────────────────────────────────────────────────── */
function MovieCarousel() {
  const movieId = useBooking((s) => s.movieId);
  const setMovie = useBooking((s) => s.setMovie);
  return (
    <div
      role="group"
      aria-label="Choose a film"
      onKeyDown={arrowNav}
      className="pointer-events-auto -mx-4 flex max-w-[calc(100%+2rem)] snap-x gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:max-w-full sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {MOVIE_ORDER.map((id) => (
        <MovieCard key={id} id={id} active={id === movieId} onSelect={() => setMovie(id)} />
      ))}
    </div>
  );
}

function MovieCard({ id, active, onSelect }: { id: MovieId; active: boolean; onSelect: () => void }) {
  const m = MOVIES[id];
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={`glass focus-ring flex w-[236px] shrink-0 snap-start items-center gap-3 rounded-2xl p-2 pr-4 text-left transition-[background-color,box-shadow] duration-200 motion-reduce:transition-none ${
        active ? 'bg-white/[0.09] ring-1 ring-white/55' : 'hover:bg-[#26242b]/85'
      }`}
    >
      {/* 2.35:1 still, drawn in CSS. */}
      <span aria-hidden className="h-[41px] w-[96px] shrink-0 rounded-lg ring-1 ring-white/10" style={{ background: m.thumb }} />
      <span className="min-w-0">
        <span className={`eyebrow block ${active ? 'text-paper' : ''}`}>{active ? 'Now Showing' : m.genres[0]}</span>
        <span className="mt-0.5 block truncate font-display text-[16px] leading-tight text-paper">{m.title}</span>
        <span className="block font-mono text-[11px] text-fog">
          {m.rating} · {m.runtime}
        </span>
      </span>
    </button>
  );
}

/* ── Camera presets ─────────────────────────────────────────────────── */
function CameraBar() {
  const view = useBooking((s) => s.view);
  const goTo = useBooking((s) => s.goTo);
  return (
    <div
      role="toolbar"
      aria-label="Camera views"
      onKeyDown={arrowNav}
      className="glass pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-full p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {PRESETS.map((key) => {
        const on = view === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => goTo(key)}
            className={`focus-ring h-11 shrink-0 rounded-full px-4 text-[13px] font-medium transition-colors duration-150 motion-reduce:transition-none ${
              on ? 'bg-white/[0.16] text-paper ring-1 ring-white/30' : 'text-fog hover:bg-white/10 hover:text-paper'
            }`}
          >
            {VIEW_LABEL[key]}
          </button>
        );
      })}
    </div>
  );
}

/* ── Screen reader: describe the view once the camera arrives ───────── */
function ArrivalAnnouncer() {
  const flying = useBooking((s) => s.flying);
  const view = useBooking((s) => s.view);
  const povSeat = useBooking((s) => s.povSeat);
  const [message, setMessage] = useState('');
  const first = useRef(true);

  useEffect(() => {
    if (flying) return;
    if (first.current) { first.current = false; return; } // stay quiet on launch
    const seat = isSeatView(view) && povSeat ? SEAT_BY_ID.get(povSeat) : undefined;
    if (seat) {
      const q = sightline(seat);
      setMessage(`Now viewing from ${seatSpoken(seat)}. Sightline ${q.score} out of 100, ${q.label}. ${q.note}.`);
    } else {
      setMessage(`${VIEW_LABEL[view]}.`);
    }
  }, [flying, view, povSeat]);

  return (
    <p className="sr-only" role="status" aria-live="polite">
      {message}
    </p>
  );
}
