/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { demoRepositoryReadiness } from "../lib/demo-data";
import { repositoryWorkflowBootstrap } from "../lib/auto-hunt-contract";
import { ProjectOnboarding } from "./ProjectOnboarding";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ProjectOnboarding", () => {
  it("does not create a project when Escape cancels an in-flight preflight", async () => {
    const pendingPreflight = Promise.withResolvers<{
      repositoryPath: string;
      repositoryRemote: string | null;
      provider: "codex";
    }>();
    const onCancel = vi.fn();
    const onCreate = vi.fn(async () => undefined);
    const onPreflight = vi.fn()
      .mockResolvedValueOnce({
        repositoryPath: "/repo",
        repositoryRemote: "git@github.com:wordbricks/briar.git",
        provider: "codex" as const,
      })
      .mockImplementationOnce(() => pendingPreflight.promise);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
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
            onCloneRepository={async () => ({
              repositoryName: "briar",
              repositoryPath: "/repo",
            })}
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
            onRepositoryInspect={async () => ({
              ...demoRepositoryReadiness,
              repositoryPath: "/repo",
            })}
            onRepositorySelect={async () => "/repo"}
            onReviseWorkflow={async () => repositoryWorkflowBootstrap}
          />
        </I18nProvider>,
      );
    });

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

    await act(async () => root.unmount());
  });
});
