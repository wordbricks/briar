/** @vitest-environment jsdom */

import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { IssueCreateExecutionApproval } from "./IssueCreateExecutionApproval";

describe("IssueCreateExecutionApproval", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
    document.body.innerHTML = "";
  });

  it("offers create, create-and-run, and decline as separate choices", async () => {
    const onCreate = vi.fn(async () => undefined);
    const onDecline = vi.fn(async () => undefined);
    const loadExecutionContext = vi.fn(async () => ({
      run: null,
      workers: [],
    }));

    await renderReactTestRoot(
      root,
      <IssueCreateExecutionApproval
        creating={false}
        declining={false}
        issueAccepted={false}
        loadExecutionContext={loadExecutionContext}
        onAccept={vi.fn(async () => undefined)}
        onCreate={onCreate}
        onDecline={onDecline}
        proposalId="proposal-1"
        targetTitle="온보딩 개선"
      />,
    );

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".channel-proposal-actions > button",
      ),
    );
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "이슈 만들기",
      "생성 및 실행",
      "거절",
    ]);

    await act(async () => buttons[0]?.click());
    await act(async () => buttons[2]?.click());

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(loadExecutionContext).not.toHaveBeenCalled();
  });

  it("removes proposal actions after the issue has been created", async () => {
    await renderReactTestRoot(
      root,
      <IssueCreateExecutionApproval
        creating={false}
        declining={false}
        executionProposal={{
          id: "execution-1",
          type: "request_issue_execute",
          status: "accepted",
          projectId: "project-1",
          runId: "run-1",
          title: "온보딩 개선",
          createdAt: "2026-08-28T00:00:00.000Z",
          acceptedAt: "2026-08-28T00:01:00.000Z",
          requestedProvider: "codex",
          requestedModel: null,
          requestedEffort: null,
          requestedWorkerId: null,
          delegatedByAgentId: null,
          delegatedByAgentName: null,
        }}
        issueAccepted
        loadExecutionContext={vi.fn()}
        onAccept={vi.fn()}
        onCreate={vi.fn()}
        onDecline={vi.fn()}
        proposalId="proposal-1"
        targetTitle="온보딩 개선"
      />,
    );

    expect(container.querySelector(".channel-proposal-actions")).toBeNull();
    expect(container.querySelector(".execution-proposal-accepted")).not.toBeNull();
  });
});
