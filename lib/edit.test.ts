import test from "node:test";
import assert from "node:assert/strict";
import {
  addBeat,
  addCamera,
  addLine,
  beatDependents,
  cameraIssues,
  deleteBeat,
  deleteCamera,
  deleteLine,
  moveBeat,
  moveLine,
  nextId,
  updateBeat,
  updateCamera,
  updateLine,
} from "./edit";
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
