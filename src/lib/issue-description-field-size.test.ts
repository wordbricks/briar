/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { fitIssueDescriptionField } from "./issue-description-field-size";

describe("fitIssueDescriptionField", () => {
  it("grows the field to the content scroll height and clears the hidden scroll offset", () => {
    const textarea = document.createElement("textarea");
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => 129,
    });
    textarea.style.minHeight = "110px";
    textarea.scrollTop = 19;

    fitIssueDescriptionField(textarea);

    expect(textarea.style.minHeight).toBe("129px");
    expect(textarea.scrollTop).toBe(0);
  });

  it("keeps the previous min-height when scrollHeight is not measurable", () => {
    const textarea = document.createElement("textarea");
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => 0,
    });
    textarea.style.minHeight = "110px";
    textarea.scrollTop = 8;

    fitIssueDescriptionField(textarea);

    expect(textarea.style.minHeight).toBe("110px");
    expect(textarea.scrollTop).toBe(0);
  });
});
