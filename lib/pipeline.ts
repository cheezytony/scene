import type { z } from "zod";
import {
  CastStageSchema,
  MotionSchema,
  OutlineSchema,
  TranscriptSchema,
  normalizeScene,
  type Anchor,
  type Entity,
  type Scene,
} from "./schema";
import { checkCounts, checkRelations, describeLimits, type Limits } from "./limits";
import { placeKey, planChunks, type Chunk, type ChunkOptions } from "./chunks";
import { stagePrompt } from "./prompt";
import { ALL_OUTPUTS, normalizeOutputs, type Outputs } from "./outputs";

export type StageName = "outline" | "transcript" | "cast" | "motion";

/** Per-stage structured-output schema and model settings. Schemas must stay small (see schema.ts). */
export const STAGES = {
  outline: { schema: OutlineSchema, effort: "medium", maxTokens: 8000 },
  // Mostly extraction (copy the dialogue, time it), and it runs alongside motion, so keep it cheap.
  transcript: { schema: TranscriptSchema, effort: "low", maxTokens: 32000 },
  cast: { schema: CastStageSchema, effort: "medium", maxTokens: 16000 },
  motion: { schema: MotionSchema, effort: "high", maxTokens: 64000 },
} as const;

export interface StageMessage {
  role: "user" | "assistant";
  content: unknown;
}
export interface StageRequest {
  stage: StageName;
  system: string;
  messages: StageMessage[];
}
export interface Usage {
  input_tokens: number;
  output_tokens: number;
}
export interface StageResult {
  /** The model's JSON output for this stage. */
  text: string;
  /** What to send back as the assistant turn if this stage needs a repair pass. */
  assistantContent: unknown;
  usage: Usage;
}
/** Runs one model call. Injected so the pipeline has no dependency on the SDK. */
export type RunStage = (request: StageRequest) => Promise<StageResult>;

export interface StageStats extends Usage {
  /** Wall-clock time from the first call of this stage starting to the last one finishing. */
  ms: number;
  /** Model calls made, including repair passes and parallel chunks. */
  calls: number;
}

export interface AnalysisResult {
  scene: Scene;
  /** Limits that could not be satisfied even after a repair pass. */
  violations: string[];
  /** True if any stage needed a repair pass. */
  retried: boolean;
  usage: Usage;
  /** Where the time and tokens went. Additive: older clients simply ignore it. */
  stats: { totalMs: number; motionChunks: number; stages: Record<StageName, StageStats> };
}

/**
 * At most this many motion calls in flight at once, to stay inside API rate limits. It matches the
 * default chunk cap so a film's chunks run in one wave: with fewer slots than chunks they run in
 * waves and the wall time multiplies (6 chunks on 4 slots took twice as long as one chunk).
 */
export const DEFAULT_MAX_PARALLEL = 6;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type Motion = z.infer<typeof MotionSchema>;

/**
 * Joins the motion plans of consecutive chunks. Times are clamped into each chunk's range, and ids
 * are renumbered so chunks that each started at k1 / c1 can't collide. At a chunk boundary the later
 * chunk's keyframe sorts after the earlier one's, so it is the one in effect.
 */
function mergeMotion(parts: Motion[], chunks: Chunk[]): Motion {
  const clamp = (t: number, chunk: Chunk) => Math.min(Math.max(t, chunk.startSec), chunk.endSec);
  const keyframes = parts
    .flatMap((m, i) => m.keyframes.map((k) => ({ ...k, t: clamp(k.t, chunks[i]) })))
    .sort((a, b) => a.t - b.t)
    .map((k, i) => ({ ...k, id: `k${i + 1}` }));
  const cameras = parts
    .flatMap((m, i) => m.cameras.map((c) => ({ ...c, t: clamp(c.t, chunks[i]) })))
    .sort((a, b) => a.t - b.t)
    .map((c, i) => ({ ...c, id: `c${i + 1}` }));
  return { keyframes, cameras };
}

/**
 * The layout entries for the places a chunk covers. If the cast stage named places differently
 * from the outline's locations and nothing matches, fall back to the whole layout rather than none.
 */
function layoutNote(layout: Anchor[], beatLocations: string[]): string {
  if (!layout.length) return "";
  const wanted = new Set(beatLocations.map(placeKey));
  const relevant = layout.filter((a) => wanted.has(placeKey(a.place)));
  return `\n\n<layout>\n${JSON.stringify(relevant.length ? relevant : layout)}\n</layout>`;
}

function chunkNote(chunk: Chunk, index: number, total: number): string {
  if (total === 1) return "";
  return `\n\n<chunk>\nThis is part ${index + 1} of ${total}; the other parts are generated separately and joined to yours. Produce keyframes and cameras only for beats ${chunk.beatIds.join(", ")}, which cover film time ${chunk.startSec}s to ${chunk.endSec}s (use the film's own clock, not times relative to the part). At ${chunk.startSec}s give EVERY entity in the cast a keyframe: present=true with its position, or present=false if it is not in view there, so this part starts from a complete picture and joins cleanly to the previous one.\n</chunk>`;
}

const REPAIR_SUBJECT: Record<StageName, string> = {
  outline: "outline",
  transcript: "transcript",
  cast: "list of characters and objects",
  motion: "keyframes and cameras",
};

/**
 * Script -> scene in three stages, each with its own small schema:
 *   outline and cast run in parallel (both read only the script), then motion runs with both as
 *   context, in parallel chunks, while the transcript is written alongside it. Limits are enforced where they are decided: counts at the cast stage, attach/contain
 *   limits at the motion stage, each with one repair pass that regenerates only that stage.
 */
export async function analyzeScript(input: {
  script: string;
  limits: Limits;
  run: RunStage;
  /** Overrides for how motion planning is split into parallel chunks. */
  chunking?: Partial<ChunkOptions>;
  /** Most model calls in flight at once while planning motion. */
  maxParallel?: number;
  /** Which outputs to make (default: all). Skipped outputs are empty in the scene and cost nothing. */
  outputs?: Partial<Outputs>;
}): Promise<AnalysisResult> {
  const { script, limits, run, chunking } = input;
  const outputs = normalizeOutputs(input.outputs ?? ALL_OUTPUTS);
  const maxParallel = Math.max(1, Math.floor(input.maxParallel ?? DEFAULT_MAX_PARALLEL));
  const startedAt = Date.now();
  const usage: Usage = { input_tokens: 0, output_tokens: 0 };
  const spans: Record<StageName, { first: number; last: number } | null> = {
    outline: null,
    transcript: null,
    cast: null,
    motion: null,
  };
  const stages: Record<StageName, StageStats> = {
    outline: { ms: 0, calls: 0, input_tokens: 0, output_tokens: 0 },
    transcript: { ms: 0, calls: 0, input_tokens: 0, output_tokens: 0 },
    cast: { ms: 0, calls: 0, input_tokens: 0, output_tokens: 0 },
    motion: { ms: 0, calls: 0, input_tokens: 0, output_tokens: 0 },
  };
  let retried = false;

  const limitText = describeLimits(limits);
  const base = `<script>\n${script}\n</script>${limitText ? `\n\n${limitText}` : ""}`;

  async function call(stage: StageName, messages: StageMessage[]) {
    const began = Date.now();
    const result = await run({ stage, system: stagePrompt(stage), messages });
    const finished = Date.now();
    const span = spans[stage];
    spans[stage] = { first: Math.min(span?.first ?? began, began), last: Math.max(span?.last ?? finished, finished) };
    usage.input_tokens += result.usage.input_tokens;
    usage.output_tokens += result.usage.output_tokens;
    const s = stages[stage];
    s.calls += 1;
    s.input_tokens += result.usage.input_tokens;
    s.output_tokens += result.usage.output_tokens;
    return result;
  }

  async function runStage<S extends z.ZodType>(
    stage: StageName,
    schema: S,
    context: string,
    check: (data: z.infer<S>) => string[] = () => [],
  ): Promise<{ data: z.infer<S>; issues: string[] }> {
    const messages: StageMessage[] = [{ role: "user", content: base + context }];
    const first = await call(stage, messages);
    let data: z.infer<S> = schema.parse(JSON.parse(first.text));
    let issues = check(data);
    if (!issues.length) return { data, issues };

    // One repair pass for this stage only. Keep it only if it is no worse than the original.
    retried = true;
    try {
      const second = await call(stage, [
        ...messages,
        { role: "assistant", content: first.assistantContent },
        {
          role: "user",
          content: `Your ${REPAIR_SUBJECT[stage]} break these limits:\n${issues.map((i) => `- ${i}`).join("\n")}\n\nReturn the full corrected ${REPAIR_SUBJECT[stage]}, keeping everything else consistent.`,
        },
      ]);
      const repaired: z.infer<S> = schema.parse(JSON.parse(second.text));
      const repairedIssues = check(repaired);
      if (repairedIssues.length <= issues.length) {
        data = repaired;
        issues = repairedIssues;
      }
    } catch (error) {
      console.error(`Repair pass for ${stage} failed, keeping the first result`, error);
    }
    return { data, issues };
  }

  // The outline and the cast read only the script, so they start together. The transcript needs the
  // outline's beats but nothing else, and motion needs the outline and the cast, so once the outline
  // is done the (long) transcript runs alongside motion instead of in front of it.
  type Issues<T> = Promise<{ data: T; issues: string[] }>;
  const outlineP = runStage("outline", OutlineSchema, "");
  const outlineContext = (o: z.infer<typeof OutlineSchema>) => `\n\n<outline>\n${JSON.stringify(o)}\n</outline>`;

  const castP: Issues<z.infer<typeof CastStageSchema>> = outputs.cast
    ? runStage("cast", CastStageSchema, "", (d) => checkCounts(d.entities, limits))
    : Promise.resolve({ data: { entities: [], layout: [] }, issues: [] });

  const transcriptP: Issues<z.infer<typeof TranscriptSchema>> = outputs.transcript
    ? outlineP.then((o) => runStage("transcript", TranscriptSchema, outlineContext(o.data)))
    : Promise.resolve({ data: { transcript: [] }, issues: [] });

  // Motion is by far the longest stage and grows with the script, so it is planned per chunk (cut at
  // place changes) and the chunks run in parallel: wall time follows the longest chunk, not the film.
  const noCameras = outputs.cameras ? "" : "\n\n<outputs>\nDo not produce cameras: return an empty cameras array.\n</outputs>";
  const motionP = Promise.all([outlineP, castP]).then(async ([outline, cast]) => {
    const entities: Entity[] = cast.data.entities;
    if (!outputs.cast) return { outline, cast, entities, chunks: [] as Chunk[], parts: [] as { data: Motion; issues: string[] }[] };
    const context = `${outlineContext(outline.data)}\n\n<cast>\n${JSON.stringify(entities)}\n</cast>${noCameras}`;
    const chunks = planChunks(outline.data.timeline, outline.data.durationSec, chunking);
    const parts = await mapLimit(chunks, maxParallel, (chunk, i) => {
      const locations = outline.data.timeline.filter((b) => chunk.beatIds.includes(b.id)).map((b) => b.location);
      return runStage(
        "motion",
        MotionSchema,
        context + layoutNote(cast.data.layout, locations) + chunkNote(chunk, i, chunks.length),
        (d) => checkRelations(assemble(outline.data, [], entities, d), limits),
      );
    });
    return { outline, cast, entities, chunks, parts };
  });

  const [transcript, { outline, cast, entities, chunks, parts: motionParts }] = await Promise.all([transcriptP, motionP]);
  const motion = chunks.length
    ? mergeMotion(motionParts.map((p) => p.data), chunks)
    : { keyframes: [], cameras: [] };
  if (!outputs.cameras) motion.cameras = [];

  const scene = normalizeScene(assemble(outline.data, transcript.data.transcript, entities, motion));
  const violations = [...new Set([...cast.issues, ...motionParts.flatMap((p) => p.issues)])];
  for (const name of Object.keys(stages) as StageName[]) {
    const span = spans[name];
    stages[name].ms = span ? span.last - span.first : 0;
  }
  return {
    scene,
    violations,
    retried,
    usage,
    stats: { totalMs: Date.now() - startedAt, motionChunks: chunks.length, stages },
  };
}

function assemble(
  outline: z.infer<typeof OutlineSchema>,
  transcript: z.infer<typeof TranscriptSchema>["transcript"],
  entities: Entity[],
  motion: z.infer<typeof MotionSchema>,
): Scene {
  return { ...outline, transcript, entities, ...motion };
}
