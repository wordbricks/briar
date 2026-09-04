/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { describe, expect, it, vi } from "vitest";

import type {
  AgentProviderKind,
  LocalProjectConnectionPreflight,
} from "../generated/tauri";
import { I18nProvider } from "../i18n";
import { demoRepositoryReadiness } from "../lib/demo-data";
import { repositoryWorkflowBootstrap } from "../lib/auto-hunt-contract";
import { TeamOnboarding } from "./TeamOnboarding";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type ProviderAvailability = LocalProjectConnectionPreflight["providers"][number];

function providerAvailability(
  provider: AgentProviderKind,
  overrides: Partial<ProviderAvailability> = {},
): ProviderAvailability {
  return {
    provider,
    enabled: true,
    installed: true,
    authenticated: true,
    selectable: true,
    usageExhausted: false,
    maxUsedPercent: null,
    usageResetsAt: null,
    reason: null,
    ...overrides,
  };
}

/** Codex is out of quota; Claude is the connected provider with room left. */
const connectedProviders: ProviderAvailability[] = [
  providerAvailability("codex", {
    usageExhausted: true,
    maxUsedPercent: 100,
    reason: "usage_exhausted",
  }),
  providerAvailability("claude"),
  providerAvailability("grok", {
    installed: false,
    authenticated: false,
    selectable: false,
    reason: "not_installed",
  }),
];

function preflightResult(
  repositoryPath: string,
  repositoryRemote: string | null,
  provider: AgentProviderKind = "codex",
): LocalProjectConnectionPreflight {
  return {
    repositoryPath,
    repositoryRemote,
    provider,
    providers: connectedProviders,
  };
}


describe("TeamOnboarding", () => {
  it("starts invited development roles with required personal agent setup", async () => {
    const { cleanup, container, root } = createReactTestRoot();

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <TeamOnboarding
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
          onPreflight={async () =>
            preflightResult("/repo", "git@github.com:wordbricks/briar.git")}
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
    const pendingPreflight = Promise
      .withResolvers<LocalProjectConnectionPreflight>();
    const onCancel = vi.fn();
    const onCreate = vi.fn(async () => ({ project: { id: "project-1" } }));
    const onPreflight = vi.fn()
      .mockResolvedValueOnce(
        preflightResult("/repo", "git@github.com:wordbricks/briar.git"),
      )
      .mockImplementationOnce(() => pendingPreflight.promise);
    const { cleanup, container, root } = createReactTestRoot();

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <TeamOnboarding
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
      pendingPreflight.resolve(
        preflightResult("/repo", "git@github.com:wordbricks/briar.git"),
      );
      await pendingPreflight.promise;
    });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCreate).not.toHaveBeenCalled();

    await cleanup();
  });

  it("generates the workflow on the agent backend the user picked", async () => {
    const onConnect = vi.fn(async () => ({
      repositoryPath: "/repo",
      workflow: repositoryWorkflowBootstrap,
    }));
    // The provider menu renders through a portal, so the card has to live in
    // the document for its options to be reachable.
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <TeamOnboarding
          connection={{
            agentToken: null,
            kind: "new",
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
          loading={false}
          onAnalyzeRequirements={async () => ({
            requirements: [],
            workflow: repositoryWorkflowBootstrap,
          })}
          onCancel={() => undefined}
          onConnect={onConnect}
          onCreate={async () => ({ project: { id: "project-1" } })}
          onFinish={() => undefined}
          onInspectLovableRepository={async () => ({
            compatible: false,
            issues: [],
            packageManager: null,
            scripts: [],
            stack: null,
          })}
          onPreflight={async () =>
            preflightResult("/repo", "git@github.com:wordbricks/briar.git")}
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
        .querySelector<HTMLButtonElement>(".setup-repository-action")
        ?.click();
    });

    const choice = container.querySelector(".onboarding-provider-choice");
    expect(choice).not.toBeNull();
    await act(async () => {
      choice?.querySelector<HTMLButtonElement>(".select-menu-trigger")?.click();
    });
    const option = (provider: string) =>
      document.querySelector<HTMLButtonElement>(
        `.select-menu-option[data-value="${provider}"]`,
      );
    // Codex is resolved by default but out of quota, and a provider that is
    // not installed cannot be picked at all.
    expect(option("codex")?.textContent).toContain("Usage limit reached");
    expect(option("grok")?.disabled).toBe(true);

    await act(async () => option("claude")?.click());
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form.project-form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(onConnect).toHaveBeenCalledWith(
      expect.anything(),
      "/repo",
      expect.anything(),
      "claude",
    );

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
    const onPreflight = vi.fn(async () =>
      preflightResult(
        "/managed/briar",
        "https://github.com/wordbricks/briar.git",
      ));
    const onResolveGithubRepository = vi.fn(async (repository: string) =>
      repository
    );
    const { cleanup, container, root } = createReactTestRoot();

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <TeamOnboarding
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
    const onPreflight = vi.fn(async () =>
      preflightResult(
        "/managed/lovable-app",
        "https://github.com/wordbricks/lovable-app.git",
      ));
    const { cleanup, container, root } = createReactTestRoot();

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <TeamOnboarding
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
