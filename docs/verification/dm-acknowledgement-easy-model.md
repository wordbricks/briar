# DM acknowledgement easy model selection

## Selection and fallback

The execution worker reuses `recommendIssueExecution("easy", ...)` with the
capability catalog and healthy provider list from its existing heartbeat.
No model names or effort overrides are added to the acknowledgement path, and
no provider discovery or session startup is added before the body starts.
The selected provider also determines the selection process environment.

When a preferred easy provider is unavailable, the existing recommendation
function considers the next supported candidate. If none qualifies (including
missing models or unsupported effort), the acknowledgement retains the body
Agent's provider/model/effort, matching issue execution fallback. Previously,
the acknowledgement inherited the Agent's provider/model but forced low effort.
The body Agent is never modified.

The selector still gets only recent conversation text, its own temporary
workspace, no skills, disabled computer use, read-only access, and a fresh
session. Selection failure, invalid output, and the existing 15-second timeout
publish the existing neutral 👀 fallback once. Late output is ignored; claim
shutdown cancels selection/publication. There is no second provider retry after
a failed turn. Capability authorization and server first-write deduplication
are unchanged. This is an execution change, with no screen/layout changes.

## Live comparison — 2026-09-09 KST

Synthetic inputs, identical across variants:

- Gratitude: `도와줘서 정말 고마워!`
- Celebration: `드디어 첫 출시 성공했어!`
- Empathy: `오늘 너무 지치고 속상해. 그냥 들어줬으면 좋겠어.`

Each observation calls the real `runDetachedProviderTurn` with a fresh isolated
workspace and no conversation ID. Elapsed time starts before workspace creation
and includes runner/provider startup and the complete turn, ending before
workspace cleanup. The 15-second production selection limit is used. Discovery
happens once before measurement, as in the worker heartbeat. Samples run
sequentially with no body turn competing for resources; these are three
observations per variant, not a production percentile or a cost estimate.

The representative previous behavior uses Codex `gpt-6-astra`, low effort.
This is a controlled baseline, not a claim that all saved Agents use Astra.
The unmodified easy policy selected AGY `gemini-3.7-flash-high`, null effort.

| Input | Baseline elapsed | Baseline result | Easy AGY elapsed | Easy result |
| --- | ---: | --- | ---: | --- |
| Gratitude | 5,240 ms | ❤️ | 814 ms | No completed output; 👀 fallback |
| Celebration | 5,552 ms | 🎉 | 679 ms | No completed output; 👀 fallback |
| Empathy | 8,410 ms | 🫂 | 1,165 ms | No completed output; 👀 fallback |

The baseline results fit the intended tone in all three samples. AGY reported
healthy during discovery but returned no completed result in all three calls.
Its shorter duration measures failure, **not faster contextual selection**.

A second controlled run excluded AGY from the in-memory availability list
without changing any saved provider settings. The same easy policy then chose
OpenCode `opencode-go/deepseek-v4-flash`, high effort. It failed all three calls
in 2,055 / 1,917 / 1,852 ms: the provider requires explicit opt-in to China
hosting. No opt-in was performed. Excluding both AGY and OpenCode produced no
eligible easy recommendation on this host. These experiments do not establish
successful live easy-model selection or improved cost/latency.

## Automated verification

Focused Vitest coverage passes 37 tests across acknowledgement lifecycle,
actual channel reply execution, and central recommendation policy. The actual
reply runner tests verify distinct selection/body provider/model/effort, Agent
fallback, context, fresh session, isolated workspace and selection permissions.
Policy tests cover unavailable providers and absence of an eligible candidate.
Lifecycle tests cover normal output, malformed output, selection/publication
failure, timeout, late output and cancellation. Workspace typechecks pass.

## Resumed live verification — 2026-09-09 11:03 KST

The earlier attempt did not establish why Luna was excluded. Its conclusion
that AGY login was needed was too narrow. No AGY login or hosting-region opt-in
is required for this acceptance test.

After merging origin/main e6cefcd2, fresh Codex app-server discovery advertised
`gpt-5.6-luna` with `max` effort. The unchanged central easy policy selected that
exact pair when given the discovered Codex catalog. This controlled comparison
enables only Codex in memory; it does not change saved provider availability or
force production workers to prefer Codex over other eligible easy providers.
The latest main policy now prefers Gemini 3.8 Flash High and OpenCode GLM 5.3
Flash before Luna; the preceding AGY/OpenCode observations describe the old
policy at the time they ran.

The same three synthetic messages, production prompt and real detached runner
were used. Every sample used a new workspace and session, disabled computer use,
no skills, read-only access and the production 15-second deadline. Timing starts
before workspace creation, includes runner and provider session startup, and
ends before cleanup. All six calls completed with exit code 0, no runner error,
and no provider block. The benchmark did not publish messages or reactions.

| Input | Astra low elapsed | Astra result | Luna max elapsed | Luna result |
| --- | ---: | --- | ---: | --- |
| Gratitude | 6,224 ms | ❤️ | 6,851 ms | 🙏 |
| Celebration | 5,340 ms | 🎉 | 5,446 ms | 🎉 |
| Empathy | 6,046 ms | 🫂 | 6,279 ms | 🫂 |

Both variants produced contextually appropriate reactions in all three samples.
Mean elapsed time was 5,870 ms for Astra and 6,192 ms for Luna (322 ms / 5.5%
slower). These small sequential samples establish successful easy-model use,
not a latency improvement or a production percentile. No token price or billed
cost was measured. Production selection still uses the shared easy policy and
healthy provider snapshot, with Agent fallback if no eligible candidate exists;
turn failure or timeout retains the neutral reaction fallback.
