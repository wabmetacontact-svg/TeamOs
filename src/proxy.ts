import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * An optimistic gate, and nothing more.
 *
 * It can tell that a cookie is signed by us, which is enough to decide whether
 * to show the login page. Whether the session behind it is still live, and
 * what the person may do, is read from the database on every request.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = !!(await verifySession(request.cookies.get(SESSION_COOKIE)?.value));

  // Always reachable: it is how a stale cookie gets cleared.
  if (pathname === "/logout") return NextResponse.next();

  // Machine callers carry no session cookie and must not be sent to a login
  // page: a 307 to /login reads as success to a worker that follows redirects,
  // and as a mystery to one that does not — either way the request is lost
  // without ever reaching the route. Everything under /api authenticates its
  // own caller instead (the WabMeta sync by HMAC signature), so the cookie
  // gate has nothing useful to say about it.
  if (pathname.startsWith("/api/")) return NextResponse.next();

  const isPublic = pathname === "/login" || pathname === "/signup" || pathname.startsWith("/join/");

  if (!signedIn && !isPublic) return NextResponse.redirect(new URL("/login", request.url));
  if (signedIn && (pathname === "/login" || pathname === "/signup" || pathname === "/")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|jpeg|webp|ico)$).*)"],
};
