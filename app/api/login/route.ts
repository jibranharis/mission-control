import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  const form = await req.formData();
  const given = String(form.get("password") ?? "");
  const ok = !password || safeEqual(await sessionToken(given), await sessionToken(password));
  const res = NextResponse.redirect(new URL(ok ? "/" : "/login?error=1", req.url), 303);
  if (ok && password) {
    res.cookies.set(AUTH_COOKIE, await sessionToken(password), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });
  }
  return res;
}
