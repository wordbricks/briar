import type { AutoHuntRunStatus } from "../../src/lib/auto-hunt-contract";
import {
  maxIssueAttachmentCount,
  validateIssueAttachments,
} from "../../src/lib/issue-attachments";
import { formatIssueKey } from "../../src/lib/issue-key";
import {
  issueTitleAbsoluteMaxLength,
  issueTitleInputMaxLength,
  issueTitleLength,
  issueTitleTooLongMessageKo,
  isIssueTitleWithinLimit,
} from "../../src/lib/issue-title";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const slackBotScopes = [
  "app_mentions:read",
  "chat:write",
  "commands",
  "files:read",
] as const;
export const slackOAuthStateTtlMs = 10 * 60_000;
export const slackEventClaimTtlMs = 5 * 60_000;
export const slackCreateIssueCallbackId = "briar_create_issue";
export const slackCreateIssueShortcutCallbackId =
  "briar_create_issue_shortcut";
export const slackCreateIssueBlocks = {
  project: "briar_create_project",
  title: "briar_create_title",
  description: "briar_create_description",
  attachments: "briar_create_attachments",
} as const;
const slackCreateIssueActions = {
  project: "project",
  title: "title",
  description: "description",
  attachments: "attachments",
} as const;

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const timingSafeEqual = (left: string, right: string) => {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

export async function sha256Hex(value: string) {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
  );
}

export function randomUrlSafeToken(bytes = 32) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export async function verifySlackRequest(
  rawBody: string,
  headers: Headers,
  signingSecret: string,
  now = Date.now(),
) {
  const timestamp = headers.get("x-slack-request-timestamp");
  const signature = headers.get("x-slack-signature");
  if (!timestamp || !signature || !/^\d+$/u.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 5 * 60) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`v0:${timestamp}:${rawBody}`),
    ),
  );
  return timingSafeEqual(`v0=${bytesToHex(digest)}`, signature);
}

async function tokenEncryptionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSlackToken(token: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await tokenEncryptionKey(secret),
    encoder.encode(token),
  );
  return {
    encryptedToken: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptSlackToken(
  encryptedToken: string,
  iv: string,
  secret: string,
) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    await tokenEncryptionKey(secret),
    base64ToBytes(encryptedToken),
  );
  return decoder.decode(plaintext);
}

export type SlackIssueInstruction = {
  title: string;
  description: string | null;
  priority: number | null;
  status: Extract<AutoHuntRunStatus, "backlog" | "queued">;
  /** Present when the title exceeds the language-aware limit. */
  titleTooLong?: true;
};

const priorityByName: Record<string, number> = {
  urgent: 1,
  긴급: 1,
  high: 2,
  높음: 2,
  medium: 3,
  normal: 3,
  보통: 3,
  low: 4,
  낮음: 4,
};

export function parseSlackIssueInstruction(
  text: string,
): SlackIssueInstruction | null {
  let normalized = text
    .replace(/<@[A-Z0-9]+>/giu, " ")
    .replace(/\r\n?/gu, "\n")
    .trim();
  if (!normalized) return null;
  if (/^(?:help|도움말|사용법|\?)$/iu.test(normalized)) return null;

  let status: SlackIssueInstruction["status"] = "queued";
  normalized = normalized.replace(
    /(?:^|\s)--(backlog|백로그)(?=\s|$)/giu,
    () => {
      status = "backlog";
      return " ";
    },
  );
  normalized = normalized.replace(
    /(?:^|\s)--(?:queue|queued|대기)(?=\s|$)/giu,
    () => {
      status = "queued";
      return " ";
    },
  );

  let priority: number | null = null;
  normalized = normalized.replace(
    /(?:^|\s)--(?:priority|우선순위)(?:=|\s+)(p?[1-4]|urgent|high|medium|normal|low|긴급|높음|보통|낮음)(?=\s|$)/giu,
    (_match, rawPriority: string) => {
      const key = rawPriority.toLocaleLowerCase();
      priority = /^p?[1-4]$/u.test(key)
        ? Number(key.replace(/^p/u, ""))
        : (priorityByName[key] ?? null);
      return " ";
    },
  );

  normalized = normalized
    .replace(
      /^(?:(?:이슈|issue|bug|버그)\s*)?(?:만들어\s*줘|만들어줘|생성해\s*줘|생성해줘|생성|등록|create|file)\s*[:：-]?\s*/iu,
      "",
    )
    .replace(/^(?:이슈|issue)\s*[:：-]\s*/iu, "")
    .trim();

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const title = lines.shift()?.replace(/\s+/gu, " ").trim() ?? "";
  if (!title) return null;
  const description = lines.length > 0 ? lines.join("\n") : null;
  // Keep the full title (capped only at the storage ceiling) so callers can
  // reject over-limit mentions with guidance instead of silently truncating.
  const boundedTitle =
    issueTitleLength(title) > issueTitleAbsoluteMaxLength
      ? title.slice(0, issueTitleAbsoluteMaxLength)
      : title;
  if (!isIssueTitleWithinLimit(boundedTitle)) {
    return {
      title: boundedTitle,
      description,
      priority,
      status,
      titleTooLong: true,
    };
  }
  return {
    title: boundedTitle,
    description,
    priority,
    status,
  };
}

export function slackHelpMessage() {
  return [
    "*Briar 이슈 만들기*",
    "멘션 뒤 첫 줄은 제목, 다음 줄부터는 설명으로 저장됩니다.",
    "예: `@Briar 로그인 버튼이 동작하지 않아요 --priority high`",
    "옵션: `--backlog`, `--priority P1` (P1~P4)",
  ].join("\n");
}

/** Human-readable Briar issue key shown in the app and Slack confirmations. */
export function formatBriarIssueKey(runNumber: number, issueKeyPrefix?: string) {
  return formatIssueKey(issueKeyPrefix, runNumber);
}

export function buildSlackIssueCreatedMessage(input: {
  title: string;
  projectName: string;
  statusLabel: string;
  priorityLabel?: string;
  runNumber: number;
  issueKeyPrefix?: string;
}) {
  const priorityLabel = input.priorityLabel ?? "";
  return [
    `:white_check_mark: *${input.title}* 이슈를 만들었습니다.`,
    `프로젝트: ${input.projectName} · ${input.statusLabel}${priorityLabel}`,
    `이슈 ID: \`${formatBriarIssueKey(input.runNumber, input.issueKeyPrefix)}\``,
  ].join("\n");
}

type SlackCreateIssueProject = {
  id: string;
  name: string;
};

type SlackCreateIssueMetadata = {
  source: "command" | "shortcut";
  responseUrl: string | null;
  channelId: string | null;
};

export type SlackCreateIssueSubmission = {
  teamId: string;
  userId: string;
  viewId: string;
  projectId: string;
  title: string;
  description: string | null;
  fileIds: string[];
  source: "command" | "shortcut";
  responseUrl: string | null;
  channelId: string | null;
};

export class SlackCreateIssueValidationError extends Error {
  constructor(
    readonly blockId: string,
    message: string,
  ) {
    super(message);
  }
}

const plainText = (text: string) => ({
  type: "plain_text" as const,
  text,
  emoji: true,
});

const slackOption = (project: SlackCreateIssueProject) => ({
  text: plainText(project.name.slice(0, 75)),
  value: project.id,
});

export function buildSlackCreateIssueModal(input: {
  projects: SlackCreateIssueProject[];
  defaultProjectId: string | null;
  responseUrl: string | null;
  channelId: string | null;
  initialTitle?: string;
}) {
  const projects = input.projects.slice(0, 100);
  const defaultProject =
    projects.find((project) => project.id === input.defaultProjectId) ??
    projects[0];
  if (!defaultProject) {
    throw new Error("A project is required to build the Slack issue modal");
  }
  const initialTitleRaw = input.initialTitle?.trim() ?? "";
  const initialTitle = initialTitleRaw
    ? initialTitleRaw.slice(
        0,
        Math.min(
          issueTitleInputMaxLength(initialTitleRaw, "ko"),
          issueTitleAbsoluteMaxLength,
        ),
      )
    : undefined;
  return {
    type: "modal",
    callback_id: slackCreateIssueCallbackId,
    private_metadata: JSON.stringify({
      source: input.responseUrl ? "command" : "shortcut",
      responseUrl: input.responseUrl,
      channelId: input.channelId,
    } satisfies SlackCreateIssueMetadata),
    title: plainText("Create a new issue"),
    submit: plainText("Create"),
    close: plainText("Cancel"),
    blocks: [
      {
        type: "input",
        block_id: slackCreateIssueBlocks.project,
        label: plainText("Project"),
        element: {
          type: "static_select",
          action_id: slackCreateIssueActions.project,
          placeholder: plainText("Select a project"),
          options: projects.map(slackOption),
          initial_option: slackOption(defaultProject),
        },
      },
      {
        type: "input",
        block_id: slackCreateIssueBlocks.title,
        label: plainText("Title"),
        element: {
          type: "plain_text_input",
          action_id: slackCreateIssueActions.title,
          placeholder: plainText("Issue title"),
          // Hard input ceiling is the highest language-aware budget (Latin).
          // Submit validation still applies Hangul/Han/Kana-specific limits.
          max_length: issueTitleInputMaxLength("A", "en"),
          ...(initialTitle ? { initial_value: initialTitle } : {}),
        },
      },
      {
        type: "input",
        block_id: slackCreateIssueBlocks.description,
        optional: true,
        label: plainText("Description"),
        element: {
          type: "plain_text_input",
          action_id: slackCreateIssueActions.description,
          placeholder: plainText("Add some details…"),
          multiline: true,
          max_length: 3000,
        },
      },
      {
        type: "input",
        block_id: slackCreateIssueBlocks.attachments,
        optional: true,
        label: plainText("Attachments"),
        hint: plainText("Up to 5 images or videos, 25MB total"),
        element: {
          type: "file_input",
          action_id: slackCreateIssueActions.attachments,
          max_files: maxIssueAttachmentCount,
        },
      },
    ],
  };
}

const recordValue = (value: unknown) =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const stateAction = (
  values: unknown,
  blockId: string,
  actionId: string,
) => {
  const block = recordValue(recordValue(values)?.[blockId]);
  return recordValue(block?.[actionId]);
};

const selectedFileIds = (value: Record<string, unknown> | null) => {
  const rawFiles = Array.isArray(value?.files)
    ? value.files
    : Array.isArray(value?.selected_files)
      ? value.selected_files
      : [];
  return rawFiles
    .map((file) =>
      typeof file === "string"
        ? file
        : typeof recordValue(file)?.id === "string"
          ? (recordValue(file)!.id as string)
          : null,
    )
    .filter((id): id is string => Boolean(id));
};

const parseSlackResponseUrl = (value: unknown) => {
  if (typeof value !== "string") throw new Error("Slack response URL is missing");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "hooks.slack.com" ||
    !url.pathname.startsWith("/commands/")
  ) {
    throw new Error("Slack response URL is invalid");
  }
  return url.toString();
};

export function parseSlackCreateIssueSubmission(
  payload: unknown,
): SlackCreateIssueSubmission {
  const root = recordValue(payload);
  const view = recordValue(root?.view);
  const team = recordValue(root?.team);
  const user = recordValue(root?.user);
  const state = recordValue(view?.state);
  const project = stateAction(
    state?.values,
    slackCreateIssueBlocks.project,
    slackCreateIssueActions.project,
  );
  const selectedProject = recordValue(project?.selected_option);
  const projectId =
    typeof selectedProject?.value === "string" ? selectedProject.value : "";
  if (!projectId) {
    throw new SlackCreateIssueValidationError(
      slackCreateIssueBlocks.project,
      "프로젝트를 선택해 주세요.",
    );
  }

  const titleState = stateAction(
    state?.values,
    slackCreateIssueBlocks.title,
    slackCreateIssueActions.title,
  );
  const title = typeof titleState?.value === "string" ? titleState.value.trim() : "";
  if (!title) {
    throw new SlackCreateIssueValidationError(
      slackCreateIssueBlocks.title,
      "제목을 입력해 주세요.",
    );
  }
  if (!isIssueTitleWithinLimit(title)) {
    throw new SlackCreateIssueValidationError(
      slackCreateIssueBlocks.title,
      issueTitleTooLongMessageKo(title),
    );
  }

  const descriptionState = stateAction(
    state?.values,
    slackCreateIssueBlocks.description,
    slackCreateIssueActions.description,
  );
  const description =
    typeof descriptionState?.value === "string" && descriptionState.value.trim()
      ? descriptionState.value.trim()
      : null;
  const fileIds = selectedFileIds(
    stateAction(
      state?.values,
      slackCreateIssueBlocks.attachments,
      slackCreateIssueActions.attachments,
    ),
  );
  if (fileIds.length > maxIssueAttachmentCount) {
    throw new SlackCreateIssueValidationError(
      slackCreateIssueBlocks.attachments,
      `첨부 파일은 최대 ${maxIssueAttachmentCount}개까지 추가할 수 있습니다.`,
    );
  }

  let metadata: Record<string, unknown>;
  try {
    metadata = recordValue(
      JSON.parse(typeof view?.private_metadata === "string" ? view.private_metadata : ""),
    ) ?? {};
  } catch {
    throw new Error("Slack modal metadata is invalid");
  }
  const teamId =
    typeof team?.id === "string"
      ? team.id
      : typeof user?.team_id === "string"
        ? user.team_id
        : "";
  const userId = typeof user?.id === "string" ? user.id : "";
  const viewId = typeof view?.id === "string" ? view.id : "";
  const source =
    metadata.source === "shortcut" || metadata.responseUrl === null
      ? "shortcut"
      : "command";
  const responseUrl =
    metadata.responseUrl === null
      ? null
      : parseSlackResponseUrl(metadata.responseUrl);
  const channelId =
    typeof metadata.channelId === "string" && metadata.channelId
      ? metadata.channelId
      : null;
  if (
    !teamId ||
    !userId ||
    !viewId ||
    (source === "command" && (!responseUrl || !channelId))
  ) {
    throw new Error("Slack modal context is incomplete");
  }

  return {
    teamId,
    userId,
    viewId,
    projectId,
    title,
    description,
    fileIds,
    source,
    responseUrl,
    channelId,
  };
}

type SlackApiResponse = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

export async function callSlackApi<T extends SlackApiResponse>(
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as T;
  if (!response.ok || !result.ok) {
    const metadata = recordValue(result.response_metadata);
    const messages = Array.isArray(metadata?.messages)
      ? metadata.messages.filter(
          (message): message is string => typeof message === "string",
        )
      : [];
    const detail = messages.length > 0 ? ` (${messages.join("; ")})` : "";
    throw new Error(
      `Slack ${method} failed: ${result.error ?? response.status}${detail}`,
    );
  }
  return result;
}

export async function downloadSlackIssueAttachments(
  token: string,
  fileIds: string[],
) {
  const files = await Promise.all(
    fileIds.map(async (fileId) => {
      const result = await callSlackApi<SlackApiResponse & {
        file?: {
          id?: string;
          name?: string;
          title?: string;
          mimetype?: string;
          size?: number;
          url_private?: string;
          url_private_download?: string;
        };
      }>("files.info", token, { file: fileId });
      const file = result.file;
      const name = file?.name?.trim() || file?.title?.trim() || "";
      const type = file?.mimetype ?? "";
      const size = file?.size ?? 0;
      const downloadUrl = file?.url_private_download ?? file?.url_private;
      if (!file || file.id !== fileId || !downloadUrl) {
        throw new Error("Slack file metadata is incomplete");
      }
      return { name, type, size, downloadUrl };
    }),
  );
  const attachmentError = validateIssueAttachments(files);
  if (attachmentError) throw new Error(attachmentError);

  const downloads = await Promise.all(
    files.map(async (file) => {
      const response = await fetch(file.downloadUrl, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`Slack file download failed: ${response.status}`);
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== file.size) {
        throw new Error("Slack file size changed during download");
      }
      return new File([bytes], file.name, { type: file.type });
    }),
  );
  const downloadedAttachmentError = validateIssueAttachments(downloads);
  if (downloadedAttachmentError) throw new Error(downloadedAttachmentError);
  return downloads;
}

export async function postSlackCommandResponse(
  responseUrl: string,
  text: string,
) {
  const response = await fetch(parseSlackResponseUrl(responseUrl), {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ response_type: "ephemeral", text }),
  });
  if (!response.ok) {
    throw new Error(`Slack command response failed: ${response.status}`);
  }
}

export async function exchangeSlackOAuthCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}) {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = (await response.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
  };
  if (
    !response.ok ||
    !result.ok ||
    !result.access_token ||
    !result.bot_user_id ||
    !result.team?.id ||
    !result.team.name
  ) {
    throw new Error(`Slack OAuth failed: ${result.error ?? response.status}`);
  }
  return {
    token: result.access_token,
    botUserId: result.bot_user_id,
    teamId: result.team.id,
    teamName: result.team.name,
  };
}
