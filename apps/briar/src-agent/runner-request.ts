import * as Schema from "effect/Schema";

const AgentImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  path: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
});

const JsonSchema = Schema.Union([
  Schema.Record(Schema.String, Schema.Unknown),
  Schema.Boolean,
]);

export const commonRunnerRequestFields = {
  type: Schema.Literal("run"),
  message: Schema.String,
  workspaceRoot: Schema.String,
  conversationId: Schema.optional(Schema.NullOr(Schema.String)),
  instructions: Schema.optional(Schema.NullOr(Schema.String)),
  outputSchema: Schema.optional(Schema.NullOr(JsonSchema)),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  approvalPolicy: Schema.Literals([
    "untrusted",
    "on-request",
    "never",
  ]),
  sandboxMode: Schema.Literals([
    "readOnly",
    "workspaceWrite",
    "dangerFullAccess",
  ]),
  networkAccess: Schema.Boolean,
  providerBinaryPath: Schema.String,
  attachments: Schema.optional(
    Schema.mutable(Schema.Array(AgentImageAttachment)),
  ),
} satisfies Schema.Struct.Fields;

export const runnerRequestDecoderOptions = {
  onExcessProperty: "preserve",
  propertyOrder: "original",
} as const;
