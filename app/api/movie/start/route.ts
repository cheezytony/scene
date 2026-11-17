import { z } from "zod";
import { checkAccess } from "@/lib/guard";
import { errorResponse } from "@/lib/llm";
import { startClip } from "@/lib/video";

export const maxDuration = 60;

const BodySchema = z.object({
  provider: z.enum(["google", "replicate"]),
  model: z.string().min(1).max(200),
  prompt: z.string().min(5).max(4000),
  seconds: z.number().min(1).max(60),
});

/** Starts rendering one shot. Returns straight away with an id; ask /api/movie/status for the result. */
export async function POST(req: Request) {
  const denied = checkAccess(req);
  if (denied) return denied;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Body must be JSON: { provider, model, prompt, seconds }" }, { status: 400 });
  try {
    const { provider, model, prompt, seconds } = parsed.data;
    return Response.json({ id: await startClip({ choice: { provider, model }, prompt, seconds }) });
  } catch (error) {
    return errorResponse(error);
  }
}
