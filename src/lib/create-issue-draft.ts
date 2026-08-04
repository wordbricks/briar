export const createIssueDraftStorageKey = "briar.create-issue-draft.v1";

export type CreateIssueDraft = {
  title: string;
  description: string;
  status: "backlog" | "queued";
  priority: "1" | "2" | "3" | "4";
  projectId: string;
  assigneeUserId?: string | null;
};

function isCreateIssueDraft(value: unknown): value is CreateIssueDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.title === "string" &&
    draft.title.length <= 300 &&
    typeof draft.description === "string" &&
    draft.description.length <= 100000 &&
    (draft.status === "backlog" || draft.status === "queued") &&
    (draft.priority === "1" ||
      draft.priority === "2" ||
      draft.priority === "3" ||
      draft.priority === "4") &&
    typeof draft.projectId === "string" &&
    (draft.assigneeUserId === undefined ||
      draft.assigneeUserId === null ||
      typeof draft.assigneeUserId === "string")
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
    if (!draft.title.trim() && !draft.description.trim()) {
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
