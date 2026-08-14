/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { repositoryWorkflowBootstrap } from "../lib/auto-hunt-contract";
import type { ProjectLlmProgress } from "../lib/project-llm";
import { ProjectOnboarding } from "./ProjectOnboarding";

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
  onConnect: async () => ({
    repositoryPath: readiness.repositoryPath,
    workflow: generatedWorkflow,
  }),
  onCreate: async () => undefined,
  onFinish: () => undefined,
  onLogout: () => undefined,
  onReviseWorkflow: async () => generatedWorkflow,
  onSkip: () => undefined,
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
  it("keeps the first-project purpose choice", () => {
    const markup = renderToStaticMarkup(<ProjectOnboarding {...baseProps} />);

    expect(markup).toContain("Briar를 어떻게 사용하고 싶으세요?");
    expect(markup).toContain("개발 프로젝트 진행하기");
    expect(markup).toContain("프로젝트 없이 시작");
  });

  it("only offers an existing repository and makes it required", () => {
    const markup = renderToStaticMarkup(
      <ProjectOnboarding {...baseProps} canCancel />,
    );

    expect(markup).toContain("로컬 Git 저장소");
    expect(markup).toContain("저장소 연결은 프로젝트 생성에 필수");
    expect(markup).not.toContain("처음부터 시작");
    expect(markup).not.toContain("나중에 하기");
    expect(markup).not.toContain("Auto Hunt 워크플로");
  });

  it("shows Next only after validating a Git repository", async () => {
    const { container, root } = mountOnboarding();
    await act(async () => root.render(<ProjectOnboarding {...baseProps} canCancel />));

    expect(buttonWithText(container, "다음")).toBeUndefined();
    await selectValidRepository(container);

    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="프로젝트 이름"]')?.value,
    ).toBe("briar");
    expect(buttonWithText(container, "다음")?.disabled).toBe(false);

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
    expect(providerProgress?.getAttribute("role")).toBe("status");
    expect(providerProgress?.getAttribute("aria-live")).toBe("polite");
    expect(providerProgress?.getAttribute("aria-atomic")).toBe("true");
    expect(providerProgress?.textContent).toContain("Codex");
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
    expect(providerProgress?.getAttribute("role")).toBe("status");
    expect(providerProgress?.getAttribute("aria-live")).toBe("polite");
    expect(providerProgress?.getAttribute("aria-atomic")).toBe("true");
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
