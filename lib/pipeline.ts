import type { z } from "zod";
import {
  CastSchema,
  MotionSchema,
  OutlineSchema,
  normalizeScene,
  type Entity,
  type Scene,
} from "./schema";
import { checkCounts, checkRelations, describeLimits, type Limits } from "./limits";
import { stagePrompt } from "./prompt";

export type StageName = "outline" | "cast" | "motion";

/** Per-stage structured-output schema and model settings. Schemas must stay small (see schema.ts). */
export const STAGES = {
  outline: { schema: OutlineSchema, effort: "medium", maxTokens: 32000 },
  cast: { schema: CastSchema, effort: "medium", maxTokens: 16000 },
  motion: { schema: MotionSchema, effort: "high", maxTokens: 64000 },
} as const;

export interface StageMessage {
  role: "user" | "assistant";
  content: unknown;
}
export interface StageRequest {
  stage: StageName;
  system: string;
  messages: StageMessage[];
}
export interface Usage {
  input_tokens: number;
  output_tokens: number;
}
export interface StageResult {
  /** The model's JSON output for this stage. */
  text: string;
  /** What to send back as the assistant turn if this stage needs a repair pass. */
  assistantContent: unknown;
  usage: Usage;
}
/** Runs one model call. Injected so the pipeline has no dependency on the SDK. */
export type RunStage = (request: StageRequest) => Promise<StageResult>;

export interface AnalysisResult {
  scene: Scene;
  /** Limits that could not be satisfied even after a repair pass. */
  violations: string[];
  /** True if any stage needed a repair pass. */
  retried: boolean;
  usage: Usage;
}

const REPAIR_SUBJECT: Record<StageName, string> = {
  outline: "outline",
  cast: "list of characters and objects",
  motion: "keyframes and cameras",
};

/**
 * Script -> scene in three stages, each with its own small schema:
 *   outline and cast run in parallel (both read only the script), then motion runs with both as
 *   context. Limits are enforced where they are decided: counts at the cast stage, attach/contain
 *   limits at the motion stage, each with one repair pass that regenerates only that stage.
 */
export async function analyzeScript(input: { script: string; limits: Limits; run: RunStage }): Promise<AnalysisResult> {
  const { script, limits, run } = input;
  const usage: Usage = { input_tokens: 0, output_tokens: 0 };
  let retried = false;

  const limitText = describeLimits(limits);
  const base = `<script>\n${script}\n</script>${limitText ? `\n\n${limitText}` : ""}`;

  async function call(stage: StageName, messages: StageMessage[]) {
    const result = await run({ stage, system: stagePrompt(stage), messages });
    usage.input_tokens += result.usage.input_tokens;
    usage.output_tokens += result.usage.output_tokens;
    return result;
  }

  async function runStage<S extends z.ZodType>(
    stage: StageName,
    schema: S,
    context: string,
    check: (data: z.infer<S>) => string[] = () => [],
  ): Promise<{ data: z.infer<S>; issues: string[] }> {
    const messages: StageMessage[] = [{ role: "user", content: base + context }];
    const first = await call(stage, messages);
    let data: z.infer<S> = schema.parse(JSON.parse(first.text));
    let issues = check(data);
    if (!issues.length) return { data, issues };

    // One repair pass for this stage only. Keep it only if it is no worse than the original.
    retried = true;
    try {
      const second = await call(stage, [
        ...messages,
        { role: "assistant", content: first.assistantContent },
        {
          role: "user",
          content: `Your ${REPAIR_SUBJECT[stage]} break these limits:\n${issues.map((i) => `- ${i}`).join("\n")}\n\nReturn the full corrected ${REPAIR_SUBJECT[stage]}, keeping everything else consistent.`,
        },
      ]);
      const repaired: z.infer<S> = schema.parse(JSON.parse(second.text));
      const repairedIssues = check(repaired);
      if (repairedIssues.length <= issues.length) {
        data = repaired;
        issues = repairedIssues;
      }
    } catch (error) {
      console.error(`Repair pass for ${stage} failed, keeping the first result`, error);
    }
    return { data, issues };
  }

  const [outline, cast] = await Promise.all([
    runStage("outline", OutlineSchema, ""),
    runStage("cast", CastSchema, "", (d) => checkCounts(d.entities, limits)),
  ]);

  const entities: Entity[] = cast.data.entities;
  const context = `\n\n<outline>\n${JSON.stringify(outline.data)}\n</outline>\n\n<cast>\n${JSON.stringify(entities)}\n</cast>`;
  const motion = await runStage("motion", MotionSchema, context, (d) =>
    checkRelations(assemble(outline.data, entities, d), limits),
  );

  const scene = normalizeScene(assemble(outline.data, entities, motion.data));
  const violations = [...new Set([...cast.issues, ...motion.issues])];
  return { scene, violations, retried, usage };
}

function assemble(
  outline: z.infer<typeof OutlineSchema>,
  entities: Entity[],
  motion: z.infer<typeof MotionSchema>,
): Scene {
  return { ...outline, entities, ...motion };
}
