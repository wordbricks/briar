import {
  Bell,
  BellDot,
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useI18n } from "../i18n";
import type {
  ChannelSidebarSection,
  ChannelSummary,
} from "../lib/channels-contract";
import {
  directMessageDisplayName,
  directMessageParticipants,
  sortDirectMessages,
} from "../lib/direct-messages";
import { DirectMessageAvatar, formatConversationTime } from "./DirectMessages";
import { Spinner } from "./ui/spinner";
import { useToast } from "./ui/toast";

/*
  The sidebar's DMs half: the conversation list that used to sit beside the
  timeline inside the DM page. With the list here the page keeps its whole
  width for the conversation. It is a sidebar list, so it draws with the
  sidebar's tokens rather than the page's.

  How a conversation is arranged here — pinned, filed under one of the member's
  own sections, hidden — belongs to the member and lives on the server, so it
  survives a reinstall and agrees across devices. This component only renders
  the arrangement and hands each menu choice to the callbacks the shell wires to
  the channel actions.
*/

/** Everything the row and section menus can do, all optional. */
export interface SidebarDirectMessageActions {
  onCreateSection?: (name: string) => Promise<ChannelSidebarSection>;
  onDelete?: (channelId: string) => Promise<void>;
  onDeleteSection?: (sectionId: string) => Promise<void>;
  /** Opens organization settings on this Agent's editor. */
  onEditAgentProfile?: (agentId: string) => void;
  onMarkRead?: (channelId: string) => void;
  onMarkUnread?: (channelId: string) => Promise<void>;
  onMoveToSection?: (
    channelId: string,
    sectionId: string | null,
  ) => Promise<void>;
  onRenameSection?: (sectionId: string, name: string) => Promise<void>;
  onSetHidden?: (channelId: string, hidden: boolean) => Promise<void>;
  onSetPinned?: (channelId: string, pinned: boolean) => Promise<void>;
}

/** One rendered block of the list: an optional header plus its conversations. */
interface ConversationGroup {
  readonly key: string;
  readonly label: string | null;
  readonly section: ChannelSidebarSection | null;
  readonly channels: readonly ChannelSummary[];
}

const byActivity = (channels: readonly ChannelSummary[]) =>
  sortDirectMessages(channels);

/** Newest pin first, so pinning something moves it to the top of the group. */
const byPinnedAt = (channels: readonly ChannelSummary[]) =>
  [...channels].sort((left, right) =>
    (right.pinnedAt ?? "").localeCompare(left.pinnedAt ?? ""),
  );

export function SidebarDirectMessages({
  activeChannelId,
  composing,
  currentUserId,
  directMessages,
  loading = false,
  onCompose,
  onOpen,
  sections = [],
  ...actions
}: SidebarDirectMessageActions & {
  activeChannelId: string | null;
  /** A new conversation is being composed: no row is current, the New row is. */
  composing: boolean;
  currentUserId: string | null;
  directMessages: readonly ChannelSummary[];
  /** The catalog has not arrived yet, so an empty list is not "none". */
  loading?: boolean;
  onCompose: () => void;
  onOpen: (channelId: string) => void;
  /** The member's own sections, in position order. */
  sections?: readonly ChannelSidebarSection[];
}) {
  const { localeTag, t } = useI18n();
  const [search, setSearch] = useState("");
  const sorted = useMemo(
    () => byActivity(directMessages),
    [directMessages],
  );
  const query = search.trim().toLocaleLowerCase();
  const matches = useMemo(
    () =>
      sorted.filter((channel) =>
        directMessageDisplayName(channel, currentUserId)
          .toLocaleLowerCase()
          .includes(query),
      ),
    [currentUserId, query, sorted],
  );

  /*
    Searching looks through everything, hidden conversations included, and shows
    one flat list: a search result is an answer to "where is this one", not a
    view of how the sidebar is arranged.
  */
  const groups = useMemo<ConversationGroup[]>(() => {
    if (query) {
      return [{ key: "search", label: null, section: null, channels: matches }];
    }
    /*
      A hidden conversation leaves the list, except the one that is open: hiding
      what you are reading would leave the page and the sidebar disagreeing
      about where you are.
    */
    const listed = sorted.filter(
      (channel) => !channel.hiddenAt || channel.id === activeChannelId,
    );
    const pinned = byPinnedAt(listed.filter((channel) => channel.pinnedAt));
    const rest = listed.filter((channel) => !channel.pinnedAt);
    const sectionIds = new Set(sections.map((section) => section.id));
    const sectionGroups = sections.map((section) => ({
      key: `section:${section.id}`,
      label: section.name,
      section,
      channels: rest.filter(
        (channel) => channel.sidebarSectionId === section.id,
      ),
    }));
    const unassigned = rest.filter(
      (channel) =>
        !channel.sidebarSectionId || !sectionIds.has(channel.sidebarSectionId),
    );
    /*
      With nothing pinned and no sections the list is exactly what it was before
      grouping existed: one flat run of rows under no header at all.
    */
    const grouped = pinned.length > 0 || sections.length > 0;
    return [
      ...(pinned.length > 0
        ? [{
            key: "pinned",
            label: t("dm.pinned"),
            section: null,
            channels: pinned,
          }]
        : []),
      ...sectionGroups,
      {
        key: "unassigned",
        // Nothing to be unassigned from, or nothing left over: no header.
        label: grouped && unassigned.length > 0 ? t("dm.unassigned") : null,
        section: null,
        channels: unassigned,
      },
    ];
  }, [activeChannelId, matches, query, sections, sorted, t]);

  const visibleCount = groups.reduce(
    (total, group) => total + group.channels.length,
    0,
  );

  return (
    <section
      aria-label={t("dm.conversations")}
      className="sidebar-dms"
      data-testid="sidebar-dms"
    >
      <div className="sidebar-dm-toolbar">
        <label className="sidebar-dm-search">
          <Search aria-hidden="true" size={14} strokeWidth={1.8} />
          <input
            aria-label={t("dm.search")}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("dm.search")}
            type="search"
            value={search}
          />
        </label>
        <button
          aria-label={t("dm.new")}
          className="sidebar-dm-compose"
          onClick={onCompose}
          title={t("dm.new")}
          type="button"
        >
          <Plus aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className="sidebar-dm-list">
        <button
          aria-current={composing ? "page" : undefined}
          className={`sidebar-dm-new${composing ? " active" : ""}`}
          onClick={onCompose}
          type="button"
        >
          <span className="sidebar-dm-new-icon">
            <Plus aria-hidden="true" size={15} strokeWidth={1.8} />
          </span>
          <span>{t("dm.new")}</span>
        </button>
        {groups.map((group) => (
          <div className="sidebar-dm-group" key={group.key}>
            {group.label ? (
              group.section ? (
                <SidebarDirectMessageSectionHeading
                  actions={actions}
                  section={group.section}
                />
              ) : (
                <p className="sidebar-dm-group-heading">{group.label}</p>
              )
            ) : null}
            {group.channels.map((channel) => (
              <SidebarDirectMessageRow
                actions={actions}
                activeChannelId={activeChannelId}
                channel={channel}
                composing={composing}
                currentUserId={currentUserId}
                key={channel.id}
                localeTag={localeTag}
                onOpen={onOpen}
                sections={sections}
              />
            ))}
          </div>
        ))}
        {visibleCount === 0 ? (
          loading && sorted.length === 0 ? (
            <div
              aria-busy="true"
              className="sidebar-dm-empty"
              role="status"
            >
              <Spinner aria-hidden="true" className="size-4" />
            </div>
          ) : (
            <p className="sidebar-dm-empty">
              {query ? t("dm.noResults") : t("dm.empty")}
            </p>
          )
        ) : null}
      </div>
    </section>
  );
}

/** A section header, with the menu that renames or deletes the section. */
function SidebarDirectMessageSectionHeading({
  actions,
  section,
}: {
  actions: SidebarDirectMessageActions;
  section: ChannelSidebarSection;
}) {
  const { t } = useI18n();
  const [renameOpen, setRenameOpen] = useState(false);
  const canEdit = Boolean(actions.onRenameSection || actions.onDeleteSection);

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <p className="sidebar-dm-group-heading">{section.name}</p>
        </ContextMenu.Trigger>
        {canEdit ? (
          <ContextMenu.Portal>
            <ContextMenu.Content
              aria-label={t("dm.sectionMenu")}
              className="sidebar-channel-context-menu"
            >
              {actions.onRenameSection ? (
                <ContextMenu.Item
                  className="sidebar-channel-context-menu-item"
                  onSelect={() => setRenameOpen(true)}
                >
                  <Pencil aria-hidden="true" size={15} strokeWidth={1.7} />
                  <span>{t("dm.renameSection")}</span>
                </ContextMenu.Item>
              ) : null}
              {actions.onDeleteSection ? (
                <ContextMenu.Item
                  className="sidebar-channel-context-menu-item danger"
                  onSelect={() => {
                    void actions.onDeleteSection?.(section.id);
                  }}
                >
                  <Trash2 aria-hidden="true" size={15} strokeWidth={1.7} />
                  <span>{t("dm.deleteSection")}</span>
                </ContextMenu.Item>
              ) : null}
            </ContextMenu.Content>
          </ContextMenu.Portal>
        ) : null}
      </ContextMenu.Root>
      <SectionNameDialog
        confirmLabel={t("common.save")}
        description={t("dm.renameSectionDescription")}
        initialName={section.name}
        onOpenChange={setRenameOpen}
        onSubmit={async (name) => {
          await actions.onRenameSection?.(section.id, name);
        }}
        open={renameOpen}
        title={t("dm.renameSectionTitle", { name: section.name })}
      />
    </>
  );
}

function SidebarDirectMessageRow({
  actions,
  activeChannelId,
  channel,
  composing,
  currentUserId,
  localeTag,
  onOpen,
  sections,
}: {
  actions: SidebarDirectMessageActions;
  activeChannelId: string | null;
  channel: ChannelSummary;
  composing: boolean;
  currentUserId: string | null;
  localeTag: string;
  onOpen: (channelId: string) => void;
  sections: readonly ChannelSidebarSection[];
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [newSectionOpen, setNewSectionOpen] = useState(false);

  const name = directMessageDisplayName(channel, currentUserId);
  const participants = directMessageParticipants(channel, currentUserId);
  const isCurrent = !composing && channel.id === activeChannelId;
  const pinned = channel.pinnedAt !== null;
  const hidden = channel.hiddenAt !== null;
  // Several Agents in one conversation is rare; the first is the one the menu
  // offers, rather than a submenu nobody would use.
  const agent = participants.find(
    (participant) => participant.type === "agent",
  );

  const copyConversationId = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(channel.id);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = channel.id;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("Unable to copy text");
      }
      toast(t("dm.conversationIdCopied"), { tone: "success" });
    } catch {
      toast(t("channel.copyFailed"), { tone: "error" });
    }
  };

  const confirmDelete = async () => {
    if (!actions.onDelete || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await actions.onDelete(channel.id);
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
            aria-current={isCurrent ? "page" : undefined}
            className={`sidebar-dm-row${isCurrent ? " active" : ""}`}
            onClick={() => onOpen(channel.id)}
            type="button"
          >
            <DirectMessageAvatar label={name} participants={participants} />
            <span className="sidebar-dm-copy">
              <strong>{name}</strong>
              <small>{channel.lastMessagePreview ?? t("dm.noMessages")}</small>
            </span>
            <span className="sidebar-dm-meta">
              <time dateTime={channel.lastMessageAt ?? channel.createdAt}>
                {formatConversationTime(
                  channel.lastMessageAt ?? channel.createdAt,
                  localeTag,
                )}
              </time>
              {channel.hasUnread ? (
                <i aria-label={t("dm.unread")} className="sidebar-unread-dot" />
              ) : null}
            </span>
          </button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            aria-label={t("dm.contextMenu")}
            className="sidebar-channel-context-menu"
          >
            {actions.onSetPinned ? (
              <ContextMenu.Item
                className="sidebar-channel-context-menu-item"
                onSelect={() => {
                  void actions.onSetPinned?.(channel.id, !pinned);
                }}
              >
                {pinned ? (
                  <PinOff aria-hidden="true" size={15} strokeWidth={1.7} />
                ) : (
                  <Pin aria-hidden="true" size={15} strokeWidth={1.7} />
                )}
                <span>{pinned ? t("dm.unpin") : t("dm.pin")}</span>
              </ContextMenu.Item>
            ) : null}
            {actions.onMoveToSection ? (
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className="sidebar-channel-context-menu-item">
                  <Folder aria-hidden="true" size={15} strokeWidth={1.7} />
                  <span>{t("dm.moveTo")}</span>
                  <ChevronRight
                    aria-hidden="true"
                    className="sidebar-channel-context-menu-chevron"
                    size={14}
                    strokeWidth={1.7}
                  />
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className="sidebar-channel-context-menu">
                    {sections.map((section) => (
                      <ContextMenu.Item
                        className="sidebar-channel-context-menu-item"
                        key={section.id}
                        onSelect={() => {
                          void actions.onMoveToSection?.(
                            channel.id,
                            section.id,
                          );
                        }}
                      >
                        <FolderOpen
                          aria-hidden="true"
                          size={15}
                          strokeWidth={1.7}
                        />
                        <span>{section.name}</span>
                        {channel.sidebarSectionId === section.id ? (
                          <Check
                            aria-hidden="true"
                            className="sidebar-channel-context-menu-check"
                            size={14}
                            strokeWidth={2}
                          />
                        ) : null}
                      </ContextMenu.Item>
                    ))}
                    <ContextMenu.Item
                      className="sidebar-channel-context-menu-item"
                      onSelect={() => {
                        void actions.onMoveToSection?.(channel.id, null);
                      }}
                    >
                      <Folder aria-hidden="true" size={15} strokeWidth={1.7} />
                      <span>{t("dm.unassigned")}</span>
                      {!channel.sidebarSectionId ? (
                        <Check
                          aria-hidden="true"
                          className="sidebar-channel-context-menu-check"
                          size={14}
                          strokeWidth={2}
                        />
                      ) : null}
                    </ContextMenu.Item>
                    {actions.onCreateSection ? (
                      <>
                        <ContextMenu.Separator className="sidebar-channel-context-menu-separator" />
                        <ContextMenu.Item
                          className="sidebar-channel-context-menu-item"
                          onSelect={() => setNewSectionOpen(true)}
                        >
                          <Plus
                            aria-hidden="true"
                            size={15}
                            strokeWidth={1.7}
                          />
                          <span>{t("dm.newSection")}</span>
                        </ContextMenu.Item>
                      </>
                    ) : null}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
            ) : null}
            {channel.hasUnread ? (
              actions.onMarkRead ? (
                <ContextMenu.Item
                  className="sidebar-channel-context-menu-item"
                  onSelect={() => actions.onMarkRead?.(channel.id)}
                >
                  <Bell aria-hidden="true" size={15} strokeWidth={1.7} />
                  <span>{t("dm.markRead")}</span>
                </ContextMenu.Item>
              ) : null
            ) : actions.onMarkUnread ? (
              <ContextMenu.Item
                className="sidebar-channel-context-menu-item"
                onSelect={() => {
                  void actions.onMarkUnread?.(channel.id);
                }}
              >
                <BellDot aria-hidden="true" size={15} strokeWidth={1.7} />
                <span>{t("dm.markUnread")}</span>
              </ContextMenu.Item>
            ) : null}
            {agent && actions.onEditAgentProfile ? (
              <>
                <ContextMenu.Separator className="sidebar-channel-context-menu-separator" />
                <ContextMenu.Item
                  className="sidebar-channel-context-menu-item"
                  onSelect={() => actions.onEditAgentProfile?.(agent.id)}
                >
                  <Pencil aria-hidden="true" size={15} strokeWidth={1.7} />
                  <span>{t("dm.editProfile")}</span>
                </ContextMenu.Item>
              </>
            ) : null}
            <ContextMenu.Separator className="sidebar-channel-context-menu-separator" />
            <ContextMenu.Item
              className="sidebar-channel-context-menu-item"
              onSelect={() => {
                void copyConversationId();
              }}
            >
              <Copy aria-hidden="true" size={15} strokeWidth={1.7} />
              <span>{t("dm.copyConversationId")}</span>
            </ContextMenu.Item>
            {actions.onSetHidden || actions.onDelete ? (
              <ContextMenu.Separator className="sidebar-channel-context-menu-separator" />
            ) : null}
            {actions.onSetHidden ? (
              <ContextMenu.Item
                className="sidebar-channel-context-menu-item"
                onSelect={() => {
                  void actions.onSetHidden?.(channel.id, !hidden);
                }}
              >
                {hidden ? (
                  <Eye aria-hidden="true" size={15} strokeWidth={1.7} />
                ) : (
                  <EyeOff aria-hidden="true" size={15} strokeWidth={1.7} />
                )}
                <span>{hidden ? t("dm.show") : t("dm.hide")}</span>
              </ContextMenu.Item>
            ) : null}
            {actions.onDelete ? (
              <ContextMenu.Item
                className="sidebar-channel-context-menu-item danger"
                onSelect={() => {
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
              >
                <Trash2 aria-hidden="true" size={15} strokeWidth={1.7} />
                <span>{t("dm.delete")}</span>
              </ContextMenu.Item>
            ) : null}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <SectionNameDialog
        confirmLabel={t("dm.sectionCreate")}
        description={t("dm.newSectionDescription")}
        initialName=""
        onOpenChange={setNewSectionOpen}
        onSubmit={async (sectionName) => {
          const section = await actions.onCreateSection?.(sectionName);
          if (section) await actions.onMoveToSection?.(channel.id, section.id);
        }}
        open={newSectionOpen}
        title={t("dm.newSectionTitle")}
      />

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
          <Dialog.Overlay
            className="channel-create-overlay"
            data-briar-dialog-overlay=""
          />
          <Dialog.Content className="channel-create-dialog channel-delete-dialog">
            <header>
              <Dialog.Title>{t("dm.deleteTitle", { name })}</Dialog.Title>
              <Dialog.Description>
                {t("dm.deleteDescription")}
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
                {isDeleting ? t("dm.deleting") : t("dm.delete")}
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/** The one-field dialog both "New section…" and "Rename section…" use. */
function SectionNameDialog({
  confirmLabel,
  description,
  initialName,
  onOpenChange,
  onSubmit,
  open,
  title,
}: {
  confirmLabel: string;
  description: ReactNode;
  initialName: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<void>;
  open: boolean;
  title: ReactNode;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Opening the dialog is what fills the field, so a second visit after a
  // rename starts from the name the section has now rather than the old one.
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setError(null);
  }, [initialName, open]);

  const close = () => {
    if (isSaving) return;
    onOpenChange(false);
    setName(initialName);
    setError(null);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
      setName(initialName);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        if (nextOpen) onOpenChange(true);
        else close();
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className="channel-create-overlay"
          data-briar-dialog-overlay=""
        />
        <Dialog.Content className="channel-create-dialog sidebar-dm-section-dialog">
          <header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>{description}</Dialog.Description>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label htmlFor="sidebar-dm-section-name">
              {t("dm.sectionName")}
            </label>
            <input
              autoComplete="off"
              autoFocus
              disabled={isSaving}
              id="sidebar-dm-section-name"
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("dm.sectionNamePlaceholder")}
              value={name}
            />
            {error ? (
              <p className="channel-create-error" role="alert">
                {error}
              </p>
            ) : null}
            <footer>
              <div className="channel-create-actions">
                <button disabled={isSaving} onClick={close} type="button">
                  {t("common.cancel")}
                </button>
                <button disabled={isSaving || !name.trim()} type="submit">
                  {isSaving ? t("common.saving") : confirmLabel}
                </button>
              </div>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
