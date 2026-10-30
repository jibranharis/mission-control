/**
 * Personal settings that are fine to keep public. Anything private
 * (tokens, passwords) belongs in environment variables instead.
 */

/**
 * Training split by weekday, Sunday first, from GYM_SPLIT as a comma list
 * (for example "Rest,Push,Pull,Legs,Push,Pull,Legs"). "Rest" marks a rest
 * day. Unset, every day is just "Gym" and you log the days you went.
 */
export const GYM_SPLIT = (() => {
  const days = (process.env.GYM_SPLIT ?? "").split(",").map((d) => d.trim());
  return days.length === 7 && days.every(Boolean) ? days : Array(7).fill("Gym");
})();

/** Name shown in the greeting. */
export const OWNER_NAME = process.env.OWNER_NAME ?? "Jibran";
