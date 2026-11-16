/**
 * Who is chatting: the user who logged in on this site with their ERPNext user
 * name and password (app/login). Their ERPNext session is kept in an HttpOnly
 * cookie, so the browser's scripts never see it; every Noviz AI request runs
 * as that user with their own ERPNext permissions.
 *
 * In Tanamera's chat, this is your existing session: call novizLogin when the
 * user logs in, keep the sessionId with your session, and return it here.
 */
import "server-only";
import { cookies } from "next/headers";
import { NovizSession, NovizUser } from "./noviz/gateway";

export const SESSION_COOKIE = "noviz_erp_session";

export interface SignedInUser {
  sessionId: string;
  user: string;
  fullName: string;
}

/** The cookie's value: the session, its user and their name. */
export function sessionCookie(session: NovizSession) {
  const value = Buffer.from(JSON.stringify({ sessionId: session.sessionId, user: session.user, fullName: session.fullName })).toString("base64url");
  const expires = session.expiresAt ? new Date(session.expiresAt) : undefined;
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    // The cookie ends when ERPNext ends the session.
    ...(expires && !isNaN(expires.getTime()) ? { expires } : {}),
  };
}

export async function signedInUser(): Promise<SignedInUser | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  try {
    const user = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return typeof user.sessionId === "string" && typeof user.user === "string" ? { sessionId: user.sessionId, user: user.user, fullName: String(user.fullName || user.user) } : null;
  } catch {
    return null;
  }
}

export async function currentNovizUser(): Promise<NovizUser | null> {
  const user = await signedInUser();
  return user ? { chatUser: user.user, erpSessionId: user.sessionId } : null;
}
