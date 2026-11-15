/**
 * Asks the API to compile each pipeline stage's structured-output schema.
 *
 * The API rejects a schema whose compiled grammar is too large ("The compiled grammar is too
 * large"), and the limit is only visible by trying. Run this after changing lib/schema.ts or the
 * stage definitions in lib/pipeline.ts. Each request is capped at 16 output tokens, so it costs
 * next to nothing.
 *
 *   npm run check:schemas
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { STAGES } from "../lib/pipeline";

async function main() {
  const client = new Anthropic();
  let failed = false;
  for (const [name, { schema }] of Object.entries(STAGES)) {
    try {
      await client.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16,
        output_config: { effort: "low", format: zodOutputFormat(schema) },
        messages: [{ role: "user", content: "hi" }],
      });
      console.log(`ok    ${name}`);
    } catch (error) {
      failed = true;
      console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (failed) {
    console.error("\nSplit the failing stage into smaller stages (see the note in lib/schema.ts).");
    process.exit(1);
  }
}

void main();
