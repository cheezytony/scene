import { z } from "zod";
import type { Scene } from "./schema";

/**
 * What a run produces. Each output is its own stage (or part of one), so leaving one out saves
 * real time and money. Beats are the backbone every other output hangs off, so they are always made.
 */
export const OUTPUT_IDS = ["beats", "transcript", "cast", "cameras"] as const;
export type OutputId = (typeof OUTPUT_IDS)[number];
export const OutputsSchema = z.object({
  beats: z.boolean(),
  transcript: z.boolean(),
  cast: z.boolean(),
  cameras: z.boolean(),
});
export type Outputs = z.infer<typeof OutputsSchema>;

/** What a person usually wants first: the story's shape and its words. Cheap, and fast. */
export const DEFAULT_OUTPUTS: Outputs = { beats: true, transcript: true, cast: false, cameras: false };
/** Everything. This is what runs when a client does not say (so older callers are unchanged). */
export const ALL_OUTPUTS: Outputs = { beats: true, transcript: true, cast: true, cameras: true };

export const OUTPUT_INFO: { id: OutputId; label: string; hint: string; locked?: boolean }[] = [
  { id: "beats", label: "Beats", hint: "The story broken into timed moments. Always included; everything else builds on it.", locked: true },
  { id: "transcript", label: "Transcript", hint: "Every line of dialogue and action, timed to the beats." },
  { id: "cast", label: "Characters & props", hint: "Who and what is in the scene, where they stand and how they move, so you can walk around in it." },
  { id: "cameras", label: "Cameras", hint: "A shot list: where each camera sits and what it looks at. Needs the characters & props." },
];

/** Keeps the combination valid: beats always, and cameras need the cast they are aimed at. */
export function normalizeOutputs(o: Partial<Outputs> | null | undefined): Outputs {
  const base = { ...DEFAULT_OUTPUTS, ...o, beats: true };
  return { ...base, cast: base.cast || base.cameras };
}

/** Which outputs a scene actually contains (so older scene files and edits are described truthfully). */
export function presentOutputs(scene: Scene): Outputs {
  return {
    beats: scene.timeline.length > 0,
    transcript: scene.transcript.length > 0,
    cast: scene.entities.length > 0,
    cameras: scene.cameras.length > 0,
  };
}
