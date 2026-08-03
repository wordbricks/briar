# Workflow checkpoint policies

Briar always targets the workflow's final stage. Checkpoints are pause-and-resume
boundaries inside that execution; they are not terminal stages and do not shorten
the workflow.

## Policy layers

Each boundary is identified by `(stage, position)`, where `position` is `before`
or `after`. A new run receives the canonical union of:

1. project mandatory checkpoints, managed by organization owners and admins;
2. the creating user's default checkpoints.

If both layers select the same boundary, the project checkpoint wins. The result
is ordered by workflow stage, then `before`, then `after`, and duplicate or unknown
boundaries are rejected before persistence. An empty effective set means the run
continues automatically through the final stage.

The policy editor uses optimistic revisions independently for the project and user
layers. A stale save returns `409 CHECKPOINT_POLICY_CONFLICT`; clients must reload
instead of overwriting the newer policy.

## Snapshot rule

The effective checkpoint set is written into `workflow_snapshot_json` when a run
is created. Later project, user, or workflow setting changes never rewrite that
snapshot. This applies to app-created issues and idea-plan conversion. Entry paths
without a Briar user identity, such as service ingestion, receive only the project
mandatory layer.

Existing projects upgrade lazily. Until an admin explicitly saves the project
policy, checkpoints already stored in `workflow_json` are treated as mandatory.
An explicit empty project policy removes that compatibility fallback.

## Resume identity

A paused run exposes its exact checkpoint key, attempt, and revision. Resume must
send all three plus a retry-stable request ID. A stale identity returns a conflict;
Desktop, Android/Tauri, and iOS reload the run before allowing another resume.
For an `after` checkpoint on the final stage, resume performs terminal review and
completion without rerunning that stage.
