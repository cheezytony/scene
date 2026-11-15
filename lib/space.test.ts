import test from "node:test";
import assert from "node:assert/strict";
import { clampPoint, computeBounds, moveSpeed, FLOOR_CLEARANCE } from "./space";
import { DEFAULT_VIEWER_SETTINGS, ViewerSettingsSchema, loadViewerSettings } from "./viewer-settings";
import type { Scene } from "./schema";

const v = (x: number, y: number, z: number) => ({ x, y, z });
const scene = (over: Partial<Scene> = {}): Scene =>
  ({
    title: "",
    logline: "",
    durationSec: 10,
    timeline: [],
    transcript: [],
    cameras: [],
    entities: [{ id: "e", size: v(1, 2, 1) }],
    keyframes: [{ id: "k", t: 0, entityId: "e", position: v(0, 0, 0) }],
    ...over,
  }) as unknown as Scene;

test("tiny scenes still get a minimum amount of room", () => {
  const b = computeBounds(scene(), "auto");
  assert.ok(b.max.x - b.min.x >= 12 + 2 * 4 - 1e-9);
  assert.ok(b.max.z - b.min.z >= 12 + 2 * 4 - 1e-9);
  assert.equal(b.min.y, 0);
  assert.ok(b.max.y >= 6);
});

test("an empty scene does not produce NaN bounds", () => {
  const b = computeBounds(scene({ entities: [], keyframes: [] }), "auto");
  for (const n of [b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z]) assert.ok(Number.isFinite(n));
});

test("bounds grow to include far entities and every camera setup", () => {
  const far = scene({
    keyframes: [{ id: "k", t: 0, entityId: "e", position: v(40, 0, 0) }] as never,
    cameras: [{ id: "c", position: v(-30, 5, 25), lookAt: v(0, 1, 0) }] as never,
  });
  const b = computeBounds(far, "tight");
  assert.ok(b.max.x >= 40 && b.min.x <= -30 && b.max.z >= 25);
});

test("space setting orders the amount of room: tight < auto < wide", () => {
  const w = (s: "tight" | "auto" | "wide") => {
    const b = computeBounds(scene(), s);
    return b.max.x - b.min.x;
  };
  assert.ok(w("tight") < w("auto") && w("auto") < w("wide"));
});

test("clampPoint keeps points inside the bounds and above the floor", () => {
  const b = computeBounds(scene(), "auto");
  const p = clampPoint(v(1e6, -50, -1e6), b);
  assert.equal(p.x, b.max.x);
  assert.equal(p.z, b.min.z);
  assert.equal(p.y, FLOOR_CLEARANCE);
  assert.deepEqual(clampPoint(v(1, 1, 1), b), v(1, 1, 1));
});

test("speed setting orders speeds and scales with space", () => {
  const b = computeBounds(scene(), "auto");
  assert.ok(moveSpeed(b, "slow") < moveSpeed(b, "normal") && moveSpeed(b, "normal") < moveSpeed(b, "fast"));
  assert.ok(moveSpeed(computeBounds(scene(), "wide"), "normal") >= moveSpeed(computeBounds(scene(), "tight"), "normal"));
});

test("viewer settings: defaults are safe and boundaries are on", () => {
  assert.deepEqual(DEFAULT_VIEWER_SETTINGS, {
    movement: "orbit",
    speed: "normal",
    space: "auto",
    boundaries: true,
    grid: true,
  });
});

test("viewer settings: bad or missing values fall back per field, extras are ignored", () => {
  const s = ViewerSettingsSchema.parse({ movement: "teleport", speed: "fast", boundaries: false, future: 1 });
  assert.equal(s.movement, "orbit");
  assert.equal(s.speed, "fast");
  assert.equal(s.boundaries, false);
  assert.equal(s.space, "auto");
  assert.equal("future" in s, false);
});

test("viewer settings: loading without a browser returns defaults", () => {
  assert.deepEqual(loadViewerSettings(), DEFAULT_VIEWER_SETTINGS);
});
