import test from "node:test";
import assert from "node:assert/strict";
import { ALL_OUTPUTS, DEFAULT_OUTPUTS } from "./outputs";
import { estimateMovie, movieContext, planShots } from "./movie";
import { DEFAULT_PREVIEW, DEFAULT_VIDEO } from "./catalog";
import type { Scene } from "./schema";

const v = { x: 0, y: 0, z: 0 };
const scene = {
  title: "T",
  logline: "L",
  durationSec: 30,
  timeline: [
    { id: "b1", startSec: 0, endSec: 20, title: "A", location: "kitchen", summary: "s", mood: "m" },
    { id: "b2", startSec: 20, endSec: 30, title: "B", location: "street", summary: "s", mood: "m" },
  ],
  transcript: [{ id: "l1", beatId: "b1", startSec: 1, endSec: 3, kind: "dialogue", speaker: "MARA", text: "Hello there." }],
  entities: [{ id: "e1", kind: "character", name: "Mara", importance: "lead", description: "a woman", proxy: "humanoid", color: "#fff", size: { x: 1, y: 2, z: 1 }, controls: [] }],
  keyframes: [{ id: "k1", t: 0, beatId: "b1", entityId: "e1", position: v, rotationY: 0, state: "idle", present: true, relation: "none", parentId: "", variations: [], note: "n" }],
  cameras: [
    { id: "c1", t: 0, beatId: "b1", label: "Wide", shot: "wide", movement: "static", position: v, lookAt: v, fov: 40, targetEntityId: "", note: "" },
    { id: "c2", t: 12, beatId: "b1", label: "Close", shot: "close_up", movement: "static", position: v, lookAt: v, fov: 40, targetEntityId: "e1", note: "" },
  ],
} as unknown as Scene;

test("without cameras each beat is split into clips no longer than the model allows", () => {
  const shots = planShots(scene, DEFAULT_OUTPUTS, 8);
  assert.equal(shots.length, 3 + 2); // 20s -> 3 clips, 10s -> 2 clips
  assert.ok(shots.every((s) => s.seconds <= 8));
  assert.equal(Math.round(shots.reduce((a, s) => a + s.seconds, 0)), 30); // covers the whole film
});
test("with cameras each setup becomes a shot", () => {
  const shots = planShots(scene, ALL_OUTPUTS, 20);
  assert.deepEqual(shots.map((s) => [s.beatId, Math.round(s.startSec), Math.round(s.seconds)]), [["b1", 0, 12], ["b1", 12, 8], ["b2", 20, 10]]);
});
test("more inputs means more for the director to read", () => {
  const small = JSON.stringify(movieContext(scene, { ...DEFAULT_OUTPUTS, transcript: false })).length;
  const big = JSON.stringify(movieContext(scene, ALL_OUTPUTS)).length;
  assert.ok(big > small);
  assert.ok(!("cast" in movieContext(scene, DEFAULT_OUTPUTS)));
});
test("the film estimate grows with inputs and needs a video price", () => {
  const video = { ...DEFAULT_VIDEO, perSecond: 0.4 };
  const lean = estimateMovie(scene, { ...DEFAULT_OUTPUTS, transcript: false }, DEFAULT_PREVIEW, video);
  const full = estimateMovie(scene, ALL_OUTPUTS, DEFAULT_PREVIEW, video);
  assert.ok(full.director.input > lean.director.input);
  assert.ok(Math.abs(lean.videoUsd! - 0.4 * lean.seconds) < 1e-9);
  assert.equal(estimateMovie(scene, ALL_OUTPUTS, DEFAULT_PREVIEW, DEFAULT_VIDEO).totalUsd, null);
});
