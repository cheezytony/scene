import { z } from "zod";

/**
 * Viewer preferences. Every field has a safe default via `.catch`, so a missing key, a bad value, or
 * settings saved by an older or newer build always load (new fields just take their defaults).
 */
export const ViewerSettingsSchema = z.object({
  /** orbit: drag to rotate around the scene. walk: first person at eye height. fly: free first person. */
  movement: z.enum(["orbit", "walk", "fly"]).catch("orbit"),
  speed: z.enum(["slow", "normal", "fast"]).catch("normal"),
  /** How much room around the content the viewer may move in (only applies when boundaries are on). */
  space: z.enum(["tight", "auto", "wide"]).catch("auto"),
  /** Keep the camera inside the scene's space so you can't drift off. Turn off for unrestricted movement. */
  boundaries: z.boolean().catch(true),
  grid: z.boolean().catch(true),
});

export type ViewerSettings = z.infer<typeof ViewerSettingsSchema>;

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = ViewerSettingsSchema.parse({});

// The version in the key is only for incompatible redefinitions of an existing field; adding fields
// never needs a new key.
const STORAGE_KEY = "scene.viewer-settings.v1";

export function loadViewerSettings(): ViewerSettings {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
    return ViewerSettingsSchema.parse(raw ? JSON.parse(raw) : {});
  } catch {
    return DEFAULT_VIEWER_SETTINGS;
  }
}

export function saveViewerSettings(settings: ViewerSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode, quota); settings then last for the session only.
  }
}

export const NAV_HINTS: Record<ViewerSettings["movement"], string> = {
  orbit: "Drag to rotate · right-drag to pan · scroll to zoom",
  walk: "Click the view, then drag to look · WASD or arrows to move · Shift to sprint",
  fly: "Click the view, then drag to look · WASD or arrows to move · Space / C up and down · Shift to sprint",
};
