import { describe, expect, it } from "vitest";
import {
  defaultProjectAgentCopy,
  normalizeProjectAgentLocale,
} from "./project-agent";

describe("default project agent copy", () => {
  it("uses the requested Korean responsibility", () => {
    expect(defaultProjectAgentCopy("ko")).toEqual({
      name: "자동 사냥 에이전트",
      responsibility: "모든 대기중인 이슈에 대해서 자동사냥을 수행하는것",
    });
  });

  it("localizes English and Chinese project agents", () => {
    expect(defaultProjectAgentCopy("en")).toEqual({
      name: "Auto Hunt agent",
      responsibility: "Perform Auto Hunt for every queued issue.",
    });
    expect(defaultProjectAgentCopy("zh")).toEqual({
      name: "自动狩猎智能体",
      responsibility: "对所有排队中的问题执行自动狩猎。",
    });
  });

  it("normalizes language tags and falls back to English", () => {
    expect(normalizeProjectAgentLocale("ko-KR")).toBe("ko");
    expect(normalizeProjectAgentLocale("zh-CN")).toBe("zh");
    expect(normalizeProjectAgentLocale("en-US")).toBe("en");
    expect(normalizeProjectAgentLocale(null)).toBe("en");
  });
});
