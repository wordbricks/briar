# Memory vault end-to-end check — 2026-10-14

Run 2026-10-13T15:53:44.508Z → 2026-10-13T15:58:12.005Z: **55 passed, 0 failed**.

Reproduce: `export CLOUDFLARE_ACCOUNT_ID=459bc0fca39fa1adab8aed615098fcaf && bun scripts/memory-vault-e2e/run.ts --out <this file>` (prerequisites at the top of `scripts/memory-vault-e2e/run.ts`).

## Setup

* Versions: wrangler `4.150.0`, claudeCode `2.1.296 (Claude Code)`, bun `1.4.0`.
* API: the real `briar-api` Worker (`apps/briar/worker/src/index.ts`) under `wrangler dev` 4.150.0 (the repository's 4.127.1 also runs remote Artifacts bindings, but its dev bridge cannot carry the Blob `repo.readFile` returns: "Cannot serialize value: [object Blob]") with a config generated from `apps/briar/wrangler.jsonc` (`scripts/memory-vault-e2e/dev-config.ts`): `MEMORY_ARTIFACTS` → Artifacts namespace `briar-memory-e2e` with `remote: true`, `MEMORY_VAULT_ENABLED=true`; routes, assets, Workers AI and Vectorize removed; D1, R2, Durable Objects, Workflows and email local; dummy secrets. Every migration applied to a private local persist dir. The Worker heartbeats through `WorkerControlService.HeartbeatWorker` every 15 s. Nothing deployed, no `--remote` D1, the `briar-memory` namespace untouched.
* Admin: `scripts/memory-vault-e2e/artifacts-admin-worker.ts` under a second local `wrangler dev`, same remote namespace, reading repositories through the production `ArtifactsVaultGitStore` (direct git-store reads, existence, deletion).
* Seed: people, sessions, workspace, project and Worker device/credential/runtime (with `memoryVaultProtocol = 1`) as local rows; the Agent (`AgentService.CreateWorkspaceAgent`, provider Claude), both DMs (`ChannelService.CreateDirectMessage`), the group channel (`CreateChannel`, `SetChannelMember`, `SetChannelAgent`) and DM memory opt-in (`DmMemoryService.UpdateDmMemorySettings`) through the real RPCs with the people's session tokens.
* Every reply: the person posts through `ChannelService.CreateChannelMessage`; a separate Worker process (`session.ts`) claims it with `WorkerQueueService.ClaimWork`, opens `openMemoryVaultInvocation` + `prepareTurn`, builds instructions = `detachedAgentContext` + vault section and prompt = vault tags + `detachedChannelReplyPrompt`, puts the private `tools` first on PATH, and completes with `CompleteChannelReply`.
* Model: `claude -p` model `claude-opus-5-5`, flags `--append-system-prompt <instructions> --json-schema <production reply schema> --setting-sources "" --strict-mcp-config --tools Bash --allowedTools "Bash(tools memory:*)" --permission-mode dontAsk --no-session-persistence` (the production Claude runner appends instructions to the `claude_code` preset with no setting sources for Briar-only reply turns). Session ids: 1 `c7acf3cf-53b9-49db-ad3e-bcce20eb746b`, 2 `d26605ba-231d-4fe6-b5e1-ca4b654e7d85`.

## Assertions

### 1. Real API Worker locally, real Artifacts (`briar-memory-e2e`)

* **PASS** dev config binds MEMORY_ARTIFACTS to the e2e namespace (remote) and turns the vault on — `[{"binding":"MEMORY_ARTIFACTS","namespace":"briar-memory-e2e","remote":true}]`
* **PASS** no production-only remote bindings in the dev config (AI, Vectorize, routes)
* **PASS** the e2e namespace starts empty (leftovers from an earlier run deleted) — `{"deletedLeftovers":0}`
* **PASS** the dev remote binding carries create, push, readFile, clone and delete (production ArtifactsVaultGitStore) — `{"write":"committed","readFile":"hello","snapshot":["a.md"],"deleted":true}`

### 2. Seed through RPCs

* **PASS** A's and B's DMs are eligible DM memory spaces with recall + automatic writing on — `{"spaceA":"15539b12-33b3-4d60-83fb-7da3a38f610c","spaceB":"ccea6544-e0da-4241-949b-dbd0b9b7e27f"}`

### 3. Session 1: model saves and journals

* **PASS** session 1 ran without error
* **PASS** claim carried no legacy DM memory descriptor; the vault context was served — `{"scope":"dm","status":"Memory status: recall is on (list, read, search); journal and save are allowed."}`
* **PASS** instructions = Briar context + memory section; prompt starts with the vault tags; tools first on PATH
* **PASS** the model called `tools memory save` successfully — `["tools memory save coffee-preference --type preference --aliases 커피,coffee --user-requested <<'BRIAR_MEMORY'","tools memory save voice-guide --type preference --user-requested <<'BRIAR_MEMORY'","tools memory save coffee-preference --type preference --aliases coffee --user-requested <<'BRIAR_MEMORY'"]`
* **PASS** the model called `tools memory journal` successfully — `["tools memory journal \"사용자가 좋아하는 커피(콜드브루 디카페인) 기억 요청 및 존댓말·짧은 답변 규칙 지정\" --occurred-at 2026-10-13T15:54:17+00:00 --references coffee-preference,voice-guide --user-requested"]`
* **PASS** no tool call was denied — `[]`
* **PASS** A's DM vault row exists in D1 with a head commit — `{"id":"df910d3c-59c8-4d32-b331-a548dc6c5d3c","repo_name":"mv-df910d3c59c84d32b331a548dc6c5d3c-g1","generation":1,"head_commit":"f3f9e5d80b6875e99d1e2f3df70b98369dba2ac2","scope_kind":"dm"}`
* **PASS** git store (direct): a record holds the coffee fact — `knowledge/preferences/coffee-preference.md`
* **PASS** git store (direct): the daily journal has a `- HH:MM | …` line — `timeline/daily/2026-10-13.md`
* **PASS** git store (direct): voice-guide has the stated rule with `(user, <date>)` — `--- id: voice-guide type: preference revision: 1 created_at: 2026-10-13T15:54:42Z updated_at: 2026-10-13T15:54:42Z --- - 항상 존댓말로 짧게 답한다 (user, 2026-10-13) `
* **PASS** git store (direct): every commit carries Briar trailers
* **PASS** vault read RPC (tools memory read) returns the coffee record and the voice guide — `[{"id":"coffee-preference","revision":1},{"id":"2026-10-13","revision":1},{"id":"voice-guide","revision":1}]`
* **PASS** D1 index rows match the repository (records + revisions) — `[{"record_id":"coffee-preference","record_type":"preference","path":"knowledge/preferences/coffee-preference.md","revision":1},{"record_id":"voice-guide","record_type":"preference","path":"knowledge/preferences/voice-guide.md","revision":1},{"record_id":"2026-10-13","record_type":"timeline-daily","path":"timeline/daily/2026-10-13.md","revision":1}]`
* **PASS** the reply completed through CompleteChannelReply — `{"ok":true,"disposition":1,"finalMessageId":null}`

### 4. Session 2: another process, fresh session recalls

* **PASS** session 2 ran without error
* **PASS** session 2 is a brand-new model session (no resume) — `{"s1":"c7acf3cf-53b9-49db-ad3e-bcce20eb746b","s2":"d26605ba-231d-4fe6-b5e1-ca4b654e7d85"}`
* **PASS** the prompt prefix carried <voice-guide> with the saved rule — `- 항상 존댓말로 짧게 답한다 (user, 2026-10-13) `
* **PASS** the model retrieved the fact through `tools memory` — `["tools memory search \"커피\" 2>&1 | head -50; tools memory search \"coffee\" 2>&1 | head -50","tools memory read coffee-preference 2>&1 | head -30","{\"body\":\"콜드브루 디카페인입니다.\",\"attachments\":[],\"document\":null,\"issueProposal\":null,\"issueBatchProposal\":null,\"executionProposal\":null,\"skillExecutionProposal\":null,\"delegation\":null,\"agentMessage\":null,\"contextRequests\":null,\"memoryR… (579 chars)`
* **PASS** the answer states the fact (콜드브루 디카페인) — `콜드브루 디카페인입니다.`
* **PASS** the answer does not expose files, paths, tools or storage — `콜드브루 디카페인입니다.`
* **PASS** the answer follows the saved reply rule (polite form, short) — `콜드브루 디카페인입니다.`
* **PASS** citations (if any) were accepted by completion — `{"citations":[{"documentId":"coffee-preference","version":1}],"completion":{"ok":true,"disposition":1,"finalMessageId":null}}`

### 5. Revisions, conflict, old revision, pagination, journal dedupe

* **PASS** revisions scenario ran without error
* **PASS** update with the right --expected-revision commits revision n+1 — `{"before":1,"after":{"id":"coffee-preference","type":"preference","path":"knowledge/preferences/coffee-preference.md","revision":2,"commit":"8be37a7bd30b8efc160f18a967a53fee4c6bef24","dropped_lines":[],"replayed":false}}`
* **PASS** a stale save gets revision_conflict with the current revision — `{"error":{"code":"revision_conflict","message":"Record coffee-preference is at revision 2; read it, merge, and save again","retryable":false,"current_revision":2}}`
* **PASS** read --revision 1 returns the first body — `{"revision":1,"latest":false}`
* **PASS** search --limit 1 paginates through next_cursor to null — `[{"hit":"e2e-page-a","next":"cursor"},{"hit":"e2e-page-b","next":"cursor"},{"hit":"2026-10-13","next":null}]`
* **PASS** journal retry with the same request id is deduplicated (replayed, same commit) — `{"first":{"line":"- 15:56 | e2e retry dedupe line","revision":3,"commit":"960135ba6348063d157ecf8639575e7f721617c4","replayed":false,"deduplicated":false},"second":{"line":"- 15:56 | e2e retry dedupe line","revision":3,"commit":"960135ba6348063d157ecf8639575e7f721617c4","replayed":true,"deduplicated":false}}`
* **PASS** an identical journal line within the same minute is deduplicated — `{"first":{"id":"2026-10-13","path":"timeline/daily/2026-10-13.md","line":"- 15:56 | e2e identical line retry","revision":4,"commit":"d66be4a7ef2f654e998adb7de851b15b80acb06e","deduplicated":false,"replayed":false},"second":{"id":"2026-10-13","path":"timeline/daily/2026-10-13.md","line":"- 15:56 | e2e identical line retry","revision":4,"commit":"d66be4a7ef2f654e998adb7de851b15b80acb06e","deduplicat… (427 chars)`

### 6. Isolation and inactive claims

* **PASS** a finished claim (session 1 after completion) gets claim_inactive — `{"code":"claim_inactive","message":"The claim for this run is no longer active","retryable":false}`
* **PASS** user B DM: vault scope is its own (dm) — `dm`
* **PASS** user B DM: list shows none of A's records — `["readme"]`
* **PASS** user B DM: search for A's coffee finds nothing
* **PASS** user B DM: read of A's coffee record is not_found — `{"error":{"code":"not_found","message":"No memory record coffee-preference","retryable":false}}`
* **PASS** group channel: vault scope is its own (group) — `group`
* **PASS** group channel: list shows none of A's records — `["readme"]`
* **PASS** group channel: search for A's coffee finds nothing
* **PASS** group channel: read of A's coffee record is not_found — `{"error":{"code":"not_found","message":"No memory record coffee-preference","retryable":false}}`
* **PASS** an expired claim gets claim_inactive (tools and RPC) — `{"tools":{"error":{"code":"claim_inactive","message":"The claim for this run is no longer active","retryable":false}},"rpc":{"code":"claim_inactive","message":"The claim for this run is no longer active","retryable":false}}`

### 7. README

* **PASS** README file hash is the pinned one — `d907567be6ee97bae6df48a58ce4018a1a4e98d5dc628031ef208956a74ba583`
* **PASS** instructions contain the server README byte for byte
* **PASS** `tools memory save readme …` is refused (readme_read_only) — `{"error":{"code":"readme_read_only","message":"README.md belongs to the application","retryable":false}}`
* **PASS** `tools memory read README.md` serves the server README byte for byte

### 8. Forget and purge

* **PASS** the owner dialog deleted the coffee record — `[{"id":"0f42fdf6-6e78-8dfd-99f3-8a7da9490abb","title":"커피 취향","purgeState":"pending"}]`
* **PASS** purge completed and switched to the next generation — `{"purge":{"completed_at":"2026-10-13T15:57:06.220Z","last_error":null,"attempts":1,"cron":"ok"},"vault":{"repo_name":"mv-df910d3c59c84d32b331a548dc6c5d3c-g2","generation":2,"state":"active"}}`
* **PASS** the old generation repository is gone — `mv-df910d3c59c84d32b331a548dc6c5d3c-g1`
* **PASS** no commit of the new generation contains the coffee record's path — `knowledge/preferences/coffee-preference.md`
* **PASS** second purge completed; previous generation gone — `{"purge":{"completed_at":"2026-10-13T15:57:56.076Z","last_error":null,"attempts":1,"cron":"ok"},"vault":{"repo_name":"mv-df910d3c59c84d32b331a548dc6c5d3c-g3","generation":3,"state":"active"}}`
* **PASS** the final generation has no commit containing the coffee text — `[]`

### 9. Cleanup

* **PASS** every repository in the e2e namespace deleted; namespace empty — `{"deleted":["mv-df910d3c59c84d32b331a548dc6c5d3c-g3"],"left":[]}`

## Session 1 (user A states a fact and a reply rule)

Claim `cbe09728-1ea9-445a-8480-ee2bd6ed84c4`, vault scope `dm`, status line `Memory status: recall is on (list, read, search); journal and save are allowed.`. User message: "내가 좋아하는 커피는 콜드브루 디카페인이야. 기억해 줘. 그리고 앞으로 나한테 답할 땐 항상 존댓말로 짧게 해줘."

Prompt prefix (the vault was empty):

```
<voice-memory></voice-memory>

<voice-guide></voice-guide>

<playbook-memory></playbook-memory>
```

Tool calls (command → output):

Call 1, Bash:

```sh
tools memory --help; tools memory read voice-guide; tools memory search "커피"
```

Output:

```
{"help":"Usage: tools memory <command> [options]\n\nCommands:\n  list [--type T] [--prefix P] [--status S] [--cursor C] [--limit N]\n      Records, newest update first.\n  read <id|path> [--revision N]\n      One record: frontmatter fields and body. Latest revision by default.\n  search <text> [--type T] [--prefix P] [--cursor C] [--limit N]\n      Case-insensitive substring search. Follow next_cursor until it is null.\n  journal <text> [--occurred-at ISO8601+offset] [--references id,id] [--user-requested]\n      Append one event line to the day's timeline.\n  save <id> --type T [--status S] [--aliases a,b] [--expected-revision N] [--user-requested] [--content-file F]\n      Create or update a record. The Markdown body comes from --content-file or\n      stdin, for example:\n        tools memory save my-record --type fact <<'BRIAR_MEMORY'\n        body\n        BRIAR_MEMORY\n\nOutput is one JSON object on stdout. Exit 0 on success, 1 on a tool error\n({\"error\":{\"code\",\"message\",\"retryable\"}}), 2 on a usage error."}
{"error":{"code":"not_found","message":"No memory record voice-guide","retryable":false}}
{"hits":[],"next_cursor":null,"commit":null}
```

Call 2, Bash:

```sh
tools memory save coffee-preference --type preference --aliases 커피,coffee --user-requested <<'BRIAR_MEMORY'
# 커피 취향

- 좋아하는 커피: 콜드브루 디카페인 (사용자 직접 언급, 2026-10-13)
BRIAR_MEMORY
tools memory save voice-guide --type preference --user-requested <<'BRIAR_MEMORY'
- 항상 존댓말로 짧게 답한다 (user, 2026-10-13)
BRIAR_MEMORY
tools memory journal "사용자가 좋아하는 커피(콜드브루 디카페인) 기억 요청 및 존댓말·짧은 답변 규칙 지정" --occurred-at 2026-10-13T15:54:17+00:00 --references coffee-preference,voice-guide --user-requested
```

Output:

```
{"error":{"code":"invalid_record","message":"Aliases use the same form as ids","retryable":false}}
{"id":"voice-guide","type":"preference","path":"knowledge/preferences/voice-guide.md","revision":1,"commit":"2a920f4b5995d22cf9bb0ac93647a0e06f85e01b","dropped_lines":[],"replayed":false}
{"id":"2026-10-13","path":"timeline/daily/2026-10-13.md","line":"- 15:54 | 사용자가 좋아하는 커피(콜드브루 디카페인) 기억 요청 및 존댓말·짧은 답변 규칙 지정 [[coffee-preference]] [[voice-guide]]","revision":1,"commit":"f6267bfc54ac4f9f26788b81d06bed6d2c700d2c","deduplicated":false,"replayed":false}
```

Call 3, Bash:

```sh
tools memory save coffee-preference --type preference --aliases coffee --user-requested <<'BRIAR_MEMORY'
# 커피 취향

- 좋아하는 커피: 콜드브루 디카페인 (사용자 직접 언급, 2026-10-13)
BRIAR_MEMORY
```

Output:

```
{"id":"coffee-preference","type":"preference","path":"knowledge/preferences/coffee-preference.md","revision":1,"commit":"f3f9e5d80b6875e99d1e2f3df70b98369dba2ac2","dropped_lines":[],"replayed":false}
```

Call 4, structured reply (StructuredOutput):

```json
{"body":"네, 기억했습니다. 좋아하시는 커피는 콜드브루 디카페인입니다. 앞으로는 항상 존댓말로 짧게 답하겠습니다.","attachments":[],"document":null,"issueProposal":null,"issueBatchProposal":null,"executionProposal":null,"skillExecutionProposal":null,"delegation":null,"agentMessage":null,"contextRequests":null,"memoryRequests":null,"memoryCitations":null,"memorySaveRequest":null,"acknowledgementReaction":null,"repositoryRequest":null}
```

Output:

```
Structured output provided successfully
```

Answer (reply body sent through CompleteChannelReply):

```
네, 기억했습니다. 좋아하시는 커피는 콜드브루 디카페인입니다. 앞으로는 항상 존댓말로 짧게 답하겠습니다.
```

Repository after session 1 (`mv-df910d3c59c84d32b331a548dc6c5d3c-g1`, read directly from the git store):

```
[
  {
    "oid": "f3f9e5d80b6875e99d1e2f3df70b98369dba2ac2",
    "subject": "memory: save coffee-preference r1"
  },
  {
    "oid": "f6267bfc54ac4f9f26788b81d06bed6d2c700d2c",
    "subject": "memory: journal 2026-10-13"
  },
  {
    "oid": "2a920f4b5995d22cf9bb0ac93647a0e06f85e01b",
    "subject": "memory: save voice-guide r1"
  },
  {
    "oid": "2e356d1c988f5359e3e0460fac197aad91659a6e",
    "subject": "memory: initialize vault"
  }
]
```
`knowledge/preferences/coffee-preference.md`:
```md
---
id: coffee-preference
type: preference
aliases: [coffee]
revision: 1
created_at: 2026-10-13T15:54:52Z
updated_at: 2026-10-13T15:54:52Z
---
# 커피 취향

- 좋아하는 커피: 콜드브루 디카페인 (사용자 직접 언급, 2026-10-13)

```
`knowledge/preferences/voice-guide.md`:
```md
---
id: voice-guide
type: preference
revision: 1
created_at: 2026-10-13T15:54:42Z
updated_at: 2026-10-13T15:54:42Z
---
- 항상 존댓말로 짧게 답한다 (user, 2026-10-13)

```
`timeline/daily/2026-10-13.md`:
```md
---
id: 2026-10-13
type: timeline-daily
revision: 1
created_at: 2026-10-13T15:54:46Z
updated_at: 2026-10-13T15:54:46Z
---
- 15:54 | 사용자가 좋아하는 커피(콜드브루 디카페인) 기억 요청 및 존댓말·짧은 답변 규칙 지정 [[coffee-preference]] [[voice-guide]]

```

D1 index after session 1:

```
{
  "records": [
    {
      "record_id": "coffee-preference",
      "record_type": "preference",
      "path": "knowledge/preferences/coffee-preference.md",
      "revision": 1
    },
    {
      "record_id": "voice-guide",
      "record_type": "preference",
      "path": "knowledge/preferences/voice-guide.md",
      "revision": 1
    },
    {
      "record_id": "2026-10-13",
      "record_type": "timeline-daily",
      "path": "timeline/daily/2026-10-13.md",
      "revision": 1
    }
  ],
  "revisions": 3
}
```

## Session 2 (another Worker process, fresh model session)

Claim `845bd0f3-812f-4105-91e3-47ef7b5ddae3`, user message "내가 좋아하는 커피 뭐였지?". Prompt prefix:

```
<voice-memory></voice-memory>

<voice-guide>
- 항상 존댓말로 짧게 답한다 (user, 2026-10-13)
</voice-guide>

<playbook-memory></playbook-memory>
```

Tool calls:

Call 1, Bash:

```sh
tools memory search "커피" 2>&1 | head -50; tools memory search "coffee" 2>&1 | head -50
```

Output:

```
{"hits":[{"id":"coffee-preference","type":"preference","path":"knowledge/preferences/coffee-preference.md","revision":1,"line":9,"snippet":"# 커피 취향"},{"id":"coffee-preference","type":"preference","path":"knowledge/preferences/coffee-preference.md","revision":1,"line":11,"snippet":"- 좋아하는 커피: 콜드브루 디카페인 (사용자 직접 언급, 2026-10-13)"},{"id":"2026-10-13","type":"timeline-daily","path":"timeline/daily/2026-10-13.md","revision":1,"line":8,"snippet":"- 15:54 | 사용자가 좋아하는 커피(콜드브루 디카페인) 기억 요청 및 존댓말·짧은 답변 규칙 지정 [[coffee-preference]] [[voice-guide]]"}],"next_cursor":null,"commit":"f3f9e5d80b6875e99d1e2f3df70b98369dba2ac2"}
{"hits":[{"id":"2026-10-13","type":"timeline-daily","path":"timeline/daily/2026-10-13.md","revision":1,"line":8,"snippet":"- 15:54 | 사용자가 좋아하는 커피(콜드브루 디카페인) 기억 요청 및 존댓말·짧은 답변 규칙 지정 [[coffee-preference]] [[voice-guide]]"}],"next_cursor":null,"commit":"f3f9e5d80b6875e99d1e2f3df70b98369dba2ac2"}
```

Call 2, Bash:

```sh
tools memory read coffee-preference 2>&1 | head -30
```

Output:

```
{"id":"coffee-preference","type":"preference","path":"knowledge/preferences/coffee-preference.md","status":null,"aliases":["coffee"],"revision":1,"updated_at":"2026-10-13T15:54:52Z","protected_by_user":false,"created_at":"2026-10-13T15:54:52Z","latest":true,"commit":"f3f9e5d80b6875e99d1e2f3df70b98369dba2ac2","body":"# 커피 취향\n\n- 좋아하는 커피: 콜드브루 디카페인 (사용자 직접 언급, 2026-10-13)\n"}
```

Call 3, structured reply (StructuredOutput):

```json
{"body":"콜드브루 디카페인입니다.","attachments":[],"document":null,"issueProposal":null,"issueBatchProposal":null,"executionProposal":null,"skillExecutionProposal":null,"delegation":null,"agentMessage":null,"contextRequests":null,"memoryRequests":null,"memoryCitations":[{"documentId":"coffee-preference","version":1}],"memorySaveRequest":null,"acknowledgementReaction":null,"repositoryRequest":null}
```

Output:

```
Structured output provided successfully
```

Answer:

```
콜드브루 디카페인입니다.
```

Citations: `[{"documentId":"coffee-preference","version":1}]`, completion: `{"ok":true,"disposition":1,"finalMessageId":null}`

## Direct tool invocations (goal 5, 7)

* `readBefore`: `{"argv":["memory","read","coffee-preference"],"exit":0,"output":{"id":"coffee-preference","type":"preference","path":"knowledge/preferences/coffee-preference.md","status":null,"aliases":["coffee"],"revision":1,"updated_at":"2026-10-13T15:54:52Z","protected_by_user":false,"created_at":"2026-10-13T15:54:52Z","latest":true,"commit":"f3f9e5d80b6875e99d1e2f3df70b98369dba2ac2","body":"# 커피 취향\n\n- 좋아하는 커피: 콜드브루 디카페인 (사용자 직접 언급, 2026-10-13)\n"}}`
* `updateWithRevision`: `{"argv":["memory","save","coffee-preference","--type","preference","--expected-revision","1","--user-requested"],"exit":0,"output":{"id":"coffee-preference","type":"preference","path":"knowledge/preferences/coffee-preference.md","revision":2,"commit":"8be37a7bd30b8efc160f18a967a53fee4c6bef24","dropped_lines":[],"replayed":false}}`
* `staleSave`: `{"argv":["memory","save","coffee-preference","--type","preference","--expected-revision","1","--user-requested"],"exit":1,"output":{"error":{"code":"revision_conflict","message":"Record coffee-preference is at revision 2; read it, merge, and save again","retryable":false,"current_revision":2}}}`
* `readRevision1`: `{"argv":["memory","read","coffee-preference","--revision","1"],"exit":0,"output":{"id":"coffee-preference","type":"preference","path":"knowledge/preferences/coffee-preference.md","status":null,"aliases":["coffee"],"revision":1,"updated_at":"2026-10-13T15:54:52Z","protected_by_user":false,"created_at":"2026-10-13T15:54:52Z","latest":false,"commit":"f3f9e5d80b6875e99d1e2f3df70b98369dba2ac2","body":"# 커피 취향\n\n- 좋아하는 커피: 콜드브루 디카페인 (사용자 직접 언급, 2026-10-13)\n"}}`
* `readLatest`: `{"argv":["memory","read","coffee-preference"],"exit":0,"output":{"id":"coffee-preference","type":"preference","path":"knowledge/preferences/coffee-preference.md","status":null,"aliases":[],"revision":2,"updated_at":"2026-10-13T15:55:58Z","protected_by_user":false,"created_at":"2026-10-13T15:54:52Z","latest":true,"commit":"8be37a7bd30b8efc160f18a967a53fee4c6bef24","body":"# 커피 취향\n\n- 좋아하는 커피: 콜드브루 디카페인 (사용자 직접 언급, 2026-10-13)\n\n- 주말에는 가끔 아이스 라떼도 마신다고 함 (e2e 업데이트).\n"}}`
* `searchPages`: `[{"argv":["memory","search","paginate-token","--limit","1"],"exit":0,"output":{"hits":[{"id":"e2e-page-a","type":"fact","path":"knowledge/facts/e2e-page-a.md","revision":1,"line":10,"snippet":"paginate-token alpha"}],"next_cursor":"eyJjIjoiMDhkZmMyM2I3NzZjOWJkMWIwZjYwNjhiMTgyZmFmOGU4NTE3ZjZkZiIsIm8iOjEsImgiOiJlNjhiZDE3MzRlY2UyZGRmIn0","commit":"08dfc23b776c9bd1b0f6068b182faf8e8517f6df"}},{"argv":["memory","search","paginate-token","--limit","1","--cursor","eyJjIjoiMDhkZmMyM2I3NzZjOWJkMWIwZjYwNjhiMTgyZmFmOGU4NTE3ZjZkZiIsIm8iOjEsImgiOiJlNjhiZDE3MzRlY2UyZGRmIn0"],"exit":0,"output":{"hits":[{"id":"e2e-page-b","type":"fact","path":"knowledge/facts/e2e-page-b.md","revision":1,"line":10,"snippet":"… (1330 chars)`
* `journalSameRequestId`: `{"first":{"line":"- 15:56 | e2e retry dedupe line","revision":3,"commit":"960135ba6348063d157ecf8639575e7f721617c4","replayed":false,"deduplicated":false},"second":{"line":"- 15:56 | e2e retry dedupe line","revision":3,"commit":"960135ba6348063d157ecf8639575e7f721617c4","replayed":true,"deduplicated":false}}`
* `journalToolFirst`: `{"argv":["memory","journal","e2e identical line retry"],"exit":0,"output":{"id":"2026-10-13","path":"timeline/daily/2026-10-13.md","line":"- 15:56 | e2e identical line retry","revision":4,"commit":"d66be4a7ef2f654e998adb7de851b15b80acb06e","deduplicated":false,"replayed":false}}`
* `journalToolSecond`: `{"argv":["memory","journal","e2e identical line retry"],"exit":0,"output":{"id":"2026-10-13","path":"timeline/daily/2026-10-13.md","line":"- 15:56 | e2e identical line retry","revision":4,"commit":"d66be4a7ef2f654e998adb7de851b15b80acb06e","deduplicated":true,"replayed":false}}`
* `readmeSave`: `{"argv":["memory","save","readme","--type","fact"],"exit":1,"output":{"error":{"code":"readme_read_only","message":"README.md belongs to the application","retryable":false}}}`

## Isolation (goal 6)

* b: scope `dm`; list `{"records":[{"id":"readme","type":"readme","path":"README.md","status":null,"aliases":[],"revision":0,"updated_at":null,"protected_by_user":true}],"next_cursor":null}`; search `{"hits":[],"next_cursor":null,"commit":null}`; read `{"error":{"code":"not_found","message":"No memory record coffee-preference","retryable":false}}`
* group: scope `group`; list `{"records":[{"id":"readme","type":"readme","path":"README.md","status":null,"aliases":[],"revision":0,"updated_at":null,"protected_by_user":true}],"next_cursor":null}`; search `{"hits":[],"next_cursor":null,"commit":null}`; read `{"error":{"code":"not_found","message":"No memory record coffee-preference","retryable":false}}`
* expired claim: tools `{"error":{"code":"claim_inactive","message":"The claim for this run is no longer active","retryable":false}}`, RPC `{"code":"claim_inactive","message":"The claim for this run is no longer active","retryable":false}`
* finished claim (session 1 after completion): `{"code":"claim_inactive","message":"The claim for this run is no longer active","retryable":false}`

## Forget and purge (goal 8)

```
{
  "owner_dialog_documents_before": [
    {
      "id": "5a591d04-9ed1-8756-b2dd-b38d8d43bd9b",
      "title": "2026-10-13",
      "version": 4
    },
    {
      "id": "0f42fdf6-6e78-8dfd-99f3-8a7da9490abb",
      "title": "coffee-preference",
      "version": 2
    },
    {
      "id": "d57029ff-ed2e-82b3-bb11-13ffc6b41ff6",
      "title": "e2e-page-a",
      "version": 1
    },
    {
      "id": "7f870c65-e9fb-83e7-a694-88c0b28b8ba6",
      "title": "e2e-page-b",
      "version": 1
    },
    {
      "id": "6ae2c14f-9a7a-854a-99db-4175f5618094",
      "title": "voice-guide",
      "version": 1
    }
  ],
  "forget1_deleted": [
    {
      "id": "0f42fdf6-6e78-8dfd-99f3-8a7da9490abb",
      "title": "커피 취향",
      "purgeState": "pending"
    }
  ],
  "purge1": {
    "completedAt": "2026-10-13T15:57:06.220Z",
    "attempts": 1,
    "lastError": null,
    "oldRepoGone": true,
    "vault": {
      "repo_name": "mv-df910d3c59c84d32b331a548dc6c5d3c-g2",
      "generation": 2,
      "state": "active"
    },
    "commitsInNewGeneration": 8,
    "commitsStillHoldingCoffeeText": 6
  },
  "coffee_text_left_in_journal_commits": [
    "timeline/daily/2026-10-13.md"
  ],
  "forget2_deleted": [
    {
      "id": "5a591d04-9ed1-8756-b2dd-b38d8d43bd9b",
      "title": "2026-10-13",
      "purgeState": "pending"
    }
  ],
  "purge2": {
    "completedAt": "2026-10-13T15:57:56.076Z",
    "attempts": 1,
    "lastError": null,
    "oldRepoGone": true,
    "vault": {
      "repo_name": "mv-df910d3c59c84d32b331a548dc6c5d3c-g3",
      "generation": 3,
      "state": "active"
    },
    "commitsInNewGeneration": 4,
    "commitsStillHoldingCoffeeText": 0
  }
}
```

Spec §10.3: forget removes the record's own history; words the agent also wrote into a journal line are a separate record. The owner deletes that daily record too (forget 2), after which no commit of the final generation contains the text.

## Cleanup (goal 9)

```
{
  "deleted": [
    "mv-df910d3c59c84d32b331a548dc6c5d3c-g3"
  ],
  "left": []
}
```

## Notes

* Non-ASCII aliases: the model's first save offered a Korean alias ("커피") and got `invalid_record` "Aliases use the same form as ids" (1 such rejection(s) in this run); it retried with ASCII aliases in the same turn. Aliases follow the id grammar by design (spec §5.1); a Korean user's natural alias cannot be stored.
* Local-only differences, not product behaviour: Workers AI is not bound, so the DM acknowledgement reaction logs "Cannot read properties of undefined (reading 'run')"; reply delivery to the channel is otherwise real.
* Product fixes this check needed (see the PR): the README Text import failed the real `wrangler deploy` bundle (`readme.ts`, guarded by `scripts/worker-module-rules.test.ts`); a missing repository behind a `wrangler dev` remote binding lost its `NOT_FOUND` code, so every purge failed its "old generation is gone" check (`artifacts-git-store.ts`, `artifacts-git-store.test.ts`).

## Timings

| Step | ms |
| --- | ---: |
| build memory-tools bundle | 10 |
| generate config + apply migrations (local D1) | 9248 |
| start wrangler dev (API + admin) | 5941 |
| seed (raw people/org/project/worker + RPC agent/channels/settings) | 220 |
| session 1 (Worker process 1, claude -p) | 48667 |
| session 2 (Worker process 2, fresh claude -p) | 29406 |
| direct tools memory invocations (Worker process 3) | 49110 |
| isolation: user B's DM claim | 1100 |
| isolation: group channel claim | 1012 |
| expired claim | 3075 |
| forget the coffee record (owner dialog) | 8367 |
| purge 1 (minute cron) | 16940 |
| forget the daily journal records mentioning it (owner dialog) | 7375 |
| purge 2 (minute cron) | 19798 |
| cleanup | 5011 |
| session 1: claim / prepareTurn / model / completion | 54 / 19 / 39660 / 68 |
| session 2: claim / prepareTurn / model / completion | 65 / 2072 / 19042 / 36 |

