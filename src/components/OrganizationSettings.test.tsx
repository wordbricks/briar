/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addOrganizationMember,
  loadOrganizationMembers,
  removeOrganizationMember,
} from "../lib/api";
import { organizationLogoFromFile } from "../lib/organization-logo";
import type { OrganizationMember } from "../types";
import { OrganizationSettings } from "./OrganizationSettings";

vi.mock("../lib/api", () => ({
  addOrganizationMember: vi.fn(),
  loadOrganizationMembers: vi.fn(),
  removeOrganizationMember: vi.fn(),
}));
vi.mock("../lib/organization-logo", () => ({
  organizationLogoAccept: "image/jpeg,image/png,image/webp",
  organizationLogoFromFile: vi.fn(),
}));

const members: OrganizationMember[] = [
  {
    userId: "user-1",
    name: "Jay Nam",
    email: "jay@wordbricks.ai",
    image: null,
    role: "owner",
    createdAt: "2023-12-01T00:00:00Z",
  },
  {
    userId: "user-2",
    name: "Ian Jeon",
    email: "ian@wordbricks.ai",
    image: null,
    role: "admin",
    createdAt: "2024-12-01T00:00:00Z",
  },
];

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("OrganizationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadOrganizationMembers).mockResolvedValue(members);
    vi.mocked(addOrganizationMember).mockResolvedValue({ members });
    vi.mocked(removeOrganizationMember).mockResolvedValue(undefined);
    vi.mocked(organizationLogoFromFile).mockResolvedValue(
      "data:image/webp;base64,bG9nbw==",
    );
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("shows searchable members and opens the invite dialog", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <OrganizationSettings
          initialSection="members"
          organization={{
            id: "organization-1",
            name: "Wordbricks",
            handle: "wordbricks",
            logo: null,
            role: "owner",
            createdAt: "2023-12-01T00:00:00Z",
          }}
          onBack={() => undefined}
          onLogoChange={vi.fn()}
          onRename={vi.fn()}
          token="token"
        />,
      );
    });

    expect(container.textContent).toContain("멤버");
    expect(container.textContent).toContain("Jay Nam");
    expect(container.textContent).toContain("Ian Jeon");
    expect(container.textContent).toContain("CSV 내보내기");

    const search = container.querySelector<HTMLInputElement>(
      '[aria-label="멤버 검색"]',
    )!;
    await act(async () => {
      setInputValue(search, "Ian");
    });
    expect(container.textContent).not.toContain("Jay Nam");
    expect(container.textContent).toContain("Ian Jeon");

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "초대")
        ?.click();
    });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("멤버 초대");
    expect(document.activeElement).toBe(
      dialog?.querySelector('input[type="email"]'),
    );

    const email = dialog?.querySelector<HTMLInputElement>('input[type="email"]');
    await act(async () => {
      if (!email) return;
      setInputValue(email, "new@wordbricks.ai");
    });
    await act(async () => {
      dialog
        ?.querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(addOrganizationMember).toHaveBeenCalledWith(
      "token",
      "organization-1",
      { email: "new@wordbricks.ai", role: "member" },
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows the settings navigation and renames the organization", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onRename = vi.fn().mockResolvedValue({
      id: "organization-1",
      name: "Briar Labs",
      handle: "wordbricks",
      logo: null,
      role: "owner",
      createdAt: "2023-12-01T00:00:00Z",
    });

    await act(async () => {
      root.render(
        <OrganizationSettings
          organization={{
            id: "organization-1",
            name: "Wordbricks",
            handle: "wordbricks",
            logo: null,
            role: "owner",
            createdAt: "2023-12-01T00:00:00Z",
          }}
          onBack={() => undefined}
          onLogoChange={vi.fn()}
          onRename={onRename}
          token="token"
        />,
      );
    });

    expect(
      container.querySelector('[aria-label="조직 설정 메뉴"]')?.textContent,
    ).toContain("General");
    expect(
      container.querySelector('[aria-label="조직 설정 메뉴"]')?.textContent,
    ).toContain("멤버 및 초대");

    const nameInput = container.querySelector<HTMLInputElement>(
      "#organization-name",
    )!;
    await act(async () => {
      setInputValue(nameInput, "Briar Labs");
    });
    await act(async () => {
      nameInput.form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(onRename).toHaveBeenCalledWith("organization-1", "Briar Labs");
    expect(container.textContent).toContain("조직 이름을 저장했습니다.");

    await act(async () => root.unmount());
    container.remove();
  });

  it("uploads and saves an organization logo", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onLogoChange = vi.fn().mockResolvedValue({
      id: "organization-1",
      name: "Wordbricks",
      handle: "wordbricks",
      logo: "data:image/webp;base64,bG9nbw==",
      role: "owner",
      createdAt: "2023-12-01T00:00:00Z",
    });

    await act(async () => {
      root.render(
        <OrganizationSettings
          organization={{
            id: "organization-1",
            name: "Wordbricks",
            handle: "wordbricks",
            logo: null,
            role: "owner",
            createdAt: "2023-12-01T00:00:00Z",
          }}
          onBack={() => undefined}
          onLogoChange={onLogoChange}
          onRename={vi.fn()}
          token="token"
        />,
      );
    });

    const file = new File(["logo"], "logo.png", { type: "image/png" });
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="로고 업로드"]',
    )!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(organizationLogoFromFile).toHaveBeenCalledWith(file);
    expect(onLogoChange).toHaveBeenCalledWith(
      "organization-1",
      "data:image/webp;base64,bG9nbw==",
    );
    expect(container.textContent).toContain("조직 로고를 저장했습니다.");

    await act(async () => root.unmount());
    container.remove();
  });
});
