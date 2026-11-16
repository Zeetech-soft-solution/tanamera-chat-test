/**
 * The site's pages need a login: without the session cookie, a page goes to
 * /login. The API routes answer 401 themselves (currentNovizUser).
 */
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "noviz_erp_session";

export function middleware(request: NextRequest) {
  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    // Behind nginx, request.url is the app's own local address: the site's address is the Host header.
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const local = !host || /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
    // The public site is https (nginx); Next's own x-forwarded-proto says http.
    return NextResponse.redirect(local ? new URL("/login", request.url) : `https://${host}/login`);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/chat"] };
