import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  agentProviderBinaryName,
  agentProviders,
  emptyAgentProviderCapabilityCatalog,
  type AgentEffortCapability,
  type AgentModelCapability,
  type AgentProvider,
  type AgentProviderCapabilityCatalog,
} from "../src/lib/agent-provider-contract";
import { cursorAuthenticated } from "./provider-health";

const MAX_MODELS = 500;
const MAX_EFFORTS = 20;
const CACHE_MS = 5 * 60_000;

const effort = (
  id: string,
  input: Partial<AgentEffortCapability> = {},
): AgentEffortCapability => ({ id, label: input.label ?? id, ...input });

const command = (binary: string, args: string[]) => {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    env: process.env,
    timeout: 15_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw result.error ?? new Error(result.stderr.trim() || `${binary} ${args.join(" ")} failed`);
  }
  return result.stdout;
};

export function parseGrokModelList(output: string) {
  return output.split(/\r?\n/u).flatMap((line) => {
    const match = line.trim().match(/^[*-]\s+(.+?)(?:\s+\(default\))?$/u);
    if (!match) return [];
    return [{ id: match[1]!, isDefault: /\(default\)\s*$/u.test(line) }];
  });
}

async function grokModels(binary: string, home: string): Promise<AgentModelCapability[]> {
  const listed = parseGrokModelList(command(binary, ["models"]));
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

export function parseClaudeEfforts(output: string) {
  const line = output.split(/\r?\n/u).find((candidate) => candidate.includes("--effort"));
  const values = line?.match(/\(([^)]+)\)/u)?.[1];
  return values
    ? values.split(",").map((value) => value.trim()).filter(Boolean).slice(0, MAX_EFFORTS).map((id) => effort(id))
    : [];
}

export function parseClaudeModels(output: string): AgentModelCapability[] {
  const lines = output.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.includes("--model <model>"));
  if (start < 0) return [];
  const block: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    if (index > start && /^\s{2}-\S/u.test(lines[index]!)) break;
    block.push(lines[index]!);
  }
  return [...block.join(" ").matchAll(/(?<![a-z0-9])'([a-z0-9][a-z0-9._/-]*)'/giu)]
    .map((match) => match[1]!)
    .filter((id, index, values) =>
      id.length <= 100 &&
      values.indexOf(id) === index
    )
    .slice(0, MAX_MODELS)
    .map((id) => ({ id, label: id, isDefault: false, defaultEffortId: null, efforts: [] }));
}

export function parseOpenCodeVerbose(output: string): AgentModelCapability[] {
  const lines = output.split(/\r?\n/u);
  const models: AgentModelCapability[] = [];
  for (let index = 0; index < lines.length && models.length < MAX_MODELS; index += 1) {
    const id = lines[index]!.trim();
    if (!id || /\s/u.test(id) || lines[index + 1]?.trim() !== "{") continue;
    const jsonLines: string[] = [];
    index += 1;
    for (; index < lines.length; index += 1) {
      jsonLines.push(lines[index]!);
      if (lines[index] === "}") break;
    }
    try {
      const value = JSON.parse(jsonLines.join("\n")) as { name?: unknown; variants?: unknown };
      const variants = value.variants && typeof value.variants === "object" && !Array.isArray(value.variants)
        ? Object.keys(value.variants).slice(0, MAX_EFFORTS).map((id) => effort(id))
        : [];
      models.push({
        id,
        label: typeof value.name === "string" ? value.name : id,
        isDefault: false,
        defaultEffortId: null,
        efforts: variants,
      });
    } catch {
      // Skip one malformed provider record without discarding other models.
    }
  }
  return models;
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

export async function discoverWorkerProviderCapabilities(
  enabled: Record<AgentProvider, boolean>,
  { refresh = false, home = homedir() }: { refresh?: boolean; home?: string } = {},
): Promise<AgentProviderCapabilityCatalog> {
  const cacheKey = JSON.stringify({ enabled, home });
  if (
    !refresh &&
    cached?.key === cacheKey &&
    cached.expiresAt > Date.now()
  ) return cached.value;
  const catalog = emptyAgentProviderCapabilityCatalog();
  await Promise.all(agentProviders.map(async (provider) => {
    const binary = Bun.which(agentProviderBinaryName(provider));
    if (!enabled[provider] || !binary) {
      catalog[provider].error = enabled[provider] ? `${provider} is not installed` : `${provider} is disabled`;
      return;
    }
    try {
      if (provider === "codex") catalog.codex.models = await codexModels(binary);
      if (provider === "cursor") catalog.cursor.models = await cursorModels(binary);
      if (provider === "grok") catalog.grok.models = await grokModels(binary, home);
      if (provider === "opencode") catalog.opencode.models = parseOpenCodeVerbose(command(binary, ["models", "--verbose"]));
      if (provider === "claude") {
        const help = command(binary, ["--help"]);
        catalog.claude.models = parseClaudeModels(help);
        catalog.claude.defaultEfforts = parseClaudeEfforts(help);
      }
    } catch (error) {
      catalog[provider].error = error instanceof Error ? error.message : String(error);
    }
  }));
  cached = { expiresAt: Date.now() + CACHE_MS, key: cacheKey, value: catalog };
  return catalog;
}
