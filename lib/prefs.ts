import { z } from "zod";
import { DEFAULT_PREVIEW, DEFAULT_USD_NGN, DEFAULT_VIDEO, ModelChoiceSchema, VideoChoiceSchema } from "./catalog";
import { ALL_OUTPUTS, DEFAULT_OUTPUTS, OutputsSchema, normalizeOutputs, type Outputs } from "./outputs";
import type { ModelChoice, VideoChoice } from "./catalog";

/** What a person has chosen, remembered in this browser. Never contains a key (those stay on the server). */
const PrefsSchema = z.object({
  outputs: OutputsSchema,
  preview: ModelChoiceSchema,
  video: VideoChoiceSchema,
  movieInputs: OutputsSchema,
  usdToNgn: z.number().positive(),
});
export interface Prefs {
  outputs: Outputs;
  preview: ModelChoice;
  video: VideoChoice;
  /** Which of the scene's outputs feed the movie. */
  movieInputs: Outputs;
  usdToNgn: number;
}

export const DEFAULT_PREFS: Prefs = {
  outputs: DEFAULT_OUTPUTS,
  preview: DEFAULT_PREVIEW,
  video: DEFAULT_VIDEO,
  movieInputs: ALL_OUTPUTS,
  usdToNgn: DEFAULT_USD_NGN,
};

const KEY = "scene.prefs.v1";

/** Reads saved choices, falling back field by field so a missing or older entry never breaks the page. */
export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Record<string, unknown> | null;
    if (!raw) return DEFAULT_PREFS;
    const parsed = PrefsSchema.partial().safeParse(raw);
    const p = parsed.success ? parsed.data : {};
    return {
      outputs: normalizeOutputs(p.outputs),
      preview: p.preview ?? DEFAULT_PREFS.preview,
      video: p.video ?? DEFAULT_PREFS.video,
      movieInputs: normalizeOutputs(p.movieInputs ?? ALL_OUTPUTS),
      usdToNgn: p.usdToNgn ?? DEFAULT_PREFS.usdToNgn,
    };
  } catch {
    return DEFAULT_PREFS; // storage unavailable or unreadable
  }
}

export function savePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private windows and blocked storage: choices just won't be remembered.
  }
}
