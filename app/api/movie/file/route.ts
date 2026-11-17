import { checkAccess } from "@/lib/guard";
import { GOOGLE_HOST } from "@/lib/video";

/**
 * Hands a finished Google clip to the browser. Google's links only open with our key, so we fetch
 * them here. Only Google's own API host is allowed, so this can't be pointed at anything else.
 */
export async function GET(req: Request) {
  const denied = checkAccess(req);
  if (denied) return denied;
  const key = process.env.GEMINI_API_KEY;
  const uri = new URL(req.url).searchParams.get("uri");
  let target: URL;
  try {
    target = new URL(uri ?? "");
  } catch {
    return Response.json({ error: "Need a clip link." }, { status: 400 });
  }
  if (!key || target.protocol !== "https:" || target.hostname !== GOOGLE_HOST) {
    return Response.json({ error: "That link isn't one we can fetch." }, { status: 400 });
  }
  // Follow a redirect by hand so our key only ever goes to Google's API host: the next hop (a Google
  // storage link) is fetched without it, and only if it is also a Google host.
  let upstream = await fetch(target, { headers: { "x-goog-api-key": key }, redirect: "manual" });
  const next = upstream.status >= 300 && upstream.status < 400 ? upstream.headers.get("location") : null;
  if (next) {
    const hop = new URL(next, target);
    if (hop.protocol !== "https:" || !/(^|\.)(googleapis|googleusercontent)\.com$/.test(hop.hostname)) {
      return Response.json({ error: "The clip moved somewhere we won't follow." }, { status: 502 });
    }
    upstream = await fetch(hop);
  }
  if (!upstream.ok || !upstream.body) return Response.json({ error: "The clip couldn't be fetched." }, { status: 502 });
  return new Response(upstream.body, { headers: { "Content-Type": upstream.headers.get("content-type") ?? "video/mp4", "Cache-Control": "private, max-age=3600" } });
}
