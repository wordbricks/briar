import { useState, type ReactNode } from "react";
import {
  channelAlertPreview,
  formattedChannelDump,
  type ChannelAlertTone,
} from "../lib/channel-alert-presentation";
import { useI18n } from "../i18n";

export function ChannelAlertCard({
  tone,
  children,
}: {
  tone: ChannelAlertTone;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div
      className={`channel-alert-card ${tone}`}
      data-alert-tone={tone}
      role="status"
    >
      <span className="channel-alert-label">
        {tone === "error" ? t("channel.alertError") : t("channel.alertWarning")}
      </span>
      {children}
    </div>
  );
}

export function ChannelCollapsibleDump({
  text,
  children,
}: {
  text: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const dump = formattedChannelDump(text);
  const preview = channelAlertPreview(dump, { force: true });

  return (
    <div className="channel-alert-dump-wrap">
      {open ? children : (
        <pre className="channel-alert-preview">{preview.preview}</pre>
      )}
      <button
        className="channel-alert-toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {open ? t("channel.alertHideDetails") : t("channel.alertShowDetails")}
      </button>
    </div>
  );
}

export function ChannelErrorNotice({
  className,
  text,
}: {
  className: string;
  text: string;
}) {
  const preview = channelAlertPreview(text, { maxLines: 2, maxChars: 220 });
  if (!preview.collapsed) {
    return <div className={className} role="alert">{text}</div>;
  }

  return (
    <div className={`${className} has-details`} role="alert">
      <ChannelCollapsibleDump text={text}>
        <pre className="channel-alert-dump">{formattedChannelDump(text)}</pre>
      </ChannelCollapsibleDump>
    </div>
  );
}

export function ChannelReplyFailure({ error }: { error: string }) {
  const { t } = useI18n();
  const preview = channelAlertPreview(error);
  return (
    <aside className="channel-reply-failure" role="status">
      <strong>{t("channel.replyFailedTitle")}</strong>
      {preview.collapsed ? (
        <ChannelCollapsibleDump text={error}>
          <p className="channel-reply-failure-body">{error}</p>
        </ChannelCollapsibleDump>
      ) : (
        <p className="channel-reply-failure-body">{error}</p>
      )}
    </aside>
  );
}
