import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ModelChoice } from "../catalog";
import type { StageResult } from "../pipeline";

/** An error whose message is safe to show to the person using the app. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface StructuredCall {
  system: string;
  messages: { role: "user" | "assistant"; content: unknown }[];
  /** Omit for plain text (e.g. writing a script). */
  schema?: z.ZodType;
  effort: "low" | "medium" | "high";
  maxTokens: number;
}
export type CallModel = (call: StructuredCall) => Promise<StageResult>;

// Opt-in: Opus fast mode, up to 2.5x faster output at twice the token price.
const fast = () => process.env.SCENE_FAST_MODE === "1";

function anthropicCaller(model: string): CallModel {
  // ANTHROPIC_API_KEY or an `ant auth login` profile. Several calls run at once, so a few extra
  // retries absorb brief rate limiting instead of failing the run.
  const client = new Anthropic({ maxRetries: 4 });
  return async ({ system, messages, schema, effort, maxTokens }) => {
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      ...(fast() && model === "claude-opus-5-5" ? { speed: "fast" as const } : {}),
      thinking: { type: "adaptive" },
      output_config: { effort, ...(schema ? { format: zodOutputFormat(schema) } : {}) },
      system,
      messages: messages as Anthropic.MessageParam[],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      throw new UserFacingError(`The model declined this request (${message.stop_details?.category ?? "policy"}).`, 422);
    }
    if (message.stop_reason === "max_tokens") {
      throw new UserFacingError("The result was too large to finish. Try a shorter excerpt.", 422);
    }
    const text = message.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new UserFacingError("The model returned nothing.", 502);
    return {
      text: text.text,
      assistantContent: message.content,
      usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
    };
  };
}

interface ChatResponse {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/** OpenAI's Chat Completions shape, which many other services copy. Structured output via json_schema. */
function openaiCaller(model: string): CallModel {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  return async ({ system, messages, schema, maxTokens }) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new UserFacingError("No OpenAI key found. Set OPENAI_API_KEY on the server and restart.", 401);
    const body = {
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        ...messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : String(m.content) })),
      ],
      ...(schema
        ? { response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: z.toJSONSchema(schema, { target: "draft-7" }) } } }
        : {}),
    };
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as ChatResponse | null;
    if (res.status === 401) throw new UserFacingError("That OpenAI key wasn't accepted.", 401);
    if (res.status === 429) throw new UserFacingError("Rate limited. Try again shortly.", 429);
    if (!res.ok) throw new UserFacingError(`The model service said: ${data?.error?.message ?? res.status}`, 502);
    const choice = data?.choices?.[0];
    if (choice?.message?.refusal) throw new UserFacingError("The model declined this request.", 422);
    if (choice?.finish_reason === "length") throw new UserFacingError("The result was too large to finish. Try a shorter excerpt.", 422);
    const text = choice?.message?.content;
    if (!text) throw new UserFacingError("The model returned nothing.", 502);
    return {
      text,
      assistantContent: text,
      usage: { input_tokens: data?.usage?.prompt_tokens ?? 0, output_tokens: data?.usage?.completion_tokens ?? 0 },
    };
  };
}

export function makeCaller(choice: Pick<ModelChoice, "provider" | "model">): CallModel {
  return choice.provider === "openai" ? openaiCaller(choice.model) : anthropicCaller(choice.model);
}

/** Which providers have a key on this server (never the keys themselves). */
export function configuredProviders() {
  return {
    anthropic: !!process.env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_AUTH_TOKEN,
    openai: !!process.env.OPENAI_API_KEY,
    google: !!process.env.GEMINI_API_KEY,
    replicate: !!process.env.REPLICATE_API_TOKEN,
  };
}

/** Friendly messages for SDK errors, shared by every route that calls a model. */
export function errorResponse(error: unknown): Response {
  if (error instanceof UserFacingError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Anthropic.AuthenticationError)
    return Response.json({ error: "No valid Anthropic credentials. Set ANTHROPIC_API_KEY in .env.local." }, { status: 401 });
  if (error instanceof Anthropic.RateLimitError) return Response.json({ error: "Rate limited. Try again shortly." }, { status: 429 });
  if (error instanceof Anthropic.APIError) return Response.json({ error: `Anthropic API error: ${error.message}` }, { status: 502 });
  console.error(error);
  // The SDK throws a plain Error (not an APIError) when no credentials can be resolved.
  if (error instanceof Error && /authentication|api key|credential/i.test(error.message))
    return Response.json({ error: "No Anthropic credentials found. Set ANTHROPIC_API_KEY in .env.local and restart." }, { status: 401 });
  return Response.json({ error: "Could not parse the model's answer." }, { status: 500 });
}
