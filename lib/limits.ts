import { z } from "zod";
import type { Entity, Scene } from "./schema";
import { activeKeyframe, keyframesFor } from "./resolve";

const Limit = z.number().int().nonnegative().nullable(); // null = no limit

export const LimitsSchema = z.object({
  maxCharacters: Limit,
  minObjects: Limit,
  maxObjects: Limit,
  maxAttachedPerObject: Limit,
  maxOccupantsPerObject: Limit,
  maxTotal: Limit,
});
export type Limits = z.infer<typeof LimitsSchema>;

export const DEFAULT_LIMITS: Limits = {
  maxCharacters: 6,
  minObjects: 2,
  maxObjects: 10,
  maxAttachedPerObject: 3,
  maxOccupantsPerObject: 4,
  maxTotal: 14,
};

export const LIMIT_FIELDS: { key: keyof Limits; label: string; hint: string }[] = [
  { key: "maxCharacters", label: "Max characters", hint: "Characters tracked in the whole breakdown" },
  { key: "minObjects", label: "Min objects", hint: "Fewest objects (props, set pieces) in the scene" },
  { key: "maxObjects", label: "Max objects", hint: "Most objects in the scene" },
  { key: "maxAttachedPerObject", label: "Max attached to / in an object", hint: "Objects attached to or inside any one object, at any moment" },
  { key: "maxOccupantsPerObject", label: "Max things in / on an object", hint: "Objects plus people in or on any one object (a car, a table), at any moment" },
  { key: "maxTotal", label: "Max objects + people", hint: "Objects plus characters in the scene" },
];

/** Limits that can never be satisfied together. */
export function limitConflicts(l: Limits): string[] {
  const out: string[] = [];
  if (l.minObjects !== null && l.maxObjects !== null && l.minObjects > l.maxObjects)
    out.push("Min objects is greater than max objects.");
  if (l.minObjects !== null && l.maxTotal !== null && l.minObjects > l.maxTotal)
    out.push("Min objects is greater than max objects + people.");
  return out;
}

/** Plain-language limits for the prompt. */
export function describeLimits(l: Limits): string {
  const rules: string[] = [];
  if (l.maxCharacters !== null) rules.push(`- At most ${l.maxCharacters} characters in entities.`);
  if (l.minObjects !== null) rules.push(`- At least ${l.minObjects} objects in entities.`);
  if (l.maxObjects !== null) rules.push(`- At most ${l.maxObjects} objects in entities.`);
  if (l.maxTotal !== null) rules.push(`- At most ${l.maxTotal} entities in total (objects plus characters).`);
  if (l.maxAttachedPerObject !== null)
    rules.push(`- At most ${l.maxAttachedPerObject} objects attached to or inside any single object at any moment (relation "attached" or "in", kind object).`);
  if (l.maxOccupantsPerObject !== null)
    rules.push(`- At most ${l.maxOccupantsPerObject} entities (objects plus characters) in or on any single object at any moment (relation "in" or "on").`);
  return rules.length
    ? `Hard limits - the breakdown must satisfy all of them. When over a maximum, keep the most plot-important entities and drop the rest:\n${rules.join("\n")}`
    : "";
}

/** Limits that depend only on the entity list (known after the cast stage). */
export function checkCounts(entities: Entity[], l: Limits): string[] {
  const out: string[] = [];
  const chars = entities.filter((e) => e.kind === "character").length;
  const objs = entities.length - chars;
  if (l.maxCharacters !== null && chars > l.maxCharacters) out.push(`${chars} characters; max is ${l.maxCharacters}.`);
  if (l.minObjects !== null && objs < l.minObjects) out.push(`${objs} objects; min is ${l.minObjects}.`);
  if (l.maxObjects !== null && objs > l.maxObjects) out.push(`${objs} objects; max is ${l.maxObjects}.`);
  if (l.maxTotal !== null && entities.length > l.maxTotal)
    out.push(`${entities.length} objects plus characters; max is ${l.maxTotal}.`);
  return out;
}

/** Returns human-readable violations (empty when the scene respects the limits). */
export function checkLimits(scene: Scene, l: Limits): string[] {
  return [...checkCounts(scene.entities, l), ...checkRelations(scene, l)];
}

/** Limits on what is attached to / in / on what, evaluated at every keyframe time. */
export function checkRelations(scene: Scene, l: Limits): string[] {
  const out: string[] = [];
  const kind = new Map(scene.entities.map((e) => [e.id, e.kind]));
  const times = [...new Set(scene.keyframes.map((k) => k.t))].sort((a, b) => a - b);
  const seen = new Set<string>();
  for (const T of times) {
    const attached = new Map<string, number>();
    const occupants = new Map<string, number>();
    for (const e of scene.entities) {
      const kfs = keyframesFor(scene, e.id).filter((k) => k.t <= T);
      const kf = kfs.length ? activeKeyframe(kfs, T) : undefined;
      if (!kf || !kf.present || kf.relation === "none" || !kf.parentId) continue;
      if ((kf.relation === "attached" || kf.relation === "in") && e.kind === "object")
        attached.set(kf.parentId, (attached.get(kf.parentId) ?? 0) + 1);
      if (kf.relation === "in" || kf.relation === "on") occupants.set(kf.parentId, (occupants.get(kf.parentId) ?? 0) + 1);
    }
    const name = (id: string) => scene.entities.find((e) => e.id === id)?.name ?? id;
    const report = (map: Map<string, number>, max: number | null, what: string) => {
      if (max === null) return;
      for (const [parent, n] of map) {
        const key = `${what}:${parent}:${n}`;
        if (n > max && !seen.has(key) && kind.has(parent)) {
          seen.add(key);
          out.push(`${n} ${what} "${name(parent)}" at ${T.toFixed(1)}s; max is ${max}.`);
        }
      }
    };
    report(attached, l.maxAttachedPerObject, "objects attached to or in");
    report(occupants, l.maxOccupantsPerObject, "objects/people in or on");
  }
  return out;
}
