import { pricesFor, type ModelChoice } from "./catalog";
import { normalizeOutputs, type Outputs } from "./outputs";
import type { Limits } from "./limits";

/**
 * Estimating what a run will cost before it starts. These are planning numbers, not quotes: they
 * come from the script's length and the outputs chosen, using rough per-stage token shapes, and
 * the real run can land on either side (so a range is shown). Actual token counts come back from
 * every run, which is the way to calibrate the constants below.
 */
export interface TokenEstimate {
  input: number;
  output: number;
}
export interface CostEstimate {
  tokens: TokenEstimate;
  /** USD, or null when the model's price isn't known. */
  usd: { low: number; expected: number; high: number } | null;
  beats: number;
  calls: number;
}

/** English prose is roughly four characters a token. */
export const tokensForText = (chars: number) => Math.ceil(chars / 4);

const SYSTEM_TOKENS = 900; // world conventions + a stage's task text
const THINKING = { outline: 1500, transcript: 600, cast: 2500, motion: 4500 };
const SPREAD = { low: 0.65, high: 1.7 };

export function estimateBeats(scriptTokens: number): number {
  return Math.min(40, Math.max(2, Math.round(scriptTokens / 650)));
}

export function estimatePreview(input: {
  scriptChars: number;
  outputs: Partial<Outputs>;
  limits: Limits;
  model: ModelChoice;
  /** Beats planned per parallel motion call (SCENE_CHUNK_BEATS on the server, default 3). */
  chunkBeats?: number;
}): CostEstimate {
  const o = normalizeOutputs(input.outputs);
  const S = tokensForText(input.scriptChars);
  const B = estimateBeats(S);
  const entities = Math.min(input.limits.maxTotal ?? 14, Math.max(3, Math.round(4 + B / 2)));
  const t: TokenEstimate = { input: 0, output: 0 };
  let calls = 0;
  const add = (inp: number, out: number, n = 1) => {
    t.input += inp * n;
    t.output += out * n;
    calls += n;
  };

  const outlineOut = 250 + 90 * B;
  add(SYSTEM_TOKENS + S, outlineOut + THINKING.outline);

  if (o.transcript) add(SYSTEM_TOKENS + S + outlineOut, Math.round(S * 0.55) + 45 * B + THINKING.transcript);

  if (o.cast) {
    const places = Math.max(1, Math.round(B / 2));
    const castOut = 330 * entities + 70 * entities * places * 0.5;
    add(SYSTEM_TOKENS + S, castOut + THINKING.cast);
    // Motion: keyframes for every entity at most beats, plus (optionally) two cameras per beat.
    const chunkBeats = Math.max(1, input.chunkBeats ?? 3);
    const chunks = Math.max(1, Math.ceil(B / chunkBeats));
    const keyframes = entities * B * 1.2;
    const cameras = o.cameras ? B * 2 : 0;
    const motionOut = keyframes * 110 + cameras * 130;
    add(SYSTEM_TOKENS + S + outlineOut + castOut, motionOut / chunks + THINKING.motion, chunks);
  }

  // Roughly one run in five needs a repair pass on one stage.
  t.input = Math.round(t.input * 1.1);
  t.output = Math.round(t.output * 1.1);

  const p = pricesFor(input.model);
  const expected = p.inPerM !== null && p.outPerM !== null ? (t.input * p.inPerM + t.output * p.outPerM) / 1e6 : null;
  return {
    tokens: t,
    usd: expected === null ? null : { low: expected * SPREAD.low, expected, high: expected * SPREAD.high },
    beats: B,
    calls,
  };
}

export type Currency = "USD" | "NGN";

export function formatMoney(usd: number, currency: Currency, usdToNgn: number): string {
  if (currency === "NGN") {
    const n = usd * usdToNgn;
    return `₦${n >= 100 ? Math.round(n).toLocaleString("en-NG") : n.toFixed(2)}`;
  }
  return usd < 0.01 ? "under $0.01" : `$${usd < 1 ? usd.toFixed(2) : usd.toFixed(usd < 10 ? 2 : 0)}`;
}

export const formatTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
