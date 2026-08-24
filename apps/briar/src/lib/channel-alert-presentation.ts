import {
  channelMessageBlocksFallback,
  type ChannelMessage,
  type ChannelMessageBlock,
} from "./channels-contract";

export type ChannelAlertTone = "error" | "warning";

export type ChannelAlertPreview = {
  preview: string;
  collapsed: boolean;
};

const ERROR_KEYWORD =
  /\b(?:error|errors|exception|fatal|panic|critical|fail(?:ed|ure)?|traceback|alarm|alert)\b|에러|오류|실패|알람|치명|错误|失败|告警|报警|致命/iu;
const WARNING_KEYWORD =
  /\b(?:warn(?:ing)?|degraded)\b|경고|警告/iu;
const STACK_TRACE =
  /traceback \(most recent call last\)|^\s*at \S+|^\s*File "[^"]+", line \d+/imu;

export function prettyPrintJson(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object") return null;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

export function isStackTrace(value: string): boolean {
  return STACK_TRACE.test(value);
}

export function formattedChannelDump(value: string): string {
  return prettyPrintJson(value) ?? value;
}

export function shouldCollapseChannelText(
  value: string,
  expand = false,
): boolean {
  if (expand) return true;
  const lines = value.split("\n").length;
  if (prettyPrintJson(value) && (lines > 2 || value.length > 120)) return true;
  if (isStackTrace(value)) return true;
  return lines >= 8 || value.length >= 480;
}

export function channelAlertPreview(
  value: string,
  options: { maxLines?: number; maxChars?: number; force?: boolean } = {},
): ChannelAlertPreview {
  const maxLines = options.maxLines ?? 4;
  const maxChars = options.maxChars ?? 280;
  const collapsed = options.force === true || shouldCollapseChannelText(value);
  if (!collapsed) return { preview: value, collapsed: false };

  const lines = value.split("\n");
  let preview = lines.slice(0, maxLines).join("\n").trimEnd();
  if (preview.length > maxChars) {
    preview = `${preview.slice(0, maxChars).trimEnd()}…`;
  } else if (lines.length > maxLines || value.length > preview.length) {
    preview = `${preview}…`;
  }
  return { preview, collapsed: true };
}

function keywordTone(value: string): ChannelAlertTone | null {
  if (ERROR_KEYWORD.test(value)) return "error";
  if (WARNING_KEYWORD.test(value)) return "warning";
  return null;
}

function toneFromUnknown(value: unknown): ChannelAlertTone | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const tone = toneFromUnknown(item);
      if (tone) return tone;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const field of [
    record.level,
    record.severity,
    record.status,
    record.error,
    record.type,
    record.kind,
  ]) {
    if (typeof field === "string") {
      const tone = keywordTone(field);
      if (tone) return tone;
    }
    if (field && typeof field === "object") return "error";
  }
  if (record.error != null || record.exception != null) return "error";
  return null;
}

function jsonAlertTone(value: string): ChannelAlertTone | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return toneFromUnknown(JSON.parse(trimmed) as unknown);
  } catch {
    return null;
  }
}

export function channelAlertToneFromText(
  value: string,
  authorType?: string,
): ChannelAlertTone | null {
  const jsonTone = jsonAlertTone(value);
  if (jsonTone) return jsonTone;
  if (isStackTrace(value)) return "error";
  const keyword = keywordTone(value);
  if (!keyword) return null;
  if (authorType === "webhook") return keyword;
  if (prettyPrintJson(value) || shouldCollapseChannelText(value)) return keyword;
  return null;
}

export function channelMessageAlertText(message: {
  author: { type: string; name: string };
  body: string;
  blocks?: ChannelMessageBlock[] | null;
}): string {
  const body = message.blocks?.length
    ? channelMessageBlocksFallback(message.blocks)
    : message.body;
  return [message.author.name, body].filter(Boolean).join("\n");
}

export function channelAlertToneFromMessage(
  message: Pick<ChannelMessage, "author" | "body"> & {
    blocks?: ChannelMessageBlock[] | null;
  },
): ChannelAlertTone | null {
  return channelAlertToneFromText(
    channelMessageAlertText(message),
    message.author.type,
  );
}
