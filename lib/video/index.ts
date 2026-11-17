import type { VideoChoice } from "../catalog";
import { UserFacingError } from "../llm";

/**
 * Video generation is asynchronous everywhere: you start a job, then ask until it is done. Each
 * provider is two small functions behind the same shape. Request and response shapes follow the
 * providers' public docs but have not been exercised against live accounts here, so the first real
 * run per provider is the thing to watch.
 */
export type ClipState = { state: "running" } | { state: "done"; url: string } | { state: "failed"; error: string };

export interface StartInput {
  choice: Pick<VideoChoice, "provider" | "model">;
  prompt: string;
  seconds: number;
}

const GOOGLE = "https://generativelanguage.googleapis.com/v1beta";
export const GOOGLE_HOST = "generativelanguage.googleapis.com";

function need(env: string, label: string): string {
  const v = process.env[env];
  if (!v) throw new UserFacingError(`No ${label} key found. Set ${env} on the server and restart.`, 401);
  return v;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } | string }).error;
    throw new UserFacingError(`The video service said: ${typeof msg === "string" ? msg : (msg?.message ?? res.status)}`, res.status === 429 ? 429 : 502);
  }
  return data as Record<string, unknown>;
}

/** Starts one clip and returns the id to ask about. */
export async function startClip({ choice, prompt, seconds }: StartInput): Promise<string> {
  if (choice.provider === "google") {
    const key = need("GEMINI_API_KEY", "Gemini");
    const data = await json(
      await fetch(`${GOOGLE}/models/${encodeURIComponent(choice.model)}:predictLongRunning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: "16:9", durationSeconds: Math.round(seconds) } }),
      }),
    );
    if (typeof data.name !== "string") throw new UserFacingError("The video service didn't start the clip.", 502);
    return data.name;
  }
  const token = need("REPLICATE_API_TOKEN", "Replicate");
  if (!/^[\w.-]+\/[\w.-]+$/.test(choice.model)) throw new UserFacingError("Replicate models look like owner/name.", 400);
  const data = await json(
    await fetch(`https://api.replicate.com/v1/models/${choice.model}/predictions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ input: { prompt, duration: Math.round(seconds) } }),
    }),
  );
  if (typeof data.id !== "string") throw new UserFacingError("The video service didn't start the clip.", 502);
  return data.id;
}

export async function checkClip(provider: VideoChoice["provider"], id: string): Promise<ClipState> {
  if (provider === "google") {
    // Operation names look like "models/<model>/operations/<id>".
    if (!/^[\w./-]+$/.test(id) || id.includes("..")) throw new UserFacingError("That isn't a clip id.", 400);
    const data = await json(await fetch(`${GOOGLE}/${id}`, { headers: { "x-goog-api-key": need("GEMINI_API_KEY", "Gemini") } }));
    if (!data.done) return { state: "running" };
    if (data.error) return { state: "failed", error: String((data.error as { message?: string }).message ?? "The clip failed.") };
    const sample = (data.response as { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] } } | undefined)
      ?.generateVideoResponse?.generatedSamples?.[0];
    const uri = sample?.video?.uri;
    // Served through our own file route, which adds the key (the link on its own won't open).
    return uri ? { state: "done", url: `/api/movie/file?uri=${encodeURIComponent(uri)}` } : { state: "failed", error: "The clip came back empty." };
  }
  if (!/^[\w-]+$/.test(id)) throw new UserFacingError("That isn't a clip id.", 400);
  const data = await json(await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers: { Authorization: `Bearer ${need("REPLICATE_API_TOKEN", "Replicate")}` } }));
  if (data.status === "succeeded") {
    const out = Array.isArray(data.output) ? data.output[0] : data.output;
    return typeof out === "string" ? { state: "done", url: out } : { state: "failed", error: "The clip came back empty." };
  }
  if (data.status === "failed" || data.status === "canceled") return { state: "failed", error: String(data.error ?? "The clip failed.") };
  return { state: "running" };
}
