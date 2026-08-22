/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyForManagedComputer,
  loadManagedComputerProduct,
  loadManagedComputers,
  validateManagedComputerPromotion,
} from "../lib/api";
import { ManagedComputersCard } from "./ManagedComputersCard";

vi.mock("../lib/api", () => ({
  applyForManagedComputer: vi.fn(),
  loadManagedComputerProduct: vi.fn(),
  loadManagedComputers: vi.fn(),
  retryManagedComputer: vi.fn(),
  validateManagedComputerPromotion: vi.fn(),
}));

vi.mock("../lib/platform", () => ({
  supportsManagedComputerRemoteDesktop: () => true,
}));

const product = {
  product: {
    currency: "USD" as const,
    monthlyPriceCents: 10_000,
    quantity: 1 as const,
    specification: {
      instanceType: "m7i.large",
      vcpu: 2,
      memoryGiB: 8,
      volumeGiB: 100,
      maxConcurrentRuns: 1 as const,
      region: "us-east-1",
    },
    modelApiCostsIncluded: false as const,
  },
  applicationsEnabled: true,
  remoteDesktopEnabled: false,
  configurationReady: true,
  canApply: true,
  organizationLimit: 1,
  fleetLimit: 10,
};

function buttonWithText(text: string) {
  return [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(text)
  ) as HTMLButtonElement | undefined;
}

describe("ManagedComputersCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("briar.locale.v1", "ko");
    vi.mocked(loadManagedComputerProduct).mockResolvedValue(product);
    vi.mocked(loadManagedComputers).mockResolvedValue({
      computers: [],
      generatedAt: "2026-08-22T00:00:00.000Z",
    });
    vi.mocked(validateManagedComputerPromotion).mockResolvedValue({
      valid: true,
      eligible: true,
      totalCents: 0,
      currency: "USD",
      applicationsEnabled: true,
      limitReason: null,
    });
    vi.mocked(applyForManagedComputer).mockImplementation(
      async (_token, organizationId) => ({
        computer: {
          id: "33333333-3333-4333-8333-333333333333",
          organizationId,
          requesterUserId: "owner",
          state: "requested",
          region: "us-east-1",
          instanceId: null,
          volumeId: null,
          deviceId: null,
          error: null,
          retryCount: 0,
          retryAvailable: false,
          createdAt: "2026-08-22T00:00:00.000Z",
          expiresAt: "2026-09-21T00:00:00.000Z",
          updatedAt: "2026-08-22T00:00:00.000Z",
        },
        duplicate: false,
        entitlement: {
          source: "free_promotion",
          totalCents: 0,
          currency: "USD",
        },
      }),
    );
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("shows US$0 only after server validation and submits one stable request", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ManagedComputersCard organizationId="organization-1" token="token" />,
      );
    });

    expect(container.textContent).toContain("컴퓨터 1대당 월 US$100");
    await act(async () => buttonWithText("컴퓨터 구매")?.click());
    expect(document.body.textContent).toContain("월 US$100");
    expect(document.body.textContent).not.toContain("프로모션이 적용되었습니다");

    const input = document.querySelector<HTMLInputElement>(
      "#managed-computer-promotion",
    );
    await act(async () => {
      if (!input) throw new Error("promotion input missing");
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "GETBRIAR");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonWithText("코드 확인")?.click());
    expect(validateManagedComputerPromotion).toHaveBeenCalledWith(
      "token",
      "organization-1",
      "GETBRIAR",
    );
    expect(document.body.textContent).toContain("프로모션이 적용되었습니다");
    expect(document.body.textContent).toContain("US$0");

    await act(async () => buttonWithText("US$0으로 신청")?.click());
    expect(applyForManagedComputer).toHaveBeenCalledTimes(1);
    const application = vi.mocked(applyForManagedComputer).mock.calls[0]?.[2];
    expect(application?.code).toBe("GETBRIAR");
    expect(application?.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(container.textContent).toContain("코드 확인 완료");

    await act(async () => root.unmount());
    container.remove();
  });

  it("does not expose the retired SSM setup flow while remote access is gated", async () => {
    vi.mocked(loadManagedComputers).mockResolvedValue({
      computers: [{
        id: "33333333-3333-4333-8333-333333333333",
        organizationId: "organization-1",
        requesterUserId: "owner",
        state: "needs_setup",
        region: "us-east-1",
        instanceId: "i-0123456789abcdef0",
        volumeId: "vol-0123456789abcdef0",
        deviceId: "managed-33333333-3333-4333-8333-333333333333",
        error: null,
        retryCount: 0,
        retryAvailable: false,
        createdAt: "2026-08-22T00:00:00.000Z",
        expiresAt: "2026-09-21T00:00:00.000Z",
        updatedAt: "2026-08-22T00:05:00.000Z",
      }],
      generatedAt: "2026-08-22T00:05:00.000Z",
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ManagedComputersCard organizationId="organization-1" token="token" />,
      );
    });
    expect(document.body.textContent).toContain("원격 화면 기능을 준비 중입니다");
    expect(document.body.textContent).not.toContain("AWS SSM Session Manager");
    expect(buttonWithText("화면 열기")).toBeUndefined();

    await act(async () => root.unmount());
    container.remove();
  });

  it("offers the remote screen for a setup computer when the feature is enabled", async () => {
    vi.mocked(loadManagedComputerProduct).mockResolvedValue({
      ...product,
      remoteDesktopEnabled: true,
    });
    vi.mocked(loadManagedComputers).mockResolvedValue({
      computers: [{
        id: "33333333-3333-4333-8333-333333333333",
        organizationId: "organization-1",
        requesterUserId: "owner",
        state: "needs_setup",
        region: "us-east-1",
        instanceId: "i-0123456789abcdef0",
        volumeId: "vol-0123456789abcdef0",
        deviceId: "managed-33333333-3333-4333-8333-333333333333",
        error: null,
        retryCount: 0,
        retryAvailable: false,
        createdAt: "2026-08-22T00:00:00.000Z",
        expiresAt: "2026-09-21T00:00:00.000Z",
        updatedAt: "2026-08-22T00:05:00.000Z",
      }],
      generatedAt: "2026-08-22T00:05:00.000Z",
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ManagedComputersCard organizationId="organization-1" token="token" />,
      );
    });
    expect(buttonWithText("화면 열기")).toBeDefined();
    expect(container.textContent).toContain("기존 컴퓨터의 자격 증명은 복사되지 않습니다");

    await act(async () => root.unmount());
    container.remove();
  });
});
