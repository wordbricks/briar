import {
  type Locale,
  type RoutePath,
  copy,
  localizedHrefs,
  localizedPath,
} from "../i18n";
import { Arrow, SiteFooter, SiteHeader } from "../site-chrome";

export const docsPaths = {
  overview: "/docs",
  getStarted: "/docs/get-started",
  webhooks: "/docs/webhooks",
} as const satisfies Record<string, RoutePath>;

export type DocsPage = keyof typeof docsPaths;

const docsCopyByLocale = {
  ko: {
    common: {
      label: "API 문서",
      navLabel: "API 문서 탐색",
      overview: "개요",
      getStarted: "시작하기",
      webhooks: "수신 웹훅",
      openApp: "Briar 열기",
      home: "홈",
      tutorial: "튜토리얼",
      changelog: "변경 기록",
      backTop: "맨 위로 ↑",
      previous: "이전",
      next: "다음",
      onThisPage: "이 페이지에서",
    },
    overview: {
      metadata: {
        title: "Briar API 문서 — 공개 API 시작하기",
        description:
          "Briar 공개 API의 범위와 기본 연동 흐름을 확인하고 채널 수신 웹훅 문서로 이동하세요.",
      },
      eyebrow: "PUBLIC API",
      title: "외부 이벤트를\nBriar로 연결하세요.",
      description:
        "공개 API 문서는 외부 서비스의 배포, 모니터링, 운영 이벤트를 Briar 채널 메시지로 안전하게 전달하는 방법을 설명합니다.",
      chooseTitle: "필요한 문서부터 시작하세요",
      cards: [
        {
          path: "/docs/get-started",
          index: "01",
          title: "시작하기",
          description:
            "비밀 URL을 준비하고 첫 JSON 요청을 보내기까지의 기본 연동 절차를 확인합니다.",
          action: "기본 연동 보기",
        },
        {
          path: "/docs/webhooks",
          index: "02",
          title: "수신 웹훅",
          description:
            "웹훅 수명 주기, 요청 스키마, 중복 방지, 제한, 오류와 curl 예제를 자세히 확인합니다.",
          action: "웹훅 레퍼런스 보기",
        },
      ],
      scopeTitle: "현재 공개 범위",
      scopeBody:
        "현재 공개 API는 채널 수신 웹훅에 초점을 둡니다. Briar 앱이 사용하는 로그인 기반 관리 API는 공개 연동 계약에 포함되지 않습니다.",
      flowTitle: "문서는 이렇게 사용하세요",
      flow: [
        {
          title: "연동 준비",
          description:
            "Briar 채널에서 웹훅을 만들고 한 번만 표시되는 비밀 URL을 안전하게 보관합니다.",
        },
        {
          title: "요청 구현",
          description:
            "JSON 형식과 크기 제한을 지키고 논리적 이벤트마다 안정적인 중복 방지 키를 정합니다.",
        },
        {
          title: "운영",
          description:
            "성공·중복·오류 응답을 구분하고 노출이나 담당 변경 시 URL을 회전하거나 폐기합니다.",
        },
      ],
    },
    getStarted: {
      metadata: {
        title: "Briar API 시작하기 — 첫 채널 웹훅 연동",
        description:
          "Briar 채널 수신 웹훅을 만들고 비밀 URL을 보관한 뒤 올바른 JSON 요청을 전송하는 기본 절차를 알아보세요.",
      },
      eyebrow: "GET STARTED",
      title: "첫 이벤트를 보내기까지",
      description:
        "채널에서 비밀 URL을 발급하고 외부 서비스가 JSON 메시지를 보내도록 구성하는 가장 짧은 경로입니다.",
      contents: [
        ["prepare", "1. 웹훅 준비"],
        ["request", "2. 요청 구성"],
        ["checklist", "3. 공통 유의사항"],
      ],
      prepareTitle: "1. 웹훅 준비",
      prepareSteps: [
        {
          title: "대상 채널 열기",
          description:
            "Briar의 대상 채널에서 수신 웹훅 관리 화면을 엽니다. 조직 소유자·관리자 또는 채널 소유자가 관리할 수 있습니다.",
        },
        {
          title: "이름 정하고 만들기",
          description:
            "메시지 작성자를 알아볼 수 있도록 ‘배포 알림’처럼 출처가 분명한 이름을 사용하세요.",
        },
        {
          title: "비밀 URL 즉시 보관",
          description:
            "생성된 전체 URL은 그 순간에만 표시됩니다. 비밀 관리 도구에 저장하고 코드, 이슈, 채팅이나 로그에 남기지 마세요.",
        },
      ],
      requestTitle: "2. 요청 구성",
      requestDescription:
        "발급된 URL로 POST 요청을 보냅니다. 별도 Authorization 헤더는 없으며 URL 전체가 인증 정보입니다.",
      requestLabels: {
        method: "메서드",
        endpoint: "엔드포인트",
        contentType: "Content-Type",
        body: "최소 본문",
      },
      endpoint: "https://briar-api.wbai.workers.dev/hooks/channels/{webhook_id}/{secret}",
      minimumBody: '{"text":"Production deployment completed."}',
      checklistTitle: "3. 공통 유의사항",
      checklist: [
        {
          title: "URL을 자격 증명처럼 취급",
          description:
            "URL을 아는 사람은 채널에 메시지를 보낼 수 있습니다. 노출이 의심되면 즉시 회전하세요.",
        },
        {
          title: "재시도 키를 먼저 설계",
          description:
            "한 이벤트를 다시 보낼 수 있다면 Idempotency-Key를 사용하고, 같은 논리적 이벤트의 모든 재시도에 같은 값을 유지하세요.",
        },
        {
          title: "두 성공 상태를 모두 처리",
          description:
            "새 메시지는 201, 이미 받은 이벤트는 200과 duplicate: true를 반환합니다. 둘 다 성공으로 처리하세요.",
        },
        {
          title: "제한 안에서 전송",
          description:
            "요청 본문은 64KiB 이하이며 text는 1~10,000자, blocks는 최대 50개입니다. 웹훅 하나당 60초에 최대 60회까지 요청할 수 있습니다.",
        },
      ],
      nextTitle: "요청과 응답 계약이 필요하신가요?",
      nextDescription:
        "수신 웹훅 레퍼런스에서 전체 JSON 스키마, 실행 가능한 curl, 오류별 복구 방법을 확인하세요.",
      nextAction: "수신 웹훅 보기",
    },
    webhooks: {
      metadata: {
        title: "Briar 수신 웹훅 API — 요청, 중복 방지와 오류",
        description:
          "Briar 채널 수신 웹훅의 생성·보관·회전·폐기, JSON 스키마, Idempotency-Key, 제한, 응답과 curl 예제를 확인하세요.",
      },
      eyebrow: "WEBHOOK REFERENCE",
      title: "채널 수신 웹훅",
      description:
        "외부 시스템의 이벤트를 채널의 웹훅 작성자 메시지로 전달합니다. 비밀 URL의 수명 주기부터 재시도와 오류 복구까지 한 계약으로 운영하세요.",
      contents: [
        ["lifecycle", "수명 주기"],
        ["endpoint", "엔드포인트"],
        ["schema", "JSON 스키마"],
        ["example", "curl 예제"],
        ["idempotency", "중복 방지"],
        ["limits", "제한 조건"],
        ["errors", "오류와 복구"],
      ],
      lifecycleTitle: "수명 주기",
      lifecycle: [
        {
          label: "CREATE",
          title: "생성",
          description:
            "대상 채널의 수신 웹훅 화면에서 출처를 식별할 이름을 입력합니다. 조직 소유자·관리자 또는 채널 소유자만 관리할 수 있고, 보관된 채널에는 새 웹훅을 만들 수 없습니다.",
        },
        {
          label: "STORE",
          title: "보관",
          description:
            "전체 비밀 URL은 생성 또는 회전 직후 한 번만 표시됩니다. 비밀 관리 도구에 저장하고 최소한의 발신 시스템에만 전달하세요.",
        },
        {
          label: "ROTATE",
          title: "회전",
          description:
            "URL이 노출됐거나 담당 시스템이 바뀌면 회전합니다. 기존 URL은 즉시 404로 바뀌므로 새 URL을 발신 시스템에 바로 적용하고 시험 요청을 보내세요.",
        },
        {
          label: "REVOKE",
          title: "폐기",
          description:
            "더 이상 사용하지 않으면 폐기합니다. 폐기는 즉시 적용되고 되돌릴 수 없으므로 다시 필요하면 새 웹훅을 만드세요.",
        },
      ],
      endpointTitle: "엔드포인트",
      endpointDescription:
        "생성 화면에서 받은 정확한 URL을 사용하세요. webhook_id와 secret을 따로 조합하거나 Authorization 헤더를 추가할 필요가 없습니다.",
      endpoint: "POST https://briar-api.wbai.workers.dev/hooks/channels/{webhook_id}/{secret}",
      secretWarningTitle: "비밀 URL",
      secretWarningBody:
        "이 URL 전체가 인증 수단입니다. 저장소, 지원 티켓, 채팅, 분석 도구와 요청 로그에 노출하지 마세요. Briar는 잘못됐거나 회전·폐기된 URL에 같은 404 응답을 보내 유효한 웹훅 정보를 드러내지 않습니다.",
      schemaTitle: "JSON 스키마",
      schemaDescription:
        "본문은 application/json이어야 하며 text 또는 blocks 중 하나 이상이 필요합니다. 아래 필드 외의 값은 허용되지 않습니다.",
      schemaHeaders: ["필드", "형식", "필수", "제약"],
      schemaRows: [
        ["text", "string", "조건부", "공백 제거 후 1~10,000자. blocks가 없으면 필수이며, 함께 보내면 접근성·알림 fallback으로 사용"],
        [
          "blocks",
          "array",
          "조건부",
          "1~50개. header, section, markdown, divider, context, rich_text 지원. text가 없으면 표시 가능한 텍스트가 포함되어야 함",
        ],
        [
          "eventId",
          "string",
          "선택",
          "공백 제거 후 1~200자. Idempotency-Key와 함께 보내면 값이 정확히 같아야 함",
        ],
      ],
      schemaCaption: "채널 수신 웹훅 JSON 필드",
      headerTitle: "선택 헤더",
      headerDescription:
        "Idempotency-Key 헤더도 공백 제거 후 1~200자입니다. eventId 대신 사용할 수 있으며 두 값을 함께 보낼 때는 반드시 같아야 합니다.",
      exampleTitle: "실행 가능한 curl 예제",
      exampleIntro:
        "첫 줄의 예시 URL 전체를 Briar가 한 번 표시한 실제 비밀 URL로 바꾼 뒤 실행하세요.",
      curl: [
        "export BRIAR_WEBHOOK_URL='https://briar-api.wbai.workers.dev/hooks/channels/{webhook_id}/{secret}'",
        "",
        "curl --fail-with-body \\",
        "  --request POST \\",
        "  --url \"$BRIAR_WEBHOOK_URL\" \\",
        "  --header 'Content-Type: application/json' \\",
        "  --header 'Idempotency-Key: deploy-2026-08-12-001' \\",
        "  --data '{",
        "    \"text\": \"Production deployment completed.\",",
        "    \"blocks\": [",
        "      {\"type\":\"header\",\"text\":{\"type\":\"plain_text\",\"text\":\"배포 완료\"}},",
        "      {\"type\":\"section\",\"text\":{\"type\":\"mrkdwn\",\"text\":\"*production*에 `v42`가 배포되었습니다.\"}},",
        "      {\"type\":\"divider\"},",
        "      {\"type\":\"markdown\",\"text\":\"- [x] Health checks\\n- [ ] Monitor metrics\"}",
        "    ]",
        "  }'",
      ].join("\n"),
      responseTitle: "새 메시지 응답 · 201 Created",
      response: [
        "{",
        "  \"message\": {",
        "    \"id\": \"…\",",
        "    \"body\": \"Production deployment completed.\",",
        "    \"blocks\": [",
        "      { \"type\": \"header\", \"text\": { \"type\": \"plain_text\", \"text\": \"배포 완료\" } },",
        "      { \"type\": \"section\", \"text\": { \"type\": \"mrkdwn\", \"text\": \"*production*에 `v42`가 배포되었습니다.\" } },",
        "      { \"type\": \"divider\" },",
        "      { \"type\": \"markdown\", \"text\": \"- [x] Health checks\\n- [ ] Monitor metrics\" }",
        "    ],",
        "    \"author\": {",
        "      \"type\": \"webhook\",",
        "      \"id\": \"…\",",
        "      \"name\": \"Deploy alerts\"",
        "    }",
        "  },",
        "  \"duplicate\": false",
        "}",
      ].join("\n"),
      idempotencyTitle: "중복 방지와 안전한 재시도",
      idempotency: [
        "배포 ID, 모니터링 이벤트 ID처럼 발신 시스템에서 안정적으로 유지되는 값을 키로 사용하세요.",
        "같은 웹훅과 같은 키로 다시 요청하면 새 메시지를 만들지 않고 최초 메시지를 200 OK와 duplicate: true로 반환합니다.",
        "중복 요청의 text나 blocks가 달라도 최초 메시지는 바뀌지 않습니다. 같은 논리적 이벤트에는 같은 내용과 같은 키를 보내세요.",
        "키를 생략하면 모든 요청이 새 메시지를 만듭니다. 네트워크 재시도가 가능한 연동에서는 키 사용을 권장합니다.",
      ],
      limitsTitle: "제한 조건",
      limits: [
        ["요청 방식", "POST만 지원"],
        ["본문 형식", "application/json"],
        ["본문 크기", "최대 65,536바이트(64KiB)"],
        ["메시지 내용", "text 1~10,000자, blocks 1~50개, markdown 블록 합계 최대 12,000자"],
        ["중복 방지 키", "eventId 또는 Idempotency-Key 1~200자"],
        ["요청 빈도", "웹훅별 60초에 최대 60회"],
      ],
      rateNote:
        "비밀 URL과 Content-Type 검사를 통과한 요청은 JSON이나 필드 검증에 실패하더라도 요청 빈도에 포함됩니다.",
      errorsTitle: "오류와 복구",
      errorHeaders: ["상태", "의미", "복구 방법"],
      errorRows: [
        [
          "400",
          "JSON이 잘못됐거나 필드·중복 방지 키가 계약과 다름",
          "본문을 유효한 JSON으로 만들고 허용 필드, 길이, 두 키의 일치 여부를 확인",
        ],
        [
          "404",
          "URL이 잘못됐거나 웹훅이 회전·폐기됨",
          "저장된 URL을 확인하고 필요하면 채널에서 새 웹훅을 생성",
        ],
        [
          "409",
          "대상 채널이 보관됨",
          "채널 보관을 해제하거나 활성 채널에 새 웹훅을 생성",
        ],
        [
          "413",
          "본문이 65,536바이트를 초과함",
          "메시지를 요약해 더 작은 요청으로 다시 전송",
        ],
        [
          "415",
          "Content-Type이 application/json이 아님",
          "Content-Type: application/json 헤더를 설정",
        ],
        [
          "429",
          "웹훅의 60초당 60회 제한을 초과함",
          "전송 속도를 낮추고 같은 Idempotency-Key로 나중에 재시도",
        ],
        [
          "500",
          "Briar가 메시지를 저장하지 못함",
          "같은 Idempotency-Key로 지수 백오프 후 재시도",
        ],
      ],
      errorCaption: "채널 수신 웹훅 오류 상태와 복구 방법",
      finalTitle: "운영 체크리스트",
      finalChecklist: [
        "비밀 URL은 한 번 표시될 때 안전한 저장소에 복사했습니다.",
        "논리적 이벤트 ID를 재시도 전반에 동일하게 유지합니다.",
        "201과 중복 200을 성공으로, 4xx와 5xx를 서로 다른 복구 정책으로 처리합니다.",
        "노출 시 회전하고 사용 종료 시 폐기할 담당자와 절차가 있습니다.",
      ],
    },
  },
  en: {
    common: {
      label: "API docs",
      navLabel: "API documentation",
      overview: "Overview",
      getStarted: "Get started",
      webhooks: "Incoming webhooks",
      openApp: "Open Briar",
      home: "Home",
      tutorial: "Tutorial",
      changelog: "Changelog",
      backTop: "Back to top ↑",
      previous: "Previous",
      next: "Next",
      onThisPage: "On this page",
    },
    overview: {
      metadata: {
        title: "Briar API docs — Get started with the public API",
        description:
          "Explore the Briar public API, learn the integration flow, and open the channel incoming webhook reference.",
      },
      eyebrow: "PUBLIC API",
      title: "Bring external events\ninto Briar.",
      description:
        "The public API docs explain how to deliver deployment, monitoring, and operational events from external services into a Briar channel.",
      chooseTitle: "Start with the guide you need",
      cards: [
        {
          path: "/docs/get-started",
          index: "01",
          title: "Get started",
          description:
            "Follow the basic integration flow from creating a secret URL to sending your first JSON request.",
          action: "View the integration guide",
        },
        {
          path: "/docs/webhooks",
          index: "02",
          title: "Incoming webhooks",
          description:
            "Reference the webhook lifecycle, request schema, idempotency, limits, errors, and runnable curl example.",
          action: "View the webhook reference",
        },
      ],
      scopeTitle: "Current public scope",
      scopeBody:
        "The public API currently focuses on incoming channel webhooks. The authenticated management API used by the Briar app is not part of the public integration contract.",
      flowTitle: "How to use these docs",
      flow: [
        {
          title: "Prepare",
          description:
            "Create a webhook in a Briar channel and store the one-time secret URL safely.",
        },
        {
          title: "Implement",
          description:
            "Keep requests inside the JSON and size limits, then choose a stable idempotency key for each logical event.",
        },
        {
          title: "Operate",
          description:
            "Distinguish new, duplicate, and error responses, then rotate or revoke URLs as ownership and exposure change.",
        },
      ],
    },
    getStarted: {
      metadata: {
        title: "Get started with the Briar API — Your first channel webhook",
        description:
          "Create a Briar incoming channel webhook, store its secret URL, and send a correctly formatted JSON request.",
      },
      eyebrow: "GET STARTED",
      title: "Send your first event",
      description:
        "The shortest path from issuing a secret URL in a channel to configuring an external service to send a JSON message.",
      contents: [
        ["prepare", "1. Prepare a webhook"],
        ["request", "2. Build the request"],
        ["checklist", "3. Common considerations"],
      ],
      prepareTitle: "1. Prepare a webhook",
      prepareSteps: [
        {
          title: "Open the destination channel",
          description:
            "Open Incoming webhooks in the destination Briar channel. Organization owners and admins, plus the channel owner, can manage them.",
        },
        {
          title: "Name and create it",
          description:
            "Use a source-specific name such as “Deployment alerts” so the message author is recognizable in the channel.",
        },
        {
          title: "Store the secret URL immediately",
          description:
            "The full URL is shown only at that moment. Save it in a secret manager, never in source, issues, chat, or logs.",
        },
      ],
      requestTitle: "2. Build the request",
      requestDescription:
        "Send a POST request to the issued URL. There is no separate Authorization header; the full URL is the credential.",
      requestLabels: {
        method: "Method",
        endpoint: "Endpoint",
        contentType: "Content-Type",
        body: "Minimum body",
      },
      endpoint: "https://briar-api.wbai.workers.dev/hooks/channels/{webhook_id}/{secret}",
      minimumBody: '{"text":"Production deployment completed."}',
      checklistTitle: "3. Common considerations",
      checklist: [
        {
          title: "Treat the URL as a credential",
          description:
            "Anyone with the URL can post to the channel. Rotate it immediately if exposure is suspected.",
        },
        {
          title: "Design retry keys first",
          description:
            "If an event can be retried, send Idempotency-Key and keep the same value for every attempt of the same logical event.",
        },
        {
          title: "Handle both success states",
          description:
            "A new message returns 201. An event already received returns 200 with duplicate: true. Treat both as success.",
        },
        {
          title: "Stay within the limits",
          description:
            "The body is at most 64KiB, text is 1–10,000 characters, blocks contains at most 50 items, and each webhook accepts up to 60 requests per 60 seconds.",
        },
      ],
      nextTitle: "Need the full request and response contract?",
      nextDescription:
        "Open the incoming webhook reference for the complete JSON schema, runnable curl, and recovery guidance for every error.",
      nextAction: "View incoming webhooks",
    },
    webhooks: {
      metadata: {
        title: "Briar incoming webhook API — Requests, idempotency, and errors",
        description:
          "Learn how to create, store, rotate, and revoke Briar channel webhooks, with the JSON schema, Idempotency-Key, limits, responses, and curl.",
      },
      eyebrow: "WEBHOOK REFERENCE",
      title: "Incoming channel webhooks",
      description:
        "Deliver external system events as webhook-authored messages in a channel. Operate the secret URL lifecycle, retries, and error recovery as one contract.",
      contents: [
        ["lifecycle", "Lifecycle"],
        ["endpoint", "Endpoint"],
        ["schema", "JSON schema"],
        ["example", "curl example"],
        ["idempotency", "Idempotency"],
        ["limits", "Limits"],
        ["errors", "Errors and recovery"],
      ],
      lifecycleTitle: "Lifecycle",
      lifecycle: [
        {
          label: "CREATE",
          title: "Create",
          description:
            "In Incoming webhooks for the destination channel, enter a source-specific name. Organization owners and admins, plus the channel owner, can manage webhooks. Archived channels cannot create them.",
        },
        {
          label: "STORE",
          title: "Store",
          description:
            "The complete secret URL is shown once after creation or rotation. Store it in a secret manager and disclose it only to the sending system.",
        },
        {
          label: "ROTATE",
          title: "Rotate",
          description:
            "Rotate after exposure or a sender ownership change. The old URL returns 404 immediately, so update the sender with the new URL and send a test request right away.",
        },
        {
          label: "REVOKE",
          title: "Revoke",
          description:
            "Revoke a webhook when it is no longer used. Revocation is immediate and irreversible; create a new webhook if the integration is needed again.",
        },
      ],
      endpointTitle: "Endpoint",
      endpointDescription:
        "Use the exact URL shown after creation. You do not need to assemble webhook_id and secret yourself or add an Authorization header.",
      endpoint: "POST https://briar-api.wbai.workers.dev/hooks/channels/{webhook_id}/{secret}",
      secretWarningTitle: "Secret URL",
      secretWarningBody:
        "The complete URL is the credential. Keep it out of repositories, support tickets, chat, analytics, and request logs. Briar returns the same 404 for invalid, rotated, and revoked URLs so it does not disclose valid webhook details.",
      schemaTitle: "JSON schema",
      schemaDescription:
        "The body must be application/json and include at least one of text or blocks. No properties beyond those below are accepted.",
      schemaHeaders: ["Field", "Type", "Required", "Constraints"],
      schemaRows: [
        ["text", "string", "Conditional", "1–10,000 characters after trimming. Required without blocks; used as the accessibility and notification fallback when both are sent"],
        [
          "blocks",
          "array",
          "Conditional",
          "1–50 blocks. Supports header, section, markdown, divider, context, and rich_text. Must contain visible text when text is omitted",
        ],
        [
          "eventId",
          "string",
          "No",
          "1–200 characters after trimming; must exactly match Idempotency-Key when both are sent",
        ],
      ],
      schemaCaption: "Incoming channel webhook JSON fields",
      headerTitle: "Optional header",
      headerDescription:
        "Idempotency-Key is also 1–200 characters after trimming. Use it instead of eventId, or send both with exactly the same value.",
      exampleTitle: "Runnable curl example",
      exampleIntro:
        "Replace the entire example URL on the first line with the one-time secret URL from Briar, then run the command.",
      curl: [
        "export BRIAR_WEBHOOK_URL='https://briar-api.wbai.workers.dev/hooks/channels/{webhook_id}/{secret}'",
        "",
        "curl --fail-with-body \\",
        "  --request POST \\",
        "  --url \"$BRIAR_WEBHOOK_URL\" \\",
        "  --header 'Content-Type: application/json' \\",
        "  --header 'Idempotency-Key: deploy-2026-08-12-001' \\",
        "  --data '{",
        "    \"text\": \"Production deployment completed.\",",
        "    \"blocks\": [",
        "      {\"type\":\"header\",\"text\":{\"type\":\"plain_text\",\"text\":\"Deployment complete\"}},",
        "      {\"type\":\"section\",\"text\":{\"type\":\"mrkdwn\",\"text\":\"`v42` is live in *production*.\"}},",
        "      {\"type\":\"divider\"},",
        "      {\"type\":\"markdown\",\"text\":\"- [x] Health checks\\n- [ ] Monitor metrics\"}",
        "    ]",
        "  }'",
      ].join("\n"),
      responseTitle: "New message response · 201 Created",
      response: [
        "{",
        "  \"message\": {",
        "    \"id\": \"…\",",
        "    \"body\": \"Production deployment completed.\",",
        "    \"blocks\": [",
        "      { \"type\": \"header\", \"text\": { \"type\": \"plain_text\", \"text\": \"Deployment complete\" } },",
        "      { \"type\": \"section\", \"text\": { \"type\": \"mrkdwn\", \"text\": \"`v42` is live in *production*.\" } },",
        "      { \"type\": \"divider\" },",
        "      { \"type\": \"markdown\", \"text\": \"- [x] Health checks\\n- [ ] Monitor metrics\" }",
        "    ],",
        "    \"author\": {",
        "      \"type\": \"webhook\",",
        "      \"id\": \"…\",",
        "      \"name\": \"Deploy alerts\"",
        "    }",
        "  },",
        "  \"duplicate\": false",
        "}",
      ].join("\n"),
      idempotencyTitle: "Idempotency and safe retries",
      idempotency: [
        "Use a value that remains stable in the sending system, such as a deployment ID or monitoring event ID.",
        "Repeating the same key on the same webhook does not create another message. Briar returns the original message with 200 OK and duplicate: true.",
        "If duplicate requests contain different text or blocks, the first message stays unchanged. Send the same content and key for every attempt of one logical event.",
        "Without a key, every request creates a message. Use a key for integrations that can retry after a network failure.",
      ],
      limitsTitle: "Limits",
      limits: [
        ["Request method", "POST only"],
        ["Body format", "application/json"],
        ["Body size", "65,536 bytes (64KiB) maximum"],
        ["Message content", "text: 1–10,000 characters; blocks: 1–50; markdown blocks: 12,000 characters total"],
        ["Idempotency key", "eventId or Idempotency-Key: 1–200 characters"],
        ["Request rate", "Up to 60 requests per webhook per 60 seconds"],
      ],
      rateNote:
        "After the secret URL and Content-Type checks pass, a request counts toward the rate limit even when its JSON or fields are invalid.",
      errorsTitle: "Errors and recovery",
      errorHeaders: ["Status", "Meaning", "Recovery"],
      errorRows: [
        [
          "400",
          "Invalid JSON, fields, or mismatched idempotency values",
          "Send valid JSON and check allowed fields, lengths, and equality of the two keys",
        ],
        [
          "404",
          "Invalid URL, or the webhook was rotated or revoked",
          "Check the stored URL or create a new webhook in the channel",
        ],
        [
          "409",
          "The destination channel is archived",
          "Unarchive the channel or create a webhook in an active channel",
        ],
        [
          "413",
          "The body exceeds 65,536 bytes",
          "Summarize the event and retry with a smaller message",
        ],
        [
          "415",
          "Content-Type is not application/json",
          "Set the Content-Type: application/json header",
        ],
        [
          "429",
          "The webhook exceeded 60 requests in 60 seconds",
          "Reduce the rate and retry later with the same Idempotency-Key",
        ],
        [
          "500",
          "Briar could not store the message",
          "Retry with exponential backoff and the same Idempotency-Key",
        ],
      ],
      errorCaption: "Incoming channel webhook errors and recovery",
      finalTitle: "Operations checklist",
      finalChecklist: [
        "The one-time secret URL is stored in a secure secret manager.",
        "The same logical event ID remains stable across retries.",
        "201 and duplicate 200 are success; 4xx and 5xx use distinct recovery policies.",
        "There is an owner and procedure for rotating exposed URLs and revoking retired integrations.",
      ],
    },
  },
} as const;

export const docsCopy = {
  ...docsCopyByLocale,
  zh: {
    ...docsCopyByLocale.en,
    common: {
      ...docsCopyByLocale.en.common,
      label: "API 文档",
      navLabel: "API 文档导航",
      overview: "概览",
      getStarted: "开始使用",
      webhooks: "接收 Webhook",
      openApp: "打开 Briar",
      home: "首页",
      tutorial: "教程",
      changelog: "更新日志",
      backTop: "返回顶部 ↑",
      previous: "上一页",
      next: "下一页",
      onThisPage: "本页内容",
    },
    overview: {
      ...docsCopyByLocale.en.overview,
      metadata: {
        title: "Briar API 文档 — 开始使用公开 API",
        description:
          "了解 Briar 公开 API 的范围和集成流程，然后查看频道接收 Webhook 参考。",
      },
      eyebrow: "PUBLIC API",
      title: "将外部事件\n接入 Briar。",
      description:
        "公开 API 文档介绍如何将外部服务的部署、监控和运营事件安全地发送到 Briar 频道。",
      chooseTitle: "从需要的指南开始",
      cards: [
        {
          path: "/docs/get-started",
          index: "01",
          title: "开始使用",
          description: "从创建秘密 URL 到发送第一个 JSON 请求，了解基本集成流程。",
          action: "查看集成指南",
        },
        {
          path: "/docs/webhooks",
          index: "02",
          title: "接收 Webhook",
          description: "查看 Webhook 生命周期、请求模式、幂等性、限制、错误和可运行的 curl 示例。",
          action: "查看 Webhook 参考",
        },
      ],
      scopeTitle: "当前公开范围",
      scopeBody:
        "目前公开 API 专注于频道接收 Webhook。Briar 应用使用的登录管理 API 不属于公开集成契约。",
      flowTitle: "如何使用这些文档",
      flow: [
        {
          title: "准备",
          description: "在 Briar 频道中创建 Webhook，并安全保存只显示一次的秘密 URL。",
        },
        {
          title: "实现",
          description: "遵守 JSON 和大小限制，为每个逻辑事件选择稳定的幂等键。",
        },
        {
          title: "运营",
          description: "区分新消息、重复消息和错误响应，并在归属或暴露情况变化时轮换或撤销 URL。",
        },
      ],
    },
    getStarted: {
      ...docsCopyByLocale.en.getStarted,
      metadata: {
        title: "开始使用 Briar API — 第一个频道 Webhook",
        description:
          "创建 Briar 频道接收 Webhook，保存秘密 URL，然后发送格式正确的 JSON 请求。",
      },
      eyebrow: "GET STARTED",
      title: "发送你的第一个事件",
      description:
        "从在频道中生成秘密 URL，到配置外部服务发送 JSON 消息的最短路径。",
      contents: [
        ["prepare", "1. 准备 Webhook"],
        ["request", "2. 构造请求"],
        ["checklist", "3. 常见注意事项"],
      ],
      prepareTitle: "1. 准备 Webhook",
      requestTitle: "2. 构造请求",
      requestDescription:
        "向生成的 URL 发送 POST 请求。不需要额外的 Authorization 标头，完整 URL 就是凭证。",
      requestLabels: {
        method: "方法",
        endpoint: "端点",
        contentType: "Content-Type",
        body: "最小请求体",
      },
      checklistTitle: "3. 常见注意事项",
      nextTitle: "需要请求和响应契约吗？",
      nextDescription:
        "在接收 Webhook 参考中查看完整 JSON 模式、可执行 curl 和按错误恢复的方法。",
      nextAction: "查看接收 Webhook",
    },
    webhooks: {
      ...docsCopyByLocale.en.webhooks,
      metadata: {
        title: "Briar 接收 Webhook API — 请求、幂等性与错误",
        description:
          "查看 Briar 频道接收 Webhook 的创建、保存、轮换和撤销，JSON 模式、幂等键、限制、响应与 curl 示例。",
      },
      eyebrow: "WEBHOOK REFERENCE",
      title: "频道接收 Webhook",
      description:
        "将外部系统事件传递为频道中的 Webhook 作者消息，从秘密 URL 生命周期到重试和错误恢复，用一份契约运营。",
      contents: [
        ["lifecycle", "生命周期"],
        ["endpoint", "端点"],
        ["schema", "JSON 模式"],
        ["example", "curl 示例"],
        ["idempotency", "幂等性"],
        ["limits", "限制"],
        ["errors", "错误与恢复"],
      ],
      lifecycleTitle: "生命周期",
      endpointTitle: "端点",
      secretWarningTitle: "秘密 URL",
      schemaTitle: "JSON 模式",
      headerTitle: "可选标头",
      exampleTitle: "可执行的 curl 示例",
      responseTitle: "新消息响应 · 201 Created",
      idempotencyTitle: "幂等性与安全重试",
      limitsTitle: "限制",
      errorsTitle: "错误与恢复",
      finalTitle: "运营检查清单",
    },
  },
} as const satisfies Record<Locale, unknown>;

function DocsNavigation({
  locale,
  page,
}: {
  locale: Locale;
  page: DocsPage;
}) {
  const common = docsCopy[locale].common;
  const links = [
    { key: "overview", label: common.overview },
    { key: "getStarted", label: common.getStarted },
    { key: "webhooks", label: common.webhooks },
  ] as const;

  return (
    <aside className="docs-sidebar">
      <strong>{common.label}</strong>
      <nav aria-label={common.navLabel}>
        {links.map((link) => (
          <a
            aria-current={page === link.key ? "page" : undefined}
            href={localizedPath(locale, docsPaths[link.key])}
            key={link.key}
          >
            {link.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}

function PageContents({
  items,
  label,
}: {
  items: ReadonlyArray<readonly [string, string]>;
  label: string;
}) {
  return (
    <nav className="docs-on-this-page" aria-label={label}>
      <strong>{label}</strong>
      <ol>
        {items.map(([id, text]) => (
          <li key={id}>
            <a href={"#" + id}>{text}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="docs-code">
      <code>{children}</code>
    </pre>
  );
}

function DocsPager({
  locale,
  next,
  previous,
}: {
  locale: Locale;
  next?: { label: string; path: RoutePath };
  previous?: { label: string; path: RoutePath };
}) {
  const common = docsCopy[locale].common;
  return (
    <nav className="docs-pager" aria-label={common.navLabel}>
      {previous ? (
        <a href={localizedPath(locale, previous.path)}>
          <span>{common.previous}</span>
          <strong>← {previous.label}</strong>
        </a>
      ) : <span />}
      {next ? (
        <a className="docs-pager-next" href={localizedPath(locale, next.path)}>
          <span>{common.next}</span>
          <strong>{next.label} →</strong>
        </a>
      ) : null}
    </nav>
  );
}

function Overview({ locale }: { locale: Locale }) {
  const d = docsCopy[locale].overview;
  const common = docsCopy[locale].common;
  return (
    <>
      <header className="docs-hero">
        <span>{d.eyebrow}</span>
        <h1>
          {d.title.split("\n").map((line) => <span key={line}>{line}</span>)}
        </h1>
        <p>{d.description}</p>
      </header>

      <section className="docs-section" aria-labelledby="docs-choose">
        <h2 id="docs-choose">{d.chooseTitle}</h2>
        <div className="docs-card-grid">
          {d.cards.map((card) => (
            <a
              className="docs-card"
              href={localizedPath(locale, card.path)}
              key={card.path}
            >
              <span>{card.index}</span>
              <h3>{card.title}</h3>
              <p>{card.description}</p>
              <strong>{card.action} <Arrow /></strong>
            </a>
          ))}
        </div>
      </section>

      <aside className="docs-callout" aria-labelledby="docs-scope">
        <span aria-hidden="true">i</span>
        <div>
          <h2 id="docs-scope">{d.scopeTitle}</h2>
          <p>{d.scopeBody}</p>
        </div>
      </aside>

      <section className="docs-section" aria-labelledby="docs-flow">
        <h2 id="docs-flow">{d.flowTitle}</h2>
        <ol className="docs-flow">
          {d.flow.map((item, index) => (
            <li key={item.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <DocsPager
        locale={locale}
        next={{ label: common.getStarted, path: docsPaths.getStarted }}
      />
    </>
  );
}

function GetStarted({ locale }: { locale: Locale }) {
  const d = docsCopy[locale].getStarted;
  const common = docsCopy[locale].common;
  return (
    <>
      <header className="docs-article-header">
        <span>{d.eyebrow}</span>
        <h1>{d.title}</h1>
        <p>{d.description}</p>
      </header>

      <PageContents items={d.contents} label={common.onThisPage} />

      <section className="docs-section" id="prepare">
        <h2>{d.prepareTitle}</h2>
        <ol className="docs-steps">
          {d.prepareSteps.map((step, index) => (
            <li key={step.title}>
              <span>{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="docs-section" id="request">
        <h2>{d.requestTitle}</h2>
        <p>{d.requestDescription}</p>
        <dl className="docs-request">
          <div>
            <dt>{d.requestLabels.method}</dt>
            <dd><code>POST</code></dd>
          </div>
          <div>
            <dt>{d.requestLabels.endpoint}</dt>
            <dd><code>{d.endpoint}</code></dd>
          </div>
          <div>
            <dt>{d.requestLabels.contentType}</dt>
            <dd><code>application/json</code></dd>
          </div>
          <div>
            <dt>{d.requestLabels.body}</dt>
            <dd><code>{d.minimumBody}</code></dd>
          </div>
        </dl>
      </section>

      <section className="docs-section" id="checklist">
        <h2>{d.checklistTitle}</h2>
        <div className="docs-checklist">
          {d.checklist.map((item) => (
            <article key={item.title}>
              <span aria-hidden="true">✓</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="docs-next-callout">
        <div>
          <h2>{d.nextTitle}</h2>
          <p>{d.nextDescription}</p>
        </div>
        <a
          className="button button-primary"
          href={localizedPath(locale, docsPaths.webhooks)}
        >
          {d.nextAction} <Arrow />
        </a>
      </aside>

      <DocsPager
        locale={locale}
        previous={{ label: common.overview, path: docsPaths.overview }}
        next={{ label: common.webhooks, path: docsPaths.webhooks }}
      />
    </>
  );
}

function Webhooks({ locale }: { locale: Locale }) {
  const d = docsCopy[locale].webhooks;
  const common = docsCopy[locale].common;
  return (
    <>
      <header className="docs-article-header">
        <span>{d.eyebrow}</span>
        <h1>{d.title}</h1>
        <p>{d.description}</p>
      </header>

      <PageContents items={d.contents} label={common.onThisPage} />

      <section className="docs-section" id="lifecycle">
        <h2>{d.lifecycleTitle}</h2>
        <ol className="docs-lifecycle">
          {d.lifecycle.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="docs-section" id="endpoint">
        <h2>{d.endpointTitle}</h2>
        <p>{d.endpointDescription}</p>
        <CodeBlock>{d.endpoint}</CodeBlock>
        <aside className="docs-callout docs-callout-warning">
          <span aria-hidden="true">!</span>
          <div>
            <h3>{d.secretWarningTitle}</h3>
            <p>{d.secretWarningBody}</p>
          </div>
        </aside>
      </section>

      <section className="docs-section" id="schema">
        <h2>{d.schemaTitle}</h2>
        <p>{d.schemaDescription}</p>
        <div className="docs-table-wrap">
          <table>
            <caption>{d.schemaCaption}</caption>
            <thead>
              <tr>
                {d.schemaHeaders.map((header) => <th key={header}>{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.schemaRows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, index) => (
                    <td key={cell}>
                      {index === 0 ? <code>{cell}</code> : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>{d.headerTitle}</h3>
        <p>{d.headerDescription}</p>
      </section>

      <section className="docs-section" id="example">
        <h2>{d.exampleTitle}</h2>
        <p>{d.exampleIntro}</p>
        <CodeBlock>{d.curl}</CodeBlock>
        <h3>{d.responseTitle}</h3>
        <CodeBlock>{d.response}</CodeBlock>
      </section>

      <section className="docs-section" id="idempotency">
        <h2>{d.idempotencyTitle}</h2>
        <ul className="docs-bullets">
          {d.idempotency.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section className="docs-section" id="limits">
        <h2>{d.limitsTitle}</h2>
        <dl className="docs-limits">
          {d.limits.map(([term, detail]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
        <p className="docs-note">{d.rateNote}</p>
      </section>

      <section className="docs-section" id="errors">
        <h2>{d.errorsTitle}</h2>
        <div className="docs-table-wrap">
          <table className="docs-errors-table">
            <caption>{d.errorCaption}</caption>
            <thead>
              <tr>
                {d.errorHeaders.map((header) => <th key={header}>{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.errorRows.map((row) => (
                <tr key={row[0]}>
                  <td><code>{row[0]}</code></td>
                  <td>{row[1]}</td>
                  <td>{row[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="docs-section docs-final-checklist">
        <h2>{d.finalTitle}</h2>
        <ul>
          {d.finalChecklist.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <DocsPager
        locale={locale}
        previous={{ label: common.getStarted, path: docsPaths.getStarted }}
      />
    </>
  );
}

export default function DocsView({
  locale,
  page,
}: {
  locale: Locale;
  page: DocsPage;
}) {
  const c = copy[locale];
  const common = docsCopy[locale].common;
  const path = docsPaths[page];
  const hrefs = localizedHrefs(path);

  return (
    <div className="docs-page" id="top">
      <a className="skip-link" href="#main-content">
        {c.aria.skipToContent}
      </a>
      <SiteHeader
        brandHref={localizedPath(locale, "/")}
        className="docs-header"
        copy={c}
        ctaLabel={common.openApp}
        currentPath={path}
        hrefs={hrefs}
        locale={locale}
      />

      <div className="docs-layout shell">
        <DocsNavigation locale={locale} page={page} />
        <main className="docs-content" id="main-content" tabIndex={-1}>
          {page === "overview" ? <Overview locale={locale} /> : null}
          {page === "getStarted" ? <GetStarted locale={locale} /> : null}
          {page === "webhooks" ? <Webhooks locale={locale} /> : null}
        </main>
      </div>

      <SiteFooter
        brandHref={localizedPath(locale, "/")}
        copy={c}
        links={[
          { href: localizedPath(locale, "/"), label: common.home },
          { href: localizedPath(locale, "/tutorial"), label: common.tutorial },
          { href: localizedPath(locale, "/docs"), label: common.label },
          {
            href: localizedPath(locale, "/changelog"),
            label: common.changelog,
          },
          { href: "#top", label: common.backTop },
        ]}
      />
    </div>
  );
}
