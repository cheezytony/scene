import type { Camera, Entity, Keyframe, Scene, Vec3 } from "./schema";

export interface Pose {
  position: Vec3;
  rotationY: number;
  state: string;
  variations: Record<string, string>;
  relation: Keyframe["relation"];
  parentId: string;
  /** id of the keyframe currently in effect (the latest one at or before t) */
  keyframeId: string | null;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpAngle = (a: number, b: number, k: number) => {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * k;
};

// Keyframes grouped by entity, cached per keyframes array (edits replace the array, so the cache
// invalidates itself). Assumes scene.keyframes is sorted by t, which normalizeScene guarantees.
const byEntity = new WeakMap<Keyframe[], Map<string, Keyframe[]>>();

export function keyframesFor(scene: Scene, entityId: string): Keyframe[] {
  let groups = byEntity.get(scene.keyframes);
  if (!groups) {
    groups = new Map();
    for (const k of scene.keyframes) {
      const list = groups.get(k.entityId);
      if (list) list.push(k);
      else groups.set(k.entityId, [k]);
    }
    byEntity.set(scene.keyframes, groups);
  }
  return groups.get(entityId) ?? [];
}

/**
 * Control values at time t. Variations carry forward: each keyframe overrides only the keys it
 * lists. Before the first keyframe, the first keyframe's values are shown (nothing is rendered then).
 */
export function variationsAt(scene: Scene, entity: Entity, t: number): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const c of entity.controls) vars[c.key] = c.defaultValue;
  const kfs = keyframesFor(scene, entity.id);
  for (const k of kfs) {
    if (k.t > t && k !== kfs[0]) break;
    for (const v of k.variations) vars[v.key] = v.value;
  }
  return vars;
}

export function activeKeyframe(kfs: Keyframe[], t: number): Keyframe | undefined {
  let found: Keyframe | undefined;
  for (const k of kfs) if (k.t <= t) found = k;
  return found ?? kfs[0];
}

/**
 * Interpolated pose of an entity at time t, ignoring parents. Returns null when the entity is not
 * in the scene: before its first keyframe, or after a keyframe with present = false.
 */
export function poseAt(scene: Scene, entity: Entity, t: number): Pose | null {
  const kfs = keyframesFor(scene, entity.id);
  if (!kfs.length || kfs[0].t > t) return null;
  const prev = activeKeyframe(kfs, t)!;
  if (!prev.present) return null;
  const next = kfs.find((k) => k.t > t);
  const vars = variationsAt(scene, entity, t);
  if (!next || !next.present || next.t === prev.t) {
    return {
      position: prev.position,
      rotationY: prev.rotationY,
      state: prev.state,
      variations: vars,
      relation: prev.relation,
      parentId: prev.parentId,
      keyframeId: prev.id,
    };
  }
  const k = (t - prev.t) / (next.t - prev.t);
  return {
    position: {
      x: lerp(prev.position.x, next.position.x, k),
      y: lerp(prev.position.y, next.position.y, k),
      z: lerp(prev.position.z, next.position.z, k),
    },
    rotationY: lerpAngle(prev.rotationY, next.rotationY, k),
    state: prev.state,
    variations: vars,
    relation: prev.relation,
    parentId: prev.parentId,
    keyframeId: prev.id,
  };
}

/**
 * Pose in world space. An entity that is attached to / in / on another follows it: its position is
 * the parent's current position plus the offset recorded at its own keyframe (translation only).
 */
export function worldPose(scene: Scene, entity: Entity, t: number, depth = 0): Pose | null {
  const pose = poseAt(scene, entity, t);
  if (!pose || pose.relation === "none" || depth >= 4) return pose;
  const parent = scene.entities.find((e) => e.id === pose.parentId);
  const kf = keyframesFor(scene, entity.id).find((k) => k.id === pose.keyframeId);
  if (!parent || !kf) return pose;
  const parentNow = worldPose(scene, parent, t, depth + 1);
  const parentThen = worldPose(scene, parent, kf.t, depth + 1);
  if (!parentNow || !parentThen) return pose;
  return {
    ...pose,
    position: {
      x: parentNow.position.x + kf.position.x - parentThen.position.x,
      y: parentNow.position.y + kf.position.y - parentThen.position.y,
      z: parentNow.position.z + kf.position.z - parentThen.position.z,
    },
  };
}

export interface CameraPose {
  position: Vec3;
  lookAt: Vec3;
  fov: number;
  camera: Camera;
}

/** Camera in effect at t. Non-static setups glide toward the next setup; static ones cut. */
export function cameraAt(scene: Scene, t: number): CameraPose | null {
  const cams = scene.cameras;
  if (!cams.length) return null;
  let prev = cams[0];
  for (const c of cams) if (c.t <= t) prev = c;
  const next = cams.find((c) => c.t > t);
  if (!next || prev.t > t || prev.movement === "static") {
    return { position: prev.position, lookAt: prev.lookAt, fov: prev.fov, camera: prev };
  }
  const k = (t - prev.t) / (next.t - prev.t);
  const mix = (a: Vec3, b: Vec3): Vec3 => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) });
  return {
    position: mix(prev.position, next.position),
    lookAt: mix(prev.lookAt, next.lookAt),
    fov: lerp(prev.fov, next.fov, k),
    camera: prev,
  };
}
