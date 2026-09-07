# Running DM reply steering

Ordinary user messages in the same DM session join the running response when
received no more than 30 seconds after its last input. The boundary is inclusive;
each absorbed input advances the window. A queued independent turn forms a
barrier, so messages after a gap cannot jump back into the earlier response.
Skill commands, approved executions, delegated replies and Agent-to-Agent hops
keep their separate execution contracts. The existing pre-claim settle delay and
independent cancellation of messages that have not started are unchanged.

The message transaction links each absorbed job to the original response and
increments its input revision. Worker wake pushes interrupt lease renewal waits.
A pending revision rejects renewal; the Worker stops and awaits its provider,
cleans up invocation resources, then acknowledges shutdown through the Worker
queue RPC. Only this acknowledgement makes the original job claimable again.

A reclaimed response uses a new claim token and execution attempt, the same
session workspace and saved provider conversation ID, and all pending message
bodies and attachments. Followup inputs are not truncated by the ten-message
history limit. Completed provider tool history remains in that conversation;
the continuation prompt asks the provider to retain completed work. Steer restarts
have their own retry allowance and are not counted as Worker failures.

The final-answer transaction requires the input and applied revisions to match.
An input committed first fences the old result; an answer committed first ends
that response and the new message queues independently. Old claim tokens cannot
publish after a reclaim. Shutdown acknowledgements are idempotent until reclaim.
A Worker that dies before acknowledging is recovered through lease expiry.
Missing realtime pushes fall back to the normal lease check or final-answer fence.

Memory discovery references transfer only while the private memory scope and
revocation epoch remain valid. Cleanup retains them during acknowledged steering;
expired or revoked private context continues to use the existing cleanup rules.
Replying `stop` to an absorbed message stops the response it joined.

Deployment requires migration `0211_dm_reply_steer.sql`, the updated API and an
updated machine Worker supporting `AcknowledgeChannelReplySteer`. No desktop or
mobile UI change is required. This workflow validates and merges the change; it
does not deploy the API or release machine Workers.
