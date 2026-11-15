import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CHUNK_OPTIONS, placeKey, planChunks } from "./chunks";
import type { Beat } from "./schema";

const beat = (id: string, startSec: number, endSec: number, location: string): Beat => ({
  id, startSec, endSec, title: id, location, summary: "", mood: "",
});

test("place keys ignore INT./EXT. prefixes and time of day", () => {
  assert.equal(placeKey("INT. SUBWAY STATION - NIGHT"), "subway station");
  assert.equal(placeKey("Subway station"), "subway station");
  assert.equal(placeKey("EXT. ROOFTOP - DAY"), "rooftop");
  assert.equal(placeKey("INT./EXT. CAR - CONTINUOUS"), "car");
  assert.notEqual(placeKey("INT. SUBWAY CAR - CONTINUOUS"), placeKey("INT. SUBWAY STATION - NIGHT"));
});

test("no beats is a single chunk covering the film", () => {
  assert.deepEqual(planChunks([], 60), [{ beatIds: [], startSec: 0, endSec: 60 }]);
});

test("a short single-place film is one chunk", () => {
  const chunks = planChunks([beat("b1", 0, 10, "Room"), beat("b2", 10, 20, "Room")], 20);
  assert.deepEqual(chunks, [{ beatIds: ["b1", "b2"], startSec: 0, endSec: 20 }]);
});

test("cuts at place changes", () => {
  const chunks = planChunks(
    [beat("b1", 0, 10, "INT. KITCHEN - DAY"), beat("b2", 10, 20, "EXT. GARDEN - DAY"), beat("b3", 20, 30, "INT. KITCHEN - NIGHT")],
    30,
  );
  assert.deepEqual(chunks.map((c) => c.beatIds), [["b1"], ["b2"], ["b3"]]);
});

test("long stays are split evenly and never exceed maxBeats", () => {
  const beats = Array.from({ length: 7 }, (_, i) => beat(`b${i + 1}`, i * 10, (i + 1) * 10, "Room"));
  const chunks = planChunks(beats, 70, { maxBeats: 3 });
  assert.deepEqual(chunks.map((c) => c.beatIds.length), [3, 3, 1]);
  assert.ok(chunks.every((c) => c.beatIds.length <= 3));
});

test("chunks tile the film with no gaps or overlaps", () => {
  const beats = [beat("b1", 0, 12, "A"), beat("b2", 15, 30, "B"), beat("b3", 30, 41, "C")];
  const chunks = planChunks(beats, 45);
  assert.equal(chunks[0].startSec, 0);
  assert.equal(chunks.at(-1)!.endSec, 45);
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i].startSec, beats.find((b) => b.id === chunks[i].beatIds[0])!.startSec);
});

test("never more than maxChunks; merges the shortest neighbors first", () => {
  const beats = [
    beat("b1", 0, 30, "A"), beat("b2", 30, 33, "B"), beat("b3", 33, 36, "C"), beat("b4", 36, 70, "D"),
  ];
  const chunks = planChunks(beats, 70, { maxChunks: 3 });
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((c) => c.beatIds), [["b1"], ["b2", "b3"], ["b4"]]);
});

test("beats given out of order are planned in time order, and every beat is used once", () => {
  const chunks = planChunks([beat("b2", 10, 20, "B"), beat("b1", 0, 10, "A")], 20);
  assert.deepEqual(chunks.flatMap((c) => c.beatIds), ["b1", "b2"]);
});

test("nonsense options fall back to safe values", () => {
  const chunks = planChunks([beat("b1", 0, 10, "A"), beat("b2", 10, 20, "A")], 20, { maxBeats: 0, maxChunks: -3 });
  assert.equal(chunks.length, 1);
  assert.equal(DEFAULT_CHUNK_OPTIONS.maxBeats, 3);
});
