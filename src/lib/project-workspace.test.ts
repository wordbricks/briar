import { describe, expect, it } from "vitest";
import {
  githubSshRepositoryName,
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

describe("githubSshRepositoryName", () => {
  it("extracts repository names from GitHub SSH clone URLs", () => {
    expect(githubSshRepositoryName("git@github.com:wordbricks/briar.git")).toBe("briar");
    expect(githubSshRepositoryName("ssh://git@github.com/wordbricks/my-app.git")).toBe("my-app");
  });

  it("rejects non-GitHub and unsafe repository paths", () => {
    expect(githubSshRepositoryName("https://github.com/wordbricks/briar.git")).toBeNull();
    expect(githubSshRepositoryName("git@gitlab.com:wordbricks/briar.git")).toBeNull();
    expect(githubSshRepositoryName("git@github.com:wordbricks/../briar.git")).toBeNull();
  });
});
