import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Clears the session and sends you to the login page.
 *
 * Also the escape hatch for a stale cookie: if the signed session still
 * verifies but its user no longer exists (database reset, account deleted),
 * requireUser() sends the browser here. Without it, /dashboard would bounce to
 * /login and the proxy would bounce straight back — a redirect loop.
 */
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
