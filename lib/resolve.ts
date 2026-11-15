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

export function keyframesFor(scene: Scene, entityId: string): Keyframe[] {
  return scene.keyframes.filter((k) => k.entityId === entityId);
}

export function activeKeyframe(kfs: Keyframe[], t: number): Keyframe | undefined {
  let found: Keyframe | undefined;
  for (const k of kfs) if (k.t <= t) found = k;
  return found ?? kfs[0];
}

/** Interpolated pose of an entity at time t. Returns null if it has no keyframes. */
export function poseAt(scene: Scene, entity: Entity, t: number): Pose | null {
  const kfs = keyframesFor(scene, entity.id);
  if (!kfs.length) return null;
  const prev = activeKeyframe(kfs, t)!;
  const next = kfs.find((k) => k.t > t);
  const vars: Record<string, string> = {};
  for (const c of entity.controls) vars[c.key] = c.defaultValue;
  for (const v of prev.variations) vars[v.key] = v.value;
  if (!next || prev.t > t || next.t === prev.t) {
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
