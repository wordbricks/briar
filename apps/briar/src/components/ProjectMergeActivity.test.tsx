/** @vitest-environment jsdom */
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import type { ProjectMergeActivity as Activity } from "../lib/project-merge-activity";
import { ProjectMergeActivity } from "./ProjectMergeActivity";

const activity: Activity = {
  repository: "briar/app", generatedAt: "2026-09-03T08:00:00Z",
  pullRequests: [{ number: 89, title: "Fix project navigation", url: "https://github.com/briar/app/pull/89", mergedAt: "2026-09-03T07:00:00Z" }],
};

describe("ProjectMergeActivity", () => {
  it("renders PR links and supports keyboard inspection of the trend", async () => {
    localStorage.setItem("briar.locale.v1", "en");
    const { root, container, cleanup } = createReactTestRoot();
    await renderReactTestRoot(root, <I18nProvider><ProjectMergeActivity projectId="one" repository="briar/app" onLoad={async () => activity} /></I18nProvider>);
    expect(container.querySelector('a[href="https://github.com/briar/app/pull/89"]')?.getAttribute("title")).toContain("Fix project navigation");
    expect(container.textContent).toContain("No comparison when the median is zero");
    const chart = container.querySelector('[role="slider"]')!;
    await act(async () => chart.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(chart.getAttribute("aria-valuenow")).toBe("0");
    await act(async () => chart.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(chart.getAttribute("aria-valuenow")).toBe("1");
    await cleanup();
  });

  it("does not request data without a repository and allows retry after a failure", async () => {
    const onLoad = vi.fn().mockRejectedValueOnce(new Error("GitHub unavailable")).mockResolvedValue(activity);
    const { root, container, cleanup } = createReactTestRoot();
    const render = (repository: string | null) => renderReactTestRoot(root, <I18nProvider><ProjectMergeActivity projectId="one" repository={repository} onLoad={onLoad} /></I18nProvider>);
    await render(null);
    expect(onLoad).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Connect a GitHub repository");
    await render("briar/app");
    expect(container.textContent).toContain("Could not load");
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(onLoad).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".merge-activity-pr")?.getAttribute("title")).toContain("Fix project navigation");
    await cleanup();
  });

  it("aborts outdated requests and never shows a previous project's response", async () => {
    let completeOld!: (value: Activity) => void;
    const onLoad = vi.fn((projectId: string, _signal: AbortSignal) => projectId === "one"
      ? new Promise<Activity>((resolve) => { completeOld = resolve; })
      : Promise.resolve({ ...activity, repository: "briar/other", pullRequests: [] }));
    const { root, container, cleanup } = createReactTestRoot();
    const render = (id: string, repository: string) => renderReactTestRoot(root, <I18nProvider><ProjectMergeActivity projectId={id} repository={repository} onLoad={onLoad} /></I18nProvider>);
    await render("one", "briar/app");
    const oldSignal = onLoad.mock.calls[0][1];
    await render("two", "briar/other");
    expect(oldSignal.aborted).toBe(true);
    await act(async () => completeOld(activity));
    expect(container.textContent).toContain("briar/other");
    expect(container.querySelector('a[href="https://github.com/briar/app/pull/89"]')).toBeNull();
    await cleanup();
  });
});
