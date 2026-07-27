import {
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Inbox as InboxIcon,
} from "lucide-react";

import {
  EmptyState,
  MainContent,
  PageHeader,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import type {
  InboxIssueMessage,
  InboxMessageWithReadState,
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
          <header className="flex items-center justify-between gap-3 border-b border-border px-8 py-4">
            <Typography as="strong" variant="body">
              {t("inbox.messages")}
            </Typography>
            <Typography as="span" tone="muted" variant="caption">
              {t("inbox.unreadCount", { count: unreadCount })}
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
            <div className="inbox-list">
              {messages.map((message) => (
                <button
                  className={cn(
                    "inbox-message flex w-full items-center gap-3 border-b border-border/80 px-8 py-4 text-left transition-colors hover:bg-secondary/60",
                    message.isUnread && "unread bg-accent/30",
                  )}
                  key={message.id}
                  onClick={() => onOpen(message)}
                  type="button"
                >
                  <span
                    className={cn(
                      "inbox-message-icon grid size-9 shrink-0 place-items-center rounded-lg",
                      message.kind,
                      message.status,
                    )}
                  >
                    {message.kind === "session" ? (
                      <Bot size={17} />
                    ) : message.status === "failed" ||
                      message.status === "blocked" ? (
                      <CircleAlert size={17} />
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
                      {message.isUnread ? (
                        <i
                          aria-label={t("inbox.unread")}
                          className="inbox-unread-dot size-1.5 shrink-0 rounded-full bg-primary"
                        />
                      ) : null}
                    </span>
                    <Typography as="small" className="truncate" tone="muted" variant="caption">
                      {messageDescription(t, message)}
                    </Typography>
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
    return t("inbox.sessionCompletedDescription", {
      count: message.issueCount,
    });
  }

  return t("inbox.issueStatusChanged", {
    status: issueStatusLabel(t, message),
  });
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
