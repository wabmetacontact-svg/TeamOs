import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * An optimistic gate, and nothing more.
 *
 * It can tell that a cookie is signed by us, which is enough to decide whether
 * to show the login page. It cannot tell whether the session behind that cookie
 * was revoked, whether the account was deactivated, or what the caller is
 * allowed to do — all of which live in the database and are checked on every
 * request by getScope(). Never put an authorisation decision here.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = !!(await verifySession(request.cookies.get(SESSION_COOKIE)?.value));

  // Always reachable: it is how a stale cookie gets cleared.
  if (pathname === "/logout") return NextResponse.next();

  // /login/verify is reached holding a challenge cookie and no session, so it
  // belongs on the public side of this gate; the action behind it does the
  // real checking.
  // Everything somebody who is not signed in has to be able to reach: the two
  // ways in, and the two links that create an account.
  const isLogin =
    pathname.startsWith("/login") || pathname.startsWith("/signup") || pathname.startsWith("/invite/");

  if (!signedIn && !isLogin) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (signedIn && (pathname === "/login" || pathname === "/")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Server components cannot see the path they are rendering for. Publishing it
  // here lets requireScope() send someone who still owes a second factor to the
  // page where they can provide one, without bouncing them off that page too.
  const forward = new Headers(request.headers);
  forward.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: forward } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|jpeg|webp|ico)$).*)"],
};
