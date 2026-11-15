import { z } from "zod";

/**
 * World conventions (also stated in the system prompt):
 * - Units are meters, +y is up, the floor is y = 0, the scene origin is the center of the main set.
 * - +x is screen-right, +z points toward the default camera.
 * - `position` is the center of an entity's base (feet / bottom face).
 * - `rotationY` is degrees about the y axis; 0 faces +z.
 */
export const Vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });

export const Control = z.object({
  key: z.string().describe("snake_case identifier, referenced by keyframe variations"),
  label: z.string(),
  type: z.enum(["choice", "slider", "toggle"]),
  options: z.array(z.string()).describe("allowed values for 'choice'; empty otherwise"),
  min: z.number().describe("slider minimum; 0 otherwise"),
  max: z.number().describe("slider maximum; 0 otherwise"),
  defaultValue: z.string().describe("slider as a number string, toggle as 'true'/'false'"),
});

export const Entity = z.object({
  id: z.string(),
  kind: z.enum(["character", "object"]),
  name: z.string(),
  importance: z.enum(["lead", "supporting", "minor", "plot_critical_prop", "set_dressing"]),
  description: z.string().describe("who/what it is and why it matters in the script"),
  proxy: z.enum(["humanoid", "box", "sphere", "cylinder", "cone"]),
  color: z.string().describe("hex color like #c0392b for the 3D proxy"),
  size: Vec3.describe("bounding dimensions in meters: x width, y height, z depth"),
  controls: z.array(Control),
});

export const Variation = z.object({ key: z.string(), value: z.string() });

export const Keyframe = z.object({
  id: z.string(),
  t: z.number().describe("seconds from start"),
  beatId: z.string(),
  entityId: z.string(),
  position: Vec3,
  rotationY: z.number(),
  state: z.string().describe("short snake_case state, e.g. seated, running, door_open"),
  present: z
    .boolean()
    .describe("false when the entity is not in the scene from this keyframe on (it has left or not yet arrived)"),
  relation: z
    .enum(["none", "attached", "in", "on"])
    .describe("relation to parentId at this moment: attached to, inside, or resting/standing on it"),
  parentId: z.string().describe("id of the entity it is attached to / in / on; empty string if relation is none"),
  variations: z.array(Variation).describe("values for that entity's controls at this moment"),
  note: z.string().describe("why this keyframe exists, tied to the script"),
});

export const Beat = z.object({
  id: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  title: z.string(),
  location: z.string(),
  summary: z.string(),
  mood: z.string(),
});

export const TranscriptLine = z.object({
  id: z.string(),
  beatId: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  kind: z.enum(["dialogue", "action", "narration", "sfx"]),
  speaker: z.string().describe("character name for dialogue, empty string otherwise"),
  text: z.string(),
});

export const Camera = z.object({
  id: z.string(),
  t: z.number().describe("seconds from start when this camera setup begins"),
  beatId: z.string(),
  label: z.string().describe("short shot name, e.g. 'Wide establishing'"),
  shot: z.enum(["wide", "medium", "close_up", "over_shoulder", "overhead", "pov", "tracking"]),
  movement: z
    .enum(["static", "pan", "dolly", "crane", "handheld", "zoom"])
    .describe("motion toward the next camera setup; static holds position until the next one (a cut)"),
  position: Vec3,
  lookAt: Vec3,
  fov: z.number().describe("vertical field of view in degrees"),
  targetEntityId: z.string().describe("entity the shot is framed on; empty string if none"),
  note: z.string(),
});

export const SceneSchema = z.object({
  title: z.string(),
  logline: z.string(),
  durationSec: z.number(),
  timeline: z.array(Beat),
  transcript: z.array(TranscriptLine),
  entities: z.array(Entity),
  keyframes: z.array(Keyframe),
  cameras: z.array(Camera),
});

export type Vec3 = z.infer<typeof Vec3>;
export type Control = z.infer<typeof Control>;
export type Entity = z.infer<typeof Entity>;
export type Keyframe = z.infer<typeof Keyframe>;
export type Camera = z.infer<typeof Camera>;
export type Beat = z.infer<typeof Beat>;
export type TranscriptLine = z.infer<typeof TranscriptLine>;
export type Scene = z.infer<typeof SceneSchema>;

/** Clean up model output: drop dangling references, clamp times, sort. */
export function normalizeScene(raw: Scene): Scene {
  const ids = new Set(raw.entities.map((e) => e.id));
  const dur = Math.max(raw.durationSec, ...raw.timeline.map((b) => b.endSec), 1);
  const clamp = (n: number) => Math.min(Math.max(n, 0), dur);
  return {
    ...raw,
    durationSec: dur,
    timeline: [...raw.timeline]
      .map((b) => ({ ...b, startSec: clamp(b.startSec), endSec: clamp(b.endSec) }))
      .sort((a, b) => a.startSec - b.startSec),
    transcript: [...raw.transcript]
      .map((l) => ({ ...l, startSec: clamp(l.startSec), endSec: clamp(l.endSec) }))
      .sort((a, b) => a.startSec - b.startSec),
    keyframes: raw.keyframes
      .filter((k) => ids.has(k.entityId))
      .map((k) => {
        const validParent = k.relation !== "none" && ids.has(k.parentId) && k.parentId !== k.entityId;
        return {
          ...k,
          t: clamp(k.t),
          relation: validParent ? k.relation : ("none" as const),
          parentId: validParent ? k.parentId : "",
        };
      })
      .sort((a, b) => a.t - b.t),
    cameras: raw.cameras
      .map((c) => ({
        ...c,
        t: clamp(c.t),
        fov: Math.min(Math.max(c.fov, 10), 120),
        targetEntityId: ids.has(c.targetEntityId) ? c.targetEntityId : "",
      }))
      .sort((a, b) => a.t - b.t),
  };
}
