import { useMemo } from 'react';
import { create } from 'zustand';
import {
  DATES, MAX_SEATS, PRESET_SEAT, PRICES, SEAT_BY_ID, SHOWTIMES,
  getOccupied, hasStarted, markBooked, type MovieId, type ViewKey,
} from './data';

type Session = { movieId: MovieId; dateKey: string; showtimeId: string };

export interface BookingState extends Session {
  occupied: Set<string>;
  selected: string[];
  activeSeat: string | null;   // seat whose tooltip is pinned
  hovered: string | null;      // shared by 3D seats and the 2D seat map
  view: ViewKey;
  povSeat: string | null;      // seat the camera is sitting in, if any
  flightId: number;            // bump to request a camera flight
  flying: boolean;
  notice: string | null;
  checkoutOpen: boolean;
  setMovie: (id: MovieId) => void;
  setDate: (key: string) => void;
  setShowtime: (id: string) => void;
  toggleSeat: (id: string) => void;
  previewSeat: (id: string) => void;
  goTo: (view: ViewKey) => void;
  setHovered: (id: string | null) => void;
  setFlying: (flying: boolean) => void;
  setCheckoutOpen: (open: boolean) => void;
  confirmBooking: () => void;
}

function openShowtime(dateKey: string, preferred?: string) {
  const date = DATES.find((d) => d.key === dateKey) ?? DATES[0];
  const pref = SHOWTIMES.find((s) => s.id === preferred);
  if (pref && !hasStarted(pref, date)) return pref.id;
  return (SHOWTIMES.find((s) => !hasStarted(s, date)) ?? SHOWTIMES[SHOWTIMES.length - 1]).id;
}

const startDate = SHOWTIMES.some((s) => !hasStarted(s, DATES[0])) ? DATES[0] : DATES[1];
const start: Session = { movieId: 'lastlight', dateKey: startDate.key, showtimeId: openShowtime(startDate.key) };
const isPovView = (v: ViewKey) => v !== 'overview' && v !== 'stage';

export const useBooking = create<BookingState>()((set, get) => {
  /** Switching film/date/time keeps seats that are still free and says which ones were dropped. */
  const changeSession = (patch: Partial<Session>) => {
    const s = get();
    const next: Session = { movieId: s.movieId, dateKey: s.dateKey, showtimeId: s.showtimeId, ...patch };
    const occupied = getOccupied(next.movieId, next.dateKey, next.showtimeId);
    const kept = s.selected.filter((id) => !occupied.has(id));
    const dropped = s.selected.filter((id) => occupied.has(id));
    set({
      ...next,
      occupied,
      selected: kept,
      activeSeat: s.activeSeat && kept.includes(s.activeSeat) ? s.activeSeat : kept[kept.length - 1] ?? null,
      notice: dropped.length
        ? `${dropped.join(', ')} ${dropped.length === 1 ? 'is' : 'are'} taken for this showing, so we removed ${dropped.length === 1 ? 'it' : 'them'}.`
        : null,
    });
  };
  const requestFlight = (view: ViewKey, povSeat: string | null) =>
    set((s) => ({ view, povSeat, flightId: s.flightId + 1 }));

  return {
    ...start,
    occupied: getOccupied(start.movieId, start.dateKey, start.showtimeId),
    selected: [],
    activeSeat: null,
    hovered: null,
    view: 'overview',
    povSeat: null,
    flightId: 0,
    flying: false,
    notice: null,
    checkoutOpen: false,

    setMovie: (movieId) => { if (get().movieId !== movieId) changeSession({ movieId }); },
    setDate: (dateKey) => changeSession({ dateKey, showtimeId: openShowtime(dateKey, get().showtimeId) }),
    setShowtime: (showtimeId) => changeSession({ showtimeId }),

    toggleSeat: (id) => {
      const s = get();
      if (s.occupied.has(id)) return;
      if (s.selected.includes(id)) {
        const selected = s.selected.filter((x) => x !== id);
        set({
          selected,
          activeSeat: s.activeSeat === id ? selected[selected.length - 1] ?? null : s.activeSeat,
          notice: null,
        });
        return;
      }
      if (s.selected.length >= MAX_SEATS) {
        set({ notice: `You can book up to ${MAX_SEATS} seats in one order.` });
        return;
      }
      const alreadySeated = s.povSeat === id && isPovView(s.view);
      set({
        selected: [...s.selected, id],
        activeSeat: id,
        notice: null,
        view: 'seat',
        povSeat: id,
        flightId: alreadySeated ? s.flightId : s.flightId + 1,
      });
    },

    previewSeat: (id) => {
      const s = get();
      set({ activeSeat: id });
      if (!(s.view === 'seat' && s.povSeat === id)) requestFlight('seat', id);
    },
    goTo: (view) => requestFlight(view, PRESET_SEAT[view] ?? null),
    setHovered: (hovered) => { if (get().hovered !== hovered) set({ hovered }); },
    setFlying: (flying) => set({ flying }),
    setCheckoutOpen: (checkoutOpen) => set({ checkoutOpen }),
    confirmBooking: () => {
      const s = get();
      const occupied = markBooked(s.movieId, s.dateKey, s.showtimeId, s.selected);
      set({ occupied, selected: [], activeSeat: null, notice: null });
    },
  };
});

/** Live price breakdown for the sidebar and checkout dialog. */
export function useQuote() {
  const selected = useBooking((s) => s.selected);
  const showtimeId = useBooking((s) => s.showtimeId);
  return useMemo(() => {
    const show = SHOWTIMES.find((s) => s.id === showtimeId) ?? SHOWTIMES[0];
    const tickets = selected.reduce((sum, id) => sum + PRICES[SEAT_BY_ID.get(id)!.tier], 0);
    const premium = show.premium * selected.length;
    return { count: selected.length, tickets, premium, total: tickets + premium, show };
  }, [selected, showtimeId]);
}
