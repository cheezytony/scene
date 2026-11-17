import type { Scene, Vec3 } from "./schema";
import type { ViewerSettings } from "./viewer-settings";

/** Axis-aligned box the free camera is kept inside when boundaries are on. Meters, y up. */
export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** Meters of room around the content, per `space` setting. */
const PADDING: Record<ViewerSettings["space"], number> = { tight: 1.5, auto: 4, wide: 12 };
/** Even a tiny scene gets at least this much floor space to move in. */
const MIN_SPAN = 12;
const MIN_HEIGHT = 6;

export const EYE_HEIGHT = 1.7;
/** Lowest the camera may go when boundaries are on, so it never ends up under the floor. */
export const FLOOR_CLEARANCE = 0.2;

/** The space around everything the scene uses: entities, their sizes and every camera setup. */
export function computeBounds(scene: Scene, space: ViewerSettings["space"]): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let maxY = 0;
  const include = (x: number, y: number, z: number, halfX = 0, halfZ = 0) => {
    minX = Math.min(minX, x - halfX);
    maxX = Math.max(maxX, x + halfX);
    minZ = Math.min(minZ, z - halfZ);
    maxZ = Math.max(maxZ, z + halfZ);
    maxY = Math.max(maxY, y);
  };

  const sizes = new Map(scene.entities.map((e) => [e.id, e.size]));
  for (const k of scene.keyframes) {
    const size = sizes.get(k.entityId);
    include(k.position.x, k.position.y + (size?.y ?? 0), k.position.z, (size?.x ?? 0) / 2, (size?.z ?? 0) / 2);
  }
  for (const c of scene.cameras) {
    include(c.position.x, c.position.y, c.position.z);
    include(c.lookAt.x, c.lookAt.y, c.lookAt.z);
  }

  const pad = PADDING[space];
  const axis = (lo: number, hi: number): [number, number] => {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0;
      hi = 0;
    }
    const center = (lo + hi) / 2;
    const half = Math.max(hi - lo, MIN_SPAN) / 2;
    return [center - half - pad, center + half + pad];
  };
  const [x0, x1] = axis(minX, maxX);
  const [z0, z1] = axis(minZ, maxZ);
  return {
    min: { x: x0, y: 0, z: z0 },
    max: { x: x1, y: Math.max(maxY + pad, MIN_HEIGHT), z: z1 },
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Nearest point inside the bounds (and above the floor). */
export function clampPoint(p: Vec3, b: Bounds): Vec3 {
  return {
    x: clamp(p.x, b.min.x, b.max.x),
    y: clamp(p.y, Math.max(b.min.y, FLOOR_CLEARANCE), b.max.y),
    z: clamp(p.z, b.min.z, b.max.z),
  };
}

const BASE_SPEED: Record<ViewerSettings["speed"], number> = { slow: 1.5, normal: 3, fast: 6 };

/** Walk/fly speed in meters per second, scaled up a little for large spaces. */
export function moveSpeed(bounds: Bounds, speed: ViewerSettings["speed"]): number {
  const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
  return BASE_SPEED[speed] * clamp(span / 16, 0.75, 2.5);
}
