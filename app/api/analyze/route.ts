import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { SceneSchema, normalizeScene, type Scene } from "@/lib/schema";
import { SYSTEM_PROMPT } from "@/lib/prompt";
import { DEFAULT_LIMITS, LimitsSchema, checkLimits, describeLimits } from "@/lib/limits";

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

async function generate(messages: Anthropic.MessageParam[]) {
  const stream = client.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(SceneSchema) },
    system: SYSTEM_PROMPT,
    messages,
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
  const scene = normalizeScene(SceneSchema.parse(JSON.parse(text.text)));
  return { message, scene };
}

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Body must be JSON: { script: string, limits?: Limits }" }, { status: 400 });
  }
  const { script } = parsed.data;
  const limits = parsed.data.limits ?? DEFAULT_LIMITS;
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
    const limitText = describeLimits(limits);
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: `<script>\n${script}\n</script>${limitText ? `\n\n${limitText}` : ""}` },
    ];

    const first = await generate(messages);
    let scene: Scene = first.scene;
    let usage = first.message.usage;
    let violations = checkLimits(scene, limits);
    let retried = false;

    if (violations.length) {
      // One repair pass: show the model its own output plus the exact violations.
      retried = true;
      try {
        const second = await generate([
          ...messages,
          { role: "assistant", content: first.message.content },
          {
            role: "user",
            content: `Your breakdown breaks these limits:\n${violations.map((v) => `- ${v}`).join("\n")}\n\nReturn the full corrected breakdown. Keep everything else consistent: remove dropped entities from keyframes and cameras, and keep transcript, beats and camera setups coherent.`,
          },
        ]);
        scene = second.scene;
        usage = second.message.usage;
        violations = checkLimits(scene, limits);
      } catch (error) {
        console.error("Repair pass failed, returning first result", error);
      }
    }

    return Response.json({ scene, violations, retried, usage });
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
