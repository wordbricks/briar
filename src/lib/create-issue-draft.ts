import { issueTitleAbsoluteMaxLength } from "./issue-title";

export const createIssueDraftStorageKey = "briar.create-issue-draft.v1";

export type CreateIssueDraft = {
  title: string;
  description: string;
  status: "backlog" | "queued";
  priority: "1" | "2" | "3" | "4";
  projectId: string;
  assigneeUserId?: string | null;
  preferredProvider?: string | null;
  preferredModel?: string | null;
  preferredEffort?: string | null;
  fullAuto?: boolean;
  checkpoints?: Array<{
    key: string;
    stage: string;
    position: "before" | "after";
  }>;
};

function isCreateIssueDraft(value: unknown): value is CreateIssueDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.title === "string" &&
    draft.title.length <= issueTitleAbsoluteMaxLength &&
    typeof draft.description === "string" &&
    draft.description.length <= 100000 &&
    (draft.status === "backlog" || draft.status === "queued") &&
    (draft.priority === "1" ||
      draft.priority === "2" ||
      draft.priority === "3" ||
      draft.priority === "4") &&
    typeof draft.projectId === "string" &&
    (draft.fullAuto === undefined || typeof draft.fullAuto === "boolean") &&
    (draft.checkpoints === undefined ||
      (Array.isArray(draft.checkpoints) &&
        draft.checkpoints.length <= 100 &&
        draft.checkpoints.every((checkpoint) => {
          if (!checkpoint || typeof checkpoint !== "object") return false;
          const candidate = checkpoint as Record<string, unknown>;
          return (
            typeof candidate.key === "string" &&
            typeof candidate.stage === "string" &&
            (candidate.position === "before" || candidate.position === "after")
          );
        }))) &&
    (draft.assigneeUserId === undefined ||
      draft.assigneeUserId === null ||
      typeof draft.assigneeUserId === "string") &&
    (draft.preferredProvider === undefined ||
      draft.preferredProvider === null ||
      typeof draft.preferredProvider === "string") &&
    (draft.preferredModel === undefined ||
      draft.preferredModel === null ||
      typeof draft.preferredModel === "string") &&
    (draft.preferredEffort === undefined ||
      draft.preferredEffort === null ||
      typeof draft.preferredEffort === "string")
  );
}

export function loadCreateIssueDraft(): CreateIssueDraft | null {
  try {
    const stored = window.localStorage.getItem(createIssueDraftStorageKey);
    if (!stored) return null;
    const draft: unknown = JSON.parse(stored);
    if (isCreateIssueDraft(draft)) return draft;
    window.localStorage.removeItem(createIssueDraftStorageKey);
  } catch {
    // A malformed or inaccessible local draft should not prevent issue creation.
  }
  return null;
}

export function saveCreateIssueDraft(draft: CreateIssueDraft) {
  try {
    if (
      !draft.title.trim() &&
      !draft.description.trim() &&
      !draft.fullAuto &&
      !draft.checkpoints?.length
    ) {
      window.localStorage.removeItem(createIssueDraftStorageKey);
      return;
    }
    window.localStorage.setItem(
      createIssueDraftStorageKey,
      JSON.stringify(draft),
    );
  } catch {
    // Issue creation remains available when browser storage is unavailable.
  }
}

export function clearCreateIssueDraft() {
  try {
    window.localStorage.removeItem(createIssueDraftStorageKey);
  } catch {
    // The submitted issue is already created, so storage cleanup is best effort.
  }
}
