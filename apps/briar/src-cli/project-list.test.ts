import { describe, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { ProjectRole } from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  listProjectsCommand,
  type ProjectListDependencies,
} from "./project-commands";

const projectsResponse = {
  projects: [
    {
      $typeName: "briar.app.v1.Project" as const,
      id: "11111111-1111-4111-8111-111111111111",
      name: "Briar",
      issueKeyPrefix: "BRI",
      scheduleTabEnabled: true,
      icon: undefined,
      organizationId: "22222222-2222-4222-8222-222222222222",
      organizationName: "Wordbricks",
      role: ProjectRole.OWNER,
      createdAt: undefined,
    },
    {
      $typeName: "briar.app.v1.Project" as const,
      id: "33333333-3333-4333-8333-333333333333",
      name: "Velen",
      issueKeyPrefix: "VEL",
      scheduleTabEnabled: true,
      icon: undefined,
      organizationId: "22222222-2222-4222-8222-222222222222",
      organizationName: "Wordbricks",
      role: ProjectRole.CO_OWNER,
      createdAt: undefined,
    },
  ],
};

const dependencies = (
  overrides: Partial<ProjectListDependencies> = {},
): ProjectListDependencies => ({
  loadAuthentication: async () => ({
    apiUrl: "https://briar.example",
    userToken: "stored-token",
  }),
  environmentToken: () => undefined,
  fetchProjects: async () => projectsResponse.projects,
  jsonOutput: () => false,
  writeOutput: vi.fn(),
  ...overrides,
});

describe("project list", () => {
  it("prints project IDs with their organization and role", async () => {
    const fetchProjects = vi.fn(async () => projectsResponse.projects);
    const writeOutput = vi.fn();

    await listProjectsCommand(dependencies({ fetchProjects, writeOutput }));

    expect(fetchProjects).toHaveBeenCalledWith(
      "https://briar.example",
      "stored-token",
    );
    expect(writeOutput).toHaveBeenCalledWith(
      [
        "Briar",
        "  Project ID: 11111111-1111-4111-8111-111111111111",
        "  Organization: Wordbricks (22222222-2222-4222-8222-222222222222)",
        "  Role: owner",
        "",
        "Velen",
        "  Project ID: 33333333-3333-4333-8333-333333333333",
        "  Organization: Wordbricks (22222222-2222-4222-8222-222222222222)",
        "  Role: co-owner",
      ].join("\n"),
    );
  });

  it("prints a stable machine-readable response with --json", async () => {
    const writeOutput = vi.fn();

    await listProjectsCommand(dependencies({
      jsonOutput: () => true,
      writeOutput,
    }));

    expect(JSON.parse(writeOutput.mock.calls[0]![0])).toEqual({
      projects: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Briar",
          organizationId: "22222222-2222-4222-8222-222222222222",
          organizationName: "Wordbricks",
          role: "owner",
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "Velen",
          organizationId: "22222222-2222-4222-8222-222222222222",
          organizationName: "Wordbricks",
          role: "co-owner",
        },
      ],
    });
  });

  it("uses the environment token when configured", async () => {
    const fetchProjects = vi.fn(async () => []);

    await listProjectsCommand(dependencies({
      environmentToken: () => "environment-token",
      fetchProjects,
    }));

    expect(fetchProjects).toHaveBeenCalledWith(
      "https://briar.example",
      "environment-token",
    );
  });

  it("explains how to log in when no token is available", async () => {
    await expect(listProjectsCommand(dependencies({
      loadAuthentication: async () => ({ apiUrl: "https://briar.example" }),
    }))).rejects.toThrow(
      "Briar에 로그인되어 있지 않습니다. `briar login`을 실행하세요.",
    );
  });

  it("explains how to recover from an expired login", async () => {
    await expect(listProjectsCommand(dependencies({
      fetchProjects: async () => {
        throw new ConnectError("Unauthorized", Code.Unauthenticated);
      },
    }))).rejects.toThrow(
      "Briar 로그인이 만료되었거나 유효하지 않습니다. `briar login`을 다시 실행하세요.",
    );
  });
});
