import test from "node:test";
import assert from "node:assert/strict";
import { ALL_OUTPUTS, DEFAULT_OUTPUTS, normalizeOutputs } from "./outputs";

test("beats and transcript are the default", () => {
  assert.deepEqual(DEFAULT_OUTPUTS, { beats: true, transcript: true, cast: false, cameras: false });
});
test("beats can't be turned off, and cameras bring the cast", () => {
  assert.deepEqual(normalizeOutputs({ beats: false, cameras: true }), { beats: true, transcript: true, cast: true, cameras: true });
  assert.deepEqual(normalizeOutputs(null), DEFAULT_OUTPUTS);
  assert.deepEqual(normalizeOutputs(ALL_OUTPUTS), ALL_OUTPUTS);
});
