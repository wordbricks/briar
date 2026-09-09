import { exchangeDmFileRelay } from "../src-cli/dm-file-relay";
import { Buffer } from "node:buffer";
import { createConnection } from "node:net";
import { create, toJson } from "@bufbuild/protobuf";
import { ExecuteDmScheduleToolResponseSchema, type DmScheduleToolOperation } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { sizeDelimitedDecodeStream, sizeDelimitedEncode } from "@bufbuild/protobuf/wire";
import { DmMessagePurpose } from "@briar/contracts/gen/briar/app/v1/channel_pb";
import {
  DmMessagePublicationPartSchema,
  DmMessagePublicationRequestSchema,
  DmMessagePublicationResponseSchema,
} from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readDmMessageMcpConfig, type DmMessageMcpConfig } from "./dm-message-mcp-config";

const purposeValues = [
  "acknowledgement",
  "progress",
  "discovery",
  "question",
  "result",
  "conversation",
] as const;

const purposeToProto = (purpose: (typeof purposeValues)[number]) => ({
  acknowledgement: DmMessagePurpose.ACKNOWLEDGEMENT,
  progress: DmMessagePurpose.PROGRESS,
  discovery: DmMessagePurpose.DISCOVERY,
  question: DmMessagePurpose.QUESTION,
  result: DmMessagePurpose.RESULT,
  conversation: DmMessagePurpose.CONVERSATION,
})[purpose];

const exchange = async (
  config: DmMessageMcpConfig,
  input: {
    schedule?: Omit<DmScheduleToolOperation, "$typeName">;
    operationKey: string;
    parts: Array<{ clientId: string; body: string; purpose: (typeof purposeValues)[number] }>;
  },
) => {
  const request = create(DmMessagePublicationRequestSchema, {
    invocationId: config.invocationId,
    capability: Buffer.from(config.capability, "base64url"),
    operationKey: input.operationKey,
    schedule: input.schedule,
    parts: input.parts.map((part) => create(DmMessagePublicationPartSchema, {
      clientId: part.clientId,
      body: part.body,
      purpose: purposeToProto(part.purpose),
    })),
  });
  const encoded = sizeDelimitedEncode(DmMessagePublicationRequestSchema, request);
  const source = (async function*() {
    if (config.relayDirectory) {
      yield await exchangeDmFileRelay(config.relayDirectory, encoded);
    } else {
      const socket = createConnection(config.socketPath);
      socket.end(encoded);
      try { for await (const chunk of socket) yield chunk as Buffer; }
      finally { socket.destroy(); }
    }
  })();
  const iterator = sizeDelimitedDecodeStream(
    DmMessagePublicationResponseSchema,
    source,
    { readMaxBytes: 64 * 1024 },
  )[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done || !(await iterator.next()).done) {
    throw new Error("DM publication relay returned an invalid response");
  }
  return first.value;
};

const configArgument = (args: readonly string[]) => {
  const index = args.indexOf("--config");
  const value = index < 0 ? undefined : args[index + 1];
  if (!value) throw new Error("DM message MCP requires --config PATH");
  return value;
};

const commandSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("publish_dm_message"), operationKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u),
    parts: z.array(z.object({ clientId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u), body: z.string().trim().min(1).max(10000), purpose: z.enum(purposeValues) })).min(1).max(8) }),
  z.object({ tool: z.literal("create_dm_schedule"), requestKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u),
    instruction: z.string().trim().min(1).max(8000), delaySeconds: z.number().int().min(1).max(31536000).optional(),
    runAt: z.string().optional(), intervalSeconds: z.number().int().min(300).max(31536000).multipleOf(60).optional(),
    timeZone: z.string().default("UTC"), timeZoneConfirmed: z.boolean().default(false), previousJobId: z.string().optional() }),
  z.object({ tool: z.literal("list_dm_schedules"), beforeScheduleId: z.string().optional() }),
  z.object({ tool: z.literal("cancel_dm_schedule"), scheduleId: z.string().min(1) }),
]);

/** The same authenticated command is available to every provider's normal shell tool. */
export async function invokeDmMessageCommand(config: DmMessageMcpConfig, value: unknown) {
  const input = commandSchema.parse(value);
  if (input.tool !== "publish_dm_message" && !config.scheduleTools) throw new Error("schedule_tools_unavailable");
  const schedule = input.tool === "publish_dm_message" ? undefined
    : input.tool === "create_dm_schedule" ? { ...input, action: "create", scheduleId: "" }
    : { action: input.tool === "list_dm_schedules" ? "list" : "cancel", requestKey: "",
      scheduleId: input.tool === "list_dm_schedules" ? input.beforeScheduleId ?? "" : input.scheduleId,
      instruction: "", timeZone: "", timeZoneConfirmed: false };
  const response = await exchange(config, input.tool === "publish_dm_message" ? input
    : { schedule, operationKey: schedule?.requestKey || "schedule", parts: [] });
  if (response.result.case === "schedule") return toJson(ExecuteDmScheduleToolResponseSchema, response.result.value);
  if (response.result.case === "receipt") return {
    batchId: response.result.value.batchId, messageIds: response.result.value.messageIds,
    firstSequence: response.result.value.firstSequence.toString(), lastSequence: response.result.value.lastSequence.toString(),
    replayed: response.result.value.replayed,
  };
  throw new Error(response.result.case === "error" ? response.result.value.reason : "dm_command_failed");
}

export async function runDmMessageCommand(args: readonly string[] = process.argv.slice(2)) {
  const config = await readDmMessageMcpConfig(configArgument(args));
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 128 * 1024) throw new Error("dm_command_input_too_large");
    chunks.push(buffer);
  }
  const result = await invokeDmMessageCommand(config, JSON.parse(Buffer.concat(chunks).toString("utf8")));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export async function runDmMessageMcpServer(
  args: readonly string[] = process.argv.slice(2),
) {
  const config = await readDmMessageMcpConfig(configArgument(args));
  const server = new McpServer({ name: "briar-dm-message", version: "1.0.0" });
  server.registerTool("publish_dm_message", {
    description:
      "Publish one ordered batch of durable progress messages in the current direct message while continuing this turn. Retry the same observation with the same operationKey and clientId values.",
    inputSchema: {
      operationKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u),
      parts: z.array(z.object({
        clientId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u),
        body: z.string().trim().min(1).max(10_000),
        purpose: z.enum(purposeValues),
      })).min(1).max(8),
    },
  }, async (input) => {
    const response = await exchange(config, input);
    if (response.result.case === "receipt") {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          batchId: response.result.value.batchId,
          messageIds: response.result.value.messageIds,
          firstSequence: response.result.value.firstSequence.toString(),
          lastSequence: response.result.value.lastSequence.toString(),
          replayed: response.result.value.replayed,
        }) }],
      };
    }
    const error = response.result.case === "error"
      ? response.result.value.reason
      : "publication_failed";
    return {
      isError: true,
      content: [{ type: "text" as const, text: error }],
    };
  });
  if (config.scheduleTools) {
    const scheduleTool = async (schedule: Omit<DmScheduleToolOperation, "$typeName">) => {
      const response = await exchange(config, { operationKey: schedule.requestKey || "schedule", parts: [], schedule });
      return response.result.case === "schedule" ? {
        content: [{ type: "text" as const, text: JSON.stringify(toJson(ExecuteDmScheduleToolResponseSchema, response.result.value)) }],
      } : { isError: true, content: [{ type: "text" as const, text: response.result.case === "error" ? response.result.value.reason : "schedule_failed" }] };
    };
    server.registerTool("create_dm_schedule", {
      description: "Save an explicitly requested later/recurring task in this DM. Confirm only after the server succeeds and quote its next time and delay notice. Relative delays use original server receipt time; absolute time requires the user's confirmed IANA zone. Daily means fixed 24 hours. Reuse requestKey for retries.",
      inputSchema: {
        requestKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u),
        instruction: z.string().trim().min(1).max(8000),
        delaySeconds: z.number().int().min(1).max(31536000).optional(),
        runAt: z.string().optional(),
        intervalSeconds: z.number().int().min(300).max(31536000).multipleOf(60).optional(),
        timeZone: z.string().default("UTC"), timeZoneConfirmed: z.boolean().default(false),
        previousJobId: z.string().optional(),
      },
    }, (input) => scheduleTool({ ...input, action: "create", scheduleId: "" }));
    server.registerTool("list_dm_schedules", {
      description: "List this owner's schedules in this DM with next times and cancellation state. If truncated, pass the last returned ID as beforeScheduleId for the next page.", inputSchema: { beforeScheduleId: z.string().optional() },
    }, (input) => scheduleTool({ action: "list", requestKey: "", scheduleId: input.beforeScheduleId ?? "", instruction: "", timeZone: "", timeZoneConfirmed: false }));
    server.registerTool("cancel_dm_schedule", {
      description: "Disable the selected schedule and request its queued/running occurrence to stop. A requested stop is not a confirmed stop; completed external effects are not undone.",
      inputSchema: { scheduleId: z.string().min(1) },
    }, (input) => scheduleTool({ action: "cancel", requestKey: "", scheduleId: input.scheduleId, instruction: "", timeZone: "", timeZoneConfirmed: false }));
  }
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  void (process.argv.includes("--invoke") ? runDmMessageCommand() : runDmMessageMcpServer()).catch((error) => {
    console.error(`[briar-dm-message-mcp] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
