import { timingSafeEqual } from "node:crypto";

/**
 * Gate for the expensive analysis endpoint.
 * - APP_ACCESS_CODE set: callers must send it in the `x-access-code` header.
 * - APP_ACCESS_CODE unset: open in development, refused in production (fail closed).
 * - Best-effort per-IP rate limit. On serverless this is per instance, so it slows abuse but is not
 *   a hard cap; put a platform-level limit (e.g. Vercel Firewall) in front for a real guarantee.
 */
const WINDOW_MS = 10 * 60_000;
const MAX_REQUESTS = 6;
const hits = new Map<string, number[]>();

/** The access-code half only, for cheap follow-up calls (polling, downloads) that shouldn't use up the rate limit. */
export function checkAccess(req: Request): Response | null {
  const expected = process.env.APP_ACCESS_CODE;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return Response.json({ error: "Server is not configured: set APP_ACCESS_CODE." }, { status: 503 });
    }
  } else {
    const given = Buffer.from(req.headers.get("x-access-code") ?? "");
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      return Response.json({ error: "Access code required or incorrect." }, { status: 401 });
    }
  }
  return null;
}

export function guard(req: Request): Response | null {
  const denied = checkAccess(req);
  if (denied) return denied;

  const now = Date.now();
  if (hits.size > 1000) {
    for (const [ip, times] of hits) if (now - times[times.length - 1] > WINDOW_MS) hits.delete(ip);
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
    return Response.json(
      { error: `Too many requests. Try again in ${Math.ceil(retryAfter / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  recent.push(now);
  hits.set(ip, recent);
  return null;
}
