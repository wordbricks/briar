import { Plus, Waypoints, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { formatIssueKey } from "@/lib/issue-key";
import type { HuntRun } from "@/types";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
export function IssueDependenciesPanel({
  availableRuns,
  issueKeyPrefix,
  isUpdating,
  onAdd,
  onOpen,
  onRemove,
  run
}: {
  availableRuns: HuntRun[];
  issueKeyPrefix?: string;
  isUpdating: boolean;
  onAdd?: (prerequisiteRunId: string) => Promise<unknown>;
  onOpen?: (runId: string) => void;
  onRemove?: (prerequisiteRunId: string) => Promise<unknown>;
  run: HuntRun;
}) {
  const {
    t
  } = useI18n();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const prerequisiteIds = new Set((run.prerequisites ?? []).map(dependency => dependency.id));
  const candidates = availableRuns.filter(candidate => candidate.id !== run.id && !prerequisiteIds.has(candidate.id)).sort((left, right) => left.runNumber - right.runNumber);
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredCandidates = normalizedSearchQuery ? candidates.filter(candidate => [candidate.title, formatIssueKey(issueKeyPrefix, candidate.runNumber), candidate.status].some(value => value.toLocaleLowerCase().includes(normalizedSearchQuery))) : candidates;
  const mutate = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const relationList = (dependencies: NonNullable<HuntRun["prerequisites"]>, removable: boolean) => <ul className="issue-dependency-list">
      {dependencies.map(dependency => <li key={dependency.id}>
          <button className="issue-dependency-link" disabled={!onOpen} onClick={() => onOpen?.(dependency.id)} type="button">
            <span>{formatIssueKey(issueKeyPrefix, dependency.runNumber)}</span>
            <strong>{dependency.title}</strong>
            <small>{t(`status.${dependency.status}` as MessageKey)}</small>
          </button>
          {removable && onRemove ? <button aria-label={t("issue.dependencyRemove", {
        title: dependency.title
      })} className="issue-dependency-remove" disabled={isUpdating} onClick={() => void mutate(() => onRemove(dependency.id))} type="button">
              {isUpdating ? <Spinner size={13} /> : <X size={13} />}
            </button> : null}
        </li>)}
    </ul>;
  return <section className="issue-dependencies" aria-label={t("issue.dependencies")}>
      <header>
        <span><Waypoints aria-hidden="true" size={16} /></span>
        <div>
          <strong>{t("issue.dependencies")}</strong>
          <small>{t("issue.dependenciesDescription")}</small>
        </div>
      </header>
      <div className="issue-dependency-group">
        <strong>{t("issue.prerequisites")}</strong>
        {(run.prerequisites ?? []).length > 0 ? relationList(run.prerequisites ?? [], true) : <p>{t("issue.prerequisitesEmpty")}</p>}
      </div>
      {onAdd ? <div className="issue-dependency-add">
          <button aria-label={t("issue.dependencyAdd")} className="issue-dependency-add-button" disabled={isUpdating || candidates.length === 0} onClick={() => {
        setError(null);
        setSearchQuery("");
        setIsPickerOpen(true);
      }} type="button">
            {isUpdating ? <Spinner size={13} /> : <Plus size={13} />}
            {t("issue.dependencyAdd")}
          </button>
        </div> : null}
      <div className="issue-dependency-group">
        <strong>{t("issue.dependents")}</strong>
        {(run.dependents ?? []).length > 0 ? relationList(run.dependents ?? [], false) : <p>{t("issue.dependentsEmpty")}</p>}
      </div>
      {error ? <p className="issue-dependency-error" role="alert">{error}</p> : null}
      <Dialog onOpenChange={open => {
      if (isUpdating) return;
      setIsPickerOpen(open);
      if (!open) {
        setSearchQuery("");
        setError(null);
      }
    }} open={isPickerOpen}>
        <DialogContent className="dependency-picker-dialog sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("issue.dependencyPickerTitle")}</DialogTitle>
            <DialogDescription>{t("issue.dependenciesDescription")}</DialogDescription>
          </DialogHeader>
          <Input aria-label={t("issue.dependencySearch")} autoFocus onChange={event => setSearchQuery(event.target.value)} placeholder={t("issue.dependencySearch")} value={searchQuery} />
          <div aria-label={t("issue.prerequisites")} className="issue-dependency-picker-list" role="listbox">
            {filteredCandidates.length > 0 ? filteredCandidates.map(candidate => <button className="issue-dependency-picker-item" disabled={isUpdating} key={candidate.id} onClick={() => onAdd && void mutate(() => onAdd(candidate.id))} type="button">
                  <span className="issue-dependency-picker-copy">
                    <span>
                      {formatIssueKey(issueKeyPrefix, candidate.runNumber)} · {t(`status.${candidate.status}` as MessageKey)}
                    </span>
                    <strong>{candidate.title}</strong>
                  </span>
                  {isUpdating ? <Spinner size={15} /> : <Plus size={15} />}
                </button>) : <p className="issue-dependency-picker-empty">
                {normalizedSearchQuery ? t("issue.dependencyNoSearchResults") : t("issue.dependencyNoCandidates")}
              </p>}
          </div>
          {error ? <p className="issue-dependency-error" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button disabled={isUpdating} onClick={() => setIsPickerOpen(false)} type="button" variant="outline">
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>;
}
