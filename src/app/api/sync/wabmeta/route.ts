import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  applyEvents,
  syncBody,
  verify,
  type EventResult,
} from "@/lib/wabmeta";

/**
 * Where WabMeta's outbox worker posts.
 *
 * The only way into this workspace from outside, so it is deliberately narrow:
 * a signature it cannot forge, a timestamp it cannot replay, one workspace it
 * cannot choose, and a body shape it cannot exceed.
 *
 * It answers per event rather than per request. A batch where one payment
 * refers to a client that has not been pushed yet is not a failed batch — the
 * other events are written, and the response says which single event to send
 * again. Replying 500 to the whole batch would make WabMeta resend the
 * nineteen that already worked.
 */

// node:crypto and Prisma, so not the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A sender that gets this many events wrong is misconfigured, not unlucky. */
const MAX_BODY_BYTES = 1_000_000;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function POST(req: Request) {
  const secret = process.env.WABMETA_SYNC_SECRET;
  const tenantId = process.env.WABMETA_TENANT_ID;

  // Not the caller's fault and not something to describe to them: a missing
  // secret would otherwise mean an unauthenticated write endpoint.
  if (!secret || !tenantId) {
    console.error("[wabmeta] WABMETA_SYNC_SECRET or WABMETA_TENANT_ID is not set; refusing the request");
    return json({ error: "sync is not configured" }, 503);
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) return json({ error: "body too large" }, 413);

  // Verified against the exact bytes received, before the body is parsed:
  // parsing first would re-serialise and change what was signed.
  const checked = verify({
    rawBody,
    signature: req.headers.get(SIGNATURE_HEADER),
    timestamp: req.headers.get(TIMESTAMP_HEADER),
    secret,
  });
  if (!checked.ok) {
    console.warn(`[wabmeta] rejected: ${checked.reason}`);
    // One flat answer for every kind of rejection, so a caller cannot learn
    // from the difference between a wrong secret and a stale timestamp.
    return json({ error: "unauthorized" }, 401);
  }

  let parsed;
  try {
    parsed = syncBody.safeParse(JSON.parse(rawBody));
  } catch {
    return json({ error: "body is not valid JSON" }, 400);
  }
  if (!parsed.success) {
    // Signed, so the sender is trusted enough to be told what was wrong with
    // the shape — otherwise a contract mismatch is undebuggable from there.
    return json({ error: "body does not match the sync contract", issues: parsed.error.issues }, 400);
  }

  let results: EventResult[];
  try {
    results = await applyEvents(tenantId, parsed.data.events);
  } catch (err) {
    // applyEvents catches per event, so reaching here means the database is
    // unreachable rather than any one event being bad. 503 tells the worker to
    // keep the whole batch and come back.
    console.error("[wabmeta] the batch could not be applied", err);
    return json({ error: "could not apply the batch" }, 503);
  }

  const failed = results.filter((r) => r.status === "failed");
  if (failed.length) {
    console.warn(`[wabmeta] ${failed.length}/${results.length} events failed`, failed);
  }

  return json(
    {
      applied: results.filter((r) => r.status === "applied").length,
      unchanged: results.filter((r) => r.status === "unchanged").length,
      failed: failed.length,
      results,
    },
    200,
  );
}
