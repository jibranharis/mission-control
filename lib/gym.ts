/**
 * The training split. It is a rotation, not a weekday schedule: the next
 * lift is always the day after the last one you logged, so a missed or
 * swapped day never skips a muscle group. Lives in Redis at mc:life:gym.
 */

export interface SplitDay {
  id: string;
  name: string;
  /** One line on what the day trains. */
  focus: string;
  exercises: string[];
}

export interface GymLog {
  /** Local date (YYYY-MM-DD). */
  date: string;
  /** The split day done that date. */
  dayId: string;
}

export interface GymData {
  split: SplitDay[];
  /** Weekdays you lift, 0 = Sunday. */
  days: number[];
  log: GymLog[];
}

export const GYM_KEY = "mc:life:gym";

export const DEFAULT_SPLIT: SplitDay[] = [
  {
    id: "shoulders-biceps",
    name: "Shoulders & Biceps",
    focus: "Front and side delts, biceps",
    exercises: ["Overhead press 4×6-8", "Lateral raises 4×12-15", "Rear-delt flyes 3×15", "Barbell curls 3×8-10", "Hammer curls 3×10-12"],
  },
  {
    id: "back-chest",
    name: "Back & Chest",
    focus: "Lats, upper back, chest",
    exercises: ["Pull-ups or lat pulldown 4×8", "Barbell rows 4×8", "Bench press 4×6-8", "Incline dumbbell press 3×10", "Cable flyes 3×12"],
  },
  {
    id: "legs",
    name: "Legs",
    focus: "Quads, calves",
    exercises: ["Back squats 4×6-8", "Leg press 3×10", "Walking lunges 3×12 each", "Leg extensions 3×12-15", "Calf raises 4×15"],
  },
  {
    id: "triceps-shoulders",
    name: "Triceps & Shoulders",
    focus: "Triceps, side and rear delts",
    exercises: ["Close-grip bench 4×8", "Tricep pushdowns 3×12", "Overhead tricep extensions 3×12", "Arnold press 3×10", "Lateral raises 3×15"],
  },
  {
    id: "legs-core",
    name: "Legs & Core",
    focus: "Hamstrings, glutes, abs",
    exercises: ["Romanian deadlifts 4×8", "Bulgarian split squats 3×10 each", "Hip thrusts 3×10", "Leg curls 3×12", "Hanging leg raises 3×12", "Plank 3×45s"],
  },
];

/** Monday to Friday: one pass through the five days each week. */
export const DEFAULT_GYM: GymData = { split: DEFAULT_SPLIT, days: [1, 2, 3, 4, 5], log: [] };

export function normalizeGym(g: Partial<GymData> | null | undefined): GymData {
  const split = Array.isArray(g?.split) && g!.split.length ? g!.split : DEFAULT_SPLIT;
  const days = Array.isArray(g?.days) ? g!.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : DEFAULT_GYM.days;
  const log = Array.isArray(g?.log) ? [...g!.log].sort((a, b) => a.date.localeCompare(b.date)) : [];
  return { split, days, log };
}

export interface PlannedDay {
  date: string;
  day: SplitDay | null;
  status: "done" | "today" | "planned" | "missed" | "rest";
}

const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (key: string) => new Date(`${key}T12:00:00Z`).getUTCDay();

/** Index of the split day that comes after the last one logged before `before`. */
function nextIndex(g: GymData, before: string): number {
  const last = [...g.log].reverse().find((l) => l.date < before);
  const i = last ? g.split.findIndex((d) => d.id === last.dayId) : -1;
  return (i + 1) % g.split.length;
}

/** What each date from `from` to `to` (inclusive) holds: logged, planned, missed or rest. */
export function planGym(g: GymData, from: string, to: string, today: string): PlannedDay[] {
  const byDate = new Map(g.log.map((l) => [l.date, l]));
  const out: PlannedDay[] = [];
  // Walk from today (or earlier, for past days) so future weeks continue the rotation.
  let cursor = nextIndex(g, today);
  for (let k = from < today ? from : today; k <= to; k = addDays(k, 1)) {
    const show = k >= from;
    const logged = byDate.get(k);
    if (logged) {
      const day = g.split.find((d) => d.id === logged.dayId) ?? null;
      if (show) out.push({ date: k, day, status: "done" });
      if (k >= today && day) cursor = (g.split.indexOf(day) + 1) % g.split.length;
      continue;
    }
    const lifts = g.days.includes(weekday(k));
    if (k < today) {
      if (show) out.push({ date: k, day: null, status: lifts ? "missed" : "rest" });
      continue;
    }
    if (!lifts) {
      if (show) out.push({ date: k, day: null, status: "rest" });
      continue;
    }
    if (show) out.push({ date: k, day: g.split[cursor] ?? null, status: k === today ? "today" : "planned" });
    cursor = (cursor + 1) % g.split.length;
  }
  return out;
}

/** The lift to do on `today`, even on a rest day (so you can still train). */
export function nextLift(g: GymData, today: string): SplitDay | null {
  const logged = g.log.find((l) => l.date === today);
  if (logged) return g.split.find((d) => d.id === logged.dayId) ?? null;
  return g.split[nextIndex(g, today)] ?? null;
}
