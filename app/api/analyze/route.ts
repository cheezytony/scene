import { z } from "zod";
import { DEFAULT_PREVIEW, ModelChoiceSchema } from "@/lib/catalog";
import { DEFAULT_LIMITS, LimitsSchema, limitConflicts } from "@/lib/limits";
import { ALL_OUTPUTS, OutputsSchema, normalizeOutputs } from "@/lib/outputs";
import { STAGES, analyzeScript, type RunStage } from "@/lib/pipeline";
import { guard } from "@/lib/guard";
import { errorResponse, makeCaller } from "@/lib/llm";

export const maxDuration = 300;

const MAX_SCRIPT_CHARS = 200_000;

// Opt-in speed/cost knobs, read per request so a restart is the only thing needed to change them.
// SCENE_FAST_MODE=1: Opus fast mode, up to 2.5x faster output at twice the token price.
// SCENE_CHUNK_BEATS=n: most beats planned in one parallel call (default 3); lower is faster but
// gives the model less continuity across the cuts.
// SCENE_MAX_PARALLEL=n: most motion calls at once (default 6, the chunk cap). Lower it if you hit rate limits.
// SCENE_MOTION_EFFORT=low|medium|high: thinking depth for the motion stage (default high). Lower is faster and cheaper.
const positiveInt = (v: string | undefined) => (v && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
const EFFORTS = ["low", "medium", "high"] as const;
const motionEffort = EFFORTS.find((e) => e === process.env.SCENE_MOTION_EFFORT);

// `outputs` and `model` are optional: a caller that sends neither gets everything, on the default model.
const BodySchema = z.object({
  script: z.string(),
  limits: LimitsSchema.optional(),
  outputs: OutputsSchema.partial().optional(),
  model: ModelChoiceSchema.optional(),
});

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Body must be JSON: { script: string, limits?, outputs?, model? }" }, { status: 400 });
  }
  const { script } = parsed.data;
  const limits = parsed.data.limits ?? DEFAULT_LIMITS;
  const outputs = normalizeOutputs(parsed.data.outputs ? { ...ALL_OUTPUTS, ...parsed.data.outputs } : ALL_OUTPUTS);
  const conflicts = limitConflicts(limits);
  if (conflicts.length) return Response.json({ error: conflicts.join(" ") }, { status: 400 });
  if (script.trim().length < 20) {
    return Response.json({ error: "Provide a script of at least a few lines." }, { status: 400 });
  }
  if (script.length > MAX_SCRIPT_CHARS) {
    return Response.json(
      { error: `Script is too long (${script.length} chars, max ${MAX_SCRIPT_CHARS}). Split it by act.` },
      { status: 413 },
    );
  }

  const call = makeCaller(parsed.data.model ?? DEFAULT_PREVIEW);
  /** One model call for one pipeline stage, constrained to that stage's schema. */
  const run: RunStage = ({ stage, system, messages }) => {
    const { schema, effort: defaultEffort, maxTokens } = STAGES[stage];
    const effort = stage === "motion" && motionEffort ? motionEffort : defaultEffort;
    return call({ system, messages, schema, effort, maxTokens });
  };

  try {
    // Same response shape as before the pipeline was split into stages.
    const chunking = { maxBeats: positiveInt(process.env.SCENE_CHUNK_BEATS) };
    return Response.json(
      await analyzeScript({ script, limits, run, outputs, chunking, maxParallel: positiveInt(process.env.SCENE_MAX_PARALLEL) }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
