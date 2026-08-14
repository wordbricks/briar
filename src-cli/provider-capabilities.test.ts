import { describe, expect, it } from "vitest";
import {
  parseClaudeEfforts,
  parseClaudeModels,
  parseGrokModelList,
  parseOpenCodeVerbose,
} from "./provider-capabilities";

describe("worker provider capabilities", () => {
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
});
