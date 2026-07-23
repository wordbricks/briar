import {
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Inbox as InboxIcon,
  PanelLeftOpen,
} from "lucide-react";
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
  onSidebarOpen,
  unreadCount,
}: {
  companionMode?: boolean;
  isSidebarOpen: boolean;
  messages: InboxMessageWithReadState[];
  onMarkAllRead: () => void;
  onOpen: (message: InboxMessageWithReadState) => void;
  onSidebarOpen: () => void;
  unreadCount: number;
}) {
  const { localeTag, t } = useI18n();

  const inboxContent = (
    <div className="inbox-scroll">
      <section className="inbox-content" aria-labelledby="inbox-title">
        <header className="inbox-heading">
          <div>
            <p className="eyebrow"><InboxIcon size={13} />{t("inbox.eyebrow")}</p>
            <h1 id="inbox-title">{t("inbox.title")}</h1>
            <p>{t("inbox.description")}</p>
          </div>
          {unreadCount > 0 && (
            <button onClick={onMarkAllRead} type="button">
              <Check size={14} />
              {t("inbox.markAllRead")}
            </button>
          )}
        </header>

        <section className="inbox-panel" aria-label={t("inbox.messages")}>
          <header>
            <strong>{t("inbox.messages")}</strong>
            <span>{t("inbox.unreadCount", { count: unreadCount })}</span>
          </header>

          {messages.length === 0 ? (
            <div className="inbox-empty">
              <span><InboxIcon size={23} /></span>
              <strong>{t("inbox.emptyTitle")}</strong>
              <p>{t("inbox.emptyDescription")}</p>
            </div>
          ) : (
            <div className="inbox-list">
              {messages.map((message) => (
                <button
                  className={`inbox-message${message.isUnread ? " unread" : ""}`}
                  key={message.id}
                  onClick={() => onOpen(message)}
                  type="button"
                >
                  <span
                    className={`inbox-message-icon ${message.kind} ${message.status}`}
                  >
                    {message.kind === "session"
                      ? <Bot size={17} />
                      : message.status === "failed" || message.status === "blocked"
                        ? <CircleAlert size={17} />
                        : message.status === "completed"
                          ? <CheckCircle2 size={17} />
                          : <Clock3 size={17} />}
                  </span>
                  <span className="inbox-message-copy">
                    <span>
                      <strong>{messageTitle(t, message)}</strong>
                      {message.isUnread && (
                        <i
                          aria-label={t("inbox.unread")}
                          className="inbox-unread-dot"
                        />
                      )}
                    </span>
                    <small>{messageDescription(t, message)}</small>
                    <em>
                      <span>{message.projectName}</span>
                      <Clock3 size={11} />
                      <time dateTime={message.occurredAt}>
                        {formatDate(message.occurredAt, localeTag)}
                      </time>
                    </em>
                  </span>
                  <ChevronRight size={16} />
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
      <main className="main-content companion-inbox" id="inbox">
        {inboxContent}
      </main>
    );
  }

  return (
    <main className="main-content" id="inbox">
      <header
        className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region
      >
        {!isSidebarOpen && (
          <button
            aria-controls="app-sidebar"
            aria-expanded="false"
            aria-label={t("sidebar.open")}
            className="sidebar-toggle"
            onClick={onSidebarOpen}
            title={t("sidebar.open")}
            type="button"
          >
            <PanelLeftOpen size={17} />
          </button>
        )}
        <div className="window-controls" aria-hidden="true"><i /><i /><i /></div>
      </header>
      {inboxContent}
    </main>
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
