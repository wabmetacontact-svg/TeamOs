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
