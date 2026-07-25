import { describe, expect, it } from "vitest";
import {
  projectFolderName,
  projectWorkspacePath,
  repositoryProjectName,
} from "./project-workspace";

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

describe("projectFolderName", () => {
  it("keeps folder names safe on every platform", () => {
    expect(projectFolderName("  briar  ")).toBe("briar");
    expect(projectFolderName("my new project")).toBe("my-new-project");
    expect(projectFolderName("../etc/passwd")).toBe("etc-passwd");
    expect(projectFolderName("///")).toBe("");
  });
});

describe("projectWorkspacePath", () => {
  it("previews where Briar creates the repository", () => {
    expect(projectWorkspacePath("/Users/jay/Briar", "new app")).toBe(
      "/Users/jay/Briar/new-app",
    );
    expect(projectWorkspacePath("/Users/jay/Briar/", "new app")).toBe(
      "/Users/jay/Briar/new-app",
    );
  });

  it("has nothing to preview without a root or a name", () => {
    expect(projectWorkspacePath(null, "new app")).toBeNull();
    expect(projectWorkspacePath("/Users/jay/Briar", "  ")).toBeNull();
  });
});
