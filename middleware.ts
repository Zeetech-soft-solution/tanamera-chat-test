/**
 * The site's pages need a login: without the session cookie, a page goes to
 * /login. The API routes answer 401 themselves (currentNovizUser).
 */
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "noviz_erp_session";

export function middleware(request: NextRequest) {
  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/chat"] };
