import { agentSkillJson } from "./agent-skills";
import type { StoredCodexPet } from "./codex-pets";
import type { ProjectAgentRow } from "./project-agent-model";

export const projectAgentJson = (row: ProjectAgentRow) => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  avatar: row.avatar,
  codexPet: row.avatar_pet_json
    ? {
        ...(JSON.parse(row.avatar_pet_json) as StoredCodexPet),
        spriteSheetUrl: row.avatar_spritesheet_object_key
          ? `/projects/${row.project_id}/agents/${row.id}/spritesheet`
          : null,
      }
    : null,
  provider: row.provider,
  model: row.model,
  effort: row.effort,
  computerUsePolicy: row.computer_use_policy,
  designatedWorkerId: row.designated_worker_id,
  designatedWorkerLabel: row.designated_worker_label,
  description: row.description,
  responsibility: row.responsibility,
  skill: row.skill_markdown,
  skills: (row.skills ?? []).map(agentSkillJson),
  calendarColor: row.calendar_color,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
