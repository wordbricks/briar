/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { repositoryWorkflowBootstrap } from "../lib/auto-hunt-contract";
import type { LocalAutoHuntConfig } from "../lib/project-connection";
import type { ProjectLlmProgress } from "../lib/project-llm";
import { ProjectOnboarding } from "./ProjectOnboarding";

vi.mock("../lib/initial-onboarding", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../lib/initial-onboarding")>();
  return {
    ...original,
    inspectOnboardingPrerequisites: vi.fn().mockResolvedValue({
      git: {
        installed: true,
        version: "git version 2.50.1",
        authenticated: true,
      },
      codex: {
        installed: true,
        version: "codex-cli 1.0.0",
        authenticated: true,
      },
      claude: { installed: false, version: null, authenticated: false },
      grok: { installed: false, version: null, authenticated: false },
      agy: { installed: false, version: null, authenticated: false },
      opencode: { installed: false, version: null, authenticated: false },
    }),
    inspectOpenCodeTerminalPath: vi.fn().mockResolvedValue({
      supported: true,
      configured: true,
      binaryPath: "/Users/jay/.bun/bin/opencode",
      configPath: "/Users/jay/.zshrc",
    }),
    configureOpenCodeTerminalPath: vi.fn(),
    installOnboardingPrerequisite: vi.fn(),
  };
});

const generatedWorkflow = {
  version: 2 as const,
  requirements: [
    {
      id: "bun",
      label: "Bun",
      kind: "executable" as const,
      tool: "bun",
      reason: "프로젝트 테스트와 빌드 실행",
    },
  ],
  stages: [
    {
      id: "implementing",
      label: "구현",
      required: true,
      evidence: ["diff"],
    },
    {
      id: "local_qa",
      label: "로컬 검증",
      required: true,
      evidence: ["test"],
      checks: ["bun test"],
    },
  ],
  execution: { checkpoints: [] },
  completion: { requiredStages: ["implementing", "local_qa"] },
};

const readiness = {
  repositoryPath: "/Users/jay/git/briar",
  gitInstalled: true,
  gitVersion: "git version 2.50.1",
  repositoryHealthy: true,
  remote: "git@github.com:wordbricks/briar.git",
  remoteReachable: true,
  pushAccess: true,
  requiresGithub: false,
  githubRepository: "wordbricks/briar",
  ghInstalled: true,
  ghVersion: "gh version 2.76.1",
  ghAuthenticated: true,
  ghAccount: "jay",
  githubWriteAccess: true,
  gitReady: true,
  prReady: true,
  issues: [],
};

const lovableCompatibility = {
  compatible: true,
  stack: "tanstack-start" as const,
  packageManager: "npm" as const,
  scripts: ["dev", "lint", "test", "build"],
  issues: [],
};

const connection = {
  project: {
    id: "project-1",
    name: "Briar",
    createdAt: "2026-07-22T00:00:00Z",
  },
  agentToken: "token",
  workflow: repositoryWorkflowBootstrap,
};

const existingWorkflowConnection = {
  ...connection,
  workflow: generatedWorkflow,
};

const baseProps = {
  connection: null,
  error: null,
  loading: false,
  onAnalyzeRequirements: async () => ({
    workflow: generatedWorkflow,
    requirements: [],
  }),
  onCancel: () => undefined,
  onCloneRepository: async () => ({
    repositoryPath: readiness.repositoryPath,
    repositoryName: "briar",
  }),
  onConnect: async () => ({
    repositoryPath: readiness.repositoryPath,
    workflow: generatedWorkflow,
  }),
  onCreate: async () => undefined,
  onFinish: () => undefined,
  onInspectLovableRepository: async () => lovableCompatibility,
  onLogout: () => undefined,
  onReviseWorkflow: async () => generatedWorkflow,
  onRepositorySelect: async () => readiness.repositoryPath,
  onRepositoryInspect: async () => readiness,
  user: { id: "user-1", name: "Jay", email: "jay@example.com" },
};

function mountOnboarding() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  return { container, root: createRoot(container) };
}

function buttonWithText(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim().startsWith(label),
  );
}

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setValue?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function selectValidRepository(container: HTMLElement) {
  await act(async () => {
    buttonWithText(container, "저장소 선택")?.click();
  });
}

describe("ProjectOnboarding", () => {
  it("starts project creation with three clear choices in a dialog", () => {
    const markup = renderToStaticMarkup(<ProjectOnboarding {...baseProps} />);

    expect(markup).toContain("Connect Local Git Repository");
    expect(markup).toContain("Create from scratch");
    expect(markup).toContain("Migrate from Lovable");
    expect(markup).toContain("aria-modal=\"true\"");
    expect(markup).toContain("disabled=\"\"");
  });

  it("shows developer tools before repository setup", async () => {
    const { container, root } = mountOnboarding();
    await act(async () =>
      root.render(
        <ProjectOnboarding {...baseProps} includeDeveloperTools />,
      ),
    );

    await act(async () => {
      buttonWithText(container, "Connect Local Git Repository")?.click();
    });
    expect(container.textContent).toContain("개발 도구를 연결해 주세요");
    expect(container.textContent).toContain("Git필수");
    expect(container.querySelectorAll(".initial-prerequisite-row")).toHaveLength(8);
    expect(container.textContent).toContain("Cursor");
    expect(container.textContent).not.toContain("로컬 Git 저장소");

    await act(async () => {
      buttonWithText(container, "저장소 연결하기")?.click();
    });

    expect(container.textContent).toContain("로컬 Git 저장소");
    expect(container.textContent).toContain("프로젝트 설정 · 2/4");

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps create from scratch visibly disabled", () => {
    const markup = renderToStaticMarkup(<ProjectOnboarding {...baseProps} canCancel />);

    expect(markup).toContain("Create from scratch");
    expect(markup).toContain("준비 중");
    expect(markup).toMatch(/<button[^>]*aria-disabled="true"[^>]*disabled/);
  });

  it("shows Next only after validating a Git repository", async () => {
    const { container, root } = mountOnboarding();
    await act(async () => root.render(<ProjectOnboarding {...baseProps} canCancel />));

    await act(async () => {
      buttonWithText(container, "Connect Local Git Repository")?.click();
    });
    expect(buttonWithText(container, "다음")).toBeUndefined();
    await selectValidRepository(container);

    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="프로젝트 이름"]')?.value,
    ).toBe("briar");
    expect(buttonWithText(container, "다음")?.disabled).toBe(false);

    await act(async () => root.unmount());
    container.remove();
  });

  it("guides Lovable users through video, SSH copy, clone, and project naming", async () => {
    const { container, root } = mountOnboarding();
    const onCloneRepository = vi.fn().mockResolvedValue({
      repositoryPath: "/Users/jay/briar/git/lovable-store",
      repositoryName: "lovable-store",
    });
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onInspectLovableRepository = vi.fn().mockResolvedValue(
      lovableCompatibility,
    );

    await act(async () => root.render(
      <ProjectOnboarding
        {...baseProps}
        onCloneRepository={onCloneRepository}
        onCreate={onCreate}
        onInspectLovableRepository={onInspectLovableRepository}
      />,
    ));
    await act(async () => buttonWithText(container, "Migrate from Lovable")?.click());

    expect(container.textContent).toContain("먼저 Lovable을 GitHub와 연결");
    expect(container.querySelector("iframe")?.getAttribute("src")).toContain(
      "youtube-nocookie.com/embed/zgNkhU4SYgQ",
    );
    await act(async () => buttonWithText(container, "영상대로 연결했어요")?.click());

    expect(container.textContent).toContain("Project settings → Git → GitHub");
    expect(container.textContent).toContain("커스텀 구성일 때만 워크플로우를 분석");
    const sshInput = container.querySelector<HTMLInputElement>(
      "#lovable-github-ssh-url",
    );
    await act(async () => typeInto(sshInput!, "git@github.com:jay/lovable-store.git"));
    expect(container.textContent).toContain("~/briar/git/lovable-store");
    await act(async () => buttonWithText(container, "확인")?.click());

    expect(onCloneRepository).toHaveBeenCalledWith(
      "git@github.com:jay/lovable-store.git",
    );
    expect(onCreate).toHaveBeenCalledWith({ name: "lovable-store" });
    expect(onInspectLovableRepository).toHaveBeenCalledWith(
      readiness.repositoryPath,
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("saves a compatible Lovable preset and finishes without workflow review", async () => {
    const { container, root } = mountOnboarding();
    const onFinish = vi.fn();
    const onAnalyzeRequirements = vi.fn();
    const onConnect = vi.fn(async (settings: LocalAutoHuntConfig) => ({
      repositoryPath: readiness.repositoryPath,
      workflow: settings.workflow,
    }));
    const props = {
      ...baseProps,
      onAnalyzeRequirements,
      onConnect,
      onFinish,
    };

    await act(async () => root.render(<ProjectOnboarding {...props} />));
    await act(async () => buttonWithText(container, "Migrate from Lovable")?.click());
    await act(async () => buttonWithText(container, "영상대로 연결했어요")?.click());
    const sshInput = container.querySelector<HTMLInputElement>(
      "#lovable-github-ssh-url",
    );
    await act(async () => typeInto(sshInput!, "git@github.com:jay/lovable-store.git"));
    await act(async () => buttonWithText(container, "확인")?.click());
    await act(async () => root.render(
      <ProjectOnboarding {...props} connection={connection} />,
    ));
    await act(async () => Promise.resolve());

    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: expect.objectContaining({
          requirements: [expect.objectContaining({ tool: "npm" })],
          stages: expect.arrayContaining([
            expect.objectContaining({
              id: "local_qa",
              checks: ["npm run lint", "npm run test", "npm run build"],
            }),
            expect.objectContaining({ id: "pr_open" }),
          ]),
        }),
      }),
      readiness.repositoryPath,
      expect.any(Function),
    );
    expect(container.textContent).toContain("Lovable 워크플로우를 확인하고 있어요");
    expect(container.textContent).not.toContain("워크플로우를 확인해 주세요");
    expect(onAnalyzeRequirements).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });

  it("falls back to repository workflow generation for a custom Lovable setup", async () => {
    const { container, root } = mountOnboarding();
    const onFinish = vi.fn();
    const onConnect = vi.fn().mockResolvedValue({
      repositoryPath: readiness.repositoryPath,
      workflow: generatedWorkflow,
    });
    const props = {
      ...baseProps,
      onConnect,
      onFinish,
      onInspectLovableRepository: vi.fn().mockResolvedValue({
        ...lovableCompatibility,
        compatible: false,
        issues: ["Custom CI or deployment configuration was detected."],
      }),
    };

    await act(async () => root.render(<ProjectOnboarding {...props} />));
    await act(async () => buttonWithText(container, "Migrate from Lovable")?.click());
    await act(async () => buttonWithText(container, "영상대로 연결했어요")?.click());
    const sshInput = container.querySelector<HTMLInputElement>(
      "#lovable-github-ssh-url",
    );
    await act(async () => typeInto(sshInput!, "git@github.com:jay/custom-store.git"));
    await act(async () => buttonWithText(container, "확인")?.click());
    await act(async () => root.render(
      <ProjectOnboarding {...props} connection={connection} />,
    ));
    await act(async () => Promise.resolve());

    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ workflow: repositoryWorkflowBootstrap }),
      readiness.repositoryPath,
      expect.any(Function),
    );
    expect(container.textContent).toContain("워크플로우를 확인해 주세요");
    expect(onFinish).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows workflow generation and then a natural-language review", async () => {
    const { container, root } = mountOnboarding();
    let resolveConnection: ((value: {
      repositoryPath: string;
      workflow: typeof generatedWorkflow;
    }) => void) | undefined;
    let reportProgress: ((progress: ProjectLlmProgress) => void) | undefined;
    const onConnect = vi.fn((
      _settings: unknown,
      _repositoryPath: string,
      onProgress?: (progress: ProjectLlmProgress) => void,
    ) => {
      reportProgress = onProgress;
      return new Promise<{
        repositoryPath: string;
        workflow: typeof generatedWorkflow;
      }>((resolve) => { resolveConnection = resolve; });
    });

    await act(async () => root.render(
      <ProjectOnboarding
        {...baseProps}
        connection={connection}
        onConnect={onConnect}
      />,
    ));
    await selectValidRepository(container);
    await act(async () => buttonWithText(container, "다음")?.click());

    expect(container.textContent).toContain("워크플로우를 만들고 있어요");
    expect(container.textContent).toContain("LLM 프로바이더의 첫 메시지를 기다리고 있습니다");
    expect(onConnect).toHaveBeenCalledOnce();

    await act(async () => reportProgress?.({
      provider: "codex",
      messageId: "message-1",
      phase: "commentary",
      message: "저장소 구조를 분석하고 있습니다.",
    }));
    const providerProgress = container.querySelector(
      ".onboarding-provider-progress",
    );
    expect(providerProgress?.getAttribute("role")).toBe("group");
    const liveProgress = providerProgress?.querySelector('[role="status"]');
    expect(liveProgress?.getAttribute("aria-live")).toBe("polite");
    expect(liveProgress?.getAttribute("aria-atomic")).toBe("true");
    expect(providerProgress?.textContent).toContain("Codex");
    expect(providerProgress?.textContent).toContain("경과");
    expect(providerProgress?.textContent).toContain("방금 업데이트됨");
    expect(providerProgress?.textContent).toContain("저장소 구조를 분석하고 있습니다.");

    await act(async () => reportProgress?.({
      provider: "codex",
      messageId: "message-2",
      phase: "commentary",
      message: "검증 명령을 확인하고 있습니다.",
    }));
    expect(providerProgress?.textContent).toContain("검증 명령을 확인하고 있습니다.");
    expect(providerProgress?.textContent).not.toContain("저장소 구조를 분석하고 있습니다.");

    await act(async () => reportProgress?.({
      provider: "codex",
      messageId: "message-3",
      phase: "final_answer",
      message: '{"completion":{"requiredStages":[]},"version":2}',
    }));
    expect(providerProgress?.textContent).toContain("분석 결과를 정리하고 있습니다…");
    expect(providerProgress?.textContent).not.toContain('"completion"');

    await act(async () => resolveConnection?.({
      repositoryPath: readiness.repositoryPath,
      workflow: generatedWorkflow,
    }));

    expect(container.textContent).toContain("워크플로우를 확인해 주세요");
    expect(container.textContent).toContain("구현");
    expect(container.textContent).toContain("bun test");
    expect(container.querySelector("#onboarding-workflow-revision")).toBeTruthy();
    expect(container.textContent).toContain("나중에 언제든 다시 수정");

    await act(async () => root.unmount());
    container.remove();
  });

  it("explains a quiet long-running workflow without exposing tool commands", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T04:00:00.000Z"));
    const { container, root } = mountOnboarding();
    let reportProgress: ((progress: ProjectLlmProgress) => void) | undefined;
    const onConnect = vi.fn((
      _settings: unknown,
      _repositoryPath: string,
      onProgress?: (progress: ProjectLlmProgress) => void,
    ) => {
      reportProgress = onProgress;
      return new Promise<never>(() => undefined);
    });

    try {
      await act(async () => root.render(
        <ProjectOnboarding
          {...baseProps}
          connection={connection}
          onConnect={onConnect}
        />,
      ));
      await selectValidRepository(container);
      await act(async () => buttonWithText(container, "다음")?.click());

      expect(container.textContent).toContain("경과 0s");
      await act(async () => vi.advanceTimersByTimeAsync(61_000));
      expect(container.textContent).toContain("경과 1m 1s");
      expect(container.textContent).toContain("1m 1s 동안 새 업데이트 없음");
      expect(container.textContent).toContain("요청은 계속 실행 중입니다");

      await act(async () => reportProgress?.({
        provider: "codex",
        messageId: "command-1",
        phase: "activity",
        message: "git status --short --branch",
        activityKind: "command",
      }));
      expect(container.textContent).toContain(
        "저장소 파일과 검증 명령을 확인하고 있습니다",
      );
      expect(container.textContent).not.toContain("git status");
      expect(container.textContent).toContain("방금 업데이트됨");
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.useRealTimers();
    }
  });

  it("finishes reconnection without workflow setup or tool analysis when a workflow already exists", async () => {
    const { container, root } = mountOnboarding();
    const onConnect = vi.fn().mockResolvedValue({
      repositoryPath: readiness.repositoryPath,
      workflow: generatedWorkflow,
    });
    const onFinish = vi.fn();
    const onAnalyzeRequirements = vi.fn();

    await act(async () => root.render(
      <ProjectOnboarding
        {...baseProps}
        connection={existingWorkflowConnection}
        onAnalyzeRequirements={onAnalyzeRequirements}
        onConnect={onConnect}
        onFinish={onFinish}
      />,
    ));

    expect(container.textContent).toContain("저장소 재연결");
    expect(container.textContent).toContain("이슈와 설정은 이미 계정에 저장되어 있습니다");
    expect(container.textContent).not.toContain("프로젝트 설정 · 1/3");
    expect(container.querySelector(".project-onboarding-progress")).toBeNull();
    await selectValidRepository(container);
    expect(buttonWithText(container, "저장소 연결")).toBeTruthy();
    await act(async () => buttonWithText(container, "저장소 연결")?.click());

    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ workflow: generatedWorkflow }),
      readiness.repositoryPath,
    );
    expect(onFinish).toHaveBeenCalledOnce();
    expect(onAnalyzeRequirements).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("워크플로우를 만들고 있어요");
    expect(container.textContent).not.toContain("워크플로우를 확인해 주세요");
    expect(container.textContent).not.toContain("필요한 개발 도구를 확인하고 있어요");
    expect(container.textContent).not.toContain("로컬 개발 환경을 확인해 주세요");

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows retry and repository-back actions after generation fails", async () => {
    const { container, root } = mountOnboarding();
    const onConnect = vi.fn().mockRejectedValue(new Error("분석 서버 연결 실패"));

    await act(async () => root.render(
      <ProjectOnboarding {...baseProps} connection={connection} onConnect={onConnect} />,
    ));
    await selectValidRepository(container);
    await act(async () => buttonWithText(container, "다음")?.click());

    expect(container.textContent).toContain("분석 서버 연결 실패");
    expect(buttonWithText(container, "다시 시도하기")).toBeTruthy();
    expect(buttonWithText(container, "저장소 선택으로 돌아가기")).toBeTruthy();

    await act(async () =>
      buttonWithText(container, "저장소 선택으로 돌아가기")?.click(),
    );
    expect(container.textContent).toContain("로컬 Git 저장소");
    await act(async () => buttonWithText(container, "다음")?.click());
    expect(onConnect).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows project workflow validation issues separately from generation errors", async () => {
    const { container, root } = mountOnboarding();
    const onConnect = vi.fn().mockRejectedValue(
      new ApiError(
        400,
        "Invalid project workflow",
        "INVALID_PROJECT_WORKFLOW",
        [
          "version 2 execution.checkpoints is required",
          "completion.requiredStages must match stages marked required",
        ],
      ),
    );

    await act(async () => root.render(
      <ProjectOnboarding {...baseProps} connection={connection} onConnect={onConnect} />,
    ));
    await selectValidRepository(container);
    await act(async () => buttonWithText(container, "다음")?.click());

    expect(container.textContent).toContain(
      "생성된 워크플로우가 서버 검증을 통과하지 못했습니다.",
    );
    expect(container.textContent).toContain(
      "version 2 execution.checkpoints is required",
    );
    expect(container.textContent).toContain(
      "completion.requiredStages must match stages marked required",
    );
    expect(container.textContent).not.toContain("Invalid checkpoint policy");

    await act(async () => root.unmount());
    container.remove();
  });

  it("revises the generated workflow from natural language", async () => {
    const { container, root } = mountOnboarding();
    const onReviseWorkflow = vi.fn().mockResolvedValue({
      ...generatedWorkflow,
      stages: generatedWorkflow.stages.map((stage) =>
        stage.id === "local_qa"
          ? { ...stage, checks: ["bun test", "bun run build"] }
          : stage,
      ),
    });

    await act(async () => root.render(
      <ProjectOnboarding
        {...baseProps}
        connection={connection}
        onReviseWorkflow={onReviseWorkflow}
      />,
    ));
    await selectValidRepository(container);
    await act(async () => buttonWithText(container, "다음")?.click());
    await act(async () => Promise.resolve());

    const revision = container.querySelector<HTMLTextAreaElement>(
      "#onboarding-workflow-revision",
    );
    await act(async () => typeInto(revision!, "빌드도 실행해줘"));
    await act(async () => buttonWithText(container, "워크플로우 수정")?.click());

    expect(onReviseWorkflow).toHaveBeenCalledWith("project-1", "빌드도 실행해줘");
    expect(container.textContent).toContain("bun run build");

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows missing tools but still allows confirmation", async () => {
    const { container, root } = mountOnboarding();
    const onFinish = vi.fn();
    const onAnalyzeRequirements = vi.fn().mockResolvedValue({
      workflow: generatedWorkflow,
      requirements: [
        {
          id: "bun",
          label: "Bun",
          kind: "executable",
          tool: "bun",
          reason: "프로젝트 테스트와 빌드 실행",
          healthy: false,
          detail: "bun 실행 파일을 찾지 못했습니다.",
        },
      ],
    });

    await act(async () => root.render(
      <ProjectOnboarding
        {...baseProps}
        connection={connection}
        onAnalyzeRequirements={onAnalyzeRequirements}
        onFinish={onFinish}
      />,
    ));
    await selectValidRepository(container);
    await act(async () => buttonWithText(container, "다음")?.click());
    await act(async () => Promise.resolve());
    await act(async () => buttonWithText(container, "다음")?.click());

    expect(container.textContent).toContain("설치 안 됨");
    expect(container.textContent).toContain("일부 자동화가 진행되지 않을 수 있습니다");
    expect(buttonWithText(container, "확인")?.disabled).toBe(false);

    await act(async () => buttonWithText(container, "확인")?.click());
    expect(onFinish).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows the latest LLM provider message while analyzing required tools", async () => {
    const { container, root } = mountOnboarding();
    let reportProgress: ((progress: ProjectLlmProgress) => void) | undefined;
    let resolveAnalysis: ((value: {
      workflow: typeof generatedWorkflow;
      requirements: never[];
    }) => void) | undefined;
    const onAnalyzeRequirements = vi.fn((
      _projectId: string,
      onProgress?: (progress: ProjectLlmProgress) => void,
    ) => {
      reportProgress = onProgress;
      return new Promise<{
        workflow: typeof generatedWorkflow;
        requirements: never[];
      }>((resolve) => { resolveAnalysis = resolve; });
    });

    await act(async () => root.render(
      <ProjectOnboarding
        {...baseProps}
        connection={connection}
        onAnalyzeRequirements={onAnalyzeRequirements}
      />,
    ));
    await selectValidRepository(container);
    await act(async () => buttonWithText(container, "다음")?.click());
    await act(async () => Promise.resolve());
    await act(async () => buttonWithText(container, "다음")?.click());

    expect(container.textContent).toContain("필요한 개발 도구를 확인하고 있어요");
    expect(container.textContent).toContain("LLM 프로바이더의 첫 메시지를 기다리고 있습니다");
    expect(onAnalyzeRequirements).toHaveBeenCalledWith(
      "project-1",
      expect.any(Function),
    );

    await act(async () => reportProgress?.({
      provider: "codex",
      messageId: "tools-message-1",
      phase: "commentary",
      message: "패키지 매니저와 테스트 도구를 확인하고 있습니다.",
    }));
    const providerProgress = container.querySelector(
      ".onboarding-provider-progress",
    );
    expect(providerProgress?.getAttribute("role")).toBe("group");
    const liveProgress = providerProgress?.querySelector('[role="status"]');
    expect(liveProgress?.getAttribute("aria-live")).toBe("polite");
    expect(liveProgress?.getAttribute("aria-atomic")).toBe("true");
    expect(providerProgress?.textContent).toContain("Codex");
    expect(providerProgress?.textContent).toContain(
      "패키지 매니저와 테스트 도구를 확인하고 있습니다.",
    );

    await act(async () => reportProgress?.({
      provider: "codex",
      messageId: "tools-message-2",
      phase: "commentary",
      message: "로컬 실행 파일 요구 사항을 정리하고 있습니다.",
    }));
    expect(providerProgress?.textContent).toContain(
      "로컬 실행 파일 요구 사항을 정리하고 있습니다.",
    );
    expect(providerProgress?.textContent).not.toContain(
      "패키지 매니저와 테스트 도구를 확인하고 있습니다.",
    );

    await act(async () => reportProgress?.({
      provider: "claude",
      messageId: "tools-message-3",
      phase: "final",
      message: '{"requirements":[]}',
    }));
    expect(providerProgress?.textContent).toContain("분석 결과를 정리하고 있습니다…");
    expect(providerProgress?.textContent).not.toContain('"requirements"');

    await act(async () => resolveAnalysis?.({
      workflow: generatedWorkflow,
      requirements: [],
    }));
    expect(container.textContent).toContain("로컬 개발 환경을 확인해 주세요");

    await act(async () => root.unmount());
    container.remove();
  });
});
