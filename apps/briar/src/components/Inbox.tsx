import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BellRing,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Inbox as InboxIcon,
  Mail,
  Siren,
} from "lucide-react";

import { EmptyState, MainContent, PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { SelectMenu } from "./SelectMenu";
import { useAppCollectionKeyboardCommandScope } from "../hooks/useAppCollectionKeyboardCommandScope";
import { useControlledCollectionNavigation } from "../hooks/useControlledCollectionNavigation";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import { autoHuntWorkflowStageCatalog } from "../lib/auto-hunt-contract";
import type { Project } from "../types";
import { ProjectIcon } from "./ProjectIcon";
import {
  classifyInboxMessage,
  type InboxCategory,
  type InboxIssueMessage,
  type InboxMessageWithReadState,
} from "../hooks/useInbox";

/** Number of filtered inbox rows revealed per page while scrolling. */
export const INBOX_PAGE_SIZE = 50;

/** Distance from the bottom of the scroll container that triggers the next page. */
const INBOX_LOAD_MORE_THRESHOLD_PX = 240;

const inboxFilters = [
  "urgent",
  "action_required",
  "important",
  "activity",
] as const satisfies readonly InboxCategory[];

const defaultInboxFilters = new Set<InboxCategory>([
  "urgent",
  "action_required",
  "important",
]);
const builtInWorkflowStageIds = new Set<string>(
  autoHuntWorkflowStageCatalog.map((stage) => stage.id),
);

export function pageInboxMessages<T>(
  messages: readonly T[],
  visibleCount: number,
): T[] {
  return messages.slice(0, Math.max(0, visibleCount));
}

export function nextInboxVisibleCount(
  currentVisibleCount: number,
  totalCount: number,
  pageSize = INBOX_PAGE_SIZE,
): number {
  if (totalCount <= 0) return 0;
  if (currentVisibleCount >= totalCount) return totalCount;
  return Math.min(currentVisibleCount + pageSize, totalCount);
}

export function Inbox({
  companionMode = false,
  desktopEmbedded = false,
  isSidebarOpen,
  messages,
  onMarkAllRead,
  onMarkRead,
  onMarkUnread = () => {},
  onOpen,
  projects,
  selectedMessageId = null,
  unreadCount,
}: {
  companionMode?: boolean;
  desktopEmbedded?: boolean;
  isSidebarOpen: boolean;
  messages: InboxMessageWithReadState[];
  onMarkAllRead: () => void;
  onMarkRead: (messageId: string) => void;
  onMarkUnread?: (messageId: string) => void;
  onOpen: (message: InboxMessageWithReadState) => void;
  projects: Project[];
  selectedMessageId?: string | null;
  unreadCount: number;
}) {
  const { localeTag, t } = useI18n();
  // Mobile companion shows one chronological feed; desktop keeps category filters.
  const [activeFilters, setActiveFilters] = useState<Set<InboxCategory>>(
    () =>
      new Set(
        companionMode
          ? (inboxFilters as readonly InboxCategory[])
          : defaultInboxFilters,
      ),
  );
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const [visibleCount, setVisibleCount] = useState(INBOX_PAGE_SIZE);
  const [cursorMessageId, setCursorMessageId] = useState<string | null>(
    selectedMessageId,
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const projectOptions = useMemo(
    () => [
      { label: t("inbox.allProjects"), value: "all" },
      ...projects.map((project) => ({
        label: project.name,
        value: project.id,
      })),
    ],
    [projects, t],
  );
  const effectiveProjectId = projectOptions.some(
    (option) => option.value === selectedProjectId,
  )
    ? selectedProjectId
    : "all";
  const projectMessages = useMemo(
    () =>
      effectiveProjectId === "all"
        ? messages
        : messages.filter(
            (message) => message.projectId === effectiveProjectId,
          ),
    [effectiveProjectId, messages],
  );
  const unreadCategoryCounts = useMemo(
    () =>
      projectMessages.reduce<Record<InboxCategory, number>>(
        (counts, message) => {
          if (message.isUnread) {
            counts[classifyInboxMessage(message)] += 1;
          }
          return counts;
        },
        { urgent: 0, action_required: 0, important: 0, activity: 0 },
      ),
    [projectMessages],
  );
  const filteredMessages = useMemo(
    () =>
      projectMessages.filter((message) =>
        activeFilters.has(classifyInboxMessage(message)),
      ),
    [activeFilters, projectMessages],
  );
  const filterKey = useMemo(
    () => `${effectiveProjectId}:${[...activeFilters].sort().join(",")}`,
    [activeFilters, effectiveProjectId],
  );
  const visibleMessages = useMemo(
    () => pageInboxMessages(filteredMessages, visibleCount),
    [filteredMessages, visibleCount],
  );
  const visibleMessageIds = useMemo(
    () => visibleMessages.map((message) => message.id),
    [visibleMessages],
  );
  const visibleMessagesById = useMemo(
    () => new Map(visibleMessages.map((message) => [message.id, message])),
    [visibleMessages],
  );
  const hasMore = visibleMessages.length < filteredMessages.length;

  useEffect(() => {
    if (selectedMessageId !== null) setCursorMessageId(selectedMessageId);
  }, [selectedMessageId]);

  const navigation = useControlledCollectionNavigation<
    string,
    HTMLButtonElement
  >({
    cursorId: cursorMessageId,
    itemIds: visibleMessageIds,
    onCursorIdChange: setCursorMessageId,
    onSelectedIdChange: (messageId) => {
      const message = visibleMessagesById.get(messageId);
      if (message) onOpen(message);
    },
    orientation: "vertical",
    selectedId: selectedMessageId,
    selectionBehavior: "follow-cursor",
  });

  const openMessage = useCallback(
    (message: InboxMessageWithReadState) => {
      setCursorMessageId(message.id);
      onOpen(message);
    },
    [onOpen],
  );

  useAppCollectionKeyboardCommandScope({
    enabled: !companionMode && visibleMessageIds.length > 0,
    id: "inbox-list",
    move: navigation.move,
    orientation: "vertical",
    rootRef: listRef,
  });

  useEffect(() => {
    setVisibleCount(INBOX_PAGE_SIZE);
  }, [filterKey]);

  useEffect(() => {
    setVisibleCount((current) => {
      if (filteredMessages.length === 0) return INBOX_PAGE_SIZE;
      if (current > filteredMessages.length) return filteredMessages.length;
      return current < INBOX_PAGE_SIZE
        ? Math.min(INBOX_PAGE_SIZE, filteredMessages.length)
        : current;
    });
  }, [filteredMessages.length]);

  const loadMore = useCallback(() => {
    setVisibleCount((current) =>
      nextInboxVisibleCount(current, filteredMessages.length),
    );
  }, [filteredMessages.length]);

  const maybeLoadMoreFromScroll = useCallback(
    (element: HTMLDivElement) => {
      if (!hasMore) return;
      const remaining =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      if (remaining <= INBOX_LOAD_MORE_THRESHOLD_PX) {
        loadMore();
      }
    },
    [hasMore, loadMore],
  );

  // When the viewport is taller than the first page, keep loading until the
  // list either fills the scroll area or runs out of messages. Skip when the
  // element has not been laid out yet (common in unit tests).
  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element || !hasMore || element.clientHeight <= 0) return;
    if (
      element.scrollHeight <=
      element.clientHeight + INBOX_LOAD_MORE_THRESHOLD_PX
    ) {
      loadMore();
    }
  }, [hasMore, loadMore, visibleMessages.length]);

  const toggleFilter = (category: InboxCategory) => {
    setActiveFilters((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const markAllReadAction =
    unreadCount > 0 ? (
      <Button onClick={onMarkAllRead} type="button" variant="soft">
        <Check size={14} />
        {t("inbox.markAllRead")}
      </Button>
    ) : null;

  const pageHeader = companionMode ? null : (
    <PageHeader
      action={markAllReadAction}
      className={cn(
        "h-12 min-h-12 shrink-0 px-[22px] [&_.page-header-copy]:min-w-0 [&_.page-header-copy]:flex-1 [&_.page-header-title]:truncate [&_.page-header-title]:text-base [&_.page-header-title]:font-[650] [&_.page-header-title]:leading-tight",
        !isSidebarOpen && "sidebar-closed",
        !isSidebarOpen && "pl-[var(--window-navigation-content-inset)]",
        "max-[760px]:px-[18px]",
        !isSidebarOpen && "max-[760px]:pl-[var(--window-navigation-content-inset)]",
      )}
      data-tauri-drag-region
      title={t("inbox.title")}
      titleId="inbox-title"
    />
  );

  const inboxContent = (
    <div
      className={cn(
        "inbox-scroll flex min-h-0 flex-1 flex-col overflow-hidden p-0",
        companionMode &&
          "min-h-full overflow-visible pb-[calc(108px+env(safe-area-inset-bottom))]",
      )}
    >
      <section
        className="inbox-content m-0 flex min-h-0 w-full flex-1 flex-col"
        aria-labelledby={companionMode ? undefined : "inbox-title"}
        aria-label={companionMode ? t("inbox.title") : undefined}
      >
        <section
          aria-label={t("inbox.messages")}
          className="inbox-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-card shadow-none"
        >
          {companionMode ? null : (
            <header className="inbox-filter-bar flex min-h-[58px] shrink-0 items-center justify-between gap-4 overflow-hidden border-b border-border/80 bg-card/95 py-2.5 pl-[21px] pr-[18px] max-[760px]:gap-2 max-[760px]:px-3">
              <div className="inbox-filter-controls flex min-w-0 flex-1 items-center gap-2.5 max-[760px]:items-stretch max-[760px]:flex-col max-[760px]:gap-2">
                <SelectMenu
                  className="inbox-project-filter !w-[176px] !shrink-0 max-[760px]:!w-full max-[760px]:!flex-auto"
                  label={t("inbox.projectFilter")}
                  onValueChange={setSelectedProjectId}
                  options={projectOptions}
                  size="small"
                  value={effectiveProjectId}
                />
                <div
                  aria-label={t("inbox.filters")}
                  className="inbox-filters flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5 pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  role="group"
                >
                  {inboxFilters.map((category) => {
                    const label = t(
                      `inbox.category.${category}` as MessageKey,
                    );
                    const count = unreadCategoryCounts[category];
                    const isActive = activeFilters.has(category);
                    const filterTone = isActive
                      ? category === "urgent"
                        ? "border-destructive/40 bg-destructive/10 text-destructive hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                        : category === "action_required"
                          ? "border-warning/40 bg-warning/10 text-warning hover:border-warning/40 hover:bg-warning/10 hover:text-warning"
                          : category === "important"
                            ? "border-primary/40 bg-primary/10 text-primary hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                            : "border-border bg-secondary text-foreground hover:border-border hover:bg-secondary hover:text-foreground"
                      : "border-input bg-muted text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground";
                    const filterCountTone = isActive
                      ? category === "urgent"
                        ? "bg-destructive/20 text-destructive"
                        : category === "action_required"
                          ? "bg-warning/20 text-warning"
                          : category === "important"
                            ? "bg-primary/20 text-primary"
                            : "bg-secondary text-foreground"
                      : "bg-muted text-muted-foreground";
                    return (
                      <button
                        aria-label={count > 0 ? `${label} ${count}` : label}
                        aria-pressed={isActive}
                        className={cn(
                          "inbox-filter relative inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] border p-0 transition-[transform,border-color,background-color,color] duration-150 ease-out motion-reduce:transition-none active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                          category,
                          filterTone,
                        )}
                        key={category}
                        onClick={() => toggleFilter(category)}
                        title={label}
                        type="button"
                      >
                        <FilterIcon category={category} />
                        {count > 0 ? (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "inbox-filter-count absolute -right-1 -top-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-[3px] font-mono text-[10px] font-semibold leading-none shadow-[0_0_0_1.5px_var(--card)]",
                              filterCountTone,
                            )}
                          >
                            {count}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Typography
                as="span"
                className="shrink-0 font-mono text-2xs font-medium max-[760px]:hidden"
                tone="muted"
                variant="caption"
              >
                {t("inbox.filteredCount", { count: filteredMessages.length })}
              </Typography>
            </header>
          )}

          {messages.length === 0 ? (
            <EmptyState
              className={cn(
                "inbox-empty min-h-0 flex-1 p-[34px] [&>span]:mb-3.5 [&>span]:size-12 [&>span]:rounded-[15px] [&>span]:bg-accent [&>span]:text-primary [&>strong]:text-xs [&>p]:mt-[7px] [&>p]:text-2xs",
                companionMode && "min-h-[260px]",
              )}
              description={t("inbox.emptyDescription")}
              icon={<InboxIcon size={23} />}
              title={t("inbox.emptyTitle")}
            />
          ) : filteredMessages.length === 0 ? (
            <EmptyState
              className={cn(
                "inbox-empty min-h-0 flex-1 p-[34px] [&>span]:mb-3.5 [&>span]:size-12 [&>span]:rounded-[15px] [&>span]:bg-accent [&>span]:text-primary [&>strong]:text-xs [&>p]:mt-[7px] [&>p]:text-2xs",
                companionMode && "min-h-[260px]",
              )}
              description={t("inbox.filterEmptyDescription")}
              icon={<InboxIcon size={23} />}
              title={t("inbox.filterEmptyTitle")}
            />
          ) : (
            <div
              className="inbox-list scrollbar-subtle grid min-h-0 flex-1 content-start overflow-y-auto bg-card"
              data-has-more={hasMore ? "true" : "false"}
              data-keyboard-list=""
              data-visible-count={visibleMessages.length}
              onScroll={(event) =>
                maybeLoadMoreFromScroll(event.currentTarget)}
              ref={listRef}
            >
              {visibleMessages.map((message) => (
                <InboxMessageRow
                  category={classifyInboxMessage(message)}
                  compact={companionMode}
                  current={message.id === cursorMessageId}
                  key={message.id}
                  localeTag={localeTag}
                  message={message}
                  onCursorChange={setCursorMessageId}
                  onMarkRead={onMarkRead}
                  onMarkUnread={onMarkUnread}
                  onOpen={openMessage}
                  openButtonRef={navigation.getItemRef(message.id)}
                  project={projectsById.get(message.projectId)}
                  selected={message.id === selectedMessageId}
                  t={t}
                />
              ))}
              {hasMore ? (
                <div
                  aria-hidden="true"
                  className="inbox-load-more-sentinel"
                  data-testid="inbox-load-more-sentinel"
                />
              ) : null}
            </div>
          )}
        </section>
      </section>
    </div>
  );

  if (companionMode) {
    return (
      <MainContent className="companion-inbox" id="inbox">
        {inboxContent}
      </MainContent>
    );
  }

  if (desktopEmbedded) {
    return (
      <div
        className="main-content min-w-0 flex-1 bg-background text-foreground"
        id="inbox"
      >
        {pageHeader}
        {inboxContent}
      </div>
    );
  }

  return (
    <MainContent id="inbox">
      {pageHeader}
      {inboxContent}
    </MainContent>
  );
}

function FilterIcon({ category }: { category: InboxCategory }) {
  if (category === "urgent") return <Siren aria-hidden="true" size={14} />;
  if (category === "action_required") {
    return <CircleAlert aria-hidden="true" size={14} />;
  }
  if (category === "important") {
    return <BellRing aria-hidden="true" size={14} />;
  }
  return <Clock3 aria-hidden="true" size={14} />;
}

function InboxMessageRow({
  category,
  compact,
  current,
  localeTag,
  message,
  onCursorChange,
  onMarkRead,
  onMarkUnread,
  onOpen,
  openButtonRef,
  project,
  selected,
  t,
}: {
  category: InboxCategory;
  compact: boolean;
  current: boolean;
  localeTag: string;
  message: InboxMessageWithReadState;
  onCursorChange: (messageId: string) => void;
  onMarkRead: (messageId: string) => void;
  onMarkUnread: (messageId: string) => void;
  onOpen: (message: InboxMessageWithReadState) => void;
  openButtonRef: (element: HTMLButtonElement | null) => void;
  project: Project | undefined;
  selected: boolean;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}) {
  const showUnreadAction = message.isUnread && category !== "activity";
  const showMarkUnreadAction = !compact && !message.isUnread;
  const showReadStateAction = showUnreadAction || showMarkUnreadAction;
  const openRef = useRef<HTMLButtonElement | null>(null);
  const setOpenButtonRef = useCallback(
    (element: HTMLButtonElement | null) => {
      openRef.current = element;
      openButtonRef(element);
    },
    [openButtonRef],
  );
  const iconTone =
    message.kind === "conversation" || message.kind === "channel"
      ? "overflow-hidden rounded-full bg-[linear-gradient(145deg,#6ec8c4,#3aa8a3)] p-0 text-white"
      : category === "urgent"
        ? "bg-destructive/10 text-destructive"
        : category === "action_required"
          ? "bg-warning/10 text-warning"
          : category === "important"
            ? "bg-primary/10 text-primary"
            : message.kind === "issue" && message.status === "completed"
              ? "bg-success/10 text-success"
              : message.kind === "issue" && message.status === "cancelled"
                ? "bg-muted text-muted-foreground"
                : "bg-primary/10 text-primary";
  const rowBackground = selected
    ? "bg-accent hover:bg-accent"
    : compact
      ? "bg-transparent hover:bg-transparent"
      : showUnreadAction
        ? "bg-accent/30 hover:bg-accent/60"
        : "bg-card hover:bg-muted";

  return (
    <div
      className={cn(
        "inbox-message group relative min-h-[68px] w-full border-b border-border/70 text-inherit transition-colors duration-150 last:border-b-0",
        category,
        showUnreadAction && "unread",
        rowBackground,
        selected && "selected shadow-[inset_3px_0_0_var(--primary)]",
        compact && "min-h-[76px] border-b-0",
      )}
    >
      <button
        aria-current={selected ? "true" : undefined}
        className={cn(
          "inbox-message-open grid min-h-[68px] w-full grid-cols-[36px_minmax(0,1fr)_auto] grid-rows-[1fr_1fr] items-center gap-x-3 border-0 bg-transparent px-[18px] py-2.5 text-left text-inherit transition-transform duration-100 ease-out motion-reduce:transform-none active:scale-[.997] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
          !compact && "max-[760px]:gap-x-2.5 max-[760px]:px-3",
          compact &&
            "grid-cols-[46px_minmax(0,1fr)] gap-x-3 px-[max(16px,env(safe-area-inset-right))] py-2.5 pl-[max(16px,env(safe-area-inset-left))]",
          compact && "active:bg-secondary",
        )}
        data-keyboard-list-item=""
        data-keyboard-list-current={current ? "" : undefined}
        onClick={() => onOpen(message)}
        onFocus={() => onCursorChange(message.id)}
        ref={setOpenButtonRef}
        type="button"
      >
        <span
          className={cn(
            "inbox-message-icon relative col-start-1 row-span-2 grid size-9 shrink-0 place-items-center rounded-[10px]",
            category,
            message.kind,
            (message.kind === "conversation" || message.kind === "channel") &&
              "author",
            message.kind === "conversation" || message.kind === "channel"
              ? message.reason
              : message.status,
            iconTone,
            compact && "size-[46px] rounded-full",
          )}
        >
          {message.kind === "conversation" || message.kind === "channel" ? (
            <InboxMessageAuthorAvatar
              image={message.authorImage}
              name={message.authorName}
            />
          ) : message.kind === "session" ? (
            <Bot size={17} />
          ) : category === "urgent" ? (
            <Siren size={17} />
          ) : category === "action_required" ? (
            <CircleAlert size={17} />
          ) : category === "important" ? (
            <BellRing size={17} />
          ) : message.status === "completed" ? (
            <CheckCircle2 size={17} />
          ) : (
            <Clock3 size={17} />
          )}
          {project &&
          message.kind !== "conversation" &&
          message.kind !== "channel" ? (
            <span
              aria-hidden="true"
              className={cn(
                "inbox-message-project-icon pointer-events-none absolute -bottom-1 -right-1 z-[1] grid size-[17px] place-items-center overflow-hidden rounded-full border-2 border-card bg-card text-muted-foreground shadow-[0_1px_3px_rgba(31,32,28,.18)] [&>img]:size-full [&>img]:rounded-full [&>img]:object-contain [&>svg]:size-full [&>svg]:p-0.5",
                compact && "-bottom-0.5 -right-0.5",
              )}
              data-project-id={project.id}
            >
              <ProjectIcon
                className="inbox-message-project-icon-image"
                project={project}
              />
            </span>
          ) : null}
        </span>
        <span className="inbox-message-copy col-start-2 row-span-2 grid min-w-0 grid-rows-[1fr_1fr] items-center gap-0">
          <Typography
            as="strong"
            className="min-w-0 truncate text-xs font-semibold leading-[1.25]"
            variant="bodySm"
          >
            {messageTitle(t, message)}
          </Typography>
          <small className={cn(
            "inbox-message-detail flex min-w-0 items-center gap-[5px] overflow-hidden text-2xs leading-[1.3] whitespace-nowrap text-muted-foreground",
            compact && "gap-[3px] text-xs",
          )}>
            <span className="inbox-message-project shrink-0 font-medium text-muted-foreground">
              {message.kind === "channel" ? `#${message.channelName}` : message.projectName}
            </span>
            <span aria-hidden="true" className="inbox-message-separator shrink-0 text-border">
              ·
            </span>
            <span className="inbox-message-description min-w-0 overflow-hidden text-ellipsis">
              {messageSecondaryText(t, message)}
            </span>
            {compact ? (
              <>
                <span aria-hidden="true" className="inbox-message-separator shrink-0 text-border">
                  ·
                </span>
                <time
                  className="inbox-message-inline-time shrink-0 font-mono text-2xs font-medium text-muted-foreground"
                  dateTime={message.occurredAt}
                  title={formatDate(message.occurredAt, localeTag)}
                >
                  {formatRelativeDate(message.occurredAt, localeTag)}
                </time>
              </>
            ) : null}
          </small>
        </span>
        {!compact && !showReadStateAction ? (
          <ChevronRight
            className="inbox-message-chevron col-start-3 row-start-1 justify-self-end text-muted-foreground/70"
            size={15}
          />
        ) : null}
        {compact ? null : (
          <time
            className="inbox-message-time col-start-3 row-start-2 justify-self-end whitespace-nowrap pl-3 font-mono text-2xs font-medium text-muted-foreground"
            dateTime={message.occurredAt}
            title={formatDate(message.occurredAt, localeTag)}
          >
            {formatRelativeDate(message.occurredAt, localeTag)}
          </time>
        )}
      </button>
      {showUnreadAction ? (
        <button
          aria-label={t("inbox.markRead")}
          className={cn(
            "inbox-mark-read absolute right-[9px] top-[5px] z-[1] grid size-8 place-items-center rounded-[9px] border-0 p-0 text-primary transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
            compact
              ? "left-[max(22px,calc(env(safe-area-inset-left)+14px))] right-auto top-[45px] size-[22px] rounded-full border-2 border-card bg-foreground text-card shadow-none hover:bg-primary focus-visible:bg-primary"
              : "bg-transparent hover:bg-accent focus-visible:bg-accent",
          )}
          onClick={() => {
            openRef.current?.focus({ preventScroll: true });
            onMarkRead(message.id);
          }}
          title={t("inbox.markRead")}
          type="button"
        >
          <i
            aria-hidden="true"
            className={cn(
              "inbox-mark-read-dot col-start-1 row-start-1 size-1.5 rounded-full transition-[opacity,transform] duration-150",
              compact
                ? "bg-card shadow-none group-hover:opacity-100 group-hover:scale-100 hover:scale-[.7] hover:opacity-0 focus-visible:scale-[.7] focus-visible:opacity-0"
                : "bg-primary shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_10%,transparent)] group-hover:scale-[.8] group-hover:opacity-0 hover:scale-[.8] hover:opacity-0 focus-visible:scale-[.8] focus-visible:opacity-0",
            )}
          />
          <Check
            aria-hidden="true"
            className={cn(
              "inbox-mark-read-check col-start-1 row-start-1 size-[15px] scale-[.8] text-current opacity-0 transition-[opacity,transform] duration-150",
              compact
                ? "group-hover:scale-[.8] group-hover:opacity-0 hover:scale-100 hover:opacity-100 focus-visible:scale-100 focus-visible:opacity-100"
                : "group-hover:scale-100 group-hover:opacity-100 hover:scale-100 hover:opacity-100 focus-visible:scale-100 focus-visible:opacity-100",
            )}
            size={15}
          />
        </button>
      ) : null}
      {showMarkUnreadAction ? (
        <button
          aria-label={t("inbox.markUnread")}
          className="inbox-mark-unread absolute right-[9px] top-[5px] z-[1] grid size-8 place-items-center rounded-[9px] border-0 bg-transparent p-0 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          onClick={() => {
            openRef.current?.focus({ preventScroll: true });
            onMarkUnread(message.id);
          }}
          title={t("inbox.markUnread")}
          type="button"
        >
          <Mail aria-hidden="true" size={15} />
        </button>
      ) : null}
    </div>
  );
}

function InboxMessageAuthorAvatar({
  image,
  name,
}: {
  image?: string | null;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [image]);
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  if (image && !failed) {
    return (
      <img
        alt=""
        className="inbox-message-author-avatar size-full object-cover"
        onError={() => setFailed(true)}
        src={image}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inbox-message-author-fallback text-sm font-[720] leading-none"
    >
      {initial}
    </span>
  );
}

function messageTitle(
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  message: InboxMessageWithReadState,
) {
  if (message.kind === "issue") return message.title;
  if (message.kind === "conversation" || message.kind === "channel") {
    if (message.reason === "mention") {
      return t("inbox.conversationMention", { author: message.authorName });
    }
    if (message.reason === "subscription") {
      return t(
        message.kind === "channel"
          ? "inbox.channelSubscription"
          : "inbox.conversationSubscription",
        { author: message.authorName },
      );
    }
    return t("inbox.conversationThreadReply", { author: message.authorName });
  }
  return message.status === "completed"
    ? t("inbox.sessionCompleted")
    : t("inbox.sessionFailed");
}

function messageDescription(
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  message: InboxMessageWithReadState,
) {
  if (message.kind === "conversation" || message.kind === "channel") {
    return message.body;
  }
  if (message.kind === "session") {
    if (message.status === "failed") {
      return message.error
        ? t("inbox.sessionFailedWithReason", { reason: message.error })
        : t("inbox.sessionFailedDescription");
    }
    return (
      message.summary ??
      t("inbox.sessionCompletedDescription", {
        count: message.issueCount,
      })
    );
  }

  return (
    message.structuredResult?.summary ??
    t("inbox.issueStatusChanged", {
      status: issueStatusLabel(t, message),
    })
  );
}

function messageSecondaryText(
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  message: InboxMessageWithReadState,
) {
  if (
    message.kind === "issue" &&
    message.structuredResult?.humanActionRequired &&
    message.structuredResult.nextAction
  ) {
    return t("inbox.nextAction", {
      action: message.structuredResult.nextAction,
    });
  }
  return messageDescription(t, message);
}

function issueStatusLabel(
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  message: InboxIssueMessage,
) {
  if (message.status === "running" && message.workflowStage) {
    if (message.workflowStageLabel) return message.workflowStageLabel;
    if (builtInWorkflowStageIds.has(message.workflowStage)) {
      return t(`stage.${message.workflowStage}` as MessageKey);
    }
    return message.workflowStage;
  }
  return t(`status.${message.status}` as MessageKey);
}

function formatDate(value: string, localeTag: string) {
  return new Intl.DateTimeFormat(localeTag, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRelativeDate(value: string, localeTag: string) {
  const elapsed = new Date(value).getTime() - Date.now();
  const absoluteElapsed = Math.abs(elapsed);
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  const relative = new Intl.RelativeTimeFormat(localeTag, {
    numeric: "always",
    style: "narrow",
  });

  if (absoluteElapsed < hour) {
    return relative.format(Math.round(elapsed / minute), "minute");
  }
  if (absoluteElapsed < day) {
    return relative.format(Math.round(elapsed / hour), "hour");
  }
  if (absoluteElapsed < day * 7) {
    return relative.format(Math.round(elapsed / day), "day");
  }
  return new Intl.DateTimeFormat(localeTag, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
