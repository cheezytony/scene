import test from "node:test";
import assert from "node:assert/strict";
import { analyzeScript, type RunStage, type StageName, type StageRequest } from "./pipeline";
import { SceneSchema, CastSchema, MotionSchema, OutlineSchema, TranscriptSchema } from "./schema";
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

type Queued = unknown | Error;
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !(v instanceof Error);

/**
 * Fake model: returns the queued JSON for each stage, in order, and records every request. Tests may
 * give `outline` with a `transcript` inside, as before; it is split into the outline and transcript stages.
 */
function fakeRun(queue: { outline: Queued[]; cast: Queued[]; motion: Queued[]; transcript?: Queued[] }) {
  const queues: Record<StageName, Queued[]> = {
    outline: queue.outline.map((o) => {
      if (!isPlainObject(o)) return o;
      const rest = { ...o };
      delete rest.transcript;
      return rest;
    }),
    transcript:
      queue.transcript ?? queue.outline.map((o) => ({ transcript: isPlainObject(o) && Array.isArray(o.transcript) ? o.transcript : [] })),
    cast: queue.cast,
    motion: queue.motion,
  };
  const requests: StageRequest[] = [];
  const run: RunStage = async (request) => {
    requests.push(request);
    const next = queues[request.stage].shift();
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

const lastMotionPrompt = (requests: StageRequest[]) =>
  String(requests.filter((r) => r.stage === "motion").at(-1)?.messages[0].content);

test("stage schemas together cover exactly the scene schema", () => {
  const stageKeys = [
    ...Object.keys(OutlineSchema.shape),
    ...Object.keys(TranscriptSchema.shape),
    ...Object.keys(CastSchema.shape),
    ...Object.keys(MotionSchema.shape),
  ];
  assert.deepEqual(stageKeys, Object.keys(SceneSchema.shape));
});

test("assembles the scene from its stages, with motion seeing outline and cast", async () => {
  const { run, requests } = fakeRun({
    outline: [outline],
    cast: [{ entities: [entity("e_mara", "character")], layout: [] }],
    motion: [motion([keyframe("k1", "e_mara")])],
  });
  const result = await analyzeScript({ script: "INT. ROOM - DAY", limits: none, run });

  assert.equal(result.scene.title, "T");
  assert.equal(result.scene.entities.length, 1);
  assert.equal(result.scene.keyframes.length, 1);
  assert.deepEqual(result.violations, []);
  assert.equal(result.retried, false);
  assert.deepEqual(result.usage, { input_tokens: 40, output_tokens: 80 });

  assert.ok(requests.some((r) => r.stage === "motion"));
  assert.ok(requests.findIndex((r) => r.stage === "motion") > requests.findIndex((r) => r.stage === "outline"), "motion runs after the outline");
  const motionPrompt = lastMotionPrompt(requests);
  assert.match(motionPrompt, /<outline>[\s\S]*"title":"T"/);
  assert.match(motionPrompt, /<cast>[\s\S]*e_mara/);
});

test("a cast over the limits is repaired before motion is generated", async () => {
  const two = { entities: [entity("e_mara", "character"), entity("e_okafor", "character")], layout: [] };
  const one = { entities: [entity("e_mara", "character")], layout: [] };
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
  assert.doesNotMatch(lastMotionPrompt(requests), /e_okafor/);
  const repair = requests.filter((r) => r.stage === "cast")[1];
  assert.equal(repair.messages.length, 3, "repair is user, assistant, user");
  assert.match(String(repair.messages[2].content), /2 characters; max is 1/);
});

test("a failed repair keeps the first result and reports the violation", async () => {
  const two = { entities: [entity("e_mara", "character"), entity("e_okafor", "character")], layout: [] };
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
  const cast = { entities: [entity("e_car", "object"), entity("e_bag", "object")], layout: [] };
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
  const { run } = fakeRun({ outline: [{ title: "only a title" }], cast: [{ entities: [], layout: [] }], motion: [motion([])] });
  await assert.rejects(analyzeScript({ script: "INT. ROOM - DAY", limits: none, run }));
});

const twoPlaces = {
  ...outline,
  durationSec: 40,
  timeline: [
    { id: "b1", startSec: 0, endSec: 20, title: "A", location: "INT. STATION - NIGHT", summary: "", mood: "" },
    { id: "b2", startSec: 20, endSec: 40, title: "B", location: "INT. TRAIN CAR - NIGHT", summary: "", mood: "" },
  ],
};

test("a film with two places plans motion as two parallel chunks and joins them", async () => {
  const { run, requests } = fakeRun({
    outline: [twoPlaces],
    cast: [{ entities: [entity("e_mara", "character"), entity("e_bench", "object")], layout: [] }],
    motion: [
      // chunk 1 (0-20s): both entities in view; one keyframe is misplaced past the chunk end
      motion([keyframe("k1", "e_mara", { beatId: "b1", t: 0 }), keyframe("k2", "e_bench", { beatId: "b1", t: 0 }), keyframe("k3", "e_mara", { beatId: "b1", t: 999 })]),
      // chunk 2 (20-40s): the bench stays behind in the station
      motion([keyframe("k1", "e_mara", { beatId: "b2", t: 20 }), keyframe("k2", "e_bench", { beatId: "b2", t: 20, present: false })]),
    ],
  });
  const result = await analyzeScript({ script: "INT. STATION - NIGHT", limits: none, run });

  const motionRequests = requests.filter((r) => r.stage === "motion");
  assert.equal(motionRequests.length, 2);
  assert.match(String(motionRequests[0].messages[0].content), /part 1 of 2[\s\S]*beats b1[\s\S]*0s to 20s/);
  assert.match(String(motionRequests[1].messages[0].content), /part 2 of 2[\s\S]*beats b2[\s\S]*20s to 40s/);
  assert.match(String(motionRequests[1].messages[0].content), /<outline>/, "each chunk still sees the whole outline");

  const ids = result.scene.keyframes.map((k) => k.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique after joining");
  assert.equal(result.scene.keyframes.length, 5);
  assert.ok(result.scene.keyframes.every((k, i, all) => i === 0 || all[i - 1].t <= k.t), "sorted by time");
  assert.equal(Math.max(...result.scene.keyframes.map((k) => k.t)), 20, "a misplaced time is clamped to the end of its own chunk, not left at 999");
  assert.equal(result.scene.keyframes.filter((k) => k.t === 20).length, 3, "the clamped keyframe plus both entities at the next chunk's start");
  assert.equal(result.scene.keyframes.find((k) => k.entityId === "e_bench" && k.t === 20)?.present, false);

  assert.equal(result.stats.motionChunks, 2);
  assert.equal(result.stats.stages.motion.calls, 2);
  assert.equal(result.stats.stages.outline.calls, 1);
  assert.deepEqual(result.usage, { input_tokens: 50, output_tokens: 100 });
});

test("chunk size can be overridden", async () => {
  const { run, requests } = fakeRun({
    outline: [{ ...twoPlaces, timeline: twoPlaces.timeline.map((b) => ({ ...b, location: "Same place" })) }],
    cast: [{ entities: [entity("e_mara", "character")], layout: [] }],
    motion: [motion([keyframe("k1", "e_mara")]), motion([keyframe("k1", "e_mara", { t: 20 })])],
  });
  await analyzeScript({ script: "x", limits: none, run, chunking: { maxBeats: 1 } });
  assert.equal(requests.filter((r) => r.stage === "motion").length, 2);
});

test("a failing chunk fails the whole analysis instead of returning a scene with a hole", async () => {
  const { run } = fakeRun({
    outline: [twoPlaces],
    cast: [{ entities: [entity("e_mara", "character")], layout: [] }],
    motion: [motion([keyframe("k1", "e_mara")]), new Error("boom")],
  });
  await assert.rejects(analyzeScript({ script: "x", limits: none, run }), /boom/);
});

test("per-stage stats cover every stage and time is measured", async () => {
  const { run } = fakeRun({
    outline: [outline],
    cast: [{ entities: [entity("e_mara", "character")], layout: [] }],
    motion: [motion([keyframe("k1", "e_mara")])],
  });
  const { stats } = await analyzeScript({ script: "x", limits: none, run });
  assert.deepEqual(Object.keys(stats.stages), ["outline", "transcript", "cast", "motion"]);
  assert.equal(stats.motionChunks, 1);
  assert.ok(stats.totalMs >= 0);
});

test("the cast layout is passed to motion chunks, limited to the places each chunk covers", async () => {
  const anchor = (entityId: string, place: string, x: number) => ({ entityId, place, position: v3(x, 0, 0), rotationY: 0 });
  const { run, requests } = fakeRun({
    outline: [twoPlaces],
    cast: [
      {
        entities: [entity("e_bench", "object"), entity("e_seat", "object")],
        layout: [anchor("e_bench", "station", 3), anchor("e_seat", "train car", 7)],
      },
    ],
    motion: [motion([keyframe("k1", "e_bench")]), motion([keyframe("k1", "e_seat", { t: 20 })])],
  });
  await analyzeScript({ script: "x", limits: none, run });

  const [first, second] = requests.filter((r) => r.stage === "motion").map((r) => String(r.messages[0].content));
  assert.match(first, /<layout>[\s\S]*e_bench[\s\S]*<\/layout>/);
  assert.doesNotMatch(first, /e_seat","place/, "the station chunk does not get the train car's furniture");
  assert.match(second, /<layout>[\s\S]*e_seat[\s\S]*<\/layout>/);
  assert.doesNotMatch(second, /e_bench","place/);
});

test("if place names do not match, every chunk gets the whole layout rather than none", async () => {
  const { run, requests } = fakeRun({
    outline: [twoPlaces],
    cast: [{ entities: [entity("e_bench", "object")], layout: [{ entityId: "e_bench", place: "somewhere else", position: v3(1, 0, 1), rotationY: 0 }] }],
    motion: [motion([keyframe("k1", "e_bench")]), motion([keyframe("k1", "e_bench", { t: 20 })])],
  });
  await analyzeScript({ script: "x", limits: none, run });
  for (const r of requests.filter((r) => r.stage === "motion")) assert.match(String(r.messages[0].content), /somewhere else/);
});

test("an empty layout adds no layout section", async () => {
  const { run, requests } = fakeRun({
    outline: [outline],
    cast: [{ entities: [entity("e_mara", "character")], layout: [] }],
    motion: [motion([keyframe("k1", "e_mara")])],
  });
  await analyzeScript({ script: "x", limits: none, run });
  assert.doesNotMatch(lastMotionPrompt(requests), /<layout>/);
});

test("the layout is a pipeline input only: the scene has no layout field", async () => {
  const { run } = fakeRun({
    outline: [outline],
    cast: [{ entities: [entity("e_mara", "character")], layout: [{ entityId: "e_mara", place: "L", position: v3(0, 0, 0), rotationY: 0 }] }],
    motion: [motion([keyframe("k1", "e_mara")])],
  });
  const { scene } = await analyzeScript({ script: "x", limits: none, run });
  assert.equal("layout" in scene, false);
});

/** A fake model whose calls take a little time, recording how many motion calls overlap. */
function timedRun(handlers: Partial<Record<StageName, () => unknown>>, delayMs = 20) {
  let active = 0;
  let peak = 0;
  const run: RunStage = async ({ stage }) => {
    if (stage === "motion") {
      active += 1;
      peak = Math.max(peak, active);
    }
    await new Promise((r) => setTimeout(r, delayMs));
    if (stage === "motion") active -= 1;
    const make = handlers[stage];
    if (!make) throw new Error(`no handler for ${stage}`);
    const out = make();
    return { text: JSON.stringify(out), assistantContent: [], usage: { input_tokens: 1, output_tokens: 1 } };
  };
  return { run, peakMotion: () => peak };
}

const places = (n: number) => ({
  ...outline,
  durationSec: n * 10,
  timeline: Array.from({ length: n }, (_, i) => ({
    id: `b${i + 1}`, startSec: i * 10, endSec: (i + 1) * 10, title: `B${i + 1}`, location: `INT. PLACE ${i + 1} - DAY`, summary: "", mood: "",
  })),
});
const outlineOnly: Record<string, unknown> = { ...outline };
delete outlineOnly.transcript;
const handlersFor = (film: ReturnType<typeof places>) => {
  const o: Record<string, unknown> = { ...film };
  delete o.transcript;
  return {
    outline: () => o,
    transcript: () => ({ transcript: [] }),
    cast: () => ({ entities: [entity("e_mara", "character")], layout: [] }),
    motion: () => motion([keyframe("k1", "e_mara")]),
  };
};

test("the transcript is written alongside motion and never holds it up", { timeout: 5000 }, async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let motionStarted = false;
  const run: RunStage = async ({ stage }) => {
    let out: unknown;
    if (stage === "transcript") {
      await gate; // does not finish until motion has already started
      out = { transcript: [] };
    } else if (stage === "motion") {
      motionStarted = true;
      release();
      out = motion([keyframe("k1", "e_mara")]);
    } else if (stage === "outline") out = outlineOnly;
    else out = { entities: [entity("e_mara", "character")], layout: [] };
    return { text: JSON.stringify(out), assistantContent: [], usage: { input_tokens: 1, output_tokens: 1 } };
  };
  const result = await analyzeScript({ script: "x", limits: none, run });
  assert.equal(motionStarted, true);
  assert.deepEqual(result.scene.transcript, []);
});

test("the transcript stage sees the outline's beats but not the cast", async () => {
  const { run, requests } = fakeRun({
    outline: [outline],
    cast: [{ entities: [entity("e_mara", "character")], layout: [] }],
    motion: [motion([keyframe("k1", "e_mara")])],
  });
  await analyzeScript({ script: "x", limits: none, run });
  const prompt = String(requests.find((r) => r.stage === "transcript")?.messages[0].content);
  assert.match(prompt, /<outline>[\s\S]*"timeline"/);
  assert.doesNotMatch(prompt, /<cast>/);
});

test("a film's chunks all run in one wave by default", async () => {
  const film = places(6);
  const { run, peakMotion } = timedRun(handlersFor(film));
  const result = await analyzeScript({ script: "x", limits: none, run });
  assert.equal(result.stats.motionChunks, 6);
  assert.equal(peakMotion(), 6);
});

test("maxParallel caps how many motion calls overlap", async () => {
  const film = places(6);
  const { run, peakMotion } = timedRun(handlersFor(film));
  const result = await analyzeScript({ script: "x", limits: none, run, maxParallel: 2 });
  assert.equal(result.stats.motionChunks, 6);
  assert.equal(peakMotion(), 2);
});

test("a failed transcript fails the analysis and leaves no unhandled rejection", async () => {
  const film = places(1);
  const handlers = handlersFor(film);
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  try {
    const { run } = timedRun({ ...handlers, transcript: () => { throw new Error("transcript boom"); } });
    await assert.rejects(analyzeScript({ script: "x", limits: none, run }), /transcript boom/);
    await new Promise((r) => setTimeout(r, 100)); // let any stray rejection surface
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("outputs: leaving out cast and transcript skips those stages entirely", async () => {
  const { run, requests } = fakeRun({ outline: [outline], cast: [], motion: [] });
  const result = await analyzeScript({
    script: "INT. ROOM - DAY",
    limits: none,
    run,
    outputs: { transcript: false, cast: false, cameras: false },
  });
  assert.deepEqual(requests.map((r) => r.stage), ["outline"]);
  assert.equal(result.scene.timeline.length, 1);
  assert.deepEqual([result.scene.transcript, result.scene.entities, result.scene.keyframes, result.scene.cameras], [[], [], [], []]);
  assert.equal(result.stats.motionChunks, 0);
});

test("outputs: cast without cameras tells motion not to make cameras, and drops any that come back", async () => {
  const { run, requests } = fakeRun({
    outline: [outline],
    cast: [{ entities: [entity("e_mara", "character")], layout: [] }],
    motion: [{ keyframes: [keyframe("k1", "e_mara")], cameras: [{ id: "c1", t: 0, beatId: "b1", label: "x", shot: "wide", movement: "static", position: v3(0, 1, 5), lookAt: v3(0, 1, 0), fov: 40, targetEntityId: "", note: "" }] }],
  });
  const result = await analyzeScript({ script: "INT. ROOM - DAY", limits: none, run, outputs: { transcript: false, cast: true, cameras: false } });
  assert.match(lastMotionPrompt(requests), /Do not produce cameras/);
  assert.equal(result.scene.cameras.length, 0);
  assert.equal(result.scene.keyframes.length, 1);
  assert.ok(!requests.some((r) => r.stage === "transcript"));
});

test("outputs: cameras imply the cast they are aimed at", async () => {
  const { run, requests } = fakeRun({
    outline: [outline],
    cast: [{ entities: [entity("e_mara", "character")], layout: [] }],
    motion: [motion([keyframe("k1", "e_mara")])],
  });
  await analyzeScript({ script: "INT. ROOM - DAY", limits: none, run, outputs: { cameras: true } });
  assert.ok(requests.some((r) => r.stage === "cast"));
});
