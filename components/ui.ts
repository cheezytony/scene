import type { Scene, Vec3 } from "@/lib/schema";

/** Applies a pure scene edit. Edits sharing a `key` in quick succession become one undo step. */
export type EditFn = (fn: (scene: Scene) => Scene, key?: string) => void;

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

// Small actions inside the editing panels: quiet pills.
export const btn =
  "rounded-full border border-white/12 px-2.5 py-0.5 text-xs text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
export const field =
  "rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/90 transition-colors placeholder:text-white/30 focus:border-white/30 focus:outline-none";
export const labelText = "text-[11px] uppercase tracking-[0.12em] text-white/40";

// Screen-level actions: one confident primary per screen, quiet ghosts beside it.
export const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[#ece7df] px-6 py-2.5 text-sm font-medium text-[#14161b] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40";
export const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm text-white/80 transition-colors hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
export const card = "rounded-2xl border border-white/10 bg-white/[0.03]";

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
