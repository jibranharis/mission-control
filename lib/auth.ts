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
