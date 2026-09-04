import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cursorModels,
  discoverWorkerProviderCapabilities,
  parseAgyEfforts,
  parseAgyModels,
  parseClaudeEfforts,
  parseClaudeModels,
  parseCursorAvailableModelsResponse,
  parseGrokModelList,
  parseOpenCodeVerbose,
} from "./provider-capabilities";

describe("worker provider capabilities", () => {
  it("does not start Cursor ACP when the CLI is not authenticated", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-cursor-capabilities-"));
    const binary = join(directory, "cursor-agent");
    const marker = join(directory, "acp-started");
    try {
      await writeFile(
        binary,
        `#!/bin/sh\nprintf spawned > ${JSON.stringify(marker)}\n`,
        { mode: 0o755 },
      );

      await expect(cursorModels(binary, async () => false)).rejects.toThrow(
        "Cursor CLI is not authenticated",
      );
      await expect(readFile(marker, "utf8")).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reads Cursor models and reasoning options from the ACP extension", () => {
    expect(parseCursorAvailableModelsResponse({
      models: [{
        value: "composer-2",
        name: "Composer 2",
        configOptions: [{
          id: "reasoning",
          name: "Reasoning Effort",
          currentValue: "extra-high",
          options: [
            { value: "medium", name: "Medium" },
            { value: "extra-high", name: "Extra High" },
          ],
        }],
      }],
    })).toEqual([{
      id: "composer-2",
      label: "Composer 2",
      isDefault: false,
      defaultEffortId: "xhigh",
      efforts: [
        { id: "medium", label: "Medium", isDefault: false },
        { id: "xhigh", label: "Extra High", isDefault: true },
      ],
    }]);
  });

  it("parses both default and non-default Grok model markers", () => {
    expect(parseGrokModelList(`Default model: grok-4.6
Available models:
  * grok-4.6 (default)
  - grok-4.5
`)).toEqual([
      { id: "grok-4.6", isDefault: true },
      { id: "grok-4.5", isDefault: false },
    ]);
  });

  it("reads Claude efforts from the installed CLI help", () => {
    expect(parseClaudeEfforts("--effort <level>  effort (low, medium, high, xhigh, max)"))
      .toEqual([
        { id: "low", label: "low" },
        { id: "medium", label: "medium" },
        { id: "high", label: "high" },
        { id: "xhigh", label: "xhigh" },
        { id: "max", label: "max" },
      ]);
  });

  it("reads Antigravity models from the nested JSON command payload", () => {
    expect(parseAgyModels(JSON.stringify({
      status: "SUCCESS",
      command: {
        name: "models",
        data: {
          models: [
            { id: "gemini-3.7-flash-high", label: "Gemini 3.7 Flash (High)" },
            { model_id: "gemini-3.7-flash-low", display_name: "Gemini 3.7 Flash (Low)" },
            { modelId: "gemini-3.7-flash-high", name: "duplicate" },
          ],
        },
      },
    }))).toEqual([
      {
        id: "gemini-3.7-flash-high",
        label: "Gemini 3.7 Flash (High)",
        isDefault: false,
        defaultEffortId: null,
        efforts: [],
      },
      {
        id: "gemini-3.7-flash-low",
        label: "Gemini 3.7 Flash (Low)",
        isDefault: false,
        defaultEffortId: null,
        efforts: [],
      },
    ]);
  });

  it("reads pipe-delimited Antigravity efforts from CLI help", () => {
    expect(parseAgyEfforts("--effort <level>  effort (low|medium|high)"))
      .toEqual([
        { id: "low", label: "low" },
        { id: "medium", label: "medium" },
        { id: "high", label: "high" },
      ]);
  });

  it("advertises Antigravity models in Worker capabilities", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-agy-capabilities-"));
    const binary = join(directory, "agy");
    try {
      await writeFile(
        binary,
        `#!/bin/sh
if [ "$1" = "--output-format" ]; then
  printf '%s' '{"command":{"name":"models","data":{"models":[{"id":"gemini-3.7-flash-high","label":"Gemini 3.7 Flash (High)"}]}}}'
elif [ "$1" = "--help" ]; then
  printf '%s' '--effort <level>  effort (low|medium|high)'
else
  exit 2
fi
`,
        { mode: 0o755 },
      );

      const catalog = await discoverWorkerProviderCapabilities({
        codex: false,
        claude: false,
        cursor: false,
        grok: false,
        agy: true,
        opencode: false,
        openrouter: false,
      }, {
        refresh: true,
        home: directory,
        which: (provider) => provider === "agy" ? binary : null,
      });

      expect(catalog.agy).toEqual({
        models: [{
          id: "gemini-3.7-flash-high",
          label: "Gemini 3.7 Flash (High)",
          isDefault: false,
          defaultEffortId: null,
          efforts: [],
        }],
        defaultEfforts: [
          { id: "low", label: "low" },
          { id: "medium", label: "medium" },
          { id: "high", label: "high" },
        ],
        allowCustomModels: false,
        error: null,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reads Claude model aliases from the installed CLI help", () => {
    expect(parseClaudeModels(`  --model <model>  Provide an alias (e.g.
                        'fable', 'opus', or 'sonnet') or a
                        model's full name (e.g. 'claude-fable-5').
  --name <name>         Session name
`)).toEqual([
      { id: "fable", label: "fable", isDefault: false, defaultEffortId: null, efforts: [] },
      { id: "opus", label: "opus", isDefault: false, defaultEffortId: null, efforts: [] },
      { id: "sonnet", label: "sonnet", isDefault: false, defaultEffortId: null, efforts: [] },
      { id: "claude-fable-5", label: "claude-fable-5", isDefault: false, defaultEffortId: null, efforts: [] },
    ]);
  });

  it("reads OpenCode model-specific variants", () => {
    const models = parseOpenCodeVerbose(`openai/gpt-next
{
  "name": "GPT Next",
  "variants": {
    "low": {},
    "max": {}
  }
}
`);
    expect(models).toEqual([{
      id: "openai/gpt-next",
      label: "GPT Next",
      isDefault: false,
      defaultEffortId: null,
      efforts: [
        { id: "low", label: "low" },
        { id: "max", label: "max" },
      ],
    }]);
  });

  it("advertises only OpenRouter models for the OpenRouter provider", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-openrouter-capabilities-"));
    const binary = join(directory, "opencode");
    try {
      await writeFile(binary, `#!/bin/sh
printf '%s' 'openrouter/anthropic/claude-sonnet-4
{
  "name": "Claude Sonnet 4",
  "variants": {}
}
openai/gpt-5
{
  "name": "GPT-5",
  "variants": {}
}
'
`, { mode: 0o755 });
      const catalog = await discoverWorkerProviderCapabilities({
        codex: false,
        claude: false,
        cursor: false,
        grok: false,
        agy: false,
        opencode: false,
        openrouter: true,
      }, {
        refresh: true,
        home: directory,
        which: (provider) => provider === "openrouter" ? binary : null,
      });
      expect(catalog.openrouter.models.map((model) => model.id)).toEqual([
        "openrouter/anthropic/claude-sonnet-4",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("desktop provider model catalog", () => {
  const onlyOpencode = {
    codex: false,
    claude: false,
    cursor: false,
    grok: false,
    agy: false,
    opencode: true,
    openrouter: false,
  };

  it("falls back to the active free OpenCode models from the local cache", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-opencode-cache-"));
    const binary = join(directory, "opencode");
    try {
      await writeFile(
        binary,
        "#!/bin/sh\necho 'catalog offline' >&2\nexit 1\n",
        { mode: 0o755 },
      );
      await mkdir(join(directory, ".cache", "opencode"), { recursive: true });
      await writeFile(
        join(directory, ".cache", "opencode", "models.json"),
        JSON.stringify({
          opencode: {
            models: {
              "free-model": {
                id: "free-model",
                name: "Free model",
                cost: { input: 0, output: 0 },
                reasoning_options: [{ type: "effort", values: ["low", "high"] }],
              },
              "paid-model": {
                name: "Paid model",
                cost: { input: 1, output: 2 },
              },
              "retired-model": {
                name: "Retired model",
                status: "deprecated",
                cost: { input: 0, output: 0 },
              },
            },
          },
        }),
      );

      const catalog = await discoverWorkerProviderCapabilities(onlyOpencode, {
        refresh: true,
        home: directory,
        which: (provider) => (provider === "opencode" ? binary : null),
      });

      expect(catalog.opencode.error).toContain("catalog offline");
      expect(catalog.opencode.models.map((model) => model.id)).toEqual([
        "opencode/free-model",
      ]);
      expect(catalog.opencode.models[0]?.label).toBe("Free model");
      expect(catalog.opencode.models[0]?.efforts?.map((effort) => effort.id))
        .toEqual(["low", "high"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("discovers OpenRouter models with the configured environment", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-openrouter-env-"));
    const binary = join(directory, "opencode");
    try {
      await writeFile(
        binary,
        `#!/bin/sh
if [ "$OPENROUTER_API_KEY" != "sk-or-v1-discovery-test-key" ]; then
  exit 11
fi
case "$OPENCODE_CONFIG_CONTENT" in
  *openrouter*) ;;
  *) exit 12 ;;
esac
printf '%s\\n' 'openrouter/test-model' '{' '  "name": "Test model"' '}'
`,
        { mode: 0o755 },
      );
      const catalog = await discoverWorkerProviderCapabilities({
        ...onlyOpencode,
        opencode: false,
        openrouter: true,
      }, {
        refresh: true,
        home: directory,
        which: (provider) => (provider === "openrouter" ? binary : null),
        environment: () => ({
          ...process.env,
          OPENROUTER_API_KEY: "sk-or-v1-discovery-test-key",
          OPENCODE_CONFIG_CONTENT: '{"provider":{"openrouter":{}}}',
        }),
      });
      expect(catalog.openrouter.models.map((model) => model.id)).toEqual([
        "openrouter/test-model",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports a missing provider CLI with the app's own copy", async () => {
    const catalog = await discoverWorkerProviderCapabilities(onlyOpencode, {
      refresh: true,
      home: "/nonexistent",
      which: () => null,
    });
    expect(catalog.opencode.error).toContain("OpenCode CLI가 필요합니다");
    expect(catalog.codex.error).toBe("codex is disabled");
  });
});
