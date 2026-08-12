import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AtSign,
  BellRing,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Inbox as InboxIcon,
  MessageCircle,
  Siren,
} from "lucide-react";

import { EmptyState, MainContent, PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { SelectMenu } from "./SelectMenu";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import { autoHuntWorkflowStageCatalog } from "../lib/auto-hunt-contract";
import type { Project } from "../types";
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
  isSidebarOpen,
  messages,
  onMarkAllRead,
  onMarkRead,
  onOpen,
  projects,
  unreadCount,
}: {
  companionMode?: boolean;
  isSidebarOpen: boolean;
  messages: InboxMessageWithReadState[];
  onMarkAllRead: () => void;
  onMarkRead: (messageId: string) => void;
  onOpen: (message: InboxMessageWithReadState) => void;
  projects: Project[];
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
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
  const categoryCounts = useMemo(
    () =>
      projectMessages.reduce<Record<InboxCategory, number>>(
        (counts, message) => {
          counts[classifyInboxMessage(message)] += 1;
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
  const hasMore = visibleMessages.length < filteredMessages.length;

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
    const element = scrollRef.current;
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
        "inbox-heading",
        "app-page-header",
        !isSidebarOpen && "sidebar-closed",
      )}
      data-tauri-drag-region
      title={t("inbox.title")}
      titleId="inbox-title"
    />
  );

  const inboxContent = (
    <div
      className="inbox-scroll min-h-0 flex-1 overflow-auto"
      data-has-more={hasMore ? "true" : "false"}
      data-visible-count={visibleMessages.length}
      onScroll={(event) => maybeLoadMoreFromScroll(event.currentTarget)}
      ref={scrollRef}
    >
      <section
        className="inbox-content"
        aria-labelledby={companionMode ? undefined : "inbox-title"}
        aria-label={companionMode ? t("inbox.title") : undefined}
      >
        {companionMode && markAllReadAction ? (
          <div className="inbox-companion-actions">{markAllReadAction}</div>
        ) : null}

        <section
          aria-label={t("inbox.messages")}
          className="inbox-panel rounded-none border-0 bg-card"
        >
          <header className="inbox-filter-bar">
            <div className="inbox-filter-controls">
              {companionMode ? null : (
                <SelectMenu
                  className="inbox-project-filter"
                  label={t("inbox.projectFilter")}
                  onValueChange={setSelectedProjectId}
                  options={projectOptions}
                  size="small"
                  value={effectiveProjectId}
                />
              )}
              <div
                aria-label={t("inbox.filters")}
                className="inbox-filters"
                role="group"
              >
                {inboxFilters.map((category) => (
                  <button
                    aria-pressed={activeFilters.has(category)}
                    className={cn("inbox-filter", category)}
                    key={category}
                    onClick={() => toggleFilter(category)}
                    type="button"
                  >
                    <FilterIcon category={category} />
                    <span>
                      {t(`inbox.category.${category}` as MessageKey)}
                    </span>
                    <span className="inbox-filter-count">
                      {categoryCounts[category]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {companionMode ? null : (
              <Typography as="span" tone="muted" variant="caption">
                {t("inbox.filteredCount", { count: filteredMessages.length })}
              </Typography>
            )}
          </header>

          {messages.length === 0 ? (
            <EmptyState
              className="inbox-empty"
              description={t("inbox.emptyDescription")}
              icon={<InboxIcon size={23} />}
              title={t("inbox.emptyTitle")}
            />
          ) : filteredMessages.length === 0 ? (
            <EmptyState
              className="inbox-empty"
              description={t("inbox.filterEmptyDescription")}
              icon={<InboxIcon size={23} />}
              title={t("inbox.filterEmptyTitle")}
            />
          ) : (
            <div className="inbox-list">
              {visibleMessages.map((message) => (
                <InboxMessageRow
                  category={classifyInboxMessage(message)}
                  key={message.id}
                  localeTag={localeTag}
                  message={message}
                  onMarkRead={onMarkRead}
                  onOpen={onOpen}
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
  localeTag,
  message,
  onMarkRead,
  onOpen,
  t,
}: {
  category: InboxCategory;
  localeTag: string;
  message: InboxMessageWithReadState;
  onMarkRead: (messageId: string) => void;
  onOpen: (message: InboxMessageWithReadState) => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}) {
  const showUnreadAction = message.isUnread && category !== "activity";

  return (
    <div
      className={cn(
        "inbox-message",
        category,
        showUnreadAction && "unread",
      )}
    >
      <button
        className="inbox-message-open"
        onClick={() => onOpen(message)}
        type="button"
      >
        <span
          className={cn(
            "inbox-message-icon grid size-9 shrink-0 place-items-center rounded-lg",
            category,
            message.kind,
            message.kind === "conversation" || message.kind === "channel"
              ? message.reason
              : message.status,
          )}
        >
          {message.kind === "session" ? (
            <Bot size={17} />
          ) : message.kind === "conversation" || message.kind === "channel" ? (
            message.reason === "mention" ? (
              <AtSign size={17} />
            ) : (
              <MessageCircle size={17} />
            )
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
        </span>
        <span className="inbox-message-copy">
          <Typography as="strong" className="truncate" variant="bodySm">
            {messageTitle(t, message)}
          </Typography>
          <small className="inbox-message-detail">
            <span className="inbox-message-project">
              {message.kind === "channel" ? `#${message.channelName}` : message.projectName}
            </span>
            <span aria-hidden="true" className="inbox-message-separator">
              ·
            </span>
            <span className="inbox-message-description">
              {messageSecondaryText(t, message)}
            </span>
          </small>
        </span>
        {!showUnreadAction ? (
          <ChevronRight className="inbox-message-chevron" size={15} />
        ) : null}
        <time
          className="inbox-message-time"
          dateTime={message.occurredAt}
          title={formatDate(message.occurredAt, localeTag)}
        >
          {formatRelativeDate(message.occurredAt, localeTag)}
        </time>
      </button>
      {showUnreadAction ? (
        <button
          aria-label={t("inbox.markRead")}
          className="inbox-mark-read"
          onClick={() => onMarkRead(message.id)}
          title={t("inbox.markRead")}
          type="button"
        >
          <i aria-hidden="true" className="inbox-mark-read-dot" />
          <Check
            aria-hidden="true"
            className="inbox-mark-read-check"
            size={15}
          />
        </button>
      ) : null}
    </div>
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
      return t("inbox.conversationSubscription", {
        author: message.authorName,
      });
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
