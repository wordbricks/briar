import { describe, expect, it } from "vitest";
import { repositoryProjectName } from "./project-workspace";

describe("repositoryProjectName", () => {
  it("names the project after the repository folder", () => {
    expect(repositoryProjectName("/Users/jay/git/briar")).toBe("briar");
    expect(repositoryProjectName("/Users/jay/git/briar/")).toBe("briar");
    expect(repositoryProjectName("C:\\work\\briar")).toBe("briar");
  });

  it("stays empty when there is no repository", () => {
    expect(repositoryProjectName("")).toBe("");
  });
});
