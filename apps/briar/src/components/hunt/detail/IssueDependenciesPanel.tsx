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
  const relationList = (dependencies: NonNullable<HuntRun["prerequisites"]>, removable: boolean) => <ul className="issue-dependency-list m-0 grid list-none gap-1.5 p-0">
      {dependencies.map(dependency => <li className="flex min-w-0 items-center gap-1" key={dependency.id}>
          <button className="issue-dependency-link grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={!onOpen} onClick={() => onOpen?.(dependency.id)} type="button">
            <span className="font-mono text-2xs text-muted-foreground">{formatIssueKey(issueKeyPrefix, dependency.runNumber)}</span>
            <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium">{dependency.title}</strong>
            <small className="text-2xs text-muted-foreground">{t(`status.${dependency.status}` as MessageKey)}</small>
          </button>
          {removable && onRemove ? <button aria-label={t("issue.dependencyRemove", {
        title: dependency.title
      })} className="issue-dependency-remove grid size-7 shrink-0 place-items-center rounded-md border-0 bg-transparent text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={isUpdating} onClick={() => void mutate(() => onRemove(dependency.id))} type="button">
              {isUpdating ? <Spinner size={13} /> : <X size={13} />}
            </button> : null}
        </li>)}
    </ul>;
  return <section className="issue-dependencies mt-5 border-t border-border pt-4" aria-label={t("issue.dependencies")}>
      <header className="flex items-start gap-2">
        <span className="mt-0.5 text-primary"><Waypoints aria-hidden="true" size={16} /></span>
        <div>
          <strong className="block text-xs font-semibold">{t("issue.dependencies")}</strong>
          <small className="mt-0.5 block text-2xs text-muted-foreground">{t("issue.dependenciesDescription")}</small>
        </div>
      </header>
      <div className="issue-dependency-group mt-3 grid gap-1.5">
        <strong className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t("issue.prerequisites")}</strong>
        {(run.prerequisites ?? []).length > 0 ? relationList(run.prerequisites ?? [], true) : <p className="m-0 text-2xs text-muted-foreground">{t("issue.prerequisitesEmpty")}</p>}
      </div>
      {onAdd ? <div className="issue-dependency-add mt-2">
          <button aria-label={t("issue.dependencyAdd")} className="issue-dependency-add-button inline-flex min-h-8 items-center gap-1.5 rounded-md border border-dashed border-border bg-transparent px-2.5 text-2xs font-semibold text-muted-foreground outline-none hover:border-ring hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" disabled={isUpdating || candidates.length === 0} onClick={() => {
        setError(null);
        setSearchQuery("");
        setIsPickerOpen(true);
      }} type="button">
            {isUpdating ? <Spinner size={13} /> : <Plus size={13} />}
            {t("issue.dependencyAdd")}
          </button>
        </div> : null}
      <div className="issue-dependency-group mt-3 grid gap-1.5">
        <strong className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t("issue.dependents")}</strong>
        {(run.dependents ?? []).length > 0 ? relationList(run.dependents ?? [], false) : <p className="m-0 text-2xs text-muted-foreground">{t("issue.dependentsEmpty")}</p>}
      </div>
      {error ? <p className="issue-dependency-error mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-2xs text-destructive" role="alert">{error}</p> : null}
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
          <div aria-label={t("issue.prerequisites")} className="issue-dependency-picker-list grid max-h-[min(360px,45vh)] gap-1 overflow-y-auto rounded-lg border border-border p-1" role="listbox">
            {filteredCandidates.length > 0 ? filteredCandidates.map(candidate => <button className="issue-dependency-picker-item flex min-w-0 items-center justify-between gap-3 rounded-md border-0 bg-transparent px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={isUpdating} key={candidate.id} onClick={() => onAdd && void mutate(() => onAdd(candidate.id))} type="button">
                  <span className="issue-dependency-picker-copy grid min-w-0 gap-0.5">
                    <span className="font-mono text-2xs text-muted-foreground">
                      {formatIssueKey(issueKeyPrefix, candidate.runNumber)} · {t(`status.${candidate.status}` as MessageKey)}
                    </span>
                    <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium">{candidate.title}</strong>
                  </span>
                  {isUpdating ? <Spinner size={15} /> : <Plus size={15} />}
                </button>) : <p className="issue-dependency-picker-empty m-0 px-3 py-8 text-center text-xs text-muted-foreground">
                {normalizedSearchQuery ? t("issue.dependencyNoSearchResults") : t("issue.dependencyNoCandidates")}
              </p>}
          </div>
          {error ? <p className="issue-dependency-error rounded-md bg-destructive/10 px-2 py-1.5 text-2xs text-destructive" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button disabled={isUpdating} onClick={() => setIsPickerOpen(false)} type="button" variant="outline">
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>;
}
