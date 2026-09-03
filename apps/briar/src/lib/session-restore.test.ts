import { describe, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Organization, Project, SessionUser } from "../types";
import { ApiError } from "./api";
import { restoreStoredSession } from "./session-restore";

const user: SessionUser = {
  id: "user-1",
  name: "Briar User",
  email: "user@example.com",
};

const projects: Project[] = [
  {
    id: "project-1",
    name: "Briar",
    issueKeyPrefix: "BR",
    scheduleTabEnabled: true,
    icon: null,
    iconName: null,
    iconColor: null,
    organizationId: "organization-1",
    organizationName: "Briar",
    role: "owner",
    createdAt: "2026-07-25T00:00:00.000Z",
  },
];

const organizations: Organization[] = [
  {
    id: "organization-1",
    name: "Briar",
    handle: "briar",
    logo: null,
    role: "owner",
    createdAt: "2026-07-25T00:00:00.000Z",
  },
];

function createDependencies() {
  return {
    clearToken: vi.fn(async () => undefined),
    loadOrganizations: vi.fn(async () => organizations),
    loadProjects: vi.fn(async () => projects),
    loadSession: vi.fn(async () => user),
    readToken: vi.fn(async (): Promise<string | null> => "stored-token"),
  };
}

describe("restoreStoredSession", () => {
  it("returns missing without calling the API when no token is stored", async () => {
    const dependencies = createDependencies();
    dependencies.readToken.mockResolvedValue(null);

    await expect(restoreStoredSession(dependencies)).resolves.toEqual({
      status: "missing",
    });
    expect(dependencies.loadSession).not.toHaveBeenCalled();
    expect(dependencies.clearToken).not.toHaveBeenCalled();
  });

  it("clears the stored token only when the session endpoint returns 401", async () => {
    const dependencies = createDependencies();
    dependencies.loadSession.mockRejectedValue(
      new ApiError(401, "Unauthorized"),
    );

    await expect(restoreStoredSession(dependencies)).resolves.toEqual({
      status: "unauthorized",
    });
    expect(dependencies.clearToken).toHaveBeenCalledOnce();
    expect(dependencies.loadProjects).not.toHaveBeenCalled();
    expect(dependencies.loadOrganizations).not.toHaveBeenCalled();
  });

  it("clears the stored token when Connect wraps the 401 error", async () => {
    const dependencies = createDependencies();
    dependencies.loadSession.mockRejectedValue(
      new ConnectError(
        "Unauthorized",
        Code.Unknown,
        undefined,
        undefined,
        new ApiError(401, "Unauthorized"),
      ),
    );

    await expect(restoreStoredSession(dependencies)).resolves.toEqual({
      status: "unauthorized",
    });
    expect(dependencies.clearToken).toHaveBeenCalledOnce();
    expect(dependencies.loadProjects).not.toHaveBeenCalled();
    expect(dependencies.loadOrganizations).not.toHaveBeenCalled();
  });

  it("keeps the token and retries after a transient session error", async () => {
    const dependencies = createDependencies();
    const error = new TypeError("Failed to fetch");
    dependencies.loadSession.mockRejectedValue(error);

    await expect(restoreStoredSession(dependencies)).resolves.toEqual({
      status: "retry",
      error,
    });
    expect(dependencies.clearToken).not.toHaveBeenCalled();
  });

  it("keeps the token and retries when account data fails to load", async () => {
    const dependencies = createDependencies();
    const error = new ApiError(503, "Service unavailable");
    dependencies.loadOrganizations.mockRejectedValue(error);

    await expect(restoreStoredSession(dependencies)).resolves.toEqual({
      status: "retry",
      error,
    });
    expect(dependencies.clearToken).not.toHaveBeenCalled();
  });

  it("returns all restored account data after a successful request", async () => {
    const dependencies = createDependencies();

    await expect(restoreStoredSession(dependencies)).resolves.toEqual({
      status: "authenticated",
      token: "stored-token",
      user,
      projects,
      organizations,
    });
    expect(dependencies.clearToken).not.toHaveBeenCalled();
  });
});
