import { GitBranch, Link2, ListTree, Plus, Waypoints, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { formatIssueKey } from "@/lib/issue-key";
import type { HuntRun, IssueDependencyReference } from "@/types";

type PickerMode = "parent" | "subIssue" | "related" | "dependency";

export function IssueDependenciesPanel({
  availableRuns,
  issueKeyPrefix,
  isUpdating,
  onAdd,
  onAddRelated,
  onCreateSubIssue,
  onLinkSubIssue,
  onOpen,
  onRemove,
  onRemoveRelated,
  onSetParent,
  onUnlinkSubIssue,
  run,
}: {
  availableRuns: HuntRun[];
  issueKeyPrefix?: string;
  isUpdating: boolean;
  onAdd?: (prerequisiteRunId: string) => Promise<unknown>;
  onAddRelated?: (relatedRunId: string) => Promise<unknown>;
  onCreateSubIssue?: () => void;
  onLinkSubIssue?: (childRunId: string) => Promise<unknown>;
  onOpen?: (runId: string) => void;
  onRemove?: (prerequisiteRunId: string) => Promise<unknown>;
  onRemoveRelated?: (relatedRunId: string) => Promise<unknown>;
  onSetParent?: (parentRunId: string | null) => Promise<unknown>;
  onUnlinkSubIssue?: (childRunId: string) => Promise<unknown>;
  run: HuntRun;
}) {
  const { t } = useI18n();
  const [pickerMode, setPickerMode] = useState<PickerMode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const candidates = availableRuns
    .filter((candidate) => {
      if (candidate.id === run.id) return false;
      if (pickerMode === "parent") return candidate.id !== run.parent?.id;
      if (pickerMode === "subIssue") {
        return !(run.subIssues ?? []).some((relation) => relation.id === candidate.id);
      }
      if (pickerMode === "related") {
        return !(run.relatedIssues ?? []).some((relation) => relation.id === candidate.id);
      }
      return !(run.prerequisites ?? []).some((relation) => relation.id === candidate.id);
    })
    .sort((left, right) => left.runNumber - right.runNumber);
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredCandidates = normalizedSearchQuery
    ? candidates.filter((candidate) => [
        candidate.title,
        formatIssueKey(issueKeyPrefix, candidate.runNumber),
        candidate.status,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedSearchQuery)))
    : candidates;

  const mutate = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      setPickerMode(null);
      setSearchQuery("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const openPicker = (mode: PickerMode) => {
    setError(null);
    setSearchQuery("");
    setPickerMode(mode);
  };
  const selectCandidate = (candidateId: string) => {
    if (pickerMode === "parent" && onSetParent) {
      return mutate(() => onSetParent(candidateId));
    }
    if (pickerMode === "subIssue" && onLinkSubIssue) {
      return mutate(() => onLinkSubIssue(candidateId));
    }
    if (pickerMode === "related" && onAddRelated) {
      return mutate(() => onAddRelated(candidateId));
    }
    if (pickerMode === "dependency" && onAdd) {
      return mutate(() => onAdd(candidateId));
    }
    return Promise.resolve();
  };
  const relationList = (
    relations: IssueDependencyReference[],
    remove?: (runId: string) => Promise<unknown>,
  ) => (
    <ul className="issue-dependency-list">
      {relations.map((relation) => (
        <li key={relation.id}>
          <button
            className="issue-dependency-link"
            disabled={!onOpen}
            onClick={() => onOpen?.(relation.id)}
            type="button"
          >
            <span>{formatIssueKey(issueKeyPrefix, relation.runNumber)}</span>
            <strong>{relation.title}</strong>
            <small>{t(`status.${relation.status}` as MessageKey)}</small>
          </button>
          {remove ? (
            <button
              aria-label={t("issue.relationRemove", { title: relation.title })}
              className="issue-dependency-remove"
              disabled={isUpdating}
              onClick={() => void mutate(() => remove(relation.id))}
              type="button"
            >
              {isUpdating ? <Spinner className="size-[13px]" /> : <X size={13} />}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
  const completedSubIssues = (run.subIssues ?? []).filter(
    (subIssue) => subIssue.status === "completed",
  ).length;
  const pickerTitle = pickerMode
    ? t(`issue.${pickerMode}PickerTitle` as MessageKey)
    : "";

  return (
    <section className="issue-dependencies" aria-label={t("issue.relationships")}>
      <header>
        <span><Waypoints aria-hidden="true" size={16} /></span>
        <div>
          <strong>{t("issue.relationships")}</strong>
          <small>{t("issue.relationshipsDescription")}</small>
        </div>
      </header>

      <div className="issue-dependency-group">
        <strong><ListTree aria-hidden="true" size={14} /> {t("issue.hierarchy")}</strong>
        <small>{t("issue.parent")}</small>
        {run.parent ? relationList([run.parent], onSetParent
          ? async () => onSetParent(null)
          : undefined) : <p>{t("issue.parentEmpty")}</p>}
        {onSetParent ? (
          <button
            className="issue-dependency-add-button"
            disabled={isUpdating}
            onClick={() => openPicker("parent")}
            type="button"
          >
            <GitBranch size={13} /> {t("issue.parentMove")}
          </button>
        ) : null}
        <small>{t("issue.subIssuesProgress", {
          completed: completedSubIssues,
          total: (run.subIssues ?? []).length,
        })}</small>
        {(run.subIssues ?? []).length > 0
          ? relationList(run.subIssues ?? [], onUnlinkSubIssue)
          : <p>{t("issue.subIssuesEmpty")}</p>}
        <div className="issue-dependency-add">
          {onLinkSubIssue ? (
            <button
              className="issue-dependency-add-button"
              disabled={isUpdating}
              onClick={() => openPicker("subIssue")}
              type="button"
            >
              <Plus size={13} /> {t("issue.subIssueLink")}
            </button>
          ) : null}
          {onCreateSubIssue ? (
            <button
              className="issue-dependency-add-button"
              disabled={isUpdating}
              onClick={onCreateSubIssue}
              type="button"
            >
              <Plus size={13} /> {t("issue.subIssueCreate")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="issue-dependency-group">
        <strong><Link2 aria-hidden="true" size={14} /> {t("issue.relatedIssues")}</strong>
        {(run.relatedIssues ?? []).length > 0
          ? relationList(run.relatedIssues ?? [], onRemoveRelated)
          : <p>{t("issue.relatedIssuesEmpty")}</p>}
        {onAddRelated ? (
          <button
            className="issue-dependency-add-button"
            disabled={isUpdating}
            onClick={() => openPicker("related")}
            type="button"
          >
            <Plus size={13} /> {t("issue.relatedIssueAdd")}
          </button>
        ) : null}
      </div>

      <div className="issue-dependency-group">
        <strong><Waypoints aria-hidden="true" size={14} /> {t("issue.executionDependencies")}</strong>
        <small>{t("issue.prerequisites")}</small>
        {(run.prerequisites ?? []).length > 0
          ? relationList(run.prerequisites ?? [], onRemove)
          : <p>{t("issue.prerequisitesEmpty")}</p>}
        {onAdd ? (
          <button
            className="issue-dependency-add-button"
            disabled={isUpdating}
            onClick={() => openPicker("dependency")}
            type="button"
          >
            <Plus size={13} /> {t("issue.dependencyAdd")}
          </button>
        ) : null}
        <small>{t("issue.dependents")}</small>
        {(run.dependents ?? []).length > 0
          ? relationList(run.dependents ?? [])
          : <p>{t("issue.dependentsEmpty")}</p>}
      </div>

      {error ? <p className="issue-dependency-error" role="alert">{error}</p> : null}
      <Dialog
        onOpenChange={(open) => {
          if (isUpdating) return;
          if (!open) {
            setPickerMode(null);
            setSearchQuery("");
            setError(null);
          }
        }}
        open={pickerMode !== null}
      >
        <DialogContent className="dependency-picker-dialog sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{pickerTitle}</DialogTitle>
            <DialogDescription>{t("issue.relationshipsDescription")}</DialogDescription>
          </DialogHeader>
          <Input
            aria-label={t("issue.relationSearch")}
            autoFocus
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("issue.relationSearch")}
            value={searchQuery}
          />
          <div className="issue-dependency-picker-list" role="listbox">
            {filteredCandidates.length > 0 ? filteredCandidates.map((candidate) => (
              <button
                className="issue-dependency-picker-item"
                disabled={isUpdating}
                key={candidate.id}
                onClick={() => void selectCandidate(candidate.id)}
                type="button"
              >
                <span className="issue-dependency-picker-copy">
                  <span>
                    {formatIssueKey(issueKeyPrefix, candidate.runNumber)} · {t(`status.${candidate.status}` as MessageKey)}
                  </span>
                  <strong>{candidate.title}</strong>
                </span>
                {isUpdating ? <Spinner className="size-[15px]" /> : <Plus size={15} />}
              </button>
            )) : (
              <p className="issue-dependency-picker-empty">
                {normalizedSearchQuery
                  ? t("issue.dependencyNoSearchResults")
                  : t("issue.relationNoCandidates")}
              </p>
            )}
          </div>
          {error ? <p className="issue-dependency-error" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button
              disabled={isUpdating}
              onClick={() => setPickerMode(null)}
              type="button"
              variant="outline"
            >
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
