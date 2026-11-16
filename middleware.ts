/**
 * The site's pages need a login: without the session cookie, a page goes to
 * /login. The API routes answer 401 themselves (currentNovizUser).
 */
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "noviz_erp_session";

export function middleware(request: NextRequest) {
  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    // A relative Location: behind nginx, request.url is the app's own local address.
    return new NextResponse(null, { status: 307, headers: { Location: "/login" } });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/chat"] };
