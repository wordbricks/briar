import { ChevronRight, Hash, Lock, Plus } from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import {
  organizationSidebarChannels,
  projectSidebarChannels,
} from "../lib/channel-grouping";
import { channelHasUnread } from "../lib/channel-unread";
import type { ChannelSummary } from "../lib/channels-contract";

type SidebarChannelPage = string;

type ChannelOpenHandler = (channelId: string) => void;

export function SidebarOrganizationChannels({
  activeChannelId,
  activePage,
  channels,
  channelsLoading,
  onChannelCreate,
  onChannelOpen,
}: {
  activeChannelId?: string | null;
  activePage: SidebarChannelPage;
  channels: readonly ChannelSummary[];
  channelsLoading: boolean;
  onChannelCreate?: (name: string) => Promise<void>;
  onChannelOpen: ChannelOpenHandler;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const unlinkedChannels = useMemo(
    () => organizationSidebarChannels(channels),
    [channels],
  );
  const viewingUnlinkedChannel =
    activePage === "channels" &&
    !channels.find((channel) => channel.id === activeChannelId)?.defaultProjectId;

  useEffect(() => {
    if (activePage === "channels") setExpanded(true);
  }, [activePage]);

  const closeCreate = () => {
    if (isCreating) return;
    setIsCreateOpen(false);
    setChannelName("");
    setCreateError(null);
  };

  const submitCreate = async () => {
    const name = channelName.trim();
    if (!name || !onChannelCreate || isCreating) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      await onChannelCreate(name);
      setIsCreateOpen(false);
      setChannelName("");
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="sidebar-channels">
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <button
            aria-controls="sidebar-channel-list"
            aria-expanded={expanded}
            aria-label={
              expanded
                ? t("sidebar.collapseChannels")
                : t("sidebar.expandChannels")
            }
            className={`sidebar-channels-toggle${
              viewingUnlinkedChannel ? " active" : ""
            }`}
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            <ChevronRight
              aria-hidden="true"
              className={expanded ? "open" : ""}
              size={14}
              strokeWidth={1.8}
            />
            <Hash aria-hidden="true" size={16} strokeWidth={1.7} />
            <span>{t("sidebar.channels")}</span>
          </button>
        </ContextMenu.Trigger>
        {onChannelCreate ? (
          <ContextMenu.Portal>
            <ContextMenu.Content className="sidebar-channel-context-menu">
              <ContextMenu.Item
                className="sidebar-channel-context-menu-item"
                onSelect={() => {
                  setCreateError(null);
                  setIsCreateOpen(true);
                }}
              >
                <Plus aria-hidden="true" size={15} strokeWidth={1.7} />
                <span>{t("sidebar.addChannel")}</span>
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        ) : null}
      </ContextMenu.Root>

      {expanded ? (
        <div className="sidebar-channel-list" id="sidebar-channel-list">
          {unlinkedChannels.map((channel) => (
            <SidebarChannelButton
              activeChannelId={activeChannelId}
              activePage={activePage}
              channel={channel}
              key={channel.id}
              onOpen={onChannelOpen}
            />
          ))}
          {!channelsLoading && unlinkedChannels.length === 0 ? (
            <p>{t("sidebar.noChannels")}</p>
          ) : null}
        </div>
      ) : null}

      <Dialog.Root
        onOpenChange={(open) => {
          if (!open) closeCreate();
        }}
        open={isCreateOpen}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="channel-create-overlay" />
          <Dialog.Content className="channel-create-dialog">
            <header>
              <Dialog.Title>{t("channel.createTitle")}</Dialog.Title>
              <Dialog.Description>
                {t("channel.createDescription")}
              </Dialog.Description>
            </header>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitCreate();
              }}
            >
              <label htmlFor="new-channel-name">{t("channel.name")}</label>
              <input
                autoComplete="off"
                autoFocus
                disabled={isCreating}
                id="new-channel-name"
                maxLength={100}
                onChange={(event) => setChannelName(event.target.value)}
                placeholder={t("channel.namePlaceholder")}
                value={channelName}
              />
              {createError ? (
                <p className="channel-create-error" role="alert">
                  {createError}
                </p>
              ) : null}
              <footer>
                <button
                  disabled={isCreating}
                  onClick={closeCreate}
                  type="button"
                >
                  {t("common.cancel")}
                </button>
                <button
                  disabled={isCreating || !channelName.trim()}
                  type="submit"
                >
                  {isCreating ? t("channel.creating") : t("channel.create")}
                </button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

export function SidebarProjectChannels({
  activeChannelId,
  activePage,
  channels,
  channelsLoading,
  onOpen,
  projectId,
  projectName,
}: {
  activeChannelId?: string | null;
  activePage: SidebarChannelPage;
  channels: readonly ChannelSummary[];
  channelsLoading: boolean;
  onOpen: ChannelOpenHandler;
  projectId: string;
  projectName: string;
}) {
  const { t } = useI18n();
  const projectChannels = useMemo(
    () => projectSidebarChannels(channels, projectId),
    [channels, projectId],
  );
  const hasActiveChannel =
    activePage === "channels" &&
    projectChannels.some((channel) => channel.id === activeChannelId);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (hasActiveChannel) setExpanded(true);
  }, [hasActiveChannel]);

  const listId = `project-channel-list-${projectId}`;
  return (
    <div className="sidebar-project-channels">
      <button
        aria-controls={listId}
        aria-expanded={expanded}
        aria-label={
          expanded
            ? t("sidebar.collapseProjectChannels", { name: projectName })
            : t("sidebar.expandProjectChannels", { name: projectName })
        }
        className={`sidebar-channels-toggle sidebar-project-channels-toggle${
          hasActiveChannel ? " active" : ""
        }`}
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <ChevronRight
          aria-hidden="true"
          className={expanded ? "open" : ""}
          size={14}
          strokeWidth={1.8}
        />
        <Hash aria-hidden="true" size={14} strokeWidth={1.7} />
        <span>{t("sidebar.channels")}</span>
      </button>
      {expanded ? (
        <div className="sidebar-channel-list sidebar-project-channel-list" id={listId}>
          {projectChannels.map((channel) => (
            <SidebarChannelButton
              activeChannelId={activeChannelId}
              activePage={activePage}
              channel={channel}
              key={channel.id}
              onOpen={onOpen}
            />
          ))}
          {!channelsLoading && projectChannels.length === 0 ? (
            <p>{t("sidebar.noChannels")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SidebarChannelButton({
  activeChannelId,
  activePage,
  channel,
  onOpen,
}: {
  activeChannelId?: string | null;
  activePage: SidebarChannelPage;
  channel: ChannelSummary;
  onOpen: ChannelOpenHandler;
}) {
  const isActive = activePage === "channels" && channel.id === activeChannelId;
  const unread = !isActive && channelHasUnread(channel);
  return (
    <button
      aria-current={isActive ? "page" : undefined}
      className={[isActive ? "active" : "", unread ? "unread" : ""]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onOpen(channel.id)}
      type="button"
    >
      {channel.visibility === "private" ? (
        <Lock aria-hidden="true" size={14} strokeWidth={1.7} />
      ) : (
        <Hash aria-hidden="true" size={14} strokeWidth={1.7} />
      )}
      <span>{channel.name}</span>
    </button>
  );
}
