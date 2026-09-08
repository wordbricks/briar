import { Buffer } from "node:buffer";
import { createConnection } from "node:net";
import { create } from "@bufbuild/protobuf";
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
    operationKey: string;
    parts: Array<{ clientId: string; body: string; purpose: (typeof purposeValues)[number] }>;
  },
) => {
  const socket = createConnection(config.socketPath);
  const request = create(DmMessagePublicationRequestSchema, {
    invocationId: config.invocationId,
    capability: Buffer.from(config.capability, "base64url"),
    operationKey: input.operationKey,
    parts: input.parts.map((part) => create(DmMessagePublicationPartSchema, {
      clientId: part.clientId,
      body: part.body,
      purpose: purposeToProto(part.purpose),
    })),
  });
  socket.end(sizeDelimitedEncode(DmMessagePublicationRequestSchema, request));
  const source = (async function*() {
    for await (const chunk of socket) yield chunk as Buffer;
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
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  void runDmMessageMcpServer().catch((error) => {
    console.error(`[briar-dm-message-mcp] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
