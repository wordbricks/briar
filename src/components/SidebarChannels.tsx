import {
  ChevronRight,
  Copy,
  Hash,
  Link2,
  Lock,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { channelShareUrl } from "../lib/issue-links";
import { useToast } from "./ui/toast";
import {
  organizationSidebarChannels,
  projectSidebarChannels,
} from "../lib/channel-grouping";
import { channelHasUnread } from "../lib/channel-unread";
import type {
  ChannelSummary,
  ChannelVisibility,
} from "../lib/channels-contract";

type SidebarChannelPage = string;
type ChannelCreateStep = 1 | 2;

type ChannelOpenHandler = (channelId: string) => void;
type OrganizationRole = "owner" | "admin" | "member";

export function SidebarOrganizationChannels({
  activeChannelId,
  activePage,
  channels,
  channelsLoading,
  currentUserId,
  onChannelCreate,
  onChannelDelete,
  onChannelOpen,
  onChannelSettings,
  organizationRole,
}: {
  activeChannelId?: string | null;
  activePage: SidebarChannelPage;
  channels: readonly ChannelSummary[];
  channelsLoading: boolean;
  currentUserId?: string | null;
  onChannelCreate?: (
    name: string,
    visibility: ChannelVisibility,
  ) => Promise<void>;
  onChannelDelete?: (channelId: string) => Promise<void>;
  onChannelOpen: ChannelOpenHandler;
  onChannelSettings?: (channelId: string) => void;
  organizationRole?: OrganizationRole | null;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelVisibility, setChannelVisibility] =
    useState<ChannelVisibility>("public");
  const [createStep, setCreateStep] = useState<ChannelCreateStep>(1);
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
    setChannelVisibility("public");
    setCreateStep(1);
    setCreateError(null);
  };

  const submitCreate = async () => {
    const name = channelName.trim();
    if (!name || !onChannelCreate || isCreating) return;
    if (createStep === 1) {
      setCreateStep(2);
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    try {
      await onChannelCreate(name, channelVisibility);
      setIsCreateOpen(false);
      setChannelName("");
      setChannelVisibility("public");
      setCreateStep(1);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsCreating(false);
    }
  };

  const goBackFromCreate = () => {
    if (isCreating) return;
    if (createStep === 2) {
      setCreateStep(1);
      setCreateError(null);
      return;
    }
    closeCreate();
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
            <Hash aria-hidden="true" size={16} strokeWidth={1.7} />
            <span>{t("sidebar.channels")}</span>
            <ChevronRight
              aria-hidden="true"
              className={`sidebar-channels-chevron${expanded ? " open" : ""}`}
              size={14}
              strokeWidth={1.8}
            />
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
              currentUserId={currentUserId}
              key={channel.id}
              onDeleteChannel={onChannelDelete}
              onOpen={onChannelOpen}
              onSettings={onChannelSettings}
              organizationRole={organizationRole}
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
              {createStep === 1 ? (
                <>
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
                </>
              ) : (
                <fieldset
                  aria-label={t("channel.visibility")}
                  className="channel-visibility-fieldset"
                >
                  <legend>{t("channel.visibility")}</legend>
                  <div className="channel-visibility-options" role="radiogroup">
                    <label
                      className="channel-visibility-option"
                      data-selected={channelVisibility === "public"}
                    >
                      <input
                        checked={channelVisibility === "public"}
                        disabled={isCreating}
                        name="channel-visibility"
                        onChange={() => setChannelVisibility("public")}
                        type="radio"
                        value="public"
                      />
                      <span className="channel-visibility-option-content">
                        <strong>{t("channel.visibilityPublic")}</strong>
                        <small>{t("channel.visibilityPublicDescription")}</small>
                      </span>
                    </label>
                    <label
                      className="channel-visibility-option"
                      data-selected={channelVisibility === "private"}
                    >
                      <input
                        checked={channelVisibility === "private"}
                        disabled={isCreating}
                        name="channel-visibility"
                        onChange={() => setChannelVisibility("private")}
                        type="radio"
                        value="private"
                      />
                      <span className="channel-visibility-option-content">
                        <strong>{t("channel.visibilityPrivate")}</strong>
                        <small>{t("channel.visibilityPrivateDescription")}</small>
                      </span>
                    </label>
                  </div>
                </fieldset>
              )}
              {createError ? (
                <p className="channel-create-error" role="alert">
                  {createError}
                </p>
              ) : null}
              <footer>
                <span className="channel-create-step">
                  {t("channel.createStep", { step: createStep })}
                </span>
                <div className="channel-create-actions">
                  <button
                    disabled={isCreating}
                    onClick={goBackFromCreate}
                    type="button"
                  >
                    {createStep === 1
                      ? t("common.cancel")
                      : t("navigation.back")}
                  </button>
                  <button
                    disabled={isCreating || !channelName.trim()}
                    type="submit"
                  >
                    {createStep === 1
                      ? t("channel.next")
                      : isCreating
                        ? t("channel.creating")
                        : t("channel.create")}
                  </button>
                </div>
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
  currentUserId,
  onDeleteChannel,
  onOpen,
  onSettings,
  projectId,
  projectName,
  organizationRole,
}: {
  activeChannelId?: string | null;
  activePage: SidebarChannelPage;
  channels: readonly ChannelSummary[];
  channelsLoading: boolean;
  currentUserId?: string | null;
  onDeleteChannel?: (channelId: string) => Promise<void>;
  onOpen: ChannelOpenHandler;
  onSettings?: (channelId: string) => void;
  projectId: string;
  projectName: string;
  organizationRole?: OrganizationRole | null;
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
        <Hash aria-hidden="true" size={14} strokeWidth={1.7} />
        <span>{t("sidebar.channels")}</span>
        <ChevronRight
          aria-hidden="true"
          className={`sidebar-channels-chevron${expanded ? " open" : ""}`}
          size={14}
          strokeWidth={1.8}
        />
      </button>
      {expanded ? (
        <div className="sidebar-channel-list sidebar-project-channel-list" id={listId}>
          {projectChannels.map((channel) => (
            <SidebarChannelButton
              activeChannelId={activeChannelId}
              activePage={activePage}
              channel={channel}
              currentUserId={currentUserId}
              key={channel.id}
              onDeleteChannel={onDeleteChannel}
              onOpen={onOpen}
              onSettings={onSettings}
              organizationRole={organizationRole}
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
  currentUserId,
  onDeleteChannel,
  onOpen,
  onSettings,
  organizationRole,
}: {
  activeChannelId?: string | null;
  activePage: SidebarChannelPage;
  channel: ChannelSummary;
  currentUserId?: string | null;
  onDeleteChannel?: (channelId: string) => Promise<void>;
  onOpen: ChannelOpenHandler;
  onSettings?: (channelId: string) => void;
  organizationRole?: OrganizationRole | null;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const isActive = activePage === "channels" && channel.id === activeChannelId;
  const unread = !isActive && channelHasUnread(channel);
  const canDelete = Boolean(
    onDeleteChannel &&
      currentUserId &&
      (channel.createdByUserId === currentUserId || organizationRole === "owner"),
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const copyText = async (value: string, successMessage: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("Unable to copy text");
      }
      toast(successMessage, { tone: "success" });
    } catch {
      toast(t("channel.copyFailed"), { tone: "error" });
    }
  };

  const confirmDelete = async () => {
    if (!onDeleteChannel || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteChannel(channel.id);
      setDeleteOpen(false);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
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
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            aria-label={t("channel.contextMenu")}
            className="sidebar-channel-context-menu"
          >
            <ContextMenu.Item
              className="sidebar-channel-context-menu-item"
              onSelect={() => {
                void copyText(channel.id, t("channel.channelIdCopied"));
              }}
            >
              <Copy aria-hidden="true" size={15} strokeWidth={1.7} />
              <span>{t("channel.copyChannelId")}</span>
            </ContextMenu.Item>
            <ContextMenu.Item
              className="sidebar-channel-context-menu-item"
              onSelect={() => {
                void copyText(
                  channelShareUrl({
                    organizationId: channel.organizationId,
                    channelId: channel.id,
                  }),
                  t("channel.linkCopied"),
                );
              }}
            >
              <Link2 aria-hidden="true" size={15} strokeWidth={1.7} />
              <span>{t("channel.copyChannelLink")}</span>
            </ContextMenu.Item>
            {canDelete ? (
              <ContextMenu.Item
                className="sidebar-channel-context-menu-item danger"
                onSelect={() => {
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
              >
                <Trash2 aria-hidden="true" size={15} strokeWidth={1.7} />
                <span>{t("channel.delete")}</span>
              </ContextMenu.Item>
            ) : null}
            <ContextMenu.Separator className="sidebar-channel-context-menu-separator" />
            <ContextMenu.Item
              className="sidebar-channel-context-menu-item"
              onSelect={() => onSettings?.(channel.id)}
            >
              <Settings2 aria-hidden="true" size={15} strokeWidth={1.7} />
              <span>{t("channel.openSettings")}</span>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <Dialog.Root
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setDeleteOpen(false);
            setDeleteError(null);
          }
        }}
        open={deleteOpen}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="channel-create-overlay" />
          <Dialog.Content className="channel-create-dialog channel-delete-dialog">
            <header>
              <Dialog.Title>
                {t("channel.deleteTitle", { name: channel.name })}
              </Dialog.Title>
              <Dialog.Description>
                {t("channel.deleteDescription")}
              </Dialog.Description>
            </header>
            {deleteError ? (
              <p className="channel-create-error" role="alert">
                {deleteError}
              </p>
            ) : null}
            <footer>
              <button
                disabled={isDeleting}
                onClick={() => setDeleteOpen(false)}
                type="button"
              >
                {t("common.cancel")}
              </button>
              <button
                className="channel-delete-confirm"
                disabled={isDeleting}
                onClick={() => void confirmDelete()}
                type="button"
              >
                {isDeleting ? t("channel.deleting") : t("channel.delete")}
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
