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
| `claimToAck` | claim → the placeholder reaction reached the server |
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
