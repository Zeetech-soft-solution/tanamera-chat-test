/** Logout: ends the user's ERPNext session and removes the cookie. */
import { NextResponse } from "next/server";
import { novizLogout } from "@/lib/noviz/gateway";
import { SESSION_COOKIE, signedInUser } from "@/lib/currentUser";

export const runtime = "nodejs";

export async function POST() {
  const user = await signedInUser();
  // The cookie goes even when ERPNext cannot be reached: the session then ends at its own expiry.
  if (user) await novizLogout(user.sessionId).catch(() => undefined);
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
