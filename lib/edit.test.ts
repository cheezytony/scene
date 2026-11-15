import test from "node:test";
import assert from "node:assert/strict";
import {
  addBeat,
  addCamera,
  addControl,
  addEntity,
  addKeyframe,
  addLine,
  beatDependents,
  cameraDirection,
  cameraIssues,
  deleteBeat,
  deleteCamera,
  deleteControl,
  deleteEntity,
  deleteKeyframe,
  deleteLine,
  entityDependents,
  moveBeat,
  moveCamera,
  moveLine,
  nextId,
  setCameraDirection,
  setVariation,
  updateBeat,
  updateCamera,
  updateControl,
  updateEntity,
  updateKeyframe,
  updateLine,
} from "./edit";
import { worldPose } from "./resolve";
import type { Scene } from "./schema";

const v3 = (x: number, y: number, z: number) => ({ x, y, z });
const beat = (id: string, startSec: number, endSec: number) => ({
  id, startSec, endSec, title: id, location: "", summary: "", mood: "",
});
const line = (id: string, beatId: string, startSec: number, endSec: number) => ({
  id, beatId, startSec, endSec, kind: "dialogue" as const, speaker: "", text: id,
});
const keyframe = (id: string, beatId: string, t: number) => ({
  id, t, beatId, entityId: "e1", position: v3(0, 0, 0), rotationY: 0, state: "idle", present: true,
  relation: "none" as const, parentId: "", variations: [], note: "",
});
const camera = (id: string, beatId: string, t: number) => ({
  id, t, beatId, label: id, shot: "wide" as const, movement: "static" as const,
  position: v3(0, 3, 9), lookAt: v3(0, 1, 0), fov: 50, targetEntityId: "", note: "",
});

const base = (): Scene => ({
  title: "T",
  logline: "",
  durationSec: 30,
  timeline: [beat("b1", 0, 10), beat("b2", 10, 30)],
  transcript: [line("l1", "b1", 1, 3), line("l2", "b1", 4, 6), line("l3", "b2", 12, 14)],
  entities: [
    { id: "e1", kind: "character", name: "Mara", importance: "lead", description: "", proxy: "humanoid", color: "#fff", size: v3(1, 1, 1), controls: [] },
  ],
  keyframes: [keyframe("k1", "b1", 0), keyframe("k2", "b2", 15)],
  cameras: [camera("c1", "b1", 0), camera("c2", "b2", 12)],
});

test("nextId never collides with existing ids", () => {
  assert.equal(nextId("b", ["b1", "b2"]), "b3");
  assert.equal(nextId("b", ["b2", "b3"]), "b4");
  assert.equal(nextId("l", []), "l1");
});

test("moving a beat later swaps the story order and carries its content", () => {
  const out = moveBeat(base(), "b1", 1);
  assert.deepEqual(out.timeline.map((b) => [b.id, b.startSec, b.endSec]), [["b2", 0, 20], ["b1", 20, 30]]);
  // b2's content moved 10 s earlier, b1's 20 s later; relative offsets inside a beat are preserved.
  assert.deepEqual(out.transcript.map((l) => [l.id, l.startSec]), [["l3", 2], ["l1", 21], ["l2", 24]]);
  assert.deepEqual(out.keyframes.map((k) => [k.id, k.t]), [["k2", 5], ["k1", 20]]);
  assert.deepEqual(out.cameras.map((c) => [c.id, c.t]), [["c2", 2], ["c1", 20]]);
  assert.equal(out.durationSec, 30);
});

test("moving a beat earlier is the inverse, and the edges are no-ops", () => {
  const original = base();
  const there = moveBeat(original, "b1", 1);
  assert.deepEqual(moveBeat(there, "b1", -1).timeline.map((b) => [b.id, b.startSec, b.endSec]), [["b1", 0, 10], ["b2", 10, 30]]);
  assert.equal(moveBeat(original, "b1", -1), original);
  assert.equal(moveBeat(original, "b2", 1), original);
  assert.equal(moveBeat(original, "nope", 1), original);
});

test("a gap between beats is kept when they swap", () => {
  const s = { ...base(), timeline: [beat("b1", 0, 10), beat("b2", 15, 30)] };
  const out = moveBeat(s, "b1", 1);
  assert.deepEqual(out.timeline.map((b) => [b.id, b.startSec, b.endSec]), [["b2", 0, 15], ["b1", 20, 30]]);
});

test("adding a beat in the middle ripples later beats and their content", () => {
  const out = addBeat(base(), "b1", { id: "bx", title: "Inserted" });
  assert.deepEqual(out.timeline.map((b) => [b.id, b.startSec, b.endSec]), [["b1", 0, 10], ["bx", 10, 20], ["b2", 20, 40]]);
  assert.equal(out.transcript.find((l) => l.id === "l3")?.startSec, 22);
  assert.equal(out.cameras.find((c) => c.id === "c2")?.t, 22);
  assert.equal(out.durationSec, 40);
});

test("adding a beat with no id picks a fresh one, and works on an empty timeline", () => {
  const out = addBeat(base(), null);
  assert.deepEqual(out.timeline.map((b) => b.id), ["b1", "b2", "b3"]);
  assert.equal(out.timeline[2].startSec, 30);
  assert.equal(out.durationSec, 40);
  const empty = addBeat({ ...base(), timeline: [], transcript: [], keyframes: [], cameras: [], durationSec: 0 }, null);
  assert.deepEqual(empty.timeline.map((b) => [b.startSec, b.endSec]), [[0, 10]]);
});

test("updating a beat keeps it valid and sorted", () => {
  const out = updateBeat(base(), "b1", { startSec: 20, endSec: 5, title: "Moved" });
  const b1 = out.timeline.find((b) => b.id === "b1")!;
  assert.equal(b1.title, "Moved");
  assert.ok(b1.endSec > b1.startSec, "end is pushed past start");
  assert.deepEqual(out.timeline.map((b) => b.id), ["b2", "b1"], "sorted by start");
  assert.equal(updateBeat(base(), "b1", { startSec: Number.NaN }).timeline[0].startSec, 0, "NaN is ignored");
});

test("deleting a beat removes what belongs to it, and reports what that is", () => {
  assert.deepEqual(beatDependents(base(), "b1"), { lines: 2, cameras: 1, keyframes: 1 });
  const out = deleteBeat(base(), "b1");
  assert.deepEqual(out.timeline.map((b) => b.id), ["b2"]);
  assert.deepEqual(out.transcript.map((l) => l.id), ["l3"]);
  assert.deepEqual(out.keyframes.map((k) => k.id), ["k2"]);
  assert.deepEqual(out.cameras.map((c) => c.id), ["c2"]);
  const s = base();
  assert.equal(deleteBeat(s, "nope"), s);
});

test("lines: add, update, move between beats, delete", () => {
  let s = addLine(base(), "b2", { id: "lx", speaker: "MARA", text: "Hi" }, 20);
  const added = s.transcript.find((l) => l.id === "lx")!;
  assert.deepEqual([added.beatId, added.startSec, added.endSec, added.kind], ["b2", 20, 23, "dialogue"]);

  s = updateLine(s, "lx", { text: "Hello", startSec: 25, endSec: 24 });
  const edited = s.transcript.find((l) => l.id === "lx")!;
  assert.equal(edited.text, "Hello");
  assert.ok(edited.endSec > edited.startSec);

  s = updateLine(s, "lx", { beatId: "b1" });
  const moved = s.transcript.find((l) => l.id === "lx")!;
  assert.equal(moved.beatId, "b1");
  assert.ok(moved.startSec >= 0 && moved.endSec <= 10 + 1e-9, "pulled inside the new beat");

  assert.equal(updateLine(s, "lx", { beatId: "nope" }).transcript.find((l) => l.id === "lx")?.beatId, "b1");
  assert.equal(deleteLine(s, "lx").transcript.some((l) => l.id === "lx"), false);
  const untouched = base();
  assert.equal(addLine(untouched, "nope"), untouched, "unknown beat: nothing added");
});

test("moving a line swaps it with its neighbour in the same beat only", () => {
  const out = moveLine(base(), "l1", 1);
  const inB1 = out.transcript.filter((l) => l.beatId === "b1").map((l) => [l.id, l.startSec, l.endSec]);
  assert.deepEqual(inB1, [["l2", 1, 3], ["l1", 4, 6]]);
  const s = base();
  assert.equal(moveLine(s, "l2", 1), s, "last line in its beat");
  assert.equal(moveLine(s, "l3", -1), s, "only line in its beat");
  assert.equal(out.transcript.find((l) => l.id === "l3")?.startSec, 12, "other beats untouched");
});

test("cameras: add from the camera in effect, update with clamping, delete", () => {
  let s = addCamera(base(), 20, { id: "cx" });
  const added = s.cameras.find((c) => c.id === "cx")!;
  assert.equal(added.beatId, "b2");
  assert.deepEqual(added.position, v3(1, 3, 9), "offset 1 m from the camera it started from");

  s = updateCamera(s, "cx", { position: v3(Number.NaN, 5, -2.5), fov: 400, t: 999, lookAt: v3(2, 1, 0) });
  const c = s.cameras.find((x) => x.id === "cx")!;
  assert.deepEqual(c.position, v3(1, 5, -2.5), "NaN keeps the previous value for that axis");
  assert.equal(c.fov, 120);
  assert.equal(c.t, 30, "time clamped to the scene duration");
  assert.deepEqual(c.lookAt, v3(2, 1, 0));

  s = updateCamera(s, "cx", { beatId: "nope", targetEntityId: "nope" });
  assert.equal(s.cameras.find((x) => x.id === "cx")?.beatId, "b2");
  assert.equal(s.cameras.find((x) => x.id === "cx")?.targetEntityId, "");
  s = updateCamera(s, "cx", { targetEntityId: "e1", t: 1 });
  assert.equal(s.cameras[1].id, "cx", "re-sorted by time");
  assert.equal(deleteCamera(s, "cx").cameras.some((x) => x.id === "cx"), false);
});

test("camera issues flag a degenerate or underground camera", () => {
  const c = camera("c", "b1", 0);
  assert.deepEqual(cameraIssues(c), []);
  assert.equal(cameraIssues({ ...c, lookAt: c.position }).length, 1);
  assert.equal(cameraIssues({ ...c, position: v3(0, -1, 0) }).length, 1);
});

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

test("camera direction: yaw 0 faces +z, 90 faces +x, pitch up is positive", () => {
  const at = (lookAt: { x: number; y: number; z: number }) => cameraDirection({ position: v3(0, 0, 0), lookAt });
  near(at(v3(0, 0, 5)).yaw, 0);
  near(at(v3(5, 0, 0)).yaw, 90);
  near(Math.abs(at(v3(0, 0, -5)).yaw), 180);
  near(at(v3(0, 5, 5)).pitch, 45);
  near(at(v3(3, 4, 0)).distance, 5);
  assert.deepEqual(cameraDirection({ position: v3(1, 1, 1), lookAt: v3(1, 1, 1) }), { yaw: 0, pitch: 0, distance: 0 });
});

test("setting a camera's direction keeps its position and distance", () => {
  const s = setCameraDirection(base(), "c1", { yaw: 90, pitch: 0 }); // c1: at (0,3,9)
  const c = s.cameras.find((x) => x.id === "c1")!;
  assert.deepEqual(c.position, v3(0, 3, 9));
  const dir = cameraDirection(c);
  near(dir.yaw, 90);
  near(dir.pitch, 0);
  near(dir.distance, cameraDirection(base().cameras[0]).distance);
  // pitch is kept off the poles so the view never flips
  near(cameraDirection(setCameraDirection(base(), "c1", { pitch: 400 }).cameras[0]).pitch, 89.9, 0.01);
});

test("moving a camera can keep its direction, or let the view swing round", () => {
  const keep = moveCamera(base(), "c1", v3(5, 3, 9), true).cameras.find((x) => x.id === "c1")!;
  assert.deepEqual(keep.position, v3(5, 3, 9));
  assert.deepEqual(keep.lookAt, v3(5, 1, 0), "look-at moved by the same amount");
  near(cameraDirection(keep).yaw, cameraDirection(base().cameras[0]).yaw);
  const swing = moveCamera(base(), "c1", v3(5, 3, 9), false).cameras.find((x) => x.id === "c1")!;
  assert.deepEqual(swing.lookAt, v3(0, 1, 0), "look-at stayed put");
  assert.ok(Math.abs(cameraDirection(swing).yaw - cameraDirection(base().cameras[0]).yaw) > 1);
});

test("entities: add gets a keyframe at the playhead and a fresh id", () => {
  const s = addEntity(base(), "object", 12, { name: "Briefcase" });
  const e = s.entities.find((x) => x.name === "Briefcase")!;
  assert.equal(e.kind, "object");
  assert.equal(e.proxy, "box");
  assert.ok(!base().entities.some((x) => x.id === e.id));
  const kf = s.keyframes.find((k) => k.entityId === e.id)!;
  assert.deepEqual([kf.t, kf.beatId, kf.present], [12, "b2", true]);
  assert.equal(addEntity(base(), "character", 0).entities.at(-1)?.proxy, "humanoid");
});

test("entities: updates are sanitised", () => {
  let s = updateEntity(base(), "e1", { name: "Mara K", color: "not a color", size: v3(Number.NaN, -5, 999), importance: "supporting" });
  const e = s.entities[0];
  assert.equal(e.name, "Mara K");
  assert.equal(e.color, base().entities[0].color, "bad colour is ignored");
  assert.deepEqual(e.size, v3(1, 0.01, 50), "NaN keeps the old value, the rest is clamped");
  s = updateEntity(s, "e1", { color: "#00ff88" });
  assert.equal(s.entities[0].color, "#00ff88");
  const untouched = base();
  assert.equal(updateEntity(untouched, "nope", { name: "x" }), untouched);
});

test("entities: deleting cleans up everything that pointed at it", () => {
  let s = addEntity(base(), "object", 0, { id: "e2" });
  s = updateKeyframe(s, s.keyframes.find((k) => k.entityId === "e2")!.id, { relation: "on", parentId: "e1" });
  s = updateCamera(s, "c1", { targetEntityId: "e1" });
  assert.deepEqual(entityDependents(s, "e1"), { keyframes: 2, cameras: 1, children: 1 });
  const out = deleteEntity(s, "e1");
  assert.equal(out.entities.some((e) => e.id === "e1"), false);
  assert.equal(out.keyframes.some((k) => k.entityId === "e1"), false);
  assert.equal(out.cameras.find((c) => c.id === "c1")?.targetEntityId, "");
  const child = out.keyframes.find((k) => k.entityId === "e2")!;
  assert.deepEqual([child.relation, child.parentId], ["none", ""], "detached, not deleted");
});

test("controls: unique keys, consistent definitions, and variations cleaned on delete", () => {
  let s = addControl(base(), "e1", { label: "Coat colour", type: "choice", options: ["red", "blue", "red", " "], defaultValue: "green" });
  s = addControl(s, "e1", { label: "Coat colour" });
  const keys = s.entities[0].controls.map((c) => c.key);
  assert.deepEqual(keys, ["coat_colour", "coat_colour_2"]);
  const choice = s.entities[0].controls[0];
  assert.deepEqual([choice.options, choice.defaultValue], [["red", "blue"], "red"], "duplicates dropped, default snapped to an option");

  s = updateControl(s, "e1", "coat_colour_2", { type: "slider", min: 5, max: 1, defaultValue: "99" });
  const slider = s.entities[0].controls[1];
  assert.deepEqual([slider.min, slider.max, slider.defaultValue], [5, 5, "5"], "max is never below min and the default is in range");

  s = setVariation(s, "e1", "coat_colour", "blue", 3);
  assert.deepEqual(s.keyframes.find((k) => k.id === "k1")?.variations, [{ key: "coat_colour", value: "blue" }]);
  s = deleteControl(s, "e1", "coat_colour");
  assert.deepEqual(s.keyframes.find((k) => k.id === "k1")?.variations, []);
  assert.deepEqual(s.entities[0].controls.map((c) => c.key), ["coat_colour_2"]);
});

test("keyframes: adding one keeps the entity where it is, and never duplicates a time", () => {
  let s = base();
  const before = worldPose(s, s.entities[0], 8)!;
  s = addKeyframe(s, "e1", 8, { id: "kx" });
  const added = s.keyframes.find((k) => k.id === "kx")!;
  assert.deepEqual(added.position, before.position);
  assert.deepEqual(worldPose(s, s.entities[0], 8)!.position, before.position, "no jump");
  assert.equal(addKeyframe(s, "e1", 8), s, "already a keyframe at that time");
  assert.deepEqual(s.keyframes.map((k) => k.t), [0, 8, 15], "kept sorted");
});

test("keyframes: a new keyframe on a child starts from where its parent carries it", () => {
  let s = addEntity(base(), "object", 0, { id: "e2" });
  const childKf = s.keyframes.find((k) => k.entityId === "e2")!.id;
  s = updateKeyframe(s, childKf, { relation: "attached", parentId: "e1", position: v3(1, 1, 0) });
  s = updateKeyframe(s, "k2", { position: v3(10, 0, 0) });
  const e2 = s.entities.find((e) => e.id === "e2")!;
  const at = worldPose(s, e2, 7.5)!.position;
  s = addKeyframe(s, "e2", 7.5, { id: "kc" });
  assert.deepEqual(s.keyframes.find((k) => k.id === "kc")!.position, at);
});

test("keyframes: updates are validated", () => {
  let s = updateKeyframe(base(), "k1", { position: v3(Number.NaN, 2, 3), t: 999, relation: "in", parentId: "nope" });
  const k = s.keyframes.find((x) => x.id === "k1")!;
  assert.deepEqual(k.position, v3(0, 2, 3));
  assert.equal(k.t, 30);
  assert.deepEqual([k.relation, k.parentId], ["none", ""], "unknown parent is dropped");
  s = updateKeyframe(base(), "k1", { relation: "in", parentId: "e1" });
  assert.equal(s.keyframes.find((x) => x.id === "k1")?.relation, "none", "an entity cannot be inside itself");
  assert.equal(deleteKeyframe(base(), "k1").keyframes.length, 1);
});
