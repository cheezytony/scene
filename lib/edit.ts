import type { Beat, Camera, Control, Entity, Keyframe, Scene, TranscriptLine, Vec3 } from "./schema";
import { activeKeyframe, cameraAt, keyframesFor, worldPose } from "./resolve";

/**
 * Pure scene-editing operations. Each returns a new Scene (or the same one when nothing applies).
 *
 * Order in a scene is always derived from time: beats, lines, keyframes and cameras are kept sorted
 * by their start time. "Reordering" therefore means swapping time slots, and a beat's lines,
 * keyframes and cameras (anything with its beatId) travel with it. The stored scene format is
 * unchanged by any of this.
 */

/** Shortest allowed beat or line, in seconds. */
export const MIN_LENGTH = 0.1;
export const DEFAULT_BEAT_LENGTH = 10;
export const DEFAULT_LINE_LENGTH = 3;
export const FOV_RANGE = [10, 120] as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const finite = (n: unknown, fallback: number) => (typeof n === "number" && Number.isFinite(n) ? n : fallback);
const max = (values: number[], floor: number) => values.reduce((m, v) => (v > m ? v : m), floor);
const byStart = <T extends { startSec: number }>(a: T, b: T) => a.startSec - b.startSec;

export function nextId(prefix: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  let n = used.size + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Restores what the rest of the app relies on: all lists sorted by time, duration covering content. */
export function tidy(scene: Scene): Scene {
  const durationSec = max(
    [
      ...scene.timeline.map((b) => b.endSec),
      ...scene.transcript.map((l) => l.endSec),
      ...scene.keyframes.map((k) => k.t),
      ...scene.cameras.map((c) => c.t),
    ],
    scene.durationSec,
  );
  return {
    ...scene,
    durationSec,
    timeline: [...scene.timeline].sort(byStart),
    transcript: [...scene.transcript].sort(byStart),
    keyframes: [...scene.keyframes].sort((a, b) => a.t - b.t),
    cameras: [...scene.cameras].sort((a, b) => a.t - b.t),
  };
}

// ---------------------------------------------------------------------------------------- beats

/** Moves a beat in time, together with everything that belongs to it. */
function shiftBeat(scene: Scene, beatId: string, delta: number): Scene {
  if (delta === 0) return scene;
  const s = (n: number) => Math.max(0, n + delta);
  return {
    ...scene,
    timeline: scene.timeline.map((b) => (b.id === beatId ? { ...b, startSec: s(b.startSec), endSec: s(b.endSec) } : b)),
    transcript: scene.transcript.map((l) =>
      l.beatId === beatId ? { ...l, startSec: s(l.startSec), endSec: s(l.endSec) } : l,
    ),
    keyframes: scene.keyframes.map((k) => (k.beatId === beatId ? { ...k, t: s(k.t) } : k)),
    cameras: scene.cameras.map((c) => (c.beatId === beatId ? { ...c, t: s(c.t) } : c)),
  };
}

/** Swaps a beat with its neighbour in the story (dir -1 = earlier, +1 = later). Lengths and the gap between them are kept. */
export function moveBeat(scene: Scene, beatId: string, dir: -1 | 1): Scene {
  const beats = [...scene.timeline].sort(byStart);
  const i = beats.findIndex((b) => b.id === beatId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= beats.length) return scene;
  const [first, second] = dir < 0 ? [beats[j], beats[i]] : [beats[i], beats[j]];
  const gap = Math.max(0, second.startSec - first.endSec);
  const lenSecond = second.endSec - second.startSec;
  let out = shiftBeat(scene, second.id, first.startSec - second.startSec);
  out = shiftBeat(out, first.id, lenSecond + gap);
  return tidy(out);
}

/**
 * Adds a beat after `afterId` (or at the end). Later beats, with their content, shift later by the
 * new beat's length so nothing overlaps.
 */
export function addBeat(scene: Scene, afterId: string | null, init: Partial<Beat> = {}): Scene {
  const beats = [...scene.timeline].sort(byStart);
  const idx = afterId === null ? beats.length - 1 : beats.findIndex((b) => b.id === afterId);
  const at = idx >= 0 ? beats[idx].endSec : 0;
  const length = DEFAULT_BEAT_LENGTH;
  let out = scene;
  for (const later of beats.slice(idx + 1)) out = shiftBeat(out, later.id, length);
  const beat: Beat = {
    title: "New beat",
    location: "",
    summary: "",
    mood: "",
    ...init,
    id: init.id ?? nextId("b", scene.timeline.map((b) => b.id)),
    startSec: at,
    endSec: at + length,
  };
  return tidy({ ...out, timeline: [...out.timeline, beat] });
}

export function updateBeat(scene: Scene, id: string, patch: Partial<Omit<Beat, "id">>): Scene {
  const beat = scene.timeline.find((b) => b.id === id);
  if (!beat) return scene;
  const next = { ...beat, ...patch };
  const startSec = Math.max(0, finite(next.startSec, beat.startSec));
  const endSec = Math.max(finite(next.endSec, beat.endSec), startSec + MIN_LENGTH);
  return tidy({ ...scene, timeline: scene.timeline.map((b) => (b.id === id ? { ...next, id, startSec, endSec } : b)) });
}

/** What deleting a beat would remove along with it. */
export function beatDependents(scene: Scene, beatId: string) {
  return {
    lines: scene.transcript.filter((l) => l.beatId === beatId).length,
    cameras: scene.cameras.filter((c) => c.beatId === beatId).length,
    keyframes: scene.keyframes.filter((k) => k.beatId === beatId).length,
  };
}

/** Deletes a beat and everything that belongs to it (its lines, keyframes and cameras). Undoable in the UI. */
export function deleteBeat(scene: Scene, id: string): Scene {
  if (!scene.timeline.some((b) => b.id === id)) return scene;
  return {
    ...scene,
    timeline: scene.timeline.filter((b) => b.id !== id),
    transcript: scene.transcript.filter((l) => l.beatId !== id),
    keyframes: scene.keyframes.filter((k) => k.beatId !== id),
    cameras: scene.cameras.filter((c) => c.beatId !== id),
  };
}

// ----------------------------------------------------------------------------------- transcript

/** Adds a line inside a beat, at time `at` (default the beat's start). */
export function addLine(scene: Scene, beatId: string, init: Partial<TranscriptLine> = {}, at?: number): Scene {
  const beat = scene.timeline.find((b) => b.id === beatId);
  if (!beat) return scene;
  const startSec = clamp(at ?? beat.startSec, beat.startSec, Math.max(beat.startSec, beat.endSec - MIN_LENGTH));
  const endSec = Math.min(startSec + DEFAULT_LINE_LENGTH, Math.max(beat.endSec, startSec + MIN_LENGTH));
  const line: TranscriptLine = {
    kind: "dialogue",
    speaker: "",
    text: "",
    ...init,
    id: init.id ?? nextId("l", scene.transcript.map((l) => l.id)),
    beatId,
    startSec,
    endSec,
  };
  return tidy({ ...scene, transcript: [...scene.transcript, line] });
}

export function updateLine(scene: Scene, id: string, patch: Partial<Omit<TranscriptLine, "id">>): Scene {
  const line = scene.transcript.find((l) => l.id === id);
  if (!line) return scene;
  let next = { ...line, ...patch };
  const target = scene.timeline.find((b) => b.id === next.beatId);
  if (!target) next = { ...next, beatId: line.beatId }; // unknown beat: keep the old one
  let startSec = Math.max(0, finite(next.startSec, line.startSec));
  let endSec = Math.max(finite(next.endSec, line.endSec), startSec + MIN_LENGTH);
  const newBeat = scene.timeline.find((b) => b.id === next.beatId);
  if (patch.beatId !== undefined && patch.beatId !== line.beatId && newBeat) {
    // Moving to another beat: bring the line inside it, keeping its length where possible.
    const length = endSec - startSec;
    startSec = clamp(startSec, newBeat.startSec, Math.max(newBeat.startSec, newBeat.endSec - MIN_LENGTH));
    endSec = Math.min(startSec + length, Math.max(newBeat.endSec, startSec + MIN_LENGTH));
  }
  return tidy({ ...scene, transcript: scene.transcript.map((l) => (l.id === id ? { ...next, id, startSec, endSec } : l)) });
}

export function deleteLine(scene: Scene, id: string): Scene {
  if (!scene.transcript.some((l) => l.id === id)) return scene;
  return { ...scene, transcript: scene.transcript.filter((l) => l.id !== id) };
}

/** Swaps a line with its neighbour inside the same beat (dir -1 = earlier, +1 = later). */
export function moveLine(scene: Scene, id: string, dir: -1 | 1): Scene {
  const line = scene.transcript.find((l) => l.id === id);
  if (!line) return scene;
  const peers = scene.transcript.filter((l) => l.beatId === line.beatId).sort(byStart);
  const i = peers.findIndex((l) => l.id === id);
  const j = i + dir;
  if (j < 0 || j >= peers.length) return scene;
  const [first, second] = dir < 0 ? [peers[j], peers[i]] : [peers[i], peers[j]];
  const gap = Math.max(0, second.startSec - first.endSec);
  const lenFirst = first.endSec - first.startSec;
  const lenSecond = second.endSec - second.startSec;
  const place = (l: TranscriptLine, startSec: number, length: number) => ({ ...l, startSec, endSec: startSec + length });
  return tidy({
    ...scene,
    transcript: scene.transcript.map((l) =>
      l.id === second.id
        ? place(l, first.startSec, lenSecond)
        : l.id === first.id
          ? place(l, first.startSec + lenSecond + gap, lenFirst)
          : l,
    ),
  });
}

// -------------------------------------------------------------------------------------- cameras

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const cleanVec = (v: Vec3, fallback: Vec3): Vec3 => ({
  x: finite(v.x, fallback.x),
  y: finite(v.y, fallback.y),
  z: finite(v.z, fallback.z),
});

/** Adds a camera at time `t`, starting from the camera in effect there (moved 1 m aside so it is visible). */
export function addCamera(scene: Scene, t: number, init: Partial<Camera> = {}): Scene {
  const base = cameraAt(scene, t);
  const beat = scene.timeline.find((b) => t >= b.startSec && t < b.endSec) ?? scene.timeline.at(-1);
  const camera: Camera = {
    label: `Camera ${scene.cameras.length + 1}`,
    shot: "medium",
    movement: "static",
    position: base ? v3(base.position.x + 1, base.position.y, base.position.z) : v3(0, 3, 9),
    lookAt: base ? base.lookAt : v3(0, 1, 0),
    fov: base ? base.fov : 50,
    targetEntityId: "",
    note: "",
    beatId: beat?.id ?? "",
    ...init,
    id: init.id ?? nextId("c", scene.cameras.map((c) => c.id)),
    t: clamp(finite(t, 0), 0, scene.durationSec),
  };
  return tidy({ ...scene, cameras: [...scene.cameras, camera] });
}

/** Updates a camera. Numbers are made finite and kept in range, so typing can never produce an invalid camera. */
export function updateCamera(scene: Scene, id: string, patch: Partial<Omit<Camera, "id">>): Scene {
  const cam = scene.cameras.find((c) => c.id === id);
  if (!cam) return scene;
  const next = { ...cam, ...patch };
  const updated: Camera = {
    ...next,
    id,
    t: clamp(finite(next.t, cam.t), 0, scene.durationSec),
    fov: clamp(finite(next.fov, cam.fov), FOV_RANGE[0], FOV_RANGE[1]),
    position: cleanVec(next.position, cam.position),
    lookAt: cleanVec(next.lookAt, cam.lookAt),
    beatId: scene.timeline.some((b) => b.id === next.beatId) ? next.beatId : cam.beatId,
    targetEntityId: scene.entities.some((e) => e.id === next.targetEntityId) ? next.targetEntityId : "",
  };
  return tidy({ ...scene, cameras: scene.cameras.map((c) => (c.id === id ? updated : c)) });
}

export function deleteCamera(scene: Scene, id: string): Scene {
  if (!scene.cameras.some((c) => c.id === id)) return scene;
  return { ...scene, cameras: scene.cameras.filter((c) => c.id !== id) };
}

/** Problems worth showing next to a camera (it is still stored as-is). */
export function cameraIssues(c: Camera): string[] {
  const out: string[] = [];
  const { position: p, lookAt: l } = c;
  if (p.x === l.x && p.y === l.y && p.z === l.z) out.push("Position and look-at are the same point, so there is no view direction.");
  if (p.y < 0) out.push("The camera is below the floor.");
  return out;
}

// ------------------------------------------------------------------------------ camera direction

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Where a camera faces, derived from its position and look-at point: yaw in degrees (0 faces +z,
 * 90 faces +x, like rotationY), pitch in degrees (up is positive), and the distance to the look-at.
 */
export function cameraDirection(c: Pick<Camera, "position" | "lookAt">) {
  const dx = c.lookAt.x - c.position.x;
  const dy = c.lookAt.y - c.position.y;
  const dz = c.lookAt.z - c.position.z;
  const horizontal = Math.hypot(dx, dz);
  const distance = Math.hypot(horizontal, dy);
  if (distance === 0) return { yaw: 0, pitch: 0, distance: 0 };
  return { yaw: deg(Math.atan2(dx, dz)), pitch: deg(Math.atan2(dy, horizontal)), distance };
}

/** The look-at point `distance` meters from `position` in the direction given by yaw and pitch. */
export function lookAtFromDirection(position: Vec3, yaw: number, pitch: number, distance: number): Vec3 {
  const y = rad(yaw);
  const p = rad(clamp(pitch, -89.9, 89.9));
  return {
    x: round4(position.x + distance * Math.cos(p) * Math.sin(y)),
    y: round4(position.y + distance * Math.sin(p)),
    z: round4(position.z + distance * Math.cos(p) * Math.cos(y)),
  };
}

/** Points a camera in a direction, keeping its position and its distance to the look-at point. */
export function setCameraDirection(scene: Scene, id: string, dir: { yaw?: number; pitch?: number }): Scene {
  const cam = scene.cameras.find((c) => c.id === id);
  if (!cam) return scene;
  const current = cameraDirection(cam);
  const distance = current.distance || 1;
  const yaw = finite(dir.yaw, current.yaw);
  const pitch = finite(dir.pitch, current.pitch);
  return updateCamera(scene, id, { lookAt: lookAtFromDirection(cam.position, yaw, pitch, distance) });
}

/**
 * Moves a camera. With `keepDirection` the look-at point moves by the same amount, so the camera
 * keeps facing the same way; without it the look-at stays put and the view swings round to it.
 */
export function moveCamera(scene: Scene, id: string, position: Vec3, keepDirection: boolean): Scene {
  const cam = scene.cameras.find((c) => c.id === id);
  if (!cam) return scene;
  const next = cleanVec(position, cam.position);
  if (!keepDirection) return updateCamera(scene, id, { position: next });
  const lookAt = {
    x: round4(cam.lookAt.x + next.x - cam.position.x),
    y: round4(cam.lookAt.y + next.y - cam.position.y),
    z: round4(cam.lookAt.z + next.z - cam.position.z),
  };
  return updateCamera(scene, id, { position: next, lookAt });
}

// -------------------------------------------------------------------------- characters and objects

const HEX = /^#[0-9a-fA-F]{6}$/;
export const SIZE_RANGE = [0.01, 50] as const;
const PALETTE = ["#c0392b", "#2980b9", "#27ae60", "#8e44ad", "#d68910", "#16a085", "#7f8c8d"];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Makes a control definition internally consistent, whatever was typed into it. */
function cleanControl(c: Control): Control {
  if (c.type === "choice") {
    const options = [...new Set(c.options.map((o) => o.trim()).filter(Boolean))];
    return { ...c, options, min: 0, max: 0, defaultValue: options.includes(c.defaultValue) ? c.defaultValue : (options[0] ?? "") };
  }
  if (c.type === "slider") {
    const min = finite(c.min, 0);
    const max = Math.max(finite(c.max, 10), min);
    const value = clamp(finite(Number(c.defaultValue), min), min, max);
    return { ...c, options: [], min, max, defaultValue: String(value) };
  }
  return { ...c, options: [], min: 0, max: 0, defaultValue: c.defaultValue === "true" ? "true" : "false" };
}

/** Adds a character or object. It gets a first keyframe at time `t` so it shows up right away. */
export function addEntity(scene: Scene, kind: Entity["kind"], t: number, init: Partial<Entity> = {}): Scene {
  const n = scene.entities.filter((e) => e.kind === kind).length + 1;
  const entity: Entity = {
    name: kind === "character" ? `Character ${n}` : `Object ${n}`,
    importance: "minor",
    description: "",
    proxy: kind === "character" ? "humanoid" : "box",
    color: PALETTE[scene.entities.length % PALETTE.length],
    size: kind === "character" ? v3(0.5, 1.7, 0.4) : v3(0.5, 0.5, 0.5),
    controls: [],
    ...init,
    id: init.id ?? nextId("e", scene.entities.map((e) => e.id)),
    kind,
  };
  const withEntity: Scene = { ...scene, entities: [...scene.entities, entity] };
  const time = clamp(finite(t, 0), 0, scene.durationSec);
  const beat = scene.timeline.find((b) => time >= b.startSec && time < b.endSec) ?? scene.timeline.at(-1);
  const keyframe: Keyframe = {
    id: nextId("k", scene.keyframes.map((k) => k.id)),
    t: time,
    beatId: beat?.id ?? "",
    entityId: entity.id,
    position: v3(((scene.entities.length % 5) - 2) * 1.2, 0, 0),
    rotationY: 0,
    state: "idle",
    present: true,
    relation: "none",
    parentId: "",
    variations: [],
    note: "",
  };
  return tidy({ ...withEntity, keyframes: [...scene.keyframes, keyframe] });
}

export function updateEntity(scene: Scene, id: string, patch: Partial<Omit<Entity, "id">>): Scene {
  const entity = scene.entities.find((e) => e.id === id);
  if (!entity) return scene;
  const next = { ...entity, ...patch };
  const size = (n: number, old: number) => clamp(finite(n, old), SIZE_RANGE[0], SIZE_RANGE[1]);
  const updated: Entity = {
    ...next,
    id,
    color: HEX.test(next.color) ? next.color : entity.color,
    size: {
      x: size(next.size.x, entity.size.x),
      y: size(next.size.y, entity.size.y),
      z: size(next.size.z, entity.size.z),
    },
    controls: next.controls.map(cleanControl),
  };
  return { ...scene, entities: scene.entities.map((e) => (e.id === id ? updated : e)) };
}

/** What deleting an entity touches besides the entity itself. */
export function entityDependents(scene: Scene, id: string) {
  return {
    keyframes: scene.keyframes.filter((k) => k.entityId === id).length,
    cameras: scene.cameras.filter((c) => c.targetEntityId === id).length,
    children: new Set(scene.keyframes.filter((k) => k.parentId === id).map((k) => k.entityId)).size,
  };
}

/**
 * Deletes an entity and its keyframes. Cameras that framed it stop framing anything, and anything
 * that was attached to / in / on it is detached (it stays where it was).
 */
export function deleteEntity(scene: Scene, id: string): Scene {
  if (!scene.entities.some((e) => e.id === id)) return scene;
  return {
    ...scene,
    entities: scene.entities.filter((e) => e.id !== id),
    keyframes: scene.keyframes
      .filter((k) => k.entityId !== id)
      .map((k) => (k.parentId === id ? { ...k, relation: "none" as const, parentId: "" } : k)),
    cameras: scene.cameras.map((c) => (c.targetEntityId === id ? { ...c, targetEntityId: "" } : c)),
  };
}

/** Adds a control. Its key (referenced by keyframe variations) is made from the label and never changes after. */
export function addControl(scene: Scene, entityId: string, init: Partial<Control> = {}): Scene {
  const entity = scene.entities.find((e) => e.id === entityId);
  if (!entity) return scene;
  const label = init.label ?? "New control";
  const taken = new Set(entity.controls.map((c) => c.key));
  const base = slug(label) || "control";
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  const control = cleanControl({ type: "slider", options: [], min: 0, max: 10, defaultValue: "0", ...init, label, key });
  return updateEntity(scene, entityId, { controls: [...entity.controls, control] });
}

export function updateControl(scene: Scene, entityId: string, key: string, patch: Partial<Omit<Control, "key">>): Scene {
  const entity = scene.entities.find((e) => e.id === entityId);
  if (!entity?.controls.some((c) => c.key === key)) return scene;
  return updateEntity(scene, entityId, {
    controls: entity.controls.map((c) => (c.key === key ? { ...c, ...patch, key } : c)),
  });
}

/** Removes a control and the values it had at keyframes. */
export function deleteControl(scene: Scene, entityId: string, key: string): Scene {
  const entity = scene.entities.find((e) => e.id === entityId);
  if (!entity?.controls.some((c) => c.key === key)) return scene;
  const without = updateEntity(scene, entityId, { controls: entity.controls.filter((c) => c.key !== key) });
  return {
    ...without,
    keyframes: without.keyframes.map((k) =>
      k.entityId === entityId && k.variations.some((v) => v.key === key)
        ? { ...k, variations: k.variations.filter((v) => v.key !== key) }
        : k,
    ),
  };
}

/** Sets a control's value from the keyframe in effect at time `t` onward (until a later keyframe sets it again). */
export function setVariation(scene: Scene, entityId: string, key: string, value: string, t: number): Scene {
  const kf = activeKeyframe(keyframesFor(scene, entityId), t);
  if (!kf) return scene;
  return {
    ...scene,
    keyframes: scene.keyframes.map((k) =>
      k.id !== kf.id
        ? k
        : {
            ...k,
            variations: k.variations.some((v) => v.key === key)
              ? k.variations.map((v) => (v.key === key ? { ...v, value } : v))
              : [...k.variations, { key, value }],
          },
    ),
  };
}

// ---------------------------------------------------------------------------------------- keyframes

/**
 * Adds a keyframe for an entity at time `t`, starting from how it looks there now (including
 * following a parent), so adding one never makes it jump. Does nothing if it already has a keyframe at `t`.
 */
export function addKeyframe(scene: Scene, entityId: string, t: number, init: Partial<Keyframe> = {}): Scene {
  const entity = scene.entities.find((e) => e.id === entityId);
  if (!entity) return scene;
  const time = clamp(finite(t, 0), 0, scene.durationSec);
  const kfs = keyframesFor(scene, entityId);
  if (kfs.some((k) => Math.abs(k.t - time) < 1e-6)) return scene;
  const pose = worldPose(scene, entity, time);
  const prev = activeKeyframe(kfs, time);
  const beat = scene.timeline.find((b) => time >= b.startSec && time < b.endSec) ?? scene.timeline.at(-1);
  const keyframe: Keyframe = {
    beatId: beat?.id ?? prev?.beatId ?? "",
    position: pose?.position ?? prev?.position ?? v3(0, 0, 0),
    rotationY: pose?.rotationY ?? prev?.rotationY ?? 0,
    state: pose?.state ?? prev?.state ?? "idle",
    present: true,
    relation: pose?.relation ?? "none",
    parentId: pose?.parentId ?? "",
    variations: [],
    note: "",
    ...init,
    id: init.id ?? nextId("k", scene.keyframes.map((k) => k.id)),
    entityId,
    t: time,
  };
  return tidy({ ...scene, keyframes: [...scene.keyframes, keyframe] });
}

export function updateKeyframe(scene: Scene, id: string, patch: Partial<Omit<Keyframe, "id" | "entityId">>): Scene {
  const kf = scene.keyframes.find((k) => k.id === id);
  if (!kf) return scene;
  const next = { ...kf, ...patch };
  const parentOk =
    next.relation !== "none" && next.parentId !== kf.entityId && scene.entities.some((e) => e.id === next.parentId);
  const updated: Keyframe = {
    ...next,
    id,
    entityId: kf.entityId,
    t: clamp(finite(next.t, kf.t), 0, scene.durationSec),
    position: cleanVec(next.position, kf.position),
    rotationY: finite(next.rotationY, kf.rotationY),
    beatId: scene.timeline.some((b) => b.id === next.beatId) ? next.beatId : kf.beatId,
    relation: parentOk ? next.relation : "none",
    parentId: parentOk ? next.parentId : "",
  };
  return tidy({ ...scene, keyframes: scene.keyframes.map((k) => (k.id === id ? updated : k)) });
}

export function deleteKeyframe(scene: Scene, id: string): Scene {
  if (!scene.keyframes.some((k) => k.id === id)) return scene;
  return { ...scene, keyframes: scene.keyframes.filter((k) => k.id !== id) };
}
