import { z } from "zod";
import briarMarkSvg from "../../src/assets/briar-mark.svg";
import briarIconSvg from "../../src-tauri/app-icon.svg";
import {
  autoHuntQaEnvironments,
  autoHuntRunStatuses,
  autoHuntSources,
  autoHuntStages,
  autoHuntWorkflowPresets,
  defaultAutoHuntWorkflow,
  normalizeAutoHuntWorkflow,
  progressForAutoHuntRun,
  type AutoHuntRunStatus,
  type AutoHuntStage,
  type AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";
import {
  defaultAutoHuntAutomation,
  normalizeAutoHuntAutomation,
} from "../../src/lib/auto-hunt-automation";
import {
  maxIssueMultipartBytes,
  validateIssueAttachments,
} from "../../src/lib/issue-attachments";
import { createAuth, type BriarAuth } from "./auth";
import {
  addOrganizationMember,
  assertQueuedHuntClaim,
  claimNextQueuedHuntRun,
  createIssueAttachments,
  createOrganization,
  createProject,
  deleteProject,
  EventKeyConflictError,
  findProjectIdByAgentTokenHash,
  getIssueAttachment,
  getOrganizationRole,
  getNextQueuedHuntRun,
  getProject,
  getProjectSettings,
  getHuntRunForProject,
  HuntClaimError,
  HuntTransitionError,
  listIssueAttachments,
  listDashboardRuns,
  listOrganizationMembers,
  listOrganizations,
  listProjects,
  moveHuntRun,
  recoverHuntRun,
  recordHuntEvent,
  recordQaResult,
  replaceProjectAgentToken,
  removeOrganizationMember,
  rollbackNewAppIssue,
  updateProjectSettings,
  type HuntEventRow,
  type HuntRunRow,
  type IssueAttachmentInput,
  type IssueAttachmentRow,
  type ProjectRow,
  type ProjectSettingsRow,
  type OrganizationMemberRow,
  type OrganizationRole,
  type OrganizationRow,
} from "./db";
import { serveRelease } from "./releases";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-briar-claim-token",
  "Access-Control-Allow-Methods": "DELETE, GET, HEAD, POST, PUT, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: corsHeaders });

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const stageSchema = z.enum(autoHuntStages);
const runStatusSchema = z.enum(autoHuntRunStatuses);
const workflowStageIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/u);
const workflowSchema = z
  .object({
    version: z.literal(1),
    preset: z.enum(autoHuntWorkflowPresets).optional(),
    stages: z
      .array(
        z
          .object({
            id: workflowStageIdSchema,
            label: z.string().trim().min(1).max(80),
            required: z.boolean(),
            evidence: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
            checks: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    completion: z
      .object({
        requiredStages: z.array(workflowStageIdSchema).max(30),
      })
      .strict()
      .optional(),
    release: z.object({ enabled: z.boolean() }).strict().optional(),
  })
  .strict()
  .transform(normalizeAutoHuntWorkflow);

const statusForLegacyStage = (stage: AutoHuntStage): AutoHuntRunStatus => {
  if (stage === "queued") return "queued";
  if (["blocked", "failed", "completed", "cancelled"].includes(stage)) {
    return stage as AutoHuntRunStatus;
  }
  return "running";
};

const workflowStageForLegacyStage = (
  stage: AutoHuntStage,
): AutoHuntWorkflowStageId | null =>
  ["analyzing", "implementing", "pr_open", "staging_qa", "production_qa"].includes(
    stage,
  )
    ? (stage as AutoHuntWorkflowStageId)
    : null;

const legacyStageForProgress = (
  status: AutoHuntRunStatus,
  workflowStage: AutoHuntWorkflowStageId | null,
): AutoHuntStage => {
  if (status !== "running") return status;
  return workflowStage &&
    ["analyzing", "implementing", "pr_open", "staging_qa", "production_qa"].includes(
      workflowStage,
    )
    ? (workflowStage as AutoHuntStage)
    : "implementing";
};
const nullableTrimmed = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional();
const httpsUrl = z
  .string()
  .url()
  .max(1_000)
  .refine((value) => new URL(value).protocol === "https:", "HTTPS URL required");
const trackerSchema = z
  .object({
    provider: z.string().trim().min(1).max(50),
    issueId: nullableTrimmed(200),
    identifier: nullableTrimmed(100),
    url: httpsUrl.nullable().optional(),
    state: nullableTrimmed(100),
  })
  .strict();

const eventSchema = z
  .object({
    source: z.enum(autoHuntSources),
    sourceKey: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(300),
    stage: stageSchema.optional(),
    status: runStatusSchema.optional(),
    workflowStage: workflowStageIdSchema.nullable().optional(),
    eventKey: z.string().trim().min(1).max(300),
    occurredAt: z.string().datetime({ offset: true }),
    actor: z.string().trim().min(1).max(128),
    repository: z.string().trim().min(1).max(500),
    detail: z.string().max(4_000).nullable().optional(),
    priority: z.number().int().min(1).max(4).nullable().optional(),
    branch: nullableTrimmed(500),
    commitSha: z.string().regex(/^[0-9a-f]{7,64}$/u).nullable().optional(),
    tracker: trackerSchema.nullable().optional(),
    issueDescription: z.string().max(100_000).nullable().optional(),
    resultSummary: z.string().max(100_000).nullable().optional(),
    pullRequestUrls: z
      .array(httpsUrl)
      .max(20)
      .default([])
      .transform((urls) => [...new Set(urls)].sort()),
    targetSha: z.string().regex(/^[0-9a-f]{7,64}$/u).nullable().optional(),
    sourceCreatedAt: z.string().datetime({ offset: true }).nullable().optional(),
    qaStatus: z.literal("pending").nullable().optional(),
    stagingQaDetail: z.string().max(100_000).nullable().optional(),
    productionQaDetail: z.string().max(100_000).nullable().optional(),
    context: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const status = input.status ?? input.stage;
    if (!input.stage && !input.status) {
      context.addIssue({
        code: "custom",
        message: "status or legacy stage is required",
        path: ["status"],
      });
    }
    if (status === "running" && !input.workflowStage) {
      context.addIssue({
        code: "custom",
        message: "running progress requires a workflow stage",
        path: ["workflowStage"],
      });
    }
    if (status === "blocked" && !input.detail?.trim()) {
      context.addIssue({
        code: "custom",
        message: "blocked progress requires an exact blocker reason",
        path: ["detail"],
      });
    }
    const qaStage = input.workflowStage ?? input.stage;
    if (input.qaStatus && qaStage !== "staging_qa" && qaStage !== "production_qa") {
      context.addIssue({
        code: "custom",
        message: "QA status requires a QA stage",
        path: ["qaStatus"],
      });
    }
    if (
      (qaStage === "staging_qa" || qaStage === "production_qa") &&
      input.qaStatus !== "pending"
    ) {
      context.addIssue({
        code: "custom",
        message: "QA stages require a pending QA status",
        path: ["qaStatus"],
      });
    }
    if (input.tracker?.provider === "linear" && input.tracker.url) {
      if (new URL(input.tracker.url).hostname !== "linear.app") {
        context.addIssue({
          code: "custom",
          message: "Linear tracker URLs must use linear.app",
          path: ["tracker", "url"],
        });
      }
    }
  });

const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  organizationId: z.string().uuid().optional(),
});
const organizationInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
const organizationMemberInputSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum(["admin", "member"]).default("member"),
});

const issueInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(100_000).nullable().optional(),
    priority: z.number().int().min(1).max(4).nullable().optional(),
  })
  .strict();

export async function readIssueRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return {
      input: issueInputSchema.parse(await readJson(request)),
      attachments: [] as File[],
    };
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    throw new HttpError(411, "Multipart Content-Length is required");
  }
  if (declaredLength > maxIssueMultipartBytes) {
    throw new HttpError(413, "Issue attachments exceed the 25MB total limit");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Invalid multipart form data");
  }
  const rawAttachments = form.getAll("attachments");
  if (rawAttachments.some((attachment) => !(attachment instanceof File))) {
    throw new HttpError(400, "Attachments must be files");
  }
  const attachments = rawAttachments as File[];
  const attachmentError = validateIssueAttachments(attachments);
  if (attachmentError) throw new HttpError(400, attachmentError);

  const description = form.get("description");
  const priority = form.get("priority");
  return {
    input: issueInputSchema.parse({
      title: form.get("title"),
      description:
        typeof description === "string" && description.trim()
          ? description
          : null,
      priority:
        typeof priority === "string" && priority ? Number(priority) : null,
    }),
    attachments,
  };
}

const claimInputSchema = z
  .object({
    claimedBy: z.string().trim().min(1).max(128),
  })
  .strict();

const recoveryUserInputSchema = z
  .object({
    requestId: z.string().uuid(),
    reason: z.string().trim().min(1).max(4_000).nullable().optional(),
  })
  .strict();

const recoveryAgentInputSchema = recoveryUserInputSchema.extend({
  actor: z.string().trim().min(1).max(128),
});

const moveRunInputSchema = z
  .object({
    requestId: z.string().uuid(),
    status: runStatusSchema,
    workflowStage: workflowStageIdSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.status === "running" && !input.workflowStage) {
      context.addIssue({
        code: "custom",
        message: "running status requires a workflow stage",
        path: ["workflowStage"],
      });
    }
    if (input.status !== "running" && input.workflowStage !== null) {
      context.addIssue({
        code: "custom",
        message: "only running status can select a workflow stage",
        path: ["workflowStage"],
      });
    }
  });

const projectSettingsSchema = z
  .object({
    velenOrg: nullableTrimmed(100),
    dataSource: nullableTrimmed(300),
    linear: z
      .object({
        enabled: z.boolean(),
        source: z.string().trim().regex(/^linear:\/\/.+/u).max(300).nullable(),
        teamKey: z.string().trim().min(1).max(100).nullable(),
      })
      .strict(),
    githubRepository: nullableTrimmed(300),
    workflow: workflowSchema.default(defaultAutoHuntWorkflow),
    automation: z
      .object({
        enabled: z.boolean(),
        maxIssuesPerSession: z.number().int().min(1).max(10),
        schedule: z
          .object({
            enabled: z.boolean(),
            intervalHours: z.number().int().min(1).max(168),
          })
          .strict(),
        queueThreshold: z
          .object({
            enabled: z.boolean(),
            minimumIssues: z.number().int().min(1).max(100),
          })
          .strict(),
        urgentIssue: z.object({ enabled: z.boolean() }).strict(),
      })
      .strict()
      .transform(normalizeAutoHuntAutomation)
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.linear.enabled && (!input.velenOrg || !input.linear.source)) {
      context.addIssue({
        code: "custom",
        message: "Linear integration requires a Velen org and Linear source",
        path: ["linear"],
      });
    }
  });

const qaResultSchema = z
  .object({
    runId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u),
    environment: z.enum(autoHuntQaEnvironments),
    result: z.enum(["passed", "skipped"]),
    actor: z.string().trim().min(1).max(128),
    observedAt: z.string().datetime({ offset: true }),
    detail: z.string().max(100_000).nullable().optional(),
  })
  .strict();

async function readJson(request: Request, maxBytes = 262_144): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) throw new HttpError(413, "Request body too large");
  if (!request.body) throw new HttpError(400, "Request body is required");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Request body too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const svgResponse = (svg: string) =>
  new Response(svg, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "image/svg+xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });

const contentDisposition = (filename: string) =>
  `inline; filename*=UTF-8''${encodeURIComponent(filename).replace(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )}`;

const attachmentResponse = (
  attachment: IssueAttachmentRow,
  object: R2Object,
  body: BodyInit | null,
) => {
  const headers = new Headers(corsHeaders);
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("Content-Disposition", contentDisposition(attachment.filename));
  headers.set("Content-Length", String(object.size));
  headers.set("Content-Type", attachment.content_type);
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(body, { headers });
};

const devicePage = (apiOrigin: string, androidCompanion: boolean) => {
  const copy = androidCompanion
    ? {
        eyebrow: "ANDROID COMPANION",
        title: "Companion 로그인 승인",
        description:
          "Google 계정으로 로그인한 뒤 이 Android 기기의 Briar Companion 로그인을 승인하세요.",
        approve: "이 기기에서 로그인하기",
      }
    : {
        eyebrow: "DEVICE AUTHORIZATION",
        title: "데스크톱 연결 승인",
        description:
          "Google 계정으로 로그인한 뒤 Briar 데스크톱의 접근을 승인하세요.",
        approve: "이 기기 승인하기",
      };

  return new Response(
    `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/brand/briar-icon.svg"><title>Briar 로그인</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090b;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(390px,calc(100vw - 32px));padding:30px;border:1px solid #282a30;border-radius:14px;background:#111318;box-shadow:0 30px 100px #0008}.brand{display:flex;align-items:center;gap:10px;font-weight:750;font-size:20px}.brand img{width:26px;height:26px;display:block}.eyebrow{margin-top:32px;color:#8979cf;font:500 10px monospace;letter-spacing:1px}.code{margin:18px 0;padding:15px;border:1px solid #332e49;border-radius:8px;background:#171420;text-align:center;font:600 26px monospace;letter-spacing:4px}.copy{color:#838792;font-size:12px;line-height:1.6}.actions{display:grid;gap:8px;margin-top:22px}button{height:42px;border:1px solid #34363d;border-radius:8px;background:#f4f4f5;color:#18191d;font-weight:650;cursor:pointer}button.secondary{background:#191b20;color:#aaaeb8}.status{min-height:18px;margin-top:12px;color:#777b86;font-size:11px;text-align:center}</style></head>
<body><main class="card"><div class="brand"><img src="/brand/briar-mark.svg" alt="">briar</div><p class="eyebrow">${copy.eyebrow}</p><h1>${copy.title}</h1><p class="copy">${copy.description}</p><div class="code" id="code">--------</div><div class="actions"><button id="google">Google로 로그인</button><button id="approve" hidden>${copy.approve}</button><button id="deny" class="secondary" hidden>거절</button></div><div class="status" id="status"></div></main>
<script>
const base=${JSON.stringify(apiOrigin)};const androidCompanion=${JSON.stringify(androidCompanion)};const returnUrl='briar-companion://auth-complete';const params=new URLSearchParams(location.search);const code=(params.get('user_code')||'').replace(/-/g,'').toUpperCase();const callbackParams=new URLSearchParams({user_code:code});if(androidCompanion)callbackParams.set('client','android');const callbackUrl=base+'/device?'+callbackParams.toString();document.querySelector('#code').textContent=code||'코드 없음';const status=document.querySelector('#status');const google=document.querySelector('#google');const approve=document.querySelector('#approve');const deny=document.querySelector('#deny');
async function api(path,options={}){const response=await fetch(base+'/api/auth'+path,{credentials:'include',headers:{'content-type':'application/json'},...options});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||data.error_description||'요청에 실패했습니다.');return data}
async function boot(){if(!code){status.textContent='유효한 기기 코드가 없습니다.';google.hidden=true;return}const session=await api('/get-session').catch(()=>null);if(!session?.user){status.textContent='먼저 Google 계정으로 로그인하세요.';return}google.hidden=true;await api('/device?user_code='+encodeURIComponent(code));approve.hidden=false;deny.hidden=false;status.textContent=session.user.email+' 계정으로 연결합니다.'}
google.onclick=async()=>{status.textContent='Google 로그인 페이지를 여는 중…';try{const data=await api('/sign-in/social',{method:'POST',body:JSON.stringify({provider:'google',callbackURL:callbackUrl})});location.href=data.url}catch(error){status.textContent=error.message}};
approve.onclick=async()=>{try{await api('/device/approve',{method:'POST',body:JSON.stringify({userCode:code})});approve.hidden=true;deny.hidden=true;if(androidCompanion){status.textContent='승인되었습니다. Briar Companion으로 돌아갑니다…';window.setTimeout(()=>location.replace(returnUrl),250)}else{status.textContent='승인되었습니다. Briar 앱으로 돌아가세요.'}}catch(error){status.textContent=error.message}};
deny.onclick=async()=>{try{await api('/device/deny',{method:'POST',body:JSON.stringify({userCode:code})});status.textContent='요청을 거절했습니다.'}catch(error){status.textContent=error.message}};void boot();
</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    },
  );
};

async function requireSession(auth: BriarAuth, request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new HttpError(401, "Unauthorized");
  return session;
}

async function requireAgentProject(db: D1Database, request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!token.startsWith("briar_agent_")) {
    throw new HttpError(401, "Invalid agent token");
  }
  const projectId = await findProjectIdByAgentTokenHash(db, await sha256(token));
  if (!projectId) throw new HttpError(401, "Invalid agent token");
  return projectId;
}

async function requireProjectAccess(
  auth: BriarAuth,
  db: D1Database,
  request: Request,
  projectId: string,
) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer briar_agent_")) {
    const agentProjectId = await requireAgentProject(db, request);
    if (agentProjectId !== projectId) throw new HttpError(404, "Attachment not found");
    return;
  }
  const session = await requireSession(auth, request);
  if (!(await getProject(db, projectId, session.user.id))) {
    throw new HttpError(404, "Attachment not found");
  }
}

function projectJson(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    role: row.member_role,
    createdAt: row.created_at,
  };
}

const organizationJson = (row: OrganizationRow) => ({
  id: row.id,
  name: row.name,
  role: row.role,
  createdAt: row.created_at,
});
const organizationMemberJson = (row: OrganizationMemberRow) => ({
  userId: row.user_id,
  name: row.name,
  email: row.email,
  image: row.image,
  role: row.role,
  createdAt: row.created_at,
});

const canManageOrganization = (role: OrganizationRole | null) =>
  role === "owner" || role === "admin";

const settingsJson = (row: ProjectSettingsRow | null) => ({
  velenOrg: row?.velen_org ?? null,
  dataSource: row?.data_source ?? null,
  linear: {
    enabled: row?.linear_enabled === 1,
    source: row?.linear_source ?? null,
    teamKey: row?.linear_team_key ?? null,
  },
  githubRepository: row?.github_repository ?? null,
  workflow: row?.workflow_json
    ? normalizeAutoHuntWorkflow(JSON.parse(row.workflow_json))
    : structuredClone(defaultAutoHuntWorkflow),
  automation: row?.auto_hunt_automation_json
    ? normalizeAutoHuntAutomation(JSON.parse(row.auto_hunt_automation_json))
    : structuredClone(defaultAutoHuntAutomation),
});

const parseJsonArray = (value: string) => {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
};

const parseJsonObject = (value: string | null) => {
  if (!value) return null;
  const parsed: unknown = JSON.parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : null;
};

const dashboardEventJson = (event: HuntEventRow) => ({
  id: event.id,
  attempt: event.attempt,
  status: event.status,
  workflowStage: event.workflow_stage,
  detail: event.detail,
  actor: event.actor,
  qaStatus: event.qa_status,
  trackerState: event.tracker_issue_state,
  pullRequestUrls: parseJsonArray(event.pull_request_urls),
  targetSha: event.target_sha,
  occurredAt: event.occurred_at,
  recordedAt: event.recorded_at,
});

const attachmentJson = (attachment: IssueAttachmentRow) => ({
  id: attachment.id,
  filename: attachment.filename,
  contentType: attachment.content_type,
  byteSize: attachment.byte_size,
  url: `/projects/${attachment.project_id}/runs/${attachment.run_id}/attachments/${attachment.id}`,
});

function dashboardRunJson(
  run: HuntRunRow,
  events: HuntEventRow[],
  attachments: IssueAttachmentRow[],
) {
  return {
    id: run.id,
    runNumber: run.run_number,
    currentAttempt: run.current_attempt,
    source: run.source,
    sourceKey: run.source_key,
    title: run.title,
    status: run.status,
    workflowStage: run.workflow_stage,
    workflow: normalizeAutoHuntWorkflow(JSON.parse(run.workflow_snapshot_json)),
    progress: progressForAutoHuntRun(
      run.status,
      run.workflow_stage,
      normalizeAutoHuntWorkflow(JSON.parse(run.workflow_snapshot_json)),
    ),
    detail: run.detail,
    priority: run.priority,
    repository: run.repository,
    branch: run.branch,
    commitSha: run.commit_sha,
    tracker: run.tracker_provider
      ? {
          provider: run.tracker_provider,
          issueId: run.tracker_issue_id,
          identifier: run.tracker_issue_identifier,
          url: run.tracker_issue_url,
          state: run.tracker_issue_state,
        }
      : null,
    issueDescription: run.issue_description,
    attachments: attachments.map(attachmentJson),
    resultSummary: run.result_summary,
    pullRequestUrls: parseJsonArray(run.pull_request_urls),
    targetSha: run.target_sha,
    sourceCreatedAt: run.source_created_at,
    stagingQaStatus: run.staging_qa_status,
    productionQaStatus: run.production_qa_status,
    stagingQaDetail: run.staging_qa_detail,
    productionQaDetail: run.production_qa_detail,
    context: parseJsonObject(run.context_json),
    claimedBy: run.claimed_by,
    claimedAt: run.claimed_at,
    leaseExpiresAt: run.lease_expires_at,
    claimAttempts: run.claim_attempts,
    startedAt: run.started_at,
    updatedAt: run.last_event_at,
    completedAt: run.completed_at,
    eventCount: run.event_count,
    events: events.map(dashboardEventJson),
  };
}

async function route(
  request: Request,
  auth: BriarAuth,
  db: D1Database,
  attachmentsBucket: R2Bucket,
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname.startsWith("/api/auth/")) {
    const response = await auth.handler(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders)) {
      headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  }

  if (pathname === "/me" && request.method === "GET") {
    const session = await requireSession(auth, request);
    return json({ user: session.user });
  }

  if (pathname === "/organizations" && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizations = await listOrganizations(db, session.user.id);
    return json({ organizations: organizations.map(organizationJson) });
  }

  if (pathname === "/organizations" && request.method === "POST") {
    const session = await requireSession(auth, request);
    const input = organizationInputSchema.parse(await readJson(request));
    const organization = await createOrganization(db, {
      name: input.name,
      ownerUserId: session.user.id,
    });
    return json({ organization: organizationJson(organization) }, 201);
  }

  const organizationMembersMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/members$/u,
  );
  if (organizationMembersMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationMembersMatch[1],
      session.user.id,
    );
    if (!role) throw new HttpError(404, "Organization not found");
    const members = await listOrganizationMembers(db, organizationMembersMatch[1]);
    return json({ members: members.map(organizationMemberJson) });
  }
  if (organizationMembersMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationMembersMatch[1],
      session.user.id,
    );
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = organizationMemberInputSchema.parse(await readJson(request));
    const userId = await addOrganizationMember(
      db,
      organizationMembersMatch[1],
      input.email,
      input.role,
    );
    if (!userId) {
      throw new HttpError(404, "A Briar user with that email was not found");
    }
    const members = await listOrganizationMembers(db, organizationMembersMatch[1]);
    return json({ members: members.map(organizationMemberJson) });
  }

  const organizationMemberMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/members\/([^/]+)$/u,
  );
  if (organizationMemberMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const role = await getOrganizationRole(
      db,
      organizationMemberMatch[1],
      session.user.id,
    );
    if (role !== "owner") {
      throw new HttpError(403, "Organization owner access required");
    }
    const removed = await removeOrganizationMember(
      db,
      organizationMemberMatch[1],
      decodeURIComponent(organizationMemberMatch[2]),
    );
    if (!removed) throw new HttpError(404, "Member not found");
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (pathname === "/projects" && request.method === "GET") {
    const session = await requireSession(auth, request);
    const projects = await listProjects(db, session.user.id);
    return json({ projects: projects.map(projectJson) });
  }

  if (pathname === "/projects" && request.method === "POST") {
    const session = await requireSession(auth, request);
    const input = projectInputSchema.parse(await readJson(request));
    let organizations = await listOrganizations(db, session.user.id);
    if (organizations.length === 0) {
      const organization = await createOrganization(db, {
        name: `${session.user.name || session.user.email}의 조직`,
        ownerUserId: session.user.id,
      });
      organizations = [organization];
    }
    const organization =
      organizations.find((candidate) => candidate.id === input.organizationId) ??
      (input.organizationId ? null : organizations[0]);
    if (!organization || !canManageOrganization(organization.role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const agentToken = `briar_agent_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const tokenHash = await sha256(agentToken);
    const project = await createProject(db, {
      ownerUserId: session.user.id,
      organizationId: organization.id,
      name: input.name,
      agentTokenHash: tokenHash,
    });
    project.organization_name = organization.name;
    project.member_role = organization.role;
    return json({ project: projectJson(project), agentToken }, 201);
  }

  const projectMatch = pathname.match(/^\/projects\/([0-9a-f-]+)$/u);
  if (projectMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, projectMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (project.member_role !== "owner") {
      throw new HttpError(403, "Organization owner access required");
    }
    const attachments = await listIssueAttachments(db, project.id);
    const attachmentKeys = attachments.map((attachment) => attachment.object_key);
    for (let offset = 0; offset < attachmentKeys.length; offset += 1_000) {
      await attachmentsBucket.delete(
        attachmentKeys.slice(offset, offset + 1_000),
      );
    }
    if (!(await deleteProject(db, project.id, session.user.id))) {
      throw new HttpError(404, "Project not found");
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const settingsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/settings$/u,
  );
  if (settingsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, settingsMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    return json({
      settings: settingsJson(await getProjectSettings(db, project.id)),
    });
  }
  if (settingsMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, settingsMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!canManageOrganization(project.member_role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = projectSettingsSchema.parse(await readJson(request));
    const settings = await updateProjectSettings(db, project.id, {
      velenOrg: input.velenOrg ?? null,
      dataSource: input.dataSource ?? null,
      linear: input.linear,
      githubRepository: input.githubRepository ?? null,
      workflow: input.workflow,
      automation: input.automation,
    });
    return json({ settings: settingsJson(settings) });
  }

  const agentTokenMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-token$/u,
  );
  if (agentTokenMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const agentToken = `briar_agent_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const replaced = await replaceProjectAgentToken(
      db,
      agentTokenMatch[1],
      session.user.id,
      await sha256(agentToken),
    );
    if (!replaced) throw new HttpError(404, "Project not found");
    return json({ agentToken });
  }

  const dashboardMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/dashboard$/u,
  );
  if (dashboardMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, dashboardMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const [{ runs, events }, settings, attachments] = await Promise.all([
      listDashboardRuns(db, project.id),
      getProjectSettings(db, project.id),
      listIssueAttachments(db, project.id),
    ]);
    const eventsByRun = new Map<string, HuntEventRow[]>();
    for (const event of events) {
      const runEvents = eventsByRun.get(event.run_id) ?? [];
      runEvents.push(event);
      eventsByRun.set(event.run_id, runEvents);
    }
    const attachmentsByRun = new Map<string, IssueAttachmentRow[]>();
    for (const attachment of attachments) {
      const runAttachments = attachmentsByRun.get(attachment.run_id) ?? [];
      runAttachments.push(attachment);
      attachmentsByRun.set(attachment.run_id, runAttachments);
    }
    return json({
      project: projectJson(project),
      settings: settingsJson(settings),
      runs: runs.map((run) =>
        dashboardRunJson(
          run,
          eventsByRun.get(run.id) ?? [],
          attachmentsByRun.get(run.id) ?? [],
        ),
      ),
      generatedAt: new Date().toISOString(),
    });
  }

  const attachmentMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)$/u,
  );
  if (
    attachmentMatch &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    await requireProjectAccess(auth, db, request, attachmentMatch[1]);
    const attachment = await getIssueAttachment(
      db,
      attachmentMatch[1],
      attachmentMatch[2],
      attachmentMatch[3],
    );
    if (!attachment) throw new HttpError(404, "Attachment not found");
    if (request.method === "HEAD") {
      const object = await attachmentsBucket.head(attachment.object_key);
      if (!object) throw new HttpError(404, "Attachment not found");
      return attachmentResponse(attachment, object, null);
    }
    const object = await attachmentsBucket.get(attachment.object_key);
    if (!object) throw new HttpError(404, "Attachment not found");
    return attachmentResponse(attachment, object, object.body);
  }

  const issuesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/issues$/u,
  );
  if (issuesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, issuesMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const [{ input, attachments }, settings] = await Promise.all([
      readIssueRequest(request),
      getProjectSettings(db, project.id),
    ]);
    const issueId = crypto.randomUUID();
    const sourceKey = `briar-issue:${issueId}`;
    const occurredAt = new Date().toISOString();
    const storedAttachments: Array<IssueAttachmentInput & { file: File }> =
      attachments.map((file) => {
        const id = crypto.randomUUID();
        return {
          id,
          object_key: `issue-attachments/${project.id}/${issueId}/${id}`,
          filename: file.name.normalize("NFC").trim(),
          content_type: file.type,
          byte_size: file.size,
          file,
        };
      });
    const uploadedKeys: string[] = [];
    let runId: string | null = null;
    try {
      for (const attachment of storedAttachments) {
        await attachmentsBucket.put(attachment.object_key, attachment.file.stream(), {
          httpMetadata: {
            contentType: attachment.content_type,
            contentDisposition: contentDisposition(attachment.filename),
          },
          customMetadata: { attachmentId: attachment.id, projectId: project.id },
        });
        uploadedKeys.push(attachment.object_key);
      }
      runId = await recordHuntEvent(db, project.id, {
        source: "issue",
        sourceKey,
        title: input.title,
        stage: "queued",
        status: "queued",
        workflowStage: null,
        eventKey: `${sourceKey}:queued:intake`,
        occurredAt,
        actor: "briar-app",
        repository: settings?.github_repository ?? project.name,
        detail: "Briar 앱에서 생성된 이슈가 Auto Hunt 처리를 기다리고 있습니다.",
        priority: input.priority ?? null,
        branch: null,
        commitSha: null,
        tracker: null,
        issueDescription: input.description || null,
        resultSummary: null,
        pullRequestUrls: [],
        targetSha: null,
        sourceCreatedAt: occurredAt,
        qaStatus: null,
        stagingQaDetail: null,
        productionQaDetail: null,
        context: {
          origin: "briar-app",
          issueId,
          attachmentCount: storedAttachments.length,
        },
      });
      await createIssueAttachments(
        db,
        project.id,
        runId,
        storedAttachments.map(({ file: _file, ...attachment }) => attachment),
      );
      const attachmentRows = await listIssueAttachments(db, project.id, runId);
      return json(
        {
          runId,
          sourceKey,
          stage: "queued",
          status: "queued",
          attachments: attachmentRows.map(attachmentJson),
        },
        201,
      );
    } catch (error) {
      if (runId) {
        try {
          await rollbackNewAppIssue(db, project.id, runId);
        } catch (rollbackError) {
          console.error(
            JSON.stringify({
              message: "issue creation rollback failed",
              error:
                rollbackError instanceof Error
                  ? rollbackError.message
                  : String(rollbackError),
              runId,
            }),
          );
        }
      }
      if (uploadedKeys.length > 0) {
        try {
          await attachmentsBucket.delete(uploadedKeys);
        } catch (cleanupError) {
          console.error(
            JSON.stringify({
              message: "attachment cleanup failed",
              error:
                cleanupError instanceof Error
                  ? cleanupError.message
                  : String(cleanupError),
              issueId,
            }),
          );
        }
      }
      throw error;
    }
  }

  const recoveryMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/(retry|cancel)$/u,
  );
  if (recoveryMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, recoveryMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = recoveryUserInputSchema.parse(await readJson(request));
    const result = await recoverHuntRun(db, project.id, {
      runId: recoveryMatch[2],
      action: recoveryMatch[3] as "retry" | "cancel",
      requestId: input.requestId,
      actor: `briar-app:${session.user.id}`,
      reason: input.reason ?? null,
      occurredAt: new Date().toISOString(),
    });
    if (result.outcome === "not_found") {
      throw new HttpError(404, "Run not found");
    }
    if (result.outcome === "ineligible") {
      throw new HttpError(409, "Only blocked or failed runs can be recovered");
    }
    return json({ runId: recoveryMatch[2], ...result });
  }

  const moveRunMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/status$/u,
  );
  if (moveRunMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, moveRunMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = moveRunInputSchema.parse(await readJson(request));
    try {
      const result = await moveHuntRun(db, project.id, {
        runId: moveRunMatch[2],
        status: input.status,
        workflowStage: input.workflowStage,
        requestId: input.requestId,
        actor: `briar-app:${session.user.id}`,
        occurredAt: new Date().toISOString(),
      });
      if (result.outcome === "not_found") {
        throw new HttpError(404, "Run not found");
      }
      return json({ runId: moveRunMatch[2], ...result });
    } catch (error) {
      if (error instanceof HuntTransitionError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  }

  if (pathname === "/ingest/queue/next" && request.method === "GET") {
    const projectId = await requireAgentProject(db, request);
    const run = await getNextQueuedHuntRun(db, projectId);
    const attachments = run
      ? await listIssueAttachments(db, projectId, run.id)
      : [];
    return json({
      issue: run
        ? {
            runId: run.id,
            runNumber: run.run_number,
            currentAttempt: run.current_attempt,
            source: run.source,
            sourceKey: run.source_key,
            title: run.title,
            description: run.issue_description,
            priority: run.priority,
            repository: run.repository,
            sourceCreatedAt: run.source_created_at,
            context: parseJsonObject(run.context_json),
            workflow: normalizeAutoHuntWorkflow(
              JSON.parse(run.workflow_snapshot_json),
            ),
            attachments: attachments.map(attachmentJson),
          }
        : null,
    });
  }

  if (pathname === "/ingest/queue/claim" && request.method === "POST") {
    const projectId = await requireAgentProject(db, request);
    const input = claimInputSchema.parse(await readJson(request));
    const claimedAt = new Date().toISOString();
    const leaseExpiresAt = new Date(
      Date.parse(claimedAt) + 15 * 60_000,
    ).toISOString();
    const claimToken = `briar_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const run = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: await sha256(claimToken),
      claimedBy: input.claimedBy,
      claimedAt,
      leaseExpiresAt,
    });
    const attachments = run
      ? await listIssueAttachments(db, projectId, run.id)
      : [];
    return json({
      issue: run
        ? {
            runId: run.id,
            runNumber: run.run_number,
            currentAttempt: run.current_attempt,
            source: run.source,
            sourceKey: run.source_key,
            title: run.title,
            description: run.issue_description,
            priority: run.priority,
            repository: run.repository,
            sourceCreatedAt: run.source_created_at,
            context: parseJsonObject(run.context_json),
            workflow: normalizeAutoHuntWorkflow(
              JSON.parse(run.workflow_snapshot_json),
            ),
            attachments: attachments.map(attachmentJson),
            claimToken,
            claimedBy: run.claimed_by,
            claimedAt: run.claimed_at,
            leaseExpiresAt: run.lease_expires_at,
            claimAttempts: run.claim_attempts,
          }
        : null,
    });
  }

  const agentRecoveryMatch = pathname.match(
    /^\/ingest\/runs\/([0-9a-f-]+)\/(retry|cancel)$/u,
  );
  if (agentRecoveryMatch && request.method === "POST") {
    const projectId = await requireAgentProject(db, request);
    const input = recoveryAgentInputSchema.parse(await readJson(request));
    const result = await recoverHuntRun(db, projectId, {
      runId: agentRecoveryMatch[1],
      action: agentRecoveryMatch[2] as "retry" | "cancel",
      requestId: input.requestId,
      actor: input.actor,
      reason: input.reason ?? null,
      occurredAt: new Date().toISOString(),
    });
    if (result.outcome === "not_found") {
      throw new HttpError(404, "Run not found");
    }
    if (result.outcome === "ineligible") {
      throw new HttpError(409, "Only blocked or failed runs can be recovered");
    }
    return json({ runId: agentRecoveryMatch[1], ...result });
  }

  if (pathname === "/ingest/events" && request.method === "POST") {
    const projectId = await requireAgentProject(db, request);
    const parsed = eventSchema.parse(await readJson(request));
    const status = parsed.status ?? statusForLegacyStage(parsed.stage!);
    const workflowStage =
      parsed.workflowStage === undefined
        ? workflowStageForLegacyStage(parsed.stage!)
        : parsed.workflowStage;
    const input = {
      ...parsed,
      stage: legacyStageForProgress(status, workflowStage),
      status,
      workflowStage,
      occurredAt: new Date(parsed.occurredAt).toISOString(),
      detail: parsed.detail ?? null,
      priority: parsed.priority ?? null,
      branch: parsed.branch ?? null,
      commitSha: parsed.commitSha ?? null,
      tracker: parsed.tracker
        ? {
            provider: parsed.tracker.provider,
            issueId: parsed.tracker.issueId ?? null,
            identifier: parsed.tracker.identifier ?? null,
            url: parsed.tracker.url ?? null,
            state: parsed.tracker.state ?? null,
          }
        : null,
      issueDescription: parsed.issueDescription ?? null,
      resultSummary: parsed.resultSummary ?? null,
      targetSha: parsed.targetSha ?? null,
      sourceCreatedAt: parsed.sourceCreatedAt
        ? new Date(parsed.sourceCreatedAt).toISOString()
        : null,
      qaStatus: parsed.qaStatus ?? null,
      stagingQaDetail: parsed.stagingQaDetail ?? null,
      productionQaDetail: parsed.productionQaDetail ?? null,
      context: parsed.context ?? null,
    };
    try {
      const claimToken = request.headers.get("x-briar-claim-token");
      await assertQueuedHuntClaim(
        db,
        projectId,
        input,
        claimToken?.startsWith("briar_claim_")
          ? await sha256(claimToken)
          : null,
        new Date().toISOString(),
      );
      const runId = await recordHuntEvent(db, projectId, input);
      return json({
        runId,
        status: input.status,
        workflowStage: input.workflowStage,
        stage: input.stage,
      });
    } catch (error) {
      if (error instanceof EventKeyConflictError) {
        throw new HttpError(409, error.message);
      }
      if (error instanceof HuntTransitionError) {
        throw new HttpError(409, error.message);
      }
      if (error instanceof HuntClaimError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  }

  if (pathname === "/ingest/qa-results" && request.method === "POST") {
    const projectId = await requireAgentProject(db, request);
    const input = qaResultSchema.parse(await readJson(request));
    const outcome = await recordQaResult(db, projectId, {
      ...input,
      detail: input.detail ?? null,
      observedAt: new Date(input.observedAt).toISOString(),
    });
    if (outcome === "not_found") throw new HttpError(404, "Run not found");
    if (outcome === "ineligible") {
      throw new HttpError(409, "QA result is ineligible");
    }
    const run = await getHuntRunForProject(db, projectId, input.runId);
    return json({
      runId: input.runId,
      outcome,
      issueIdentifier: run?.tracker_issue_identifier ?? null,
      issueUrl: run?.tracker_issue_url ?? null,
      pullRequestUrls: run ? parseJsonArray(run.pull_request_urls) : [],
      targetSha: run?.target_sha ?? null,
    });
  }

  throw new HttpError(404, "Not found");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "briar-api",
        database: "cloudflare-d1",
        updates: "cloudflare-r2",
      });
    }
    const releaseResponse = await serveRelease(request, env.RELEASES);
    if (releaseResponse) return releaseResponse;
    if (url.pathname === "/brand/briar-icon.svg" && request.method === "GET") {
      return svgResponse(briarIconSvg);
    }
    if (url.pathname === "/brand/briar-mark.svg" && request.method === "GET") {
      return svgResponse(briarMarkSvg);
    }
    if (url.pathname === "/device" && request.method === "GET") {
      return devicePage(url.origin, url.searchParams.get("client") === "android");
    }

    try {
      const auth = createAuth(env, url.origin);
      return await route(request, auth, env.DB, env.ATTACHMENTS);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ message: error.message }, error.status);
      }
      if (error instanceof z.ZodError) {
        return json({ message: "Invalid request", issues: error.issues }, 400);
      }
      console.error(
        JSON.stringify({
          message: "request failed",
          error: error instanceof Error ? error.message : String(error),
          method: request.method,
          path: url.pathname,
        }),
      );
      return json({ message: "Internal server error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
