import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_SCOPES, googleClientConfigured, redirectUri } from "@/lib/sources/google";

export const dynamic = "force-dynamic";

/** Starts Google sign-in for one account. Visit once per account (personal, UC Davis). */
export function GET(req: NextRequest) {
  if (!googleClientConfigured) {
    return NextResponse.json({ error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first." }, { status: 400 });
  }
  const state = crypto.randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(req.nextUrl.origin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    // Always show the account picker and consent, so Google hands back a refresh token.
    prompt: "select_account consent",
    include_granted_scopes: "true",
    state,
    ...(req.nextUrl.searchParams.get("hint") ? { login_hint: req.nextUrl.searchParams.get("hint")! } : {}),
  }).toString();
  const res = NextResponse.redirect(url);
  res.cookies.set("mc_google_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/google" });
  return res;
}
