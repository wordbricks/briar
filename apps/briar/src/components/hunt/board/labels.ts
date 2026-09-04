import { useMemo } from "react";

import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import type { BoardColumnDefinition } from "@/state/board/columns";
import { localizeWorkflowStage } from "../model/formatters";

/**
 * Turns a column definition into the text it shows.
 *
 * The definitions come from an atom and carry ids rather than sentences, which
 * is what let the grouping move out of the component in the first place; the
 * translator lives here, one level above the columns that render them.
 */
export function useBoardColumnLabels() {
  const { t } = useI18n();
  return useMemo(
    () => ({
      columnLabel: (definition: BoardColumnDefinition) =>
        definition.label.kind === "status"
          ? t(`status.${definition.label.status}` as MessageKey)
          : localizeWorkflowStage(
              t,
              definition.label.stageId,
              definition.label.fallbackLabel,
            ),
      checkpointLabels: (definition: BoardColumnDefinition) =>
        definition.checkpointsBefore.map((marker) => {
          const stage = localizeWorkflowStage(
            t,
            marker.stageId,
            marker.fallbackLabel,
          );
          return marker.position === "before"
            ? t("run.checkpointBefore", { stage })
            : t("run.checkpointAfter", { stage });
        }),
    }),
    [t],
  );
}
