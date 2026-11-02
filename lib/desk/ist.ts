/**
 * Business days are India Standard Time (UTC+05:30, no DST) regardless of where the
 * server runs (A24). "Today" for the desk counters and bulk export uses these bounds.
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** [start, end) of the IST calendar day containing `now`, as UTC instants. */
export function istDayRange(now: Date = new Date()): { start: Date; end: Date } {
  const shifted = now.getTime() + IST_OFFSET_MS;
  const startShifted = shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS);
  const start = new Date(startShifted - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** DD-MM-YYYY in IST (Tally's usual date entry format). */
export function istDateDDMMYYYY(d: Date): string {
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  const dd = String(s.getUTCDate()).padStart(2, "0");
  const mm = String(s.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${s.getUTCFullYear()}`;
}

/** YYYY-MM-DD in IST, for file names. */
export function istDateISO(d: Date): string {
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  return s.toISOString().slice(0, 10);
}

export function daysBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}
