# Reading a channel reply's timing out of the Worker log

The Worker service writes stdout and stderr to
`~/.local/state/briar/worker/<projectId>.log`. Every line it writes while the
long-running `briar worker` process is up carries an ISO-8601 UTC timestamp with
milliseconds (`2026-09-10T02:14:05.123Z claimed briar-channel:… (…)`). Set
`BRIAR_WORKER_LOG_TIMESTAMPS=0` to turn the prefix off; a multi-line message is
stamped on its first line only, and other CLI commands are never stamped.

Three JSON lines account for one reply. All durations are milliseconds, and a
stretch that was never measured is absent rather than zero.

## `claim latency:`

Printed by the claim loop next to `claimed …`, for every claim that returned
work.

| field | meaning |
| --- | --- |
| `workId` | the claimed work item, `null` for issue work |
| `rpcMs` | how long the claim RPC itself took |
| `waitedMs` | how long the loop idled before this claim attempt |
| `wake` | what ended that wait: `poll`, `heartbeat`, or the server wake reason |
| `heartbeatMs` | how long `beat()` blocked immediately before the claim |

```
claim latency: {"workId":"reply-work-1","rpcMs":40,"waitedMs":3000,"wake":"channel_reply_enqueued","heartbeatMs":0}
```

## `channel reply setup:`

Claim → first provider turn, per setup step (`workspace`, `memory`, `message`,
`organizationContext`, `attachments`, `skills`, `prewarm`), plus `total`,
`steerFolded`, `prewarm`, `memoryBrief` and `boot`.

```
channel reply setup: {"workId":"787f79e0-…","workspace":23,"memory":31,"attachments":4,"skills":0,"prewarm":"none","memoryBrief":"loaded","total":42,"parallel":true,"steerFolded":false}
```

## `channel reply timeline:`

One line per reply, printed however it ends. It reuses the setup line's own
record, so `setup`/`firstTurnBoot`/`steerFolded`/`prewarm`/`memoryBrief` always
agree with the line above.

| field | meaning |
| --- | --- |
| `triggerToClaim` | the person's message → this Worker's claim |
| `claimToAck` | claim → the Worker's 👀 placeholder reached the server; absent whenever the server's own emoji was already on the message |
| `setup`, `firstTurnBoot` | the setup line's `total` and `boot` |
| `turns` | `{round, ms, result}` per provider round; `result` is `reply`, `memory`, `repository`, `context`, `repair` or `failed` |
| `post` | last round → the completion RPC returned (settle, publish, complete) |
| `total`, `triggerToReply` | claim → done, and message → completion |
| `outcome` | `completed`, `requeued`, `failed`, `steered` or `handed_off` |
| `workspace`, `acknowledgement` | `none`/`created`/`reused`/`on_demand`, and `none`/`existing`/`placeholder` |

```
channel reply timeline: {"workId":"787f79e0-…","triggerToClaim":251,"claimToAck":21,"setup":42,"turns":[{"round":1,"ms":3,"result":"reply"}],"post":8,"total":54,"triggerToReply":304,"outcome":"completed","steerFolded":false,"prewarm":"none","memoryBrief":"loaded","workspace":"none","acknowledgement":"placeholder"}
```

A reply that ends in `steered` is claimed again under the same work id; the next
claim's `triggerToClaim` is the gap the person actually waited through.

## Where the acknowledgement emoji comes from

The acknowledgement exists to say "the Agent read this" *before* the reply
arrives, so the server chooses it: when a direct message enqueues a reply job,
the API asks Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) for one
emoji, giving it the trigger and the two messages before it and nothing else —
no memory, no attachments, no workspace metadata. The call rides `waitUntil`,
so it delays neither the message's response nor the Worker wake, and it is
bounded: about three seconds for the model and four for the whole task, one
call per user message that enqueued a job. A message folded into a running
reply as a steer is skipped, because the reply it joined already reacted.

The Worker's 👀 is the fallback for everything that can go wrong above: it is
published from the claim itself, before routing, the worktree or the memory
brief. Whichever writes first owns the Agent's slot — a later 👀 never replaces
a real emoji, while the server's emoji does replace a 👀. The Worker no longer
runs a provider turn of its own to choose one, so `acknowledgement` in the
timeline reads `existing` on a healthy DM (the server got there first) and
`placeholder` when the Worker had to cover for it. Roll the server out before
the Worker CLI release.

## One reply's numbers

```sh
log=~/.local/state/briar/worker/<projectId>.log
grep -F '<workId>' "$log" | grep -E 'claim latency|channel reply (setup|timeline)'
# just the timeline, as an object:
grep -F '<workId>' "$log" | grep -F 'channel reply timeline: ' |
  sed 's/.*channel reply timeline: //' | jq .
# the slowest replies in the log:
grep -F 'channel reply timeline: ' "$log" | sed 's/.*channel reply timeline: //' |
  jq -s 'sort_by(-.triggerToReply) | .[0:10] | .[] | {workId, triggerToClaim, setup, turns, post, outcome}'
```
