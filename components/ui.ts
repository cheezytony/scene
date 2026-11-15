import type { Scene, Vec3 } from "@/lib/schema";

/** Applies a pure scene edit. Edits sharing a `key` in quick succession become one undo step. */
export type EditFn = (fn: (scene: Scene) => Scene, key?: string) => void;

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

export const btn =
  "rounded border border-white/15 px-2 py-0.5 text-xs hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";
export const field = "rounded border border-white/15 bg-neutral-900 px-2 py-1 text-xs";
export const labelText = "text-[11px] uppercase tracking-wide text-white/40";

/** A camera pose in scene coordinates (meters). */
export interface ViewPose {
  position: Vec3;
  lookAt: Vec3;
}

/** What the 3D viewer offers the rest of the page: read where the viewer is looking, or send it somewhere. */
export interface ViewApi {
  /** The viewer's current position, look-at point and field of view. */
  capture: () => ViewPose & { fov: number };
  /** Move the viewer to a pose (position and what it looks at). */
  focus: (pose: ViewPose) => void;
}
