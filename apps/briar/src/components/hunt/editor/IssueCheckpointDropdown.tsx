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
        <button className="issue-checkpoint-trigger inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground outline-none hover:border-input hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55" disabled={disabled} ref={triggerRef} type="button">
          <Clock3 aria-hidden="true" size={13} />
          <span>{t("issue.checkpoints")}</span>
          {(checkpoints.length > 0 || inherited.size > 0) && <strong className="grid min-w-[17px] h-[17px] place-items-center rounded-full bg-[#765bd0] px-1 text-[9px] text-white">{checkpoints.length + inherited.size}</strong>}
          <ChevronDown aria-hidden="true" size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" className="issue-checkpoint-menu z-[130] max-h-[70vh] w-[min(340px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl" collisionPadding={10} sideOffset={6} style={{
        zIndex: menuZIndex
      }}>
          <DropdownMenu.Label className="issue-checkpoint-menu-heading px-2 py-1.5 text-2xs leading-relaxed text-muted-foreground">
            {t("issue.checkpointsDescription")}
          </DropdownMenu.Label>
          {workflow.stages.flatMap(stage => (["before", "after"] as const).map(position => {
          const boundary = `${stage.id}:${position}`;
          const locked = inherited.has(boundary);
          const checked = locked || selected.has(boundary);
          const stageLabel = localizeWorkflowStage(t, stage.id, stage.label);
          return <DropdownMenu.CheckboxItem checked={checked} className="issue-checkpoint-menu-item relative flex min-h-[34px] items-center gap-2 rounded-md px-2 py-1.5 pl-[30px] text-xs outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 [&>span:not(.issue-checkpoint-menu-check)]:min-w-0 [&>span:not(.issue-checkpoint-menu-check)]:flex-1 [&>small]:text-2xs [&>small]:text-muted-foreground" disabled={locked} key={boundary} onSelect={event => {
            event.preventDefault();
            if (locked) return;
            onChange(toggleIssueCheckpoint(checkpoints, stage.id, position));
          }}>
                  <DropdownMenu.ItemIndicator className="issue-checkpoint-menu-check absolute left-2 grid size-[18px] place-items-center text-[#654bb8]">
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
