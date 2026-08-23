import { isApiErrorStatus } from "./api";
import type { Organization, Project, SessionUser } from "../types";

type SessionRestoreDependencies = {
  clearToken: () => Promise<void>;
  loadOrganizations: (token: string) => Promise<Organization[]>;
  loadProjects: (token: string) => Promise<Project[]>;
  loadSession: (token: string) => Promise<SessionUser>;
  readToken: () => Promise<string | null>;
};

export type SessionRestoreResult =
  | { status: "missing" }
  | { status: "unauthorized" }
  | {
      status: "authenticated";
      token: string;
      user: SessionUser;
      projects: Project[];
      organizations: Organization[];
    }
  | { status: "retry"; error: unknown };

export async function restoreStoredSession({
  clearToken,
  loadOrganizations,
  loadProjects,
  loadSession,
  readToken,
}: SessionRestoreDependencies): Promise<SessionRestoreResult> {
  let token: string | null;
  try {
    token = await readToken();
  } catch (error) {
    return { status: "retry", error };
  }
  if (!token) return { status: "missing" };

  let user: SessionUser;
  try {
    user = await loadSession(token);
  } catch (error) {
    if (!isApiErrorStatus(error, 401)) {
      return { status: "retry", error };
    }
    try {
      await clearToken();
    } catch (clearError) {
      return { status: "retry", error: clearError };
    }
    return { status: "unauthorized" };
  }

  try {
    const [projects, organizations] = await Promise.all([
      loadProjects(token),
      loadOrganizations(token),
    ]);
    return {
      status: "authenticated",
      token,
      user,
      projects,
      organizations,
    };
  } catch (error) {
    return { status: "retry", error };
  }
}
