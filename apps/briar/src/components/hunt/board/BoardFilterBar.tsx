import { useAtom, useAtomValue } from "@effect/atom-react";

import { Typography } from "@/components/ui/typography";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import {
  boardRunCountAtom,
  boardSourceAtom,
  boardStatusAtom,
  boardStatusCountsAtom,
} from "@/state/board/atoms";

/*
  The three pieces of board chrome that count runs.

  They are separate components because each subscribes to a number that a run
  edit does not move: keeping them out of the board's own body is what lets the
  header, the search box and the view switch stay put while a card changes.
*/

/** The "N tasks" line beside the page title. */
export function BoardTaskCount({ teamId }: { teamId: string }) {
  const { t } = useI18n();
  const count = useAtomValue(boardRunCountAtom(teamId));
  return (
    <Typography as="span" className="queue-task-count" tone="muted" variant="caption">
      {t("dashboard.taskCount", { count })}
    </Typography>
  );
}

/** The four status tabs and the totals behind them. */
export function BoardStatusTabs({ teamId }: { teamId: string }) {
  const { t } = useI18n();
  const counts = useAtomValue(boardStatusCountsAtom(teamId));
  const [status, setStatus] = useAtom(boardStatusAtom);
  return <div className="status-tabs">
      <button className={status === "all" ? "active" : ""} onClick={() => setStatus("all")} type="button">
        {t("dashboard.all")} <span>{counts.all}</span>
      </button>
      <button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")} type="button">
        {t("dashboard.active")} <span>{counts.active}</span>
      </button>
      <button className={status === "attention" ? "active" : ""} onClick={() => setStatus("attention")} type="button">
        {t("dashboard.attention")} <span>{counts.attention}</span>
      </button>
      <button className={status === "completed" ? "active" : ""} onClick={() => setStatus("completed")} type="button">
        {t("dashboard.completed")} <span>{counts.completed}</span>
      </button>
    </div>;
}

/** The issue source tabs, shared by the desktop board and the phone stream. */
export function BoardSourceFilter() {
  const { t } = useI18n();
  const [source, setSource] = useAtom(boardSourceAtom);
  return <div className="source-filter-group">
      <span>{t("dashboard.type")}</span>
      <div className="source-filter">
        {(["all", "issue", "feedback", "error"] as const).map(value => <button className={source === value ? "active" : ""} key={value} onClick={() => setSource(value)} type="button">
            {value === "all" ? t("dashboard.all") : t(`source.${value}` as MessageKey)}
          </button>)}
      </div>
    </div>;
}
