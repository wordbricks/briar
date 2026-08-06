import { z } from "zod";

export const ideaStatuses = [
  "draft",
  "refining",
  "ready",
  "issues_created",
  "archived",
] as const;
export type IdeaStatus = (typeof ideaStatuses)[number];

export const ideaProviders = ["codex", "claude", "grok", "opencode"] as const;
export type IdeaProvider = (typeof ideaProviders)[number];

export const ideaMessageSchema = z.string().trim().min(1).max(20_000);
export const ideaDocumentSchema = z.string().max(200_000);

export const ideaIssuePlanItemSchema = z.object({
  key: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(100_000),
  priority: z.number().int().min(1).max(4).nullable().default(null),
  provider: z.enum(ideaProviders).nullable().default(null),
  model: z.string().trim().min(1).max(100).nullable().default(null),
  effort: z
    .enum(["low", "medium", "high", "xhigh", "max", "ultra"])
    .nullable()
    .default(null),
  prerequisiteKeys: z.array(z.string().trim().min(1).max(64)).max(4).default([]),
});

export const ideaIssuePlanItemsSchema = z
  .array(ideaIssuePlanItemSchema)
  .min(1)
  .max(5)
  .superRefine((items, context) => {
    const keys = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (keys.has(item.key)) {
        context.addIssue({
          code: "custom",
          message: "Issue plan keys must be unique",
          path: [index, "key"],
        });
      }
      keys.add(item.key);
    }
    const dependencies = new Map(
      items.map((item) => [item.key, item.prerequisiteKeys]),
    );
    for (const [index, item] of items.entries()) {
      for (const dependency of item.prerequisiteKeys) {
        if (dependency === item.key) {
          context.addIssue({
            code: "custom",
            message: "An issue cannot depend on itself",
            path: [index, "prerequisiteKeys"],
          });
        } else if (!dependencies.has(dependency)) {
          context.addIssue({
            code: "custom",
            message: "Dependencies must reference this plan",
            path: [index, "prerequisiteKeys"],
          });
        }
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasCycle = (key: string): boolean => {
      if (visiting.has(key)) return true;
      if (visited.has(key)) return false;
      visiting.add(key);
      for (const dependency of dependencies.get(key) ?? []) {
        if (hasCycle(dependency)) return true;
      }
      visiting.delete(key);
      visited.add(key);
      return false;
    };
    if (items.some((item) => hasCycle(item.key))) {
      context.addIssue({
        code: "custom",
        message: "Issue dependencies must be acyclic",
      });
    }
  });

export type IdeaIssuePlanItem = z.infer<typeof ideaIssuePlanItemSchema>;

export type IdeaSummary = {
  id: string;
  organizationId: string;
  /** Null for an organization idea: it names a target project only on convert. */
  projectId: string | null;
  author: { id: string; name: string; image: string | null };
  title: string;
  documentMarkdown: string;
  status: IdeaStatus;
  provider: IdeaProvider;
  model: string | null;
  version: number;
  generatedIssueCount: number;
  createdAt: string;
  updatedAt: string;
};

export type IdeaMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  jobId: string | null;
  createdAt: string;
};

export type IdeaJob = {
  id: string;
  kind: "chat" | "issue_plan";
  status: "queued" | "running" | "completed" | "failed";
  triggerMessageId: string | null;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IdeaIssuePlan = {
  id: string;
  ideaId: string;
  documentVersion: number;
  version: number;
  items: IdeaIssuePlanItem[];
  createdAt: string;
  updatedAt: string;
};

export type IdeaDetail = IdeaSummary & {
  canEdit: boolean;
  messages: IdeaMessage[];
  activeJob: IdeaJob | null;
  plan: IdeaIssuePlan | null;
  generatedRunIds: string[];
};

export const ideaTurnResultSchema = z.object({
  reply: z.string().trim().min(1).max(100_000),
  documentMarkdown: ideaDocumentSchema,
  title: z.string().trim().min(1).max(300).nullable().default(null),
});

export const ideaPlanResultSchema = z.object({
  issues: ideaIssuePlanItemsSchema,
});
