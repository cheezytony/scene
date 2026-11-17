import { configuredProviders } from "@/lib/llm";

/** Which services have a key on this server, so the settings can say what is ready. No secrets. */
export function GET() {
  return Response.json(configuredProviders());
}
