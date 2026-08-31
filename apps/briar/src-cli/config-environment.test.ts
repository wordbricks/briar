import { describe, expect, it } from "vitest";
import {
  sameApiEnvironment,
  selectProjectForApi,
} from "./config-environment";

describe("CLI API environment selection", () => {
  it("selects the project issued by the active API", () => {
    const selected = selectProjectForApi(
      [
        { id: "production", apiUrl: "https://briar.example.com" },
        { id: "development", apiUrl: "http://127.0.0.1:8788" },
      ],
      "http://127.0.0.1:8788/",
    );

    expect(selected?.id).toBe("development");
  });

  it("rejects an explicitly requested project from another API", () => {
    expect(
      selectProjectForApi(
        [{ id: "production", apiUrl: "https://briar.example.com" }],
        "http://127.0.0.1:8788",
        "production",
      ),
    ).toBeUndefined();
  });

  it("ignores trailing slashes when comparing API URLs", () => {
    expect(
      sameApiEnvironment(
        "https://briar.example.com/",
        "https://briar.example.com",
      ),
    ).toBe(true);
  });
});
