import test from "node:test";
import assert from "node:assert/strict";
import { analyzeScript, type RunStage, type StageName, type StageRequest } from "./pipeline";
import { SceneSchema, CastSchema, MotionSchema, OutlineSchema } from "./schema";
import type { Limits } from "./limits";

const none: Limits = {
  maxCharacters: null,
  minObjects: null,
  maxObjects: null,
  maxAttachedPerObject: null,
  maxOccupantsPerObject: null,
  maxTotal: null,
};

const v3 = (x: number, y: number, z: number) => ({ x, y, z });
const entity = (id: string, kind: "character" | "object") => ({
  id,
  kind,
  name: id,
  importance: "minor",
  description: "",
  proxy: kind === "character" ? "humanoid" : "box",
  color: "#888888",
  size: v3(1, 1, 1),
  controls: [],
});
const keyframe = (id: string, entityId: string, extra: Record<string, unknown> = {}) => ({
  id,
  t: 0,
  beatId: "b1",
  entityId,
  position: v3(0, 0, 0),
  rotationY: 0,
  state: "idle",
  present: true,
  relation: "none",
  parentId: "",
  variations: [],
  note: "",
  ...extra,
});
const outline = {
  title: "T",
  logline: "",
  durationSec: 30,
  timeline: [{ id: "b1", startSec: 0, endSec: 30, title: "B", location: "L", summary: "", mood: "" }],
  transcript: [],
};
const motion = (keyframes: unknown[]) => ({ keyframes, cameras: [] });

/** Fake model: returns the queued JSON for each stage, in order, and records every request. */
function fakeRun(queue: Record<StageName, (unknown | Error)[]>) {
  const requests: StageRequest[] = [];
  const run: RunStage = async (request) => {
    requests.push(request);
    const next = queue[request.stage].shift();
    if (next === undefined) throw new Error(`no queued output for ${request.stage}`);
    if (next instanceof Error) throw next;
    return {
      text: JSON.stringify(next),
      assistantContent: [{ type: "text", text: JSON.stringify(next) }],
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  };
  return { run, requests };
}

test("stage schemas together cover exactly the scene schema", () => {
  const stageKeys = [...Object.keys(OutlineSchema.shape), ...Object.keys(CastSchema.shape), ...Object.keys(MotionSchema.shape)];
  assert.deepEqual(stageKeys, Object.keys(SceneSchema.shape));
});

test("assembles the scene from three stages, with motion seeing outline and cast", async () => {
  const { run, requests } = fakeRun({
    outline: [outline],
    cast: [{ entities: [entity("e_mara", "character")] }],
    motion: [motion([keyframe("k1", "e_mara")])],
  });
  const result = await analyzeScript({ script: "INT. ROOM - DAY", limits: none, run });

  assert.equal(result.scene.title, "T");
  assert.equal(result.scene.entities.length, 1);
  assert.equal(result.scene.keyframes.length, 1);
  assert.deepEqual(result.violations, []);
  assert.equal(result.retried, false);
  assert.deepEqual(result.usage, { input_tokens: 30, output_tokens: 60 });

  assert.equal(requests.at(-1)?.stage, "motion", "motion runs after outline and cast");
  const motionPrompt = String(requests.at(-1)?.messages[0].content);
  assert.match(motionPrompt, /<outline>[\s\S]*"title":"T"/);
  assert.match(motionPrompt, /<cast>[\s\S]*e_mara/);
});

test("a cast over the limits is repaired before motion is generated", async () => {
  const two = { entities: [entity("e_mara", "character"), entity("e_okafor", "character")] };
  const one = { entities: [entity("e_mara", "character")] };
  const { run, requests } = fakeRun({
    outline: [outline],
    cast: [two, one],
    motion: [motion([keyframe("k1", "e_mara")])],
  });
  const result = await analyzeScript({ script: "INT. ROOM - DAY", limits: { ...none, maxCharacters: 1 }, run });

  assert.equal(result.retried, true);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.scene.entities.map((e) => e.id), ["e_mara"]);
  // Only the cast stage was repaired, and motion was built from the repaired cast.
  assert.equal(requests.filter((r) => r.stage === "cast").length, 2);
  assert.equal(requests.filter((r) => r.stage === "motion").length, 1);
  assert.doesNotMatch(String(requests.at(-1)?.messages[0].content), /e_okafor/);
  const repair = requests.filter((r) => r.stage === "cast")[1];
  assert.equal(repair.messages.length, 3, "repair is user, assistant, user");
  assert.match(String(repair.messages[2].content), /2 characters; max is 1/);
});

test("a failed repair keeps the first result and reports the violation", async () => {
  const two = { entities: [entity("e_mara", "character"), entity("e_okafor", "character")] };
  const { run } = fakeRun({
    outline: [outline],
    cast: [two, new Error("boom")],
    motion: [motion([keyframe("k1", "e_mara")])],
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await analyzeScript({ script: "INT. ROOM - DAY", limits: { ...none, maxCharacters: 1 }, run });
    assert.equal(result.scene.entities.length, 2);
    assert.equal(result.violations.length, 1);
  } finally {
    console.error = originalError;
  }
});

test("attach/contain limits are repaired in the motion stage only", async () => {
  const cast = { entities: [entity("e_car", "object"), entity("e_bag", "object")] };
  const attached = motion([
    keyframe("k1", "e_car"),
    keyframe("k2", "e_bag", { relation: "in", parentId: "e_car" }),
  ]);
  const fixed = motion([keyframe("k1", "e_car"), keyframe("k2", "e_bag")]);
  const { run, requests } = fakeRun({ outline: [outline], cast: [cast], motion: [attached, fixed] });
  const result = await analyzeScript({
    script: "INT. ROOM - DAY",
    limits: { ...none, maxAttachedPerObject: 0 },
    run,
  });

  assert.equal(result.retried, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.scene.keyframes.find((k) => k.id === "k2")?.relation, "none");
  assert.equal(requests.filter((r) => r.stage === "outline").length, 1);
  assert.equal(requests.filter((r) => r.stage === "cast").length, 1);
});

test("invalid model output fails loudly instead of returning a partial scene", async () => {
  const { run } = fakeRun({ outline: [{ title: "only a title" }], cast: [{ entities: [] }], motion: [motion([])] });
  await assert.rejects(analyzeScript({ script: "INT. ROOM - DAY", limits: none, run }));
});
