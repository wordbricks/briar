import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  emptyAgentProviderCapabilityCatalog,
  type AgentEffortCapability,
  type AgentModelCapability,
  type AgentProviderCapabilityCatalog,
} from "../src/lib/agent-provider-contract";
import {
  agentProviderBinaryName,
  agentProviders,
  openCodeUpstreamModelPrefix,
  openCodeUpstreamOf,
  type AgentProvider,
  type OpenCodeUpstreamDescriptor,
} from "../src/lib/agent-provider";
import { cursorAuthenticated } from "./provider-credentials";
import { providerMissingBinaryMessage } from "./provider-usage";

const MAX_MODELS = 500;
const MAX_EFFORTS = 20;
const CACHE_MS = 5 * 60_000;

const effort = (
  id: string,
  input: Partial<AgentEffortCapability> = {},
): AgentEffortCapability => ({ id, label: input.label ?? id, ...input });

const commandWithEnv = (
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) => {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    env,
    timeout: 15_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw result.error ?? new Error(result.stderr.trim() || `${binary} ${args.join(" ")} failed`);
  }
  return result.stdout;
};

/**
 * `--help` is a capability listing, not a command that has to succeed: a CLI
 * that prints its usage on stderr and exits non-zero still describes itself.
 */
const helpOutput = (binary: string, env: NodeJS.ProcessEnv) => {
  const result = spawnSync(binary, ["--help"], {
    encoding: "utf8",
    env,
    timeout: 15_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return `${result.stdout}${result.stderr}`;
};

const withoutGoogleCredentials = (env: NodeJS.ProcessEnv) => {
  const cleaned = { ...env };
  for (const key of [
    "AGY_ADC_AUTH",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
  ]) {
    delete cleaned[key];
  }
  return cleaned;
};

export function parseGrokModelList(output: string) {
  return output.split(/\r?\n/u).flatMap((line) => {
    const match = line.trim().match(/^[*-]\s+(.+?)(?:\s+\(default\))?$/u);
    if (!match) return [];
    return [{ id: match[1]!, isDefault: /\(default\)\s*$/u.test(line) }];
  });
}

async function grokModels(
  binary: string,
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<AgentModelCapability[]> {
  const listed = parseGrokModelList(commandWithEnv(binary, ["models"], env));
  let cached: unknown;
  try {
    cached = JSON.parse(await readFile(join(process.env.GROK_HOME?.trim() || join(home, ".grok"), "models_cache.json"), "utf8"));
  } catch {
    return listed.slice(0, MAX_MODELS).map((model) => ({
      ...model,
      label: model.id,
      defaultEffortId: null,
      efforts: [],
    }));
  }
  const records = cached && typeof cached === "object" && !Array.isArray(cached)
    ? (cached as { models?: unknown }).models
    : null;
  if (!records || typeof records !== "object" || Array.isArray(records)) return [];
  const models = Object.entries(records).flatMap(([key, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const wrapper = raw as Record<string, unknown>;
    const info = wrapper.info && typeof wrapper.info === "object" && !Array.isArray(wrapper.info)
      ? wrapper.info as Record<string, unknown>
      : wrapper;
    if (info.hidden === true || info.supported_in_api === false) return [];
    const id = typeof info.id === "string" ? info.id : key;
    if (!id || id.length > 100) return [];
    let efforts = Array.isArray(info.reasoning_efforts)
      ? info.reasoning_efforts.flatMap((rawEffort) => {
          if (!rawEffort || typeof rawEffort !== "object" || Array.isArray(rawEffort)) return [];
          const value = rawEffort as Record<string, unknown>;
          const effortId = typeof value.id === "string"
            ? value.id
            : typeof value.value === "string" ? value.value : null;
          if (!effortId || effortId.length > 50) return [];
          return [effort(effortId, {
            label: typeof value.label === "string" ? value.label : effortId,
            description: typeof value.description === "string" ? value.description : null,
            isDefault: value.default === true,
          })];
        }).slice(0, MAX_EFFORTS)
      : [];
    const configuredDefaultEffort = typeof info.reasoning_effort === "string"
      ? info.reasoning_effort
      : efforts.find((candidate) => candidate.isDefault)?.id ?? null;
    efforts = efforts.map((candidate) => ({
      ...candidate,
      isDefault: candidate.id === configuredDefaultEffort,
    }));
    return [{
      id,
      label: typeof info.name === "string" ? info.name : id,
      isDefault: listed.some((model) => model.id === id && model.isDefault),
      defaultEffortId: configuredDefaultEffort,
      efforts,
    }];
  }).slice(0, MAX_MODELS);
  for (const model of listed) {
    if (!models.some((candidate) => candidate.id === model.id)) {
      models.push({ ...model, label: model.id, defaultEffortId: null, efforts: [] });
    }
  }
  return models;
}

/**
 * The lines of one `--help` option: the line naming it plus the wrapped
 * description lines that follow, up to the next option.
 */
function helpOptionBlock(output: string, option: string): string[] {
  const lines = output.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.includes(option));
  if (start < 0) return [];
  const block: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    if (index > start && /^\s{2}-\S/u.test(lines[index]!)) break;
    block.push(lines[index]!);
  }
  return block;
}

export function parseClaudeEfforts(output: string) {
  // The level list wraps onto the next line in recent Claude Code help output.
  const values = helpOptionBlock(output, "--effort").join(" ").match(/\(([^)]+)\)/u)?.[1];
  return values
    ? values.split(/[|,]/u).map((value) => value.trim()).filter(Boolean).slice(0, MAX_EFFORTS).map((id) => effort(id))
    : [];
}

export const parseAgyEfforts = parseClaudeEfforts;

export function parseAgyModels(output: string): AgentModelCapability[] {
  let root: unknown;
  try {
    root = JSON.parse(output);
  } catch {
    return [];
  }

  const models = new Map<string, AgentModelCapability>();
  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const candidate of value) {
        if (typeof candidate === "string") {
          const id = candidate.trim();
          if (id && id.length <= 100 && !models.has(id)) {
            models.set(id, {
              id,
              label: id,
              isDefault: false,
              defaultEffortId: null,
              efforts: [],
            });
          }
        } else {
          collect(candidate);
        }
      }
      return;
    }
    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    const rawId = record.id ?? record.model_id ?? record.modelId;
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (id && id.length <= 100) {
      const rawLabel =
        record.display_name ?? record.displayName ?? record.label ?? record.name;
      const label = typeof rawLabel === "string" && rawLabel.trim()
        ? rawLabel.trim()
        : id;
      const existing = models.get(id);
      models.set(id, {
        id,
        label: existing?.label === id ? label : (existing?.label ?? label),
        isDefault:
          existing?.isDefault === true ||
          record.is_default === true ||
          record.isDefault === true,
        defaultEffortId: null,
        efforts: [],
      });
      return;
    }
    for (const candidate of Object.values(record)) collect(candidate);
  };

  collect(root);
  return [...models.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, MAX_MODELS);
}

/**
 * Fallback for a Claude CLI that does not answer the stream-json `initialize`
 * request with a model picker: the aliases its `--help` text quotes as
 * examples. Prose, not a catalog, so it carries no default and no efforts.
 */
export function parseClaudeModels(output: string): AgentModelCapability[] {
  const block = helpOptionBlock(output, "--model <model>");
  if (block.length === 0) return [];
  return [...block.join(" ").matchAll(/(?<![a-z0-9])'([a-z0-9][a-z0-9._/-]*)'/giu)]
    .map((match) => match[1]!)
    .filter((id, index, values) =>
      id.length <= 100 &&
      values.indexOf(id) === index
    )
    .slice(0, MAX_MODELS)
    .map((id) => ({ id, label: id, isDefault: false, defaultEffortId: null, efforts: [] }));
}

export type ClaudeModelDiscovery = {
  models: AgentModelCapability[];
  defaultEfforts: AgentEffortCapability[];
};

/**
 * The model picker Claude Code returns from a stream-json `initialize` control
 * request: the rows its interactive `/model` menu shows for this account.
 *
 * The picker's `default` row is not a model id but what runs when nothing is
 * chosen, which Briar already offers as "Provider default model". It is folded
 * into the alias row that resolves to the same wire model, which becomes the
 * catalog default, and its effort levels become the provider defaults.
 */
export function parseClaudeInitializeModels(response: unknown): ClaudeModelDiscovery {
  const rows = response && typeof response === "object" && !Array.isArray(response)
    && Array.isArray((response as { models?: unknown }).models)
    ? (response as { models: unknown[] }).models
    : [];
  type Row = {
    id: string;
    label: string;
    resolvedModel: string | null;
    efforts: AgentEffortCapability[];
  };
  const parsed: Row[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const value = raw as Record<string, unknown>;
    const id = typeof value.value === "string" ? value.value.trim() : "";
    if (!id || id.length > 100 || parsed.some((row) => row.id === id)) continue;
    const label = typeof value.displayName === "string" ? value.displayName.trim() : "";
    const efforts = Array.isArray(value.supportedEffortLevels)
      ? value.supportedEffortLevels
        .flatMap((level) => typeof level === "string" && level.trim() ? [effort(level.trim())] : [])
        .slice(0, MAX_EFFORTS)
      : [];
    parsed.push({
      id,
      label: label || id,
      resolvedModel: typeof value.resolvedModel === "string" && value.resolvedModel.trim()
        ? value.resolvedModel.trim()
        : null,
      efforts,
    });
  }
  const defaultRow = parsed.find((row) => row.id === "default");
  const defaultIndex = defaultRow?.resolvedModel
    ? parsed.findIndex((row) => row !== defaultRow && row.resolvedModel === defaultRow.resolvedModel)
    : -1;
  const models = parsed
    .filter((row) => row !== defaultRow)
    .slice(0, MAX_MODELS)
    .map((row) => ({
      id: row.id,
      label: row.label,
      isDefault: defaultIndex >= 0 && row === parsed[defaultIndex],
      defaultEffortId: null,
      efforts: row.efforts,
    }));
  return {
    models,
    defaultEfforts: defaultRow?.efforts ?? models.find((model) => model.isDefault)?.efforts ?? [],
  };
}

const CLAUDE_INITIALIZE_REQUEST_ID = "briar-provider-models";

/**
 * Ask Claude Code for its model picker over the stream-json protocol. Only the
 * `initialize` control request is sent, so no turn runs and no tokens are
 * spent. User settings stay unloaded so SessionStart hooks do not fire for a
 * capability probe, and no MCP server is started; the login keychain is still
 * read, so the list reflects the signed-in account.
 */
export function claudeModels(
  binary: string,
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<ClaudeModelDiscovery> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [
      "--print",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--setting-sources",
      "",
      "--strict-mcp-config",
    ], { cwd: home, env, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Claude initialize timed out")), 15_000);
    const finish = (outcome: Error | ClaudeModelDiscovery) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    };
    child.stdin.on("error", () => {});
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", finish);
    child.on("close", (code) => {
      finish(new Error(stderr.trim() || `Claude CLI exited (${code}) before answering initialize`));
    });
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: { type?: unknown; response?: unknown };
        try { message = JSON.parse(line); } catch { continue; }
        if (message.type !== "control_response" || !message.response || typeof message.response !== "object") continue;
        const envelope = message.response as { subtype?: unknown; request_id?: unknown; error?: unknown; response?: unknown };
        if (envelope.request_id !== CLAUDE_INITIALIZE_REQUEST_ID) continue;
        if (envelope.subtype !== "success") {
          finish(new Error(typeof envelope.error === "string" ? envelope.error : "Claude initialize failed"));
          return;
        }
        const discovered = parseClaudeInitializeModels(envelope.response);
        finish(discovered.models.length > 0 ? discovered : new Error("Claude initialize returned no models"));
        return;
      }
    });
    child.stdin.write(`${JSON.stringify({
      type: "control_request",
      request_id: CLAUDE_INITIALIZE_REQUEST_ID,
      request: { subtype: "initialize" },
    })}\n`);
  });
}

/**
 * One `opencode models --verbose` entry: the capability Briar reports, plus the
 * few descriptor fields model selection needs. `sdkPackage` is the npm package
 * OpenCode drives the model through and `toolCall` is its advertised tool
 * calling support; both come straight from OpenCode's own record.
 */
type OpenCodeModelRecord = {
  model: AgentModelCapability;
  sdkPackage: string;
  toolCall: boolean;
};

export function parseOpenCodeVerboseRecords(
  output: string,
): OpenCodeModelRecord[] {
  const lines = output.split(/\r?\n/u);
  const records: OpenCodeModelRecord[] = [];
  for (let index = 0; index < lines.length && records.length < MAX_MODELS; index += 1) {
    const id = lines[index]!.trim();
    if (!id || /\s/u.test(id) || lines[index + 1]?.trim() !== "{") continue;
    const jsonLines: string[] = [];
    index += 1;
    for (; index < lines.length; index += 1) {
      jsonLines.push(lines[index]!);
      if (lines[index] === "}") break;
    }
    try {
      const value = JSON.parse(jsonLines.join("\n")) as {
        name?: unknown;
        variants?: unknown;
        api?: unknown;
        capabilities?: unknown;
      };
      const variants = value.variants && typeof value.variants === "object" && !Array.isArray(value.variants)
        ? Object.keys(value.variants).slice(0, MAX_EFFORTS).map((id) => effort(id))
        : [];
      const api = value.api && typeof value.api === "object" && !Array.isArray(value.api)
        ? (value.api as Record<string, unknown>)
        : {};
      const capabilities =
        value.capabilities && typeof value.capabilities === "object" &&
          !Array.isArray(value.capabilities)
          ? (value.capabilities as Record<string, unknown>)
          : {};
      records.push({
        model: {
          id,
          label: typeof value.name === "string" ? value.name : id,
          isDefault: false,
          defaultEffortId: null,
          efforts: variants,
        },
        sdkPackage: typeof api.npm === "string" ? api.npm : "",
        toolCall: capabilities.toolcall === true,
      });
    } catch {
      // Skip one malformed provider record without discarding other models.
    }
  }
  return records;
}

export function parseOpenCodeVerbose(output: string): AgentModelCapability[] {
  return parseOpenCodeVerboseRecords(output).map((record) => record.model);
}

/**
 * Models an OpenCode upstream offers that Briar can run a coding turn on.
 *
 * OpenCode lists everything the upstream publishes under one provider id. For
 * Vertex AI that includes speech, image and embedding models, and partner
 * models resold through an OpenAI-compatible endpoint. Selection reads
 * OpenCode's own record rather than matching on model names: a model qualifies
 * when the upstream serves it through its own AI SDK package and it advertises
 * tool calling, which is what an agent turn needs.
 *
 * The upstream's primary package sorts before its sub-packages, so Vertex AI's
 * Gemini models lead and Claude-on-Vertex follows. OpenCode's own order is
 * kept within each group.
 */
export function selectOpenCodeUpstreamModels(
  output: string,
  upstream: OpenCodeUpstreamDescriptor,
): AgentModelCapability[] {
  const prefix = openCodeUpstreamModelPrefix(upstream);
  const records = parseOpenCodeVerboseRecords(output)
    .filter((record) => record.model.id.startsWith(prefix));
  if (upstream.modelSelection === "all") {
    return records.map((record) => record.model);
  }
  // OpenCode names an upstream's own AI SDK after its provider id, and drives
  // that upstream's sub-families through sub-packages of it.
  const sdkPackage = `@ai-sdk/${upstream.openCodeProviderId}`;
  return records
    .filter((record) =>
      record.toolCall &&
      (record.sdkPackage === sdkPackage ||
        record.sdkPackage.startsWith(`${sdkPackage}/`)) &&
      // Vertex AI resells partner models under its own provider id, and marks
      // them "Model as a Service". Some are served through the upstream's own
      // SDK package and advertise tool calling, so the documented `-maas`
      // suffix is the only thing that tells them apart. They bill and gate
      // separately from the upstream's own models, so Briar leaves them out.
      !record.model.id.endsWith("-maas")
    )
    .map((record, index) => ({
      record,
      index,
      primary: record.sdkPackage === sdkPackage ? 0 : 1,
    }))
    .sort((left, right) =>
      left.primary - right.primary || left.index - right.index
    )
    .map(({ record }) => record.model);
}

const normalizedCursorEffort = (value: string) => {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  return normalized === "extra-high" || normalized === "extra high"
    ? "xhigh"
    : normalized;
};

export function parseCursorAvailableModelsResponse(
  response: unknown,
): AgentModelCapability[] {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return [];
  }
  const rawModels = (response as Record<string, unknown>).models;
  if (!Array.isArray(rawModels)) return [];
  const seen = new Set<string>();
  return rawModels.flatMap((rawModel) => {
    if (!rawModel || typeof rawModel !== "object" || Array.isArray(rawModel)) {
      return [];
    }
    const model = rawModel as Record<string, unknown>;
    const id = typeof model.value === "string" ? model.value.trim() : "";
    if (!id || id.length > 100 || seen.has(id)) return [];
    seen.add(id);
    const configOptions = Array.isArray(model.configOptions)
      ? model.configOptions
      : [];
    const reasoning = configOptions.find((rawOption) => {
      if (!rawOption || typeof rawOption !== "object" || Array.isArray(rawOption)) {
        return false;
      }
      const option = rawOption as Record<string, unknown>;
      const optionId = typeof option.id === "string" ? option.id.toLowerCase() : "";
      const name = typeof option.name === "string" ? option.name.toLowerCase() : "";
      return optionId.includes("effort") || optionId.includes("reasoning") ||
        name.includes("effort") || name.includes("reasoning");
    }) as Record<string, unknown> | undefined;
    const selections = Array.isArray(reasoning?.options)
      ? reasoning.options.flatMap((rawOption) => {
          if (!rawOption || typeof rawOption !== "object" || Array.isArray(rawOption)) {
            return [];
          }
          const option = rawOption as Record<string, unknown>;
          return Array.isArray(option.options) ? option.options : [option];
        })
      : [];
    const current = typeof reasoning?.currentValue === "string"
      ? normalizedCursorEffort(reasoning.currentValue)
      : null;
    const efforts = selections.flatMap((rawSelection) => {
      if (
        !rawSelection || typeof rawSelection !== "object" ||
        Array.isArray(rawSelection)
      ) return [];
      const selection = rawSelection as Record<string, unknown>;
      const value = typeof selection.value === "string"
        ? selection.value.trim()
        : "";
      const effortId = normalizedCursorEffort(value);
      if (!effortId || effortId.length > 50) return [];
      return [effort(effortId, {
        label: typeof selection.name === "string"
          ? selection.name.trim() || effortId
          : effortId,
        isDefault: current === effortId,
      })];
    }).slice(0, MAX_EFFORTS);
    return [{
      id,
      label: typeof model.name === "string" ? model.name.trim() || id : id,
      isDefault: false,
      defaultEffortId: efforts.find((candidate) => candidate.isDefault)?.id ?? null,
      efforts,
    }];
  }).slice(0, MAX_MODELS);
}

export async function cursorModels(
  binary: string,
  isAuthenticated: (binary: string) => Promise<boolean> = cursorAuthenticated,
): Promise<AgentModelCapability[]> {
  // Capability discovery must never turn into an interactive login flow.
  if (!(await isAuthenticated(binary))) {
    throw new Error("Cursor CLI is not authenticated");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["acp"], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    let buffer = "";
    let stderr = "";
    const finish = (error?: Error, models: AgentModelCapability[] = []) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(models);
    };
    const timer = setTimeout(
      () => finish(new Error("Cursor model discovery timed out")),
      15_000,
    );
    const send = (value: Record<string, unknown>) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`);
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-8_000);
    });
    child.on("error", finish);
    child.on("exit", (code) => {
      if (!settled) {
        finish(new Error(stderr.trim() || `Cursor ACP exited (${code})`));
      }
    });
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        let message: {
          id?: unknown;
          result?: unknown;
          error?: { message?: unknown };
        };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.error) {
          finish(new Error(
            typeof message.error.message === "string"
              ? message.error.message
              : "Cursor ACP request failed",
          ));
          continue;
        }
        if (message.id === 1) {
          send({ id: 2, method: "authenticate", params: { methodId: "cursor_login" } });
          continue;
        }
        if (message.id === 2) {
          send({ id: 3, method: "cursor/list_available_models", params: {} });
          continue;
        }
        if (message.id === 3) {
          finish(undefined, parseCursorAvailableModelsResponse(message.result));
        }
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: { _meta: { parameterizedModelPicker: true } },
        clientInfo: { name: "briar-worker", version: "1" },
      },
    });
  });
}

/**
 * Pi's models come from the same `session/new` response `pi-acp` builds for a
 * turn, so the catalog cannot drift from what the runner can actually select.
 * The adapter needs a real working directory to open a session, and it reads
 * pi's own credential store, so discovery runs in a throwaway directory and
 * never prompts.
 */
export type PiSessionCapabilities = {
  models: AgentModelCapability[];
  defaultEfforts: AgentEffortCapability[];
};

export function parsePiSessionModels(result: unknown): PiSessionCapabilities {
  const setup = result as {
    models?: { availableModels?: unknown; currentModelId?: unknown };
    configOptions?: Array<
      { id?: unknown; options?: Array<{ value?: unknown; name?: unknown }> }
    >;
  } | null;
  const currentModelId = typeof setup?.models?.currentModelId === "string"
    ? setup.models.currentModelId
    : null;
  const advertised = Array.isArray(setup?.models?.availableModels)
    ? setup.models.availableModels
    : [];
  const models = advertised
    .flatMap((entry) => {
      const model = entry as { modelId?: unknown; name?: unknown };
      const id = typeof model.modelId === "string" ? model.modelId.trim() : "";
      if (!id) return [];
      const label = typeof model.name === "string" && model.name.trim()
        ? model.name.trim()
        : id;
      return [{ id, label, isDefault: id === currentModelId }];
    })
    .slice(0, MAX_MODELS);
  const thoughtLevel = (setup?.configOptions ?? []).find(
    (option) => option.id === "thought_level",
  );
  const defaultEfforts = (thoughtLevel?.options ?? [])
    .flatMap((option) => {
      const id = typeof option.value === "string" ? option.value.trim() : "";
      if (!id) return [];
      return [effort(id, {
        label: typeof option.name === "string" && option.name.trim()
          ? option.name.trim()
          : id,
      })];
    })
    .slice(0, MAX_EFFORTS);
  return { models, defaultEfforts };
}

export async function piModels(
  binary: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PiSessionCapabilities> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], {
      cwd,
      env: { ...env, PI_TELEMETRY: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    let buffer = "";
    let stderr = "";
    const finish = (
      error?: Error,
      value: PiSessionCapabilities = { models: [], defaultEfforts: [] },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error("Pi model discovery timed out")),
      15_000,
    );
    const send = (value: Record<string, unknown>) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`);
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-8_000);
    });
    child.on("error", finish);
    child.on("exit", (code) => {
      if (!settled) {
        finish(new Error(stderr.trim() || `pi-acp exited (${code})`));
      }
    });
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        let message: {
          id?: unknown;
          result?: unknown;
          error?: { message?: unknown };
        };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.error) {
          // A signed-out pi reports "authentication required" here rather
          // than an empty catalog; surface it as the discovery error.
          finish(new Error(
            typeof message.error.message === "string"
              ? message.error.message
              : "pi-acp request failed",
          ));
          continue;
        }
        if (message.id === 1) {
          send({ id: 2, method: "session/new", params: { cwd, mcpServers: [] } });
          continue;
        }
        if (message.id === 2) {
          finish(undefined, parsePiSessionModels(message.result));
        }
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        clientInfo: { name: "briar-worker", version: "1" },
      },
    });
  });
}

async function codexModels(binary: string): Promise<AgentModelCapability[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["app-server"], { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    const models: AgentModelCapability[] = [];
    const timer = setTimeout(() => finish(new Error("Codex model/list timed out")), 15_000);
    const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(models.slice(0, MAX_MODELS));
    };
    const requestPage = (cursor?: string) => send({ method: "model/list", id: 2, params: cursor ? { cursor } : {} });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", finish);
    child.on("exit", (code) => {
      if (models.length === 0) finish(new Error(stderr.trim() || `Codex app-server exited (${code})`));
    });
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: { id?: unknown; result?: unknown };
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) {
          send({ method: "initialized", params: {} });
          requestPage();
          continue;
        }
        if (message.id !== 2 || !message.result || typeof message.result !== "object") continue;
        const result = message.result as { data?: unknown; nextCursor?: unknown };
        if (Array.isArray(result.data)) {
          for (const raw of result.data) {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
            const value = raw as Record<string, unknown>;
            const id = typeof value.model === "string" ? value.model : null;
            if (!id) continue;
            const defaultEffortId = typeof value.defaultReasoningEffort === "string" ? value.defaultReasoningEffort : null;
            const efforts = Array.isArray(value.supportedReasoningEfforts)
              ? value.supportedReasoningEfforts.flatMap((rawEffort) => {
                  if (!rawEffort || typeof rawEffort !== "object" || Array.isArray(rawEffort)) return [];
                  const item = rawEffort as Record<string, unknown>;
                  const effortId = typeof item.reasoningEffort === "string" ? item.reasoningEffort : null;
                  return effortId ? [effort(effortId, {
                    description: typeof item.description === "string" ? item.description : null,
                    isDefault: effortId === defaultEffortId,
                  })] : [];
                }).slice(0, MAX_EFFORTS)
              : [];
            models.push({
              id,
              label: typeof value.displayName === "string" ? value.displayName : id,
              isDefault: value.isDefault === true,
              defaultEffortId,
              efforts,
            });
          }
        }
        if (typeof result.nextCursor === "string" && result.nextCursor) requestPage(result.nextCursor);
        else finish();
      }
    });
    send({ method: "initialize", id: 1, params: { clientInfo: { name: "briar-worker", title: "Briar Worker", version: "1" } } });
  });
}

let cached: {
  expiresAt: number;
  key: string;
  value: AgentProviderCapabilityCatalog;
} | null = null;

export type ProviderCapabilityOptions = {
  refresh?: boolean;
  home?: string;
  which?: (provider: AgentProvider) => string | null;
  /**
   * Provider execution environment. Throwing records the reason on the
   * provider entry, which is how a missing OpenRouter API key is reported.
   */
  environment?: (provider: AgentProvider) => NodeJS.ProcessEnv;
};

export async function discoverWorkerProviderCapabilities(
  enabled: Record<AgentProvider, boolean>,
  {
    refresh = false,
    home = homedir(),
    which = (provider) => Bun.which(agentProviderBinaryName(provider)),
    environment = () => process.env,
  }: ProviderCapabilityOptions = {},
): Promise<AgentProviderCapabilityCatalog> {
  const cacheKey = JSON.stringify({ enabled, home });
  if (
    !refresh &&
    cached?.key === cacheKey &&
    cached.expiresAt > Date.now()
  ) return cached.value;
  const catalog = emptyAgentProviderCapabilityCatalog();
  await Promise.all(agentProviders.map(async (provider) => {
    const binary = which(provider);
    if (!enabled[provider] || !binary) {
      catalog[provider].error = enabled[provider]
        ? providerMissingBinaryMessage[provider]
        : `${provider} is disabled`;
      return;
    }
    try {
      const env = environment(provider);
      if (provider === "codex") catalog.codex.models = await codexModels(binary);
      if (provider === "cursor") catalog.cursor.models = await cursorModels(binary);
      if (provider === "pi") {
        const discovered = await piModels(binary, home, env);
        catalog.pi.models = discovered.models;
        catalog.pi.defaultEfforts = discovered.defaultEfforts;
      }
      if (provider === "grok") catalog.grok.models = await grokModels(binary, home, env);
      if (provider === "agy") {
        const agyEnv = withoutGoogleCredentials(env);
        catalog.agy.models = parseAgyModels(
          commandWithEnv(binary, ["--output-format", "json", "models"], agyEnv),
        );
        catalog.agy.defaultEfforts = parseAgyEfforts(helpOutput(binary, env));
      }
      if (provider === "opencode") {
        catalog.opencode.models = openCodeModels(binary, home, env, catalog);
      }
      const upstream = openCodeUpstreamOf(provider);
      if (upstream) {
        // An upstream is an OpenCode provider, so its catalog is OpenCode's
        // list narrowed to what this upstream can run a coding turn on.
        catalog[provider].models = selectOpenCodeUpstreamModels(
          commandWithEnv(binary, ["models", "--verbose"], env),
          upstream,
        );
      }
      if (provider === "claude") {
        try {
          const discovered = await claudeModels(binary, home, env);
          catalog.claude.models = discovered.models;
          catalog.claude.defaultEfforts = discovered.defaultEfforts;
        } catch (error) {
          // A CLI without the stream-json picker still quotes its aliases in
          // --help. Report the fallback so the app can say the list is stale.
          const help = helpOutput(binary, env);
          catalog.claude.models = parseClaudeModels(help);
          catalog.claude.defaultEfforts = parseClaudeEfforts(help);
          catalog.claude.error = error instanceof Error ? error.message : String(error);
        }
      }
    } catch (error) {
      catalog[provider].error = error instanceof Error ? error.message : String(error);
    }
  }));
  cached = { expiresAt: Date.now() + CACHE_MS, key: cacheKey, value: catalog };
  return catalog;
}

/**
 * OpenCode only lists models while its model server is reachable. Its own
 * on-disk catalog keeps the free models selectable meanwhile.
 */
function openCodeModels(
  binary: string,
  home: string,
  env: NodeJS.ProcessEnv,
  catalog: AgentProviderCapabilityCatalog,
): AgentModelCapability[] {
  try {
    return parseOpenCodeVerbose(
      commandWithEnv(binary, ["models", "--verbose"], env),
    );
  } catch (error) {
    const cachedModels = openCodeCachedModels(home);
    if (cachedModels.length === 0) throw error;
    catalog.opencode.error = error instanceof Error
      ? error.message
      : String(error);
    return cachedModels;
  }
}

export function parseOpenCodeCachedModels(
  contents: string,
): AgentModelCapability[] {
  let models: unknown;
  try {
    models = (JSON.parse(contents) as { opencode?: { models?: unknown } })
      ?.opencode?.models;
  } catch {
    return [];
  }
  if (!models || typeof models !== "object" || Array.isArray(models)) return [];
  return Object.entries(models as Record<string, unknown>)
    .flatMap(([key, raw]) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const value = raw as Record<string, unknown>;
      if (typeof value.status === "string" && value.status !== "active") {
        return [];
      }
      const cost = value.cost;
      if (!cost || typeof cost !== "object" || Array.isArray(cost)) return [];
      const { input, output } = cost as Record<string, unknown>;
      if (input !== 0 || output !== 0) return [];
      const id = (typeof value.id === "string" ? value.id : key).trim();
      if (!id || id.length > 200 || /\s/u.test(id)) return [];
      const efforts: AgentEffortCapability[] = [];
      const options = Array.isArray(value.reasoning_options)
        ? value.reasoning_options
        : [];
      for (const rawOption of options) {
        if (efforts.length >= MAX_EFFORTS) break;
        if (!rawOption || typeof rawOption !== "object") continue;
        const option = rawOption as Record<string, unknown>;
        if (option.type !== "effort" || !Array.isArray(option.values)) continue;
        for (const candidate of option.values) {
          if (efforts.length >= MAX_EFFORTS) break;
          if (
            typeof candidate !== "string" || !candidate ||
            candidate.length > 50 ||
            efforts.some((existing) => existing.id === candidate)
          ) continue;
          efforts.push(effort(candidate));
        }
      }
      return [{
        id: `opencode/${id}`,
        label: typeof value.name === "string" ? value.name : id,
        isDefault: false,
        defaultEffortId: null,
        efforts,
      }];
    })
    .sort((left, right) =>
      left.label.localeCompare(right.label) || left.id.localeCompare(right.id)
    )
    .slice(0, MAX_MODELS);
}

function openCodeCachedModels(home: string): AgentModelCapability[] {
  const cacheRoot = process.env.XDG_CACHE_HOME?.trim() || join(home, ".cache");
  try {
    return parseOpenCodeCachedModels(
      readFileSync(join(cacheRoot, "opencode", "models.json"), "utf8"),
    );
  } catch {
    return [];
  }
}
