import { describe, expect, it } from "vitest";
import {
  githubRepositoryFromUrl,
  repositoryTeamName,
} from "./team-workspace";

describe("repositoryTeamName", () => {
  it("names the project after the repository folder", () => {
    expect(repositoryTeamName("/Users/jay/git/briar")).toBe("briar");
    expect(repositoryTeamName("/Users/jay/git/briar/")).toBe("briar");
    expect(repositoryTeamName("C:\\work\\briar")).toBe("briar");
  });

  it("stays empty when there is no repository", () => {
    expect(repositoryTeamName("")).toBe("");
  });
});

describe("githubRepositoryFromUrl", () => {
  it("accepts GitHub HTTPS and SSH clone URLs", () => {
    expect(githubRepositoryFromUrl(
      "https://github.com/wordbricks/briar.git",
    )).toEqual({ fullName: "wordbricks/briar", name: "briar" });
    expect(githubRepositoryFromUrl(
      "git@github.com:wordbricks/briar.git",
    )).toEqual({ fullName: "wordbricks/briar", name: "briar" });
    expect(githubRepositoryFromUrl(
      "ssh://git@github.com/wordbricks/my-app.git",
    )).toEqual({ fullName: "wordbricks/my-app", name: "my-app" });
  });

  it("rejects non-GitHub URLs and unsafe or nested paths", () => {
    expect(githubRepositoryFromUrl(
      "https://gitlab.com/wordbricks/briar.git",
    )).toBeNull();
    expect(githubRepositoryFromUrl(
      "https://github.com/wordbricks/briar/issues",
    )).toBeNull();
    expect(githubRepositoryFromUrl(
      "git@github.com:wordbricks/../briar.git",
    )).toBeNull();
  });
});
