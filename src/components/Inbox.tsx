import { useState } from "react";
import {
  BellRing,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  History,
  Inbox as InboxIcon,
  Siren,
} from "lucide-react";

import { EmptyState, MainContent, PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  groupInboxMessages,
  type InboxCategory,
  type InboxIssueMessage,
  type InboxMessageWithReadState,
} from "../hooks/useInbox";

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
  const [showsActivity, setShowsActivity] = useState(false);
  const grouped = groupInboxMessages(messages);
  const priorityCount =
    grouped.urgent.length +
    grouped.action_required.length +
    grouped.important.length;

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
          className="inbox-heading"
          description={t("inbox.description")}
          eyebrow={
            <>
              <InboxIcon size={13} />
              {t("inbox.eyebrow")}
            </>
          }
          title={t("inbox.title")}
          titleId="inbox-title"
        />

        <section
          aria-label={t("inbox.messages")}
          className="inbox-panel rounded-none border-0 bg-card"
        >
          <header className="inbox-summary">
            <Typography as="strong" variant="body">
              {t("inbox.needsAttention")}
            </Typography>
            <Typography as="span" tone="muted" variant="caption">
              {t("inbox.priorityCount", { count: priorityCount })}
            </Typography>
          </header>

          {messages.length === 0 ? (
            <EmptyState
              className="inbox-empty"
              description={t("inbox.emptyDescription")}
              icon={<InboxIcon size={23} />}
              title={t("inbox.emptyTitle")}
            />
          ) : (
            <div className="inbox-sections">
              <InboxSection
                category="urgent"
                localeTag={localeTag}
                messages={grouped.urgent}
                onOpen={onOpen}
                t={t}
              />
              <InboxSection
                category="action_required"
                localeTag={localeTag}
                messages={grouped.action_required}
                onOpen={onOpen}
                t={t}
              />
              <InboxSection
                category="important"
                localeTag={localeTag}
                messages={grouped.important}
                onOpen={onOpen}
                t={t}
              />

              <section
                aria-labelledby="inbox-activity-heading"
                className="inbox-section inbox-section-activity"
              >
                <button
                  aria-expanded={showsActivity}
                  className="inbox-section-heading inbox-activity-toggle"
                  disabled={grouped.activity.length === 0}
                  onClick={() => setShowsActivity((current) => !current)}
                  type="button"
                >
                  <span className="inbox-section-title">
                    <History aria-hidden="true" size={15} />
                    <Typography
                      as="strong"
                      id="inbox-activity-heading"
                      variant="bodySm"
                    >
                      {t("inbox.category.activity")}
                    </Typography>
                    <span className="inbox-section-count">
                      {grouped.activity.length}
                    </span>
                  </span>
                  {grouped.activity.length > 0 ? (
                    <span className="inbox-activity-action">
                      {showsActivity
                        ? t("inbox.collapseActivity")
                        : t("inbox.expandActivity")}
                      <ChevronDown
                        className={cn(
                          "inbox-activity-chevron",
                          showsActivity && "open",
                        )}
                        size={15}
                      />
                    </span>
                  ) : null}
                </button>
                {showsActivity ? (
                  <div className="inbox-list">
                    {grouped.activity.map((message) => (
                      <InboxMessageRow
                        category="activity"
                        key={message.id}
                        localeTag={localeTag}
                        message={message}
                        onOpen={onOpen}
                        t={t}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
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

function InboxSection({
  category,
  localeTag,
  messages,
  onOpen,
  t,
}: {
  category: Exclude<InboxCategory, "activity">;
  localeTag: string;
  messages: InboxMessageWithReadState[];
  onOpen: (message: InboxMessageWithReadState) => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}) {
  const id = `inbox-${category}-heading`;
  return (
    <section
      aria-labelledby={id}
      className={cn("inbox-section", category)}
    >
      <header className="inbox-section-heading">
        <span className="inbox-section-title">
          {category === "urgent" ? (
            <Siren aria-hidden="true" size={15} />
          ) : category === "action_required" ? (
            <CircleAlert aria-hidden="true" size={15} />
          ) : (
            <BellRing aria-hidden="true" size={15} />
          )}
          <Typography as="strong" id={id} variant="bodySm">
            {t(`inbox.category.${category}` as MessageKey)}
          </Typography>
          <span className="inbox-section-count">{messages.length}</span>
        </span>
      </header>
      {messages.length > 0 ? (
        <div className="inbox-list">
          {messages.map((message) => (
            <InboxMessageRow
              category={category}
              key={message.id}
              localeTag={localeTag}
              message={message}
              onOpen={onOpen}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
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
        "inbox-message flex w-full items-center gap-3 border-b border-border/80 px-8 py-4 text-left transition-colors hover:bg-secondary/60",
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
          message.status,
        )}
      >
        {category === "urgent" ? (
          <Siren size={17} />
        ) : category === "action_required" ? (
          <CircleAlert size={17} />
        ) : category === "important" ? (
          <BellRing size={17} />
        ) : message.kind === "session" ? (
          <Bot size={17} />
        ) : message.status === "completed" ? (
          <CheckCircle2 size={17} />
        ) : (
          <Clock3 size={17} />
        )}
      </span>
      <span className="inbox-message-copy min-w-0 flex-1 grid gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <Typography as="strong" className="truncate" variant="bodySm">
            {messageTitle(t, message)}
          </Typography>
          {message.isUnread && category !== "activity" ? (
            <i
              aria-label={t("inbox.unread")}
              className="inbox-unread-dot size-1.5 shrink-0 rounded-full bg-primary"
            />
          ) : null}
        </span>
        <Typography as="small" className="truncate" tone="muted" variant="caption">
          {messageDescription(t, message)}
        </Typography>
        {message.kind === "issue" &&
        message.structuredResult?.humanActionRequired &&
        message.structuredResult.nextAction ? (
          <small className="inbox-next-action">
            {t("inbox.nextAction", {
              action: message.structuredResult.nextAction,
            })}
          </small>
        ) : null}
        <em className="flex items-center gap-1.5 text-2xs font-normal text-muted-foreground not-italic">
          <span>{message.projectName}</span>
          <Clock3 size={11} />
          <time dateTime={message.occurredAt}>
            {formatDate(message.occurredAt, localeTag)}
          </time>
        </em>
      </span>
      <ChevronRight className="shrink-0 text-muted-foreground" size={16} />
    </button>
  );
}

function messageTitle(
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  message: InboxMessageWithReadState,
) {
  return message.kind === "issue"
    ? message.title
    : message.status === "completed"
      ? t("inbox.sessionCompleted")
      : t("inbox.sessionFailed");
}

function messageDescription(
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  message: InboxMessageWithReadState,
) {
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
