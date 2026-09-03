/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { demoRepositoryReadiness } from "../lib/demo-data";
import { repositoryWorkflowBootstrap } from "../lib/auto-hunt-contract";
import { ProjectOnboarding } from "./ProjectOnboarding";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ProjectOnboarding", () => {
  it("starts invited development roles with required personal agent setup", async () => {
    const { cleanup, container, root } = createReactTestRoot();

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <ProjectOnboarding
          connection={{
            agentToken: null,
            kind: "reconnect",
            project: {
              id: "project-1",
              name: "Briar",
              organizationId: "organization-1",
              organizationName: "Wordbricks",
              role: "developer",
              issueKeyPrefix: "BRIAR",
              scheduleTabEnabled: false,
              icon: null,
              iconName: null,
              iconColor: null,
              createdAt: "2026-08-31T00:00:00.000Z",
            },
            workflow: repositoryWorkflowBootstrap,
          }}
          error={null}
          includeDeveloperTools
          loading={false}
          onAnalyzeRequirements={async () => ({
            requirements: [],
            workflow: repositoryWorkflowBootstrap,
          })}
          onCancel={() => undefined}
          onConnect={async () => ({
            repositoryPath: "/repo",
            workflow: repositoryWorkflowBootstrap,
          })}
          onCreate={async () => ({ project: { id: "project-1" } })}
          onFinish={() => undefined}
          onInspectLovableRepository={async () => ({
            compatible: false,
            issues: [],
            packageManager: null,
            scripts: [],
            stack: null,
          })}
          onPreflight={async () => ({
            repositoryPath: "/repo",
            repositoryRemote: "git@github.com:wordbricks/briar.git",
            provider: "codex",
          })}
          onPrepareGithubRepository={async () => ({
            completedSteps: ["clone"],
            repository: "wordbricks/briar",
            repositoryId: 123456789,
            repositoryPath: "/repo",
            reused: false,
          })}
          onRepositoryInspect={async () => demoRepositoryReadiness}
          onResolveGithubRepository={async (repository) => repository}
          onRepositorySelect={async () => "/repo"}
          onReviseWorkflow={async () => repositoryWorkflowBootstrap}
          requireDeveloperAgent
          startWithDeveloperTools
        />
      </I18nProvider>,
    );

    expect(container.querySelector(".developer-tools-setup")).not.toBeNull();
    expect(container.textContent).toContain(
      "at least one development agent",
    );
    expect(
      container.querySelector<HTMLButtonElement>(
        ".developer-tools-continue",
      )?.disabled,
    ).toBe(true);

    await cleanup();
  });

  it("does not create a project when Escape cancels an in-flight preflight", async () => {
    const pendingPreflight = Promise.withResolvers<{
      repositoryPath: string;
      repositoryRemote: string | null;
      provider: "codex";
    }>();
    const onCancel = vi.fn();
    const onCreate = vi.fn(async () => ({ project: { id: "project-1" } }));
    const onPreflight = vi.fn()
      .mockResolvedValueOnce({
        repositoryPath: "/repo",
        repositoryRemote: "git@github.com:wordbricks/briar.git",
        provider: "codex" as const,
      })
      .mockImplementationOnce(() => pendingPreflight.promise);
    const { cleanup, container, root } = createReactTestRoot();

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <ProjectOnboarding
          connection={null}
          error={null}
          loading={false}
          onAnalyzeRequirements={async () => ({
            requirements: [],
            workflow: repositoryWorkflowBootstrap,
          })}
          onCancel={onCancel}
          onConnect={async () => ({
            repositoryPath: "/repo",
            workflow: repositoryWorkflowBootstrap,
          })}
          onCreate={onCreate}
          onFinish={() => undefined}
          onInspectLovableRepository={async () => ({
            compatible: false,
            issues: [],
            packageManager: null,
            scripts: [],
            stack: null,
          })}
          onPreflight={onPreflight}
          onPrepareGithubRepository={async () => ({
            completedSteps: ["clone"],
            repository: "wordbricks/briar",
            repositoryId: 123456789,
            repositoryPath: "/repo",
            reused: false,
          })}
          onRepositoryInspect={async () => ({
            ...demoRepositoryReadiness,
            repositoryPath: "/repo",
          })}
          onResolveGithubRepository={async (repository) => repository}
          onRepositorySelect={async () => "/repo"}
          onReviseWorkflow={async () => repositoryWorkflowBootstrap}
        />
      </I18nProvider>,
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          ".project-start-choice button:not(:disabled)",
        )
        ?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".setup-repository-action")
        ?.click();
    });

    act(() => {
      container
        .querySelector<HTMLFormElement>("form.project-form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onPreflight).toHaveBeenCalledTimes(2);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await act(async () => {
      pendingPreflight.resolve({
        repositoryPath: "/repo",
        repositoryRemote: "git@github.com:wordbricks/briar.git",
        provider: "codex",
      });
      await pendingPreflight.promise;
    });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCreate).not.toHaveBeenCalled();

    await cleanup();
  });

  it("starts a new project from a GitHub URL with App credentials", async () => {
    const onCreate = vi.fn(async () => ({
      project: { id: "project-1" },
    }));
    const onPrepareGithubRepository = vi.fn(async () => ({
      completedSteps: ["clone"],
      repository: "wordbricks/briar",
      repositoryId: 123456789,
      repositoryPath: "/managed/briar",
      reused: false,
    }));
    const onPreflight = vi.fn(async () => ({
      repositoryPath: "/managed/briar",
      repositoryRemote: "https://github.com/wordbricks/briar.git",
      provider: "codex" as const,
    }));
    const onResolveGithubRepository = vi.fn(async (repository: string) =>
      repository
    );
    const { cleanup, container, root } = createReactTestRoot();

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <ProjectOnboarding
          connection={null}
          error={null}
          loading={false}
          onAnalyzeRequirements={async () => ({
            requirements: [],
            workflow: repositoryWorkflowBootstrap,
          })}
          onCancel={() => undefined}
          onConnect={async () => ({
            repositoryPath: "/managed/briar",
            workflow: repositoryWorkflowBootstrap,
          })}
          onCreate={onCreate}
          onFinish={() => undefined}
          onInspectLovableRepository={async () => ({
            compatible: false,
            issues: [],
            packageManager: null,
            scripts: [],
            stack: null,
          })}
          onPreflight={onPreflight}
          onPrepareGithubRepository={onPrepareGithubRepository}
          onRepositoryInspect={async () => ({
            ...demoRepositoryReadiness,
            repositoryPath: "/managed/briar",
          })}
          onResolveGithubRepository={onResolveGithubRepository}
          onRepositorySelect={async () => null}
          onReviseWorkflow={async () => repositoryWorkflowBootstrap}
        />
      </I18nProvider>,
    );

    const githubChoice = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".project-start-choice button",
      ),
    ).find((button) => button.textContent?.includes("Start from GitHub"));
    await act(async () => githubChoice?.click());

    const input = container.querySelector<HTMLInputElement>(
      "#github-repository-url",
    );
    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "https://github.com/wordbricks/briar.git");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form.github-repository-form")
        ?.dispatchEvent(new Event("submit", {
          bubbles: true,
          cancelable: true,
        }));
    });

    expect(onCreate).toHaveBeenCalledWith({ name: "briar" });
    expect(onResolveGithubRepository).toHaveBeenCalledWith(
      "wordbricks/briar",
    );
    expect(onResolveGithubRepository.mock.invocationCallOrder[0]).toBeLessThan(
      onCreate.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(onPrepareGithubRepository).toHaveBeenCalledWith(
      "project-1",
      "wordbricks/briar",
    );
    expect(onPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        githubRepository: "wordbricks/briar",
        githubRepositoryId: 123456789,
      }),
      "/managed/briar",
    );

    await cleanup();
  });

  it("imports a Lovable project through the shared GitHub App path", async () => {
    const onCreate = vi.fn(async () => ({
      project: { id: "lovable-project" },
    }));
    const onPrepareGithubRepository = vi.fn(async () => ({
      completedSteps: ["clone"],
      repository: "wordbricks/lovable-app",
      repositoryId: 987654321,
      repositoryPath: "/managed/lovable-app",
      reused: false,
    }));
    const onInspectLovableRepository = vi.fn(async () => ({
      compatible: true,
      issues: [],
      packageManager: "bun" as const,
      scripts: ["lint", "build"],
      stack: "vite-react" as const,
    }));
    const onPreflight = vi.fn(async () => ({
      repositoryPath: "/managed/lovable-app",
      repositoryRemote: "https://github.com/wordbricks/lovable-app.git",
      provider: "codex" as const,
    }));
    const { cleanup, container, root } = createReactTestRoot();

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <ProjectOnboarding
          connection={null}
          error={null}
          loading={false}
          onAnalyzeRequirements={async () => ({
            requirements: [],
            workflow: repositoryWorkflowBootstrap,
          })}
          onCancel={() => undefined}
          onConnect={async () => ({
            repositoryPath: "/managed/lovable-app",
            workflow: repositoryWorkflowBootstrap,
          })}
          onCreate={onCreate}
          onFinish={() => undefined}
          onInspectLovableRepository={onInspectLovableRepository}
          onPreflight={onPreflight}
          onPrepareGithubRepository={onPrepareGithubRepository}
          onRepositoryInspect={async () => ({
            ...demoRepositoryReadiness,
            repositoryPath: "/managed/lovable-app",
          })}
          onResolveGithubRepository={async (repository) => repository}
          onRepositorySelect={async () => null}
          onReviseWorkflow={async () => repositoryWorkflowBootstrap}
        />
      </I18nProvider>,
    );

    const lovableChoice = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".project-start-choice button",
      ),
    ).find((button) => button.textContent?.includes("Migrate from Lovable"));
    await act(async () => lovableChoice?.click());
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          ".lovable-tutorial .onboarding-primary-action",
        )
        ?.click();
    });

    const input = container.querySelector<HTMLInputElement>(
      "#lovable-github-repository-url",
    );
    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(
        input,
        "https://github.com/wordbricks/lovable-app.git",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form.lovable-repository-form")
        ?.dispatchEvent(new Event("submit", {
          bubbles: true,
          cancelable: true,
        }));
    });

    expect(onCreate).toHaveBeenCalledWith({ name: "lovable-app" });
    expect(onPrepareGithubRepository).toHaveBeenCalledWith(
      "lovable-project",
      "wordbricks/lovable-app",
    );
    expect(onInspectLovableRepository).toHaveBeenCalledWith(
      "/managed/lovable-app",
    );
    expect(onPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        githubRepository: "wordbricks/lovable-app",
        githubRepositoryId: 987654321,
        workflow: expect.objectContaining({
          requirements: [expect.objectContaining({ id: "bun" })],
        }),
      }),
      "/managed/lovable-app",
    );

    await cleanup();
  });
});
