import { useMemo, useState } from "react";
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
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  classifyInboxMessage,
  type InboxCategory,
  type InboxIssueMessage,
  type InboxMessageWithReadState,
} from "../hooks/useInbox";

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

export function Inbox({
  companionMode = false,
  isSidebarOpen,
  messages,
  onMarkAllRead,
  onOpen,
  unreadCount,
}: {
  companionMode?: boolean;
  isSidebarOpen: boolean;
  messages: InboxMessageWithReadState[];
  onMarkAllRead: () => void;
  onOpen: (message: InboxMessageWithReadState) => void;
  unreadCount: number;
}) {
  const { localeTag, t } = useI18n();
  const [activeFilters, setActiveFilters] = useState<Set<InboxCategory>>(
    () => new Set(defaultInboxFilters),
  );
  const categoryCounts = useMemo(
    () =>
      messages.reduce<Record<InboxCategory, number>>(
        (counts, message) => {
          counts[classifyInboxMessage(message)] += 1;
          return counts;
        },
        { urgent: 0, action_required: 0, important: 0, activity: 0 },
      ),
    [messages],
  );
  const filteredMessages = useMemo(
    () =>
      messages.filter((message) =>
        activeFilters.has(classifyInboxMessage(message)),
      ),
    [activeFilters, messages],
  );

  const toggleFilter = (category: InboxCategory) => {
    setActiveFilters((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const inboxContent = (
    <div className="inbox-scroll min-h-0 flex-1 overflow-auto">
      <section className="inbox-content" aria-labelledby="inbox-title">
        <PageHeader
          action={
            unreadCount > 0 ? (
              <Button onClick={onMarkAllRead} type="button" variant="soft">
                <Check size={14} />
                {t("inbox.markAllRead")}
              </Button>
            ) : null
          }
          className={cn(
            "inbox-heading",
            !companionMode && "app-page-header",
          )}
          description={t("inbox.description")}
          eyebrow={
            companionMode ? (
              <>
                <InboxIcon size={13} />
                {t("inbox.eyebrow")}
              </>
            ) : null
          }
          title={t("inbox.title")}
          titleId="inbox-title"
        />

        <section
          aria-label={t("inbox.messages")}
          className="inbox-panel rounded-none border-0 bg-card"
        >
          <header className="inbox-filter-bar">
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
            <Typography as="span" tone="muted" variant="caption">
              {t("inbox.filteredCount", { count: filteredMessages.length })}
            </Typography>
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
              {filteredMessages.map((message) => (
                <InboxMessageRow
                  category={classifyInboxMessage(message)}
                  key={message.id}
                  localeTag={localeTag}
                  message={message}
                  onOpen={onOpen}
                  t={t}
                />
              ))}
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
      <header
        className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region
      />
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
  onOpen,
  t,
}: {
  category: InboxCategory;
  localeTag: string;
  message: InboxMessageWithReadState;
  onOpen: (message: InboxMessageWithReadState) => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}) {
  return (
    <button
      className={cn(
        "inbox-message",
        category,
        message.isUnread && category !== "activity" && "unread",
      )}
      onClick={() => onOpen(message)}
      type="button"
    >
      <span
        className={cn(
          "inbox-message-icon grid size-9 shrink-0 place-items-center rounded-lg",
          category,
          message.kind,
          message.kind === "conversation" ? message.reason : message.status,
        )}
      >
        {message.kind === "session" ? (
          <Bot size={17} />
        ) : message.kind === "conversation" ? (
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
        {message.isUnread && category !== "activity" ? (
          <i
            aria-label={t("inbox.unread")}
            className="inbox-unread-dot"
          />
        ) : null}
        <small className="inbox-message-detail">
          <span className="inbox-message-project">{message.projectName}</span>
          <span aria-hidden="true" className="inbox-message-separator">
            ·
          </span>
          <span className="inbox-message-description">
            {messageSecondaryText(t, message)}
          </span>
        </small>
      </span>
      <ChevronRight className="inbox-message-chevron" size={15} />
      <time
        className="inbox-message-time"
        dateTime={message.occurredAt}
        title={formatDate(message.occurredAt, localeTag)}
      >
        {formatRelativeDate(message.occurredAt, localeTag)}
      </time>
    </button>
  );
}

function messageTitle(
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  message: InboxMessageWithReadState,
) {
  if (message.kind === "issue") return message.title;
  if (message.kind === "conversation") {
    return message.reason === "mention"
      ? t("inbox.conversationMention", { author: message.authorName })
      : t("inbox.conversationThreadReply", { author: message.authorName });
  }
  return message.status === "completed"
    ? t("inbox.sessionCompleted")
    : t("inbox.sessionFailed");
}

function messageDescription(
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  message: InboxMessageWithReadState,
) {
  if (message.kind === "conversation") return message.body;
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
    return t(`stage.${message.workflowStage}` as MessageKey);
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
