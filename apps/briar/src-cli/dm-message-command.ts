import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startDmFileRelay } from "./dm-file-relay";
import { prepareDmMessageMcp, readDmMessageMcpConfig } from "../src-agent/dm-message-mcp-config";
import type { DetachedProviderTurnInput } from "./detached-provider-turn";

const shellWord = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";

/** A claim-scoped local command, independent of a provider's MCP implementation. */
export async function prepareDmMessageCommand(input: DetachedProviderTurnInput) {
  if (!input.dmMessagePublicationBinding) return { input, cleanup: async () => undefined };
  const prepared = await prepareDmMessageMcp({
    dmMessagePublicationBinding: input.dmMessagePublicationBinding,
    dmMessageMcpServerPath: input.dmMessageMcpServerPath ?? "",
  });
  const server = prepared.servers[0]!;
  let relay: Awaited<ReturnType<typeof startDmFileRelay>> | undefined;
  let command: string;
  try {
    relay = await startDmFileRelay(input.workspacePath, input.dmMessagePublicationBinding.socketPath);
    const config = await readDmMessageMcpConfig(server.args[server.args.indexOf("--config") + 1]!);
    const configPath = join(relay.directory, "command-config.json");
    await writeFile(configPath, JSON.stringify({ ...config, relayDirectory: relay.directory }), { mode: 0o600, flag: "wx" });
    command = [server.command, server.args[0]!, "--config", configPath, "--invoke"].map(shellWord).join(" ");
  } catch (error) {
    await relay?.cleanup();
    await prepared.cleanup();
    throw error;
  }
  const prompt = [
    "Briar DM tools use this local command through your ordinary shell/terminal tool. Do not look for a provider-native MCP tool.",
    "Invoke it with a quoted heredoc so JSON text is never evaluated as shell code:",
    `${command} <<'BRIAR_DM_REQUEST'\n{"tool":"list_dm_schedules"}\nBRIAR_DM_REQUEST`,
    "Supported JSON requests:",
    '{"tool":"publish_dm_message","operationKey":"unique-observation","parts":[{"clientId":"unique-part","body":"Concrete progress","purpose":"progress"}]}',
    ...(input.dmMessagePublicationBinding.scheduleTools ? [
      '{"tool":"create_dm_schedule","requestKey":"unique-request","instruction":"Task to perform later","delaySeconds":3600,"timeZone":"UTC","timeZoneConfirmed":false}',
      "create_dm_schedule requires either delaySeconds or runAt (an ISO instant with explicit offset). Optional intervalSeconds repeats in fixed whole minutes, minimum 300 seconds. Absolute runAt requires a confirmed IANA timeZone and timeZoneConfirmed:true. Optional previousJobId carries prior result references.",
      '{"tool":"list_dm_schedules"} or {"tool":"list_dm_schedules","beforeScheduleId":"last-returned-id"}',
      '{"tool":"cancel_dm_schedule","scheduleId":"returned-id"}',
    ] : ["Schedule operations are unavailable in this invocation; only publish_dm_message is authorized."]),
    "The command exchanges request/response files in this workspace. Briar alone connects its fixed authenticated invocation socket; no provider network or Unix-socket exception is needed.",
    "Only successful command JSON is proof of storage/publication. Retry identical requests with the same keys; failures are not success. Never print or copy the private configuration contents. The command already holds only this invocation's authority.",
  ].join("\n\n");
  return { input: { ...input, prompt: `${input.prompt}\n\n${prompt}`,
    dmMessagePublicationBinding: undefined, dmMessageMcpServerPath: undefined }, cleanup: async () => { try { await relay?.cleanup(); } finally { await prepared.cleanup(); } } };
}
