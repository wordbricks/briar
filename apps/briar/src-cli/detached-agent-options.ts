import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { agentSkillDescriptionMaxLength } from "../src/lib/agent-limits";
import { ModelEffort } from "../src/lib/agent-provider-contract";
import { agentProviders } from "../src/lib/agent-provider";
import type { DetachedAgentSkill } from "./worker-queue-contract";

const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));
const defaulted = <S extends Schema.Constraint>(
  schema: S,
  value: S["Type"],
): Schema.withDecodingDefaultType<S> =>
  Schema.withDecodingDefaultType<S>(Effect.succeed(value))(schema);

const AgentProviderSchema = Schema.Literals(agentProviders);
const ExecutionMode = Schema.Literals(["conversation", "task"]);
const ApprovalPolicy = Schema.Literals(["invoke_is_consent", "explicit"]);
const NonNegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const DetachedAgentSkillSource = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  description: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  provider: AgentProviderSchema,
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(ModelEffort),
  kind: Schema.Literals(["issue_processing", "custom"]),
  executionMode: defaulted(ExecutionMode, "task"),
  approvalPolicy: defaulted(ApprovalPolicy, "explicit"),
  position: NonNegativeInteger,
});

const DetachedAgentSkillType = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  description: Schema.String,
  body: Schema.String,
  provider: AgentProviderSchema,
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(ModelEffort),
  kind: Schema.Literals(["issue_processing", "custom"]),
  executionMode: ExecutionMode,
  approvalPolicy: ApprovalPolicy,
  position: NonNegativeInteger,
});

const DetachedAgentSkillSchema = DetachedAgentSkillSource.pipe(
  Schema.decodeTo(
    DetachedAgentSkillType,
    SchemaTransformation.transform({
      decode: ({ body, description, instructions, ...skill }) => {
        const normalizedBody = body ?? instructions ?? "";
        return {
          ...skill,
          description: description ||
            normalizedBody.replace(/\s+/gu, " ").trim().slice(
              0,
              agentSkillDescriptionMaxLength,
            ) || skill.name,
          body: normalizedBody,
        } satisfies DetachedAgentSkill;
      },
      encode: (skill) => ({ ...skill, instructions: undefined }),
    }),
  ),
);

export const decodeDetachedAgentSkillsOption = Schema.decodeUnknownOption(
  mutableArray(DetachedAgentSkillSchema),
);
export const decodeDetachedAgentEffortOption = Schema.decodeUnknownOption(
  ModelEffort,
);
