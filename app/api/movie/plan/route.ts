import { z } from "zod";
import { DEFAULT_PREVIEW, ModelChoiceSchema } from "@/lib/catalog";
import { guard } from "@/lib/guard";
import { errorResponse, makeCaller } from "@/lib/llm";
import { OutputsSchema } from "@/lib/outputs";
import { ShotListSchema, movieContext, planShots } from "@/lib/movie";
import { SceneSchema } from "@/lib/schema";

export const maxDuration = 300;

const BodySchema = z.object({
  scene: SceneSchema,
  inputs: OutputsSchema,
  style: z.string().max(600).default(""),
  maxClipSec: z.number().min(1).max(60),
  model: ModelChoiceSchema.optional(),
});

const DIRECTOR = `You are a film director preparing shots for an AI video model. You are given a scene (beats, and possibly a transcript, a cast with positions, and camera setups) and a list of shots, each with an id, beat and length. Write one prompt per shot, in the same order and with the same ids, seconds and beatIds. Each prompt must stand alone, because the video model sees nothing else: say where we are, who is in frame and what they look like (repeat the same description every time the same person or prop appears, so they stay consistent from shot to shot), what happens, the camera (shot size, angle, movement) and the mood and lighting. Use the cast positions and camera setups when they are given, translating metres into plain framing language. Put any dialogue in quotes with who says it. Keep each prompt under 120 words. Match the requested visual style across every shot.`;

/** Step one of making the movie: the director writes a prompt for every shot (a few cheap tokens, no video yet). */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That scene couldn't be read." }, { status: 400 });
  const { scene, inputs, style, maxClipSec } = parsed.data;
  const shots = planShots(scene, inputs, maxClipSec);
  if (!shots.length) return Response.json({ error: "There's nothing to film yet: the scene has no beats." }, { status: 400 });
  if (shots.length > 60) return Response.json({ error: `That would be ${shots.length} shots. Try a shorter scene.` }, { status: 413 });

  try {
    const result = await makeCaller(parsed.data.model ?? DEFAULT_PREVIEW)({
      system: DIRECTOR,
      messages: [
        {
          role: "user",
          content: `<scene>\n${JSON.stringify(movieContext(scene, inputs))}\n</scene>\n\n<style>\n${style || "cinematic, natural light"}\n</style>\n\n<shots>\n${JSON.stringify(shots)}\n</shots>`,
        },
      ],
      schema: ShotListSchema,
      effort: "medium",
      maxTokens: 32000,
    });
    const written = ShotListSchema.parse(JSON.parse(result.text)).clips;
    // Trust our own timing and ids; take only the prompts from the model.
    const clips = shots.map((s, i) => ({ ...s, prompt: written.find((c) => c.id === s.id)?.prompt ?? written[i]?.prompt ?? "" }));
    if (clips.some((c) => !c.prompt.trim())) return Response.json({ error: "The director skipped a shot. Try again." }, { status: 502 });
    return Response.json({ clips, usage: result.usage });
  } catch (error) {
    return errorResponse(error);
  }
}
