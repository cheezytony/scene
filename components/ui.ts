import type { Scene } from "@/lib/schema";

/** Applies a pure scene edit. Edits sharing a `key` in quick succession become one undo step. */
export type EditFn = (fn: (scene: Scene) => Scene, key?: string) => void;

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

export const btn =
  "rounded border border-white/15 px-2 py-0.5 text-xs hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";
export const field = "rounded border border-white/15 bg-neutral-900 px-2 py-1 text-xs";
export const labelText = "text-[11px] uppercase tracking-wide text-white/40";
