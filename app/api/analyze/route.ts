import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DEFAULT_LIMITS, LimitsSchema, limitConflicts } from "@/lib/limits";
import { STAGES, analyzeScript, type RunStage } from "@/lib/pipeline";
import { guard } from "@/lib/guard";

export const maxDuration = 300;

const MAX_SCRIPT_CHARS = 200_000;
// ANTHROPIC_API_KEY or `ant auth login` profile. Several stages run at once, so a few extra retries
// (the SDK backs off and honors retry-after) absorb brief rate limiting instead of failing the run.
const client = new Anthropic({ maxRetries: 4 });

// Opt-in speed/cost knobs, read per request so a restart is the only thing needed to change them.
// SCENE_FAST_MODE=1: Opus fast mode, up to 2.5x faster output at twice the token price.
// SCENE_CHUNK_BEATS=n: most beats planned in one parallel call (default 3); lower is faster but
// gives the model less continuity across the cuts.
// SCENE_MAX_PARALLEL=n: most motion calls at once (default 6, the chunk cap). Lower it if you hit rate limits.
// SCENE_MOTION_EFFORT=low|medium|high: thinking depth for the motion stage (default high). Lower is faster and cheaper.
const positiveInt = (v: string | undefined) => (v && Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
const EFFORTS = ["low", "medium", "high"] as const;
const motionEffort = EFFORTS.find((e) => e === process.env.SCENE_MOTION_EFFORT);

const BodySchema = z.object({
  script: z.string(),
  limits: LimitsSchema.optional(),
});

class UserFacingError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** One model call for one pipeline stage, constrained to that stage's schema. */
const run: RunStage = async ({ stage, system, messages }) => {
  const { schema, effort: defaultEffort, maxTokens } = STAGES[stage];
  const effort = stage === "motion" && motionEffort ? motionEffort : defaultEffort;
  const stream = client.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: maxTokens,
    ...(process.env.SCENE_FAST_MODE === "1" ? { speed: "fast" as const } : {}),
    thinking: { type: "adaptive" },
    output_config: { effort, format: zodOutputFormat(schema) },
    system,
    messages: messages as Anthropic.MessageParam[],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new UserFacingError(
      `The model declined this request (${message.stop_details?.category ?? "policy"}).`,
      422,
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new UserFacingError("The breakdown was too large to finish. Try a shorter excerpt.", 422);
  }
  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new UserFacingError("Model returned no content.", 502);
  return {
    text: text.text,
    assistantContent: message.content,
    usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
  };
};

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Body must be JSON: { script: string, limits?: Limits }" }, { status: 400 });
  }
  const { script } = parsed.data;
  const limits = parsed.data.limits ?? DEFAULT_LIMITS;
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

  try {
    // Same response shape as before the pipeline was split into stages.
    const chunking = { maxBeats: positiveInt(process.env.SCENE_CHUNK_BEATS) };
    return Response.json(
      await analyzeScript({ script, limits, run, chunking, maxParallel: positiveInt(process.env.SCENE_MAX_PARALLEL) }),
    );
  } catch (error) {
    if (error instanceof UserFacingError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json(
        { error: "No valid Anthropic credentials. Set ANTHROPIC_API_KEY in .env.local." },
        { status: 401 },
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Rate limited. Try again shortly." }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return Response.json({ error: `Anthropic API error: ${error.message}` }, { status: 502 });
    }
    console.error(error);
    // The SDK throws a plain Error (not an APIError) when no credentials can be resolved.
    if (error instanceof Error && /authentication|api key|credential/i.test(error.message)) {
      return Response.json(
        { error: "No Anthropic credentials found. Set ANTHROPIC_API_KEY in .env.local and restart." },
        { status: 401 },
      );
    }
    return Response.json({ error: "Could not parse the model's breakdown." }, { status: 500 });
  }
}
