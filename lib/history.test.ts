import test from "node:test";
import assert from "node:assert/strict";
import { COALESCE_MS, MAX_HISTORY, createHistory, historyReducer, type History } from "./history";

const edit = (h: History<number>, to: number, key?: string, now = 0) =>
  historyReducer(h, { type: "edit", next: () => to, key, now });

test("undo and redo walk through edits", () => {
  let h = createHistory(0);
  h = edit(h, 1);
  h = edit(h, 2);
  assert.equal(h.present, 2);
  h = historyReducer(h, { type: "undo" });
  assert.equal(h.present, 1);
  h = historyReducer(h, { type: "undo" });
  assert.equal(h.present, 0);
  assert.equal(historyReducer(h, { type: "undo" }), h, "nothing left to undo");
  h = historyReducer(h, { type: "redo" });
  assert.equal(h.present, 1);
});

test("a new edit clears the redo stack", () => {
  let h = edit(edit(createHistory(0), 1), 2);
  h = historyReducer(h, { type: "undo" });
  h = edit(h, 9);
  assert.deepEqual(h.future, []);
  assert.equal(historyReducer(h, { type: "redo" }), h);
});

test("edits with the same key in quick succession are one undo step", () => {
  let h = createHistory(0);
  h = edit(h, 1, "drag", 0);
  h = edit(h, 2, "drag", 100);
  h = edit(h, 3, "drag", 200);
  assert.equal(h.present, 3);
  assert.equal(historyReducer(h, { type: "undo" }).present, 0, "back to before the whole drag");
});

test("a different key, or a pause, starts a new step", () => {
  let h = edit(edit(createHistory(0), 1, "a", 0), 2, "b", 10);
  assert.equal(historyReducer(h, { type: "undo" }).present, 1);
  h = edit(edit(createHistory(0), 1, "a", 0), 2, "a", COALESCE_MS + 1);
  assert.equal(historyReducer(h, { type: "undo" }).present, 1);
});

test("an edit that changes nothing is not recorded, and reset wipes history", () => {
  const h = createHistory(5);
  assert.equal(historyReducer(h, { type: "edit", next: (s) => s, now: 0 }), h);
  const reset = historyReducer(edit(h, 6), { type: "reset", present: 42 });
  assert.deepEqual([reset.present, reset.past, reset.future], [42, [], []]);
});

test("history is bounded", () => {
  let h = createHistory(0);
  for (let i = 1; i <= MAX_HISTORY + 20; i++) h = edit(h, i);
  assert.equal(h.past.length, MAX_HISTORY);
});
