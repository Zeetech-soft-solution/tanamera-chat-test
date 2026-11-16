/**
 * Login with the user's ERPNext user name and password: the gateway logs in to
 * ERPNext (POST /api/method/login) and returns the user's session, kept here
 * in an HttpOnly cookie. A wrong password answers with ERPNext's own words.
 */
import { NextResponse } from "next/server";
import { novizLogin, NovizError } from "@/lib/noviz/gateway";
import { sessionCookie } from "@/lib/currentUser";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { usr, pwd } = await request.json().catch(() => ({}));
  if (typeof usr !== "string" || !usr.trim() || typeof pwd !== "string" || !pwd) {
    return NextResponse.json({ error: "Enter your ERPNext user name and password." }, { status: 400 });
  }
  try {
    const session = await novizLogin(usr.trim(), pwd);
    const response = NextResponse.json({ user: session.user, fullName: session.fullName });
    response.cookies.set(sessionCookie(session));
    return response;
  } catch (e) {
    if (e instanceof NovizError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
