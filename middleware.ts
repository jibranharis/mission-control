import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

/**
 * When DASHBOARD_PASSWORD is set, everything except the login page and the
 * token-authenticated ingest endpoints requires a session cookie.
 */
export async function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value ?? "";
  if (safeEqual(cookie, await sessionToken(password))) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!login|api/login|api/ingest|_next/|favicon|icon).*)"],
};
