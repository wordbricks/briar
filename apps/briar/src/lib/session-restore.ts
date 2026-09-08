import { isApiErrorStatus } from "./api";
import type { Organization, Project, SessionUser } from "../types";

type SessionRestoreDependencies = {
  clearToken: () => Promise<void>;
  loadOrganizations: (
    token: string,
    signal?: AbortSignal,
  ) => Promise<Organization[]>;
  loadTeams: (token: string, signal?: AbortSignal) => Promise<Project[]>;
  loadSession: (token: string, signal?: AbortSignal) => Promise<SessionUser>;
  readToken: () => Promise<string | null>;
};

/** A cold restore either authenticates or exposes its retry path within 4s. */
export const SESSION_RESTORE_TIMEOUT_MS = 4_000;

export class SessionRestoreTimeoutError extends Error {
  constructor() {
    super("로그인 확인 시간이 초과되었습니다.");
    this.name = "SessionRestoreTimeoutError";
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

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
  loadTeams,
  loadSession,
  readToken,
}: SessionRestoreDependencies): Promise<SessionRestoreResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new SessionRestoreTimeoutError()),
    SESSION_RESTORE_TIMEOUT_MS,
  );
  const { signal } = controller;
  let token: string | null;
  try {
    token = await abortable(readToken(), signal);
  } catch (error) {
    clearTimeout(timeout);
    return { status: "retry", error };
  }
  if (!token) {
    clearTimeout(timeout);
    return { status: "missing" };
  }

  let user: SessionUser;
  try {
    user = await abortable(loadSession(token, signal), signal);
  } catch (error) {
    if (!isApiErrorStatus(error, 401)) {
      clearTimeout(timeout);
      return { status: "retry", error };
    }
    try {
      await abortable(clearToken(), signal);
    } catch (clearError) {
      clearTimeout(timeout);
      return { status: "retry", error: clearError };
    }
    clearTimeout(timeout);
    return { status: "unauthorized" };
  }

  try {
    const [projects, organizations] = await Promise.all([
      abortable(loadTeams(token, signal), signal),
      abortable(loadOrganizations(token, signal), signal),
    ]);
    clearTimeout(timeout);
    return {
      status: "authenticated",
      token,
      user,
      projects,
      organizations,
    };
  } catch (error) {
    clearTimeout(timeout);
    return { status: "retry", error };
  }
}
