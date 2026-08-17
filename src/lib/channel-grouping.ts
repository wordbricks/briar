import type { ChannelSummary } from "./channels-contract";

/**
 * A channel's project is its `defaultProjectId`. A channel without one belongs
 * to the whole organization; the Home list calls those common channels and
 * shows them first, because they are the channels every member can act on.
 */
export type ChannelGroup = {
  key: string;
  kind: "common" | "current-project" | "other-project";
  projectId: string | null;
  label: string;
  channels: ChannelSummary[];
};

export type ChannelGroupProject = { id: string; name: string };

const byName = (left: ChannelSummary, right: ChannelSummary) =>
  left.name.localeCompare(right.name) || left.id.localeCompare(right.id);

/** Channels with no `defaultProjectId` stay in the organization-wide list. */
export function organizationSidebarChannels(
  channels: readonly ChannelSummary[],
): ChannelSummary[] {
  return channels.filter((channel) => !channel.defaultProjectId);
}

/** Channels whose `defaultProjectId` matches the project belong under that project. */
export function projectSidebarChannels(
  channels: readonly ChannelSummary[],
  projectId: string,
): ChannelSummary[] {
  return channels.filter((channel) => channel.defaultProjectId === projectId);
}

/**
 * Orders groups as common, the active project, then every other project in the
 * organization by name. Archived channels are dropped, and a channel pointing
 * at a project the caller cannot see keeps a neutral label rather than
 * disappearing — the channel itself is still readable.
 */
export function groupChannels(
  channels: readonly ChannelSummary[],
  input: {
    activeProjectId: string | null;
    projects: readonly ChannelGroupProject[];
    commonLabel: string;
    unknownProjectLabel: string;
  },
): ChannelGroup[] {
  const projectNames = new Map(
    input.projects.map((project) => [project.id, project.name]),
  );
  const common: ChannelSummary[] = [];
  const byProject = new Map<string, ChannelSummary[]>();
  for (const channel of channels) {
    if (channel.archivedAt) continue;
    const projectId = channel.defaultProjectId;
    if (!projectId) {
      common.push(channel);
      continue;
    }
    const bucket = byProject.get(projectId);
    if (bucket) bucket.push(channel);
    else byProject.set(projectId, [channel]);
  }

  const groups: ChannelGroup[] = [];
  if (common.length > 0) {
    groups.push({
      key: "common",
      kind: "common",
      projectId: null,
      label: input.commonLabel,
      channels: common.sort(byName),
    });
  }
  const activeChannels = input.activeProjectId
    ? byProject.get(input.activeProjectId)
    : undefined;
  if (input.activeProjectId && activeChannels) {
    groups.push({
      key: input.activeProjectId,
      kind: "current-project",
      projectId: input.activeProjectId,
      label:
        projectNames.get(input.activeProjectId) ?? input.unknownProjectLabel,
      channels: activeChannels.sort(byName),
    });
  }
  const others = [...byProject.entries()]
    .filter(([projectId]) => projectId !== input.activeProjectId)
    .map(([projectId, projectChannels]) => ({
      key: projectId,
      kind: "other-project" as const,
      projectId,
      label: projectNames.get(projectId) ?? input.unknownProjectLabel,
      channels: projectChannels.sort(byName),
    }))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.projectId.localeCompare(right.projectId),
    );
  return [...groups, ...others];
}
