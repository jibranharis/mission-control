import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_SCOPES, labelFor, redirectUri, saveAccount } from "@/lib/sources/google";

export const dynamic = "force-dynamic";

function back(req: NextRequest, result: string) {
  const res = NextResponse.redirect(new URL(`/?google=${encodeURIComponent(result)}#inbox`, req.url));
  res.cookies.delete({ name: "mc_google_state", path: "/api/google" });
  return res;
}

/** Google sends the browser back here after sign-in; the refresh token goes into the database. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return back(req, `error:${q.get("error")}`);
  const state = req.cookies.get("mc_google_state")?.value;
  if (!state || state !== q.get("state")) return back(req, "error:expired, try again");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: q.get("code") ?? "",
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(req.nextUrl.origin),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const token = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; scope?: string; error?: string };
  if (!token.access_token) return back(req, `error:${token.error ?? "no token"}`);
  if (!token.refresh_token) return back(req, "error:Google sent no refresh token; remove access and try again");

  const granted = (token.scope ?? "").split(" ");
  const missing = GOOGLE_SCOPES.filter((s) => s.startsWith("https://") && !granted.includes(s));
  if (missing.length) return back(req, "error:tick every box on Google's permission screen");

  const me = (await (
    await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } })
  ).json()) as { email?: string };
  if (!me.email) return back(req, "error:couldn't read the account's email");

  await saveAccount({ email: me.email, label: labelFor(me.email), refreshToken: token.refresh_token, addedAt: new Date().toISOString() });
  return back(req, `connected:${me.email}`);
}
