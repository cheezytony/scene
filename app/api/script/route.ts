import { z } from "zod";
import { DEFAULT_PREVIEW, ModelChoiceSchema } from "@/lib/catalog";
import { guard } from "@/lib/guard";
import { errorResponse, makeCaller } from "@/lib/llm";
import { IDEA_TO_SCRIPT_PROMPT } from "@/lib/prompt";

export const maxDuration = 120;

const BodySchema = z.object({ idea: z.string().min(5).max(4000), model: ModelChoiceSchema.optional() });

/** Writes a short screenplay from a one-line idea, for people who don't have a script yet. */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Body must be JSON: { idea: string (5-4000 chars), model? }" }, { status: 400 });

  try {
    const result = await makeCaller(parsed.data.model ?? DEFAULT_PREVIEW)({
      system: IDEA_TO_SCRIPT_PROMPT,
      messages: [{ role: "user", content: `<idea>\n${parsed.data.idea}\n</idea>` }],
      effort: "low",
      maxTokens: 16000,
    });
    return Response.json({ script: result.text.trim(), usage: result.usage });
  } catch (error) {
    return errorResponse(error);
  }
}
