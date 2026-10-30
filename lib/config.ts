/**
 * Personal settings that are fine to keep public. Anything private
 * (tokens, passwords) belongs in environment variables instead.
 */

/** Training split by weekday, Sunday first. "Rest" marks a rest day. */
export const GYM_SPLIT = ["Rest", "Push", "Pull", "Legs", "Push", "Pull", "Legs"];

/** Name shown in the greeting. */
export const OWNER_NAME = process.env.OWNER_NAME ?? "Jibran";
