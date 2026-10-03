import { NextResponse, type NextRequest } from "next/server";
import { endSession } from "@/lib/auth";

/** Ends the session and clears the cookie. Reachable signed in or not, so a stale cookie can always be cleared. */
export async function GET(request: NextRequest) {
  await endSession();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const POST = GET;
