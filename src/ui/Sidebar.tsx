import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  DATES, MAX_SEATS, MOVIES, PRICES, ROWS, SEATS, SEATS_PER_ROW, SEAT_BY_ID, SHOWTIMES, TIER_LABEL,
  hasStarted, seatLabel, seatSpoken, usd, type Tier,
} from '../lib/data';
import { useBooking, useQuote } from '../lib/store';
import { useCoarsePointer } from '../lib/useMedia';

const isSeatView = (v: string) => v !== 'overview' && v !== 'stage';
const ROW_SEATS = ROWS.map((_, r) => SEATS.slice(r * SEATS_PER_ROW, (r + 1) * SEATS_PER_ROW));
// Row label | 3 seats | aisle | 8 seats | aisle | 3 seats | row label
const ROW_COLS =
  'grid-cols-[12px_repeat(3,minmax(0,1fr))_8px_repeat(8,minmax(0,1fr))_8px_repeat(3,minmax(0,1fr))_12px]';

/* ── Root ───────────────────────────────────────────────────────────── */
export function Sidebar() {
  return (
    <aside
      aria-label="Booking"
      className="relative flex w-full flex-col border-t border-white/[0.06] bg-ink lg:h-full lg:w-[28%] lg:min-w-[420px] lg:max-w-[520px] lg:border-l lg:border-t-0"
    >
      <div className="flex-1 lg:min-h-0 lg:overflow-y-auto">
        <FilmHeader />
        <div className="space-y-8 px-5 pb-8">
          <DatePicker />
          <Showtimes />
          <SeatMap />
          <SelectedSeats />
        </div>
      </div>
      <CheckoutBar />
      <CheckoutDialog />
      <SelectionAnnouncer />
    </aside>
  );
}

/* ── Shared bits ────────────────────────────────────────────────────── */
const choice = (checked: boolean, disabled: boolean) =>
  `focus-ring transition-colors duration-150 motion-reduce:transition-none ${
    disabled
      ? 'cursor-not-allowed text-mute ring-1 ring-white/[0.06]'
      : checked
        ? 'bg-white/[0.1] text-paper ring-1 ring-white/60'
        : 'bg-white/[0.04] text-fog ring-1 ring-transparent hover:bg-white/[0.08] hover:text-paper'
  }`;

const CheckIcon = ({ className = 'h-3 w-3' }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const XIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

interface RadioOption<T extends string> { value: T; label: string; disabled?: boolean; content: ReactNode }

/** Radio group with roving focus: one Tab stop, arrow keys move and select, disabled options skipped. */
function RadioGroup<T extends string>({
  labelledBy, value, options, onChange, className, itemClass,
}: {
  labelledBy: string;
  value: T;
  options: RadioOption<T>[];
  onChange: (v: T) => void;
  className: string;
  itemClass: (checked: boolean, disabled: boolean) => string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.flatMap((o, i) => (o.disabled ? [] : [i]));
  const checked = options.findIndex((o) => o.value === value);
  const tabStop = checked >= 0 && !options[checked].disabled ? checked : enabled[0] ?? 0;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = enabled.length;
    if (!n) return;
    const at = Math.max(0, enabled.indexOf(i));
    const next = ({
      ArrowRight: enabled[(at + 1) % n], ArrowDown: enabled[(at + 1) % n],
      ArrowLeft: enabled[(at - 1 + n) % n], ArrowUp: enabled[(at - 1 + n) % n],
      Home: enabled[0], End: enabled[n - 1],
    } as Record<string, number | undefined>)[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={className}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-disabled={o.disabled || undefined}
          aria-label={o.label}
          tabIndex={i === tabStop ? 0 : -1}
          onClick={() => { if (!o.disabled) onChange(o.value); }}
          onKeyDown={(e) => onKeyDown(e, i)}
          className={itemClass(o.value === value, !!o.disabled)}
        >
          {o.content}
        </button>
      ))}
    </div>
  );
}

/* ── Film header (picks up the film's ambient tint) ─────────────────── */
function FilmHeader() {
  const movie = useBooking((s) => MOVIES[s.movieId]);
  return (
    <header
      className="px-5 pb-6 pt-7"
      style={{ backgroundImage: `radial-gradient(120% 90% at 0% 0%, ${movie.ambient}26, transparent 62%)` }}
    >
      <p className="eyebrow">Your Booking</p>
      <h1 className="mt-2 font-display text-[30px] leading-[1.05] text-paper">{movie.title}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="rounded-md border border-paper/70 px-1.5 py-0.5 font-mono font-medium text-paper">
          <span className="sr-only">Rated </span>{movie.rating}
        </span>
        <span className="font-mono text-fog">{movie.runtime}</span>
        <span aria-hidden className="text-mute">·</span>
        {movie.genres.map((g) => (
          <span key={g} className="rounded-full bg-white/[0.06] px-2.5 py-1 text-fog">{g}</span>
        ))}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-fog">{movie.synopsis}</p>
    </header>
  );
}

/* ── Date pills ─────────────────────────────────────────────────────── */
function DatePicker() {
  const dateKey = useBooking((s) => s.dateKey);
  const setDate = useBooking((s) => s.setDate);
  const options = useMemo(
    () =>
      DATES.map((d) => ({
        value: d.key,
        label: d.isToday ? `Today, ${d.long}` : d.long,
        disabled: SHOWTIMES.every((s) => hasStarted(s, d)), // nothing left to see today
        content: d.label,
      })),
    [],
  );
  return (
    <section aria-labelledby="date-heading">
      <h2 id="date-heading" className="eyebrow mb-2.5">Date</h2>
      <RadioGroup
        labelledBy="date-heading"
        value={dateKey}
        options={options}
        onChange={setDate}
        className="grid grid-cols-4 gap-2"
        itemClass={(c, d) => `h-11 rounded-full text-[13px] font-medium ${choice(c, d)}`}
      />
    </section>
  );
}

/* ── Showtime grid ──────────────────────────────────────────────────── */
function Showtimes() {
  const dateKey = useBooking((s) => s.dateKey);
  const showtimeId = useBooking((s) => s.showtimeId);
  const setShowtime = useBooking((s) => s.setShowtime);
  const date = DATES.find((d) => d.key === dateKey) ?? DATES[0];

  const options = SHOWTIMES.map((s) => {
    const started = hasStarted(s, date);
    const extra = s.premium ? `+${usd(s.premium)}` : 'No surcharge';
    return {
      value: s.id,
      disabled: started,
      label: `${s.time}, ${s.format}${s.premium ? `, plus ${usd(s.premium)} per seat` : ''}${started ? ', already started' : ''}`,
      content: (
        <>
          <span className="flex items-baseline justify-between gap-2">
            <span className={`font-mono text-[17px] tabular-nums ${started ? 'line-through' : ''}`}>{s.time}</span>
            <span className="text-[11px] text-fog">{started ? 'Started' : extra}</span>
          </span>
          <span className="eyebrow mt-1.5 block">{s.format}</span>
        </>
      ),
    };
  });

  return (
    <section aria-labelledby="time-heading">
      <h2 id="time-heading" className="eyebrow mb-2.5">Showtime</h2>
      <RadioGroup
        labelledBy="time-heading"
        value={showtimeId}
        options={options}
        onChange={setShowtime}
        className="grid grid-cols-2 gap-2"
        itemClass={(c, d) => `rounded-2xl px-3.5 py-3 text-left ${choice(c, d)}`}
      />
    </section>
  );
}

/* ── Seat map: the keyboard and screen-reader path to every seat ────── */
function SeatMap() {
  const occupied = useBooking((s) => s.occupied);
  const selected = useBooking((s) => s.selected);
  const hovered = useBooking((s) => s.hovered);
  const here = useBooking((s) => (isSeatView(s.view) ? s.povSeat : null));
  const ambient = useBooking((s) => MOVIES[s.movieId].ambient);
  const toggleSeat = useBooking((s) => s.toggleSeat);
  const setHovered = useBooking((s) => s.setHovered);
  const [focusId, setFocusId] = useState('E7');
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const unhover = (id: string) => { if (useBooking.getState().hovered === id) setHovered(null); };
  const activate = (id: string) => {
    if (occupied.has(id)) {
      useBooking.setState({ notice: `${seatSpoken(SEAT_BY_ID.get(id)!)} is taken. Try a seat nearby.` });
      return;
    }
    toggleSeat(id);
  };

  // One Tab stop for the whole map; arrows move by seat and row.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const seat = SEAT_BY_ID.get(focusId);
    if (!seat) return;
    let r = seat.rowIndex;
    let c = seat.col;
    switch (e.key) {
      case 'ArrowLeft': c = Math.max(0, c - 1); break;
      case 'ArrowRight': c = Math.min(SEATS_PER_ROW - 1, c + 1); break;
      case 'ArrowUp': r = Math.max(0, r - 1); break;
      case 'ArrowDown': r = Math.min(ROWS.length - 1, r + 1); break;
      case 'Home': c = 0; break;
      case 'End': c = SEATS_PER_ROW - 1; break;
      default: return;
    }
    e.preventDefault();
    const next = ROW_SEATS[r][c].id;
    setFocusId(next);
    buttons.current.get(next)?.focus();
  };

  const cell = (id: string) => {
    const s = SEAT_BY_ID.get(id)!;
    const isSel = selected.includes(id);
    const taken = occupied.has(id);
    const look = isSel
      ? 'border-crimson bg-crimson text-white'
      : taken
        ? 'seat-taken border-white/10 bg-[#2A2628]'
        : s.tier === 'vip' ? 'border-brass bg-velvet' : 'border-seat bg-velvet';
    return (
      <span role="gridcell" key={id}>
        <button
          ref={(el) => { if (el) buttons.current.set(id, el); else buttons.current.delete(id); }}
          type="button"
          tabIndex={id === focusId ? 0 : -1}
          aria-pressed={isSel}
          aria-disabled={taken || undefined}
          aria-label={`${seatSpoken(s)}, ${TIER_LABEL[s.tier]}, ${usd(PRICES[s.tier])}${taken ? ', taken' : ''}${id === here ? ', viewing from here' : ''}`}
          onClick={() => activate(id)}
          onFocus={() => { setFocusId(id); setHovered(id); }}
          onBlur={() => unhover(id)}
          onPointerEnter={() => setHovered(id)}
          onPointerLeave={() => unhover(id)}
          className={`focus-ring grid aspect-square w-full place-items-center rounded-[5px] ${taken ? 'cursor-not-allowed' : ''}`}
        >
          <span
            aria-hidden
            className={`grid h-[78%] w-[78%] place-items-center rounded-[4px] border ${look} ${
              hovered === id ? 'ring-2 ring-paper/80 ring-offset-1 ring-offset-ink' : ''
            }`}
          >
            {isSel ? <CheckIcon className="h-[70%] w-[70%]" /> : id === here ? <span className="h-1 w-1 rounded-full bg-paper" /> : null}
          </span>
        </button>
      </span>
    );
  };

  return (
    <section aria-labelledby="seats-heading">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h2 id="seats-heading" className="eyebrow">Seat Map</h2>
        <p className="text-[12px] text-fog">{SEATS.length - occupied.size} of {SEATS.length} available</p>
      </div>

      <div className="rounded-2xl bg-white/[0.03] p-2 ring-1 ring-white/[0.05]">
        <div aria-hidden className="mb-3 px-6 pt-1">
          <svg viewBox="0 0 300 24" preserveAspectRatio="none" className="h-5 w-full overflow-visible">
            <path
              d="M4 20 Q150 2 296 20" fill="none" stroke={ambient} strokeWidth="2.5" strokeLinecap="round"
              vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 6px ${ambient})` }}
            />
          </svg>
          <p className="eyebrow -mt-0.5 text-center">Screen</p>
        </div>

        <div className="overflow-x-auto">
          <div
            role="grid"
            aria-labelledby="seats-heading"
            aria-describedby="seat-legend seat-keys"
            onKeyDown={onKeyDown}
            className="mx-auto min-w-[340px] space-y-[3px] [@media(pointer:coarse)]:min-w-[460px]"
          >
            {ROW_SEATS.map((seats, r) => (
              <div role="row" key={ROWS[r]} className={`grid ${ROW_COLS} items-center gap-x-[2px]`}>
                <span role="rowheader" className="text-center font-mono text-[11px] text-mute">{ROWS[r]}</span>
                {seats.slice(0, 3).map((s) => cell(s.id))}
                <span aria-hidden />
                {seats.slice(3, 11).map((s) => cell(s.id))}
                <span aria-hidden />
                {seats.slice(11).map((s) => cell(s.id))}
                <span aria-hidden className="text-center font-mono text-[11px] text-mute">{ROWS[r]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ul id="seat-legend" className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-fog">
        <Legend swatch="border-seat bg-velvet">Standard {usd(PRICES.standard)}</Legend>
        <Legend swatch="border-brass bg-velvet">VIP Lounger {usd(PRICES.vip)}</Legend>
        <Legend swatch="border-crimson bg-crimson text-white" mark={<CheckIcon className="h-2.5 w-2.5" />}>Selected</Legend>
        <Legend swatch="seat-taken border-white/10 bg-[#2A2628]">Taken</Legend>
        <Legend swatch="border-seat bg-velvet" mark={<span className="h-1 w-1 rounded-full bg-paper" />}>Viewing from</Legend>
      </ul>
      <p id="seat-keys" className="mt-2 hidden text-[12px] text-mute [@media(pointer:fine)]:block">
        Arrow keys move between seats · Enter or Space selects
      </p>
    </section>
  );
}

function Legend({ swatch, mark, children }: { swatch: string; mark?: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={`grid h-3.5 w-3.5 place-items-center rounded-[3px] border ${swatch}`}>{mark}</span>
      {children}
    </li>
  );
}

/* ── Selected seats + price breakdown ───────────────────────────────── */
function PriceLines() {
  const selected = useBooking((s) => s.selected);
  const quote = useQuote();
  const counts: Record<Tier, number> = { standard: 0, vip: 0 };
  selected.forEach((id) => { counts[SEAT_BY_ID.get(id)!.tier] += 1; });
  return (
    <>
      {(['standard', 'vip'] as Tier[]).filter((t) => counts[t] > 0).map((t) => (
        <div key={t} className="flex justify-between gap-3">
          <dt className="text-fog">
            {TIER_LABEL[t]} × {counts[t]} <span className="text-mute">at {usd(PRICES[t])}</span>
          </dt>
          <dd className="font-mono tabular-nums text-paper">{usd(counts[t] * PRICES[t])}</dd>
        </div>
      ))}
      {quote.premium > 0 && (
        <div className="flex justify-between gap-3">
          <dt className="text-fog">{quote.show.format} surcharge × {quote.count}</dt>
          <dd className="font-mono tabular-nums text-paper">{usd(quote.premium)}</dd>
        </div>
      )}
    </>
  );
}

function SelectedSeats() {
  const selected = useBooking((s) => s.selected);
  const here = useBooking((s) => (isSeatView(s.view) ? s.povSeat : null));
  const toggleSeat = useBooking((s) => s.toggleSeat);
  const previewSeat = useBooking((s) => s.previewSeat);
  const coarse = useCoarsePointer();

  return (
    <section aria-labelledby="your-seats-heading">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h2 id="your-seats-heading" className="eyebrow">Your Seats</h2>
        <p className="text-[12px] text-fog">{selected.length} of {MAX_SEATS}</p>
      </div>

      {selected.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-center text-[13px] leading-relaxed text-fog">
          No seats yet. {coarse ? 'Tap' : 'Click'} a red seat in the auditorium, or use the seat map above.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-white/[0.06]">
            {selected.map((id) => {
              const seat = SEAT_BY_ID.get(id)!;
              return (
                <li key={id} className="flex items-center gap-3 py-2.5">
                  <span aria-hidden className="grid h-4 w-4 place-items-center rounded-[4px] bg-crimson text-white">
                    <CheckIcon className="h-2.5 w-2.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[13px] text-paper">{seatLabel(seat)}</p>
                    <p className="text-[12px] text-fog">{TIER_LABEL[seat.tier]} · {usd(PRICES[seat.tier])}</p>
                  </div>
                  {here === id ? (
                    <span className="px-2 text-[12px] text-fog">Viewing</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => previewSeat(id)}
                      aria-label={`View from ${seatSpoken(seat)}`}
                      className="focus-ring h-10 rounded-full bg-white/[0.06] px-3.5 text-[13px] text-paper hover:bg-white/[0.1]"
                    >
                      View
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleSeat(id)}
                    aria-label={`Remove ${seatSpoken(seat)}`}
                    className="focus-ring grid h-10 w-10 place-items-center rounded-full text-fog hover:bg-white/[0.08] hover:text-paper"
                  >
                    <XIcon />
                  </button>
                </li>
              );
            })}
          </ul>
          <dl className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3 text-[13px]">
            <PriceLines />
          </dl>
        </>
      )}
    </section>
  );
}

/* ── Sticky total + primary action ──────────────────────────────────── */
function CheckoutBar() {
  const { count, total } = useQuote();
  const setCheckoutOpen = useBooking((s) => s.setCheckoutOpen);
  const disabled = count === 0;
  return (
    <div className="sticky bottom-0 z-10 border-t border-white/[0.06] bg-ink/90 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-xl">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[13px] text-fog">
          {count ? `${count} ${count === 1 ? 'seat' : 'seats'} · Total` : 'No seats selected'}
        </span>
        <span className="text-[22px] font-semibold tabular-nums text-paper">{usd(total)}</span>
      </div>
      <button
        type="button"
        aria-disabled={disabled || undefined}
        aria-describedby={disabled ? 'checkout-hint' : undefined}
        onClick={() => { if (!disabled) setCheckoutOpen(true); }}
        className={`focus-ring h-12 w-full rounded-full text-[15px] font-semibold transition-colors motion-reduce:transition-none ${
          disabled ? 'cursor-not-allowed bg-white/[0.08] text-mute' : 'bg-paper text-ink hover:bg-white'
        }`}
      >
        Continue to Checkout
      </button>
      {disabled && (
        <p id="checkout-hint" className="mt-2 text-center text-[12px] text-mute">
          Choose at least one seat to continue.
        </p>
      )}
    </div>
  );
}

/* ── Checkout dialog (native <dialog>: focus trap, Esc, focus return) ─ */
function bookingRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `LUM-${Array.from(bytes, (b) => chars[b % chars.length]).join('')}`;
}

function CheckoutDialog() {
  const open = useBooking((s) => s.checkoutOpen);
  const setOpen = useBooking((s) => s.setCheckoutOpen);
  const confirmBooking = useBooking((s) => s.confirmBooking);
  const movieId = useBooking((s) => s.movieId);
  const dateKey = useBooking((s) => s.dateKey);
  const selected = useBooking((s) => s.selected);
  const quote = useQuote();
  const ref = useRef<HTMLDialogElement>(null);
  const [done, setDone] = useState<{ code: string; seats: string[]; total: number } | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setDone(null); d.showModal(); }
    else if (!open && d.open) d.close();
  }, [open]);

  const movie = MOVIES[movieId];
  const date = DATES.find((d) => d.key === dateKey) ?? DATES[0];
  const when = `${date.long} · ${quote.show.time} · ${quote.show.format}`;

  const pay = () => {
    setDone({ code: bookingRef(), seats: [...selected], total: quote.total });
    confirmBooking();
  };

  return (
    <dialog
      ref={ref}
      onClose={() => setOpen(false)}
      aria-labelledby="checkout-title"
      className="m-auto max-h-[90dvh] w-[min(92vw,440px)] overflow-y-auto rounded-3xl border border-white/10 bg-[#121116] p-0 text-paper backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      {!done ? (
        <form onSubmit={(e) => { e.preventDefault(); pay(); }} className="p-6">
          <p className="eyebrow">Checkout</p>
          <h2 id="checkout-title" className="mt-1 font-display text-[26px] leading-tight">Review Your Booking</h2>

          <div className="mt-4 rounded-2xl bg-white/[0.04] p-4">
            <p className="font-display text-[18px]">{movie.title}</p>
            <p className="mt-0.5 text-[13px] text-fog">{when}</p>
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Seats">
              {selected.map((id) => (
                <li key={id} className="rounded-full bg-crimson/15 px-2.5 py-1 font-mono text-[12px] text-paper ring-1 ring-crimson/50">
                  {seatLabel(SEAT_BY_ID.get(id)!)}
                </li>
              ))}
            </ul>
            <dl className="mt-4 space-y-1.5 border-t border-white/[0.06] pt-3 text-[13px]">
              <PriceLines />
              <div className="flex justify-between gap-3 pt-1.5 text-[15px] font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{usd(quote.total)}</dd>
              </div>
            </dl>
          </div>

          <p className="mt-3 text-[12px] text-mute">Demo checkout. No card is charged.</p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="focus-ring h-12 flex-1 rounded-full bg-white/[0.06] text-[15px] font-medium text-paper hover:bg-white/[0.1]"
            >
              Cancel
            </button>
            <button type="submit" className="focus-ring h-12 flex-[2] rounded-full bg-paper text-[15px] font-semibold text-ink hover:bg-white">
              Pay {usd(quote.total)}
            </button>
          </div>
        </form>
      ) : (
        <div className="p-6 text-center">
          <span aria-hidden className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-paper text-ink">
            <CheckIcon className="h-6 w-6" />
          </span>
          <h2 id="checkout-title" className="mt-4 font-display text-[26px] leading-tight">You’re Booked</h2>
          <p className="mt-1 text-[13px] text-fog">{movie.title} · {when}</p>
          <p className="eyebrow mt-5">Booking Reference</p>
          <p className="mt-1 font-mono text-[22px] tracking-[0.2em] text-paper">{done.code}</p>
          <p className="mt-3 font-mono text-[13px] text-fog">
            {done.seats.map((id) => seatLabel(SEAT_BY_ID.get(id)!)).join('  ·  ')}
          </p>
          <p className="mt-1 text-[13px] text-fog">Paid {usd(done.total)}</p>
          <button
            type="button"
            autoFocus
            onClick={() => setOpen(false)}
            className="focus-ring mt-6 h-12 w-full rounded-full bg-paper text-[15px] font-semibold text-ink hover:bg-white"
          >
            Done
          </button>
        </div>
      )}
    </dialog>
  );
}

/* ── Screen reader: announce what changed in the selection ──────────── */
function SelectionAnnouncer() {
  const selected = useBooking((s) => s.selected);
  const { total } = useQuote();
  const prev = useRef(selected);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const before = prev.current;
    prev.current = selected;
    if (useBooking.getState().checkoutOpen) return; // the dialog speaks for itself after paying
    const name = (id: string) => seatSpoken(SEAT_BY_ID.get(id)!);
    const parts = [
      ...selected.filter((id) => !before.includes(id)).map((id) => `${name(id)} added`),
      ...before.filter((id) => !selected.includes(id)).map((id) => `${name(id)} removed`),
    ];
    if (!parts.length) return;
    const n = selected.length;
    setMessage(`${parts.join('. ')}. ${n} ${n === 1 ? 'seat' : 'seats'}, total ${usd(total)}.`);
  }, [selected, total]);

  return <p className="sr-only" role="status" aria-live="polite">{message}</p>;
}
