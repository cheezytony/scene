import { z } from "zod";

/**
 * Which AI services can do which job, and what they cost. Keys never live here or in the browser:
 * each provider reads its key from the server's environment (`env`).
 *
 * Prices are US dollars. Anthropic's are the published first-party rates. For everything else the
 * price is left for the person to enter (`null`), because rates differ by model and change often;
 * an unknown price shows as "not counted" in the estimate rather than a made-up number.
 */
export interface ModelInfo {
  id: string;
  label: string;
  /** USD per million input / output tokens. */
  inPerM: number | null;
  outPerM: number | null;
}

export interface PreviewProvider {
  id: "anthropic" | "openai";
  label: string;
  env: string;
  /** Built-in models; a provider with none (or `custom`) takes any model id the person types. */
  models: ModelInfo[];
  custom: boolean;
  blurb: string;
}

export const PREVIEW_PROVIDERS: PreviewProvider[] = [
  {
    id: "anthropic",
    label: "Anthropic Claude",
    env: "ANTHROPIC_API_KEY",
    custom: false,
    blurb: "Structured output built in. The best-tested choice here.",
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", inPerM: 4, outPerM: 20 },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inPerM: 2, outPerM: 10 },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", inPerM: 0.1, outPerM: 0.5 },
      { id: "claude-fable-5-2", label: "Claude Fable 5.2", inPerM: 8, outPerM: 40 },
    ],
  },
  {
    id: "openai",
    label: "OpenAI or compatible",
    env: "OPENAI_API_KEY",
    custom: true,
    blurb: "Any model on OpenAI, or a compatible service (set OPENAI_BASE_URL). Enter the model and its prices.",
    models: [],
  },
];

export interface VideoProvider {
  id: "google" | "replicate";
  label: string;
  env: string;
  blurb: string;
  /** Suggested model id, and the longest clip it can make in one go. */
  defaultModel: string;
  maxClipSec: number;
  modelHint: string;
}

export const VIDEO_PROVIDERS: VideoProvider[] = [
  {
    id: "google",
    label: "Google Veo",
    env: "GEMINI_API_KEY",
    blurb: "Veo through the Gemini API.",
    defaultModel: "veo-3.0-generate-001",
    maxClipSec: 8,
    modelHint: "A Veo model id, e.g. veo-3.0-generate-001",
  },
  {
    id: "replicate",
    label: "Replicate",
    env: "REPLICATE_API_TOKEN",
    blurb: "Any text-to-video model hosted on Replicate.",
    defaultModel: "",
    maxClipSec: 5,
    modelHint: "owner/name, copied from the model's page",
  },
];

export const previewProvider = (id: string) => PREVIEW_PROVIDERS.find((p) => p.id === id);
export const videoProvider = (id: string) => VIDEO_PROVIDERS.find((p) => p.id === id);

/** A chosen model for the previews (and for the director that writes the movie's shot prompts). */
export const ModelChoiceSchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  model: z.string().min(1).max(200),
  /** The person's own prices, used when the model isn't in the catalog. */
  inPerM: z.number().nonnegative().nullable().optional(),
  outPerM: z.number().nonnegative().nullable().optional(),
});
export type ModelChoice = z.infer<typeof ModelChoiceSchema>;

export const VideoChoiceSchema = z.object({
  provider: z.enum(["google", "replicate"]),
  model: z.string().min(1).max(200),
  /** USD per second of finished video. */
  perSecond: z.number().nonnegative().nullable(),
  /** The longest single clip this model makes. */
  maxClipSec: z.number().min(1).max(60),
});
export type VideoChoice = z.infer<typeof VideoChoiceSchema>;

export const DEFAULT_PREVIEW: ModelChoice = { provider: "anthropic", model: "claude-opus-5-5" };
export const DEFAULT_VIDEO: VideoChoice = { provider: "google", model: "veo-3.0-generate-001", perSecond: null, maxClipSec: 8 };

/** Token prices for a choice: the catalog's, else the person's own. */
export function pricesFor(c: ModelChoice): { inPerM: number | null; outPerM: number | null; known: boolean } {
  const m = previewProvider(c.provider)?.models.find((x) => x.id === c.model);
  if (m) return { inPerM: m.inPerM, outPerM: m.outPerM, known: true };
  const inPerM = c.inPerM ?? null;
  const outPerM = c.outPerM ?? null;
  return { inPerM, outPerM, known: inPerM !== null && outPerM !== null };
}

/** Naira per US dollar. A starting point only: it is editable, since rates move every day. */
export const DEFAULT_USD_NGN = 1500;
