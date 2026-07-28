import { z } from "zod";

export const agentResultOutcomes = [
  "completed",
  "partial",
  "blocked",
  "failed",
] as const;

export const agentResultImportances = [
  "routine",
  "important",
  "critical",
] as const;

export const agentResultUrgencies = [
  "normal",
  "time_sensitive",
  "immediate",
] as const;

export const agentResultImpacts = [
  "issue",
  "project",
  "organization",
] as const;

export const structuredAgentResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(100_000),
    outcome: z.enum(agentResultOutcomes),
    importance: z.enum(agentResultImportances),
    urgency: z.enum(agentResultUrgencies),
    impact: z.enum(agentResultImpacts),
    humanActionRequired: z.boolean(),
    nextAction: z.string().trim().min(1).max(4_000).nullable(),
    dueAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.humanActionRequired && !result.nextAction) {
      context.addIssue({
        code: "custom",
        message: "humanActionRequired results require nextAction",
        path: ["nextAction"],
      });
    }
  });

export type StructuredAgentResult = z.infer<
  typeof structuredAgentResultSchema
>;

export function parseStructuredAgentResult(value: unknown) {
  return structuredAgentResultSchema.safeParse(value);
}
