/**
 * Personal settings that are fine to keep public. Anything private
 * (tokens, passwords) belongs in environment variables instead.
 */

/** Name shown in the greeting. */
export const OWNER_NAME = process.env.OWNER_NAME ?? "Jibran";

/**
 * Projects that always show first on the Claude page, even before the Mac
 * collector or GitHub has reported them. NEXT_PUBLIC_PINNED_PROJECTS overrides it as
 * "Name=owner/repo" pairs separated by commas.
 */
export const PINNED_PROJECTS: { name: string; repo: string }[] = (() => {
  const raw = process.env.NEXT_PUBLIC_PINNED_PROJECTS ?? "Solo Kitchen=z57333/Solo";
  return raw
    .split(",")
    .map((pair) => pair.split("=").map((x) => x.trim()))
    .filter(([name, repo]) => name && repo)
    .map(([name, repo]) => ({ name, repo }));
})();
