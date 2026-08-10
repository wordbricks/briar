import { LoaderCircle, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "../i18n";
import type {
  DashboardPayload,
  ProjectAgent,
  ProjectAgentSkill,
} from "../types";
import { NativeSelect } from "./NativeSelect";

export type ProjectAgentTaskDialogSubmit = {
  request: string;
  skill: ProjectAgentSkill;
  workerId: string | null;
};

function availableWorkersForProvider(
  dashboard: DashboardPayload | null,
  provider: ProjectAgent["provider"],
) {
  return (dashboard?.workers ?? []).filter(
    (worker) =>
      (worker.providers ?? [worker.agentProvider]).includes(provider) &&
      worker.acceptingWork &&
      worker.readiness === "available",
  );
}

export function hasAvailableWorkerForAgentSkills(
  dashboard: DashboardPayload | null,
  agent: ProjectAgent,
) {
  return agent.skills.some(
    (skill) => availableWorkersForProvider(dashboard, skill.provider).length > 0,
  );
}

export function ProjectAgentTaskDialog({
  agent,
  companionMode = false,
  dashboard,
  isOpen,
  isSubmitting,
  onOpenChange,
  onSubmit,
}: {
  agent: ProjectAgent | null;
  companionMode?: boolean;
  dashboard: DashboardPayload | null;
  isOpen: boolean;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ProjectAgentTaskDialogSubmit) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [request, setRequest] = useState("");
  const selectedSkill = useMemo(
    () => agent?.skills.find((skill) => skill.id === selectedSkillId) ?? null,
    [agent, selectedSkillId],
  );
  const availableWorkers = useMemo(
    () => selectedSkill
      ? availableWorkersForProvider(dashboard, selectedSkill.provider)
      : [],
    [dashboard, selectedSkill],
  );
  const hasWorkerForAnySkill = useMemo(
    () => agent ? hasAvailableWorkerForAgentSkills(dashboard, agent) : false,
    [agent, dashboard],
  );

  useEffect(() => {
    if (!isOpen) return;
    setSelectedSkillId("");
    setSelectedWorkerId("");
    setRequest("");
  }, [agent?.id, isOpen]);

  useEffect(() => {
    if (!companionMode || !selectedSkill) {
      setSelectedWorkerId("");
      return;
    }
    setSelectedWorkerId((current) =>
      availableWorkers.some((worker) => worker.id === current)
        ? current
        : availableWorkers[0]?.id ?? ""
    );
  }, [availableWorkers, companionMode, selectedSkill]);

  return (
    <Dialog
      onOpenChange={onOpenChange}
      open={isOpen}
    >
      <DialogContent className="project-agent-task-dialog">
        <DialogHeader>
          <DialogTitle>{t("agents.taskTitle")}</DialogTitle>
          <DialogDescription>{t("agents.taskDescription")}</DialogDescription>
        </DialogHeader>

        <label className="project-agent-run-worker-select">
          <span>{t("agents.skill")}</span>
          <NativeSelect
            disabled={isSubmitting || !agent || agent.skills.length === 0}
            label={t("agents.skill")}
            onValueChange={(skillId) => {
              const nextSkill = agent?.skills.find(
                (skill) => skill.id === skillId,
              );
              setSelectedSkillId(skillId);
              setRequest(nextSkill?.instructions ?? "");
            }}
            options={(agent?.skills ?? []).map((skill) => ({
              label: skill.name,
              value: skill.id,
            }))}
            placeholder={t("agents.selectSkillPlaceholder")}
            value={selectedSkillId}
          />
        </label>

        {agent && agent.skills.length === 0 ? (
          <p className="text-xs text-destructive" role="alert">
            {t("agents.noRunnableSkills")}
          </p>
        ) : null}

        {companionMode && selectedSkill ? (
          <label className="project-agent-run-worker-select">
            <span>{t("agents.executionHost")}</span>
            <NativeSelect
              disabled={isSubmitting || availableWorkers.length === 0}
              label={t("agents.executionHost")}
              onValueChange={setSelectedWorkerId}
              options={availableWorkers.map((worker) => ({
                label: `${worker.icon?.type === "emoji" ? `${worker.icon.value} ` : ""}${worker.label}`,
                value: worker.id,
              }))}
              placeholder={t("agents.selectWorker")}
              value={selectedWorkerId}
            />
          </label>
        ) : null}

        {companionMode && selectedSkill && availableWorkers.length === 0 ? (
          <p className="text-xs text-destructive" role="alert">
            {hasWorkerForAnySkill
              ? t("agents.selectedSkillWorkerUnavailable")
              : t("agents.agentWorkerUnavailable")}
          </p>
        ) : null}

        <form
          className="project-agent-run-composer"
          id="project-agent-task-form"
          onSubmit={(event) => {
            event.preventDefault();
            const message = request.trim();
            if (
              !agent ||
              !selectedSkill ||
              !message ||
              isSubmitting ||
              !dashboard ||
              (companionMode && !selectedWorkerId)
            ) return;
            const submission = onSubmit({
              request: message,
              skill: selectedSkill,
              workerId: companionMode ? selectedWorkerId : null,
            });
            onOpenChange(false);
            void submission;
          }}
        >
          <Textarea
            aria-label={t("agents.taskInput")}
            disabled={isSubmitting || !selectedSkill}
            onChange={(event) => setRequest(event.target.value)}
            placeholder={t("agents.taskPlaceholder")}
            value={request}
          />
        </form>

        <DialogFooter>
          <Button
            disabled={
              !selectedSkill ||
              isSubmitting ||
              request.trim().length === 0 ||
              !dashboard ||
              (companionMode && !selectedWorkerId)
            }
            form="project-agent-task-form"
            type="submit"
          >
            {isSubmitting ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Play size={16} />
            )}
            {isSubmitting ? t("agents.running") : t("agents.runTask")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
