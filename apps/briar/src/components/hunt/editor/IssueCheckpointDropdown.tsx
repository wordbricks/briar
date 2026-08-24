import { Check, ChevronDown, Clock3 } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useLayoutEffect, useRef, useState } from "react";
import { type AutoHuntWorkflow, type AutoHuntWorkflowCheckpoint } from "@/lib/auto-hunt-contract";
import { useI18n } from "@/i18n";
import { checkpointBoundaryKey, toggleIssueCheckpoint } from "../model/checkpoints";
import { localizeWorkflowStage } from "../model/formatters";
export const checkpointMenuDefaultZIndex = 130;
export function getCheckpointMenuZIndex(trigger: HTMLElement) {
  let zIndex = checkpointMenuDefaultZIndex;
  let ancestor = trigger.parentElement;
  while (ancestor) {
    const ancestorZIndex = Number.parseInt(window.getComputedStyle(ancestor).zIndex, 10);
    if (Number.isFinite(ancestorZIndex)) {
      zIndex = Math.max(zIndex, ancestorZIndex + 1);
    }
    ancestor = ancestor.parentElement;
  }
  return zIndex;
}
export function IssueCheckpointDropdown({
  checkpoints,
  disabled = false,
  onChange,
  workflow
}: {
  checkpoints: AutoHuntWorkflowCheckpoint[];
  disabled?: boolean;
  onChange: (checkpoints: AutoHuntWorkflowCheckpoint[]) => void;
  workflow: AutoHuntWorkflow;
}) {
  const {
    t
  } = useI18n();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuZIndex, setMenuZIndex] = useState(checkpointMenuDefaultZIndex);
  const inherited = new Set(workflow.execution.checkpoints.map(checkpointBoundaryKey));
  const selected = new Set(checkpoints.map(checkpointBoundaryKey));
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setMenuZIndex(getCheckpointMenuZIndex(trigger));
  }, []);
  return <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="issue-checkpoint-trigger" disabled={disabled} ref={triggerRef} type="button">
          <Clock3 aria-hidden="true" size={13} />
          <span>{t("issue.checkpoints")}</span>
          {(checkpoints.length > 0 || inherited.size > 0) && <strong>{checkpoints.length + inherited.size}</strong>}
          <ChevronDown aria-hidden="true" size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" className="issue-checkpoint-menu" collisionPadding={10} sideOffset={6} style={{
        zIndex: menuZIndex
      }}>
          <DropdownMenu.Label className="issue-checkpoint-menu-heading">
            {t("issue.checkpointsDescription")}
          </DropdownMenu.Label>
          {workflow.stages.flatMap(stage => (["before", "after"] as const).map(position => {
          const boundary = `${stage.id}:${position}`;
          const locked = inherited.has(boundary);
          const checked = locked || selected.has(boundary);
          const stageLabel = localizeWorkflowStage(t, stage.id, stage.label);
          return <DropdownMenu.CheckboxItem checked={checked} className="issue-checkpoint-menu-item" disabled={locked} key={boundary} onSelect={event => {
            event.preventDefault();
            if (locked) return;
            onChange(toggleIssueCheckpoint(checkpoints, stage.id, position));
          }}>
                  <DropdownMenu.ItemIndicator className="issue-checkpoint-menu-check">
                    <Check aria-hidden="true" size={13} />
                  </DropdownMenu.ItemIndicator>
                  <span>
                    {position === "before" ? t("run.checkpointBefore", {
                stage: stageLabel
              }) : t("run.checkpointAfter", {
                stage: stageLabel
              })}
                  </span>
                  {locked && <small>{t("issue.checkpointRequired")}</small>}
                </DropdownMenu.CheckboxItem>;
        }))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>;
}
