import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DEFAULT_LIMITS, LimitsSchema, limitConflicts } from "@/lib/limits";
import { STAGES, analyzeScript, type RunStage } from "@/lib/pipeline";
import { guard } from "@/lib/guard";

export const maxDuration = 300;

const MAX_SCRIPT_CHARS = 200_000;
const client = new Anthropic(); // ANTHROPIC_API_KEY or `ant auth login` profile

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
  const { schema, effort, maxTokens } = STAGES[stage];
  const stream = client.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: maxTokens,
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
    return Response.json(await analyzeScript({ script, limits, run }));
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
