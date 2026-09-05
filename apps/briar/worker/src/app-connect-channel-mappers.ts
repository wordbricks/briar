import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ChannelKind,
  ChannelDocumentContentSchema,
  ChannelLinkPreviewSchema,
  ChannelMemberRole,
  ChannelMemberSchema,
  ChannelSidebarSectionSchema,
  ChannelSummarySchema,
  ChannelVisibility,
  ChannelWebhookSchema,
  DirectMessageParticipant_Kind,
  DirectMessageParticipantSchema,
} from "@briar/contracts/gen/briar/app/v1/channel_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import * as Schema from "effect/Schema";
import type { ChannelSidebarSection } from "./channel-sidebar-repository";
import type {
  ChannelMessageDocumentRow,
  ChannelRow,
  ChannelWebhookRow,
} from "./channels";
import type { ChannelLinkPreview } from "./link-preview";

const requiredTimestamp = (value: string, field: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ConnectError(`Invalid ${field} timestamp`, Code.Internal);
  }
  return timestampFromDate(date);
};

const optionalTimestamp = (value: string | null, field: string) =>
  value === null ? undefined : requiredTimestamp(value, field);

const directMessageParticipantsFromJson = Schema.fromJsonString(
  Schema.Array(Schema.Struct({
    type: Schema.Literals(["user", "agent"]),
    id: Schema.String,
    name: Schema.String,
    image: Schema.NullOr(Schema.String),
  })),
);
const decodeDirectMessageParticipants = Schema.decodeUnknownSync(
  directMessageParticipantsFromJson,
);

const appDirectMessageParticipant = (
  participant: typeof directMessageParticipantsFromJson.Type[number],
) =>
  create(DirectMessageParticipantSchema, {
    kind: participant.type === "user"
      ? DirectMessageParticipant_Kind.USER
      : DirectMessageParticipant_Kind.AGENT,
    id: participant.id,
    name: participant.name,
    image: participant.image ?? undefined,
  });

const channelVisibility = {
  public: ChannelVisibility.PUBLIC,
  private: ChannelVisibility.PRIVATE,
} as const satisfies Record<ChannelRow["visibility"], ChannelVisibility>;

const channelKind = {
  channel: ChannelKind.CHANNEL,
  dm: ChannelKind.DIRECT_MESSAGE,
} as const satisfies Record<ChannelRow["kind"], ChannelKind>;

export const appChannelDocumentContent = (
  document: ChannelMessageDocumentRow,
) => create(ChannelDocumentContentSchema, {
  messageId: document.message_id,
  title: document.title,
  markdown: document.markdown,
  projectId: document.project_id ?? undefined,
});

export const appChannelLinkPreview = (preview: ChannelLinkPreview) =>
  create(ChannelLinkPreviewSchema, {
    url: preview.url,
    title: preview.title ?? undefined,
    description: preview.description ?? undefined,
    imageUrl: preview.imageUrl ?? undefined,
    faviconUrl: preview.faviconUrl ?? undefined,
    siteName: preview.siteName ?? undefined,
    imageWidth: preview.imageWidth ?? undefined,
    imageHeight: preview.imageHeight ?? undefined,
  });

/** Maps a channel repository row directly to the generated API DTO. */
export const appChannelSummary = (row: ChannelRow) =>
  create(ChannelSummarySchema, {
    id: row.id,
    organizationId: row.organization_id,
    slug: row.slug,
    name: row.name,
    topic: row.topic ?? undefined,
    visibility: channelVisibility[row.visibility],
    defaultProjectId: row.default_project_id ?? undefined,
    archivedAt: optionalTimestamp(row.archived_at, "Channel archive"),
    memberCount: row.member_count,
    agentCount: row.agent_count,
    createdAt: requiredTimestamp(row.created_at, "Channel creation"),
    updatedAt: requiredTimestamp(row.updated_at, "Channel update"),
    kind: channelKind[row.kind],
    lastMessageAt: optionalTimestamp(row.last_message_at, "Channel last message"),
    lastMessagePreview: row.last_message_preview ?? undefined,
    lastReadAt: optionalTimestamp(row.last_read_at, "Channel last read"),
    hasUnread: Boolean(
      row.last_unread_message_at &&
        (!row.last_read_at || row.last_unread_message_at > row.last_read_at),
    ),
    directMessageParticipants: row.dm_participants_json
      ? decodeDirectMessageParticipants(row.dm_participants_json).map(
          appDirectMessageParticipant,
        )
      : [],
    createdByUserId: row.created_by_user_id ?? undefined,
    pinnedAt: optionalTimestamp(row.sidebar_pinned_at, "Channel pin"),
    sidebarSectionId: row.sidebar_section_id ?? undefined,
    hiddenAt: optionalTimestamp(row.sidebar_hidden_at, "Channel hide"),
  });

/** One of the requesting member's own sidebar sections. */
export const appChannelSidebarSection = (section: ChannelSidebarSection) =>
  create(ChannelSidebarSectionSchema, {
    id: section.id,
    organizationId: section.organizationId,
    name: section.name,
    position: section.position,
    createdAt: requiredTimestamp(section.createdAt, "Sidebar section creation"),
    updatedAt: requiredTimestamp(section.updatedAt, "Sidebar section update"),
  });

type ChannelMemberRow = Awaited<
  ReturnType<typeof import("./channels").listChannelMembers>
>[number];

const channelMemberRole = {
  owner: ChannelMemberRole.OWNER,
  member: ChannelMemberRole.MEMBER,
} as const satisfies Record<ChannelMemberRow["role"], ChannelMemberRole>;

export const appChannelMember = (member: ChannelMemberRow) =>
  create(ChannelMemberSchema, {
    userId: member.userId,
    name: member.name,
    email: member.email,
    image: member.image ?? undefined,
    role: channelMemberRole[member.role],
    createdAt: requiredTimestamp(member.createdAt, "Channel membership creation"),
  });

export const appChannelWebhook = (row: ChannelWebhookRow) =>
  create(ChannelWebhookSchema, {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    active: row.revoked_at === null,
    lastUsedAt: optionalTimestamp(row.last_used_at, "Channel webhook last use"),
    createdAt: requiredTimestamp(row.created_at, "Channel webhook creation"),
    updatedAt: requiredTimestamp(row.updated_at, "Channel webhook update"),
  });
