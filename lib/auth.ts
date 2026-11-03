export const AUTH_COOKIE = "mc_session";

/** Session cookie value derived from the password, so changing the password signs everyone out. */
export async function sessionToken(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`mission-control:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison for secrets of equal length. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when a request carries `Authorization: Bearer $INGEST_TOKEN`, for jobs that report in. */
/**
 * Either the ingest token, or the dashboard's own session cookie: a browser
 * that is signed in to the dashboard may push to it without carrying a secret.
 */
export async function ingestAuthorized(req: Request): Promise<boolean> {
  const secret = process.env.INGEST_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (secret && safeEqual(given, secret)) return true;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return false;
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE}=([^;]+)`))?.[1] ?? "";
  return safeEqual(cookie, await sessionToken(password));
}
