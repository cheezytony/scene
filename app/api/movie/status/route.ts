import { checkAccess } from "@/lib/guard";
import { errorResponse } from "@/lib/llm";
import { checkClip } from "@/lib/video";

/** Whether a shot has finished rendering. */
export async function GET(req: Request) {
  const denied = checkAccess(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  const id = url.searchParams.get("id");
  if ((provider !== "google" && provider !== "replicate") || !id) return Response.json({ error: "Need provider and id." }, { status: 400 });
  try {
    return Response.json(await checkClip(provider, id));
  } catch (error) {
    return errorResponse(error);
  }
}
